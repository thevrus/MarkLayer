---
order: 5
title: "Free Website Annotation Tools in 2026: What Free Includes"
description: "Thirteen website annotation tools checked: which are free forever, which cap a free tier, and which only offer a trial. From vendor pricing pages, September 2026."
h1: "The best free website annotation tools in 2026, audited"
intro: "Three tools in this category have no paid tier at all: MarkLayer, Hypothesis and AnnotateWeb. Everything else marketed as free caps a canvas, a seat or a monthly credit count before the bill starts. Each limit below was read off the vendor's own pricing or help page on 24 September 2026."
bottomLine: "Three tools have no paid tier behind them at all: MarkLayer (no account and no seat cap; an unclaimed link idles out after 90 days), Hypothesis (unlimited annotation, but text only and an account is required) and AnnotateWeb (deletes work after 2 minutes idle). Everything else billed as free is a capped tier sitting in front of a paid plan. Markup.io, BugHerd, Marker.io and Feedbucket have no permanent free plan at all, only a trial."
published: 2026-08-15
modified: 2026-09-24
faq:
  - q: "What is the best completely free website annotation tool?"
    a: "MarkLayer has no paid tier and no feature gate: any page, no seat limit, drawing tools, threaded comments, live cursors and share links, with no account required to create or view one. An optional free account, added in 0.8.0, lets you manage your own links later, but it's a convenience, not a requirement. One link holds up to 50 pages, and the code is open source on GitHub."
  - q: "Which annotation tools stopped being free entirely?"
    a: "Markup.io is the clear case: it discontinued its free tier in 2025, and Pro now runs $79 a month as of September 2026 on markup.io's own pricing page, with only a 14-day trial ahead of it. BugHerd, Marker.io and Feedbucket never had a free tier to lose in the first place; each has only ever sold a trial."
  - q: "Are the free tiers of paid tools usable for real work?"
    a: "For evaluation, yes. For ongoing work, usually not: a one-canvas or one-small-scan allowance runs out the moment a second live project shows up, and the tool-by-tool section above has the exact ceiling for each. Volley is the interesting exception in this table, since its Basic plan claims no card and no expiry at all, though Volley does not publish anywhere what hitting a limit on that plan would even look like. Read the limit that matters for your own workflow before you commit a client to a tool."
  - q: "Do any of these free tools connect to an AI coding agent?"
    a: "MarkLayer does, with no account or plan needed: marklayer-mcp is free on npm. Marker.io and BugHerd include theirs in every paid plan, but neither has a permanent free tier, only a trial. Jam has a free plan and an MCP server, and its docs don't say whether the free tier gets the MCP."
  - q: "Is open source relevant here?"
    a: "It is the difference between free today and free by license. MarkLayer and Hypothesis publish their code, so a price change on the hosted version can't take the tool away the way Markup.io's free tier went. stagewise's toolbar is open source too (AGPLv3), but its newer paid tiers charge for AI model access."
---
## The audit

Checked against each vendor's own pricing or help page, 24 September 2026. Free tools first, then the tools where free now means a trial.

| Tool | Free forever? | What free includes | The catch |
| --- | --- | --- | --- |
| **MarkLayer** | Yes | Any page, no seat limit, drawing, comments, live cursors, MCP for AI agents, up to 50 pages per share link | No feature gate. An unclaimed link expires 90 days after its last view; claiming it removes that clock |
| **Hypothesis** | Yes | Unlimited text annotation, private groups | Text only, and annotating requires a free account |
| **AnnotateWeb** | Yes | Visual annotation on a pasted URL, no account on either side | Work deletes after 2 minutes of inactivity |
| **Volley** | Yes, limits unpublished | Basic plan, no card required, described on Volley's own site as usable "forever" | Volley does not publish a seat or project cap for Basic |
| **Pastel** | Limited | 1 user, 1 active canvas, unlimited guest reviewers | A second canvas needs Pro, $29 to $35 a month |
| **Superflow** | Limited | Starter tier: one small-site scan a month, plus a one-time 30-credit signup bonus | More usage needs a seat on Growth, $24 to $29 a month |
| **Jam** | Limited | 5 creator seats, 30 jams a month, unlimited viewer links | Built for engineering bug reports, not design review |
| **stagewise** | Limited | Open-source toolbar; Hobby tier includes 3 standard AI models | Full model access needs the $20/month Individual tier |
| **Usersnap** | Limited, worded as a trial | 20 feedback items total | Idle free accounts deactivate after 90 days; Starter runs $49 to $59 a month |
| **Markup.io** | No | 14-day trial | Free tier discontinued in 2025; Pro is $79/month |
| **BugHerd** | No | Trial, length not published | From $42 to $50/month for 5 members |
| **Marker.io** | No | 15-day trial, no card required | From $39 to $59/month |
| **Feedbucket** | No | 14-day trial, no card required | From $39 to $49/month |

## What happens when pricing changes

Markup.io's 2025 change is the cautionary tale. Teams that had built client workflows on its free tier were left facing a $79-a-month bill. A tool that is free by open-source license can't strand you the same way, because if the hosted version ever changed its terms, the code would still be there to run. That is the case for MarkLayer and Hypothesis. stagewise's toolbar is open source too, but its paid tiers now meter AI model access, so part of what people use it for has a price.

## The fine print, tool by tool

Pastel's Free plan is one canvas and one user (usepastel.com/plans, checked 24 September 2026). Guest reviewers comment without an account and archived canvases stay reachable, but the moment a second live project shows up, Pro starts at $35 a month billed monthly or $29 billed annually. The head-to-head is at [MarkLayer vs Pastel](/vs/pastel).

Superflow's Starter tier now grants one small-site scan a month (5 AI credits), a one-time 30-credit signup bonus and a 10-day trial of a paid tier. Its pricing page publishes no seat or project limit for Starter, so the credit count is the real ceiling.

Jam's free tier is usable, if narrow: 5 creator seats, 30 jams a month, 5 recording links a month and a 5-minute cap per recording (jam.dev/pricing). It records console logs and network requests automatically, which no other free tier in the table does. [MarkLayer vs Jam](/vs/jam) covers what that trade looks like.

stagewise sits further outside this category than it first looks. Its toolbar, which turns a page element into a prompt for a coding agent, is open source under AGPLv3 and free. But stagewise now calls itself an agent orchestrator, and its Hobby tier limits which AI models you can run without your own API key, which is a different axis from canvases or seats. More at [MarkLayer vs stagewise](/vs/stagewise).

Usersnap's pricing page words its free plan as a trial: "once you have collected 20 feedback items then the trial ends." That is a harder line than a monthly reset. After it, the account needs a paid plan, and Starter has run $49 to $59 a month (last confirmed 29 August 2026; the current page loads its prices with JavaScript, so I couldn't re-read them).

## Does the reviewer need an account, or an extension?

Mostly, the account now sits with whoever runs the review. MarkLayer and AnnotateWeb are the two exceptions where nobody signs up on either side. Pastel, Superflow, Volley and the paid tools keep the account on the review-runner's side and let a guest comment through a link. Jam doesn't publish whether a viewer needs an account to open a recording link. Hypothesis is the outlier: annotating needs a free account plus its browser extension or a bookmarklet, though reading annotations doesn't.

Extensions split the same way. MarkLayer and AnnotateWeb share links open in a plain browser. stagewise is a local toolbar by design, so the question doesn't really apply to it.

## How long free-tier work lasts

Retention is the fact vendors publish least. AnnotateWeb deletes work after 2 minutes of inactivity, and says so on its homepage. MarkLayer deletes an unclaimed link 90 days after the last time anyone opened it; that is `RETENTION_DAYS = 90` in the open-source repository, and claiming the link with the free account takes it off that clock. Usersnap's limit is a count rather than a clock, 20 items, though a dormant free account is deactivated after 90 days.

Pastel's help docs describe canvases staying until someone deletes them. Hypothesis, Superflow, Jam and Volley publish no retention period for free accounts, which is worth knowing before you build a review cycle on one.

## Does the free tier reach an AI coding agent?

For MarkLayer, yes, with no paywall in between. marklayer-mcp is free on npm and gives an agent twelve tools: watch a room live, acknowledge or resolve a comment with a summary, dismiss with a reason, reply, read a page's structure before anyone has annotated it, and suggest an exact text edit shown as a diff. People see every status change as it happens, and the agent can't mark anything approved.

Several paid tools ship one too, checked 24 September 2026. Marker.io's MCP reads a report's screenshots, console and network logs, and its tools can update an issue's status and post a comment; it comes with every paid plan, but there is no free plan under it. BugHerd's is still labelled beta and can mark a task done or post an update, again once you're a customer. Jam's docs list 31 MCP tools without saying which plan includes them. Usersnap markets a feedback connector, but its MCP page returned a 404 when I checked.

## What changed since August

Superflow now describes its free allowance as one small-site scan plus a signup bonus instead of a flat monthly credit figure. Usersnap words its 20-item cap as the end of a trial rather than a standing limit. And MarkLayer 0.8.0 (8 September 2026) added an optional free account: nothing is required to annotate or view, but a claimed link is exempt from the 90-day idle deletion, can be switched to view-only, and shows up in a dashboard of your links.

## When the free tier is not enough

If you need console logs, network requests or screen recording on every report, none of the free-forever tools provide them, MarkLayer included. Jam's capped free tier records console and network data, and Marker.io's paid plans do too. If you need two-way sync so a closed ticket closes the comment, nothing free here offers it; MarkLayer files into Linear, GitHub or Jira one way only. And if a review runs past 20 items on Usersnap, or past 90 idle days on an unclaimed MarkLayer link, you've outgrown the free setup. On MarkLayer, claiming the link fixes that.

For paid pricing across twenty-one tools in this category (the cheapest plan starts at $8 a month), see [website feedback tools compared](/guides/website-feedback-tools). If a BugHerd trial runs out before your project does, [free BugHerd alternatives](/alternatives/bugherd) lists what to try next.

I make MarkLayer, so here is what it doesn't do. No console or network capture. No two-way tracker sync. An idle deletion clock on any link nobody claims, and no way to recover a lost link you never claimed. Desktop only. Its free plan is the right answer in a fairly narrow case: a live page, a reviewer you don't want to push through a sign-up, and a site you can't add a script to. For automatic bug context or a two-way tracker, one of the paid tools above fits better.
