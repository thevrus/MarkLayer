import { render } from 'preact';
import { App } from '../../components/App';
import { restoreDraft, visible } from '../../lib/state';
import './style.css';

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  cssInjectionMode: 'ui',

  async main(ctx) {
    // Skip injection when inside the MarkLayer web app (it has its own toolbar)
    if (document.documentElement.dataset.marklayer) return;

    // Injected on-demand via icon click — show immediately
    visible.value = true;
    restoreDraft();

    // Listen for toggle message from background script (subsequent icon clicks)
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
