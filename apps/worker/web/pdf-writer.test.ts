import { describe, expect, test } from 'bun:test';
import { writeImagePdf } from './pdf-writer';

// One char per byte, so string indices are byte offsets.
const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

// Fake JPEG payloads that contain PDF keywords, so a reader that trusted them would misparse.
const page = (n: number) => ({
  jpeg: new Uint8Array([0xff, 0xd8, ...new TextEncoder().encode(`endstream endobj ${n}`), 0xff, 0xd9]),
  pixelWidth: 1190 + n,
  pixelHeight: 1684,
  widthPt: 595.28,
  heightPt: 841.89,
});

function parse(bytes: Uint8Array) {
  const s = text(bytes);
  const xrefAt = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)?.[1]);
  const table = /^xref\n0 (\d+)\n/.exec(s.slice(xrefAt));
  const size = Number(table?.[1]);
  const start = xrefAt + (table?.[0].length ?? 0);
  const offsets = Array.from({ length: size }, (_, id) => s.slice(start + id * 20, start + id * 20 + 20));
  return { s, xrefAt, size, offsets };
}

describe('writeImagePdf', () => {
  test('every xref entry points at the start of its own object', () => {
    const { s, xrefAt, size, offsets } = parse(writeImagePdf([page(1), page(2), page(3)]));
    expect(s.slice(xrefAt, xrefAt + 4)).toBe('xref');
    expect(size).toBe(3 + 3 * 3);
    expect(offsets[0]).toBe('0000000000 65535 f \n');
    for (let id = 1; id < size; id++) {
      const entry = offsets[id] ?? '';
      expect(entry).toMatch(/^\d{10} 00000 n \n$/);
      const at = Number(entry.slice(0, 10));
      expect(s.slice(at, at + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
    }
  });

  test('one page per input, in order, each with its image dimensions and exact stream length', () => {
    const pages = [page(1), page(2)];
    const { s } = parse(writeImagePdf(pages));
    expect(s).toContain('/Count 2');
    expect(s).toContain('/Kids [3 0 R 6 0 R]');
    const images = [...s.matchAll(/\/Subtype \/Image \/Width (\d+) [^>]*\/Length (\d+) >>\nstream\n/g)];
    expect(images.map((m) => Number(m[1]))).toEqual([1191, 1192]);
    images.forEach((m, i) => {
      const len = Number(m[2]);
      const bodyAt = (m.index ?? 0) + m[0].length;
      expect(len).toBe(pages[i]?.jpeg.length ?? -1);
      expect(s.slice(bodyAt + len, bodyAt + len + '\nendstream'.length)).toBe('\nendstream');
    });
  });

  test('the page box is the original page size in points', () => {
    const { s } = parse(writeImagePdf([page(1)]));
    expect(s).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(s).toContain('q 595.28 0 0 841.89 0 0 cm /Im0 Do Q');
  });
});
