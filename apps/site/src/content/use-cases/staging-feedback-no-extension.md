---
order: 0
title: "Annotate a Staging Site for Client Review (No Extension)"
description: "Paste your staging URL and share one link. The client comments in their browser, no extension, no account. Password-protected staging needs the free extension."
h1: "How to get client feedback on a staging site without asking them to install anything"
nav: "Staging sites, no install"
audience: "agencies, freelancers, and product teams sharing staging URLs"
bottomLine: "MarkLayer lets clients annotate a staging URL in their own browser with no extension, no account, and no PDF screenshot loop. Open the web app at marklayer.app, paste the staging URL, share the link. The client sees the live page with a comment-pin tool already loaded. Works on any staging URL the public internet can reach; a password-protected one needs the free browser extension on each side instead, running in the tab where that person is already logged in."
problem: "The default flow is broken. You ship a staging URL. The client opens it on their phone, takes a screenshot, types 'this is broken' in iMessage, and you have no idea which button they meant. You ask for screenshots in your project management tool, and the screenshots arrive without URLs. You suggest a paid annotation platform, and the client refuses to sign up. Half your feedback cycle becomes 'which page were you on when this happened?'."
published: 2026-01-30
modified: 2026-10-21
why:
  - "The recipient does not need a Chrome extension or any other install. They open the link in their browser and the comment-pin tool is already loaded."
  - "No account, no signup, no email collected from the client. The friction that kills review cycles is gone."
  - "Works on any URL the public internet can reach: your staging environment, production, a third-party page you do not own."
  - "The web app fetches the page from MarkLayer's server with no cookies or credentials, so a password-protected staging site shows its password prompt. For that case the free browser extension overlays the page in your own logged-in tab, and each reviewer joins the same room from their own extension, signed in to the staging site as they already are."
  - "Real-time cursors mean you and the client can review the page together on a call, with each cursor visible, which removes the need to screen-share or to say \"click the thing under your cursor.\""
  - "Free for every client engagement with no per-seat math."
steps:
  - name: "Open the MarkLayer web app"
    text: "Go to marklayer.app in your browser. You do not need the Chrome extension for this flow. The web app is the no-install path."
  - name: "Paste the staging URL"
    text: "Drop the staging environment URL into the input. MarkLayer loads the live page inside a viewer with the annotation toolbar overlaid."
  - name: "Walk through the work"
    text: "Optionally pre-annotate sections you want feedback on, or pin questions for the client to answer in place. Skip this if you want the client to come at it cold."
  - name: "Share one link"
    text: "Click Share. Copy the generated link. Email, Slack, or text it to the client. No account on either side."
  - name: "Client annotates in their browser"
    text: "The client opens the link, sees the live staging page with the comment tool loaded, and drops pins where they have feedback. Threaded replies anchor to the spot on the page they refer to."
  - name: "Review async or together"
    text: "You see new comments in real time. Jump on a call with live cursors when you want to walk through them, or pick up the thread async."
faq:
  - q: "Does my client need to install a Chrome extension to leave feedback?"
    a: "No. The whole point of this flow is that the client uses the web app on marklayer.app, which needs neither an extension nor an account. The Chrome extension is only needed for pages the web-app viewer cannot load: password-protected or VPN-only staging, and some heavy-CSP single-page apps. On those, each reviewer runs it in their own logged-in tab (see the next question)."
  - q: "Does this work on a password-protected staging site?"
    a: "Not through the plain web-app link. The web app fetches the page from MarkLayer's server, and that request carries no cookies, no Authorization header and no VPN, so a password-protected or VPN-only staging site shows its login prompt instead of the page. Use the free browser extension there: it runs inside your own tab, where you are already signed in, and overlays the page you see. The share link carries the annotations and the URL. It holds no copy of the page, so a reviewer on a protected site also opens it in their own logged-in browser and joins the same room from the extension's settings panel."
  - q: "How long does the share link stay live?"
    a: "Annotations on a share link persist for 90 days from last activity (see the cleanup cron in the codebase). For longer review cycles, a single comment or page view resets the timer."
  - q: "Can multiple clients review the same staging URL at once?"
    a: "Yes. Open the same share link in multiple browsers and you see real-time cursors for everyone on the page. Useful for stakeholder reviews where three people argue about the same button."
  - q: "What's the difference between this and asking for feedback in Loom?"
    a: "A Loom video is 90 seconds of the client narrating what is wrong. MarkLayer is a 3-second pin saying 'this button.' For specific, visual feedback the pin wins. For walkthroughs where motion or voice tone matters, Loom is the better fit. Use both."
  - q: "How is this different from Markup.io or Pastel?"
    a: "Markup.io and Pastel are agency-grade paid platforms with project workspaces and version tracking. They charge per seat. MarkLayer is free, has no per-seat fee, and skips the project-workspace layer. If you want the workflow scaffolding, Pastel is the better fit. If you want the annotation to work in 30 seconds with no client onboarding, MarkLayer is."
---

Asking a client to install a Chrome extension before they can leave feedback on your staging site is friction you can't afford. With MarkLayer, you paste the staging URL into the web app, share the generated link, and the client opens it in their browser. They annotate the live page in place. No install, no signup, no PDF screenshot dance.
