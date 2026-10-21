---
order: 11
title: "Website Feedback Tool for Agencies: Free, No Client Login"
description: "Run client review rounds on the live site. Clients comment from a link, feedback goes to Slack, Linear or Jira, and nobody pays per seat as the roster grows."
h1: "MarkLayer for Agencies"
nav: "Agencies"
audience: "web and digital agencies running review rounds across several clients and projects at once"
bottomLine: "For an agency, MarkLayer is a feedback layer that scales with the client list instead of the invoice. Every project gets its own share link, clients open it in any browser without an account or an extension, and the account manager forwards what comes in to Slack, Linear, GitHub or Jira with a per-room integration. It is free with no seats, and open source under Apache 2.0, which is the fastest way through a client's security review."
problem: "An agency does not have a feedback problem, it has twelve of them running at once. Client A sends a PDF of screenshots with arrows, client B replies to a six-month-old email thread, client C's marketing lead texts the account manager a photo of a monitor. The account manager translates all of it into tickets, the developer asks which page and which viewport, and the revision round costs a day before any work starts. The paid tools fix this by charging per seat, and an agency's seat count is the one number that only goes up."
published: 2026-10-11
modified: 2026-10-21
why:
  - "Clients never sign up or install anything. They open the share link in their browser and the comment tool is already loaded, so the first review round starts the day you send the link."
  - "One link per project, one room per link. Each client sees only their own page and their own comments, and you configure nothing."
  - "Comments pin to the actual element, with its selector and the text that was under the pin. The developer opens the link and lands on the thing the client meant."
  - "Each comment carries a priority (low to urgent), a status (open, in progress, resolved, approved, dismissed) and an assignee, so the account manager can triage a round without leaving the page."
  - "Feedback goes out to where the team already works: Slack, Microsoft Teams, Discord, a plain webhook or Zapier for notifications, and Linear, GitHub, Jira, Trello or Notion for filing a thread as an issue. These are one-way, out of MarkLayer only. Nothing syncs back."
  - "Free with no per-seat pricing, so adding a client, a contractor or a new account manager changes nothing on the bill."
  - "Open source under Apache 2.0 and deployable to your own Cloudflare account, which is the answer to the enterprise client who asks where their staging site's comments live."
steps:
  - name: "Open the staging site"
    text: "Paste the client's staging URL into marklayer.app, or open the page in Chrome and click the extension if the site sits behind a login."
  - name: "Pre-annotate the round"
    text: "Pin the questions you want answered and mark the sections that changed since the last round, so the client comes to a guided review instead of a blank page."
  - name: "Connect the team's channel"
    text: "Open the room's info panel in the viewer and add a Slack, Teams or Discord destination. New client comments post there as they arrive."
  - name: "Send the client one link"
    text: "Email or message the share link. The client opens it in whatever browser they use, with no account and nothing to install."
  - name: "Triage and hand off"
    text: "Set a priority and an assignee on each thread. File the ones that are real work to Linear, GitHub, Jira, Trello or Notion from the thread itself, then mark it resolved when the fix ships and let the client approve it."
faq:
  - q: "Do our clients have to create an account?"
    a: "No. The share link is the access mechanism. Anyone who has it opens the annotated page in their browser and can comment, reply and mark up the page. There is nothing to sign up for on either side. Optional magic-link accounts exist for people who want a dashboard of their own rooms, but a client never needs one."
  - q: "Can we keep clients from editing each other's projects?"
    a: "Every project has its own share link and its own room. A client who has the link for their project cannot see any other room. Treat the link like a password and send it only to the people who should be in that review."
  - q: "How do the integrations work, and do they sync back?"
    a: "Integrations are configured per room and only send out of MarkLayer. Slack, Microsoft Teams, Discord, a generic webhook and Zapier receive a message for each batch of new comments. Linear, GitHub, Jira, Trello and Notion receive one issue or page when someone files a specific thread from inside MarkLayer. Closing the issue in Jira does not change the thread in MarkLayer, and editing the thread does not update the issue. The tracker's token is supplied at the moment of filing and is not stored with the room, so a leaked share link is not a leaked credential."
  - q: "How is this different from BugHerd or Marker.io?"
    a: "Both are built for agencies and both are good at it. They charge per seat, and they capture browser and OS metadata that MarkLayer does not. MarkLayer is free and open source, and clients need no onboarding. If your clients are the kind who will not install anything and your team is tired of per-seat math, start here. See the [BugHerd comparison](/vs/bugherd) and the [Marker.io comparison](/vs/marker-io) for the detail."
  - q: "What about security review from a client's IT team?"
    a: "The code is public under Apache 2.0, so a reviewer can read what the worker does with their page. Annotations are private until the link is shared and are removed 90 days after the room was last opened. For clients who need the data to stay in their own account, the worker, database and storage deploy to Cloudflare from the repository."
  - q: "Does it work on a password-protected staging site?"
    a: "Through the web app, no: it fetches the page from MarkLayer's server with no cookies, so a login wall shows its login wall. Use the free Chrome extension in your own signed-in tab, and have each reviewer join the room from theirs. See [staging sites with no extension](/for/staging-feedback-no-extension) for both paths."
  - q: "How long do a project's comments stay available?"
    a: "90 days after the last time someone opened the room. Any visit or comment resets the clock, so an active project never expires. When a project wraps, fetch the room's JSON from marklayer.app/api/{id} if you want a record."
---

An agency's review round is a handoff between people who do not share tools: the client who reviews, the account manager who translates, and the developer who fixes. MarkLayer puts all three on the same page. The client comments on the live site from a link, the account manager triages with priority and status, and the developer gets the thread in Linear or Jira with the element it refers to. A client needs no onboarding, and the next client costs nothing extra.

If most of your review rounds are with a single client at a time, the shorter [client feedback](/for/client-feedback) page covers that flow.
