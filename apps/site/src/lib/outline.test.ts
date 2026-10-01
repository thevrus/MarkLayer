import { describe, expect, test } from 'bun:test';
import { outline } from './outline';

describe('outline', () => {
  test('a template heading with no id gets one, an anchor, and an outline entry', () => {
    const { html, entries } = outline('<h2>At a glance</h2>');
    expect(html).toBe(
      '<h2 id="at-a-glance">At a glance<a class="ml-anchor" href="#at-a-glance" aria-hidden="true" tabindex="-1">#</a></h2>',
    );
    expect(entries).toEqual([{ id: 'at-a-glance', depth: 2, html: 'At a glance' }]);
  });

  test('keeps the id Markdown already gave a heading', () => {
    const { entries } = outline('<h2 id="the-setup">The setup, in order</h2>');
    expect(entries[0]?.id).toBe('the-setup');
  });

  // A repeated id silently sends every outline link to the first match.
  test('never mints an id that is already on the page', () => {
    const { entries } = outline('<div id="faq"></div><h2>FAQ</h2><h3>FAQ</h3>');
    expect(entries.map((e) => e.id)).toEqual(['faq-2', 'faq-3']);
  });

  test('a linked heading gets an id but no anchor, and a linked h3 stays out of the outline', () => {
    const { html, entries } = outline(
      '<h2><a href="/changelog/v0-8-0">View only</a></h2><h3><a href="/vs/x">X</a></h3>',
    );
    expect(html).not.toContain('ml-anchor');
    expect(html).toContain('<h3 id="x">');
    expect(entries).toEqual([{ id: 'view-only', depth: 2, html: 'View only' }]);
  });

  test('outline text drops inline tags and keeps entities encoded', () => {
    const { entries } = outline('<h2>Jira &amp; <code>Linear</code></h2>');
    expect(entries[0]).toEqual({ id: 'jira-linear', depth: 2, html: 'Jira &amp; Linear' });
  });
});
