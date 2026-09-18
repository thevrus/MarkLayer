---
order: 10
title: "Send Website Feedback to Jira, Linear, Slack or GitHub"
description: "MarkLayer posts annotations automatically to Slack, Teams, Discord and a webhook, and can file any single one as a Jira, Linear or GitHub issue. What arrives where, where the tokens live, and the one-way limit worth knowing before you rely on it."
h1: "Sending MarkLayer annotations to Jira, Linear, Slack and more"
intro: "MarkLayer can send annotations to seven places: Slack, Microsoft Teams, Discord, a generic webhook, Linear, GitHub and Jira. The four chat destinations post automatically as feedback arrives. The three issue trackers wait for you to pick one annotation and file it. Nothing about a filed issue's later status flows back into MarkLayer, in either direction."
bottomLine: "Slack, Teams, Discord and a generic webhook post automatically, every new batch of annotations going out with no one touching a button. Linear, GitHub and Jira are manual: pick one annotation, file it as a single issue, and MarkLayer hands you the link. All seven connections are one-way. A comment marked resolved in MarkLayer and a ticket marked closed in Jira are two separate facts kept by two separate systems, and nothing keeps them in sync."
published: 2026-09-17
modified: 2026-09-17
faq:
  - q: "Which tools can MarkLayer send annotations to?"
    a: "Seven. Four are chat destinations that post automatically: Slack, Microsoft Teams, Discord and a generic webhook. Three are issue trackers you file into by hand, one annotation at a time: Linear, GitHub and Jira. A room can have up to five of these seven connected at once, in any mix. There is no MarkLayer account needed to set any of them up; the connection is stored on the room itself, in the panel on the right of any share link."
  - q: "Does MarkLayer sync with Jira, Linear or GitHub after I file an issue?"
    a: "No. Filing creates one issue and MarkLayer reads its URL back exactly once, to show you a link to what it made. After that the two systems have no connection. If someone closes the Jira ticket, reassigns the Linear issue or comments on the GitHub issue, MarkLayer never finds out and the annotation's own status does not change. If you need a comment's status to track a ticket's status, this is not that tool; see BugHerd or Marker.io instead."
  - q: "Where does MarkLayer store my Jira, Linear or GitHub API token?"
    a: "It doesn't. For those three trackers the token stays in the browser of whoever connected them and is sent straight to Linear, GitHub or Jira at the moment an issue is filed. The room only keeps the non-secret parts: the repository name, the project key, the team id, the issue type. Chat webhooks work differently, because the webhook URL itself is the credential. That URL is stored with the room, and anyone holding the share link can see its last four characters and remove it."
  - q: "What does MarkLayer post to Slack, Teams or Discord automatically?"
    a: "One message per new batch of annotations, headed 'N new annotations', with up to eight lines underneath. Each line names the author, the kind of mark, a priority tag, and the annotation's text cut to 300 characters. Two links follow: one to the live page being annotated, one to the MarkLayer room. No screenshot is attached and no CSS selector is included; the message is text only. Discord trims the whole thing to 2,000 characters, adding '...and N more' if it runs long."
  - q: "How many destinations can one MarkLayer room have connected?"
    a: "Five, out of the seven available, in whatever combination you want: three chat channels and two trackers, one of each and a webhook, five chat destinations, and so on. There's no ranking among them; all five fire on their own terms, chat ones automatically and tracker ones only when someone files into them by hand. Removing one frees a slot immediately, so the five is a live count, not a lifetime cap."
  - q: "What happens if a Slack or Discord post fails to send?"
    a: "It fails quietly. MarkLayer counts the failure internally but does not surface it to anyone in the room, so a dead webhook can sit silent for a while before someone notices feedback stopped arriving in the channel. That is different from filing an issue, where the person clicking gets told exactly why it failed. If a chat integration goes quiet, check the webhook still exists at the other end; MarkLayer will not tell you it broke."
  - q: "What happens if filing a Jira, Linear or GitHub issue fails?"
    a: "The person who clicked sees a specific reason. Common ones are a bad or expired token, a project or repository that no longer exists, or the destination rate-limiting the request. Nothing silent happens here, because a manual file is a single deliberate action, not a background job. Outbound requests to any destination time out after five seconds, never follow a redirect, and are refused outright if they resolve to a private or loopback address."
  - q: "Should I use MarkLayer's integrations instead of a bug tracker?"
    a: "Use them alongside one, not instead of one. MarkLayer is a fast way to get a specific comment in front of a team, in the exact format that channel or tracker already expects, without anyone copying and pasting a screenshot. It was never built to keep an issue's lifecycle in sync, and it doesn't try to. If a project genuinely needs two-way status, assignment and comment sync, BugHerd and Marker.io are both built for exactly that; MarkLayer isn't a replacement for either."
---

## Which tools can MarkLayer send annotations to?

Seven, and they split into two kinds that behave nothing alike.

| Destination | Trigger | What arrives |
| --- | --- | --- |
| Slack | Automatic | Every new batch of annotations, as one message |
| Microsoft Teams | Automatic | The same batch, formatted for a Teams webhook |
| Discord | Automatic | The same batch, trimmed to a 2,000-character limit |
| Webhook | Automatic | A JSON body to an endpoint you control |
| Linear | Manual | One annotation, filed as one Linear issue |
| GitHub | Manual | One annotation, filed as one GitHub issue |
| Jira | Manual | One annotation, filed as one Jira issue |

Chat destinations don't wait for anyone. The moment a new annotation lands in the room, it goes out on its own. Issue trackers do the opposite: nothing is filed until a person opens the room's panel, picks one specific annotation, and files it, which is what stops a busy review from quietly generating forty tickets nobody asked for.

A room can hold five of these seven connected at once, in whatever mix makes sense: two chat channels and a tracker, all four chat destinations, five trackers if somehow you needed that. No account is required for any of it. Every field lives in the panel on the right of any share link, and setup takes about a minute per destination.

## What the automatic chat message actually contains

Every batch is one message, and the shape is the same whether it lands in Slack, Teams or Discord. A heading reads "N new annotations", and underneath it sit up to eight lines, one per mark, each carrying the author's name, the kind of annotation it was (a comment, a pin, a highlight), a priority tag, and the annotation's own text cut down to 300 characters if it runs longer. Two links close out the message: one straight to the page being reviewed, one to the MarkLayer room itself.

That's the whole payload. No screenshot rides along, and no CSS selector either, because the message is meant to be read by a person scanning a channel, not parsed by a machine. If your team wants the raw data instead of the readable summary, the generic webhook is the one built for that, and it's covered below.

Discord enforces its own 2,000-character ceiling on top of the shared format. When eight full lines would run past it, MarkLayer trims the list and adds "...and N more" so the count is still visible even when the detail isn't.

## Setting up Slack, Teams, Discord or a webhook

Each of the four chat destinations asks for one field, and the field's name tells you exactly what to paste.

| Destination | Field | Where it comes from |
| --- | --- | --- |
| Slack | Incoming webhook | Slack's own Incoming Webhooks app, scoped to one channel |
| Microsoft Teams | Incoming webhook | A channel's Connectors panel in Teams |
| Discord | Webhook URL | A channel's Integrations tab in Discord |
| Webhook | Endpoint | Any URL you control that can accept a POST |

The webhook destination is the one worth a second look if a team wants to route feedback into something MarkLayer doesn't natively support, a spreadsheet, a custom dashboard, an internal alerting tool. It receives a small JSON body on every new batch:

```json
{
  "type": "annotations.new",
  "room": "https://marklayer.app/s/abc123",
  "page": "https://example.com/pricing",
  "items": [
    { "kind": "comment", "author": "Priya", "text": "This button is unreadable on dark mode.", "priority": "high" }
  ]
}
```

Point that endpoint at anything that can read JSON over HTTP, and the rest of the pipeline is identical to Slack or Discord: it fires the moment new work lands, with no polling and nothing to trigger by hand.

## Filing an annotation as a Jira, Linear or GitHub issue

This is a deliberate action, not a feed. Open the panel on a share link, connect the tracker once, then go to any single annotation and choose to file it. MarkLayer creates exactly one issue and hands back a link to it. That's the entire interaction; nothing else in the room changes, and no other annotation is touched.

The issue itself is built from two things: the annotation's text, truncated to 120 characters, becomes the title, and the body carries the full text, the author's attribution, the page's URL and a link back to the room. That's enough for whoever picks up the ticket to trace it back to the exact comment and the exact page without needing MarkLayer open at all.

Each tracker asks for its own set of fields before it will accept a filed issue.

| Tracker | Fields required |
| --- | --- |
| Linear | API key, Team ID |
| GitHub | Access token (fine-grained, Issues write), Repository (owner/name) |
| Jira | Site, Account email, API token, Project key, Issue type |

GitHub's token needs to be fine-grained and scoped to Issues write access on the target repository specifically; a token with no repository access, or read-only Issues access, will connect but fail the moment someone tries to file. Jira asks for the most fields of the three because a Jira issue needs a project and an issue type decided up front, where Linear and GitHub both infer a sensible default.

## Where are the API tokens stored?

Nowhere on MarkLayer's server, for the three issue trackers. The token you paste in for Linear, GitHub or Jira stays in the browser of whoever set the connection up, and it's sent directly to that tracker's API at the moment an issue is filed. The room itself only stores the parts that aren't secrets: the repository name, the project key, the team id, the chosen issue type. Anyone else looking at that room's settings sees the destination is connected, but never sees a credential that could file on their behalf from a different browser.

Chat webhooks are the one place this differs, and it's worth saying plainly rather than glossing over. A Slack or Discord webhook URL is itself the credential; there's no separate token to keep apart from it. That URL has to be stored with the room for the automatic posting to keep working, which means anyone holding the share link can see the last four characters of it and can remove the connection outright. It's a smaller blast radius than a full API key (a webhook URL only lets someone post to one channel, nothing else), but it is stored, and a room shared too widely is a room where that webhook can be pulled by someone who shouldn't have the ability to.

## Does it sync back?

No, and this is the single most important thing to understand before building a workflow around any of the seven. Every connection here is one-way, out of MarkLayer, with no return path.

For chat destinations there was never a return path to begin with; a Slack message doesn't get edited by anything happening later in the room. For issue trackers, the one moment MarkLayer looks back at the destination at all is right after filing, when it reads the new issue's URL once so it can show you a working link. Past that single read, MarkLayer has no idea what happens to the ticket. Someone can close it, reassign it, comment fifty times, or delete the whole project, and the annotation sitting in MarkLayer keeps whatever status it had before any of that happened.

If a workflow needs the reverse direction, an annotation flipping to resolved because a linked ticket closed, MarkLayer cannot do it and isn't trying to. That gap is intentional rather than a missing feature: adding real two-way sync means polling or webhooking three different vendors' APIs on their schedule, which is a different product with a different cost and a different failure surface than a free annotation tool.

## What happens when something fails?

Differently, depending on which side you're on.

An automatic chat post that fails, because the webhook was deleted, the channel is gone, or the destination is down, fails silently from the room's point of view. MarkLayer counts the failure on its own side but doesn't push a notice into the room, so a broken Slack integration can go unnoticed until someone in the channel asks why feedback stopped showing up. Worth checking periodically if a channel has gone quiet for longer than seems right.

Filing an issue is the opposite. It's a single click by a single person, so that person gets a specific reason the moment it fails: an expired or wrong token, a project or repository that no longer exists, or the destination itself rate-limiting the request. There's no ambiguity to sit with, because someone is watching the exact moment it happens.

Underneath both paths, every outbound request MarkLayer makes to any of the seven destinations times out after five seconds and never follows a redirect. Requests that would resolve to a private or loopback address are refused before they're sent, the same guard that keeps the page proxy itself from being pointed at internal infrastructure.

## What this does not do

Say it plainly: this is not a bug tracker, and it doesn't pretend to be one going into any of the seven destinations above. Nothing syncs back, ever, from any of them. Chat messages carry text only, no screenshot and no CSS selector, so a teammate reading Slack still has to open the room to see the mark itself. Filing an issue makes exactly one issue per click; there's no bulk export of forty annotations into forty tickets, and there's no editing an already-filed issue from inside MarkLayer afterward.

If the actual need is a ticket whose status, assignee and comments stay live and current with the work being done on it, buy a real tracker built for that loop. [BugHerd](/vs/bugherd) and [Marker.io](/vs/marker-io) both keep that connection alive in a way MarkLayer deliberately does not attempt. MarkLayer's honest place in that stack is the fast, free layer in front of it: the tool that gets a specific comment onto a live webpage and into the right channel in under a minute, not the system of record for what happens to it next.

For the rest of what's on a room, the sixteen drawing tools, live cursors, voice and video, the full list is on [the features page](/features). None of this costs anything either; see [pricing](/pricing) for what that means in practice, which is that there isn't any. If an AI coding agent is the one meant to act on these annotations rather than a human filing tickets by hand, [the MCP setup guide](/guides/claude-code-visual-feedback) and [how MarkLayer's agent tools compare to other vendors'](/guides/bug-report-mcp-servers) cover that separate, two-way path in full.
