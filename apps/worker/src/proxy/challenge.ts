import { FIREWALLS } from '../../shared/proxy-errors';

/**
 * Host firewalls (SiteGround, Cloudflare, Imperva, Akamai) answer a server-side
 * fetch with a browser challenge instead of the page, usually as a `200` carrying
 * a meta refresh to a challenge path. Nothing here can solve a CAPTCHA, so the
 * only useful move is to tell the viewer *why* the page is empty.
 */
export const CHALLENGE_PATH = new RegExp(
  [
    ...FIREWALLS.map(({ path }) => path.source),
    '\\/cdn-cgi\\/challenge',
    '_incapsula_resource',
    'distil_r_captcha',
    '\\/_sec\\/cp_challenge',
  ].join('|'),
  'i',
);

/** Titles the well-known challenge interstitials ship with, for the pages that carry no meta refresh. */
const CHALLENGE_TITLE = /<title[^>]*>[^<]*(just a moment|attention required|access denied|security check)/i;

/**
 * Container ids and vendor endpoints the major bot-mitigation products put in
 * their interstitials.
 *
 * These arrive as a plain `200` with an empty `<title>` and no meta refresh, so
 * the status, path and title checks all pass them through. The proxy then called
 * it a success and injected the marker, the challenge's own script navigated the
 * frame off-origin, and the viewer was left holding a blank box whose document it
 * could no longer read — the `SecurityError: Blocked a frame` in telemetry.
 * Measured against booking.com, which ships `challenge-container`.
 *
 * Deliberately narrow: an id attribute or a vendor's own hostname, never a bare
 * product name, so a page that merely writes about a WAF is not mistaken for one.
 */
const CHALLENGE_MARKUP =
  /(id=["']challenge-(container|form|running|error-title)["']|id=["']px-captcha["']|id=["']cf-(wrapper|challenge-running)["']|captcha-delivery\.com|token\.awswaf\.com|geo\.captcha-delivery)/i;

/** Statuses a WAF answers with when it is refusing us rather than reporting a real 404/500. */
const CHALLENGE_STATUS = new Set([401, 403, 405, 429, 503]);

/**
 * Whether this response is a firewall refusing us rather than the page.
 *
 * Judged on the head of the body, because the tell is in the markup: a challenge
 * arrives as a perfectly ordinary `200` (SiteGround sends `202`) whose entire
 * content is a redirect to a CAPTCHA.
 */
export function isChallenged({ status, head }: { status: number; head: string }): boolean {
  return (
    CHALLENGE_STATUS.has(status) ||
    CHALLENGE_PATH.test(head) ||
    CHALLENGE_TITLE.test(head) ||
    CHALLENGE_MARKUP.test(head)
  );
}

/**
 * Whether a sub-resource was refused rather than served.
 *
 * A status check alone is not enough: SiteGround answers a challenge with `202`,
 * and the giveaway is the content type, not the code — a stylesheet or script
 * request that comes back as HTML got an interstitial, not the asset. Judged on
 * the request's own `Accept`, so a genuine HTML sub-resource (an iframe) is not
 * mistaken for one.
 */
export function isRefusedSubResource({ resp, accept }: { resp: Response; accept: string | undefined }): boolean {
  if (CHALLENGE_STATUS.has(resp.status)) return true;
  const wantsHtml = (accept || '').includes('text/html');
  return !wantsHtml && (resp.headers.get('content-type') || '').includes('text/html');
}
