#!/usr/bin/env node
/**
 * Thinklet MCP Server v0.5.0
 *
 * Tools:
 *   discover_thinklets    — search catalog + auto-detect integrations (MANDATORY first step)
 *   confirm_integrations  — confirm user's integration choices + load docs (MANDATORY second step)
 *   list_integrations     — browse integrations catalog (optional, outside build flow)
 *   save_thinklet         — generate + save a thinklet (requires both discover + confirm)
 *   get_thinklet          — fetch a single thinklet by ID + render inline
 *   fix_thinklet          — patch code on an existing thinklet
 *   publish_thinklet      — toggle between public and private
 *
 * Flow: discover → [user replies] → confirm_integrations → save → iterate → publish
 *
 * Prompts:
 *   build-thinklet     — injects the builder skill + guides the private-first flow
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createThinklet,
  searchThinklets,
  getThinklet,
  getThinkletCode,
  fetchSkill,
  buildAppUrl,
  fixThinklet,
  setVisibility,
  type ThinkletMeta,
  type SkillMode,
} from "./api.js";
import { THINKLET_SKILL } from "./skill.js";
import { getCatalog, getIntegrationDocs, matchTriggers } from "./integrations.js";

// ─── Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "thinklet",
  version: "0.5.0",
});

// ─── MCP Apps: viewer resource ──────────────────────────────────────────────

const VIEWER_RESOURCE_URI = "ui://thinklet/viewer/v2";
const __dirname = dirname(fileURLToPath(import.meta.url));

const CONTENT_BASE_URL =
  process.env.THINKLET_CONTENT_URL ?? "https://content.thinklet.io";
const contentOrigin = new URL(CONTENT_BASE_URL).origin;

let viewerHtml: string;
try {
  viewerHtml = readFileSync(join(__dirname, "viewer.html"), "utf-8");
} catch {
  process.stderr.write(
    "[thinklet-mcp] WARNING: viewer.html not found in dist/. Run `npm run build:ui` first.\n"
  );
  viewerHtml = "<html><body><p>Viewer not built. Run npm run build:ui.</p></body></html>";
}

registerAppResource(
  server,
  "Thinklet Viewer",
  VIEWER_RESOURCE_URI,
  {
    _meta: {
      ui: {
        csp: {
          frameDomains: [contentOrigin],
          connectDomains: [contentOrigin],
          resourceDomains: ["https://esm.sh", "https://cdn.esm.sh"],
        },
      },
    },
  },
  async () => ({
    contents: [
      {
        uri: VIEWER_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: viewerHtml,

      },
    ],
  }),
);

// ─── Helpers ───────────────────────────────────────────────────────────────

interface BuildFlowState {
  discovered: boolean;
  integrationsConfirmed: boolean;
  /** Integration IDs that trigger-matching recommended (set by discover). */
  recommendedIntegrations: string[];
  /** Integration IDs the user confirmed (set by confirm_integrations). */
  confirmedIntegrations: string[];
  lastUpdated: number;
}

const buildFlow: BuildFlowState = {
  discovered: false,
  integrationsConfirmed: false,
  recommendedIntegrations: [],
  confirmedIntegrations: [],
  lastUpdated: Date.now(),
};

function resetBuildFlow() {
  buildFlow.discovered = false;
  buildFlow.integrationsConfirmed = false;
  buildFlow.recommendedIntegrations = [];
  buildFlow.confirmedIntegrations = [];
  buildFlow.lastUpdated = Date.now();
}

/**
 * Load the editor's prompt library for the given mode. Falls back to the
 * bundled offline skill text if the backend is unreachable so the server
 * still works in degraded mode.
 */
async function loadSkill(mode: SkillMode): Promise<string> {
  try {
    return await fetchSkill(mode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[thinklet-mcp] skill fetch failed (mode=${mode}): ${msg}. Using offline fallback.\n`
    );
    return THINKLET_SKILL;
  }
}

function resolveAppUrl(meta: ThinkletMeta): string {
  return buildAppUrl(meta.id, meta.visibility, meta.platformUrl, meta.publicationId);
}

function appLink(meta: ThinkletMeta): string {
  return `[Open in Thinklet](${resolveAppUrl(meta)})`;
}

function buildToolResult(
  text: string,
  appUrl: string,
  code?: string
): { content: ContentBlock[]; structuredContent?: Record<string, unknown> } {
  const content: ContentBlock[] = [{ type: "text", text }];
  const result: { content: ContentBlock[]; structuredContent?: Record<string, unknown> } = { content };
  const sc: Record<string, unknown> = { appUrl };
  if (code) sc.code = code;
  if (Object.keys(sc).length > 0) {
    result.structuredContent = sc;
  }
  return result;
}

function summaryText(meta: ThinkletMeta) {
  const lines = [
    `**${meta.title}**`,
    meta.description,
    `ID: ${meta.id}`,
    meta.tags?.length ? `Tags: ${meta.tags.join(", ")}` : "",
    `Visibility: ${meta.visibility}`,
  ];
  if (meta.score != null) {
    lines.push(`Relevance: ${meta.score}%`);
  }
  return lines.filter(Boolean).join("\n");
}

function visibilityExplainer(visibility: string): string {
  const map: Record<string, string> = {
    public:
      "🌐 **Public** — indexed in the catalog, any AI can find and remix it",
    private: "🔒 **Private** — only you can access it via your API key",
  };
  return map[visibility] ?? map.private;
}

// ─── Tool: list_integrations ────────────────────────────────────────────────

server.tool(
  "list_integrations",
  [
    "OPTIONAL browsing tool — browse the full integration catalog or load docs for specific IDs.",
    "This is NOT part of the mandatory build flow. Use `confirm_integrations` for that.",
    "Useful if the user wants to explore integrations outside of the build flow,",
    "or if you need to reference docs for `fix_thinklet` edits.",
  ].join(" "),
  {
    ids: z
      .array(z.string())
      .optional()
      .describe(
        "Specific integration IDs to fetch details for. Omit to get the full catalog."
      ),
    includeDocs: z
      .boolean()
      .default(false)
      .optional()
      .describe(
        "Include full usage docs for the specified integrations (default false)"
      ),
  },
  async ({ ids, includeDocs }) => {
    if (ids && ids.length > 0 && includeDocs) {
      const docs = getIntegrationDocs(ids);
      return {
        content: [
          {
            type: "text",
            text: [
              `📚 **Integration docs for:** ${ids.join(", ")}`,
              "",
              docs,
            ].join("\n"),
          },
        ],
      };
    }

    const catalog = getCatalog();
    const lines = catalog.map(
      (i) => `- **${i.name}** (\`${i.id}\`) — ${i.description}`
    );

    return {
      content: [
        {
          type: "text",
          text: [
            `🔌 **Available Integrations** (${catalog.length}):`,
            "",
            ...lines,
          ].join("\n"),
        },
      ],
    };
  }
);

// ─── Tool: confirm_integrations ─────────────────────────────────────────────

server.tool(
  "confirm_integrations",
  [
    "MANDATORY second step after `discover_thinklets`. Confirms which integrations the user chose.",
    "Pass the integration IDs the user selected, or an empty array `[]` if they declined all integrations.",
    "If IDs are provided, returns the full usage docs you NEED to write correct code.",
    "⚠️ Without these docs, your code WILL reference non-existent APIs and the thinklet WILL crash at runtime.",
    "`save_thinklet` WILL REJECT if this tool has not been called first.",
    "Flow: discover_thinklets → [user replies] → confirm_integrations → generate code → save_thinklet.",
  ].join(" "),
  {
    ids: z
      .array(z.string())
      .describe(
        "Integration IDs the user confirmed. Pass `[]` if the user explicitly declined all integrations."
      ),
  },
  async ({ ids }) => {
    if (!buildFlow.discovered) {
      return {
        content: [
          {
            type: "text",
            text: [
              "❌ Cannot confirm integrations: `discover_thinklets` has not been called yet.",
              "",
              "Required flow: discover_thinklets → [user replies] → confirm_integrations → save_thinklet",
            ].join("\n"),
          },
        ],
        isError: true,
      };
    }

    buildFlow.confirmedIntegrations = ids;
    buildFlow.integrationsConfirmed = true;
    buildFlow.lastUpdated = Date.now();

    if (ids.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: [
              `✅ **Integrations confirmed:** none selected.`,
              ``,
              `You may now generate the code and call \`save_thinklet\`.`,
              `Do NOT use any integration APIs (aiApi, useAIStreaming, etc.) in the code — the user declined them.`,
            ].join("\n"),
          },
        ],
      };
    }

    const docs = getIntegrationDocs(ids);
    return {
      content: [
        {
          type: "text",
          text: [
            `✅ **Integrations confirmed:** ${ids.join(", ")}`,
            ``,
            `📚 **Usage docs loaded below.** You MUST follow these APIs exactly — incorrect usage will crash at runtime.`,
            ``,
            docs,
            ``,
            `---`,
            ``,
            `You now have the docs. Generate the code and call \`save_thinklet\` with \`integrations: [${ids.map((id) => `"${id}"`).join(", ")}]\`.`,
          ].join("\n"),
        },
      ],
    };
  }
);

// ─── Tool: discover_thinklets ──────────────────────────────────────────────

server.tool(
  "discover_thinklets",
  [
    "MANDATORY FIRST STEP. Search the Thinklet catalog before building anything.",
    "Results are public-first: published thinklets appear first, followed by your own private thinklets when enabled.",
    "The returned result cards are already user-ready markdown. Preserve the titles, links, headings, and ordering exactly when presenting them.",
    "Returns matches ranked by relevance PLUS auto-detected integration recommendations based on the query.",
    "After this call returns, you MUST present the results and recommendations to the user and STOP.",
    "⚠️ CRITICAL: `save_thinklet` WILL REJECT your call unless `confirm_integrations` has been called first.",
    "If you skip `confirm_integrations`, the build WILL fail. The required flow is:",
    "discover_thinklets → [user replies] → confirm_integrations → [load docs if needed] → save_thinklet.",
  ].join(" "),
  {
    query: z
      .string()
      .describe(
        "Natural language description of what the user needs, e.g. 'habit tracker with streaks and heatmap'"
      ),
    limit: z
      .number()
      .min(1)
      .max(10)
      .default(5)
      .optional()
      .describe("Max results to return (default 5)"),
    includePrivate: z
      .boolean()
      .default(true)
      .optional()
      .describe("Include your own private thinklets in results after public matches (default true)"),
  },
  async ({ query, limit, includePrivate }) => {
    const recommended = matchTriggers(query);
    buildFlow.recommendedIntegrations = recommended.map((r) => r.id);

    const catalog = getCatalog();
    const otherIntegrations = catalog.filter(
      (i) => !recommended.some((r) => r.id === i.id)
    );

    const integrationSection = [
      ``,
      `---`,
      ``,
      `## 🔌 Integrations`,
      ``,
    ];

    if (recommended.length > 0) {
      integrationSection.push(
        `**✅ RECOMMENDED for this request** (you MUST present these to the user):`,
        ...recommended.map(
          (r) => `- **${r.name}** (\`${r.id}\`) — ${r.description}`
        ),
        ``,
      );
    }

    if (otherIntegrations.length > 0) {
      integrationSection.push(
        `**Other available integrations:**`,
        ...otherIntegrations.map(
          (i) => `- **${i.name}** (\`${i.id}\`) — ${i.description}`
        ),
        ``,
      );
    }

    if (recommended.length === 0) {
      integrationSection.push(
        `No integrations auto-detected for this query, but the user may still want some from the list above.`,
        ``,
      );
    }

    const recommendedNames = recommended.map((r) => r.name);
    const recommendedIds = recommended.map((r) => r.id);

      const actionBlock = [
      `---`,
      ``,
      `## ⛔ MANDATORY — READ THIS BEFORE RESPONDING`,
      ``,
      `You MUST present the discovery cards exactly as provided below.`,
      `Do NOT regroup them into categories, do NOT rewrite titles, and do NOT strip markdown links.`,
      `Keep the Published Thinklets and Your Private Thinklets headings intact when they are present.`,
      ``,
      `You MUST present the above to the user and ask TWO things:`,
      ``,
      recommended.length > 0
        ? `1. **Integrations:** "Based on your request, I recommend **${recommendedNames.join("**, **")}**. Want to add any others, or should I proceed with ${recommended.length === 1 ? "this" : "these"}?"`
        : `1. **Integrations:** "Would you like to use any integrations for this thinklet?"`,
      `2. **Build approach:** Remix an existing thinklet or start fresh?`,
      ``,
      `**After the user replies, your MANDATORY next call is:**`,
      `\`confirm_integrations({ ids: [...] })\` — pass the user's chosen IDs, or \`[]\` if they declined.`,
      ``,
      `⚠️ \`save_thinklet\` WILL REJECT if you skip \`confirm_integrations\`.`,
      `⚠️ Without integration docs, your code WILL use non-existent APIs and crash at runtime.`,
    ];

    try {
      const results = await searchThinklets(
        query,
        limit ?? 5,
        includePrivate ?? true
      );
      buildFlow.discovered = true;
      buildFlow.integrationsConfirmed = false;
      buildFlow.lastUpdated = Date.now();

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: [
                `## Discovery Results`,
                ``,
                `No existing Thinklets match "${query}". Building from scratch.`,
                ...integrationSection,
                ...actionBlock,
              ].join("\n"),
            },
          ],
          structuredContent: {
            requiresUserDecision: true,
            decision: "integration_selection",
            shouldWaitForUserReply: true,
            matchCount: 0,
            existingThinklets: [],
            recommendedIntegrations: recommendedIds,
          },
        };
      }

      const resultSummaries = results.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        visibility: t.visibility,
        score: t.score,
        url: resolveAppUrl(t),
      }));

      const publishedResults = results.filter((t) => t.visibility === "public");
      const privateResults = results.filter((t) => t.visibility !== "public");

      const formatCards = (items: typeof results, startIndex: number) =>
        items
          .map((t, offset) => {
            const i = startIndex + offset;
            const url = resolveAppUrl(t);
            const score = t.score != null ? ` (${t.score}% match)` : "";
            return [
              `**${i}. [${t.title}](${url})**${score}`,
              `   ${t.description}`,
              `   ID: \`${t.id}\` | ${t.visibility} | [Open in Thinklet](${url})`,
            ].join("\n");
          })
          .join("\n\n");

      const sections: string[] = [];
      let nextIndex = 1;

      if (publishedResults.length > 0) {
        sections.push(`**Published Thinklets**`, ``, formatCards(publishedResults, nextIndex));
        nextIndex += publishedResults.length;
      }

      if (privateResults.length > 0) {
        sections.push(
          `**Your Private Thinklets**`,
          ``,
          formatCards(privateResults, nextIndex),
        );
      }

      const cards = sections.filter(Boolean).join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: [
              `## Discovery Results — ${results.length} EXISTING THINKLET${results.length === 1 ? "" : "S"} FOUND`,
              ``,
              includePrivate ?? true
                ? `Published thinklets are shown first. If relevant, your own private thinklets appear after them.`
                : `Only published thinklets are shown in these results.`,
              ``,
              `Present the result cards below exactly as written, preserving headings and markdown links.`,
              ``,
              `⚠️ You MUST present ALL ${results.length} result${results.length === 1 ? "" : "s"} below to the user. DO NOT skip them or say "no matches."`,
              ``,
              cards,
              ...integrationSection,
              ...actionBlock,
            ].join("\n"),
          },
        ],
        structuredContent: {
          requiresUserDecision: true,
          decision: "remix_or_fresh_and_integration_selection",
          shouldWaitForUserReply: true,
          matchCount: results.length,
          existingThinklets: resultSummaries,
          recommendedIntegrations: recommendedIds,
        },
      };
    } catch (err) {
      buildFlow.discovered = true;
      buildFlow.integrationsConfirmed = false;
      buildFlow.lastUpdated = Date.now();
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: [
              `## Discovery Results`,
              ``,
              `⚠️ Catalog search unavailable: ${msg}. Building from scratch.`,
              ...integrationSection,
              ...actionBlock,
            ].join("\n"),
          },
        ],
        structuredContent: {
          requiresUserDecision: true,
          decision: "integration_selection",
          shouldWaitForUserReply: true,
          matchCount: 0,
          existingThinklets: [],
          recommendedIntegrations: recommendedIds,
          searchError: msg,
        },
      };
    }
  }
);

// ─── Tool: save_thinklet ──────────────────────────────────────────────────

registerAppTool(
  server,
  "save_thinklet",
  {
    description: [
      "Save a generated Thinklet as a PRIVATE thinklet and render it inline.",
      "REQUIRES both `discover_thinklets` AND `confirm_integrations` to have been called — WILL REJECT otherwise.",
      "⚠️ If you call this without `confirm_integrations`, it WILL fail. No exceptions.",
      "If the user chose integrations, `confirm_integrations` already loaded the docs — use those APIs exactly.",
      "If you use integration APIs without having loaded their docs, the code WILL crash at runtime.",
      "Returns the thinklet metadata, app URL, and an inline embed preview.",
      "IMPORTANT: You MUST include the app URL from the response in your message to the user.",
    ].join(" "),
    inputSchema: {
      code: z.string().describe("The complete Thinklet React component code"),
      title: z
        .string()
        .describe("Short descriptive title (STRICT MAX 60 chars, 5 words or less). Will be truncated if longer."),
      description: z
        .string()
        .describe(
          "One SHORT sentence (STRICT MAX 200 chars). Will be truncated if longer."
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Tags for discovery — include use-case (e.g. 'productivity'), domain (e.g. 'sales'), and features (e.g. 'charts')"
        ),
      integrations: z
        .array(z.string())
        .optional()
        .describe(
          "Integration IDs used in this thinklet (from `confirm_integrations`), e.g. ['image-generation', 'ai-api']"
        ),
    },
    _meta: { ui: { resourceUri: VIEWER_RESOURCE_URI } },
  },
  async ({ code, title, description: rawDesc, tags, integrations }) => {
    const description = rawDesc.length > 200 ? rawDesc.slice(0, 197) + "..." : rawDesc;
    const safeTitle = title.length > 60 ? title.slice(0, 57) + "..." : title;
    if (!buildFlow.discovered) {
      return {
        content: [
          {
            type: "text" as const,
            text: [
              "❌ Save rejected: `discover_thinklets` has not been called.",
              "",
              "Required flow:",
              "1. Call `discover_thinklets` — present results + integration recommendations to the user",
              "2. WAIT for the user to reply with their choices",
              "3. Call `confirm_integrations` with the user's chosen IDs (or `[]` for none)",
              "4. Generate code using the loaded docs, then call `save_thinklet`",
            ].join("\n"),
          },
        ],
        isError: true,
      };
    }

    if (!buildFlow.integrationsConfirmed) {
      const hint =
        buildFlow.recommendedIntegrations.length > 0
          ? `\n\nNote: discover_thinklets recommended [${buildFlow.recommendedIntegrations.join(", ")}] for this query. Present these to the user and call \`confirm_integrations\` with their choice.`
          : "";
      return {
        content: [
          {
            type: "text" as const,
            text: [
              "❌ Save rejected: `confirm_integrations` has not been called.",
              "",
              "You MUST call `confirm_integrations` before `save_thinklet` — even if the user wants no integrations (pass `[]`).",
              "Without confirmed integration docs, the generated code may use non-existent APIs and crash at runtime.",
              "",
              "Required flow:",
              "1. ✅ `discover_thinklets` — done",
              "2. Present recommendations to the user, wait for their reply",
              "3. ❌ Call `confirm_integrations` with chosen IDs (or `[]`) — YOU ARE HERE",
              "4. Generate code, then call `save_thinklet`",
              hint,
            ].join("\n"),
          },
        ],
        isError: true,
      };
    }

    try {
      const meta = await createThinklet({ code, title: safeTitle, description, tags, integrations });
      const url = resolveAppUrl(meta);

      const lines = [
        `⚠️ INCLUDE THIS URL IN YOUR RESPONSE TO THE USER:`,
        `🔗 ${url}`,
        ``,
        `✅ **Thinklet saved** (private)`,
        summaryText(meta),
        `🔒 Only you can access this — it's private.`,
      ];

      lines.push(``, `🖼️ **Viewer attached below.**`);

      lines.push(
        ``,
        `**Next:**`,
        `- Want changes? → just ask, I'll update it with \`fix_thinklet\``,
        `- Ready to share? → \`publish_thinklet\` to make it public`,
      );

      resetBuildFlow();
      return buildToolResult(lines.join("\n"), url, code);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `❌ Failed to create: ${msg}`,
              ``,
              `Your Thinklet code is ready — you can try again, or copy the code to deploy manually.`,
            ].join("\n"),
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_thinklet ────────────────────────────────────────────────────

registerAppTool(
  server,
  "get_thinklet",
  {
    description: [
      "Fetch a single Thinklet by ID and render it inline in the conversation.",
      "Accepts either a thinklet_id OR a publication_id (from a public catalog card).",
      "Public thinklets owned by other users are readable; private ones require ownership.",
      "Also returns the source code so you can review or fix it.",
      "IMPORTANT: You MUST include the app URL from the response in your message to the user.",
    ].join(" "),
    inputSchema: {
      id: z.string().describe("The Thinklet ID or publication ID"),
      includeCode: z
        .boolean()
        .default(false)
        .optional()
        .describe("Also fetch and return the source code (default false)"),
    },
    _meta: { ui: { resourceUri: VIEWER_RESOURCE_URI } },
  },
  
  async ({ id, includeCode }) => {
    try {
      const meta = await getThinklet(id);
      // Always fetch code for rendering (flat render needs it)
      // includeCode only controls whether code appears in LLM-visible text
      const thinkletCode = await getThinkletCode(id).catch(() => "");
      const url = resolveAppUrl(meta);

      let codeText = "";
      if (includeCode && thinkletCode) {
        codeText = `\n\n---\n\n**Source code:**\n\`\`\`jsx\n${thinkletCode}\n\`\`\``;
      }

      const lines = [
        `⚠️ INCLUDE THIS URL IN YOUR RESPONSE TO THE USER:`,
        `🔗 ${url}`,
        ``,
        summaryText(meta),
      ];
      if (thinkletCode) {
        lines.push(``, `🖼️ **Inline preview attached below.**`);
      } else {
        lines.push(``, `🧭 **Open in Thinklet fallback attached below.**`);
      }
      lines.push(codeText);

      // Always pass code to structuredContent for viewer to render (flat path)
      // LLM-visible text only shows code block if includeCode=true
      return buildToolResult(
        lines.filter(Boolean).join("\n"),
        url,
        thinkletCode || undefined,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `❌ Failed to fetch Thinklet "${id}": ${msg}`,
              ``,
              `Try \`discover_thinklets\` to find it by description instead.`,
            ].join("\n"),
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: fix_thinklet ────────────────────────────────────────────────────

registerAppTool(
  server,
  "fix_thinklet",
  {
    description: [
      "Patch the code on an existing Thinklet you own.",
      "Use this when the user wants to fix a bug, tweak UI, or iterate on a thinklet",
      "that was already created with `save_thinklet`.",
      "Provide the COMPLETE updated code — this replaces the previous version entirely.",
      "IMPORTANT: You MUST include the app URL from the response in your message to the user.",
    ].join(" "),
    inputSchema: {
      id: z.string().describe("The Thinklet ID to patch"),
      code: z.string().describe("The complete updated Thinklet React component code"),
      title: z
        .string()
        .optional()
        .describe("Updated title, MAX 60 chars (optional — keeps existing if omitted). Truncated if longer."),
      description: z
        .string()
        .optional()
        .describe("Updated description, MAX 200 chars (optional — keeps existing if omitted). Truncated if longer."),
      tags: z
        .array(z.string())
        .optional()
        .describe("Updated tags (optional — keeps existing if omitted)"),
      integrations: z
        .array(z.string())
        .optional()
        .describe(
          "Updated integration IDs (optional — keeps existing if omitted). Use to add integrations post-creation."
        ),
    },
    _meta: { ui: { resourceUri: VIEWER_RESOURCE_URI } },
  },
  async ({ id, code, title: rawTitle, description: rawDesc, tags, integrations }) => {
    const title = rawTitle && rawTitle.length > 60 ? rawTitle.slice(0, 57) + "..." : rawTitle;
    const description = rawDesc && rawDesc.length > 200 ? rawDesc.slice(0, 197) + "..." : rawDesc;
    try {
      const meta = await fixThinklet(id, code, title, description, tags, integrations);
      const url = resolveAppUrl(meta);

      const lines = [
        `⚠️ INCLUDE THIS URL IN YOUR RESPONSE TO THE USER:`,
        `🔗 ${url}`,
        ``,
        `✅ **Thinklet updated!**`,
        summaryText(meta),
        `The code has been replaced with your new version.`,
      ];

      lines.push(``, `🖼️ **Viewer attached below.**`);

      lines.push(
        meta.visibility === "private"
          ? `\n🔒 Still private. Use \`publish_thinklet\` when ready to share.`
          : `\n🌐 This is public — the update is live.`,
      );

      return buildToolResult(lines.join("\n"), url, code);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `❌ Failed to update Thinklet "${id}": ${msg}`,
              ``,
              `Make sure you own this Thinklet and the ID is correct.`,
            ].join("\n"),
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: publish_thinklet ────────────────────────────────────────────────

registerAppTool(
  server,
  "publish_thinklet",
  {
    description: [
      "Publish or unpublish a Thinklet — toggle between public and private.",
      "Making it PUBLIC indexes it in the catalog (other AIs can discover and remix it)",
      "and generates an AI thumbnail. Making it PRIVATE archives the publication.",
      "Always confirm with the user before changing visibility.",
      "IMPORTANT: You MUST include the app URL from the response in your message to the user.",
    ].join(" "),
    inputSchema: {
      id: z.string().describe("The Thinklet ID"),
      visibility: z
        .enum(["public", "private"])
        .describe("public = indexed in catalog, private = only you"),
    },
    _meta: { ui: { resourceUri: VIEWER_RESOURCE_URI } },
  },
  async ({ id, visibility }) => {
    try {
      const meta = await setVisibility(id, visibility);
      const thinkletCode = await getThinkletCode(id).catch(() => "");
      const url = resolveAppUrl(meta);

      const visLine = visibilityExplainer(visibility);

      const lines = [
        `⚠️ INCLUDE THIS URL IN YOUR RESPONSE TO THE USER:`,
        `🔗 ${url}`,
        ``,
        `✅ **Visibility changed!**`,
        summaryText(meta),
        visLine,
      ];

      if (thinkletCode) {
        lines.push(``, `🖼️ **Inline preview attached below.**`);
      } else {
        lines.push(``, `🧭 **Open in Thinklet fallback attached below.**`);
      }

      lines.push(
        visibility === "public"
          ? `\n🔍 It's now indexed — any AI that searches for something similar will find it.`
          : `\n📦 Removed from the public catalog.`,
      );

      return buildToolResult(lines.join("\n"), url, thinkletCode || undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `❌ Failed to change visibility for "${id}": ${msg}`,
              ``,
              `Make sure you own this Thinklet and the ID is correct.`,
            ].join("\n"),
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Prompt: build-thinklet ────────────────────────────────────────────────

server.prompt(
  "build-thinklet",
  [
    "Load the Thinklet builder skill (same prompt library the web editor uses)",
    "and begin the build loop. Invoke this before writing any Thinklet code.",
    "Flow: discover → recommend integrations → user picks → generate →",
    "auto-save as private → render inline → iterate → optional go public.",
  ].join(" "),
  {},
  async () => {
    const skill = await loadSkill("create");
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              skill,
              "",
              "---",
              "",
              "## Build Loop — STRICT FLOW (every step is enforced, skipping WILL fail)",
              "",
              "**Step 1 — Discover + present (MANDATORY, WAIT FOR USER)**",
              "Call `discover_thinklets` with the user's intent. The response includes",
              "existing Thinklets AND auto-detected integration recommendations.",
              "⛔ You MUST present the results and recommendations to the user and STOP.",
              "Ask: remix or fresh? And confirm the recommended integrations.",
              "DO NOT proceed to step 2 until the user has replied.",
              "",
              "**Step 2 — Confirm integrations (MANDATORY — `save_thinklet` WILL REJECT without this)**",
              "After the user replies, call `confirm_integrations` with their chosen",
              "integration IDs. Pass `[]` if they declined all integrations.",
              "If IDs are provided, this returns the usage docs you NEED.",
              "⚠️ If you skip this step and call `save_thinklet`, it WILL be rejected.",
              "⚠️ If you use integration APIs without loading docs first, the code WILL",
              "reference non-existent functions and the thinklet WILL crash at runtime.",
              "",
              "**Step 3 — Generate + save + render**",
              "Write 2–4 bullets: primary action, state shape, integrations used,",
              "empty/loading/error states. Then generate the full component and",
              "call `save_thinklet` with the code + integration IDs. This saves it",
              "as a private thinklet and renders the embed inline. The response",
              "includes the app URL — always show it to the user.",
              "",
              "**Step 4 — Iterate**",
              "If the user asks for changes, use `fix_thinklet` with the COMPLETE",
              "updated component. Always show the URL from the response.",
              "",
              "**Step 5 — Publish (optional, user-initiated)**",
              "When the user says they want to share it / make it public, call",
              "`publish_thinklet` with `public`. This indexes the thinklet for",
              "discovery and generates a thumbnail. Never flip visibility without",
              "explicit user consent. The response URL changes to the public feed URL.",
            ].join("\n"),
          },
        },
      ],
    };
  }
);

// ─── Prompt: fix-thinklet ──────────────────────────────────────────────────

server.prompt(
  "fix-thinklet",
  [
    "Load the Thinklet edit-mode skill (same prompt library the web editor uses",
    "for patches) and iterate on an existing Thinklet. Invoke this before calling",
    "fix_thinklet so the two-phase analyse-then-patch discipline is active.",
  ].join(" "),
  {},
  async () => {
    const skill = await loadSkill("edit");
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              skill,
              "",
              "---",
              "",
              "## Edit Loop",
              "",
              "1. Call `get_thinklet` with `includeCode: true` for the target id",
              "   — you need the current source before proposing changes.",
              "2. In prose, do the Phase 1 analysis: dependency map, change scope,",
              "   TQL strategy (immediate vs debounced vs batched).",
              "3. Show the COMPLETE updated component in a fenced ```jsx block and",
              "   ask the user to confirm.",
              "4. After confirmation, call `fix_thinklet` with the full code.",
              "5. If the thinklet is public, remind the user the update is live.",
            ].join("\n"),
          },
        },
      ],
    };
  }
);

// ─── Start ─────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
