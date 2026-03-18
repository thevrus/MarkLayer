export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    if (tab.id != null) {
      browser.tabs.sendMessage(tab.id, { type: 'toggle-annotate' });
    }
  });
});
