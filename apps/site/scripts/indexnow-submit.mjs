/**
 * Tell IndexNow (Bing, Yandex, Seznam, Naver) that the site's pages changed.
 *
 * Run by hand after a deploy that changed content, deliberately not chained to
 * `deploy`: the app ships far more often than these pages change, and IndexNow
 * rate-limits, so every worker deploy would resubmit the same unchanged URLs.
 *
 * The host, the URL list and the ownership key are all read from files the
 * build already produced, so nothing here can disagree with what is live. A 403
 * means public/<key>.txt has not reached the origin yet.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://api.indexnow.org/IndexNow';
const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP = join(SITE, 'dist/sitemap.xml');
const PUBLIC = join(SITE, 'public');

const fail = (message) => {
  console.error(`indexnow — ${message}`);
  process.exit(1);
};

let xml;
try {
  xml = await readFile(SITEMAP, 'utf8');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  fail(`${SITEMAP} is missing. Run \`bun run build\` first.`);
}

const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc.trim());
if (urlList.length === 0) fail(`no <loc> entries in ${SITEMAP}.`);
const { host, origin } = new URL(urlList[0]);

// IndexNow's proof of ownership is a file whose name and body are both the key,
// so both are read off that one file rather than restated as a constant here.
const keyFile = (await readdir(PUBLIC)).find((name) => /^[0-9a-f]{32}\.txt$/.test(name));
if (!keyFile) fail(`no <32-hex>.txt key file in ${PUBLIC}.`);
const key = (await readFile(join(PUBLIC, keyFile), 'utf8')).trim();
if (`${key}.txt` !== keyFile) fail(`${keyFile} does not contain its own name, so IndexNow will reject it.`);

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation: `${origin}/${keyFile}`, urlList }),
});

console.log(`indexnow — submitted ${urlList.length} ${host} URLs: ${res.status}`);
if (!res.ok) fail((await res.text()).trim() || 'see https://www.indexnow.org/documentation');
