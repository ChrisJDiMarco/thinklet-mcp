# thinklet-mcp

MCP server for [Thinklet](https://thinklet.io) — create, publish, and discover browser-native AI-powered micro-tools directly from Claude.

Install this and Claude can:
- Generate production-correct Thinklet code (using the built-in skill)
- Search existing Thinklets before building new ones
- Publish to Thinklet.io with one tool call
- Render the Thinklet **inline in the Claude conversation** via MCP Apps

---

## How it works

```
User: "build me a habit tracker"
  → Claude loads build-thinklet prompt (skill injected)
  → Claude calls discover_thinklets("habit tracker") — checks catalog first
  → Nothing found → Claude generates the React component
  → Claude calls publish_thinklet(code, title, description)
  → MCP server posts to Thinklet API → gets live URL
  → Thinklet renders inline in Claude Desktop via MCP Apps embed
```

---

## Install

### 1. Clone and build

```bash
git clone https://github.com/ChrisJDiMarco/thinklet-mcp
cd thinklet-mcp
npm install
npm run build
```

### 2. Set environment variables

```bash
cp .env.example .env
# Fill in your THINKLET_API_URL and THINKLET_API_KEY
```

### 3. Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "thinklet": {
      "command": "node",
      "args": ["/absolute/path/to/thinklet-mcp/dist/index.js"],
      "env": {
        "THINKLET_API_URL": "https://api.thinklet.io",
        "THINKLET_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see the Thinklet tools appear in the toolbar.

### 4. Or run via npx (once published to npm)

```json
{
  "mcpServers": {
    "thinklet": {
      "command": "npx",
      "args": ["-y", "thinklet-mcp"],
      "env": {
        "THINKLET_API_URL": "https://api.thinklet.io",
        "THINKLET_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

---

## Tools

### `publish_thinklet`
Publish generated Thinklet code to the platform. Returns a live URL and renders the Thinklet inline.

| Param | Type | Description |
|-------|------|-------------|
| `code` | string | Complete React component source |
| `title` | string | Short display title |
| `description` | string | One-sentence description |
| `tags` | string[] | Optional discovery tags |

### `discover_thinklets`
Search the Thinklet catalog by intent. **Claude calls this automatically before building anything new.**

| Param | Type | Description |
|-------|------|-------------|
| `query` | string | Natural language — "habit tracker with streaks" |
| `limit` | number | Max results (default 5) |

### `get_thinklet`
Fetch and render a specific Thinklet by ID.

| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Thinklet ID |

---

## Prompt

### `build-thinklet`
Invoke this prompt in Claude to load the full Thinklet builder skill before writing code. It teaches Claude the exact props contract, TQL persistence API, custom hooks, icon rules, and serialization requirements. Code written without this prompt will have errors. Code written with it deploys correctly on the first try.

---

## Backend integration (for Fouzaan)

The `api/` folder contains FastAPI routes to drop into the Thinklet backend:

```
api/
├── models.py   # Pydantic request/response models
└── router.py   # FastAPI router with 3 endpoints
```

Wire it into your existing FastAPI app:

```python
from api.router import router as thinklets_router
app.include_router(thinklets_router, prefix="/api/v1")
```

Endpoints:
- `POST /api/v1/thinklets` — publish a new Thinklet
- `GET  /api/v1/thinklets/search?q=...` — semantic search
- `GET  /api/v1/thinklets/{id}` — get single Thinklet

The router has clear `TODO` comments showing exactly where to plug in the DB calls. Recommend Supabase + pgvector for the semantic search.

---

## The bigger picture

This MCP server is the integration layer that makes Thinklet an **agent-native platform**:

- Any Claude user installs this → can create Thinklets from natural language
- Every Thinklet published gets indexed for discovery
- Agents search the catalog before building — inventory compounds automatically
- MCP Apps renders Thinklets inline — no separate app needed

The primitive: **AI creates a working tool → it lives at a URL → other agents find and surface it.**

---

Built by [Logic Out Loud LLC](https://logicoutloud.io) · Powered by Claude · For [Thinklet.io](https://thinklet.io)
