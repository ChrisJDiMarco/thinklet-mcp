# MCP Apps — Inline Rendering in Claude

## What is MCP Apps?

MCP Apps is an **extension to the Model Context Protocol** (spec: `io.modelcontextprotocol/ui`) that allows MCP servers to display interactive HTML UIs directly inside the AI chat interface. Instead of just returning text, tools can render rich, interactive content inline.

The SDK: `@modelcontextprotocol/ext-apps` (currently v1.6.0)

---

## How It Works (end-to-end flow)

```
1. User asks Claude to render a thinklet
   │
2. Claude calls `get_thinklet` tool (registered with resourceUri)
   │
3. MCP server:
   │  a) Fetches thinklet metadata from backend (server-side, via API key)
   │  b) Fetches thinklet source code from backend
   │  c) Fetches JWT embed URL from backend
   │  d) Returns tool result with structuredContent: { code, embedUrl }
   │
4. Claude receives tool result
   │  a) Sees _meta.ui.resourceUri → knows to show the MCP App viewer
   │  b) Fetches the UI resource (viewer.html) from the MCP server
   │  c) Creates a sandboxed iframe with the viewer HTML
   │  d) Establishes postMessage bridge with the viewer
   │
5. Viewer (inside Claude's sandbox):
   │  a) Connects to Claude via App.connect() (MCP Apps handshake)
   │  b) Receives tool result via ontoolresult callback
   │  c) Extracts code/embedUrl from structuredContent
   │  d) Renders thinklet directly or via iframe
   │
6. User sees the interactive thinklet inline in the chat
```

---

## Three Key Components

### 1. UI Resource Registration (server-side)

The MCP server registers an HTML resource that Claude can load:

```typescript
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

const VIEWER_RESOURCE_URI = "ui://thinklet/viewer";

registerAppResource(
  server,                    // McpServer instance
  "Thinklet Viewer",        // Display name
  VIEWER_RESOURCE_URI,      // URI identifier
  {},                        // Template variables (none)
  async () => ({
    contents: [{
      uri: VIEWER_RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,  // "text/html;profile=mcp-app"
      text: viewerHtml,              // The entire HTML string (~544KB)
      _meta: {
        ui: {
          csp: {
            frameDomains: [contentOrigin],    // Allowed iframe origins
            connectDomains: [contentOrigin],  // Allowed fetch origins
          }
        }
      }
    }]
  })
);
```

### 2. App Tool Registration (server-side)

Tools that should trigger the viewer use `registerAppTool()` instead of `server.tool()`:

```typescript
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";

registerAppTool(server, "get_thinklet", {
  description: "Fetch and render a thinklet inline",
  inputSchema: { id: z.string() },
  _meta: { ui: { resourceUri: VIEWER_RESOURCE_URI } }  // ← links tool to viewer
}, async ({ id }) => {
  // ... fetch thinklet ...
  return {
    content: [{ type: "text", text: "..." }],
    structuredContent: { code: "...", embedUrl: "..." }
  };
});
```

The `_meta.ui.resourceUri` tells Claude: "after this tool runs, show the viewer and send it the tool result."

### 3. Viewer (client-side, runs in Claude's sandbox)

The viewer HTML is loaded by Claude into a sandboxed iframe. It:

1. Creates an `App` instance from `@modelcontextprotocol/ext-apps`
2. Registers event handlers
3. Calls `app.connect()` to complete the handshake with Claude
4. Receives tool results and renders content

```typescript
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "Thinklet Viewer", version: "0.5.0" });

app.ontoolresult = (result) => {
  // result.structuredContent.code → direct render
  // result.structuredContent.embedUrl → iframe fallback
};

app.onhostcontextchanged = (ctx) => {
  // Apply Claude's theme (light/dark), styles, safe area insets
};

app.connect(); // Initiate handshake
```

---

## Content Security Policy (CSP)

The MCP Apps sandbox is restrictive by default. Servers must declare what external resources the viewer needs:

```typescript
csp: {
  connectDomains: string[];    // For fetch/XHR/WebSocket (maps to connect-src)
  resourceDomains: string[];   // For scripts/styles/images/fonts (maps to script-src, style-src, etc.)
  frameDomains: string[];      // For nested iframes (maps to frame-src)
  baseUriDomains: string[];    // For base URI (maps to base-uri)
}
```

**Current configuration:**
- `frameDomains: [contentOrigin]` — allows iframing the content-app
- `connectDomains: [contentOrigin]` — allows fetch to content-app

**For CDN rendering (future):**
- `resourceDomains: ["https://esm.sh", "https://cdn.esm.sh"]` — would allow loading npm packages from CDN

---

## Two Rendering Strategies

### Strategy A: Direct React Rendering (current primary)

The MCP server sends the thinklet's raw React code in `structuredContent.code`. The viewer renders it directly using bundled dependencies:

```
structuredContent.code → cleanImports → sucrase JSX transform → eval → React.render
```

**Bundled in viewer.html (via Vite singlefile):**
- React + ReactDOM (~130KB)
- Sucrase (~80KB) — JSX → React.createElement transform
- @twind/core + preset-tailwind (~13KB) — Tailwind CSS runtime
- @modelcontextprotocol/ext-apps (~30KB) — MCP Apps SDK

**Total: ~544KB / 151KB gzipped**

**Supports:**
- All React hooks (useState, useEffect, useRef, useMemo, useCallback, etc.)
- Tailwind CSS classes (generated at runtime by twind)
- Basic HTML/SVG elements

**Does NOT support:**
- lucide-react icons
- framer-motion animations
- recharts charts
- shadcn/ui components (Button, Card, Input, etc.)
- Platform hooks (useAIStreaming, TQL, useFileImport)

**Why it exists:** Works locally. No network requests from the sandbox. The thinklet code travels entirely through the MCP protocol (server → Claude → viewer).

### Strategy B: Iframe to Content App (fallback)

The MCP server sends an embed URL in `structuredContent.embedUrl`. The viewer loads it in an iframe:

```
structuredContent.embedUrl → iframe.src = "https://content.thinklet.io/embed/mcp?token=..."
```

**Supports:** Everything. Full component library, all integrations, all styling.

**Limitation:** Requires the content-app to be reachable from Claude's sandbox. `localhost:3001` does NOT work — Claude's sandbox cannot reach local services. Only works with production URL (`content.thinklet.io`).

### Rendering Decision Flow

```
ontoolresult received
  │
  ├─ structuredContent.code exists?
  │   YES → Direct render (Strategy A)
  │   NO  ↓
  │
  ├─ structuredContent.embedUrl exists?
  │   YES → Iframe render (Strategy B)
  │   NO  ↓
  │
  └─ Show error: "Could not load thinklet preview"
```

---

## The Localhost Problem

Claude Desktop's MCP App viewer runs in a **sandboxed iframe**. This sandbox:
- Has no same-origin server
- Cannot access `localhost` or `127.0.0.1`
- Cannot access private IPs (192.168.x.x, 10.x.x.x)
- CAN access public HTTPS URLs declared in the CSP

This means:
- **MCP server** (Node.js on user's machine) → CAN reach localhost:1337 (backend)
- **Viewer** (sandboxed iframe in Claude) → CANNOT reach localhost:3001 (content-app)

**Implications:**
- Iframe to `localhost:3001/embed/mcp?token=...` → white screen (unreachable)
- Iframe to `https://content.thinklet.io/embed/mcp?token=...` → works perfectly
- Direct rendering from `structuredContent.code` → works (no network request)

---

## MCP Apps Protocol Messages

The viewer and Claude communicate via postMessage. Key messages:

| Direction | Message | Purpose |
|-----------|---------|---------|
| View → Host | `ui/initialize` | Handshake — declares app info + capabilities |
| Host → View | Initialize result | Returns host info + capabilities + context |
| View → Host | `ui/notifications/initialized` | Confirms handshake complete |
| Host → View | `ui/notifications/tool-result` | Tool execution result (code, embedUrl, text) |
| Host → View | `ui/notifications/tool-input` | Tool arguments (before execution) |
| Host → View | `ui/notifications/host-context-changed` | Theme, styles, dimensions changes |
| View → Host | `ui/notifications/size-changed` | Report viewer size to host |
| View → Host | `ui/open-link` | Request to open URL in browser |

---

## Theming

Claude sends theme information via `onhostcontextchanged`:

```typescript
app.onhostcontextchanged = (ctx) => {
  ctx.theme         // "light" | "dark"
  ctx.styles        // { variables: { "--color-background-primary": "#fff", ... } }
  ctx.safeAreaInsets // { top, right, bottom, left } in pixels
  ctx.displayMode   // "inline" | "fullscreen" | "pip"
  ctx.platform      // "web" | "desktop" | "mobile"
};
```

The viewer applies these using SDK helpers:
- `applyDocumentTheme(ctx.theme)` — sets data-theme attribute
- `applyHostStyleVariables(ctx.styles.variables)` — injects CSS variables

---

## Testing Locally

**For direct rendering:** Works out of the box. The thinklet code flows through MCP protocol, no network needed. But only supports basic React + Tailwind.

**For iframe rendering:** Set `THINKLET_CONTENT_URL=https://content.thinklet.io` in `.env` to use the production content-app. Full component support.

**Restart Claude Desktop** after any changes (Cmd+Q → reopen). Rebuild with `npm run build` first.

---

## Known Limitations

1. **Viewer size:** The single-file HTML is ~544KB. This is transferred as text through the MCP protocol on every tool invocation. Not a problem in practice but worth noting.

2. **No hot reload:** Changes require `npm run build` + restart Claude Desktop.

3. **Sandbox restrictions:** No access to localStorage, no cookies, limited APIs. The viewer is essentially a clean room.

4. **twind compatibility:** The twind Tailwind runtime supports most Tailwind v2/v3 classes but may not handle all Tailwind v3+ features (arbitrary values, container queries, etc.).
