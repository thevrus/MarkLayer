import { afterEach, describe, expect, test } from 'bun:test';
import { proxy } from '../proxy';
import { FakeExecutionContext, fakeEnv } from '../test-env';
import { rewriteCssUrls } from './rewrite';

/**
 * Real pages saved on 2026-11-06, gzipped because nobody reads them by hand. The snapshot holds a
 * hash, so a rewrite that changes one byte of any page fails. `INJECTED` stands in for the injected
 * block: that is a separate contract with its own tests, and these pin what happens to the host's markup.
 */
const SAVED_PAGES = {
  wikipedia: 'https://en.wikipedia.org/wiki/Web_annotation',
  hackernews: 'https://news.ycombinator.com/',
  'gov-uk': 'https://www.gov.uk/',
  'wordpress-news': 'https://wordpress.org/news/',
  astro: 'https://astro.build/',
} as const;

test('css: a protocol-relative url() stays on its own host', () => {
  expect(rewriteCssUrls({ css: 'a{background:url(//cdn.x/y.png)}b{background:url(/z.png)}', px: '/px/h' })).toBe(
    'a{background:url(//cdn.x/y.png)}b{background:url(/px/h/z.png)}',
  );
});

const INJECTED = '@@INJECTED@@';
const realFetch = globalThis.fetch;

function upstreamServes({ body, type }: { body: string; type: string }): void {
  globalThis.fetch = Object.assign(async () => new Response(body, { headers: { 'content-type': type } }), {
    preconnect: realFetch.preconnect,
  });
}

async function rewritten({ html, url }: { html: string; url: string }): Promise<string> {
  upstreamServes({ body: html, type: 'text/html' });
  const res = await proxy.request(`/proxy?url=${encodeURIComponent(url)}`, {}, fakeEnv(), new FakeExecutionContext());
  return res.text();
}

/** The rewrite of `html` at `url`, with the injected block read off an empty page at the same address. */
async function markup({
  html,
  url,
  blank = '',
}: {
  html: string;
  url: string;
  /** What `head` must hold for the empty page to draw the same block, a challenge's notice included. */
  blank?: string;
}): Promise<string> {
  const empty = await rewritten({ html: `<head>${blank}</head>`, url });
  const injected = empty.slice('<head>'.length, -'</head>'.length);
  const page = await rewritten({ html, url });
  expect(page).toContain(injected);
  return page.replace(injected, () => INJECTED);
}

const sha256 = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('rewriting a saved page', () => {
  for (const [name, url] of Object.entries(SAVED_PAGES)) {
    test(name, async () => {
      const gz = await Bun.file(new URL(`./__fixtures__/${name}.html.gz`, import.meta.url)).bytes();
      const html = new TextDecoder().decode(Bun.gunzipSync(gz));
      expect(sha256(await markup({ html, url }))).toMatchSnapshot();
    });
  }
});

const CHALLENGE_REFRESH = '<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F">';

/** Every branch of the pipeline, in the fewest bytes, for the ones the saved pages happen not to hit. */
const EDGE_PAGE = `<!doctype html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'">
<meta http-equiv="refresh" content="5;url=/later">
${CHALLENGE_REFRESH}
<link rel="stylesheet" href="/a.css" integrity="sha384-x" crossorigin>
<script src="/cdn-cgi/apps/head/x.js"></script>
<script nonce="abc">var keep = 1;</script>
<script>var drop = "/cdn-cgi/x";</script>
<style>body{background:url(/bg.png)} a{background:url('/q.png')} b{background:url( "/d.png" )} c{background:url(rel.png)} d{background:url(https://cdn.example/e.png)}</style>
</head>
<body style="background:url(/inline.png)">
<a href="/stays">anchor</a><map><area href="/stays-too"></map>
<img src="/root.png" srcset="/one.png 1x, https://example.com/two.png 2x, https://cdn.example/three.png 3x">
<img src="https://example.com/abs.png"><img src="//example.com/proto.png"><img src="//cdn.example/other.png">
<img src="relative/path.png?a=1&amp;copy=2"><img src="data:image/png;base64,AAAA"><img src="https&#x3A;&#x2F;&#x2F;example.com&#x2F;twig.webp">
<video poster="/poster.png"></video><form action="/submit"></form>
<iframe src="mailto:a@b.c"></iframe><img src="http://localhost/px/example.com/already.png">
</body>
</html>`;

describe('rewriting the edge page', () => {
  test('in a document with a head', async () => {
    const url = 'https://example.com/dir/page?q=1';
    expect(await markup({ html: EDGE_PAGE, url, blank: CHALLENGE_REFRESH })).toMatchSnapshot();
  });

  test('with no head the block lands in the body', async () => {
    expect(await markup({ html: '<body><p>hi</p></body>', url: 'https://example.com/' })).toMatchSnapshot();
  });

  test('with neither it lands at the end of the document', async () => {
    expect(await markup({ html: '<p>hi</p>', url: 'https://example.com/' })).toMatchSnapshot();
  });
});

const STYLESHEET = `body{background:url(/bg.png)}
a{background:url('/q.png')}
b{background:url( "/d.png" )}
c{background:url(rel.png)}
d{background:url(https://cdn.example/e.png)}
@import url(/more.css);`;

test('rewriting a stylesheet served through /px', async () => {
  upstreamServes({ body: STYLESHEET, type: 'text/css' });
  const res = await proxy.request('/px/example.com/a.css', {}, fakeEnv(), new FakeExecutionContext());
  expect(await res.text()).toMatchSnapshot();
});
