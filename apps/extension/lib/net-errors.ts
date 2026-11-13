import type { NetworkError } from '@marklayer/types/ops';
import { MAX_NETWORK_ERRORS, MAX_PAGE_ERROR_TEXT } from '@marklayer/types/relay';
import { signal } from '@preact/signals';
import { pageUrl } from './page-url';

type BufferedNetworkError = NetworkError & { href?: string };
export const networkErrors = signal<BufferedNetworkError[]>([]);

const pageKey = (href: string) => pageUrl(href).split('?')[0] ?? '';

export function networkErrorsForPage(): NetworkError[] {
  return networkErrors.value
    .filter((error) => error.href === undefined || pageKey(error.href) === pageKey(location.href))
    .map(({ href: _href, ...error }) => error);
}

/** Queries, fragments, URL credentials and common opaque path identifiers may carry secrets. */
export function redactRequestUrl(raw: string): string {
  try {
    const url = new URL(raw, globalThis.location?.href ?? 'https://marklayer.invalid/');
    url.username = '';
    url.password = '';
    const parts = url.pathname.split('/').map((part, index, all) => {
      const previous = all[index - 1]?.toLowerCase();
      if (
        [
          'user',
          'users',
          'account',
          'accounts',
          'session',
          'sessions',
          'token',
          'tokens',
          'profile',
          'profiles',
        ].includes(previous ?? '')
      )
        return ':id';
      if (/^[\da-f]{8}-[\da-f-]{27,}$/i.test(part) || /^[a-z\d_-]{24,}$/i.test(part) || part.includes('@'))
        return ':id';
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
    return `${url.origin}${parts.join('/')}`.slice(0, MAX_PAGE_ERROR_TEXT);
  } catch {
    return '';
  }
}

/** Accepts the page/main-world relay and fully replaces the previous page's bounded buffer. */
export function ingestNetworkErrors(raw: unknown): void {
  if (!Array.isArray(raw)) return;
  const next: NetworkError[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const method = Reflect.get(item, 'method');
    const url = Reflect.get(item, 'url');
    const status = Reflect.get(item, 'status');
    const error = Reflect.get(item, 'error');
    const durationMs = Reflect.get(item, 'durationMs');
    const at = Reflect.get(item, 'at');
    const href = Reflect.get(item, 'href');
    if (
      typeof method !== 'string' ||
      typeof url !== 'string' ||
      typeof durationMs !== 'number' ||
      typeof at !== 'number' ||
      !Number.isFinite(durationMs) ||
      !Number.isFinite(at)
    )
      continue;
    if (!(typeof status === 'number' && status >= 400) && typeof error !== 'string') continue;
    next.push({
      method: method.slice(0, 16).toUpperCase(),
      url: redactRequestUrl(url),
      ...(typeof status === 'number' && Number.isInteger(status) && status >= 400 ? { status } : {}),
      ...(typeof error === 'string' ? { error: error.slice(0, 80) } : {}),
      durationMs: Math.max(0, Math.round(durationMs)),
      at,
      ...(typeof href === 'string' ? { href } : {}),
    });
  }
  networkErrors.value = next.slice(-MAX_NETWORK_ERRORS);
}

declare global {
  interface Window {
    __ml_network_errors_installed?: boolean;
  }
}

/** Self-contained main-world hook. It observes failures only and posts a debounced whole buffer. */
export function networkErrorBufferPayload(): void {
  if (window.__ml_network_errors_installed) return;
  window.__ml_network_errors_installed = true;
  type BufferedNetworkError = {
    method: string;
    url: string;
    status?: number;
    error?: string;
    durationMs: number;
    at: number;
    href?: string;
  };
  const buf: BufferedNetworkError[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const redacted = (raw: string) => {
    try {
      const u = new URL(raw, document.baseURI || location.href);
      u.username = '';
      u.password = '';
      const p = u.pathname.split('/').map((part, i, all) => {
        const prev = all[i - 1]?.toLowerCase();
        if (
          [
            'user',
            'users',
            'account',
            'accounts',
            'session',
            'sessions',
            'token',
            'tokens',
            'profile',
            'profiles',
          ].includes(prev ?? '') ||
          /^[\da-f]{8}-[\da-f-]{27,}$/i.test(part) ||
          /^[a-z\d_-]{24,}$/i.test(part) ||
          part.includes('@')
        )
          return ':id';
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });
      return (u.origin + p.join('/')).slice(0, 300);
    } catch {
      return '';
    }
  };
  const push = (method: string, url: string, start: number, result: { status?: number; error?: string }) => {
    buf.push({
      method: String(method || 'GET')
        .toUpperCase()
        .slice(0, 16),
      url: redacted(String(url)),
      ...result,
      durationMs: Math.max(0, Date.now() - start),
      at: Date.now(),
      href: location.href.split(/[?#]/)[0] ?? '',
    });
    if (buf.length > 20) buf.shift();
    clearTimeout(timer);
    timer = setTimeout(() => window.postMessage({ type: 'ml-network-errors', errors: buf }, location.origin), 100);
  };
  const originalFetch = window.fetch;
  window.fetch = function (this: Window, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : null;
    const method = init?.method ?? request?.method ?? 'GET';
    const url = request?.url ?? String(input);
    const start = Date.now();
    return originalFetch.call(this, input, init).then(
      (response) => {
        if (!response.ok) push(method, url, start, { status: response.status });
        return response;
      },
      (reason: unknown) => {
        push(method, url, start, { error: reason instanceof Error ? reason.name : 'NetworkError' });
        throw reason;
      },
    );
  } as typeof window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const requests = new WeakMap<XMLHttpRequest, { method: string; url: string; start: number }>();
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    requests.set(this, { method, url: String(url), start: 0 });
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    ...args: [Document | XMLHttpRequestBodyInit | null] | []
  ) {
    const request = requests.get(this);
    if (request) {
      request.start = Date.now();
      let done = false;
      const finish = (error?: string) => {
        if (done) return;
        done = true;
        if (error) push(request.method, request.url, request.start, { error });
        else if (this.status >= 400) push(request.method, request.url, request.start, { status: this.status });
      };
      this.addEventListener('loadend', () => finish());
      this.addEventListener('error', () => finish('NetworkError'));
      this.addEventListener('timeout', () => finish('TimeoutError'));
      this.addEventListener('abort', () => finish('AbortError'));
    }
    return Reflect.apply(originalSend, this, args);
  } as typeof XMLHttpRequest.prototype.send;
}

export function listenForNetworkErrors(): void {
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.type !== 'ml-network-errors') return;
    ingestNetworkErrors(e.data.errors);
  });
}
