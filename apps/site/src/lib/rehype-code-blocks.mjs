/**
 * Give every highlighted Markdown code block a bar: the language on the left, a
 * copy button on the right.
 *
 * The button ships `hidden` and the page script reveals it, so a reader with no
 * JavaScript never meets a control that does nothing. The bar itself is always
 * there, which is what keeps the reveal from shifting the block.
 *
 * Runs after Shiki, which has already replaced the bare `pre` and stamped it
 * with `data-language`.
 */
import { wrapElements } from './rehype-wrap.mjs';

const LABELS = { plaintext: '', sh: 'Terminal', bash: 'Terminal', shell: 'Terminal', json: 'JSON', toml: 'TOML' };

const el = (tagName, properties, children = []) => ({ type: 'element', tagName, properties, children });

const text = (value) => ({ type: 'text', value });

/** The landing's copy and check glyphs (Lucide, as the landing draws them), at 14px. */
const icon = (className, children) => ({
  type: 'element',
  tagName: 'svg',
  properties: {
    className: [className],
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ariaHidden: 'true',
  },
  children,
});

export const rehypeCodeBlocks = wrapElements({
  tagName: 'pre',
  wrap: (pre) => {
    const lang = String(pre.properties?.dataLanguage ?? 'plaintext');
    const label = LABELS[lang] ?? lang;
    return el('div', { className: ['ml-code'] }, [
      el('div', { className: ['ml-code-bar'] }, [
        el('span', {}, [text(label)]),
        el('button', { type: 'button', className: ['ml-copy'], dataMlCopyCode: '', hidden: true }, [
          icon('ml-i-copy', [
            el('rect', { width: 14, height: 14, x: 8, y: 8, rx: 2, ry: 2 }),
            el('path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }),
          ]),
          icon('ml-i-done', [el('path', { d: 'M20 6 9 17l-5-5' })]),
          el('span', { ariaLive: 'polite', dataMlCopyLabel: '' }, [text('Copy')]),
        ]),
      ]),
      pre,
    ]);
  },
});
