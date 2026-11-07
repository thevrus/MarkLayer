import { CHALLENGE_PATH } from './challenge';
import { decodeAttr, encodeAttr } from './html-attr';
import { pxTarget } from './px-path';

// URL schemes that must never be routed through the proxy (non-fetchable or in-page).
const SKIP_SCHEME = /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;

/** Compiled once — `rewriteUrl` runs per attribute while streaming the page. */
const ABSOLUTE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Root-relative `url(/...)` in CSS, routed through the sub-resource proxy at `px`. */
export function rewriteCssUrls({ css, px }: { css: string; px: string }): string {
  return css.replace(/url\(\s*(['"]?)\/(?!\/)/g, (_, quote) => `url(${quote}${px}/`);
}

/** The HTMLRewriter pipeline for one page, with `inject` as the block it opens the document with. */
export function pageRewriter({
  baseUrl,
  selfOrigin,
  inject,
}: {
  baseUrl: URL;
  selfOrigin: string;
  inject: string;
}): HTMLRewriter {
  const origin = baseUrl.origin;
  const host = baseUrl.host;
  /** Route a same-origin sub-resource (absolute, protocol-relative, or relative) through the proxy. */
  const px = `${selfOrigin}/px/${pxTarget(baseUrl)}`;
  const rewriteUrl = (val: string): string | null => {
    const v = val.trim();
    if (!v || SKIP_SCHEME.test(v)) return null;
    if (v.startsWith(`${selfOrigin}/px/`)) return null; // already proxied
    if (v.startsWith(`${origin}/`)) return `${px}${v.slice(origin.length)}`;
    if (v.startsWith(`//${host}/`)) return `${px}${v.slice(host.length + 2)}`;
    // Absolute URLs that don't even mention the target host are cross-origin —
    // skip the WHATWG parse (third-party CDN URLs dominate on real pages, and
    // this runs per attribute while streaming the rewritten HTML).
    if ((ABSOLUTE_SCHEME.test(v) || v.startsWith('//')) && !v.includes(host)) return null;
    // Root-relative paths are the common case on real pages and resolve to
    // exactly this, so answer them with string work rather than a URL parse.
    if (v.startsWith('/') && !v.startsWith('//')) return `${px}${v}`;
    // Resolve the remaining relative URLs against the target base and proxy same-host ones.
    // Required for ES-module scripts (and any [crossorigin] resource): they are always fetched
    // in CORS mode, so loading them cross-origin from the target is blocked. <base href> alone
    // leaves them on the target origin — they must come back through the same-origin proxy.
    try {
      const u = new URL(v, baseUrl);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.host === host) {
        // An http page linking its own https asset keeps https; nothing here downgrades.
        const prefix = u.protocol === 'https:' ? `${selfOrigin}/px/${host}` : px;
        return `${prefix}${u.pathname}${u.search}`;
      }
    } catch {
      // not a resolvable URL — leave it for <base href> to handle
    }
    return null;
  };

  let injected = false;
  const styleParts: string[] = [];
  const scriptParts: string[] = [];
  return (
    new HTMLRewriter()
      .on('head', {
        element(el) {
          el.prepend(inject, { html: true });
          injected = true;
        },
      })
      .on('body', {
        element(el) {
          if (!injected) {
            el.prepend(inject, { html: true });
            injected = true;
          }
        },
      })
      // `head` and `body` are the only injection points, and a document served as
      // text/html with neither — a bare fragment, an XML or RSS body, a
      // hand-written error page — came through unmarked, so the viewer called a
      // page that rendered perfectly well a failure. The document's end is the one
      // hook guaranteed to fire whatever the markup turns out to be.
      .onDocument({
        end(end) {
          if (injected) return;
          end.append(inject, { html: true });
          injected = true;
        },
      })
      .on('*', {
        element(el) {
          // Leave anchor/area hrefs on the target origin — link clicks flow through
          // ml-navigate → navigateTo, which needs the real target URL, not a proxied one.
          const isAnchor = el.tagName === 'a' || el.tagName === 'area';
          for (const attr of ['src', 'href', 'action', 'poster']) {
            if (isAnchor && attr === 'href') continue;
            const val = el.getAttribute(attr);
            if (!val) continue;
            const rewritten = rewriteUrl(decodeAttr(val));
            if (rewritten) el.setAttribute(attr, encodeAttr(rewritten));
          }
          const style = el.getAttribute('style');
          if (style?.includes('url(')) {
            el.setAttribute('style', rewriteCssUrls({ css: style, px }));
          }
        },
      })
      .on('[srcset]', {
        element(el) {
          const raw = el.getAttribute('srcset');
          if (!raw) return;
          const srcset = decodeAttr(raw);
          const rewritten = srcset
            .split(',')
            .map((entry) => {
              const trimmed = entry.trim();
              const idx = trimmed.search(/\s/);
              if (idx === -1) return rewriteUrl(trimmed) || trimmed;
              const u = trimmed.slice(0, idx);
              return (rewriteUrl(u) || u) + trimmed.slice(idx);
            })
            .join(', ');
          if (rewritten !== srcset) el.setAttribute('srcset', encodeAttr(rewritten));
        },
      })
      // Strip SRI (fails on proxied resources) and nonce (blocks injected scripts)
      .on('[integrity]', {
        element(el) {
          el.removeAttribute('integrity');
        },
      })
      .on('[nonce]', {
        element(el) {
          el.removeAttribute('nonce');
        },
      })
      // Strip CSP meta tags that block framing, and turn a firewall's challenge
      // redirect into a message the viewer can explain (following it only lands
      // on a CAPTCHA we cannot answer).
      .on('meta[http-equiv]', {
        element(el) {
          const equiv = (el.getAttribute('http-equiv') || '').toLowerCase();
          if (equiv === 'content-security-policy') {
            el.remove();
            return;
          }
          if (equiv !== 'refresh') return;
          // Left in place it would navigate the iframe to a CAPTCHA we cannot
          // answer; the viewer has already been told why the page is empty.
          if (CHALLENGE_PATH.test(el.getAttribute('content') || '')) el.remove();
        },
      })
      .on('script[src*="/cdn-cgi/"]', {
        element(el) {
          el.remove();
        },
      })
      .on('script:not([src])', {
        text(chunk) {
          scriptParts.push(chunk.text);
          if (chunk.lastInTextNode) {
            const buf = scriptParts.join('');
            chunk.replace(buf.includes('cdn-cgi') ? '' : buf, { html: true });
            scriptParts.length = 0;
          } else {
            chunk.replace('');
          }
        },
      })
      .on('style', {
        text(chunk) {
          styleParts.push(chunk.text);
          if (chunk.lastInTextNode) {
            const buf = styleParts.join('');
            chunk.replace(rewriteCssUrls({ css: buf, px }), { html: true });
            styleParts.length = 0;
          } else {
            chunk.replace('');
          }
        },
      })
  );
}
