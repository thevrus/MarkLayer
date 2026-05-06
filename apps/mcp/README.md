# marklayer-mcp

MCP (Model Context Protocol) server that bridges [MarkLayer](https://marklayer.app) annotations to AI coding agents.

When users annotate any webpage with MarkLayer, your agent receives the comments as a structured work queue: it can acknowledge, resolve, dismiss, and reply to each one — and the human sees the status updates live.

## Install

```bash
# Add to Claude Code:
claude mcp add marklayer -- npx -y marklayer-mcp

# Or pre-connect to a specific room:
claude mcp add marklayer -- npx -y marklayer-mcp --room https://marklayer.app/s/abc123
```

## Usage

In your agent prompt:

> Watch my MarkLayer annotations. For each one, acknowledge it, make the fix, then resolve it with a summary.

The agent will call `marklayer_watch_annotations` in a loop and process incoming feedback as it arrives.

## Tools

| Tool | Description |
|------|-------------|
| `marklayer_connect_room` | Connect to a room by share URL or bare id. |
| `marklayer_room_info` | Page URL, viewport width, timestamps. |
| `marklayer_list_annotations` | List annotations, optionally filtered by status. |
| `marklayer_get_annotation` | Full detail + reply thread for one annotation. |
| `marklayer_watch_annotations` | Block until new annotations arrive, return a batch. |
| `marklayer_acknowledge` | Mark in-progress and tag with this agent. |
| `marklayer_resolve` | Mark resolved, optionally posting a reply with the summary. |
| `marklayer_dismiss` | Mark dismissed with a reason the human will see. |
| `marklayer_reply` | Post a reply without changing status (e.g. clarifying questions). |

## Options

```
--room <url-or-id>   Connect at startup; otherwise call marklayer_connect_room.
--api-base <url>     Override worker URL (default https://marklayer.app).
--agent <name>       Identifier shown to humans (default "claude-code").
```

Equivalent env vars: `MARKLAYER_ROOM`, `MARKLAYER_API_BASE`, `MARKLAYER_AGENT`.
