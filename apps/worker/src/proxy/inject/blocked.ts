import { FRAME_MESSAGE } from '../../../shared/frame-protocol';
import type { Env } from '../../env';
import type { FetchedPage } from '../fetch';
import { escapeForScript } from './script-text';

/**
 * A script telling the viewer the page never arrived, or `''` when it did.
 *
 * Reaching here means both the direct fetch and the relay were refused, so the
 * only thing left to be useful with is the relay's own address: that is a single
 * IP a site owner can hand their host, unlike Cloudflare's shared egress, which
 * they would be allowing the entire platform through.
 */
export function blockedNotice({
  resp,
  env,
  selfOrigin,
}: {
  resp: FetchedPage;
  env: Env['Bindings'];
  selfOrigin: string;
}): string {
  if (!resp.challenged && resp.status < 400) return '';
  const reason = resp.challenged ? 'firewall' : 'http';
  // What the relay reported about itself beats a hand-copied secret; the secret
  // is only the answer for the case where the relay never got to speak.
  const ip = resp.egressIp || env.FETCHER_EGRESS_IP;
  const ipJs = ip ? `"${escapeForScript(ip)}"` : 'null';
  const firewallJs = resp.firewall ? `"${resp.firewall}"` : 'null';
  return `<script>window.parent.postMessage({type:"${FRAME_MESSAGE.blocked}",reason:"${reason}",status:${resp.status},via:"${resp.via}",ip:${ipJs},firewall:${firewallJs}},"${selfOrigin}")</script>`;
}
