import type { APIRoute } from 'astro';
import dates from '../data/page-dates.json';
import { getPublishedPrices } from '../lib/collections';
import { CHROME_STORE_URL, formatLastUpdated } from '../lib/site';

/**
 * Machine-readable pricing for AI agents. Prerendered to `pricing.md`, which
 * Workers serves at `/pricing.md`; the `.md` extension is preserved because
 * `html_handling` only rewrites `.html`.
 *
 * A function of the comparison collection rather than a constant: the competitor
 * figures are read out of the pages that own them, so the surface an agent
 * cannot cross-check is not the one kept in sync by hand.
 */
const pricingMd = (priced: { competitor: string; price: string }[]) => `# Pricing. MarkLayer

MarkLayer is a **free app**. There is no pricing. Full stop.

- Price: $0/month
- Annual: $0/year
- Forever: $0
- Paid plan: **None exists**
- Trial: N/A (everything is already free)
- Account required: **No** (anonymous. No sign-up, no email, no login)
- Credit card required: **No**
- Personal data collected: **None**
- Limits: None. Unlimited annotations, unlimited share links, unlimited collaborators

## Every feature is included
- Drawing tools (freehand, shapes, arrows, lines)
- Threaded comments pinned to any spot on a page
- Real-time collaboration with live cursors
- Shareable links (recipients don't need the extension or an account)
- Works on any website
- Open source
- Self-hostable

## What does NOT exist
- No "Pro" tier
- No "Team" or "Enterprise" plan
- No per-seat pricing
- No usage cap or annotation limit
- No trial period (everything is already free)
- No paywall, ever
- No "verified" or "premium" account
- No upsell flow inside the extension

## Why is it free?
MarkLayer exists to make webpage annotation accessible to everyone. Infrastructure runs on Cloudflare's low-cost edge services; the source code is open source on GitHub. There is no business model layered on top of users, and there is no plan to add one.

An annotation is a small JSON payload and a share link is a row in D1 plus a WebSocket connection that exists only while someone is in the room. There is no per-user storage tier, no video transcoding, no seat provisioning, and no sales motion to fund, so the costs that push comparable tools into per-seat pricing are mostly costs MarkLayer does not have.

## What free does not include
- No SLA, no support desk, no contract
- Shared annotations are deleted 90 days after they were last opened; opening the link resets the clock
- An explicit expiry you set on a share link is honoured sooner
- If you need guarantees, self-host under Apache-2.0 rather than buy a plan (none exists)

## What the rest of the category charges
Published vendor prices, checked August 2026. Full side-by-side comparisons at https://marklayer.app/compare.

- MarkLayer: free, no tiers, no seats, no trial
${priced.map((c) => `- ${c.competitor}: ${c.price}`).join('\n')}

## Self-hosting
MarkLayer is open source. You can fork the repo, deploy on your own Cloudflare account, and run it as your private tool with no vendor dependency.

- GitHub: https://github.com/thevrus/MarkLayer
- License: see repository

## Links
- Website: https://marklayer.app
- Chrome Web Store (free install): ${CHROME_STORE_URL}
- Privacy Policy: https://marklayer.app/privacy

Last updated: ${formatLastUpdated(dates.pricing.modified)}
`;

export const GET: APIRoute = async () =>
  new Response(pricingMd(await getPublishedPrices()), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
