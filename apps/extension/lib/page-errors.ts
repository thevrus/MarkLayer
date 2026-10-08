import { MAX_PAGE_ERROR_TEXT, MAX_PAGE_ERRORS, type PageError } from '@marklayer/types';
import { signal } from '@preact/signals';

/** `href` is the page the error was thrown on; the web proxy's relay does not stamp it. */
type BufferedError = PageError & { href?: string };

/** The page's most recent errors, replaced wholesale by whichever relay feeds this runtime. */
export const pageErrors = signal<BufferedError[]>([]);

const clip = (s: string) => s.slice(0, MAX_PAGE_ERROR_TEXT);

// A source URL's query and hash routinely carry tokens, and a comment's meta is shared.
const bare = (url: string) => url.split(/[?#]/)[0] ?? '';
const samePage = (a: string, b: string) => a.split('#')[0] === b.split('#')[0];

/** The buffered errors that belong to the page the user is on now: an SPA navigation leaves the old ones behind. */
export function errorsForPage(): PageError[] {
  return pageErrors.value
    .filter((e) => e.href === undefined || samePage(e.href, location.href))
    .map(({ href: _href, ...error }) => error);
}

/**
 * Takes the relay's `ml-errors` payload. Clamped here as well as in the page-side buffer: the
 * message comes from a world the page controls, and an oversize list would fail the op's schema.
 */
export function ingestPageErrors(raw: unknown): void {
  if (!Array.isArray(raw)) return;
  const next: BufferedError[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const message = Reflect.get(item, 'message');
    const source = Reflect.get(item, 'source');
    const line = Reflect.get(item, 'line');
    const at = Reflect.get(item, 'at');
    const href = Reflect.get(item, 'href');
    if (typeof message !== 'string' || typeof at !== 'number') continue;
    next.push({
      message: clip(message),
      ...(typeof source === 'string' && { source: clip(bare(source)) }),
      ...(Number.isInteger(line) && { line }),
      at,
      ...(typeof href === 'string' && { href }),
    });
  }
  pageErrors.value = next.slice(-MAX_PAGE_ERRORS);
}

declare global {
  interface Window {
    __ml_errors_installed?: boolean;
  }
}

/**
 * Runs in the page's MAIN world, where `error` events and `console.error` are visible; the
 * isolated content script sees neither. Injected through `scripting.executeScript` like
 * `bridgePayload`, so it needs no new permission. Self-contained: it is serialised with
 * `.toString()`. The web proxy carries the same logic as a string in `apps/worker/src/proxy.ts`.
 */
export function errorBufferPayload(): void {
  if (window.__ml_errors_installed) return;
  window.__ml_errors_installed = true;

  const buf: { message: string; source?: string; line?: number; at: number; href: string }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Our own scripts run in the isolated world and never reach these listeners; the filter
  // covers an extension page that shares the tab.
  const EXT = /^(chrome|moz|safari-web)-extension:/;
  const push = (message: string, source?: string, line?: number) => {
    if (source && EXT.test(source)) return;
    buf.push({
      message: message.slice(0, 300),
      ...(source ? { source: (source.split(/[?#]/)[0] ?? '').slice(0, 300) } : {}),
      ...(line ? { line } : {}),
      at: Date.now(),
      href: location.href,
    });
    if (buf.length > 10) buf.shift();
    // Debounced: an error in a render loop would otherwise post a message per throw.
    clearTimeout(timer);
    timer = setTimeout(() => window.postMessage({ type: 'ml-errors', errors: buf }, location.origin), 100);
  };

  window.addEventListener('error', (e) => {
    if (e.message) push(e.message, e.filename, e.lineno);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    push(`Unhandled rejection: ${r instanceof Error ? r.message : String(r)}`);
  });
  const orig = console.error;
  console.error = function (...args: unknown[]) {
    try {
      push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    } catch {
      // Reporting must never break the page's own logging.
    }
    return orig.apply(this, args);
  };
}

/** Content-script side: listens for the MAIN-world buffer's posts. Only our own window may speak. */
export function listenForPageErrors(): void {
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.type !== 'ml-errors') return;
    ingestPageErrors(e.data.errors);
  });
}
