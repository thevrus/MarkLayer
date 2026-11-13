import { expect, test } from 'bun:test';
import { shootViewport } from './capture';

test('tab capture leaves the overlay visible and asks for the chosen crop', async () => {
  const overlay = document.createElement('mark-layer');
  document.body.appendChild(overlay);
  const sent: unknown[] = [];
  const originalBrowser = Reflect.get(globalThis, 'browser');
  const originalBitmap = globalThis.createImageBitmap;
  Reflect.set(globalThis, 'browser', {
    runtime: {
      sendMessage: async (message: unknown) => {
        expect(overlay.style.opacity).toBe('');
        sent.push(message);
        return { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
      },
    },
  });
  Reflect.set(globalThis, 'createImageBitmap', async () => ({}));
  try {
    await shootViewport({ x: 10, y: 20, width: 100, height: 120 });
    expect(sent).toEqual([
      expect.objectContaining({ crop: expect.objectContaining({ x: 10, y: 20, width: 100, height: 120 }) }),
    ]);
    expect(overlay.style.opacity).toBe('');
  } finally {
    Reflect.set(globalThis, 'browser', originalBrowser);
    Reflect.set(globalThis, 'createImageBitmap', originalBitmap);
    overlay.remove();
  }
});
