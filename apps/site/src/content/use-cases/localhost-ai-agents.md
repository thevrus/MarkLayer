---
order: 1
title: "Annotate localhost and Hand the Element to Your AI Agent"
description: "Click an element on your localhost dev server and hand your AI coding agent its selector, styles, and component name over MCP. Free, with no account."
h1: "Point an AI coding agent at a UI element on your local dev server"
audience: "developers running a local dev server alongside an AI coding agent"
bottomLine: "Install the MarkLayer extension, open your localhost dev server, drop a pin or inspect an element, and run one \"claude mcp add\" command. The agent reads the annotation with its selector and component name, fixes the code, and resolves the pin in place. Free, no account. Share links need a publicly reachable URL, so use staging or a tunnel when you want someone else to see the page too."
problem: "The gap is that your coding agent cannot see your screen. You know exactly which element is wrong, because you are looking at it, but conveying that costs a paragraph of prose, a screenshot the agent reads imprecisely, or a hand-copied selector from devtools. Then the agent goes quiet, and you have no idea whether it understood which element you meant until the diff lands."
published: 2026-01-23
modified: 2026-03-13
why:
  - "The extension annotates localhost directly. It draws on the page in your browser, so there is no proxy or tunnel involved and your dev server never has to be reachable from the internet."
  - "The inspector captures a CSS selector, a text fingerprint, computed styles, and the detected React, Vue, or Svelte component: the context an agent needs to find the code, not just the pixel."
  - "The MCP loop runs both ways. The agent marks an annotation in progress, resolves it with a summary, or replies with a question, and the status changes on the pin in front of you."
  - "Annotations are threads, not one-shot prompts. A pin stays open with its history until it is resolved, so a half-finished fix does not vanish from the conversation."
  - "It works the same on staging and production, so the workflow you learn on localhost is the one you use when a designer or client is in the room."
  - "Free, with no account and no per-seat cost."
steps:
  - name: "Install the extension and open localhost"
    text: "Add the MarkLayer Chrome extension and open your local dev server as usual (localhost:3000, localhost:5173, whatever your framework uses). Activate MarkLayer on the page."
  - name: "Point at the element"
    text: "Use the Inspect tool to click the element that is wrong, or drop a comment pin on it. Inspect captures the selector, computed styles, and the framework component behind that node."
  - name: "Say what should change"
    text: "Type the instruction on the annotation: \"this card should align with the one above it.\" The element context travels with your sentence, so you never describe the location in prose."
  - name: "Connect your agent once"
    text: "Open Share and copy the connect command: \"claude mcp add marklayer -- npx -y marklayer-mcp --room <id>\". Run it in the project directory. Cursor, Codex, and Windsurf take the same npx command in their MCP config."
  - name: "Let the agent work the room"
    text: "Ask the agent to watch the room. It pulls each annotation with its selector and component name, marks the one it is working on as in progress, edits the code, and resolves the pin with a summary reply."
  - name: "Reload and confirm"
    text: "Your dev server hot-reloads the fix. Re-inspect the same element to confirm, or reopen the pin if it is not right; the thread is still there."
faq:
  - q: "Does MarkLayer work on localhost?"
    a: "Yes. The Chrome extension annotates any page your browser can open, including localhost dev servers on any port. The extension draws the overlay client-side, so nothing about your local page is sent through a proxy for you to annotate it."
  - q: "Can someone else open a share link to my localhost page?"
    a: "No, and no tool can do this honestly. A share link is rendered by fetching the page server-side, and marklayer.app cannot reach your machine. Annotations on a localhost page still sync to the room, so your AI agent sees them, but a human viewer cannot load the page itself. To put another person on the same page, point MarkLayer at a staging URL or expose your dev server through a tunnel such as cloudflared or ngrok and annotate the tunnel URL instead."
  - q: "How is this different from stagewise or other localhost agent toolbars?"
    a: "They solve the developer half of this: point at an element in your own dev app and pipe context to your agent. MarkLayer does that too, and also works on staging and production URLs, keeps annotations as threads with statuses, and lets the agent report progress back into a room other people can be in. If you never need anyone but yourself and your agent, the difference is small; the moment a designer, PM, or client has to leave the feedback, it is the whole difference."
  - q: "What exactly does the agent receive?"
    a: "For each annotation: your instruction, the CSS selector, a text fingerprint that survives DOM changes, the element position and size, computed styles, and the detected React, Vue, or Svelte component name where one is found. Console and network logs are not captured today."
  - q: "Which agents can connect?"
    a: "Anything that speaks MCP. Claude Code has a one-line install; Cursor, Codex, Windsurf, and other MCP clients take the same \"npx -y marklayer-mcp --room <id>\" command in their MCP config. The server is published on npm as marklayer-mcp."
  - q: "Can the agent close annotations on its own?"
    a: "Yes. The MCP server exposes acknowledge, resolve, dismiss, and reply, so the agent can mark work in progress, resolve a pin with a summary, dismiss one with a reason, or ask a question without changing status. Every change shows up live for the humans in the room."
---

Describing a UI problem to a coding agent in words is the slow path. "The spacing under the third card is wrong" sends the agent hunting through your components. MarkLayer lets you click the element on your running localhost page and hand the agent the exact selector, computed styles, and framework component name, then watch it mark the annotation in progress and resolve it without leaving the page.
