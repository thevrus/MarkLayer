import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { hostMutationTick, scrollTick } from './host-mutations';
import { createViewportReader } from './viewport-reader';

let root: HTMLDivElement;
const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;

/** happy-dom 不做布局；测试明确指定每个盒子，不把模拟几何当浏览器验收。 */
function box(el: Element, x = 10, y = 10, width = 100, height = 30) {
  el.getBoundingClientRect = () => new DOMRect(x, y, width, height);
  return el;
}

function fixture(html: string) {
  root.innerHTML = html;
  for (const el of root.querySelectorAll('*')) box(el);
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.scrollTo(0, 0);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  root = document.createElement('div');
  document.body.append(root);
  box(document.body, 0, 0, 800, 20000);
  box(root, 0, 0, 800, 20000);
});

afterEach(() => {
  root.remove();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
});

test('复杂 DOM 输出角色、常见可访问名、稳定选择器、视口裁剪和关键样式', () => {
  fixture(
    '<section><h2 id="heading">设置</h2><button data-testid="save"><span>保存</span><span hidden>秘密</span></button><label for="email">邮箱</label><input id="email" type="email"><img alt="产品图"><button aria-labelledby="heading">忽略</button><a href="/" aria-label="主页">图标</a></section>',
  );
  const button = root.querySelector('button')!;
  box(button, -10, 580, 100, 50);
  const batch = createViewportReader(document).readNext();
  expect(batch.done).toBe(true);
  const save = batch.items.find((item) => item.selector.includes('data-testid'))!;
  expect(save).toMatchObject({
    tag: 'button',
    role: 'button',
    name: '保存',
    nameSource: 'contents',
    nameTruncated: false,
  });
  expect(save.visibleRect).toEqual({ x: 0, y: 580, width: 90, height: 20 });
  expect(save.rect).toEqual({ x: -10, y: 580, width: 100, height: 50 });
  expect(Object.keys(save.styles)).toEqual([
    'color',
    'background-color',
    'font-size',
    'font-family',
    'display',
    'position',
  ]);
  for (const item of batch.items) expect(document.querySelector(item.selector)).not.toBeNull();
  expect(batch.items.find((item) => item.tag === 'input')).toMatchObject({
    name: '邮箱',
    role: 'textbox',
    nameSource: 'label',
  });
  expect(batch.items.find((item) => item.tag === 'img')?.name).toBe('产品图');
  expect(batch.items.find((item) => item.nameSource === 'aria-labelledby')?.name).toBe('设置');
  expect(batch.items.find((item) => item.tag === 'a')?.name).toBe('主页');
});

test('隐藏、ARIA 隐藏、inert、透明和扩展自有子树不会被读取', () => {
  fixture(
    '<div hidden><button>hidden</button></div><div aria-hidden="true"><button>aria</button></div><div inert><button>inert</button></div><div style="display:none"><button>display</button></div><div style="opacity:0"><button>opacity</button></div><div style="content-visibility:hidden"><button>content</button></div><mark-layer><button>overlay</button></mark-layer><button style="visibility:hidden">visibility</button><button id="visible">可读</button>',
  );
  const hiddenChild = root.querySelector('[hidden] button')!;
  const measure = spyOn(hiddenChild, 'getBoundingClientRect');
  const batch = createViewportReader(document).readNext();
  expect(batch.items.map((item) => item.name)).toEqual(['可读']);
  expect(measure).not.toHaveBeenCalled();
});

test('超出视口和滚动容器裁剪区域的元素不产出，部分可见区域按交集报告', () => {
  fixture(
    '<button id="below">离屏</button><div id="clip" style="overflow:hidden"><button id="clipped">裁掉</button><button id="partial">部分</button></div>',
  );
  box(root.querySelector('#below')!, 10, 900);
  box(root.querySelector('#clip')!, 100, 100, 100, 100);
  box(root.querySelector('#clipped')!, 250, 100);
  box(root.querySelector('#partial')!, 180, 180, 50, 50);
  const batch = createViewportReader(document).readNext();
  expect(batch.items.map((item) => item.name)).toEqual(['部分']);
  expect(batch.items[0]?.visibleRect).toEqual({ x: 180, y: 180, width: 20, height: 20 });
});

test('离屏且允许溢出的容器不剪掉伸入视口的后代，display:contents 不阻断后代', () => {
  fixture(
    '<div id="outside"><button id="floating">浮动</button></div><div style="display:contents"><button>内容盒子</button></div>',
  );
  box(root.querySelector('#outside')!, 0, 2000);
  box(root.querySelector('[style]')!, 0, 0, 0, 0);
  expect(
    createViewportReader(document)
      .readNext()
      .items.map((item) => item.name),
  ).toEqual(['浮动', '内容盒子']);
});

test('iframe 仅报告边界，不访问同源或跨源内部文档，也不泄露 src', () => {
  fixture('<iframe title="内嵌页面"></iframe>');
  const frame = root.querySelector('iframe')!;
  Object.defineProperty(frame, 'contentDocument', {
    get: () => {
      throw new Error('禁止穿透');
    },
  });
  Object.defineProperty(frame, 'src', {
    get: () => {
      throw new Error('禁止读取地址');
    },
  });
  const batch = createViewportReader(document).readNext();
  expect(batch.items).toHaveLength(1);
  expect(batch.items[0]).toMatchObject({ tag: 'iframe', name: '内嵌页面', boundary: 'iframe' });
  expect(JSON.stringify(batch)).not.toContain('token=secret');
});

test('开放 shadow root 明确报告边界，不混用跨 root 的选择器', () => {
  fixture('<div id="component" aria-label="组件"></div>');
  const component = root.firstElementChild!;
  component.attachShadow({ mode: 'open' }).innerHTML = '<button>内部</button>';
  expect(createViewportReader(document).readNext().items).toMatchObject([{ name: '组件', boundary: 'shadow-root' }]);
});

test('长页面按需分批，创建和等待均不读取，预算耗尽可返回未结束的空批次', async () => {
  fixture(Array.from({ length: 1000 }, (_, i) => `<button id="row-${i}">条目 ${i}</button>`).join(''));
  const far = root.lastElementChild!;
  const measure = spyOn(far, 'getBoundingClientRect');
  const reader = createViewportReader(document, { batchSize: 2, maxNodes: 4 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(measure).not.toHaveBeenCalled();
  const first = reader.readNext();
  expect(first.visited).toBe(4);
  expect(first.items.map((item) => item.name)).toEqual(['条目 0', '条目 1']);
  const next = reader.readNext();
  expect(next.items.map((item) => item.name)).toEqual(['条目 2', '条目 3']);
  expect(next.restarted).toBe(false);
  expect(measure).not.toHaveBeenCalled();
  for (let i = 4; i < 10; i++) box(root.children[i]!, 0, 2000);
  const empty = reader.readNext();
  expect(empty.items).toEqual([]);
  expect(empty.visited).toBe(4);
  expect(empty.done).toBe(false);
});

test('滚动、视口变化或几何 tick 后仅在下次请求重置游标；结束不会自动重扫', () => {
  fixture('<button id="a">A</button><button id="b">B</button>');
  const reader = createViewportReader(document, { batchSize: 1 });
  expect(reader.readNext().items[0]?.name).toBe('A');
  expect(reader.readNext().items[0]?.name).toBe('B');
  expect(reader.readNext()).toMatchObject({ done: true, items: [], visited: 0 });
  scrollTick.value++;
  expect(reader.readNext()).toMatchObject({ restarted: true, items: [{ name: 'A' }] });
  hostMutationTick.value++;
  expect(reader.readNext().restarted).toBe(true);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
  expect(reader.readNext().viewport.width).toBe(500);
});

test('名称有上限，不读取密码或文本输入值，不序列化全页 HTML', () => {
  fixture(
    '<button aria-label="' +
      '长'.repeat(300) +
      '">短</button><input type="password" aria-label="口令" value="password-secret"><input type="text" aria-label="用户名" value="user-secret">',
  );
  const batch = createViewportReader(document).readNext();
  expect(batch.items[0]?.name).toHaveLength(200);
  expect(batch.items[0]?.nameTruncated).toBe(true);
  expect(JSON.stringify(batch)).not.toContain('password-secret');
  expect(JSON.stringify(batch)).not.toContain('user-secret');
});

test('无效预算显式拒绝，防止一次请求无限读取', () => {
  expect(() => createViewportReader(document, { batchSize: 0 })).toThrow(RangeError);
  expect(() => createViewportReader(document, { maxNodes: Infinity })).toThrow(RangeError);
});

test('隐藏文档根节点不读取后代，离屏元素不读取名称或样式条目', () => {
  fixture('<button id="below">离屏文本</button><button>可见</button>');
  const below = root.firstElementChild!;
  box(below, 0, 10000);
  Object.defineProperty(below, 'firstChild', {
    get: () => {
      throw new Error('不应提取离屏名称');
    },
  });
  expect(
    createViewportReader(document)
      .readNext()
      .items.map((item) => item.name),
  ).toEqual(['可见']);
  document.documentElement.hidden = true;
  try {
    expect(createViewportReader(document).readNext()).toMatchObject({ done: true, items: [], visited: 0 });
  } finally {
    document.documentElement.hidden = false;
  }
});

test('装饰图片不产出，按钮名称排除隐藏文本并保留 input 按钮静态标签', () => {
  fixture(
    '<img alt=""><button><span style="visibility:hidden">隐藏文本</span><b>保存</b></button><input type="submit" value="提交">',
  );
  const batch = createViewportReader(document).readNext();
  expect(batch.items.some((item) => item.tag === 'img')).toBe(false);
  expect(batch.items.find((item) => item.tag === 'button')?.name).toBe('保存');
  expect(batch.items.find((item) => item.tag === 'input')).toMatchObject({
    role: 'button',
    name: '提交',
    nameSource: 'value',
  });
});
