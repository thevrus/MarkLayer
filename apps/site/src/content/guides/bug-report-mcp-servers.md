---
order: 6
title: "Bug Report MCP Servers Compared: 5 Tools (2026)"
description: "Marker.io, BugHerd, Jam, Usersnap, and MarkLayer all ship MCP servers for AI coding agents. What each agent can read, and which loops it can close. Compared."
h1: "MCP servers for bug reports and visual feedback, compared"
intro: "An MCP server lets an AI coding agent read your bug reports and annotations directly, instead of you pasting screenshots into a chat. Five visual-feedback tools ship one as of August 2026. They differ on the question that matters: can the agent only read the feedback, or can it work the feedback?"
bottomLine: "All five tools let an agent read feedback over MCP. Marker.io exposes the richest report data (console and network logs) but keeps the agent read-only. Jam is a one-way link handoff. BugHerd allows task triage in beta. MarkLayer is the only one with a live two-way loop: the agent watches a room, marks annotations in progress, resolves them, and replies, with every status change visible to the humans watching."
published: 2026-08-15
modified: 2026-09-04
faq:
  - q: "What is an MCP server for bug tracking?"
    a: "MCP (Model Context Protocol) is the open standard AI assistants use to call external tools. A bug tracker's MCP server exposes its reports as tools an agent can call, so Claude Code or Cursor can pull a bug's details, screenshots, selectors, or logs directly instead of a human copy-pasting them into the chat."
  - q: "Can Claude Code read my bug reports?"
    a: "Yes, if your feedback tool ships an MCP server. Marker.io, BugHerd, Usersnap, Jam, and MarkLayer all support Claude Code as of August 2026; each is added with a one-line MCP config command. What the agent can do after reading differs by tool."
  - q: "Which bug tracker MCP lets the agent close the loop?"
    a: "MarkLayer. Its MCP server exposes acknowledge, resolve, dismiss, and reply, so the agent can mark an annotation in progress, fix the code, resolve the pin with a summary, or ask a clarifying question. Marker.io explicitly keeps resolution and replies manual; Jam's flow is one-way; Usersnap's MCP is scoped to querying feedback; BugHerd's beta supports task triage."
  - q: "Do I need to pay to use these MCP servers?"
    a: "The MCP servers themselves are free on every tool listed, but the products differ: Marker.io (from $59/month), BugHerd (from $50/month), and Usersnap (from ~€39/month) require paid plans, Jam has a free tier, and MarkLayer is entirely free."
---

## What the agent gets, tool by tool

As of August 2026, verified against each vendor's published documentation:

| Tool | Agent can read | Agent can act | Price floor |
| --- | --- | --- | --- |
| **MarkLayer** | Annotations with CSS selector, text fingerprint, computed styles, detected React/Vue/Svelte component, thread history | Watch live, acknowledge, resolve, dismiss, reply | Free |
| **Marker.io** | Reports with screenshots, console logs, network requests, browser/OS | Read and draft only; cannot resolve or reply | $59/mo ($39 annual) |
| **BugHerd** | Task details with screenshots, CSS selectors, browser/OS, severity | List, create, update tasks (beta) | $50/mo (5 members) |
| **Jam.dev** | A pasted Jam link: console, network, user actions, video transcript | Nothing; one-way handoff | Free tier |
| **Usersnap** | Collected feedback via hosted MCP (OAuth) | Query feedback, create opportunities | ~€39/mo |

Two design decisions separate the field.

**Read-only vs two-way.** Marker.io documents that its agent integration deliberately stops short of resolving or replying: a human stays in the loop by policy. Jam's model is a link you paste, after which the agent works alone. MarkLayer inverts this: the agent is a participant in the room, and the human oversight happens live, on the annotations themselves, as statuses flip from open to in progress to resolved.

**Report context vs element context.** Marker.io and Jam attach runtime evidence: console errors, network traces. MarkLayer attaches code-location evidence: the selector, the computed styles, and the framework component behind the annotated element, which is what an agent needs to find the file to edit. BugHerd sits between, with selectors but no logs. If your bugs are mostly "this JavaScript is failing", runtime logs win. If they are mostly "this element is wrong", element context wins.

## Connecting an agent

Every tool here uses a one-line install. MarkLayer's, for Claude Code:

```
claude mcp add marklayer -- npx -y marklayer-mcp --room <room-id>
```

Cursor, Codex, Windsurf, and other MCP clients take the same `npx -y marklayer-mcp` command in their MCP configuration. The server is published on npm as `marklayer-mcp`, and each MarkLayer share page shows the command with the room id filled in.

For the step-by-step setup, the full tool reference, and troubleshooting the first connection, see [the Claude Code MCP setup guide](/guides/claude-code-visual-feedback).

## Which to pick

Match the tool to the failure mode you report most. Runtime bugs with logs: Marker.io (paid) or Jam (free tier). Task-tracked QA with triage: BugHerd. Feedback-program queries: Usersnap. Visual and UI feedback that an agent should fix while reviewers watch: MarkLayer, and it is the only free option of the five.
