import { expect, mock, test } from 'bun:test';
import { render } from 'preact';
import * as compat from 'preact/compat';
import * as jsxRuntime from 'preact/jsx-runtime';

const baseUi = Bun.resolveSync('@base-ui/react', import.meta.dir);
const fromBaseUi = (id: string) => Bun.resolveSync(id, baseUi);
mock.module(fromBaseUi('react'), () => compat);
mock.module(fromBaseUi('react-dom'), () => compat);
mock.module(fromBaseUi('react/jsx-runtime'), () => jsxRuntime);

const { AttachmentThumbs } = await import('./AttachmentPicker');

test('composer screenshot exposes a separate preview and remove action', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const removed: string[] = [];
  const attachments: Parameters<typeof AttachmentThumbs>[0]['attachments'] = {
    ids: ['image-1'], uploading: false, capturing: false, picked: 1, full: false,
    late: async () => null, addFiles: () => {}, onPaste: () => {},
    settled: async () => ['image-1'], remove: (id) => { removed.push(id); }, reset: () => {},
  };
  render(<AttachmentThumbs attachments={attachments} resolveUrl={(id) => `/f/${id}`} />, root);
  const preview = root.querySelector<HTMLButtonElement>('[aria-label="放大查看截图"]');
  expect(preview).not.toBeNull();
  preview?.click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(document.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe('/f/image-1');
  const remove = root.querySelector<HTMLButtonElement>('[aria-label="Remove screenshot"]');
  remove?.click();
  expect(removed).toEqual(['image-1']);
  render(null, root);
  root.remove();
});
