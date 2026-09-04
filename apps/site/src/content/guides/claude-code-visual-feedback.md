---
order: 7
title: "Claude Code, Codex, Cursor & Windsurf: Visual Feedback via MCP"
description: "Connect Claude Code, Codex, Cursor, or Windsurf to a MarkLayer room so it reads annotations left on a live webpage, works them, and resolves each one with a status the human reviewer sees live. Full setup per client, tool reference, and troubleshooting."
h1: "Give your AI coding agent visual feedback from a live webpage"
intro: "An AI coding agent cannot see your screen, so the usual workaround is a paragraph describing which element is wrong, or a screenshot it reads imprecisely. Connecting it to a MarkLayer room instead gives it the actual annotation: the instruction, the CSS selector, and the element context, plus a way to mark its own progress that the human reviewer sees update live on the page. Claude Code has the shortest path in (one CLI command); Codex, Cursor, and Windsurf take the same server through their own config file."
bottomLine: "Run one command (`claude mcp add`, `codex mcp add`, or a few lines of config for Cursor and Windsurf), point it at a MarkLayer room, and tell the agent to watch it. The server exposes nine tools; the two that matter for a first run are marklayer_watch_annotations (to pull feedback as it arrives) and marklayer_resolve (to close it out with a summary the human sees as a reply). No API key, no dashboard, no account on either side."
published: 2026-09-04
modified: 2026-09-04
faq:
  - q: "How do I connect Claude Code to MarkLayer?"
    a: "Run `claude mcp add marklayer -- npx -y marklayer-mcp` once in your project directory. That registers the server with no room attached; the agent calls marklayer_connect_room with a share URL the first time you ask it to watch a page. To skip that step, add the room up front: `claude mcp add marklayer -- npx -y marklayer-mcp --room https://marklayer.app/s/abc123`."
  - q: "What exactly does Claude Code receive from an annotation?"
    a: "Depends on the kind. A comment carries the reviewer's text and, for a plain sticky note, nothing else; if it was pinned to an element, it carries a target block with a CSS selector, a text fingerprint, and the detected React, Vue, or Svelte component name. Area and selection annotations carry the same element target without a comment thread. Inspect annotations are the element context alone, no instruction attached, for when someone just wants to hand the agent a specific node."
  - q: "Can Claude Code mark an annotation as done without a human doing it?"
    a: "Yes. marklayer_resolve marks it resolved and posts your summary as a reply, visible immediately to whoever is watching the room. There's a fifth status, approved, that the agent cannot set itself: it's reserved for the human who filed the annotation confirming the fix actually works. marklayer_list_annotations filtering by status: 'approved means the person who asked for the change confirmed the fix, so those need nothing from you' is how the tool describes it, which is a useful signal to skip re-checking those."
  - q: "Does this work with Cursor, Codex, or Windsurf instead of Claude Code?"
    a: "Yes, and the tools, rooms, and statuses are identical either way; only the config format changes. Codex CLI stores MCP servers as TOML in ~/.codex/config.toml, Cursor and Windsurf both use a mcpServers block in a JSON file (~/.cursor/mcp.json and ~/.codeium/windsurf/mcp_config.json respectively), and Claude Code is the only one with a one-line `claude mcp add` command instead of hand-edited config."
  - q: "Does the agent need the page to be public?"
    a: "The room does, not the page. A share link works for any URL the MarkLayer extension or web app can reach, including localhost, staging behind basic auth, or production. Rooms themselves live on marklayer.app regardless of what page they're annotating, so the agent connects to the room the same way whether the underlying page is public or not."
  - q: "Does this work with MCP clients other than these four?"
    a: "Any MCP-capable client should work: the server speaks the standard stdio transport, so it's a matter of adding a command (npx) and args (-y marklayer-mcp, optionally --room <url>) wherever that client keeps its MCP config. Zed, Aider, Gemini CLI, Amazon Q Developer, Cline, and Roo Code all support that transport; the file name and location are the only things that differ from Claude Code, Codex, Cursor, and Windsurf."
  - q: "What if the MCP server won't connect on the first try?"
    a: "Almost always a cold `npx` download outlasting the client's startup timeout, not a bug in the room or the annotation. Run `npx -y marklayer-mcp --help` once to warm the npm cache, then reconnect; or install it globally with `npm i -g marklayer-mcp` so there's no download on start. A 'room is not connected' error later in a long session means the WebSocket dropped from idling — call marklayer_connect_room again with the same URL to reattach, no new room needed."
---

## The setup, in order

1. **Get a room.** Annotate any page with the MarkLayer extension or at marklayer.app, then open Share. The link (`https://marklayer.app/s/<id>`) is the room.
2. **Register the server once.** In your project directory: `claude mcp add marklayer -- npx -y marklayer-mcp` for Claude Code, or the Codex, Cursor, or Windsurf equivalent further down this page. This adds the server with no room attached.
3. **Point the agent at the room.** Either pass `--room <share-url>` on that same command to connect at startup, or leave it off and tell the agent the URL in your prompt; it calls `marklayer_connect_room` itself.
4. **Ask it to watch.** A prompt like "watch my MarkLayer annotations, fix each one, resolve it with a summary" is enough. The agent loops on `marklayer_watch_annotations`, which blocks until something new arrives.
5. **Watch it work from the page.** Every `marklayer_acknowledge`, `marklayer_resolve`, `marklayer_dismiss`, or `marklayer_reply` call updates the pin's status live for anyone else who has the room open, no refresh needed.

## The nine tools

| Tool | What it does |
| --- | --- |
| `marklayer_connect_room` | Connect by share URL or bare room id. Replaces any prior room. |
| `marklayer_room_info` | Page URL, viewport width, timestamps for the connected room. |
| `marklayer_list_annotations` | List annotations, filterable by status. |
| `marklayer_get_annotation` | Full detail and reply thread for one annotation. |
| `marklayer_watch_annotations` | Block until new annotations arrive, then return a batch. The one to loop on. |
| `marklayer_acknowledge` | Mark in_progress, tagged with the agent's name. |
| `marklayer_resolve` | Mark resolved; the optional summary posts as a reply. |
| `marklayer_dismiss` | Mark dismissed with a reason, shown to the human. |
| `marklayer_reply` | Post a reply with no status change, for a clarifying question. |

Four annotation kinds can arrive through any of these: **comment** (a threaded note, optionally pinned to an element), **area** and **selection** (a region or element marked without necessarily attaching text), and **inspect** (element context alone, no instruction, for handing over a specific node with nothing else attached). Anything pinned to an element carries a `target` block: CSS selector, a text fingerprint that survives DOM changes, and the detected framework component where one exists, which is what actually lets the agent find the file to edit rather than guess from a description.

## Five statuses, not four

Most write-ups of this flow mention four states: open, in progress, resolved, dismissed. There's a fifth, **approved**, and it's not one the agent can set. It's reserved for the person who filed the annotation confirming the fix actually works after `resolved` was posted. Filtering `marklayer_list_annotations` by status and skipping `approved` results is the practical use: those are closed by a human who already checked, and re-touching them wastes a turn.

## Any URL, not just localhost

The room lives on marklayer.app regardless of what it's pointed at. That means the identical setup connects the agent to a live production page, a staging URL behind basic auth, or a local dev server — the difference is only in how the page itself was annotated (the extension for localhost and authed pages, no install at all for a public URL). If your workflow is specifically "point at an element in my own dev server, nothing else," the [localhost + AI agent walkthrough](/for/localhost-ai-agents) covers that narrower case start to finish; this page is the setup reference for any of them.

Every client below runs the same server, the same nine tools, and the same rooms and statuses. Only the config file's location and format change, and dropping `--room <url>` from any of them registers the server with no room attached, so the agent calls `marklayer_connect_room` itself once you give it a share link in the prompt.

## Add the MCP server to Codex CLI

Codex stores MCP servers as TOML, not JSON, either globally at `~/.codex/config.toml` or scoped to one trusted project at `.codex/config.toml`:

```toml
[mcp_servers.marklayer]
command = "npx"
args = ["-y", "marklayer-mcp", "--room", "https://marklayer.app/s/abc123"]
```

Or skip hand-editing the file entirely with `codex mcp add marklayer -- npx -y marklayer-mcp --room https://marklayer.app/s/abc123`.

## Add the MCP server to Cursor

Cursor reads a `mcpServers` block from a JSON file: `~/.cursor/mcp.json` globally, or `.cursor/mcp.json` in the repo root to scope it to one project.

```json
{
  "mcpServers": {
    "marklayer": {
      "command": "npx",
      "args": ["-y", "marklayer-mcp", "--room", "https://marklayer.app/s/abc123"]
    }
  }
}
```

## Add the MCP server to Windsurf

Windsurf uses the identical `mcpServers` JSON shape as Cursor, in a different file: `~/.codeium/windsurf/mcp_config.json`. Same block as above, pasted into that path instead.

## Other MCP clients

Any MCP-capable client works the same way in principle: a `command` plus `args` telling it to run `npx -y marklayer-mcp` (optionally with `--room <url>`), written wherever that client keeps its MCP config. Zed, Aider, Gemini CLI, Amazon Q Developer, Cline, and Roo Code all support the standard MCP stdio transport this server uses, even though their config file's name and location differ from the four above; check that client's own MCP documentation for the exact path, and everything past that point (the tools, the rooms, the statuses) is identical.

For how this compares to the four other tools that also ship an MCP server for feedback (Marker.io, BugHerd, Jam, Usersnap), see the [MCP servers compared](/guides/bug-report-mcp-servers) breakdown — the short version is that most of them hand the agent a one-way link or a read-only report, where this one is a room the agent is a live participant in.

## When the first connection fails

Almost every first-run failure is the same cause: `npx -y` downloads the package fresh, and a slow or cold download outlasts the MCP client's own startup timeout, which reads as a generic "connection closed." Run `npx -y marklayer-mcp --help` once on its own to warm the cache, or skip the download step entirely with a global install (`npm i -g marklayer-mcp`) pointed at directly. A "room is not connected" error well into a session is a different thing: the room's WebSocket dropped from being idle, and the fix is calling `marklayer_connect_room` again with the same URL, not starting a new room.
