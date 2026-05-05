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

**Thinklet** is a platform for AI-built interactive apps — anything from a simple calculator to a full-scale production application. If it runs in a browser, it can be a Thinklet.

Every Thinklet is a single React component running entirely in the browser — no backend, no deployment, no setup. The platform carries everything else: AI configuration, RAG documents, data management, versions, publications, and integrations.

Thinklets ship with built-in AI APIs for text generation, image generation, video generation, text-to-speech, and web scraping. Browse the catalog at [app.thinklet.io](https://app.thinklet.io), or connect your AI via MCP to build and discover Thinklets directly from a conversation.

**`thinklet-mcp`** is the MCP server that gives Claude, Copilot, or any MCP-compatible AI six tools: browse integrations, search the catalog, build new Thinklets, preview them inline, fix and iterate, and control visibility — all without leaving your conversation.

---

## The loop

```
User asks for a tool
        ↓
discover_thinklets → match found? → get_thinklet (render inline)
        ↓ no match                          ↓
list_integrations → pick what's needed   fix_thinklet (iterate)
        ↓                                   ↓
Claude builds new Thinklet       set_visibility → public
        ↓
publish_thinklet (private first)
        ↓
Preview inline → verify → fix → go public
        ↓
Indexed in catalog → anyone can discover and use it
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
        "THINKLET_API_KEY": "your-api-key",
        "THINKLET_API_URL": "https://api.thinklet.io",
        "THINKLET_CONTENT_URL": "https://content.thinklet.io"
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
        "THINKLET_API_KEY": "your-api-key",
        "THINKLET_API_URL": "https://api.thinklet.io",
        "THINKLET_CONTENT_URL": "https://content.thinklet.io"
      }
    }
  }
}
```

Restart Claude Desktop. The Thinklet tools will appear in your tools panel.

---

## Tools

### `list_integrations`
Browse available platform integrations (AI streaming, image generation, video generation, text-to-speech, web scraping, Perplexity research). Call without IDs to see the catalog. Call with specific IDs and `includeDocs: true` to get full usage reference before writing code.

### `discover_thinklets`
Search the catalog by natural language intent. **Always call this first** — something might already exist. Searches both public catalog and your private thinklets.

### `publish_thinklet`
Create a new Thinklet on the platform. Saves as **private** by default — the user can make it public later with `set_visibility` once they've verified it works. Accepts optional `integrations` array to tag which platform integrations the thinklet uses.

### `get_thinklet`
Fetch a Thinklet by ID and render it inline in the conversation via MCP Apps. Optionally includes the source code for review or editing.

### `fix_thinklet`
Patch the code on an existing Thinklet you own. Use for bug fixes, UI tweaks, or adding features after initial creation. Provide the complete updated code — it replaces the previous version.

### `set_visibility`
Toggle between public and private. Making it public indexes it in the catalog and generates an AI thumbnail. Making it private archives the publication.

---

## Prompts

### `build-thinklet`
Invoke before writing any Thinklet code. Injects the full [builder skill](https://github.com/ChrisJDiMarco/thinklet-app-builder) — the props contract, TQL persistence API, platform hooks, Code CRISPR editing protocol, and pre-deploy audit — then guides Claude through the complete loop: discover → check integrations → build → save private → verify → fix → go public.

---

## Claude Agent SDK

`thinklet-mcp` is a first-class MCP integration for the [Claude Agent SDK](https://docs.claude.com/en/agent-sdk/overview).

The Agent SDK handles the agentic loop — planning, tool calls, decisions. Thinklet handles what the agent produces: a persistent, shareable app with its own AI configuration, knowledge base, and integrations — living at a real URL, discoverable by the next agent or human.

```python
from claude_agent_sdk import query, ClaudeAgentOptions

options = ClaudeAgentOptions(
    mcp_servers={
        "thinklet": {
            "command": "npx",
            "args": ["-y", "thinklet-mcp"],
            "env": {"THINKLET_API_KEY": "your-key"}
        }
    }
)

async for message in query(
    prompt="Build a revenue dashboard for a roofing company and publish it to Thinklet",
    options=options
):
    print(message)
```

Every tool in this server — discover, build, fix, publish — is callable by an Agent SDK agent with no human in the loop.

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
| [app.thinklet.io](https://app.thinklet.io) | Browse the full catalog, configure any Thinklet, manage API keys |
| Any URL | Every Thinklet has a shareable, embeddable link |
| Claude / Copilot | Build and discover via this MCP server |

---

## Environment variables

| Variable | Description |
|---|---|
| `THINKLET_API_KEY` | Your API key (generate at app.thinklet.io → Settings → MCP) |
| `THINKLET_API_URL` | Backend API base URL (default: `https://api.thinklet.io`) |
| `THINKLET_CONTENT_URL` | Content app URL for embeds (default: `https://content.thinklet.io`) |

---

## Repo structure

```
thinklet-mcp/
├── src/
│   ├── index.ts         ← MCP server (tools + prompt)
│   ├── api.ts           ← Thinklet API client
│   ├── skill.ts         ← Builder skill for prompt injection
│   └── integrations.ts  ← Integration catalog + usage docs
├── .env.example
└── package.json
```

---

## Built by

[Logic Out Loud LLC](https://thinklet.io) · [app.thinklet.io](https://app.thinklet.io) · Powered by Claude

⭐ **If this clicks for you, a star helps a lot.**
