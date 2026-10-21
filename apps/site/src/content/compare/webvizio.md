---
order: 19
title: "Webvizio vs MarkLayer: $8/Month Plans vs a Free MCP Link"
description: "Webvizio runs $8 to $76 a month billed yearly, for 2 to 20 users and 5 to 100 projects. MarkLayer is free, no account, and every share link is an MCP server."
intro: "MarkLayer is a free, open-source Webvizio alternative: paste a URL, annotate the live page, share a link, and nobody on either side makes an account. Webvizio sells four plans, from Solo at $8 a month for 2 users and 5 projects to Advanced at $76 for 20 users and 100 projects, and its extension captures console logs, network logs and repro steps that MarkLayer does not. Both hand work to AI coding agents over MCP; Webvizio's agent reads a task and closes it, while MarkLayer's can also reply, leave its own annotations and propose text edits."
competitor: "Webvizio"
competitorTagline: "a paid website feedback and bug-reporting tool that captures technical logs and turns each report into a prompt for AI coding agents"
homepage: "https://webvizio.com"
bottomLine: "Choose MarkLayer for free, real-time annotation with live cursors, voice calls and an AI agent that can reply, annotate and suggest edits on the same link. Choose Webvizio if your agent needs console logs, network logs and repro steps with every bug, or you want time tracking, video recordings and Trello, Jira and ClickUp integrations inside one paid workspace."
quote: "Webvizio's Solo plan is $8 a month billed yearly for 2 users and 5 projects, and Advanced lists at $76 for 20 users (checked October 2026). Both include its MCP server. MarkLayer's costs nothing, needs no API key, and lets the agent reply, annotate and suggest edits, where Webvizio's one write is closing a task."
published: 2026-10-11
modified: 2026-10-21
rows:
  - feature: "Price"
    ml: "Free"
    them: "Solo $8/mo, Starter $28/mo, Advanced $76/mo billed yearly ($10, $35, $95 monthly); Enterprise on request. 7-day trial, no free plan"
  - feature: "Plan limits"
    ml: "None. A share link is the whole unit, and you can make as many as you want"
    them: "Solo 2 users and 5 projects; Starter 5 and 10; Advanced 20 and 100"
  - feature: "Sign-up required"
    ml: "No, for anyone"
    them: "Yes for the workspace; guests comment without registering on Starter and above"
  - feature: "Apps behind a login"
    ml: "Via the free browser extension"
    them: "Via the Chrome extension, overlaid on the logged-in page"
  - feature: "Console, network and repro-step capture"
    ml: "No. Browser, OS and viewport on every comment left in the browser"
    them: "Yes, from the extension: browser details, console logs, network logs and user actions"
  - feature: "Video recordings"
    ml: "No"
    them: "Yes, in-app recordings"
  - feature: "PDF and image review"
    ml: "Yes, up to 25MB per file"
    them: "Yes, in the web app; 25MB per attachment on Solo and Starter, 100MB on Advanced"
  - feature: "Device widths"
    ml: "Desktop, tablet and mobile side by side on one screen"
    them: "Mobile review at a range of resolutions"
  - feature: "Real-time live cursors"
    ml: "Yes"
    them: "Not advertised"
  - feature: "Voice and video calls in the room"
    ml: "Yes, peer to peer"
    them: "Not advertised"
  - feature: "Kanban board"
    ml: "Yes, status columns on every link"
    them: "Yes, task boards on every plan"
  - feature: "Task tracker integrations"
    ml: "One way. Files a Linear, GitHub or Jira issue or a Trello card; nothing syncs back"
    them: "Trello, Jira, ClickUp and Zapier on every plan, plus Figma and Cursor"
  - feature: "Chat notifications"
    ml: "Slack, Microsoft Teams, Discord or any webhook, free"
    them: "Slack notifications and webhooks on every plan; REST hooks on Advanced"
  - feature: "AI coding agent access (MCP)"
    ml: "Every share link is an MCP server, so there is nothing to install. Agents can watch, resolve, reply, leave their own annotations and suggest text edits"
    them: "Local npm server with an API key, on every plan. 12 tools read tasks, prompts, logs and screenshots; the one write closes a task"
  - feature: "Time tracking"
    ml: "No"
    them: "Yes, on Starter and above, with exportable reports"
  - feature: "Open source"
    ml: "Yes"
    them: "No"
  - feature: "Best for"
    ml: "Fast, free review of any page, live or async, with an agent on the other end"
    them: "QA testers and agencies who want technical bug reports routed to a tracker or an agent"
chooseMl:
  - "You want visual feedback that costs nothing, with no user or project count to outgrow."
  - "You review together: live cursors and a voice call on the page instead of a ticket read later."
  - "Your agent should talk back, by replying in the thread, pinning its own findings or proposing a text change you accept as a diff."
  - "You want open source you can read, audit or self-host."
chooseThem:
  - "Your bug reports need console logs, network logs and the steps that led to the error. Webvizio's extension records all three; MarkLayer records none."
  - "You want each task turned into a ready-made prompt for Cursor or Windsurf, with the logs and a screenshot attached."
  - "You record short videos to explain a change, or need in-app video alongside comments."
  - "You bill clients by the hour and want a time tracker and exportable time reports in the same tool."
  - "Your work lives in ClickUp or goes through Zapier, which MarkLayer does not reach."
faq:
  - q: "Is MarkLayer a free Webvizio alternative?"
    a: "For annotating a live page and sharing a link, yes, and the person who starts the review needs no account either. It does not replace Webvizio's console and network capture, repro steps, video recordings or time tracking."
  - q: "How much does Webvizio cost?"
    a: "Per its pricing page on 11 October 2026: Solo at $8 a month billed yearly or $10 monthly, for 2 users and 5 projects; Starter at $28 yearly or $35 monthly, for 5 users and 10 projects; Advanced listed at $76 yearly or $95 monthly, for 20 users and 100 projects, shown with a 40% promo code; and Enterprise by quote. There is a 7-day trial of Advanced with no card. Guests and viewers are free, on Starter and above."
  - q: "Does Webvizio have a free plan?"
    a: "No. Its FAQ describes four paid plans and a 7-day free trial of the Advanced plan. MarkLayer has one version, free, with every tool in it."
  - q: "How do the two MCP servers differ?"
    a: "Webvizio's is an npm package, @webvizio/mcp-server, that runs locally with an API key from your Webvizio settings. Its 12 tools list projects and your assigned tasks, and fetch a task's description, AI prompt, error, console, network and action logs, and screenshot; the only change it can make is to set a task to Done. MarkLayer's is free and needs no install, because every share link answers MCP at /s/<id>/mcp. Its 12 tools let an agent watch a room live, acknowledge, resolve, dismiss or reply, leave its own comment pins, and propose exact text edits that the reviewer accepts as a diff."
  - q: "Can MarkLayer capture console logs like Webvizio?"
    a: "No. MarkLayer records browser, OS and viewport on comments left in the browser, and its inspector gives an agent the element's selector, computed styles and detected component. It captures no console logs and no network requests. If your bugs are JavaScript errors rather than visual ones, Webvizio's extension is the better fit."
  - q: "Does MarkLayer work on a page behind a login?"
    a: "With the free browser extension, yes: it runs in your own tab, where you are already logged in, and overlays the page there. Webvizio's Chrome extension works the same way. The plain MarkLayer web-app link fetches the page from MarkLayer's server with no credentials, so it only shows public pages."
  - q: "What happens to a MarkLayer link if nobody claims it?"
    a: "It is deleted 90 days after its last view, comment or edit, and any of those resets the clock. Claiming it with the free magic-link account removes the idle clock. Webvizio limits active projects per plan instead, and Advanced can archive finished ones to free a slot."
---
## Where Webvizio charges and MarkLayer doesn't

Webvizio has no free plan. The 7-day trial opens the Advanced tier, and after that the cheapest seat is Solo: $8 a month billed yearly, $10 monthly, for 2 users and 5 projects. Solo also leaves out guest access, so a client who comments without registering means Starter at $28 a month, with 5 users and 10 projects. Advanced lists at $76 for 20 users and 100 projects, and the pricing page was showing a 40% code against it in October 2026.

Guests and viewers do not count as seats on Starter and above, which is fair to agencies with lots of clients. MarkLayer has no seats to count. A share link is the unit, anyone with it can comment, and the person who made it never signed up either.

## Bug reports with the logs attached

This is Webvizio's strongest card, and MarkLayer does not hold it. Webvizio's extension records browser details, console logs, network logs and the user's actions as repro steps, and packs them into the task. For a QA tester filing JavaScript errors, that context is the bug report.

MarkLayer records browser, OS and viewport on each comment and stops there. Its inspector builds a Markdown block for an agent with the element's selector, computed styles and the detected React, Vue or Svelte component, which helps with a padding or copy fix and does nothing for a failed API call. If most of your bugs live in the console, pick Webvizio.

## The agent on the other end

Both tools sell the same idea, feedback an AI coding agent can act on, but they build it differently.

Webvizio's MCP server ships on npm as `@webvizio/mcp-server`. You run it locally with Node 18 and an API key from your Webvizio settings, paste a task link into Cursor or Windsurf, and the agent pulls the description, a prepared prompt, the error, console, network and action logs, and the screenshot. Eleven of its 12 tools read. The twelfth sets the task to Done, and Webvizio's own instructions say to ask the agent to close it once you have checked the work. It is on every plan, Solo included.

MarkLayer's is built for a two-way conversation. Every share link is itself an MCP server, so `claude mcp add --transport http marklayer https://marklayer.app/s/<id>/mcp` is the whole setup. It needs no key and no install. The agent watches the room live, acknowledges a thread so the reviewer sees it is in progress, resolves or dismisses it with a reason, and replies with a question. It can also go first: read the page, leave its own comment pins, and propose exact text replacements the reviewer accepts as a diff. The one thing it can never do is mark a thread approved. More on [how bug-report MCP servers compare](/guides/bug-report-mcp-servers).

Put plainly, Webvizio feeds the agent better evidence and MarkLayer gives it a voice in the review.

## Live review versus task review

Webvizio is organised around a workspace: projects, folders, tags, a Kanban board, due dates, a time tracker on Starter and above, and in-app video recordings. That is a project-management tool with a feedback layer on top.

MarkLayer has a kanban board too, with status columns on every link, but no folders and no workspace above the link. What it has instead is the room. Live cursors show who is looking where, and a peer-to-peer voice or video call runs in the same tab, so a design review happens on the page. Webvizio's site does not advertise live cursors or calls. Desktop, tablet and mobile render side by side on one MarkLayer screen; Webvizio reviews mobile across a range of resolutions.

## Trackers and notifications

Webvizio lists Trello, Jira, ClickUp and Zapier on every plan, along with Slack notifications, webhooks, Figma and a Cursor integration. Advanced adds REST hooks and several webhooks per event.

MarkLayer files one Linear, GitHub or Jira issue, or one Trello card, per thread, and posts the ticket URL back into the thread once. After that the two stop talking. New annotations go to Slack, Teams, Discord or any webhook, free. ClickUp and Zapier are not on its list.

## Who should not switch from Webvizio

QA teams whose reports depend on console and network logs, agencies that bill by the hour from the tracker, and anyone who explains changes on video. Those are the parts of Webvizio that cost money for a reason, and MarkLayer does not try to copy them.

If the job is marking up a live page with a client or a teammate and handing the threads to an agent, the comparison is $8 to $76 a month against a link that costs nothing.
