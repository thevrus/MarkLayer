import { initWasm, Resvg } from '@resvg/resvg-wasm';
// @ts-expect-error — wasm import handled by wrangler
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

let wasmReady = false;

async function ensureWasm() {
  if (!wasmReady) {
    await initWasm(resvgWasm);
    wasmReady = true;
  }
}

// Cache the Inter font across requests in the same isolate
let fontData: Uint8Array | null = null;
async function getFont(): Promise<Uint8Array> {
  if (fontData) return fontData;
  const res = await fetch(
    'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hjQ.ttf',
  );
  fontData = new Uint8Array(await res.arrayBuffer());
  return fontData;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchFaviconDataUri(domain: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || 'image/png';
    const buf = await res.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

interface OgParams {
  domain: string;
  ops: { tool: string; parentId?: string }[];
}

export async function generateOgImage({ domain, ops }: OgParams): Promise<ArrayBuffer> {
  const [, font, faviconUri] = await Promise.all([ensureWasm(), getFont(), fetchFaviconDataUri(domain)]);

  // Compute stats
  const drawings = ops.filter((o) => ['pen', 'highlight', 'rectangle', 'line', 'circle'].includes(o.tool)).length;
  const comments = ops.filter((o) => o.tool === 'comment' && !o.parentId).length;
  const texts = ops.filter((o) => o.tool === 'text').length;
  const stats: string[] = [];
  if (drawings) stats.push(`${drawings} drawing${drawings > 1 ? 's' : ''}`);
  if (comments) stats.push(`${comments} comment${comments > 1 ? 's' : ''}`);
  if (texts) stats.push(`${texts} text note${texts > 1 ? 's' : ''}`);
  const statsLine = stats.length ? stats.join(' · ') : 'Shared annotations';

  const title = escapeXml(`Annotations on ${domain}`);
  const subtitle = escapeXml(statsLine);

  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a1a"/>
      <stop offset="50%" stop-color="#2d1f3d"/>
      <stop offset="100%" stop-color="#1a1a1a"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F953C6"/>
      <stop offset="100%" stop-color="#B91D73"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  ${faviconUri ? `<image x="560" y="150" width="80" height="80" href="${faviconUri}" clip-path="inset(0 round 16px)"/>` : ''}
  <text x="600" y="${faviconUri ? 290 : 260}" text-anchor="middle" font-family="Inter" font-size="48" font-weight="700" fill="#ffffff" letter-spacing="-1">${title}</text>
  <text x="600" y="${faviconUri ? 340 : 310}" text-anchor="middle" font-family="Inter" font-size="24" fill="rgba(255,255,255,0.5)">${subtitle}</text>
  <rect x="540" y="${faviconUri ? 400 : 380}" width="28" height="28" rx="7" fill="url(#brand)"/>
  <text x="580" y="${faviconUri ? 422 : 402}" font-family="Inter" font-size="22" font-weight="700" fill="rgba(255,255,255,0.35)" letter-spacing="-0.2">MarkLayer</text>
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width' as const, value: 1200 },
    font: {
      loadSystemFonts: false,
      fontBuffers: [font],
    },
  });
  const png = resvg.render();
  return png.asPng().buffer as ArrayBuffer;
}
