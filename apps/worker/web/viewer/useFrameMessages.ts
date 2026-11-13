import { ingestNetworkErrors } from '@ext/lib/net-errors';
import { ingestPageErrors } from '@ext/lib/page-errors';
import { type Signal, useSignalEffect } from '@preact/signals';
import { type FrameMessage, onFrameMessage } from '../../shared/frame-protocol';
import type { Firewall } from '../../shared/proxy-errors';
import { navigateTo } from '../projects';
import type { RenderFailure } from '../viewerFrame';
import { forwardFrameKey } from './forwardFrameKey';

interface Refusal {
  blockedEgressIp: Signal<string | null>;
  blockedFirewall: Signal<Firewall | null>;
  failRender: (reason: RenderFailure, extra?: Record<string, unknown>) => void;
}

/** The proxy tells "a firewall refused us" from "the origin errored"; only the first gets an address to allowlist. */
function recordRefusal({
  message,
  blockedEgressIp,
  blockedFirewall,
  failRender,
}: Refusal & { message: Extract<FrameMessage, { type: 'ml-blocked' }> }) {
  const failure: RenderFailure = message.reason === 'firewall' ? 'firewall' : 'upstream-error';
  const firewall = failure === 'firewall' ? message.firewall : null;
  blockedEgressIp.value = failure === 'firewall' ? message.ip : null;
  blockedFirewall.value = firewall;
  failRender(failure, { block_reason: message.reason, status: message.status, firewall });
}

interface Bridge extends Refusal {
  frameRef: { current: { contentWindow: object | null } | null };
  frameReady: () => void;
}

/** What the framed page says to the viewer, which `onFrameMessage` takes from that page alone. */
export function bindFrameMessages({
  frameRef,
  frameReady,
  host = window,
  ...refusal
}: Bridge & { host?: Pick<EventTarget, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'> }) {
  return onFrameMessage({
    frames: () => [frameRef.current],
    host,
    handler: ({ message }) => {
      switch (message.type) {
        case 'ml-errors':
          ingestPageErrors(message.errors);
          break;
        case 'ml-network-errors':
          ingestNetworkErrors(message.errors);
          break;
        case 'ml-navigate':
          ingestNetworkErrors([]);
          navigateTo({ url: message.url, source: 'page_link' });
          break;
        case 'ml-blocked':
          recordRefusal({ message, ...refusal });
          break;
        case 'ml-ready':
          frameReady();
          break;
        case 'ml-key':
          forwardFrameKey({ message, host });
          break;
      }
    },
  });
}

export function useFrameMessages(bridge: Bridge) {
  useSignalEffect(() => bindFrameMessages(bridge));
}
