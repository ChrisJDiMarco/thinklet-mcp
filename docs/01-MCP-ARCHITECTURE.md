  content: [{ type: "text", text: "..." }],     // Visible to LLM
  structuredContent: {                            // Passed to MCP App Viewer
    embedUrl: "https://content.../embed/mcp?token=...",
    code: "const Component = () => { ... }"       // Raw React code
  }
}
```
- `content` — the LLM reads this and includes it in its response to the user.
- `structuredContent` — the MCP App Viewer receives this and decides how to render:
  - Has `code`? → Direct React rendering (works locally)
  - Has `embedUrl`? → Iframe to content-app (works in production)
  - Neither? → Show error
---
## Running
```bash
# Development
npm run dev       # tsx src/index.ts (hot-reload via tsx)
# Production
npm run build     # build:ui + build:server
npm start         # node dist/index.js
```
Claude Desktop connects via the MCP config in `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "thinklet": {
      "command": "node",
      "args": ["/path/to/thinklet-mcp/dist/index.js"],
      "env": {
        "THINKLET_API_URL": "...",
        "THINKLET_API_KEY": "...",
        "THINKLET_CONTENT_URL": "...",
        "THINKLET_APP_URL": "..."
      }
    }
  }
}
```
