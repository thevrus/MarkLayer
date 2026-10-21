---
order: 16
title: "Huddlekit vs MarkLayer: Pricing, MCP and Task Sync Compared"
description: "Huddlekit's free plan stops at 1 project, 3 members and 100MB; Pro is $16-19/month, Team $33-39. MarkLayer is free, no plan to outgrow, MCP on every link."
intro: "MarkLayer is a free, open-source Huddlekit alternative: paste a URL, annotate the live page, share a link, and nobody on either side makes an account. Huddlekit's free plan allows one project and three members; Pro at $16 to $19 a month adds custom breakpoints and MCP, and Team at $33 to $39 adds two-way task sync with Linear, ClickUp, Notion and Trello, plus completion sync with Asana. MarkLayer has none of those tiers, and it also lacks Huddlekit's private comments, video review and in-app widget."
competitor: "Huddlekit"
competitorTagline: "a paid visual annotation and QA tool for agencies, freelancers and their clients, built around projects, breakpoints and task-tracker sync"
homepage: "https://huddlekit.com"
bottomLine: "Choose MarkLayer for free, real-time annotation with no project cap, a kanban board, side-by-side device review and an AI agent that can both read and leave annotations. Choose Huddlekit if you want private team-only comments, timestamped video review, staging sites behind basic auth without an extension, or a tracker that syncs status both ways."
quote: "Huddlekit's two-way Linear sync is real and it sits on the $33-a-month Team plan (checked October 2026). MarkLayer files one Linear, GitHub or Jira issue, or one Trello card, from a thread and stops there. That is one-way and free, and the link is also an MCP server."
published: 2026-10-11
modified: 2026-10-21
rows:
  - feature: "Price"
    ml: "Free"
    them: "Free (1 project, 3 members, 100MB); Pro $16/mo yearly or $19 monthly; Team $33/mo yearly or $39 monthly"
  - feature: "Sign-up required"
    ml: "No, for anyone"
    them: "Yes for the workspace; guests comment through a share link without an account"
  - feature: "Recipient install"
    ml: "Not required"
    them: "Not required"
  - feature: "Staging behind basic auth"
    ml: "Via the free browser extension, in each reviewer's own logged-in tab"
    them: "Yes, in a normal website project, usually with just the password"
  - feature: "Apps behind a login"
    ml: "Via the free browser extension"
    them: "Via a one-line script tag inside your app"
  - feature: "Private team-only comments"
    ml: "No. Everyone in the room sees every thread"
    them: "Yes, on every plan"
  - feature: "Video review"
    ml: "No"
    them: "Yes, comments pinned to the second; up to 2GB on Team"
  - feature: "PDF and image review"
    ml: "Yes, up to 25MB per file"
    them: "Yes; 2MB on Free, 50MB on Pro, 250MB on Team"
  - feature: "Device widths"
    ml: "Desktop, tablet and mobile side by side on one screen"
    them: "Custom breakpoints per project, side by side, on Pro and Team"
  - feature: "Real-time live cursors"
    ml: "Yes"
    them: "Not advertised"
  - feature: "Voice and video calls in the room"
    ml: "Yes, peer to peer"
    them: "No"
  - feature: "Kanban board"
    ml: "Yes, status columns on every link"
    them: "Yes, on every plan"
  - feature: "Task tracker sync"
    ml: "One way. Files a Linear, GitHub or Jira issue or a Trello card; nothing syncs back"
    them: "Two way with Linear, ClickUp, Notion, Trello and Asana on Team; Jira only through Zapier or webhooks"
  - feature: "Chat notifications"
    ml: "Slack, Microsoft Teams, Discord or any webhook, free"
    them: "Slack on Team"
  - feature: "AI coding agent access (MCP)"
    ml: "Every share link is an MCP server, so there is nothing to install. Agents can watch, resolve, reply, leave their own annotations and suggest text edits"
    them: "Hosted MCP on Pro and Team with OAuth. Read-only by default; with write access agents can set status, reply, tag and assign, but never create comments"
  - feature: "Open source"
    ml: "Yes"
    them: "No"
  - feature: "Best for"
    ml: "Fast, free review of any page, with or without an agent on the other end"
    them: "Agencies running client projects through a tracker"
chooseMl:
  - "You want visual feedback that costs nothing and has no project, member or storage cap to grow out of."
  - "You review together: live cursors and a voice call in the same room, instead of comments read later."
  - "You want an AI coding agent on the link itself, free, and you want it to leave annotations and suggest edits as well as resolve yours."
  - "You want open source you can read, audit or self-host."
chooseThem:
  - "You need comments your client never sees. Huddlekit's private comments are on every plan; MarkLayer has no team-only channel."
  - "You review video and want a comment pinned to a timestamp."
  - "Your staging site sits behind basic auth and you want it in the no-extension flow. Huddlekit takes the password; MarkLayer needs the browser extension for that."
  - "Your app is behind a login and you want reviewers inside it with nothing installed. Huddlekit's script tag does that; MarkLayer has no embeddable widget."
  - "You need Linear, ClickUp, Notion, Trello or Asana to close the comment when the task closes. That two-way sync is on Team."
faq:
  - q: "Is MarkLayer a free Huddlekit alternative?"
    a: "For annotating a live page and sharing a link, yes, and MarkLayer never asks for an account from the person who starts the review either. It does not replace Huddlekit's private comments, video review, custom breakpoints or the two-way tracker sync on the Team plan."
  - q: "How much does Huddlekit cost?"
    a: "Per its pricing page on 11 October 2026: a free plan with one project, three team members and 100MB of storage; Pro at $16 a month billed yearly ($190) or $19 monthly, with unlimited projects, 5GB, custom breakpoints, tags, folders, comment pausing and MCP; and Team at $33 a month billed yearly ($390) or $39 monthly, with 15 members, 50GB, integrations and API access. Guests are unlimited on every plan."
  - q: "Can my client comment on Huddlekit without an account?"
    a: "Yes. A guest with the share link can comment without signing up, on every plan. The difference is on the other side: setting up the project needs a Huddlekit workspace, while on MarkLayer the person who pastes the URL has no account either."
  - q: "Does MarkLayer work on a staging site behind a password?"
    a: "With the free browser extension, yes: it runs in your own tab, where you are already past the password, and overlays the page there; a reviewer joins the room from their own extension the same way. The plain web-app link fetches the page from MarkLayer's server with no cookies or credentials, so a password-protected page shows the password prompt. Huddlekit handles basic auth and platform passwords (Netlify, Vercel, Webflow, Shopify, WordPress) inside its normal website project; its features page says Wix page passwords do not work."
  - q: "How do the two MCP servers differ?"
    a: "Huddlekit's MCP needs Pro or Team, signs each teammate in with OAuth, is read-only until you grant write access, and even then the agent cannot create or delete comments. MarkLayer's is free and needs no install: every share link answers MCP at /s/<id>/mcp. Its twelve tools let an agent watch a room live, acknowledge, resolve, dismiss or reply, leave its own comment pins, and propose exact text edits that the reviewer accepts as a diff."
  - q: "Does MarkLayer sync with Linear or Asana the way Huddlekit does?"
    a: "No. MarkLayer files one Linear, GitHub or Jira issue, or one Trello card, from a thread, then posts the ticket URL back once. Closing the ticket does not close the comment. Huddlekit's Team plan keeps status in both directions for Linear, ClickUp, Notion and Trello, and syncs completion with Asana. Neither tool has a direct Jira sync; Huddlekit reaches Jira through Zapier or webhooks, and MarkLayer files a Jira issue one way."
  - q: "What happens to a MarkLayer link if nobody claims it?"
    a: "It is deleted 90 days after its last view, comment or edit, and any of those resets the clock. Claiming it with the free magic-link account removes the idle clock. Huddlekit's storage is metered per plan instead, 100MB on Free up to 50GB on Team."
---
## Where Huddlekit charges and MarkLayer doesn't

Huddlekit's free plan is one project, three team members and 100MB. The limits are honest, and plenty of [freelancers](/for/freelancers) will live inside them for a while, but the second client project is the moment the $16 starts. MarkLayer has no project count and no member count: a share link is the whole unit, and you can mint as many as you want.

The paid tiers buy real things. Pro adds custom breakpoints, tags, folders, comment pausing and MCP. Team adds the integrations, API access and a 15-member cap. If you were going to pay for exactly one of those, it is probably the integrations.

## Private comments and video are Huddlekit's, outright

Two things on Huddlekit's list have no MarkLayer counterpart at all. The first is private comments: a workspace member can mark a comment team-only, and a guest on the share link never sees it. Agencies use this for the "the client is wrong about the font but we'll say it nicely" conversation. MarkLayer has one channel per room. If you need to talk behind the client's back, you talk in Slack.

The second is video. Huddlekit pins a comment to the exact second of an uploaded video, up to 2GB on Team. MarkLayer reviews PDFs and images up to 25MB with the same drawing and comment tools it uses on a web page. It does not do video.

## Staging sites, logins and who needs what installed

Huddlekit reviews a site behind a staging password or basic auth inside its normal project, usually by taking the password once. For an app behind a real login it goes the other way, with a one-line script tag so the widget loads inside your app for anyone already signed in. Neither needs a browser extension. The script does need someone with deploy access to add it.

MarkLayer's web app fetches the page from its own server, anonymously, so a password-protected page shows the password prompt. The answer for that case is the free browser extension: it runs in your own tab, where you are already logged in, and overlays the page there. That covers staging, localhost and apps behind a login without touching the app's code. The share link carries the annotations and the URL rather than a copy of the page, so a reviewer on a protected site opens the same page in their own logged-in browser and joins the room from the extension too. On a protected page, everyone installs; on a public one, nobody does.

## What each one does with a tracker

This is the paid difference most teams will feel. Huddlekit's Team plan turns a comment into a Linear issue, a ClickUp task, a Notion page, a Trello card or an Asana task, and keeps status in sync: complete the Asana task and the comment resolves, resolve the comment and the task completes. Slack gets the comment too, and you can resolve from the Slack message. Jira has no direct connection; Zapier or a webhook can reach it.

MarkLayer files one Linear, GitHub or Jira issue, or one Trello card, per thread, for free, and posts the ticket URL back into the thread once. After that the two stop talking. It also posts new annotations to Slack, Teams, Discord or any webhook, batched when several land at once. For a team with a tracker of record, Huddlekit's sync is the better deal and $33 is a fair price for it. For a team that files a handful of visual bugs a week, one-way is fine.

## Breakpoints, grids and inspect

Huddlekit lets a Pro project pick the screen sizes it opens at and compares them side by side, draws a column grid per breakpoint, and outlines every element in an x-ray view. Inspect mode reads element styles on every plan.

MarkLayer's device overview shows desktop, tablet and mobile side by side on one screen, with the open comment count per width, but the widths are fixed rather than custom. It has ruler guides, a measure tool and an inspector that builds a Markdown block for an agent, with the element's selector, computed styles and the detected React, Vue or Svelte component. Different shapes for different readers: Huddlekit's inspect is for a designer checking a padding value, MarkLayer's is for pasting into a prompt.

## The agent on the other end

Both tools now connect to Claude Code and Cursor over MCP, and they take almost opposite approaches.

Huddlekit's is deliberately cautious. It needs Pro or Team, every teammate approves their own OAuth connection scoped to one workspace, and it starts read-only. Grant write and the agent can set status, reply, tag and assign. It still cannot create or delete comments. For an agency that wants an agent to triage without adding noise, that is the right default.

MarkLayer's is built for the agent to do the work. Every share link is itself an MCP server, so `claude mcp add --transport http marklayer https://marklayer.app/s/<id>/mcp` is the whole setup. It costs nothing. The agent watches the room live, acknowledges a thread so the reviewer sees it is in progress, resolves or dismisses it with a reason, and replies. It can also go first: look at the page, leave its own comment pins, and propose exact text replacements the reviewer accepts as a diff. The one thing it can never do is mark a thread approved. That stays with the human.

## Live review versus project review

Huddlekit is organised around projects, folders and a kanban board, which is what an agency running six clients wants. MarkLayer has a kanban board too, with status columns on every link, but no folders and no workspace above the link.

What MarkLayer has instead is the room. Live cursors show who is looking where, and a peer-to-peer voice or video call runs in the same tab, so a design review happens on the page rather than over a screen-share of it. Huddlekit's site doesn't advertise live cursors or calls. If your reviews are async and ticket-shaped, that is no loss. If they are "hop on and look at this with me", it is the main reason to pick MarkLayer.

## Who should not switch from Huddlekit

Agencies whose client feedback needs a private back-channel, whose deliverables include video, or whose workflow closes the comment when the Asana task closes. Those three are what the Pro and Team plans sell, and MarkLayer does not try to copy them.

Everyone else is choosing between a project workspace that costs $16 to $39 a month and a share link that costs nothing. The [full list of free Huddlekit alternatives](/alternatives/huddlekit) sorts the paid options by what they add.
