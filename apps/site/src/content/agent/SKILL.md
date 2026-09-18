---
name: marklayer-annotations
description: Create MarkLayer annotation share links over a no-auth HTTP API, and process a human's webpage annotations (comments, selections, areas, inspected elements) as a work queue via the marklayer-mcp server, which can read the page, watch for new work, acknowledge, resolve, dismiss, reply, leave its own comments, and propose exact text edits as diffs, all with live status.
license: MIT
---

# Working with MarkLayer annotations

MarkLayer (https://marklayer.app) is a free, anonymous webpage annotation tool.
Humans draw, comment, and mark up any URL; each session is a "room" addressed by
an unguessable id. There are two ways an agent works with it.

## 1. Mint a share link (HTTP, no auth)

The id you POST to **is** the access token, so pick any unguessable string
(nanoid/uuid). No account, key, or SDK required.

    POST https://marklayer.app/api/{id}
    Content-Type: application/json
    { "ops": [], "url": "https://example.com/page", "width": 1440, "expires_in": 2592000 }

- \`ops\`: annotation operations (\`[]\` for a blank canvas the human will draw on)
- \`url\`: the page the link opens and overlays annotations onto
- \`width\`: reference viewport width in CSS px (1440 is a safe default)
- \`expires_in\`: seconds until cleanup (max 2592000 = 30 days). Omit for no fixed expiry — the link
  is deleted 90 days after its last access, and any view or comment resets that clock.

The share link is then \`https://marklayer.app/s/{id}\`. To mint many at once,
loop the POST with a fresh id per URL. Full machine-readable spec:
https://marklayer.app/api/openapi.json (also listed in
https://marklayer.app/.well-known/api-catalog).

## 2. Process annotations as a work queue (MCP)

Install the stdio MCP server and let a human's feedback drive your edits:

    claude mcp add marklayer -- npx -y marklayer-mcp

A room's \`url\` is not always a webpage. It can be a PDF or an image, either a
link to one or a file someone uploaded, served from \`/f/{id}\`. Annotations on
one record the page they were made on rather than a CSS selector — an image
counts as a single page — and the \`inspect\` kind never appears there, so take
the location from that instead of asking which element was meant.

Each annotation carries a \`kind\` (comment | area | selection | inspect) and,
where the human marked an element, a \`target\` block with the CSS selector +
markdown, and that is your handle for the code change; do not ask them to repeat
what was clicked.

Typical loop:

1. \`marklayer_connect_room\` with the share link or bare id (or set \`MARKLAYER_ROOM\`).
2. \`marklayer_list_annotations\` to backfill anything pending (filter by status:
   open | in_progress | resolved | approved | dismissed | all).
3. \`marklayer_watch_annotations\` in a loop to receive new ones as they arrive.
4. For each: \`marklayer_acknowledge\` (marks in_progress so the human sees you are
   on it), make the change, then \`marklayer_resolve\` with a summary (posted as a
   reply). Use \`marklayer_dismiss\` with a reason when it cannot be acted on, and
   \`marklayer_reply\` to ask a clarifying question without changing status.

\`approved\` is the one status you never set: it is the person who asked for the
change confirming your fix. Seeing it means the thread is closed for good, and
seeing a resolved thread go back to open means they disagreed.

Three further tools let you take part rather than only respond:

- \`marklayer_read_page\` returns the page's headings, text, links and controls
  with their selectors, so you can review a page before anyone has annotated it.
- \`marklayer_create_annotation\` leaves a comment of your own, anchored to an
  element, with an optional priority.
- \`marklayer_suggest_edit\` proposes exact replacement text against the \`rects\`
  of a selection. The human sees a diff rather than a paragraph describing a
  change, so prefer it over explaining a wording fix in a reply.

A comment carries fields worth reading before you act: \`status\`, \`priority\`
(low | medium | high | urgent), an \`assignee\` (which may be an agent, including
you), \`mentions\`, and the browser, OS and viewport it was written on. A report
that only reproduces at one width usually says so there.

Source: https://github.com/thevrus/MarkLayer/tree/main/apps/mcp

## In-browser (WebMCP)

When a human opens a share link in a browser whose agent supports WebMCP, the
same actions (list / get / acknowledge / resolve / dismiss / reply) are exposed
on the page via \`document.modelContext\` (falling back to the deprecated
\`navigator.modelContext\` on Chrome 149), with no install required.
