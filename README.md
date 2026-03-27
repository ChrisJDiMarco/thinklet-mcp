# thinklet-mcp

> The MCP server that connects any AI to the Thinklet platform.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/Protocol-MCP-blue)](https://modelcontextprotocol.io)
[![Platform](https://img.shields.io/badge/Platform-Thinklet.io-blue)](https://thinklet.io)
[![Browse](https://img.shields.io/badge/Browse-app.thinklet.io-blue)](https://app.thinklet.io)
[![Works with Claude](https://img.shields.io/badge/Works%20with-Claude-orange)](https://claude.ai)
[![Works with Copilot](https://img.shields.io/badge/Works%20with-Copilot-blue)](https://copilot.microsoft.com)

---

## What is Thinklet?

**Thinklet** is a platform for AI-built interactive apps — dashboards, trackers, calculators, tools, anything that runs in a browser.

Your AI builds a Thinklet from a prompt, publishes it to a shared catalog with its own URL, and it's immediately available for anyone to use or remix. Every remix is saved — so every Thinklet has a full lineage you can explore, fork from, or run at any point in its history. Browse the catalog at [app.thinklet.io](https://app.thinklet.io), or connect your AI via MCP to build and discover Thinklets directly from a conversation.

**`thinklet-mcp`** is the MCP server that gives Claude, Copilot, or any MCP-compatible AI four new tools: search the catalog, build new Thinklets, remix existing ones, and publish — all without leaving your conversation.

---

## The loop

```
User asks for a tool
    ↓
discover_thinklets  →  match found?  →  remix_thinklet (seconds)
    ↓ no match                                ↓
Claude builds new Thinklet              Renders inline via MCP Apps
    ↓                                         ↓
publish_thinklet                        Lives at a real URL
    ↓                                         ↓
Indexed in catalog + lineage saved      Anyone can browse, use, fork
    ↓
Next person finds it instantly
```

---

## Install

### Option A — npx

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
npm install --include=dev && npm run build
```

Add to `claude_desktop_config.json`:
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

Restart Claude Desktop. The Thinklet tools will appear in your tools panel.

---

## Tools

### `discover_thinklets`
Search the catalog by natural language intent. **Always call this first** — something might already exist.

### `publish_thinklet`
Publish a generated Thinklet. Asks for visibility before publishing:
- **Public** — indexed in the catalog, any AI can discover and remix it
- **Unlisted** — accessible by link, not searchable
- **Private** — only you

### `remix_thinklet`
Adapt an existing Thinklet for a new context. Provide the ID and what should change — the remix is published and linked to the original, preserving the lineage.

### `get_thinklet`
Fetch and render a specific Thinklet by ID, inline in the conversation.

---

## Prompts

### `build-thinklet`
Invoke before writing any Thinklet code. It injects the full [builder skill](https://github.com/ChrisJDiMarco/thinklet-app-builder) and guides Claude through the complete loop: discover → build or remix → confirm visibility → publish.

---

## The remix lineage

Every Thinklet published to the platform stores its remix history. At [app.thinklet.io](https://app.thinklet.io), each Thinklet shows a visual stack of cards behind it — every previous remix, in order, each one runnable. Fork from any point. Every version lives at its own URL. The full lineage is always preserved.

When you publish a remix via `remix_thinklet`, it's automatically linked to the original and tracked in the lineage chain.

---

## Compatibility

| Client | Tools | Inline rendering |
|---|---|---|
| Claude Desktop | ✅ | ✅ (MCP Apps) |
| VS Code + Copilot | ✅ | ✅ |
| Goose | ✅ | ✅ |
| ChatGPT Desktop | ✅ | ✅ |
| Any MCP client | ✅ | varies |

---

## Platform surfaces

| Surface | What it is |
|---|---|
| [app.thinklet.io](https://app.thinklet.io) | Browse the full catalog, view lineage stacks, use any Thinklet |
| iPhone app | Coming soon |
| Any URL | Every Thinklet has a shareable, embeddable link |
| Claude / Copilot | Build and discover via this MCP server |

---

## Environment variables

| Variable | Description |
|---|---|
| `THINKLET_API_URL` | Thinklet backend API base URL |
| `THINKLET_API_KEY` | Your API key from thinklet.io |
| `THINKLET_BASE_URL` | Base URL for Thinklet pages |

---

## Backend

The `/api` folder has FastAPI route stubs for Abhi to wire up: publish, search, get, and remix endpoints with full TODO comments and recommended stack (Supabase + pgvector for semantic search).

---

## Repo structure

```
thinklet-mcp/
├── src/
│   ├── index.ts     ← MCP server
│   ├── api.ts       ← Thinklet API client
│   └── skill.ts     ← Condensed builder skill for prompt injection
├── api/
│   ├── models.py    ← Pydantic models
│   └── router.py    ← FastAPI route stubs
├── .env.example
└── package.json
```

---

## Built by

[Logic Out Loud LLC](https://thinklet.io) · [app.thinklet.io](https://app.thinklet.io) · Powered by Claude

⭐ **If this clicks for you, a star helps a lot.**
