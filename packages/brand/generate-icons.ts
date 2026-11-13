/** Generate distributable icons from the shared vector geometry. */
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { MARK_BLUE, MARK_PATHS, MARK_PURPLE, SMALL_MARK_PATHS } from './src/mark';

const paths = MARK_PATHS.map((d) => `<path d="${d}"/>`).join('');
const svg = (fill: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>visual collaboration</title>${defs}<g fill="${fill}">${paths}</g></svg>\n`;
const gradient = `<defs><linearGradient id="brand" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${MARK_BLUE}"/><stop offset="1" stop-color="${MARK_PURPLE}"/></linearGradient></defs>`;
const main = svg('url(#brand)', gradient);
const mono = svg('currentColor');
const small = main.replace(paths, SMALL_MARK_PATHS.map((d) => `<path d="${d}"/>`).join(''));
const root = new URL('../../', import.meta.url);
const write = async (name: string, content: string | Uint8Array) => {
  const url = new URL(name, root);
  await mkdir(new URL('.', url), { recursive: true });
  await writeFile(url, content);
};
const png = (size: number) =>
  sharp(Buffer.from(size <= 32 ? small : main))
    .resize(size, size)
    .png()
    .toBuffer();
await write('packages/brand/assets/visual-collaboration.svg', main);
await write('packages/brand/assets/visual-collaboration-mono.svg', mono);
await write('packages/brand/assets/visual-collaboration-small.svg', small);
await write('apps/extension/public/logo.svg', main);
for (const size of [16, 32, 48, 96, 128]) await write(`apps/extension/public/icon/${size}.png`, await png(size));
for (const rootDir of ['apps/site/public', 'apps/worker/static']) {
  await write(`${rootDir}/favicon.svg`, main);
  await write(`${rootDir}/favicon-32x32.png`, await png(32));
  await write(`${rootDir}/apple-touch-icon.png`, await png(180));
  const icons = await Promise.all([16, 32, 48].map(png));
  const header = Buffer.alloc(6 + icons.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(icons.length, 4);
  let offset = header.length;
  icons.forEach((image, i) => {
    const start = 6 + i * 16;
    header[start] = [16, 32, 48][i];
    header[start + 1] = [16, 32, 48][i];
    header.writeUInt16LE(1, start + 4);
    header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(image.length, start + 8);
    header.writeUInt32LE(offset, start + 12);
    offset += image.length;
  });
  await write(`${rootDir}/favicon.ico`, Buffer.concat([header, ...icons]));
}
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#10111b"/><svg x="72" y="148" width="210" height="210" viewBox="0 0 512 512">${gradient}<g fill="url(#brand)">${paths}</g></svg><text x="310" y="270" fill="white" font-family="Arial, sans-serif" font-weight="600" font-size="62">visual collaboration</text><text x="314" y="325" fill="#aeb4cc" font-family="Arial, sans-serif" font-size="26">Draw, discuss and collaborate visually.</text></svg>`;
await write('apps/worker/static/og.jpg', await sharp(Buffer.from(card)).jpeg({ quality: 90 }).toBuffer());
