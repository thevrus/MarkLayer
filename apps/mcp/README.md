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

## Troubleshooting

**"Connection closed" on first start.** `npx -y` downloads the package on the
first run, and a cold download can outlast the MCP client's startup timeout.
Prime the cache once (`npx -y marklayer-mcp --help`) and reconnect, or install
it up front with `npm i -g marklayer-mcp` and point the client at the binary.

**Tools return "room is not connected".** The WebSocket dropped — rooms are held
open by a Durable Object and a long-idle agent can be disconnected. Call
`marklayer_connect_room` with the same URL to reattach.

## Creating rooms programmatically

This server *consumes* an existing share link. To *mint* one (or many) from code — e.g. seed a room per page in a batch of URLs before pointing the agent at it — POST directly to the public HTTP API:

```bash
curl -X POST https://marklayer.app/api/$ID \
  -H 'Content-Type: application/json' \
  -d '{"ops":[],"url":"https://example.com/page-1","width":1440,"expires_in":2592000}'
# Share link: https://marklayer.app/s/$ID
```

`$ID` is caller-supplied (use `nanoid` / `crypto.randomUUID()` — it's the access token). No auth, no SDK. Full details: https://marklayer.app/llms-full.txt
