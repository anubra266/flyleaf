/* Flyleaf — service worker.
   Routes the toolbar click and the keyboard command to the content
   script in the active tab. All real logic lives in content.js. */

function toggle(tab) {
  if (!tab || !tab.id) {
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'flyleaf-toggle' }).catch(() => {
    /* No content script in this tab (chrome:// pages, web store, PDFs).
       Nothing to do. */
  });
}

chrome.action.onClicked.addListener(toggle);

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-reader') {
    toggle(tab);
  }
});
