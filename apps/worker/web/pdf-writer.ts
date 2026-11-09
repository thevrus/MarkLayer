/** One output page: a JPEG drawn edge to edge over a page box in PDF points. */
export interface ImagePage {
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  widthPt: number;
  heightPt: number;
}

const ascii = (s: string) => new TextEncoder().encode(s);

/**
 * A minimal PDF 1.4 holding one JPEG per page, passed through as a DCTDecode
 * XObject so nothing is re-encoded. Hand-written rather than a dependency: the
 * format needed here is a catalog, a page tree and three objects per page, and
 * the only part that silently breaks a file is the xref's byte offsets.
 */
export function writeImagePdf(pages: ImagePage[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (bytes: Uint8Array) => {
    parts.push(bytes);
    length += bytes.length;
  };
  const object = ({ id, body, stream }: { id: number; body: string; stream?: Uint8Array }) => {
    offsets[id] = length;
    push(ascii(`${id} 0 obj\n${body}\n`));
    if (stream) {
      push(ascii('stream\n'));
      push(stream);
      push(ascii('\nendstream\n'));
    }
    push(ascii('endobj\n'));
  };

  push(ascii('%PDF-1.4\n'));
  // A comment of high bytes, so transfer tools treat the file as binary (PDF spec 7.5.2).
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  // Ids: 1 catalog, 2 page tree, then (page, contents, image) per page from 3.
  const pageId = (i: number) => 3 + i * 3;
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  object({ id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' });
  const kids = pages.map((_, i) => `${pageId(i)} 0 R`).join(' ');
  object({ id: 2, body: `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>` });
  pages.forEach((page, i) => {
    const id = pageId(i);
    const w = fmt(page.widthPt);
    const h = fmt(page.heightPt);
    object({
      id,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    });
    const content = ascii(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    object({ id: id + 1, body: `<< /Length ${content.length} >>`, stream: content });
    object({
      id: id + 2,
      body: `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
      stream: page.jpeg,
    });
  });

  const size = 3 + pages.length * 3;
  const xrefAt = length;
  // Each entry is exactly 20 bytes, its EOL included; readers seek by that.
  const entries = ['0000000000 65535 f \n'];
  for (let id = 1; id < size; id++) entries.push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  push(ascii(`xref\n0 ${size}\n${entries.join('')}`));
  push(ascii(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`));

  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
