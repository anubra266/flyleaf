/* Flyleaf — service worker.
   Routes the toolbar click and the keyboard command to the content
   script in the active tab. All real logic lives in content.js. */

/* The toolbar button opens the settings popup (manifest default_popup),
   so action.onClicked never fires. Only the keyboard command lives here. */
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-reader' && tab && tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'flyleaf-toggle' }).catch(() => {
      /* No content script in this tab (chrome:// pages, PDFs). */
    });
  }
});
