---
order: 4
title: "MarkLayer for Client Feedback: No Install Required"
description: "Send clients a link instead of an email thread. They comment on the live page in any browser, with no account and no extension. Free for every project."
h1: "MarkLayer for Client Feedback"
audience: "solo web designers, freelancers, and agencies running client review rounds"
bottomLine: "For client feedback, MarkLayer removes the onboarding step entirely. Clients click a link and see the annotated draft in any browser, without creating an account or installing anything. It is free for every engagement, so there is no per-seat math as you take on more clients. Being open source also helps it clear security review on the client side."
problem: "A round of revisions usually starts with an email that says \"can you make the button blue?\" without saying which button, on which page. Then come the screenshots with no URL attached, and the reply asking which screen they were on. The other option is signing the client up for a platform they did not ask for, which they resist, so the revision round stretches while you work out what they actually meant."
published: 2026-02-01
modified: 2026-08-15
why:
  - "Clients view annotations and reply in their own browser, with nothing to install."
  - "Comments land on the element the client is looking at, so a revision round stops opening with \"which button?\""
  - "Free means you can use it for every client engagement without per-seat math."
  - "Live cursors enable real-time review calls without screen-sharing."
  - "Open source. Defensible to security-conscious enterprise clients."
  - "No account also means no GDPR/PII headache for casual reviewers."
steps:
  - name: "Open the staging URL"
    text: "Load your in-progress site in Chrome."
  - name: "Activate MarkLayer"
    text: "Click the extension icon to start annotating."
  - name: "Walk through the work"
    text: "Annotate sections you want feedback on, or pin questions for the client to answer."
  - name: "Send one link"
    text: "Click \"Share\". Copy the link and email or Slack it to the client."
  - name: "Review live or async"
    text: "Client opens the link in any browser. Either jump on a call with live cursors or let them comment async."
faq:
  - q: "Will my client need to sign up for anything?"
    a: "No. Recipients of the share link open the annotated page directly in their browser. No account, no install, nothing to configure."
  - q: "Can clients add their own annotations?"
    a: "Clients can reply to threaded comments without installing anything. To create new drawings or arrows, they'd need the extension. Most clients only need to comment."
  - q: "How long do shared links stay live?"
    a: "Annotations are cleaned up 90 days after their last activity, and any comment or page view resets that clock, so an active revision round stays available. For a permanent record, download the annotations as Markdown from the viewer or fetch the JSON from marklayer.app/api/{id} before the round goes quiet."
  - q: "We left a paid tool after a price increase. Could that happen here?"
    a: "There is no plan to raise and no account to lock, so nothing you have already made can be put behind a bill retroactively. The code is open source, so if the hosted version ever changed in a way you disliked, you could run your own copy. The one real limit is the 90-day cleanup above, which applies to everyone equally."
  - q: "Is this safe for confidential client work?"
    a: "Annotations are private until you share the link. There is no public feed. The share link itself is the access mechanism, so share it carefully. For maximum control, MarkLayer is open source and can be self-hosted."
---

Asking a client to install a Chrome extension before they can review your work is friction you can't afford. With MarkLayer, you paste the staging URL at marklayer.app, annotate it in your browser, and send the client one link. They open it in any browser, see your draft with your notes on top, and reply in the same thread. They never create an account or install anything, so the revision round starts on the page itself instead of in an email that says "the button looks wrong."
