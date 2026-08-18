import type { APIRoute } from 'astro';
import dates from '../data/page-dates.json';
import { CHROME_STORE_URL, formatLastUpdated } from '../lib/site';

/**
 * Machine-readable pricing for AI agents. Prerendered to `pricing.md`, which
 * Workers serves at `/pricing.md`; the `.md` extension is preserved because
 * `html_handling` only rewrites `.html`.
 */
const PRICING_MD = `# Pricing. MarkLayer

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

export const GET: APIRoute = () =>
  new Response(PRICING_MD, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
