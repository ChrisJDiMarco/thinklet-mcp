#!/usr/bin/env node
/**
 * Thinklet MCP Server v0.6.0
 *
 * Transport modes:
 *   stdio (default)  — local dev only; sub passed via THINKLET_USER_SUB env var
 *   http             — remote server; Cognito JWT in Authorization header per request
 *                      Enable with MCP_TRANSPORT=http or by setting PORT
 *
 * Auth (HTTP mode):
 *   - Validates Cognito access tokens using JWKS (cached by `jose`)
 *   - Validates: signature, issuer, aud === MCP_SERVER_URL, token_use === "access",
 *                client_id === COGNITO_CLIENT_ID, scope includes MCP_REQUIRED_SCOPE, sub
 *   - Rejects ID tokens (token_use !== "access")
 *   - Backend calls use a shared service credential (MCP_SERVICE_KEY) + the user's
 *     Cognito sub in X-Thinklet-User-Sub. The user JWT is NEVER forwarded —
 *     spec prohibits token passthrough to upstream APIs.
 *
 * Spec endpoints:
 *   GET /.well-known/oauth-protected-resource — RFC 9728 PRM document
 *   POST /mcp                                 — MCP requests; 401 with WWW-Authenticate
 *                                               on missing/invalid token, 403 with
 *                                               insufficient_scope on missing scope
 *
 * Tools:
 *   discover_thinklets    — search catalog + auto-detect integrations (MANDATORY first step)
 *   confirm_integrations  — confirm user's integration choices + load docs (MANDATORY second step)
 *   list_integrations     — browse integrations catalog (optional, outside build flow)
 *   save_thinklet         — generate + save a thinklet (requires both discover + confirm)
 *   get_thinklet          — fetch a single thinklet by ID + render inline
 *   fix_thinklet          — patch code on an existing thinklet
 *   publish_thinklet      — toggle between public and private
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ApiClient } from "./api.js";
import { createMcpServer } from "./factory.js";

const isHttpMode =
  process.env.MCP_TRANSPORT === "http" || Boolean(process.env.PORT);

if (isHttpMode) {
  startHttpServer();
} else {
  await startStdioServer();
}

// ─── Stdio mode (local dev only) ──────────────────────────────────────────────

async function startStdioServer() {
  const userSub = process.env.THINKLET_USER_SUB ?? "";
  if (!userSub) {
    process.stderr.write(
      [
        "[thinklet-mcp] ⚠️  THINKLET_USER_SUB is not set.",
        "Stdio mode is local-dev only. Set THINKLET_USER_SUB to a Cognito user sub",
        "and MCP_SERVICE_KEY to the shared service credential.",
        "Production usage goes through HTTP transport with OAuth.",
        "",
      ].join("\n")
    );
  }
  const api = new ApiClient(userSub);
  const server = createMcpServer(api);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ─── HTTP mode config (Cognito + MCP) ─────────────────────────────────────────

const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? "";
const COGNITO_REGION = process.env.COGNITO_REGION ?? "us-east-1";
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? "";
const MCP_SERVER_URL =
  process.env.MCP_SERVER_URL ?? "https://mcp.thinklet.io";
const MCP_REQUIRED_SCOPE =
  process.env.MCP_REQUIRED_SCOPE ?? `${MCP_SERVER_URL}/mcp`;

const COGNITO_ISSUER = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;

// Module-level so jose caches and reuses the remote JWKS across requests.
const JWKS = COGNITO_USER_POOL_ID
  ? createRemoteJWKSet(new URL(`${COGNITO_ISSUER}/.well-known/jwks.json`))
  : null;

const PROTECTED_RESOURCE_URL = `${MCP_SERVER_URL}/.well-known/oauth-protected-resource`;

const PROTECTED_RESOURCE_METADATA = {
  resource: MCP_SERVER_URL,
  authorization_servers: [COGNITO_ISSUER],
  scopes_supported: [MCP_REQUIRED_SCOPE],
  bearer_methods_supported: ["header"],
};

// ─── JWT validation ───────────────────────────────────────────────────────────

async function validateJwt(
  req: IncomingMessage
): Promise<{ sub: string; payload: JWTPayload }> {
  if (!JWKS) throw new Error("cognito_not_configured");
  const auth = (req.headers["authorization"] as string) ?? "";
  if (!auth.startsWith("Bearer ")) throw new Error("missing_token");
  const token = auth.slice(7).trim();
  if (!token) throw new Error("missing_token");

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: COGNITO_ISSUER,
    audience: MCP_SERVER_URL,
  });

  if (payload.token_use !== "access") throw new Error("wrong_token_use");
  if (payload.client_id !== COGNITO_CLIENT_ID) throw new Error("wrong_client");

  const scopeStr = typeof payload.scope === "string" ? payload.scope : "";
  const scopes = scopeStr.split(" ").filter(Boolean);
  if (!scopes.includes(MCP_REQUIRED_SCOPE)) throw new Error("missing_scope");

  if (!payload.sub) throw new Error("missing_sub");
  return { sub: payload.sub, payload };
}

function authChallengeHeader(error?: string): string {
  const params: string[] = [];
  if (error) params.push(`error="${error}"`);
  params.push(`resource_metadata="${PROTECTED_RESOURCE_URL}"`);
  params.push(`scope="${MCP_REQUIRED_SCOPE}"`);
  return `Bearer ${params.join(", ")}`;
}

function send401(res: ServerResponse, error?: string) {
  res.setHeader("WWW-Authenticate", authChallengeHeader(error));
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: error ?? "unauthorized" }));
}

function send403(res: ServerResponse, error: string) {
  res.setHeader("WWW-Authenticate", authChallengeHeader(error));
  res.writeHead(403, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error }));
}

// ─── HTTP mode ────────────────────────────────────────────────────────────────

interface Session {
  transport: StreamableHTTPServerTransport;
  sub: string;
}

function startHttpServer() {
  const sessions = new Map<string, Session>();

  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
  };

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
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

    if (pathname === "/.well-known/oauth-protected-resource") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(PROTECTED_RESOURCE_METADATA));
      return;
    }

    if (pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found — use POST /mcp");
      return;
    }

    // ─── /mcp — JWT required on every request (new + resumed sessions) ───────
    let auth: { sub: string; payload: JWTPayload };
    try {
      auth = await validateJwt(req);
    } catch (err) {
      const code = err instanceof Error ? err.message : "invalid_token";
      if (code === "missing_scope") {
        return send403(res, "insufficient_scope");
      }
      process.stderr.write(`[thinklet-mcp] auth rejected: ${code}\n`);
      return send401(res, "invalid_token");
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Resume existing session
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (session) {
        if (session.sub !== auth.sub) {
          // Session was created for a different user; reject rather than leak data
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "session_user_mismatch" }));
          return;
        }
        await session.transport.handleRequest(req, res);
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found", sessionId }));
      return;
    }

    // New session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    const api = new ApiClient(auth.sub);
    const mcpServer = createMcpServer(api);

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);

    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, sub: auth.sub });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      process.stderr.write(
        `[thinklet-mcp] session created: ${transport.sessionId} sub=${auth.sub}\n`
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
    if (!COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID) {
      process.stderr.write(
        "[thinklet-mcp] ⚠️  COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID not set — JWT validation will fail.\n"
      );
    }
    if (!process.env.MCP_SERVICE_KEY) {
      process.stderr.write(
        "[thinklet-mcp] ⚠️  MCP_SERVICE_KEY not set — backend calls will be rejected.\n"
      );
    }
  });
}
