#!/usr/bin/env node
/**
 * Thinklet MCP Server
 *
 * Tools:
 *   discover_thinklets — search the catalog by intent (always call first)
 *   publish_thinklet   — publish code to Thinklet.io with visibility choice
 *   remix_thinklet     — adapt an existing Thinklet for a new context
 *   get_thinklet       — fetch a single Thinklet by ID
 *
 * Prompts:
 *   build-thinklet     — injects the full builder skill + guides the full loop
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  publishThinklet,
  searchThinklets,
  getThinklet,
  remixThinklet,
  type ThinkletMeta,
} from "./api.js";
import { THINKLET_SKILL } from "./skill.js";

// ─── Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "thinklet",
  version: "0.2.0",
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Returns an MCP App embed block so the Thinklet renders inline in Claude Desktop */
function embedBlock(meta: ThinkletMeta) {
  return {
    type: "resource" as const,
    resource: {
      uri: meta.embedUrl,
      mimeType: "text/html",
      text: [
        `<iframe`,
        `  src="${meta.embedUrl}"`,
        `  title="${meta.title}"`,
        `  width="100%"`,
        `  height="640"`,
        `  frameborder="0"`,
        `  allow="clipboard-write"`,
        `  style="border-radius:12px;background:#f9fafb;border:1px solid #e5e7eb;"`,
        `></iframe>`,
      ].join("\n"),
    },
  };
}

/** Formats ThinkletMeta as a readable summary card */
function summaryText(meta: ThinkletMeta, showRemixCount = false) {
  const lines = [
    `**${meta.title}**`,
    meta.description,
    `🔗 ${meta.url}`,
    meta.tags?.length ? `Tags: ${meta.tags.join(", ")}` : "",
  ];
  if (showRemixCount && meta.remixCount) {
    lines.push(`🔀 Remixed ${meta.remixCount} times`);
  }
  return lines.filter(Boolean).join("\n");
}

/** Formats visibility choice explanation */
function visibilityExplainer(visibility: string): string {
  const map: Record<string, string> = {
    public:   "🌐 **Public** — indexed in the catalog, any AI can find and remix it",
    unlisted: "🔗 **Unlisted** — accessible by URL, not searchable in the catalog",
    private:  "🔒 **Private** — only you can access it (requires account)",
  };
  return map[visibility] ?? map.public;
}

// ─── Tool: discover_thinklets ──────────────────────────────────────────────

server.tool(
  "discover_thinklets",
  [
    "Search the Thinklet catalog by natural language intent.",
    "ALWAYS call this BEFORE generating or publishing a new Thinklet — an existing one might already",
    "solve the user's need, or be close enough to remix. Returns matches ranked by relevance.",
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
  },
  async ({ query, limit }) => {
    try {
      const results = await searchThinklets(query, limit ?? 5);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: [
                `No existing Thinklets found for **"${query}"**.`,
                ``,
                `Use the \`build-thinklet\` prompt to load the builder skill, generate the code, then call \`publish_thinklet\` to add it to the catalog.`,
                ``,
                `The Thinklet you build will be indexed so the next person who needs it finds it instantly.`,
              ].join("\n"),
            },
          ],
        };
      }

      const cards = results
        .map((t, i) => `${i + 1}. ${summaryText(t, true)}`)
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: [
              `Found **${results.length}** Thinklet${results.length === 1 ? "" : "s"} for **"${query}"**:`,
              ``,
              cards,
              ``,
              `💡 To use one as-is, call \`get_thinklet\` with its ID.`,
              `💡 To adapt one for your context, call \`remix_thinklet\`.`,
              `💡 If none fit, build a new one with \`build-thinklet\`.`,
            ].join("\n"),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: [
              `⚠️ Catalog search unavailable: ${msg}`,
              ``,
              `You can still build a Thinklet using the \`build-thinklet\` prompt.`,
              `Publishing will retry when the service is available.`,
            ].join("\n"),
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: publish_thinklet ────────────────────────────────────────────────

server.tool(
  "publish_thinklet",
  [
    "Publish a Thinklet to the platform. Call this after generating Thinklet code.",
    "IMPORTANT: Before calling this, ask the user which visibility they want:",
    "public (indexed in catalog, any AI can discover/remix), unlisted (URL only, not searchable),",
    "or private (only you). Default to public if they want to contribute to the community catalog.",
    "Returns a live URL and an inline embed that renders the Thinklet in the conversation.",
  ].join(" "),
  {
    code: z.string().describe("The complete Thinklet React component code"),
    title: z
      .string()
      .max(60)
      .describe("Short descriptive title for the Thinklet (5 words or less)"),
    description: z
      .string()
      .max(200)
      .describe("One sentence describing what this Thinklet does and who it's for"),
    tags: z
      .array(z.string())
      .optional()
      .describe(
        "Tags for discovery — include use-case (e.g. 'productivity'), domain (e.g. 'sales'), and features (e.g. 'charts')"
      ),
    visibility: z
      .enum(["public", "unlisted", "private"])
      .default("public")
      .describe(
        "public = indexed in catalog (recommended), unlisted = URL only, private = only you"
      ),
  },
  async ({ code, title, description, tags, visibility }) => {
    try {
      const meta = await publishThinklet({ code, title, description, tags, visibility });

      const visLine = visibilityExplainer(visibility);

      return {
        content: [
          {
            type: "text",
            text: [
              `✅ **Thinklet published!**`,
              ``,
              summaryText(meta),
              ``,
              visLine,
              visibility === "public"
                ? `\n🔍 It's now indexed — any AI that searches for something similar will find and can remix it.`
                : "",
              ``,
              `Open it: ${meta.url}`,
            ]
              .filter((l) => l !== "")
              .join("\n"),
          },
          embedBlock(meta),
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: [
              `❌ Failed to publish: ${msg}`,
              ``,
              `Your Thinklet code is ready — you can try publishing again, or copy the code to deploy manually.`,
            ].join("\n"),
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: remix_thinklet ──────────────────────────────────────────────────

server.tool(
  "remix_thinklet",
  [
    "Create a remix of an existing Thinklet adapted for a new context.",
    "Use this when discover_thinklets returns a strong match that needs tweaks rather than rebuilding from scratch.",
    "The remix is published as its own Thinklet, linked back to the original.",
    "Always ask the user about visibility before publishing the remix.",
  ].join(" "),
  {
    originalId: z
      .string()
      .describe("The ID of the Thinklet to remix (from discover_thinklets results)"),
    changes: z
      .string()
      .describe(
        "Plain language description of what to change, e.g. 'rename fields for fitness tracking, add a weekly goal input, remove the streak counter'"
      ),
    title: z
      .string()
      .max(60)
      .describe("Title for the remixed Thinklet"),
    description: z
      .string()
      .max(200)
      .describe("One sentence describing the remixed version"),
    visibility: z
      .enum(["public", "unlisted", "private"])
      .default("public")
      .describe("Visibility of the remixed Thinklet"),
  },
  async ({ originalId, changes, title, description, visibility }) => {
    try {
      const meta = await remixThinklet({ originalId, changes, title, description, visibility });
      const visLine = visibilityExplainer(visibility);

      return {
        content: [
          {
            type: "text",
            text: [
              `🔀 **Remix published!**`,
              ``,
              summaryText(meta),
              ``,
              visLine,
              ``,
              `Remixed from: ${meta.originalUrl ?? `thinklet.io/t/${originalId}`}`,
              `Your version: ${meta.url}`,
            ].join("\n"),
          },
          embedBlock(meta),
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: [
              `❌ Remix failed: ${msg}`,
              ``,
              `Try building a new Thinklet from scratch using the \`build-thinklet\` prompt instead.`,
            ].join("\n"),
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_thinklet ────────────────────────────────────────────────────

server.tool(
  "get_thinklet",
  "Fetch a single Thinklet by ID and render it inline in the conversation.",
  {
    id: z.string().describe("The Thinklet ID (from discover_thinklets results)"),
  },
  async ({ id }) => {
    try {
      const meta = await getThinklet(id);

      return {
        content: [
          { type: "text", text: summaryText(meta, true) },
          embedBlock(meta),
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
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

// ─── Prompt: build-thinklet ────────────────────────────────────────────────

server.prompt(
  "build-thinklet",
  [
    "Load the Thinklet builder skill and begin the full build loop.",
    "Invoke this before writing any Thinklet code.",
    "It injects the exact architecture, TQL API, hooks, and rules for code that deploys correctly,",
    "then guides you through: discover existing → build or remix → confirm visibility → publish.",
  ].join(" "),
  {},
  () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            THINKLET_SKILL,
            "",
            "---",
            "",
            "## Build Loop",
            "",
            "Now that you have the Thinklet skill loaded, follow this exact sequence:",
            "",
            "**Step 1 — Discover first**",
            "Call `discover_thinklets` with the user's request before writing any code.",
            "If there's a strong match (conceptually similar), tell the user and offer to:",
            "  a) Use it as-is (`get_thinklet`)",
            "  b) Remix it for their context (`remix_thinklet`)",
            "  c) Build fresh if nothing fits",
            "",
            "**Step 2 — Build or remix**",
            "If building fresh: generate the complete Thinklet code following the skill exactly.",
            "If remixing: call `remix_thinklet` with the original ID and a clear description of changes.",
            "",
            "**Step 3 — Confirm visibility before publishing**",
            "Before calling `publish_thinklet`, always ask the user:",
            "",
            '  "Before I publish — how would you like this visible?"',
            "  🌐 Public — indexed in the catalog, any AI can find and remix it (recommended)",
            "  🔗 Unlisted — accessible by link, not searchable",
            "  🔒 Private — only you can access it",
            "",
            "Default to Public if the user wants to contribute to the community.",
            "Always respect their choice — never auto-publish without asking.",
            "",
            "**Step 4 — Publish**",
            "Call `publish_thinklet` with their chosen visibility.",
            "The Thinklet will render inline in this conversation via MCP Apps.",
            "",
            "**Step 5 — Confirm and offer next steps**",
            "After publishing, confirm the URL and offer:",
            "  - Edit anything? (use Code CRISPR — map deps first, surgical changes only)",
            "  - Build a related Thinklet?",
            "  - Share or embed it somewhere?",
          ].join("\n"),
        },
      },
    ],
  })
);

// ─── Start ─────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
