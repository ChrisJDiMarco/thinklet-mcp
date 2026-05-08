#!/usr/bin/env node
/**
 * Thinklet MCP Server v0.5.0
 *
 * Transport modes:
 *   stdio (default)  — local npm install; API key via THINKLET_API_KEY env var
 *   http             — remote server; API key per-request from Authorization header
 *                      Enable with MCP_TRANSPORT=http or by setting PORT
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
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { ApiClient } from "./api.js";
import { createMcpServer } from "./factory.js";

const isHttpMode =
  process.env.MCP_TRANSPORT === "http" || Boolean(process.env.PORT);

if (isHttpMode) {
  startHttpServer();
} else {
  await startStdioServer();
}

// ─── Stdio mode ───────────────────────────────────────────────────────────────

async function startStdioServer() {
  const apiKey = process.env.THINKLET_API_KEY ?? "";
  if (!apiKey) {
    process.stderr.write(
      [
        "[thinklet-mcp] ⚠️  THINKLET_API_KEY is not set.",
        "Get your API key at https://app.thinklet.io → Settings → MCP Keys",
        "then add it to your connector config as THINKLET_API_KEY.",
        "",
      ].join("\n")
    );
  }
  const api = new ApiClient(apiKey);
  const server = createMcpServer(api);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ─── HTTP mode ────────────────────────────────────────────────────────────────

interface Session {
  transport: StreamableHTTPServerTransport;
}

function startHttpServer() {
  const sessions = new Map<string, Session>();

  function extractApiKey(req: IncomingMessage): string {
    const auth = (req.headers["authorization"] as string) ?? "";
    if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
    return (req.headers["x-api-key"] as string) ?? "";
  }

  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Api-Key, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
  };

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "thinklet-mcp" }));
      return;
    }

    if (pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found — use POST /mcp");
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Resume existing session
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (session) {
        await session.transport.handleRequest(req, res);
        return;
      }
      // Unknown session ID — reject cleanly
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found", sessionId }));
      return;
    }

    // New session
    const apiKey = extractApiKey(req);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    const api = new ApiClient(apiKey);
    const mcpServer = createMcpServer(api);

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);

    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      process.stderr.write(
        `[thinklet-mcp] session created: ${transport.sessionId}\n`
      );
    }
  });

  httpServer.on("error", (err) => {
    process.stderr.write(`[thinklet-mcp] HTTP server error: ${err.message}\n`);
    process.exit(1);
  });

  const PORT = Number(process.env.PORT ?? 3000);
  httpServer.listen(PORT, "0.0.0.0", () => {
    process.stderr.write(
      `[thinklet-mcp] HTTP server listening on port ${PORT}\n`
    );
  });
}
