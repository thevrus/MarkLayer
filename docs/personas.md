# Personas (provisional)

Written August 2026. Companion to [voc-quote-bank.md](./voc-quote-bank.md).

**Read this header before using any persona below.**

MarkLayer has effectively no first-party customer data yet. The Product Hunt launch sits
at 1 point with no comments five months on, PostHog is not authorised for this workspace,
and Amplitude holds a different product. So none of these personas are built from
MarkLayer's own users. They are built outward from proxy sources, which is the correct
method when a product has no reviews yet, but it means every one of them is a hypothesis
with a source attached, not a finding.

Each persona carries an evidence line saying exactly what it rests on and how strong that
is. Persona A is worth acting on. Persona B is a reasonable bet. Persona C is a bet on a
market that does not yet search for this. Where a field has no evidence it is left blank
on purpose rather than filled in plausibly.

Replace proxy evidence with first-party evidence as real users arrive. Revisit quarterly.

---

## Persona A. The solo web designer

**Evidence: strongest of the three.** Two independent first-person practitioner accounts
([Morgan](https://studiomooregan.com/markup-io-alternative-workflow/),
[Katelyn Dekle](https://launchthedamnthing.com/blog/markup-alternatives-for-client-website-design-feedback)),
corroborated by unbiased search-demand data and by two vendor blogs describing the same
buyer. Still below the five-independent-sources bar, so treat the specifics as directional
and the shape as sound.

**Profile**
- Title range: freelance web designer, solo studio owner, "design partner"
- Company size: 1, occasionally 2 to 3
- Platforms: Showit, Squarespace, WordPress. Not custom React builds.
- Clients: small businesses, photographers, wellness and service brands
- Buys their own tools out of a thin personal stack

**Primary job to be done**
Get a client to say precisely what they want changed, on the page where they want it
changed, without the client needing to learn anything.

- Functional: collapse a revision round from days of clarifying emails into one pass
- Emotional: stop feeling like they are chasing and decoding their own client
- Social: look organised and professional to a client who is paying them

**Trigger events**
- A tool they relied on raises its price or kills its free tier. This is the live one:
  Markup.io went from $29 to $79/month and discontinued the free plan in early 2025.
- A revision round goes badly and costs unbilled hours
- Taking on enough concurrent clients that per-seat or per-project pricing starts to bite

**Top pains**
1. Feedback arrives as an email saying "can you make the button blue?" with no indication
   of which button or which page. Corroborated independently by a second source
   describing "vague emails saying 'the button looks wrong'".
2. Screenshots arrive with no URL attached, so the first reply is always asking which
   screen they were on.
3. Clients refuse, or simply fail, to sign up for another platform.
4. Tool cost is measured against their whole stack, not against competitors. On $79/month:
   "That's more than I spend on Showit, Google Workspace, and my project management tool
   combined."

**Desired outcomes**
- The client clicks around the live site and leaves comments on the spot where they want
  the change
- No login required for clients. Stated as a hard must-have, not a nice-to-have.
- Works across Showit, Squarespace and WordPress without per-platform setup
- Affordable for a one-person business

**Objections and fears**
- "Will this get expensive later?" They have been burned once and now read the fine print.
- "Will my comments disappear?" A three-day comment window was cited as the reason for
  rejecting one competitor. Our 90-day cleanup is squarely in scope of this fear and must
  be stated plainly rather than discovered.
- "Is a free tool safe to put in front of a paying client?"

**Alternatives they consider**
Email and screenshots (the real incumbent), Markup.io before the price change, Pastel,
Ruttl, Workflow.design, doing nothing and absorbing the revision rounds.

**Key vocabulary**
"revision round", "client", "draft", "the live site", "leave comments on the spot",
"no login for clients", "sign-off". Never "bug", "triage", "ticket" or "repro".

**How to reach them**
- Search, against "markup.io alternative" and the price-increase queries
- Platform-adjacent communities (Showit, Squarespace, WordPress designer circles)
- Not Hacker News

---

## Persona B. The agency producer running client review

**Evidence: weak, vendor content only.** No first-person account of this person was
reached this round. Built from two competitor blogs and from BugHerd's own G2 reviews.
Treat as a hypothesis to validate, not a segment to build for yet.

**Profile**
- Title range: project manager, producer, account or delivery lead
- Company size: roughly 5 to 50, running several client sites at once
- Not the person who writes the code, and not the person who pays the invoice

**Primary job to be done**
Keep feedback from several clients flowing into the team's tracker without becoming the
human router between a client's inbox and a developer's queue.

**Trigger events**
- Onboarding a corporate client whose IT blocks browser extension installs
- Per-seat costs climbing as the team or client list grows
- A release slipping because feedback arrived in three places at once

**Top pains**
1. Feedback scattered across email, Slack screenshots, and, per one vendor account,
   "clients sending design critiques via WhatsApp voice notes"
2. Corporate clients cannot install extensions: "Many corporate clients have restricted
   permissions that prevent them from installing extensions, which can stall the feedback
   process before it begins." This is the strongest argument for our web-app path and it
   deserves its own page.
3. Per-seat pricing punishes growth. Flat team pricing is explicitly preferred.
4. Extensions misbehaving on client sites. From BugHerd's own reviews: "Sometimes the
   Chrome extension will affect other parts of the site in an unintended way" and
   "Sometimes when using javascript heavy websites, the Chrome extension can cause some
   odd behaviour and console errors." Note these come from five-star reviews, so they are
   irritations rather than churn reasons.

**Desired outcomes**
- Feedback lands in Jira, Linear or Trello without manual re-entry
- A record that survives the project, not just the review round
- One predictable bill

**Objections and fears**
- No integrations. This is a genuine gap for this persona, not a positioning problem.
  MarkLayer's honest answer is pasting a share link into the tracker they already use.
- No persistent project workspace
- The 90-day cleanup conflicts directly with "a record that survives the project"

**Alternatives they consider**
BugHerd, Marker.io, Usersnap, Userback, Webvizio, and keeping the current mess.

**Key vocabulary**
Mixed. Uses "client" and "feedback" like Persona A, but also "ticket", "tracker",
"sign-off", "scope". This is the one segment where bug-tracker vocabulary is appropriate.

**How to reach them**
Comparison pages against the paid bug trackers. Not the free-tool queries.

**Unknown, and worth finding out:** team size at which per-seat pain actually starts, who
holds the budget, and whether the 90-day cleanup is disqualifying for them.

---

## Persona C. The developer handing UI context to an AI agent

**Evidence: real pain, unproven demand.** Two Hacker News threads plus category coverage.
The differentiation is genuine and defensible; the market does not yet search for it.
Search volume for this use case is effectively zero.

**Profile**
- Title range: frontend or full-stack developer, indie hacker, technical founder
- Works in Claude Code, Cursor, Codex or Windsurf, against a localhost dev server
- Comfortable running an `npx` command. Will not tolerate a signup wall.

**Primary job to be done**
Tell a coding agent exactly which element on the running page is wrong, without writing a
paragraph of prose describing where it is.

**Trigger events**
- Adopting an agent that writes frontend code and hitting the "it cannot see my screen"
  wall
- An agent repeatedly editing the wrong component

**Top pains**
1. The agent is blind. As one account of the problem puts it, assistants "can't see the
   button they just created, don't know if the layout broke, don't notice that the login
   form ended up behind the footer."
2. Describing an element in prose is slow and the agent still guesses wrong
3. No feedback loop: you cannot tell whether the agent understood which element you meant
   until the diff lands

**Desired outcomes**
- Hand over the selector, the computed styles and the component name in one action
- See the agent's status change on the page

**Objections and fears**
- Distrust of agents making superficial fixes. From the stagewise thread, on a demo:
  "the agent sets a hardcoded 298px height instead of using any of the many
  reliable/solid ways to do it with CSS."
- Signup and pricing opacity. The top critical comment on a direct competitor's launch was
  "Weird how you can't sign up except via the CLI. And pricing isnt posted publicly."
  MarkLayer beats both by construction and should say so.
- Reasonable suspicion that this is a thin wrapper over what devtools already does

**Alternatives they consider**
Playwright MCP, Chrome DevTools MCP, stagewise, pasting screenshots, describing it in
prose.

**Key vocabulary**
"selector", "component", "localhost", "MCP", "context", "the agent". Not "client" or
"revision round".

**How to reach them**
Hacker News, the MCP server registries, the localhost AI-agents page. Keep this persona
below the fold on the homepage; it dilutes Persona A.

---

## What would change these

The fastest way to turn all three from hypotheses into findings, in order of value:

1. Authorise PostHog for this workspace. Whether the people who actually create a room are
   annotating localhost or a client's staging URL settles Persona A versus Persona C in a
   week.
2. Pull the Reddit threads manually, since the crawler is blocked. r/webdev, r/freelance,
   r/web_design and r/agency are where Persona A and B speak candidly.
3. Ask the first ten real users the one question the maker already asked on Product Hunt
   and never got answered: what is your current workflow when you need to leave feedback
   on a webpage.

## Open item, unrelated to personas but found while checking sources

The landing page hardcodes a five-star Chrome Web Store badge
(`aria-label="Rated 5 stars on Chrome Web Store"` with five filled stars in
`apps/worker/web/Landing.tsx`). The listing could not be verified from here because the
Chrome Web Store redirects through a consent wall. A hardcoded rating is worth checking
against the real listing and is worth making honest if the rating count is low, since a
static badge cannot go stale in your favour.
