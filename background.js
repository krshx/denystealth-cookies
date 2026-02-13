// background.js — DenyStealthCookies Extension Service Worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DSC_SCAN_COMPLETE') {
    chrome.storage.local.set({
      lastScanResult: {
        tabId: sender.tab?.id,
        url: sender.tab?.url,
        timestamp: Date.now(),
        ...message.data
      }
    });
  }

  if (message.type === 'GET_RESULTS') {
    chrome.storage.local.get('lastScanResult', (data) => {
      sendResponse(data.lastScanResult || null);
    });
    return true;
  }

  if (message.type === 'EXECUTE_CLEAN') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: (options) => window.postMessage({ type: 'DENYSTEALTH_CLEAN', options }, '*'),
          args: [message.options]
        }).then(() => sendResponse({ success: true }))
          .catch(err => sendResponse({ success: false, error: err.message }));
      }
    });
    return true;
  }
});
