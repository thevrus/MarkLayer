import { describe, expect, test } from 'bun:test';
import { outlinePage } from './page-outline';

const read = (html: string) => outlinePage({ html, url: 'https://example.com' });

describe('outlinePage', () => {
  test('locates an element by a path a browser would resolve', async () => {
    const { entries } = await read('<body><main><p>first</p><p>second</p></main></body>');
    // html and body are implied: querySelector is document-scoped, so carrying
    // them would put the same dead prefix on every entry an agent reads.
    expect(entries.map((e) => e.selector)).toEqual([
      'main:nth-of-type(1) > p:nth-of-type(1)',
      'main:nth-of-type(1) > p:nth-of-type(2)',
    ]);
  });

  test('roots at the nearest id, so a sibling inserted above cannot move it', async () => {
    const { entries } = await read('<div><div id="hero"><h1>Your pets</h1></div></div>');
    expect(entries[0]?.selector).toBe('#hero > h1:nth-of-type(1)');
  });

  test('prefers the element’s own id over any path', async () => {
    const { entries } = await read('<div><p id="lede">hello</p></div>');
    expect(entries[0]?.selector).toBe('#lede');
  });

  test('reads an element’s text as one sentence, the way innerText does', async () => {
    const { entries } = await read('<p>Hello <b>world</b>, again</p>');
    expect(entries[0]?.text).toBe('Hello world, again');
  });

  test('keeps script and style out of the copy', async () => {
    const { entries } = await read('<body><script>var a="not copy"</script><p>real</p></body>');
    expect(entries.map((e) => e.text)).toEqual(['real']);
  });

  test('counts skipped tags so a later sibling’s position still matches the DOM', async () => {
    const { entries } = await read('<div><p>one</p><script>x</script><p>two</p></div>');
    expect(entries[1]?.selector).toContain('p:nth-of-type(2)');
  });

  test('takes the title without treating it as page copy', async () => {
    const out = await read('<head><title>  Pets  </title></head><body><p>body</p></body>');
    expect(out.title).toBe('Pets');
    expect(out.entries.map((e) => e.text)).toEqual(['body']);
  });

  test('says a page is client-rendered rather than reporting it as empty', async () => {
    const out = await read('<body><div id="root"></div></body>');
    expect(out.clientRendered).toBe(true);
    expect(out.entries).toEqual([]);
  });

  test('does not call a server-rendered page a shell', async () => {
    const filled = `<body><div id="root"><p>${'real copy '.repeat(40)}</p></div></body>`;
    expect((await read(filled)).clientRendered).toBe(false);
  });

  test('skips an element with no text of its own', async () => {
    const { entries } = await read('<div><p></p><p>kept</p></div>');
    expect(entries.map((e) => e.text)).toEqual(['kept']);
  });

  test('reports being cut short instead of silently dropping the tail', async () => {
    const many = `<div>${'<p>x</p>'.repeat(5)}</div>`;
    const out = await outlinePage({ html: many, url: 'https://example.com', maxEntries: 2 });
    expect(out.entries).toHaveLength(2);
    expect(out.truncated).toBe(true);
  });

  test('survives a void element without losing its place', async () => {
    const { entries } = await read('<div><img src="x"><p>after</p></div>');
    expect(entries[0]?.selector).toContain('p:nth-of-type(1)');
  });

  test('decodes entities rather than handing an agent &amp; to review', async () => {
    const { entries } = await read('<p>Terms &amp; Conditions</p>');
    expect(entries[0]?.text).toBe('Terms & Conditions');
  });

  test('carries a markdown snapshot the write tools can pass through', async () => {
    const { entries } = await read('<div><button>Continue</button></div>');
    expect(entries[0]?.tag).toBe('button');
    expect(entries[0]?.markdown).toContain('`<button>`');
    expect(entries[0]?.markdown).toContain('Continue');
  });
});
