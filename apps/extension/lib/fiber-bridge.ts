export interface DebugSource {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
}

export interface FrameworkComponent {
  framework: 'React' | 'Vue' | 'Svelte';
  chain: string[];
  source?: DebugSource;
}

declare global {
  interface Window {
    __ml_bridge_installed?: boolean;
  }
  interface WindowEventMap {
    'marklayer-detect': CustomEvent<unknown>;
    'marklayer-result': CustomEvent<FrameworkComponent | null>;
  }
}

/**
 * Runs in the page's MAIN world. Without this hop, the isolated-world content script
 * can't see `__reactFiber$<id>` / `__vueParentComponent` — those are properties on the
 * page's JS wrapper of each DOM node, not the isolated wrapper. Both directions of
 * dispatch fire listeners in both worlds synchronously, so detectFrameworkComponent can
 * stay synchronous: result is captured before el.dispatchEvent returns.
 *
 * Injected via `chrome.scripting.executeScript({ world: 'MAIN', func })` from the
 * background script — that path is exempt from page CSP, unlike inline <script> tags.
 *
 * Self-contained: nothing it references can come from outside, since the runtime
 * serializes this function with `.toString()` and re-parses it in the page world.
 */
export function bridgePayload(): void {
  if (window.__ml_bridge_installed) return;
  window.__ml_bridge_installed = true;

  const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9_$]+/;
  // React Refresh / HMR re-emits the same HOC under a numeric suffix on every reload
  // (WithComponentProps2, WithComponentProps3, …). Filter the whole numbered family.
  const NUMBERED_HOC_RE = /^(With|Connect|Inject|Memo|ForwardRef)[A-Z]\w*\d+$/;
  const REACT_LAZY_SYMBOL = Symbol.for('react.lazy');
  const WRAPPER_NAMES = new Set([
    'Anonymous',
    'MotionComponent',
    'LazyMotion',
    'PresenceChild',
    'AnimatePresence',
    'Suspense',
    'StrictMode',
    'Fragment',
    'Provider',
    'Consumer',
    'WithComponentProps',
    'Outlet',
    'RouterProvider',
    'BrowserRouter',
    'HashRouter',
    'MemoryRouter',
    'Routes',
    'Router',
  ]);

  const isUsable = (name: string): boolean =>
    COMPONENT_NAME_RE.test(name) && !WRAPPER_NAMES.has(name) && !NUMBERED_HOC_RE.test(name);

  const getString = (obj: unknown, key: string): string | null => {
    if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return null;
    const v = Reflect.get(obj, key);
    return typeof v === 'string' && v ? v : null;
  };

  const parseDisplayName = (name: string): string | null => {
    let cur = name;
    for (;;) {
      const m = cur.match(/\(([^()]+)\)/);
      if (!m) break;
      cur = m[1].trim();
    }
    return isUsable(cur) ? cur : null;
  };

  interface ReactFiberLike {
    type: unknown;
    return: ReactFiberLike | null;
  }

  const isReactFiber = (v: unknown): v is ReactFiberLike => {
    if (!v || typeof v !== 'object') return false;
    return 'return' in v && 'type' in v;
  };

  const findReactFiber = (el: Element): ReactFiberLike | null => {
    for (const key of Object.getOwnPropertyNames(el)) {
      if (!key.startsWith('__react')) continue;
      const v = Reflect.get(el, key);
      if (isReactFiber(v)) return v;
    }
    return null;
  };

  const unwrapWrapperType = (type: object): unknown => {
    if (Reflect.get(type, '$$typeof') === REACT_LAZY_SYMBOL) {
      const payload = Reflect.get(type, '_payload');
      if (payload && typeof payload === 'object') return Reflect.get(payload, '_result');
      return null;
    }
    return Reflect.get(type, 'render') ?? Reflect.get(type, 'type') ?? null;
  };

  const reactComponentName = (type: unknown): string | null => {
    if (typeof type === 'function') {
      const fromDisplay = parseDisplayName(getString(type, 'displayName') ?? '');
      if (fromDisplay) return fromDisplay;
      return parseDisplayName(getString(type, 'name') ?? '');
    }
    if (!type || typeof type !== 'object') return null;
    const fromDisplay = parseDisplayName(getString(type, 'displayName') ?? '');
    if (fromDisplay) return fromDisplay;
    const inner = unwrapWrapperType(type);
    if (inner && inner !== type) return reactComponentName(inner);
    return null;
  };

  const getDebugSource = (fiber: ReactFiberLike): DebugSource | null => {
    const src = Reflect.get(fiber, '_debugSource');
    if (!src || typeof src !== 'object') return null;
    const fileName = Reflect.get(src, 'fileName');
    const lineNumber = Reflect.get(src, 'lineNumber');
    if (typeof fileName !== 'string' || typeof lineNumber !== 'number') return null;
    const columnNumber = Reflect.get(src, 'columnNumber');
    return {
      fileName,
      lineNumber,
      columnNumber: typeof columnNumber === 'number' ? columnNumber : undefined,
    };
  };

  /** Single pass up `fiber.return`: collects component-name chain (cap 5) and the first
   * non-node_modules debug source (cap 10). Avoids walking the same chain twice. */
  const walkReact = (start: ReactFiberLike): { chain: string[]; source: DebugSource | null } => {
    const chain: string[] = [];
    let last = '';
    let userSource: DebugSource | null = null;
    let fallbackSource: DebugSource | null = null;
    let fiber: ReactFiberLike | null = start;
    let count = 0;
    while (fiber && count < 10) {
      if (chain.length < 5) {
        const n = reactComponentName(fiber.type);
        if (n && n !== last) {
          chain.push(n);
          last = n;
        }
      }
      if (!userSource) {
        const src = getDebugSource(fiber);
        if (src) {
          if (!src.fileName.includes('node_modules')) userSource = src;
          else fallbackSource ??= src;
        }
      }
      fiber = fiber.return;
      count++;
    }
    return { chain, source: userSource ?? fallbackSource };
  };

  const detectVue = (el: Element): FrameworkComponent | null => {
    const start = Reflect.get(el, '__vueParentComponent');
    if (!start || typeof start !== 'object') return null;
    const chain: string[] = [];
    let last = '';
    let comp: unknown = start;
    let n = 0;
    while (comp && typeof comp === 'object' && n < 5) {
      const type = Reflect.get(comp, 'type');
      const name = getString(type, 'name') ?? getString(type, '__name');
      if (name && name !== last && isUsable(name)) {
        chain.push(name);
        last = name;
      }
      comp = Reflect.get(comp, 'parent');
      n++;
    }
    return chain.length ? { framework: 'Vue', chain } : null;
  };

  const detect = (el: Element): FrameworkComponent | null => {
    const fiber = findReactFiber(el);
    if (fiber) {
      const { chain, source } = walkReact(fiber);
      if (chain.length || source) {
        return { framework: 'React', chain, source: source ?? undefined };
      }
    }
    return detectVue(el);
  };

  window.addEventListener('marklayer-detect', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    let result: FrameworkComponent | null = null;
    try {
      result = detect(target);
    } catch (err) {
      console.warn('[marklayer] fiber detect failed', err);
    }
    window.dispatchEvent(new CustomEvent('marklayer-result', { detail: result }));
  });
}

export function detectFrameworkComponent(el: Element): FrameworkComponent | null {
  // CustomEvent dispatch is synchronous — by the time `el.dispatchEvent` returns, the
  // MAIN-world bridge listener has already fired its 'marklayer-result' event back.
  let result: FrameworkComponent | null = null;
  const onResult = (e: WindowEventMap['marklayer-result']) => {
    result = e.detail;
  };
  window.addEventListener('marklayer-result', onResult);
  try {
    el.dispatchEvent(new CustomEvent('marklayer-detect', { bubbles: true }));
  } finally {
    window.removeEventListener('marklayer-result', onResult);
  }
  return result;
}
