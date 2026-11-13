import { describe, expect, test } from 'bun:test';
import { commentMetaSchema } from '@marklayer/types/ops';
import { MAX_NETWORK_ERRORS } from '@marklayer/types/relay';
import { ingestNetworkErrors, networkErrorBufferPayload, networkErrors, redactRequestUrl } from './net-errors';

describe('network failure relay', () => {
  test('captures 4xx, 5xx and interrupted requests after removing credentials, query, hash and opaque ids', () => {
    ingestNetworkErrors([
      {
        method: 'get',
        url: 'https://user:pass@example.test/account/alice?token=secret#tab',
        status: 404,
        durationMs: 12,
        at: 1,
      },
      { method: 'POST', url: 'https://example.test/api', status: 503, durationMs: 40, at: 2 },
      { method: 'GET', url: 'https://example.test/private', error: 'TypeError', durationMs: 5, at: 3 },
      { method: 'GET', url: 'https://example.test/ok', status: 200, durationMs: 1, at: 4 },
    ]);
    expect(networkErrors.value).toEqual([
      { method: 'GET', url: 'https://example.test/account/:id', status: 404, durationMs: 12, at: 1 },
      { method: 'POST', url: 'https://example.test/api', status: 503, durationMs: 40, at: 2 },
      { method: 'GET', url: 'https://example.test/private', error: 'TypeError', durationMs: 5, at: 3 },
    ]);
    expect(commentMetaSchema.safeParse({ networkErrors: networkErrors.value }).success).toBe(true);
  });

  test('clips to the shared cap and replaces the previous page buffer', () => {
    ingestNetworkErrors(
      Array.from({ length: MAX_NETWORK_ERRORS + 3 }, (_, i) => ({
        method: 'GET',
        url: `https://example.test/${i}`,
        status: 500,
        durationMs: i,
        at: i,
      })),
    );
    expect(networkErrors.value).toHaveLength(MAX_NETWORK_ERRORS);
    expect(networkErrors.value[0]?.at).toBe(3);
    ingestNetworkErrors([]);
    expect(networkErrors.value).toEqual([]);
  });

  test('does not retain query strings, fragments, credential or account identifiers', () => {
    expect(redactRequestUrl('https://name:pass@example.test/users/123?auth=secret#x')).toBe(
      'https://example.test/users/:id',
    );
  });

  test('main-world hooks fetch and XHR failures, then posts the debounced whole buffer', async () => {
    const oldFetch = window.fetch;
    const oldPost = window.postMessage;
    const oldXhr = globalThis.XMLHttpRequest;
    const oldInstalled = window.__ml_network_errors_installed;
    const posted: unknown[] = [];
    class FakeXhr extends EventTarget {
      status = 500;
      open() {}
      send() {
        this.dispatchEvent(new Event('loadend'));
      }
    }
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      value: async (input: RequestInfo | URL) => {
        if (String(input).includes('/network')) throw new TypeError('Failed to fetch');
        return { ok: false, status: 404 } as Response;
      },
    });
    Object.defineProperty(window, 'postMessage', {
      configurable: true,
      value: (message: unknown) => posted.push(message),
    });
    Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: FakeXhr });
    window.__ml_network_errors_installed = false;
    try {
      networkErrorBufferPayload();
      await window.fetch('/missing?token=secret#fragment');
      await expect(window.fetch('/network')).rejects.toThrow('Failed to fetch');
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/legacy?user_id=42');
      xhr.send();
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({
        type: 'ml-network-errors',
        errors: [
          { status: 404, url: 'https://example.com/missing' },
          { error: 'TypeError', url: 'https://example.com/network' },
          { status: 500, url: 'https://example.com/legacy' },
        ],
      });
      expect(JSON.stringify(posted[0])).not.toContain('secret');
      expect(JSON.stringify(posted[0])).not.toContain('42');
    } finally {
      Object.defineProperty(window, 'fetch', { configurable: true, value: oldFetch });
      Object.defineProperty(window, 'postMessage', { configurable: true, value: oldPost });
      Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: oldXhr });
      window.__ml_network_errors_installed = oldInstalled;
    }
  });
});
