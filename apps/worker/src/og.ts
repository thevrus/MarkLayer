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

  const fy = faviconUri ? 0 : 30; // vertical offset when no favicon

  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow1" cx="0.5" cy="0.42" r="0.55">
      <stop offset="0%" stop-color="#F953C6" stop-opacity="0.14"/>
      <stop offset="50%" stop-color="#7928CA" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#09090F" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.78" cy="0.82" r="0.35">
      <stop offset="0%" stop-color="#4F46E5" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#09090F" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F953C6"/>
      <stop offset="100%" stop-color="#B91D73"/>
    </linearGradient>
    <linearGradient id="topline" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#F953C6" stop-opacity="0"/>
      <stop offset="30%" stop-color="#F953C6" stop-opacity="0.8"/>
      <stop offset="70%" stop-color="#B91D73" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#B91D73" stop-opacity="0"/>
    </linearGradient>
    <pattern id="grid" x="0" y="0" width="36" height="36" patternUnits="userSpaceOnUse">
      <circle cx="18" cy="18" r="0.6" fill="rgba(255,255,255,0.045)"/>
    </pattern>
  </defs>

  <rect width="1200" height="630" fill="#09090F"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>

  <rect x="250" y="0" width="700" height="2" fill="url(#topline)"/>

  ${faviconUri ? `<image x="564" y="155" width="72" height="72" href="${faviconUri}" clip-path="inset(0 round 14px)"/>` : ''}

  <text x="600" y="${285 - fy}" text-anchor="middle" font-family="Inter" font-size="44" font-weight="700" fill="#ffffff" letter-spacing="-1.5">${title}</text>
  <text x="600" y="${332 - fy}" text-anchor="middle" font-family="Inter" font-size="18" fill="rgba(255,255,255,0.38)" letter-spacing="0.3">${subtitle}</text>

  <rect x="527" y="${400 - fy}" width="146" height="38" rx="19" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
  <rect x="543" y="${409 - fy}" width="20" height="20" rx="5" fill="url(#brand)"/>
  <text x="572" y="${425 - fy}" font-family="Inter" font-size="15" font-weight="600" fill="rgba(255,255,255,0.35)">MarkLayer</text>
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
