---
order: 7
title: "BugHerd Free Alternative: 4 Picks, 3 That Cost $0"
description: "BugHerd has no free plan: Standard is $50/month for 5 members; Jira needs the $150 Premium tier. MarkLayer is free, with a status board and one-way filing."
h1: "BugHerd free alternative: 4 picks, 3 that cost nothing"
intro: "BugHerd has no free plan. Standard costs $50 a month for five members, and the Jira, Asana and Linear integrations only unlock on the $150 Premium tier for 25 members. MarkLayer covers the visual-annotation half for free: paste a link, draw on the live page, and file the result into whatever tracker you already run."
target: "BugHerd"
homepage: "https://bugherd.com"
bottomLine: "MarkLayer is the best free BugHerd alternative for the visual-annotation half of bug reporting: draw on the page, sort comments by status, then file one straight into Jira, Linear or GitHub. Markup.io isn't free either. Its Pro plan starts at $79 a month for project-based review with version tracking, useful if you manage a string of client deliverables. GitHub Issues plus manual screenshots is the lowest-effort fallback if you already live in GitHub."
hubBlurb: "From $50/month for 5 members, and $150 for Jira or Linear. MarkLayer is free for the visual-annotation half."
published: 2026-02-02
modified: 2026-09-24
options:
  - name: "MarkLayer"
    url: "/"
    pitch: "Free and open source. Paste a URL and annotate the live page in your browser; the web app needs no account and no extension unless the page sits behind a login. Drawing tools, pinned comments and live cursors cover the annotation itself. A board sorts every comment into status columns, and a one-way integration files a comment into Linear, GitHub or Jira. It tracks no due dates, and a ticket's later status never comes back. An MCP server lets an AI coding agent work the same room."
    bestFor: "Lightweight visual feedback without a paid bug-tracking platform."
  - name: "Markup.io"
    url: "/vs/markup-io"
    pitch: "No longer free. Markup.io dropped its free tier, and Pro now starts at $79/month for 50 MarkUps, scaling to $129 for 100, with unlimited users on one workspace and a 14-day trial. What that buys is project-based review with version tracking, useful if you're managing a string of client deliverables. Feedback stays comment-based, with pin-style markup rather than freehand drawing or live cursors."
    bestFor: "Project-based feedback workflows with version tracking."
  - name: "GitHub Issues + screenshots"
    pitch: "Free if you're already paying for GitHub, but it's a manual loop, not a workflow. Take a screenshot, mark it up in a separate tool, then attach the image to a new issue and describe what's wrong in the body. It works fine for occasional bugs. Filing several a day gets old fast."
    bestFor: "Teams already deep in GitHub Issues who don't mind the manual loop."
  - name: "Hypothesis"
    url: "/vs/hypothesis"
    pitch: "Free and open source. It's built on the W3C annotation standard, and only marks up text: highlights, margin notes, and threaded replies pinned to a passage, not a freehand line, an arrow, or a mark on a broken layout. That solves a different problem than visual bug reporting."
    bestFor: "Scholarly text annotation, not bug reporting."
faq:
  - q: "Does BugHerd have a free plan?"
    a: "No. There's a free trial backed by a 60-day money-back guarantee, but every paid tier starts at $50 a month for 5 members (BugHerd's pricing page, checked September 2026). MarkLayer is the closest free match for the annotation step itself."
  - q: "How much does BugHerd cost at each tier, and what do you get for it?"
    a: "Standard is $50/month for 5 members ($42/month billed annually), with extra seats at $8 each. Studio is $80/month for 10 members, and Premium is $150/month for 25, with a custom Enterprise tier priced on request. Seats aren't the only lever anymore. Jira, Asana, Linear, ClickUp, and Monday.com are Premium-only, while Standard and Studio share a smaller list built around GitHub, Trello, and Slack."
  - q: "Can I self-host a free alternative instead of paying for BugHerd?"
    a: "MarkLayer and Hypothesis are both open source, so you can self-host either one instead of running it as a hosted SaaS product. Not BugHerd or Markup.io. Both are closed source and only available as paid, hosted platforms."
  - q: "What does MarkLayer not offer compared to BugHerd?"
    a: "Due dates, a view across projects, a widget for your own site's visitors, and ticket status that syncs back. MarkLayer does record the browser, operating system and viewport width on every comment, and it files into Linear, GitHub or Jira, but only one way. Trello and Asana aren't supported."
  - q: "Which alternative fits a QA workflow best?"
    a: "Budget matters here. If QA needs due dates, a Kanban board split across multiple projects, and Premium-tier Jira status sync, BugHerd's own feature set is hard to fully replace with a free tool. If QA mainly needs to mark up a bug, sort it by status, and hand it to a tracker, MarkLayer now covers that natively, for free. GitHub Issues plus manual screenshots works fine if you're already a GitHub-only shop."
  - q: "Does BugHerd's Jira integration sync both ways?"
    a: "Only partway, and only on Premium. BugHerd's Jira integration (support docs, checked September 2026) needs the $150-a-month Premium plan, and it syncs one direction automatically: complete the issue in Jira, and the matching BugHerd task moves to done. MarkLayer's Jira, Linear, and GitHub integrations run the other way. Filing creates the ticket, but nothing about its later status comes back."
  - q: "How long does MarkLayer keep an annotated review?"
    a: "An unclaimed link is deleted 90 days after its last view, comment or edit, and each of those resets the clock. Claim it with the free account and the idle window stops applying: the link stays until you delete it or set an end date."
---
## How BugHerd's plans differ

The tiers no longer share one integration list. Standard ($50 a month, 5 members) and Studio ($80, 10 members) get GitHub, Trello, Slack and about a dozen others. Jira, Asana, Linear, ClickUp and Monday.com are Premium only, at $150 a month for 25 members.

So the plan you need depends on your tracker more than your headcount. A three-person team on Jira pays for 25 seats to get the integration. Extra seats on any tier cost $8 a month, or $6.60 billed annually, and every plan comes with a free trial and a 60-day money-back guarantee (BugHerd's pricing page, checked September 2026). The feature-by-feature table is on [MarkLayer vs BugHerd](/vs/bugherd).

## What you give up moving to MarkLayer

A BugHerd free alternative still costs you something. BugHerd's board has due dates and a view across projects. Its embeddable widget lets visitors to your own site report a problem without being invited anywhere. On Premium, closing a Jira ticket moves the matching BugHerd task to done.

MarkLayer's board sorts comments by status (open, in progress, resolved, approved, dismissed), but it has no due dates and no cross-project view. Feedback starts only once someone has the share link. Filing into Linear, GitHub or Jira works one way, so a closed ticket never closes the comment that produced it.

## Setting up each one

On MarkLayer you paste the URL at marklayer.app and share the link, and whoever opens it can draw on the page. Nobody signs up and nothing gets added to the target site. The optional Chrome extension only matters for pages behind a login or on localhost.

BugHerd asks more up front. Your team needs accounts and seats, and for public feedback you add BugHerd's JavaScript snippet to your site's header. That is a one-time cost, and it pays for itself once a team runs many reviews a week. Clients who only leave feedback don't take up a seat on any tier, which matters a lot to agencies.

## How the AI agent handoff compares

Both tools have an MCP server. BugHerd's is in beta and free for all users. Its feature page (checked September 2026) says it gives an agent the client's comment, a screenshot, the page URL, browser and OS, severity, due date and tags, and lets the agent reprioritize a task, mark it done or post a fix summary.

MarkLayer's marklayer-mcp gives the agent the CSS selector, text fingerprint, computed styles and detected React, Vue or Svelte component behind each annotation, plus the whole thread. The agent can watch a room live, acknowledge an item, resolve it with a summary or suggest an exact text edit. It can't set a comment to approved; that stays with the person who asked for the change. Neither tool hands the agent console errors: MarkLayer doesn't capture them, and BugHerd's bug-report docs don't list them.

## Moving an existing BugHerd project over

There's no importer. Moving a review means opening a fresh MarkLayer room on the same URL, redrawing whatever is still open, and filing it into your tracker from there.

For a small backlog that takes minutes. For an agency with twenty live client sites and months of BugHerd threads and screenshots, it's a good reason to finish current engagements in BugHerd and start the next client on MarkLayer.

## Where BugHerd is still the better tool

Structured QA that a client pays for. BugHerd's board goes deeper than MarkLayer's status columns, and on Premium the Jira status comes back on its own. The widget also catches reports from people nobody sent a link to.

If that is the job, BugHerd earns its $50 to $150 a month. If the job is marking up a page and getting the problem into a tracker, MarkLayer does it for free. It just isn't the same tool.
