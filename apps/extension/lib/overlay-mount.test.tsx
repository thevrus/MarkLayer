import { expect, test } from 'bun:test';
import { scrollTick } from './host-mutations';
import { mountOverlay } from './overlay-mount';

test('仅改变 html CSS zoom 时抵消 overlay 缩放并通知锚点重算', async () => {
  const host = document.createElement('mark-layer');
  const container = document.createElement('div');
  host.attachShadow({ mode: 'open' }).append(container);
  document.body.append(host);
  const originalZoom = document.documentElement.style.zoom;
  const unmount = mountOverlay({ container, app: <div /> });
  try {
    const before = scrollTick.peek();
    document.documentElement.style.zoom = '1.5';
    // MutationObserver → overlay rAF → 合帧几何通知，不发送 resize/scroll。
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(Number(host.style.zoom)).toBeCloseTo(1 / 1.5);
    expect(scrollTick.peek()).toBeGreaterThan(before);
  } finally {
    unmount();
    document.documentElement.style.zoom = originalZoom;
    host.remove();
  }
});
