import { getCursorStyles, TEXT_MAX } from './element-details';
import { hostMutationTick, scrollTick } from './host-mutations';
import { getSelector, isExtensionElement } from './selector';

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportElement {
  tag: string;
  role: string | null;
  name: string;
  nameSource: string;
  nameTruncated: boolean;
  selector: string;
  rect: ViewportRect;
  visibleRect: ViewportRect;
  styles: Record<string, string>;
  /** 文档/封闭组件边界不穿透，选择器只在当前文档中解析。 */
  boundary?: 'iframe' | 'shadow-root';
}

export interface ViewportBatch {
  items: ViewportElement[];
  viewport: ViewportRect;
  visited: number;
  done: boolean;
  restarted: boolean;
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);
const ROLES: Record<string, string> = {
  BUTTON: 'button',
  TEXTAREA: 'textbox',
  SELECT: 'combobox',
  IMG: 'img',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  NAV: 'navigation',
  MAIN: 'main',
  ASIDE: 'complementary',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  TABLE: 'table',
  TR: 'row',
  TH: 'columnheader',
  TD: 'cell',
  PROGRESS: 'progressbar',
  SUMMARY: 'button',
};
const CONTENT_NAMES = new Set([
  'button',
  'link',
  'heading',
  'option',
  'tab',
  'menuitem',
  'checkbox',
  'radio',
  'cell',
  'columnheader',
  'rowheader',
]);

function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  if (el.tagName === 'IMG' && el.getAttribute('alt') === '') return 'presentation';
  if (el.tagName === 'A') return el.hasAttribute('href') ? 'link' : null;
  if (el.tagName === 'INPUT') {
    const type = el.getAttribute('type')?.toLowerCase() ?? 'text';
    if (type === 'hidden' || type === 'password') return null;
    return (
      (
        {
          button: 'button',
          submit: 'button',
          reset: 'button',
          checkbox: 'checkbox',
          radio: 'radio',
          range: 'slider',
          number: 'spinbutton',
          search: 'searchbox',
        } as Record<string, string>
      )[type] ?? 'textbox'
    );
  }
  return ROLES[el.tagName] ?? null;
}

function excluded(el: Element, style: CSSStyleDeclaration): boolean {
  return (
    SKIP.has(el.tagName) ||
    isExtensionElement(el) ||
    el.hasAttribute('hidden') ||
    el.hasAttribute('inert') ||
    el.getAttribute('aria-hidden') === 'true' ||
    style.display === 'none' ||
    style.contentVisibility === 'hidden' ||
    style.opacity === '0'
  );
}

function rectOf(rect: DOMRect | ViewportRect): ViewportRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function intersect(a: ViewportRect, b: ViewportRect): ViewportRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** 有上限的文本读取；不对容器调用 innerText/textContent 或序列化整棵 DOM。 */
function boundedText(el: Element, descend: boolean): { text: string; truncated: boolean } {
  const win = el.ownerDocument.defaultView!;
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  let text = '';
  let visited = 0;
  while (node && visited++ < 80 && text.length <= TEXT_MAX) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += ` ${node.nodeValue?.slice(0, TEXT_MAX + 1) ?? ''}`;
    } else {
      const child = node as Element;
      const style = win.getComputedStyle(child);
      if (
        !descend ||
        excluded(child, style) ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        ['INPUT', 'TEXTAREA', 'SELECT', 'IFRAME'].includes(child.tagName)
      ) {
        node = walker.nextSibling();
        if (!node) {
          while (walker.parentNode() && walker.currentNode !== el) {
            node = walker.nextSibling();
            if (node) break;
          }
        }
        continue;
      }
    }
    text = text.replace(/\s+/g, ' ');
    node = walker.nextNode();
  }
  const cleaned = text.trim();
  return { text: cleaned.slice(0, TEXT_MAX), truncated: !!node || cleaned.length > TEXT_MAX };
}

/** 常用 ARIA/原生命名规则的有界投影；不是浏览器完整的 AX tree。 */
function nameOf(el: Element, role: string | null): { name: string; nameSource: string; nameTruncated: boolean } {
  let source = 'none';
  let text = '';
  let truncated = false;
  const ids = el.getAttribute('aria-labelledby')?.trim().split(/\s+/).filter(Boolean);
  if (ids?.length) {
    source = 'aria-labelledby';
    for (const id of ids.slice(0, 8)) {
      const label = el.ownerDocument.getElementById(id);
      if (!label) continue;
      const value = boundedText(label, true);
      text += ` ${value.text}`;
      truncated ||= value.truncated;
    }
    truncated ||= ids.length > 8;
  }
  if (!text.trim() && el.hasAttribute('aria-label')) {
    source = 'aria-label';
    text = el.getAttribute('aria-label') ?? '';
  }
  if (!text.trim() && 'labels' in el) {
    const labels = (el as HTMLInputElement).labels;
    if (labels?.length) {
      source = 'label';
      for (let i = 0; i < Math.min(labels.length, 8); i++) {
        const value = boundedText(labels[i]!, true);
        text += ` ${value.text}`;
        truncated ||= value.truncated;
      }
      truncated ||= labels.length > 8;
    }
  }
  if (!text.trim() && el.tagName === 'IMG') {
    source = 'alt';
    text = el.getAttribute('alt') ?? '';
  }
  if (!text.trim() && el.tagName === 'INPUT' && role === 'button') {
    source = 'value';
    // 只读取按钮的静态标签，绝不把文本/密码字段的用户输入当名称。
    text = el.getAttribute('value') ?? '';
  }
  if (!text.trim() && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') {
    source = role && CONTENT_NAMES.has(role) ? 'contents' : 'direct-text';
    const value = boundedText(el, source === 'contents');
    text = value.text;
    truncated ||= value.truncated;
  }
  if (!text.trim() && el.getAttribute('title')) {
    source = 'title';
    text = el.getAttribute('title')!;
  }
  text = text.replace(/\s+/g, ' ').trim();
  return {
    name: text.slice(0, TEXT_MAX),
    nameSource: text ? source : 'none',
    nameTruncated: truncated || text.length > TEXT_MAX,
  };
}

/**
 * 只在 readNext 调用时前进。无全页元素列表、定时器或新增 observer/listener。
 * 每次最多访问 maxNodes 个结构节点、返回 batchSize 个条目；空批次不代表结束。
 * 不可裁剪的离屏容器仍须逐批经过，避免漏掉溢出到视口的 fixed/absolute 子元素。
 */
export function createViewportReader(
  doc: Document,
  { batchSize = 20, maxNodes = 200 }: { batchSize?: number; maxNodes?: number } = {},
) {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 100 ||
    !Number.isInteger(maxNodes) ||
    maxNodes < 1 ||
    maxNodes > 1000
  ) {
    throw new RangeError('批次条数须为 1–100，节点预算须为 1–1000');
  }
  type Frame = { next: Element | null; clip: ViewportRect };
  let stack: Frame[] = [];
  let signature = '';
  let root: HTMLElement | null = null;
  return {
    readNext(): ViewportBatch {
      const win = doc.defaultView;
      if (!win) throw new Error('页面文档没有可用窗口');
      const viewport = { x: 0, y: 0, width: win.innerWidth, height: win.innerHeight };
      const current = [
        win.innerWidth,
        win.innerHeight,
        win.scrollX,
        win.scrollY,
        scrollTick.peek(),
        hostMutationTick.peek(),
      ].join(':');
      const restarted = signature !== current || root !== doc.body;
      if (restarted) {
        signature = current;
        root = doc.body;
        stack = root ? [{ next: root, clip: viewport }] : [];
      }
      const items: ViewportElement[] = [];
      let visited = 0;
      if (excluded(doc.documentElement, win.getComputedStyle(doc.documentElement))) stack = [];
      while (stack.length && visited < maxNodes && items.length < batchSize) {
        const frame = stack[stack.length - 1]!;
        const el = frame.next;
        if (!el) {
          stack.pop();
          continue;
        }
        frame.next = el === root ? null : el.nextElementSibling;
        visited++;
        if (!el.isConnected) continue;
        const style = win.getComputedStyle(el);
        if (excluded(el, style)) continue;
        const rect = rectOf(el.getBoundingClientRect());
        const visibleRect = intersect(rect, frame.clip);
        let childClip: ViewportRect | null = frame.clip;
        const clipX = /^(hidden|clip|scroll|auto)$/.test(style.overflowX || style.overflow);
        const clipY = /^(hidden|clip|scroll|auto)$/.test(style.overflowY || style.overflow);
        if (clipX || clipY) {
          childClip = intersect(frame.clip, {
            x: clipX ? rect.x : frame.clip.x,
            y: clipY ? rect.y : frame.clip.y,
            width: clipX ? rect.width : frame.clip.width,
            height: clipY ? rect.height : frame.clip.height,
          });
        }
        const boundary = el.tagName === 'IFRAME' ? 'iframe' : el.shadowRoot ? 'shadow-root' : undefined;
        if (childClip && !boundary && el.firstElementChild) stack.push({ next: el.firstElementChild, clip: childClip });
        if (el === root || !visibleRect || style.visibility === 'hidden' || style.visibility === 'collapse') continue;
        const role = roleOf(el);
        if (role === 'none' || role === 'presentation' || el.getAttribute('type') === 'hidden') continue;
        const name = nameOf(el, role);
        if (!role && !name.name && !boundary) continue;
        items.push({
          tag: el.tagName.toLowerCase(),
          role,
          ...name,
          selector: getSelector(el),
          rect,
          visibleRect,
          styles: getCursorStyles(el),
          ...(boundary ? { boundary } : {}),
        });
      }
      while (stack.length && !stack[stack.length - 1]!.next) stack.pop();
      return { items, viewport, visited, done: stack.length === 0, restarted };
    },
  };
}
