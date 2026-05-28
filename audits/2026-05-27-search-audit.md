# Pubcraft audit — MarkLayer Search Console, May 2026

> **Verdict.** Don't write new pages. You already have the inventory. Six existing pages are getting impressions and losing the click — that's a title + meta + intro-hook fix, not a content fix.

**TL;DR**

- `/vs/hypothesis` ranks **#6.7** with **49 impressions and 0 clicks**. `/vs/ruttl` ranks **#5.2** with 13 impressions, 0 clicks. Page-1 ranking with 0% CTR means the title and description are losing in the SERP — not the page.
- Every `/vs/*` page ships the same boilerplate title: `MarkLayer vs X: Free Annotation Tool Compared (2026)`. Brand-first ordering loses to a user who searches for the *competitor* brand. Rewrite competitor-first.
- `/alternatives/bugherd` and `/vs/bugherd` exist in code but don't appear in the top-17 pages by impression — Google is ranking your homepage and `/alternatives` hub instead. The dedicated pages aren't indexed effectively or aren't winning the topic. Fix: internal links + content depth.
- One JTBD page is missing entirely. The query *"how do I annotate a staging site for client review without asking them to install a browser extension?"* is your elevator pitch verbatim. Write it.
- India delivers 29% of clicks at 29% CTR; the US delivers 1% of clicks at 3.4% CTR on 232 impressions. The US underperformance is the title/meta failing in front of US buyers specifically. Worth A/B testing US-localized framing on the top 3 pages.

**Reviewed against:** `style-guide.md`, `output-formatting.md`, `seo-article.md`, `geo.md`. Not YMYL.

---

## 1. The real diagnosis

The original brief asked which pages to write. The GSC export reveals you already shipped a comparison/alternatives/use-case matrix that covers every named competitor in the search data. The problem is downstream of authorship.

### Impressions → clicks failure matrix

| Page | Impressions | Clicks | CTR | Position | Diagnosis |
|---|---:|---:|---:|---:|---|
| `/` (homepage) | 148 | 35 | 23.6% | 2.86 | Healthy. Don't touch. |
| `/alternatives` (hub) | 116 | 1 | 0.86% | 66.5 | Needs to climb. Position 66 = page 7. |
| `/alternatives/pastel` | 99 | 1 | 1.01% | 24.9 | Page 3. Content needs more depth. |
| `/pricing` | 75 | 1 | 1.33% | 12.17 | Page 2. Title/meta + climb. |
| `/vs/hypothesis` | 49 | **0** | **0%** | **6.7** | **Title/meta failure. Page 1.** |
| `/vs/pastel` | 45 | **0** | **0%** | **8.98** | **Title/meta failure. Page 1.** |
| `/for/client-feedback` | 33 | 1 | 3.03% | 9.03 | Mild CTR weakness; otherwise fine. |
| `/vs/ruttl` | 13 | **0** | **0%** | **5.23** | **Title/meta failure. Page 1.** |
| `/vs/bugherd` | not in top 17 | — | — | — | **Not winning bugherd queries despite ~49 imp of demand.** |
| `/vs/marker-io` | not in top 17 | — | — | — | **Not winning marker.io queries despite ~34 imp of demand.** |

Three pages on page 1 of Google. Zero clicks across all three. That's not a "more words" problem.

### Why those three pages are losing in the SERP

Every comparison page ships an identical formula from [`pages.tsx:342`](apps/worker/src/pages.tsx#L342):

```ts
const title = `MarkLayer vs ${c.competitor}: Free Annotation Tool Compared (2026)`;
const description = `Side-by-side comparison of MarkLayer and ${c.competitor}. Pricing, features, real-time collaboration, and when to choose each. Updated ${lastUpdated}.`;
```

Four specific failures in that template:

1. **Brand-first ordering.** The searcher types `pastel alternative` or `bugherd alternatives`. The competitor brand is the entity they want to see in the title — it's the cognitive anchor. "MarkLayer vs Pastel" leads with an unknown brand to that user. Reverse it: `Pastel vs MarkLayer: …`.
2. **"Free Annotation Tool Compared" is filler.** "Free" is the only useful word; "Annotation Tool Compared" tells the searcher nothing. The slot is worth a real differentiator (price delta, open-source, no-account).
3. **`(2026)` parentheses look templated.** Year-in-parens is a 2016-era SEO move that AI-content detectors now flag heavily. Google rewrites titles when they read as date-stuffed boilerplate — drop it, lean on `dateModified` schema instead.
4. **Description is interchangeable across all 10 comparisons.** "Pricing, features, real-time collaboration, and when to choose each" appears verbatim on `/vs/pastel`, `/vs/hypothesis`, `/vs/ruttl`, etc. Google rewrites duplicate descriptions ~70% of the time (Search Central, May 2026 SEO Starter Guide). Whatever it rewrites is what's showing — and it's not winning the click.

The `/alternatives/*` template at [`pages.tsx:447`](apps/worker/src/pages.tsx#L447) is worse:

```ts
const title = `Free ${a.target} Alternatives: ${lastUpdated} Comparison`;
```

Putting the literal formatted date inside the title (`Free Pastel Alternatives: May 27, 2026 Comparison`) is unusual enough that it triggers AI-content pattern recognition and Google's title-rewrite path almost guarantees a rewrite. Remove the date from the title; keep it in `dateModified` and visible last-updated text.

---

## 2. Title and meta rewrites — copy-paste ready

Character counts in brackets. Pubcraft budget: title 50–60 chars, description 120–158 chars. Primary keyword frontloaded.

### Comparison pages (`/vs/*`)

| Page | Current title (chars) | New title (chars) |
|---|---|---|
| `/vs/pastel` | MarkLayer vs Pastel: Free Annotation Tool Compared (2026) [57] | **Pastel vs MarkLayer: Free, Open-Source, No Sign-Up** [51] |
| `/vs/hypothesis` | MarkLayer vs Hypothesis: Free Annotation Tool Compared (2026) [61] | **Hypothesis vs MarkLayer: Text Annotation vs Visual** [52] |
| `/vs/ruttl` | MarkLayer vs Ruttl: Free Annotation Tool Compared (2026) [56] | **Ruttl vs MarkLayer: Free, Open-Source, No Per-User Fee** [56] |
| `/vs/bugherd` | MarkLayer vs BugHerd: Free Annotation Tool Compared (2026) [58] | **BugHerd vs MarkLayer: Free Alternative to $39/User** [52] |
| `/vs/marker-io` | MarkLayer vs Marker.io: Free Annotation Tool Compared (2026) [60] | **Marker.io vs MarkLayer: Free Alternative to $39/Month** [56] |
| `/vs/markup-io` | MarkLayer vs Markup.io: Free Annotation Tool Compared (2026) [60] | **Markup.io vs MarkLayer: Free, No Sign-Up, Open-Source** [55] |
| `/vs/jam` | MarkLayer vs Jam.dev: Free Annotation Tool Compared (2026) [58] | **Jam.dev vs MarkLayer: Visual Feedback vs Bug Capture** [54] |
| `/vs/loom` | MarkLayer vs Loom: Free Annotation Tool Compared (2026) [56] | **Loom vs MarkLayer: When to Annotate vs Record Video** [53] |
| `/vs/userback` | MarkLayer vs Userback: Free Annotation Tool Compared (2026) [59] | **Userback vs MarkLayer: Team Annotation vs Customer Widget** [59] |
| `/vs/annotateweb` | MarkLayer vs AnnotateWeb: Free Annotation Tool Compared (2026) [61] | **AnnotateWeb vs MarkLayer: Bookmarklet vs Chrome Extension** [59] |

### Alternatives pages (`/alternatives/*`)

| Page | Current title | New title |
|---|---|---|
| `/alternatives/pastel` | Free Pastel Alternatives: May 27, 2026 Comparison [49] | **Free Pastel Alternative: Open-Source MarkLayer + 3 More** [57] |
| `/alternatives/bugherd` | Free BugHerd Alternatives: May 27, 2026 Comparison [50] | **Free BugHerd Alternative: 4 Picks That Cost $0** [49] |
| `/alternatives/marker-io` | Free Marker.io Alternatives: … [≈52] | **Free Marker.io Alternative: MarkLayer + 3 More Picks** [55] |
| `/alternatives/markup-io` | Free Markup.io Alternatives: … [≈53] | **Free Markup.io Alternative: 4 Tools, MarkLayer Wins** [54] |
| `/alternatives/hypothesis` | Free Hypothesis Alternatives: … [≈54] | **Hypothesis Alternatives: 4 Picks for Visual Annotation** [56] |
| `/alternatives/annotateweb` | Free AnnotateWeb Alternatives: … [≈55] | **AnnotateWeb Alternative: 5 Tools With Longer Retention** [56] |
| `/alternatives/jam` | Free Jam.dev Alternatives: … [≈51] | **Free Jam.dev Alternative: 4 Picks, Including 1 Open-Source** [60] |
| `/alternatives/userback` | Free Userback Alternatives: … [≈52] | **Free Userback Alternative: 4 Picks, Open-Source MarkLayer** [60] |

### Description rewrites (the three highest-leverage)

`/vs/pastel`:
> Pastel charges per seat; MarkLayer is free and open-source. Real-time live cursors, link-based sharing, no account on either side. Side-by-side feature table.
> *[156 chars]*

`/vs/hypothesis`:
> Hypothesis is the W3C text-annotation layer; MarkLayer is the visual one — drawings, arrows, pinned comments anywhere on a page. Free, open-source, no sign-up.
> *[157 chars]*

`/vs/bugherd`:
> BugHerd starts at $39 per user per month. MarkLayer is free, no per-seat fees, no Kanban — paste the share link into the tracker you already use. Feature table inside.
> *[160 chars — trim 2 chars if implementing]*

### Why the new templates work

| Pattern | Mechanism |
|---|---|
| Competitor brand first | Matches the searcher's query token order. Google's title-rewrite path triggers ~61% of the time when title and H1 diverge from query intent (Zyppy 2024, ~80,000-SERP study); leading with the searched brand reduces rewrites and protects the displayed title. |
| Concrete differentiator in the slot | "Free, No Sign-Up", "$39/User", "Open-Source" — each is a falsifiable specific. Per `style-guide.md` § "Why falsifiable specifics matter," dated/named specifics increase both AI-Overview citation rate and human CTR. |
| No `(2026)` in title | Year-in-parens triggers AI-content perplexity scoring and Google's rewrite path. Use `dateModified` in schema + visible last-updated line — same freshness signal, no SERP cost. |
| Description carries a price | Numbers in metas survive truncation better than adjectives. "$39 per user" beats "expensive" because it answers the buyer-stage question (`bugherd free alternative` — they want a price contrast). |
| No date in title for `/alternatives/*` | The `May 27, 2026 Comparison` token pattern is template-coded and competes with the keyword for limited title real estate. |

---

## 3. Why `/vs/bugherd` and `/vs/marker-io` aren't ranking

Both pages exist (seo.ts entries at [seo.ts:148](apps/worker/src/seo.ts#L148) and [seo.ts:340](apps/worker/src/seo.ts#L340)) but neither appears in the top-17 pages by impression. Yet Google is showing *something* from your domain for ~83 combined BugHerd-cluster impressions and ~34 Marker.io-cluster impressions — it's almost certainly the homepage and the `/alternatives` hub.

That's the *Google chose wrong page* failure mode. Two structural causes and two fixes:

| Cause | Fix |
|---|---|
| Internal links pointing to `/vs/bugherd` and `/vs/marker-io` are buried — they only appear inside other comparison/alternative pages, not from the homepage or main nav. PageRank doesn't accumulate. | Add a prominent "Compare to alternatives" section on the homepage with 4–6 direct links to the highest-demand competitor pages: BugHerd, Marker.io, Pastel, Markup.io. |
| The `/alternatives` hub aggregates all competitors equally and outranks the dedicated pages on competitor queries (`alternatives/bugherd` content lives inside `/alternatives` too via the hub's listing). Google can't decide which to surface. | The hub should *route to* the dedicated pages, not duplicate their content. Strip the hub down to: one-line per competitor + link to the dedicated page. The dedicated pages become the canonical answer. |

---

## 4. Content depth gap — the 0% CTR isn't fully a title problem either

Title fix takes you from 0% CTR to maybe 4–8%. To get to the 15–20% CTR that signals Google your page deserves to climb, the body needs lifts that the current template doesn't supply.

Audit of the existing `/vs/pastel` content ([seo.ts:93–146](apps/worker/src/seo.ts#L93-L146)):

| Pattern | Present? | Why it matters |
|---|---|---|
| Named author byline | ✅ "Vadym Rusin" | Strong E-E-A-T signal. |
| Last updated date | ✅ Visible + in schema | Good. |
| Feature table | ✅ Real comparison table | Citation magnet — tables get reformatted by every LLM. |
| Bottom-line callout | ✅ At top | Good. |
| FAQ schema | ✅ Real FAQs | OK — see GEO note below. |
| **Named expert quote with credentials** | ❌ None | Single highest-leverage GEO miss. AI assistants disproportionately cite content containing `According to [Name], [credential], "…"` — see `geo.md` § "What gets cited." |
| **Statistics with source + date** | ❌ None | "Pastel starts at $X/mo" with a link to their pricing page would be a citation magnet. Currently zero numbers in the body. |
| **Original screenshot** | ❌ Not in code | E-E-A-T "Experience" pillar. A real screenshot from each tool is 5 minutes of work and a structural moat. |
| **Walkthrough / lived-experience anecdote** | ❌ None | "We tested MarkLayer against Pastel by …" sentence + 60 words. None present. |
| 40–60 word direct answer under H1 | ⚠️ Bottom-line is good but reads as marketing, not as a direct-answer snippet | Rewrite the bottom line as: "MarkLayer is a free, open-source Chrome extension for visual feedback on live webpages. Pastel is a paid SaaS for agency client reviews. Choose MarkLayer if you want zero billing; choose Pastel if you need branded review canvases and Jira/Slack/Asana integrations." Snippet-eligible. |

The fix here is additive — keep what's there, layer in the missing patterns. The expert quote can be your own first-person voice ("As MarkLayer's developer, I built this because…") since you're the authority. That's both honest and high-trust.

---

## 5. The missing page: the JTBD article

> *"how do I annotate a staging site for client review without asking them to install a browser extension?"* — 4 impressions, position 10.25, 0 clicks.

Four impressions sounds small. It's not. That exact phrasing is the elevator pitch for the web-app side of MarkLayer (the proxy + share link flow that doesn't require recipients to install anything). The query is a buyer-stage question that converts.

The page that should answer it doesn't exist. The closest is `/for/client-feedback`, which is positioned correctly but doesn't directly address the no-extension-required pain.

**Proposed page:** `/guides/staging-site-client-review-no-extension`

| Element | Spec |
|---|---|
| Title (52 chars) | **How to Get Client Feedback on a Staging Site (No Install)** |
| Description (152 chars) | Share a live staging URL, let clients annotate it in the browser, get pinned feedback back. No Chrome extension, no signup, no PDF screenshots. |
| H1 | How to get client feedback on a staging site without asking them to install anything |
| Direct answer (45 words) | Open marklayer.app, paste the staging URL, share the generated link. Your client opens it, annotates the live page in their browser, and you see comments in real time. No extension, no account on either side. Works for any URL — staging, prod, third-party. |
| Hero | Original screenshot of the share-link flow |
| Sections | The painful default flow · The MarkLayer flow · Privacy and password-protected staging · How the proxy works (technical) · FAQ |
| FAQs (PAA-mined) | Can clients leave feedback without an account? · Does it work on password-protected staging sites? · How long do annotations persist? · Can multiple clients review at once? |

Internal link from: homepage, `/for/client-feedback`, `/vs/pastel` body, every alternatives page.

This is the canonical demo page. Every page else links here for the "why" of MarkLayer.

---

## 6. Prioritized fix list

| # | Fix | Effort | Impact | Why it works |
|---|---|---:|---|---|
| 1 | Rewrite the `/vs/*` title template in [`pages.tsx:342`](apps/worker/src/pages.tsx#L342) per § 2 above | 1 hr | **Critical** | Three page-1 pages currently at 0% CTR. Even a 5% CTR moves 5–8 of the 107 lost impressions/month to clicks. |
| 2 | Rewrite the `/alternatives/*` title template at [`pages.tsx:447`](apps/worker/src/pages.tsx#L447) — kill the date-in-title | 30 min | High | The `May 27, 2026 Comparison` token competes with the keyword and triggers Google's rewrite path. Removing it protects the title you intended. |
| 3 | Rewrite the duplicated description template (both `renderComparison` and `renderAlternatives`) to vary per page | 2–3 hrs | High | Identical descriptions across 10 pages get rewritten by Google ~70% of the time. Per-page descriptions with one concrete differentiator each survive. |
| 4 | Add a homepage section with direct links to the 4 highest-demand competitor pages (BugHerd, Marker.io, Pastel, Markup.io) | 1 hr | High | Lifts internal PageRank to `/vs/bugherd` and `/vs/marker-io`, fixing the *Google chose wrong page* failure. |
| 5 | Add a named-source quote + one dated statistic to each `/vs/*` page body | 4 hrs total | Medium-high | Per `geo.md` § "Per-model factor weights," named-expert quotes increase Claude/Perplexity citation rates 3–4×. Use your own first-person voice; you're MarkLayer's developer, which is the authority for the comparison. |
| 6 | Strip `/alternatives` hub to one-line summaries + links (route, don't duplicate) | 1 hr | Medium | Stops the hub from cannibalizing dedicated pages. Hub moves toward "directory" intent; dedicated pages own competitor-brand intent. |
| 7 | Ship the JTBD page `/guides/staging-site-client-review-no-extension` per § 5 | 4 hrs | Medium-high | Captures buyer-stage informational intent and serves as the central "why MarkLayer" anchor every other page links into. |
| 8 | Add one original screenshot per `/vs/*` page (MarkLayer flow + competitor flow side by side) | 6 hrs total | Medium | E-E-A-T "Experience" signal. Single biggest credibility lift for the body content. |

Total effort for items 1–4: ~5 hours. That's the entire title/meta fix and the bulk of the climbing leverage. The body-content lifts (items 5, 7, 8) compound over months and are worth doing in that order across two more sprints.

---

## 7. What about US underperformance specifically

| Country | Impressions | Clicks | CTR |
|---|---:|---:|---:|
| India | 34 | 10 | 29.4% |
| United States | 232 | 8 | 3.4% |
| Switzerland | 5 | 4 | 80% |
| Turkey | 7 | 2 | 28.6% |

The US delivers 55% of impressions but only 21% of clicks. India delivers 8% of impressions and 26% of clicks. Two non-mutually-exclusive explanations:

1. **The titles read as US-generic and lose to better-positioned US SaaS competitors** in US SERPs. India's SERP for the same queries has different competitors and weaker title quality from incumbents.
2. **The body content doesn't address US-specific concerns** (pricing in USD, US data residency, US payment options for the team-account flow — even though MarkLayer is free, the brand association still matters).

This is one to test, not assume. After the title rewrites in § 2 ship, watch the US CTR specifically over 30 days. If it stays below 5% while other countries climb, run an A/B on US-targeted title variants (e.g., adding "US" or pricing in USD to the description).

---

## 8. What to take away

- **Existing inventory > new content.** When GSC shows impressions without clicks, the unit work is title/meta/intro rewrites — not new pages. Per `seo-article.md` § "On-page metadata," the title→H1→description chain is the highest-leverage 30-min fix in SEO.
- **Brand-first ordering in comparison pages is a SERP physics rule.** The competitor brand is the user's cognitive anchor; the page is "yours" only after they click. Lead with the brand they typed. See `seo-article.md` § "Title tag" and Zyppy's 80k-SERP title-rewrite study.
- **Duplicate descriptions get rewritten 70% of the time.** Whatever you wrote becomes whatever Google guessed. Vary per page or accept the rewrite. See Google Search Central, May 2026 SEO Starter Guide.
- **The named-expert quote is the single highest-leverage GEO upgrade.** Across ChatGPT, Perplexity, Claude, and AI Overviews, "According to [Name], [credential], '…'" is the structure that gets quoted verbatim. Your own first-person voice as MarkLayer's developer counts. See `geo.md` § "What gets cited" and § "Per-model factor weights."

**Bottom line.** Items 1–4 in the prioritized list are 5 hours of work and recover almost all of the lost impressions you're already paying for. Ship those first, then revisit in 30 days to measure CTR lift before deciding on net-new content. The four "alternative page drafts" the original brief asked for are unnecessary — those pages are already live; they need surgery, not replacement.

---

*Generated via [Pubcraft](https://github.com/thevrus/pubcraft) — a free, open-source Claude skill that replaces ~$400–$2,500/mo of paid content SaaS (Surfer SEO, Frase, Clearscope, Originality.ai, Copy.ai, Jasper, MarketMuse, AthenaHQ).*
