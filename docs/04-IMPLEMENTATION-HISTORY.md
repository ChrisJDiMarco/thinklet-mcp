# Implementation History — What We Built, What We Tried, What We Learned

## Timeline of Changes

### Session 1: MCP Apps Integration (initial build)

**Goal:** Make thinklets render inline inside Claude Desktop's chat, not just return text.

**What existed before:**
- `thinklet-mcp` was a standard MCP server using `server.tool()` for all tools
- Tools returned text-only results (metadata, URLs)
- No inline rendering — user had to click the URL to see the thinklet

**What we added:**

#### New dependencies
```
@modelcontextprotocol/ext-apps  — MCP Apps SDK (server + client)
@modelcontextprotocol/sdk       — upgraded to ^1.29.0
vite + vite-plugin-singlefile   — bundles viewer into single HTML
cross-env                       — cross-platform env vars in scripts
```

#### New files created
| File | Purpose |
|------|---------|
| `viewer.html` | HTML template for the MCP App viewer |
| `src/viewer.ts` | Client-side logic (runs in Claude's sandbox) |
| `vite.config.ts` | Vite config for single-file HTML bundling |
| `tsconfig.viewer.json` | Separate TS config for browser-target viewer code |

#### Files modified
| File | Changes |
|------|---------|
| `src/index.ts` | Added `registerAppResource` for viewer HTML, converted `save_thinklet`/`get_thinklet`/`fix_thinklet`/`publish_thinklet` from `server.tool()` to `registerAppTool()`, added `_meta.ui.resourceUri` to each, renamed `buildToolContent` to `buildToolResult` with `structuredContent` support, added viewer HTML loading from `dist/` |
| `tsconfig.json` | Added `src/viewer.ts` to exclude array (server build shouldn't compile DOM code) |
| `package.json` | Added deps, added `build:ui` and `build:server` scripts, updated `build` to run both |

#### Key architectural decisions
1. **Two TypeScript configs** — server (`tsconfig.json`, target Node.js/ES2022) and viewer (`tsconfig.viewer.json`, target ESNext/DOM). Server excludes `src/viewer.ts`, viewer only includes it.
2. **Single-file HTML** — Vite + `vite-plugin-singlefile` inlines all JS/CSS into one HTML file. The MCP server reads this file and serves it as a `text` resource. No external file serving needed.
3. **`registerAppTool()` vs `server.tool()`** — Only tools that should trigger the viewer use `registerAppTool()`. Discovery and integration tools stay as `server.tool()` because they don't need inline UI.

---

### Debugging Session: White Screen & Localhost Discovery

#### Issue 1: White screen (collapsed height)
**Symptom:** After calling `get_thinklet`, a thin dark bar appeared with no content.
**Cause:** The iframe had no explicit height in the viewer HTML.
**Fix:** Added `min-height: 480px` to `html`, `body`, and the `#frame` iframe.

#### Issue 2: Invalid UUID
**Symptom:** Backend returned 500 error — "invalid UUID ... length must be between 32..36 characters, got 37"
**Cause:** Claude (the LLM) inserted a space into the middle of the UUID when generating the `get_thinklet` tool call. The UUID `b5a0d293-3e4e-4ffd-82cb-80d2f44568cc` became `b5a0d293-3e4e-4ffd-82cb-80d2f445 68cc`.
**Fix:** Not a code bug — instructed to paste the UUID cleanly when prompting Claude. No code change needed.

#### Issue 3: White screen (iframe can't load localhost)
**Symptom:** No backend errors, tool result was correct, but the viewer showed a white screen. Claude even said "It looks like the Thinklet is running on localhost:3001, which means it's only accessible from your local machine."
**Root cause:** Claude Desktop's sandbox iframe **cannot reach `localhost:3001`**. The embed URL (`http://localhost:3001/embed/mcp?token=...`) was unreachable from within the sandbox.
**This was the fundamental discovery** — the sandbox is isolated from local network.

#### What we tried to fix it:

1. **Debug logging in viewer.ts** — Added `dbg()` messages at each stage (creating app, connecting, receiving result, loading iframe). Confirmed the MCP Apps handshake worked and the embed URL was received correctly. The iframe just couldn't load the URL.

2. **Testing with public URL** — Changed the embed URL to `https://content.thinklet.io/embed/publication?id=...` (a known public thinklet). This rendered the MCP App viewer successfully with a green "MCP app works" box, proving the MCP Apps integration itself was working.

3. **ngrok tunnel** — Set up ngrok to tunnel `localhost:3001` to a public HTTPS URL. Updated `THINKLET_CONTENT_URL` to the ngrok URL. Problem: the content-app's internal API calls to `localhost:1337` (backend) would still fail from Claude's sandbox for nested requests.

4. **Reverted to localhost** — Undid the ngrok/production URL changes per user request.

#### Conclusion from debugging
The MCP Apps integration (handshake, resource serving, tool result passing) works correctly. The issue is exclusively about the iframe needing to reach a URL that the sandbox can access. Production URLs work. Localhost doesn't.

---

### Session 2: Direct React Renderer

**Goal:** Bypass the iframe entirely. Render thinklet code directly in the viewer HTML using bundled React.

#### New dependencies added
```
react + react-dom       — React rendering engine
sucrase                 — JSX → React.createElement transform (same as content-app uses)
@twind/core             — Tailwind CSS runtime (generates CSS from class names at runtime)
@twind/preset-tailwind  — Tailwind preset for twind
@types/react            — TypeScript types (dev)
@types/react-dom        — TypeScript types (dev)
```

#### Changes to `viewer.html`
- Added `<div id="root">` for React rendering target
- Kept `<iframe id="frame">` as fallback
- Changed `overflow: hidden` to `overflow: auto` on body

#### Changes to `src/viewer.ts` (complete rewrite)
- Added React, ReactDOM, sucrase, twind imports
- Added `cleanImports()` — strips import/export statements from thinklet code
- Added `renderThinklet(code)` — the core rendering function:
  1. Clean imports
  2. Wrap code with React hooks destructuring
  3. Transform JSX with sucrase
  4. Eval the factory function
  5. Render with React.createRoot
- Added twind setup (`install` + `observe`) for runtime Tailwind CSS
- Kept `showEmbed()` as iframe fallback
- Rendering priority: `code` → direct render, `embedUrl` → iframe, neither → error

#### Changes to `src/index.ts`
- `buildToolResult()` now accepts optional `code` parameter
- `structuredContent` now includes both `embedUrl` AND `code` fields
- `save_thinklet` — passes the input `code` to `buildToolResult`
- `get_thinklet` — always fetches thinklet code (parallel with embed URL fetch), passes to result
- `fix_thinklet` — passes the input `code` to `buildToolResult`
- `publish_thinklet` — fetches code (parallel with embed URL), passes to result

#### Build output
- `dist/viewer.html` — 544KB (151KB gzipped)
  - React + ReactDOM: ~130KB
  - Sucrase: ~80KB
  - @twind/core + preset: ~13KB
  - @modelcontextprotocol/ext-apps: ~30KB
  - Viewer logic: ~5KB

---

## Auth Flow — How Private Thinklets Work in Claude

```
User: "render thinklet abc123" (private thinklet)
  │
Claude calls: get_thinklet({ id: "abc123" })
  │
MCP Server (on user's machine):
  │
  ├─ GET /mcp/thinklets/abc123
  │  Headers: Authorization: Bearer thk_98VT...
  │  → Returns thinklet metadata (title, description, visibility, etc.)
  │
  ├─ GET /mcp/thinklets/abc123/code
  │  Headers: Authorization: Bearer thk_98VT...
  │  → Returns raw React source code
  │
  ├─ GET /mcp/thinklets/abc123/access
  │  Headers: Authorization: Bearer thk_98VT...
  │  → Returns { contentApiToken: "jwt...", signedUrl: "..." }
  │
  └─ Returns to Claude:
     content: [{ type: "text", text: "..." }]
     structuredContent: {
       code: "const Component = () => { ... }",     // For direct rendering
       embedUrl: "https://content.../embed/mcp?token=jwt..."  // For iframe
     }
```

**Key points:**
- All auth happens **server-side** in the MCP server process
- The API key (`THINKLET_API_KEY`) authenticates every request to the backend
- The JWT (`contentApiToken`) is only needed for the iframe embed URL
- For direct rendering, no JWT is needed — the code is already fetched server-side
- Private thinklets are accessible because the MCP server has the user's API key

---

## What Is NOT Affected

### Platform embeds (thinklet.io website)
The content-app's `/embed/publication` and `/embed/mcp` pages are completely unchanged. The MCP server doesn't modify the content-app at all. Users embedding thinklets on other websites via the embed code continue to work exactly as before.

### Public sharing
When a thinklet is published (`publish_thinklet`), it gets indexed in the catalog and gets a public feed URL. The public embed code (without auth) is unaffected. Anyone can embed a public thinklet using the standard embed code:

```html
<iframe src="https://content.thinklet.io/embed/publication?id=..." ...></iframe>
```

### The MCP build flow
All tools (`discover_thinklets`, `confirm_integrations`, `save_thinklet`, etc.) work exactly the same. The only addition is that tool results now include `structuredContent` with `code` and `embedUrl` fields for the viewer.

### Thinklet code (JSX)
The thinklet's React component code is not modified in any way. The same code runs in both the content-app (full experience) and the MCP viewer (preview). The MCP viewer just has fewer libraries available.

---

## Current State of Things

### What works right now
1. **MCP server** — all tools, prompts, integrations, build flow enforcement
2. **MCP Apps handshake** — viewer connects to Claude, receives tool results
3. **Direct rendering** — basic React + Tailwind thinklets render inline
4. **Iframe rendering** — works with production `content.thinklet.io` URL
5. **Auth** — private thinklets are accessible via API key (server-side)

### What doesn't work locally
1. **Iframe to localhost** — Claude's sandbox can't reach `localhost:3001`
2. **External libraries in direct renderer** — lucide-react, framer-motion, recharts, shadcn/ui are not available in the bundled viewer

### What's planned (CDN renderer)
1. Load npm libraries from `esm.sh` at runtime
2. Build shadcn/ui stubs for common components
3. Build no-op stubs for platform features (useAIStreaming, TQL, aiApi)
4. ~85-90% of thinklets would render correctly

### Quickest path to full rendering
Set `THINKLET_CONTENT_URL=https://content.thinklet.io` in `.env` → iframe approach with 100% component support. Only requires the content-app to be deployed (which it already is).

---

## Decisions & Trade-offs

| Decision | Why |
|----------|-----|
| Single-file HTML for viewer | MCP Apps serves HTML as text via the protocol. No file server needed. One file = simple. |
| Two TS configs | Server targets Node.js (no DOM), viewer targets browser (no Node APIs). Can't mix. |
| twind over Tailwind CDN | CDN script would need `resourceDomains` CSP + network request. twind bundles locally, zero network. |
| sucrase over Babel | Same as content-app. Smaller, faster, production-ready JSX transform. |
| Keep iframe as fallback | Direct renderer has limited library support. Iframe to production gives 100%. Both paths coexist. |
| Always fetch code in tool results | Even when iframe is the primary renderer, having code in structuredContent lets the direct renderer work. Small overhead (~5-50KB extra in tool result). |
| registerAppTool only for rendering tools | Discovery/integration tools don't need inline UI. Keeps them lightweight. |
