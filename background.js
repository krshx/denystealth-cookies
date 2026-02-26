// background.js — DenyStealthCookies Extension Service Worker

// ── Debug Configuration ────────────────────────────────────────────────────
// Set to false for production to disable all console logging
const DEBUG = true;
const log = DEBUG ? console.log.bind(console) : () => {};

// Constants
const HISTORY_EXPIRY_DAYS = 30;

// Helper function to extract domain from URL
function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./i, '');
  } catch {
    return 'unknown';
  }
}

// Save result to history
async function saveToHistory(result) {
  if (!result) return;
  
  // Record history if:
  // 1. Banner was found (even if we couldn't interact with it), OR
  // 2. We denied some cookies, OR
  // 3. Banner was closed
  // This helps track extension effectiveness on all sites, not just successful ones
  const bannerFound = result.bannerFound || false;
  const didSomething = result.bannerClosed || (result.unchecked && result.unchecked.length > 0);
  
  if (!bannerFound && !didSomething) {
    console.log('[Background] Skipping history save - no banner found and no actions taken');
    return;
  }
  
  const url = result.url || '';
  const domain = extractDomain(url);
  
  // Get existing history
  const data = await chrome.storage.local.get('denyHistory');
  let history = data.denyHistory || [];
  
  // Dedupe: Check if we saved this domain in last 2 minutes (avoids spam during testing)
  const recentSameDomain = history.find(item => 
    item.domain === domain && Date.now() - item.timestamp < 120000
  );
  if (recentSameDomain) {
    console.log('[Background] Skipping duplicate history entry for', domain, '(saved within last 2 minutes)');
    return; // Skip duplicate entry
  }
  
  // Calculate detailed breakdown of denials
  const uncheckedItems = result.unchecked || [];
  let consentDenials = 0;
  let legitimateInterestDenials = 0;
  let otherDenials = 0;
  
  uncheckedItems.forEach(item => {
    const type = item.type || '';
    if (type === 'consent') {
      consentDenials++;
    } else if (type === 'legitimate interest' || type === 'legitimate') {
      legitimateInterestDenials++;
    } else if (type !== 'deny-all' && type !== 'reject') {
      // Count other types (but exclude button clicks which are recorded separately)
      otherDenials++;
    }
  });
  
  const historyItem = {
    id: Date.now(),
    domain,
    url,
    timestamp: Date.now(),
    denied: uncheckedItems.length,
    consentDenials,
    legitimateInterestDenials,
    otherDenials,
    kept: result.mandatory?.length || 0,
    cmp: result.cmpDetected || 'Unknown',
    method: result.cmpMethod || 'auto',
    runtime: result.runtime || 0,
    bannerFound,
    bannerClosed: result.bannerClosed || false,
    actionLog: result.actionLog || [],
    consentOrPay: result.consentOrPay || false
  };
  
  // Remove expired entries (older than 30 days)
  const expiryTime = Date.now() - (HISTORY_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  history = history.filter(item => item.timestamp > expiryTime);
  
  // Add new item to beginning
  history.unshift(historyItem);
  
  // Save back
  await chrome.storage.local.set({ denyHistory: history });
  
  // Log detailed breakdown
  const breakdown = [];
  if (consentDenials > 0) breakdown.push(`${consentDenials} consent`);
  if (legitimateInterestDenials > 0) breakdown.push(`${legitimateInterestDenials} LI`);
  if (otherDenials > 0) breakdown.push(`${otherDenials} other`);
  const detailsStr = breakdown.length > 0 ? ` (${breakdown.join(', ')})` : '';
  
  console.log(`[DenyStealthCookies] Saved to history: ${domain} - ${historyItem.denied} denied${detailsStr}, banner ${bannerFound ? (result.bannerClosed ? 'closed' : 'found but not closed') : 'not found'}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DSC_SCAN_COMPLETE') {
    const result = {
      tabId: sender.tab?.id,
      url: sender.tab?.url || message.data.url, // Fallback to data.url if sender.tab.url not available
      timestamp: Date.now(),
      ...message.data
    };
    
    console.log('[Background] Saving scan result:', {
      url: result.url,
      bannerFound: result.bannerFound,
      bannerClosed: result.bannerClosed,
      denied: result.unchecked?.length
    });
    
    chrome.storage.local.set({ lastScanResult: result });
    
    // Save to history if auto-mode was used and banner was found
    (async () => {
      const data = await chrome.storage.local.get('autoMode');
      console.log('[Background] Auto-mode:', data.autoMode, 'Banner found:', message.data.bannerFound);
      if (data.autoMode && (message.data.bannerFound || message.data.unchecked?.length > 0)) {
        // Save to history
        await saveToHistory(result);
        
        // Update badge
        if (message.data.unchecked?.length > 0) {
          await setBadge(sender.tab?.id, message.data.unchecked.length);
        }
      }
    })();
  }

  if (message.type === 'AUTO_DENY_SUCCESS') {
    // Update badge when auto-deny completes
    if (sender.tab?.id) {
      (async () => {
        await setBadge(sender.tab.id, '✓');
      })();
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
      if (tabs[0]?.id) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: (options) => window.postMessage({ type: 'DENYSTEALTH_CLEAN', options }, '*'),
          args: [message.options]
        }).then(() => sendResponse({ success: true }))
          .catch(err => {
            console.log('[Background] executeScript error:', err.message);
            sendResponse({ success: false, error: err.message });
          });
      } else {
        sendResponse({ success: false, error: 'No active tab found' });
      }
    });
    return true;
  }
});

// Badge management
async function setBadge(tabId, text) {
  if (!tabId) return;
  
  // Check if tab still exists before setting badge
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return; // Tab doesn't exist
  } catch (err) {
    // Tab was closed or doesn't exist - silently ignore
    console.log('[Background] Tab', tabId, 'no longer exists, skipping badge update');
    return;
  }
  
  const badgeText = typeof text === 'number' ? text.toString() : text;
  
  try {
    await chrome.action.setBadgeText({ 
      text: badgeText,
      tabId: tabId 
    });
    
    await chrome.action.setBadgeBackgroundColor({ 
      color: '#00e87a',  // Success green
      tabId: tabId 
    });
    
    // Clear badge after 5 seconds
    setTimeout(async () => {
      try {
        // Check if tab still exists before clearing
        await chrome.tabs.get(tabId);
        await chrome.action.setBadgeText({ text: '', tabId: tabId });
      } catch (err) {
        // Tab closed, ignore
      }
    }, 5000);
  } catch (err) {
    console.log('[Background] Error setting badge:', err.message);
  }
}

// Clear badge when tab is updated/navigated
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Clear badge, but handle case where tab might be closing
    chrome.action.setBadgeText({ text: '', tabId: tabId }).catch(err => {
      // Tab might have been closed, ignore the error
    });
  }
});
