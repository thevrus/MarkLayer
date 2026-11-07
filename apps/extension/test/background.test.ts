import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

type Tab = { overlay: boolean; receiver: boolean };
type TabsFake = Map<number, Tab>;

/** Stands in for the extension APIs, with content.js's own guard: a second run on a mounted page does nothing. */
function fakeBrowser({ tabs }: { tabs: TabsFake }) {
  const stats = { injections: 0, toggles: 0 };
  const clicks: ((tab: { id?: number }) => Promise<void> | void)[] = [];
  const event = <F>(sink: F[] = []) => ({ addListener: (fn: F) => sink.push(fn) });
  const api = {
    action: { onClicked: event(clicks) },
    runtime: { onInstalled: event(), onMessage: event() },
    contextMenus: { onClicked: event() },
    tabs: {
      onRemoved: event(),
      onUpdated: event(),
      sendMessage: async (id: number) => {
        if (!tabs.get(id)?.receiver) throw new Error('Could not establish connection. Receiving end does not exist.');
        stats.toggles++;
        return true;
      },
    },
    scripting: {
      executeScript: async ({ target, files }: { target: { tabId: number }; files?: string[] }) => {
        const tab = tabs.get(target.tabId);
        if (!files || !tab) return;
        stats.injections++;
        if (tab.overlay) return;
        tab.overlay = true;
        tab.receiver = true;
      },
    },
  };
  return { api, stats, click: (id: number) => clicks.at(-1)?.({ id }) };
}

const setGlobal = (key: string, value: unknown) =>
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

setGlobal('defineBackground', (main: () => void) => ({ main }));
const { default: background } = await import('../entrypoints/background');

/** A service worker starting: everything in its heap is new, whatever the tabs still hold. */
function startWorker(tabs: TabsFake) {
  const worker = fakeBrowser({ tabs });
  setGlobal('browser', worker.api);
  background.main();
  return worker;
}

describe('toolbar icon', () => {
  let tabs: TabsFake;
  beforeEach(() => {
    tabs = new Map([[1, { overlay: false, receiver: false }]]);
  });
  afterAll(() => setGlobal('browser', undefined));

  test('injects on the first click and toggles on the next', async () => {
    const worker = startWorker(tabs);
    await worker.click(1);
    await Bun.sleep(0);
    await worker.click(1);
    await Bun.sleep(0);
    expect(worker.stats).toEqual({ injections: 1, toggles: 1 });
  });

  test('a click after the worker restarted still toggles, without injecting again', async () => {
    await startWorker(tabs).click(1);
    await Bun.sleep(0);
    const restarted = startWorker(tabs);
    await restarted.click(1);
    await Bun.sleep(0);
    expect(restarted.stats).toEqual({ injections: 0, toggles: 1 });
  });

  test('a page load clears the tab, so the next click injects afresh', async () => {
    const worker = startWorker(tabs);
    await worker.click(1);
    await Bun.sleep(0);
    tabs.set(1, { overlay: false, receiver: false });
    await worker.click(1);
    await Bun.sleep(0);
    expect(worker.stats.injections).toBe(2);
  });
});
