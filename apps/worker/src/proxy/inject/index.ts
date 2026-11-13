import type { Env } from '../../env';
import { errorRelayScript, networkErrorRelayScript } from '../../error-relay';
import type { FetchedPage } from '../fetch';
import { blockedNotice } from './blocked';
import { fetchShimScript } from './fetch-shim';
import { historyGuardScript } from './history';
import { keysScript } from './keys';
import { linksScript } from './links';
import { readyScript } from './ready';
import { scrollBridgeScript } from './scroll-bridge';
import { stampScript } from './stamp';

/**
 * The block every proxied page starts with. Order is load-bearing: the stamp's `replaceState`
 * resolves against the document URL, so it has to run before `<base>` lands, and `ml-ready`
 * follows `ml-blocked` so a viewer that hears ready has already heard any refusal.
 */
export function injectedHead({
  resp,
  baseUrl,
  selfOrigin,
  env,
}: {
  resp: FetchedPage;
  baseUrl: URL;
  selfOrigin: string;
  env: Env['Bindings'];
}): string {
  return [
    stampScript({ origPath: baseUrl.pathname + baseUrl.search }),
    fetchShimScript({ selfOrigin, baseUrl }),
    `<base href="${baseUrl.origin}/">`,
    errorRelayScript(selfOrigin),
    networkErrorRelayScript(selfOrigin),
    historyGuardScript(),
    linksScript({ selfOrigin }),
    scrollBridgeScript({ selfOrigin }),
    keysScript({ selfOrigin }),
    blockedNotice({ resp, env, selfOrigin }),
    readyScript({ selfOrigin }),
  ].join('');
}
