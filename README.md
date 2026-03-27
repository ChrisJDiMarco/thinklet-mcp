# thinklet-mcp

> The MCP server that turns any AI into an on-demand app builder.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/Protocol-MCP-blue)](https://modelcontextprotocol.io)
[![Platform](https://img.shields.io/badge/Platform-Thinklet.io-blue)](https://thinklet.io)
[![Works with Claude](https://img.shields.io/badge/Works%20with-Claude-orange)](https://claude.ai)
[![Works with Copilot](https://img.shields.io/badge/Works%20with-Copilot-blue)](https://copilot.microsoft.com)

`thinklet-mcp` gives Claude, Copilot, or any MCP-compatible AI three new abilities: **search** a shared catalog of AI-built interactive apps, **remix** the best match for a new context, and **publish** brand new apps in seconds.

**The loop:**

```
User asks for a tool
    ↓
AI searches the Thinklet catalog  →  Found a match?  →  Remix it (seconds)
    ↓ nothing matches                                         ↓
AI builds a new Thinklet                             Rendered inline via MCP Apps
    ↓
Published to the catalog
    ↓
Next person who asks finds it instantly
```

Every Thinklet built makes the catalog smarter.

---

## What is a Thinklet?

A Thinklet is a **browser-native interactive app** — a dashboard, tracker, calculator, form, or any UI — that runs without a backend, gets a real shareable URL, and renders directly inside AI conversations via [MCP Apps](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/).

---

## Install

### Option A — npx (no install needed)

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "thinklet": {
      "command": "npx",
      "args": ["-y", "thinklet-mcp"],
      "env": {
        "THINKLET_API_URL": "https://api.thinklet.io",
        "THINKLET_API_KEY": "your-api-key",
        "THINKLET_BASE_URL": "https://thinklet.io"
      }
    }
  }
}
```

### Option B — From source

```bash
git clone https://github.com/ChrisJDiMarco/thinklet-mcp
cd thinklet-mcp
npm install --include=dev
npm run build
```

Then add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "thinklet": {
      "command": "node",
      "args": ["/absolute/path/to/thinklet-mcp/dist/index.js"],
      "env": {
        "THINKLET_API_URL": "https://api.thinklet.io",
        "THINKLET_API_KEY": "your-api-key",
        "THINKLET_BASE_URL": "https://thinklet.io"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see the Thinklet tools listed in the tools panel.

---

## Tools

### `discover_thinklets`

Search the catalog by natural language intent. **Always call this before building** — an existing Thinklet might already solve the need, saving time and enriching the catalog.

```
Input:  "habit tracker with streaks and heatmap"
Output: 3 matching Thinklets with titles, descriptions, URLs, and match context
```

### `publish_thinklet`

Publish a generated Thinklet to the platform. Returns a live URL and an inline embed that renders the app directly in the conversation window via MCP Apps.

**Visibility options:**
| Option | Behavior |
|---|---|
| `public` | Indexed in the catalog — any AI can discover and remix it |
| `unlisted` | Real URL, accessible by link, not searchable |
| `private` | Only accessible to you (requires account) |

Claude will ask which you want before publishing. You're always in control.

### `remix_thinklet`

Take an existing Thinklet and adapt it for a new context. Provide the original Thinklet ID and a description of what should change — the remix is built, published, and linked back to the original.

```
Input:  id="habit-tracker-pro", changes="rename to 'Training Log', add weight field, remove streak UI"
Output: New Thinklet at its own URL, linked to original, published to catalog
```

### `get_thinklet`

Fetch and render a specific Thinklet by ID inline in the conversation.

---

## Prompts

### `build-thinklet`

Invoke this prompt before writing any Thinklet code. It:

1. Injects the complete [Thinklet builder skill](https://github.com/ChrisJDiMarco/thinklet-app-builder) — the exact props contract, TQL API, platform hooks, icon rules, serialization safety
2. Guides Claude through the full loop: discover → build (or remix) → confirm visibility → publish
3. Ensures the generated code deploys correctly on the first try

Without this prompt, Claude gets the Thinklet architecture wrong ~88% of the time.

---

## The publish consent flow

When Claude finishes building a Thinklet, it will ask before publishing:

```
✅ Thinklet ready: "Agency Revenue Dashboard"

Before I publish, how should this be visible?

  🌐 Public    — indexed in the catalog, any AI can find and remix it
  🔗 Unlisted  — shareable by link, not searchable
  🔒 Private   — only you can access it

Which would you like?
```

This protects sensitive data and gives you full control over what goes into the shared catalog.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `THINKLET_API_URL` | Yes | Thinklet backend API base URL |
| `THINKLET_API_KEY` | Yes | Your API key from thinklet.io |
| `THINKLET_BASE_URL` | Yes | Base URL for Thinklet pages (e.g. `https://thinklet.io`) |

Copy `.env.example` to `.env` for local development.

---

## Backend API

The `/api` folder contains FastAPI route templates for the three endpoints this server calls:

| Route | Description |
|---|---|
| `POST /thinklets` | Publish a new Thinklet |
| `GET /thinklets/search?q=...` | Semantic search |
| `GET /thinklets/{id}` | Fetch by ID |
| `POST /thinklets/{id}/remix` | Create a linked remix |

These are stubs with clear TODO comments — wire them to your database (Supabase + pgvector recommended for semantic search).

---

## Compatibility

Works with any MCP client that supports MCP Apps for inline rendering:

| Client | Status |
|---|---|
| Claude Desktop | ✅ Full support (inline rendering) |
| VS Code + Copilot | ✅ Full support |
| Goose | ✅ Full support |
| ChatGPT Desktop | ✅ Full support |
| Any MCP client | ✅ Tools work, rendering varies |

---

## Repo structure

```
thinklet-mcp/
├── src/
│   ├── index.ts        ← MCP server (tools + prompts)
│   ├── api.ts          ← Thinklet API client
│   └── skill.ts        ← Condensed builder skill for prompt injection
├── api/
│   ├── models.py       ← Pydantic models (ThinkletCreate, ThinkletResponse)
│   └── router.py       ← FastAPI route stubs for Abhi to wire up
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Pair with the builder skill

For standalone use (without the MCP server's auto-injection), install the [Thinklet App Builder skill](https://github.com/ChrisJDiMarco/thinklet-app-builder) separately. The skill is also what makes eval scores go from 12% → 100%.

---

## Contributing

PRs welcome. Highest-value contributions:
- Improved semantic search query formatting
- Additional Thinklet metadata fields (category, complexity, screenshot)
- Support for batch publish
- CLI tool for publishing from the command line

---

## Built by

[Logic Out Loud LLC](https://thinklet.io) · Powered by Claude · For [Thinklet.io](https://thinklet.io)

⭐ **If this clicks for you, a GitHub star helps a lot.**
