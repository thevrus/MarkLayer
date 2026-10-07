---
order: 11
title: "Open-Source Website Annotation Tools (2026): 8 Checked"
description: "Eight open-source tools for annotating web pages and filing visual bug reports, with the license, self-hosting and reviewer requirements read from each repo."
h1: "Open-source website annotation tools in 2026"
nav: "Open-source tools"
intro: "Of the eight open-source tools checked here, only two let a reviewer mark up a live page you share with them: MarkLayer (Apache-2.0) for visual feedback and Hypothesis (BSD-2-Clause) for text. For open-source bug reports in the style of Jam or BugHerd, BugPin, Crikket and OpenJam fill that gap. Every license below was read from the project's GitHub repository on 7 October 2026."
bottomLine: "For visual feedback on a live page with no account on either side, MarkLayer is the open-source option, and its hosted version is free. Hypothesis is the mature choice for text annotation, but reviewers need an account. For open-source bug reports with console and network logs, BugPin (self-hosted widget), Crikket (self-hosted or paid hosting) and OpenJam (local Chrome extension) replace Jam or BugHerd, each with a narrower scope. Annotator.js, Recogito and Annotorious are libraries for building annotation into your own app, not tools you send a reviewer."
published: 2026-10-07
modified: 2026-10-07
faq:
  - q: "Is there an open-source website annotation tool?"
    a: "Yes. MarkLayer is Apache-2.0 licensed and annotates any live page with drawings, comments and highlights, shared by link with no account or extension for the reviewer. Hypothesis is BSD-2-Clause and annotates text on web pages and PDFs, with a free account required to annotate. Both have a free hosted version and publish their code on GitHub."
  - q: "What is the open-source alternative to Jam.dev?"
    a: "Depends on which part of Jam you need. OpenJam (GPL-3.0) is the closest copy: a Chrome extension that records console, network, errors and a DOM replay into one HTML file, kept locally. Crikket (AGPL-3.0) adds a shared workspace and runs self-hosted for free or hosted from $25 a month. BugPin (AGPL-3.0) is a self-hosted widget that captures annotated screenshots plus failed requests and console errors. Jam itself is proprietary, with a free plan capped at 30 jams a month."
  - q: "What is the open-source alternative to BugHerd?"
    a: "BugPin is the closest in shape: a widget you embed on your own site, reporters need no account, screenshots can be annotated, and reports forward to GitHub Issues. It is self-hosted with Docker and AGPL-3.0 licensed. If you can't add a script to the site, MarkLayer annotates the page through a share link instead. BugHerd is proprietary and has no free tier; Standard is $50 a month for 5 members."
  - q: "Can I self-host MarkLayer?"
    a: "Yes, under Apache-2.0. The backend is a Cloudflare Worker with D1, Durable Objects and R2, so self-hosting means deploying to your own Cloudflare account rather than running a Docker image. The hosted version at marklayer.app is free, so most teams never need to."
  - q: "Does open source mean free?"
    a: "The code is free to run, but hosting it is not always. Crikket's free plan is self-host only, and stagewise is AGPL-3.0 while its hosted tiers charge $20 a month for full model access. What a license guarantees is that a pricing change can't take the tool away: if the hosted version changes terms, the code is still there to run yourself."
---
## The list

Licenses are as GitHub reports them, or as the LICENSE file states where GitHub can't detect one. Stars and last-commit dates were read on 7 October 2026.

| Tool | License | What it annotates | Reviewer needs | Self-host | Hosted price |
| --- | --- | --- | --- | --- | --- |
| **MarkLayer** | Apache-2.0 | Live pages: drawings, comments, highlights, live cursors | Nothing: a link, no account, no extension | Yes, on your own Cloudflare account | Free, no paid tier |
| **Hypothesis** | BSD-2-Clause | Text on web pages and PDFs | Free account, plus extension or bookmarklet to annotate | Yes, two services (h and client) | Free for individuals; institutional prices not published |
| **BugPin** | AGPL-3.0 (widget MIT) | Annotated screenshots, failed requests, console errors | Nothing, if the widget is on the site | Yes, one Docker image | None |
| **Crikket** | AGPL-3.0 | Bug reports: screenshot or recording, console and network logs | Not published | Yes, Docker | Pro $25/month, Studio $49/month |
| **OpenJam** | GPL-3.0 | Bug reports: console, network, errors, DOM replay | Opens a single HTML file | Not needed, runs locally | None |
| **Annotator.js** | MIT or GPLv3 | Text and image selections, in pages you build | Whatever you build | Library | None |
| **Recogito / Annotorious** | BSD-3-Clause | Text (Recogito Text Annotator) and images (Annotorious) | Whatever you build | Library | None |
| **stagewise** | AGPL-3.0 | Page elements in a local dev preview, sent to a coding agent | The stagewise app and an account | Enterprise only | Hobby free, Individual $20/month |

Two tools in this table are products a non-technical reviewer can use today on a page they don't own: MarkLayer and Hypothesis. The bug-report tools need either a widget on your site (BugPin, Crikket) or an extension on the reporter's machine (OpenJam). The libraries need a developer.

## Open-source tools for visual feedback on a live page

MarkLayer ([github.com/thevrus/MarkLayer](https://github.com/thevrus/MarkLayer), Apache-2.0). Paste a URL at marklayer.app, draw and comment on the live page, share the link. The person opening it needs no account and no extension, and several people can mark up the same page at once with live cursors. Annotations can go to an AI coding agent through the free `marklayer-mcp` server. The catch is retention: an unclaimed link is deleted 90 days after anyone last opened it, and claiming it with the optional free account stops that clock. It's also young, with 30 GitHub stars.

Hypothesis ([github.com/hypothesis/h](https://github.com/hypothesis/h), BSD-2-Clause, 3,188 stars) has the most stars of the end-user tools here, and its pricing page is written for schools and universities. It anchors notes and highlights to text, on web pages and PDFs, and keeps them in public or private groups. It doesn't draw, pin a comment to a button, or capture a layout, so it answers "what does this paragraph mean", not "this card is misaligned". Annotating needs a free account and the browser extension or bookmarklet.

## Open-source alternatives to Jam.dev

Jam is proprietary. Its free plan gives 5 creator seats, 30 jams a month and 5-minute recordings, and Team is $14 per creator per month billed yearly ([jam.dev/pricing](https://jam.dev/pricing)). Jam also offers free plans to open-source teams on application, which is different from being open source.

OpenJam ([SaintPepsi/openjam](https://github.com/SaintPepsi/openjam), GPL-3.0) is the closest copy. It's a Chrome extension that captures console output, network requests, errors, screenshots and an rrweb DOM replay, then exports the lot as one self-contained HTML file. There's no server and no account. It also keeps only the latest report and has no way to share it, so you send the file yourself.

Crikket ([redpangilinan/crikket](https://github.com/redpangilinan/crikket), AGPL-3.0, 152 stars) is the fuller product, with screen recordings or screenshots, repro steps, console and network logs, and a team workspace. Its free plan is self-host only; hosted Pro is $25 a month for 15 members ([crikket.io/pricing](https://crikket.io/pricing)). The last commit was on 19 March 2026, which is worth checking before you commit a team to it.

BugPin is the third option, but it works more like BugHerd than Jam, so it's covered below.

None of them captures a session on a page you don't control without an extension, which is also true of Jam.

## Open-source alternatives to BugHerd

BugHerd is proprietary with no free tier. Standard is $50 a month, or $42 billed annually, for 5 members, and extra users cost $8 a month ([bugherd.com/pricing](https://bugherd.com/pricing)).

BugPin ([aranticlabs/bugpin](https://github.com/aranticlabs/bugpin), 44 stars) has the closest shape. You embed a script on your site and a reporter clicks it to file a bug, with no account. The screenshot editor has pen, shapes, arrows, text and blur, and BugPin attaches failed 4xx and 5xx requests, console errors and device details on its own. Reports land in an admin console and can forward to GitHub Issues. You self-host it from a single Docker image, and it's a young project. The server and admin console are AGPL-3.0, the embeddable widget is MIT, and a set of Enterprise Edition features sits under a separate proprietary license.

The limit is the same one BugHerd has: the widget only works on sites where you can add a script. For a client's production site, a competitor's page or anything behind someone else's deploy, MarkLayer reaches the page through a share link instead, though without the console and network capture.

## Libraries, not products

Annotator.js ([openannotation/annotator](https://github.com/openannotation/annotator), MIT or GPLv3, 2,761 stars), Recogito Text Annotator ([recogito/text-annotator-js](https://github.com/recogito/text-annotator-js), BSD-3-Clause) and Annotorious ([annotorious/annotorious](https://github.com/annotorious/annotorious), BSD-3-Clause, 867 stars) let you add highlighting and image regions to pages you build, with storage you provide. They show up in "open source annotation" searches, but you can't hand one to a reviewer and ask for feedback on your staging site. The older RecogitoJS repository is archived and marked deprecated; Recogito Text Annotator replaces it.

## Where stagewise fits

stagewise ([stagewise-io/stagewise](https://github.com/stagewise-io/stagewise), AGPL-3.0, 6,828 stars) is the most-starred project here, and it often appears next to annotation tools because you select elements on a page and send them to an AI agent. Its README now calls it an agentic IDE, it runs against your local dev preview, and it needs the stagewise app plus an account. It's a developer tool, and I wouldn't send a client to it. Hosted plans are free on Hobby (3 models, or bring your own key) and $20 a month for Individual ([stagewise.io/pricing](https://stagewise.io/pricing)). For the head-to-head, see [MarkLayer vs stagewise](/vs/stagewise).

## What the license changes, and what it doesn't

The main thing a license buys you is that a price change can't strand you. Markup.io's users learned this in 2025 when its free plan was discontinued and Pro went from $29 to $79 a month ([details](/guides/markup-io-pricing)). A tool whose code is public under Apache, BSD or GPL can still change its hosted terms, but the code stays runnable.

The license type matters if you plan to modify and host the tool for others. AGPL-3.0 (stagewise, Crikket, BugPin) requires you to publish your changes when you run a modified version as a network service. Apache-2.0 (MarkLayer) and BSD (Hypothesis, Recogito, Annotorious) don't. For a team that just runs the tool internally, either is fine.

You still pay for hosting, though. Self-hosting Hypothesis means running two services; MarkLayer means a Cloudflare account with Workers, D1, Durable Objects and R2; Crikket and BugPin need a server for Docker. If a free hosted tier exists, as it does for MarkLayer and Hypothesis, it is usually the cheaper route.

I make MarkLayer, so I should be plain about its gaps. It doesn't capture console or network logs, can't record the screen, has no widget to embed on your own site, and sends comments to a tracker one way only. If you need any of that in open source, BugPin or Crikket fit better. For the full price comparison including closed tools, see [free website annotation tools](/guides/free-website-annotation-tools).
