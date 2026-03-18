import { render } from 'preact';
import { App } from '../../components/App';
import { visible } from '../../lib/state';
import './style.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    // Skip injection when inside the MarkLayer web app (it has its own toolbar)
    if (document.documentElement.dataset.marklayer) return;
    // Listen for toggle message from background script (browser action click)
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'toggle-annotate') {
        visible.value = !visible.value;
      }
    });

    const ui = await createShadowRootUi(ctx, {
      name: 'mark-layer',
      position: 'overlay',
      onMount(container) {
        render(<App />, container);
        return container;
      },
      onRemove(container) {
        if (container) render(null, container);
      },
    });
    ui.mount();
  },
});
