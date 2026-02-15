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
    
    // If this was an auto-deny, update badge
    chrome.storage.local.get('autoMode', (data) => {
      if (data.autoMode && message.data.unchecked?.length > 0) {
        setBadge(sender.tab?.id, message.data.unchecked.length);
      }
    });
  }

  if (message.type === 'AUTO_DENY_SUCCESS') {
    // Update badge when auto-deny completes
    if (sender.tab?.id) {
      setBadge(sender.tab.id, '✓');
    }
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

// Badge management
function setBadge(tabId, text) {
  if (!tabId) return;
  
  const badgeText = typeof text === 'number' ? text.toString() : text;
  
  chrome.action.setBadgeText({ 
    text: badgeText,
    tabId: tabId 
  });
  
  chrome.action.setBadgeBackgroundColor({ 
    color: '#00e87a',  // Success green
    tabId: tabId 
  });
  
  // Clear badge after 5 seconds
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', tabId: tabId });
  }, 5000);
}

// Clear badge when tab is updated/navigated
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId: tabId });
  }
});
