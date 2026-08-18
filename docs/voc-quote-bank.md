# Voice-of-customer quote bank

Verbatim language from real buyers and practitioners, for use in site copy, ads, and
comparison pages. Gathered August 2026.

**Rules for using this file.** Quote marks mean the words are exact. Anything without
quote marks is a paraphrase and must not be presented as a customer quote. Never put a
name or a company beside a quote on a public page without checking the source link
first. When a claim about a competitor's pricing or limits goes on a public page, verify
it against that competitor's own pricing page on the day you publish, because these
numbers move.

**Sample bias to keep in mind.** Two of the strongest sources are solo web designers
writing publicly about switching tools, so they over-represent people who both felt the
pain and had the time to blog about it. Competitor blogs are content marketing and are
labelled as such below. Reddit blocks our crawler, so the largest pool of unfiltered
practitioner language is missing from this round.

---

## Theme 1. The thing being replaced is email and screenshots

The competitor is a workflow, not a product. This is the highest-confidence theme and
the one the homepage should lead with.

> "Can you make the button blue?"

Morgan, solo designer, on what client emails actually say, without specifying which
button or which page.
[studiomooregan.com](https://studiomooregan.com/markup-io-alternative-workflow/)

Same source, paraphrased: clients sent screenshots with no context attached.

What she wanted instead, in her words: clients should be able to

> "click around the actual live site"

and

> "leave comments directly on the spot where they want changes"

**Search-demand support.** The top question in this space is literally
`what are good alternatives to email for client website feedback` (50/mo, plus a
near-duplicate variant at another 50/mo), alongside
`how designers gather website feedback without email`. Source: Semrush US, August 2026.

**Use for:** homepage headline and subline, design-review and client-feedback pages,
cold email opening lines.

---

## Theme 2. Reviewer-side friction decides the purchase

The buyer is not asking what the tool can do. They are asking what they will have to
talk their client into.

> "no login required for clients"

Listed as a hard must-have alongside pinning comments on live sites, a simple interface,
affordability for solo designers, and working across Showit, Squarespace and WordPress.
[studiomooregan.com](https://studiomooregan.com/markup-io-alternative-workflow/)

> "Every login requirement is one more reason a client delays their feedback."

> "A tool has already failed if a client needs a tutorial just to leave a comment."

Both from competitor-published content, so treat as directional rather than as customer
voice. They are useful because they show even competitors concede the point.

**The competitive fact worth repeating.** BugHerd gates extension-free guest feedback
behind a paid tier: if you want clients to submit feedback without installing a browser
extension, you need the Premium plan. Verify against bugherd.com/pricing before
publishing.

**Use for:** the subline, the Markup.io and BugHerd comparison pages, the
"no extension" staging page.

---

## Theme 3. The Markup.io price change created a displaced audience

A dated trigger event with people actively shopping. Highest-intent audience available.

> "That's more than I spend on Showit, Google Workspace, and my project management tool combined."

Morgan, on the $79/month Pro price.
[studiomooregan.com](https://studiomooregan.com/markup-io-alternative-workflow/)

She called the pricing

> "wildly out of touch"

for what she considered basic feedback functionality.

> "pricing out solo designers and lean agencies almost overnight"

[huddlekit.com](https://huddlekit.com/compare/markup-io-alternative), competitor content.

Reported reactions, paraphrased from coverage: for freelancers on the free plan the news
"hit like a gut punch", and many were "scrambling to find new software".

**The numbers.** Free plan discontinued in early 2025. Pro moved from $29 to $79/month,
roughly 2.7x. Some annual customers reported renewals near $1,000/yr, about 350% year
over year. Pro is capped at a single workspace, which pushes multi-client agencies toward
custom Enterprise pricing. These are already documented on
`apps/site/src/content/guides/markup-io-pricing.md`; keep the two in sync.

**Use for:** the Markup.io alternatives and pricing pages, paid search against
"markup.io alternative", the objection FAQ about future price rises.

---

## Theme 4. Who the buyer actually is

Not a QA lead. Not an engineering manager. A one-person design business.

Recurring profile signals across sources: solo freelancer or two-person studio, building
on Showit, Squarespace and WordPress, serving small business clients, paying for their
own tools out of a thin stack, and highly sensitive to anything that adds a step for the
client.

Their vocabulary, which the site was almost entirely missing before August 2026:
revision round, review round, client, draft, feedback, sign-off, staging link.

Vocabulary that belongs to a different and more expensive buyer, and should stay on the
bug-tracker comparison pages only: bug, triage, ticket, QA, repro, console log.

**Use for:** deciding which vocabulary goes on which page. Check a page's target search
intent before importing language from this theme.

---

## Theme 5. Comment retention is a live objection

This audience was burned once and now reads the fine print.

> "comments are tied to a three-day time window"

Given as the reason for rejecting Pastel.
[launchthedamnthing.com](https://launchthedamnthing.com/blog/markup-alternatives-for-client-website-design-feedback)
Not independently verified against Pastel's own documentation, so do not repeat this as
fact on a public comparison page until it is confirmed.

Treated as table stakes by buyers: preserved comment history and visual records,
unlimited projects, and flat pricing rather than per-seat.
[huddlekit.com](https://huddlekit.com/compare/markup-io-alternative)

**Implication for us.** MarkLayer's 90-day cleanup sits directly in this crossfire. It
beats a three-day window comfortably, but "free forever" sitting next to silent deletion
is exactly what this audience punishes. State the 90 days plainly wherever the free claim
appears, and always alongside the fact that any comment or view resets the clock.

**Use for:** every page carrying a "free" or "no limits" claim, and the objection FAQ.

---

## Theme 6. AI-agent handoff: strong differentiator, no search demand yet

Real developer pain, near-zero people searching for a product to solve it. Treat as a
wedge and a reason to believe, not a demand-capture play.

The framing that lands, from coverage of the problem: AI assistants are "completely
blind", they

> "can't see the button they just created, don't know if the layout broke, don't notice that the login form ended up behind the footer"

The alternatives developers actually reach for are Playwright MCP and Chrome DevTools
MCP, not annotation tools.

**Competitor objections we already beat.** On the stagewise Show HN, the top critical
comment was:

> "Weird how you can't sign up except via the CLI. And pricing isnt posted publicly"

[news.ycombinator.com](https://news.ycombinator.com/item?id=45015838). MarkLayer has no
signup at all and no pricing to hide.

Useful scepticism to design against, from the same thread, on a demo where the agent
hardcoded a pixel value:

> "the agent sets a hardcoded 298px height instead of using any of the many reliable/solid ways to do it with CSS"

**Use for:** the localhost AI-agents page, the stagewise comparison, developer-facing
launch copy. Keep it below the fold on the homepage.

---

## Theme 7. Extensions break client sites, and clients notice

A smaller but concrete objection to the extension-first competitors, from their own
G2 reviews.

> "Sometimes the Chrome extension will affect other parts of the site in an unintended way."

> "Sometimes when using javascript heavy websites, the Chrome extension can cause some odd behaviour and console errors."

> "Sometimes there are browser conflicts with clients but that is the only downside."

All from BugHerd reviews via
[findstack.com](https://findstack.com/products/bugherd/reviews). Note these are drawn
from 5-star reviews, so they are mild complaints from satisfied users rather than churn
reasons.

**Use for:** supporting the web-app path over the extension path for client review, and
as a quiet reason-to-believe for the shadow-root isolation in the extension.

---

## Gaps in this round

- Reddit is unreachable by our crawler, which removes the biggest pool of candid
  practitioner language. Pull r/webdev, r/freelance, r/web_design and r/agency manually.
- G2, Capterra and Trustpilot all refused direct fetches. The Markup.io Trustpilot page
  would sharpen Theme 3 considerably.
- No first-party data. PostHog is not authorised for this workspace and Amplitude holds
  a different product, so nothing here is validated against actual MarkLayer behaviour.
- Only about two strong first-person accounts per segment. That is below the five needed
  before building personas, so personas have deliberately not been written yet.
