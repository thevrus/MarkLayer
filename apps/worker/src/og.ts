import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import { toBase64 } from './http';
import { buildOgSvg } from './og-card';
import { OG_FONTS_BASE64 } from './og-fonts';
import { buildPageOgSvg } from './og-page-card';

let wasmReady = false;

async function ensureWasm() {
  if (!wasmReady) {
    await initWasm(resvgWasm);
    wasmReady = true;
  }
}

// Decoded once per isolate; the base64 lives in the bundle, so no network.
let fontBuffers: Uint8Array[] | null = null;

/**
 * Regular, medium and bold, so the card has a real weight hierarchy — with a
 * single face loaded resvg matches every `font-weight` to it and the whole
 * composition renders in one weight.
 */
function getFonts(): Uint8Array[] {
  if (!fontBuffers) fontBuffers = OG_FONTS_BASE64.map((b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  return fontBuffers;
}

async function fetchFaviconDataUri(domain: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || 'image/png';
    const buf = await res.arrayBuffer();
    const b64 = toBase64(new Uint8Array(buf));
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

interface OgParams {
  domain: string;
  /** Raw stored ops, straight off the row; parsed and sanitized downstream. */
  ops: unknown[];
}

/** Rasterize a composed card. The wasm must already be initialized. */
function rasterize(svg: string): ArrayBuffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width' as const, value: 1200 },
    font: {
      loadSystemFonts: false,
      fontBuffers: getFonts(),
    },
  });
  const bytes = resvg.render().asPng();
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** Compose the share card and rasterize it. */
export async function generateOgImage({ domain, ops }: OgParams): Promise<ArrayBuffer> {
  const [, faviconUri] = await Promise.all([ensureWasm(), fetchFaviconDataUri(domain)]);
  return rasterize(buildOgSvg({ domain, ops, faviconUri }));
}

/**
 * Compose a marketing page's card and rasterize it. No favicon fetch and no D1
 * read: everything the card says comes from the page that asked for it.
 */
export async function generatePageOgImage({ heading, path }: { heading: string; path: string }): Promise<ArrayBuffer> {
  await ensureWasm();
  return rasterize(buildPageOgSvg({ heading, path }));
}
