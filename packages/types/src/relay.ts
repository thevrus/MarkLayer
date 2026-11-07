/**
 * What crosses between the Worker and the two things it talks to outside a browser
 * tab: the fixed-IP fetch relay (`apps/fetcher`) and the error relay script injected
 * into proxied pages. Dependency-free, because the relay's bundle and the injected
 * script are both built from it: `apps/fetcher` imports the protocol below, and
 * `src/error-relay.ts` interpolates the limits at the end of this file.
 */

/** The relay's one route: `GET /fetch?url=<target>`, bearer-token auth. */
export const RELAY_FETCH_PATH = '/fetch';
export const RELAY_URL_PARAM = 'url';

export const relayFetchUrl = ({ base, url }: { base: string; url: string }): string =>
  `${base}${RELAY_FETCH_PATH}?${RELAY_URL_PARAM}=${encodeURIComponent(url)}`;

/**
 * Response headers. `status` is how the Worker tells the relay's own answer from a
 * target's; `egress` names the address a site owner would allowlist, carried on the
 * response so the Worker never needs a hand-copied secret that silently goes stale.
 */
export const RELAY_HEADERS = {
  status: 'x-ml-relay',
  finalUrl: 'x-ml-final-url',
  egress: 'x-ml-egress',
} as const;
export const RELAY_STATUS_OK = 'ok';
export const RELAY_STATUS_ERROR = 'error';

export const MAX_PAGE_ERRORS = 10;
export const MAX_PAGE_ERROR_TEXT = 300;
