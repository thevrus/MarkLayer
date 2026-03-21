export default defineBackground(() => {
  const injected = new Set<number>();

  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id == null) return;

    if (injected.has(tab.id)) {
      // Already injected — toggle visibility
      browser.tabs.sendMessage(tab.id, { type: 'toggle-annotate' });
    } else {
      // First click — inject content script (activeTab grants permission)
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['/content-scripts/content.js'],
      });
      injected.add(tab.id);
    }
  });

  // Clean up when tabs close or navigate
  browser.tabs.onRemoved.addListener((tabId) => injected.delete(tabId));
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') injected.delete(tabId);
  });
});
