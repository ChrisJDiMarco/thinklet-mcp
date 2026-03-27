#!/usr/bin/env node
/**
 * Thinklet MCP Server
 *
 * Tools:
 *   publish_thinklet  — publish generated code to Thinklet.io, returns live URL + inline embed
 *   discover_thinklets — search the Thinklet catalog by intent
 *   get_thinklet      — fetch a single Thinklet by ID
 *
 * Prompts:
 *   build-thinklet    — injects the Thinklet builder skill so Claude knows exactly
 *                       how to generate production-correct Thinklet code
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { publishThinklet, searchThinklets, getThinklet, type ThinkletMeta } from "./api.js";
import { THINKLET_SKILL } from "./skill.js";

// ─── Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "thinklet",
  version: "0.1.0",
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
        `  style="border-radius:12px;background:#18181b;"`,
        `></iframe>`,
      ].join("\n"),
    },
  };
}

/** Formats ThinkletMeta as a readable summary card */
function summaryText(meta: ThinkletMeta) {
  return [
    `**${meta.title}**`,
    meta.description,
    `🔗 ${meta.url}`,
    meta.tags?.length ? `Tags: ${meta.tags.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Tool: publish_thinklet ────────────────────────────────────────────────

server.tool(
  "publish_thinklet",
  "Publish a Thinklet to the platform. Call this after generating Thinklet code. Returns a live URL and an inline embed that renders the Thinklet directly in the conversation.",
  {
    code: z.string().describe("The complete Thinklet React component code"),
    title: z.string().describe("Short title for the Thinklet (5 words or less)"),
    description: z.string().describe("One sentence describing what this Thinklet does"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional tags for discovery (e.g. ['productivity', 'tracker'])"),
  },
  async ({ code, title, description, tags }) => {
    try {
      const meta = await publishThinklet({ code, title, description, tags });

      return {
        content: [
          {
            type: "text",
            text: [
              `✅ **Thinklet published!**`,
              ``,
              summaryText(meta),
              ``,
              `Open it: ${meta.url}`,
            ].join("\n"),
          },
          embedBlock(meta),
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Failed to publish: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: discover_thinklets ──────────────────────────────────────────────

server.tool(
  "discover_thinklets",
  "Search the Thinklet catalog by natural language intent. Always call this BEFORE generating a new Thinklet — an existing one might already solve the user's need.",
  {
    query: z
      .string()
      .describe("Natural language description of what the user needs, e.g. 'habit tracker with streaks'"),
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
              text: `No existing Thinklets found for "${query}". You should build one — use the \`build-thinklet\` prompt to load the skill, generate the code, then call \`publish_thinklet\`.`,
            },
          ],
        };
      }

      const cards = results.map((t, i) => `${i + 1}. ${summaryText(t)}`).join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `Found ${results.length} Thinklet${results.length === 1 ? "" : "s"} for "${query}":\n\n${cards}`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Search failed: ${msg}` }],
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
    id: z.string().describe("The Thinklet ID"),
  },
  async ({ id }) => {
    try {
      const meta = await getThinklet(id);

      return {
        content: [
          { type: "text", text: summaryText(meta) },
          embedBlock(meta),
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `❌ Failed to fetch Thinklet: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Prompt: build-thinklet ────────────────────────────────────────────────

server.prompt(
  "build-thinklet",
  "Load the Thinklet builder skill. Always invoke this before writing any Thinklet code — it tells you the exact architecture, TQL API, hooks, and rules required for code that deploys correctly on first try.",
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
            "Now that you have the Thinklet skill loaded:",
            "1. First call `discover_thinklets` to check if something already exists",
            "2. If not, generate the Thinklet code following the skill exactly",
            "3. Call `publish_thinklet` with the code, title, and description",
            "4. The Thinklet will render inline in this conversation via MCP Apps",
          ].join("\n"),
        },
      },
    ],
  })
);

// ─── Start ─────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
