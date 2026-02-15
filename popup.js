// popup.js — DenyStealthCookies Extension

document.addEventListener('DOMContentLoaded', async () => {
  const denyBtn       = document.getElementById('denyBtn');
  const btnText       = document.getElementById('btnText');
  const statusDot     = document.getElementById('statusDot');
  const statusLabel   = document.getElementById('statusLabel');
  const statusDetail  = document.getElementById('statusDetail');
  const siteDomain    = document.getElementById('siteDomain');
  const cmpBadgeWrap  = document.getElementById('cmpBadgeWrap');
  const noCmpNotice   = document.getElementById('noCmpNotice');
  const resultsSection = document.getElementById('resultsSection');
  const bannerStatus  = document.getElementById('bannerStatus');
  const statRemoved   = document.getElementById('statRemoved');
  const statKept      = document.getElementById('statKept');
  const statErrors    = document.getElementById('statErrors');
  const panelRemoved  = document.getElementById('panelRemoved');
  const panelKept     = document.getElementById('panelKept');
  const panelErrors   = document.getElementById('panelErrors');
  const footerTime    = document.getElementById('footerTime');
  const autoModeBadge = document.getElementById('autoModeBadge');
  const donationPrompt = document.getElementById('donationPrompt');
  const historyList   = document.getElementById('historyList');
  const historyStats  = document.getElementById('historyStats');

  // ── Init ──────────────────────────────────────────────────────────────────
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Check if auto-mode is enabled and show indicator
  chrome.storage.local.get('autoMode', (data) => {
    if (data.autoMode && autoModeBadge) {
      autoModeBadge.classList.add('active');
    }
  });

  // Load and display history on init
  loadHistory();  
  // Wire up clear history button
  document.getElementById('clearHistoryBtn')?.addEventListener('click', clearHistory);
  if (tab?.url) {
    try {
      siteDomain.textContent = new URL(tab.url).hostname.replace(/^www\./, '');
    } catch (_) { siteDomain.textContent = 'Unknown site'; }
  }

  // Quick CMP scan
  if (tab?.id) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_ONLY' });
      if (resp) {
        const cmps = parseCmps(resp.cmp);
        renderCmpBadges(cmps);
        if (cmps.length === 0 || resp.cmp === 'Generic/Unknown') {
          noCmpNotice.classList.add('visible');
          setStatus('ready', 'No standard CMP detected', `Found ${resp.toggleCount || 0} toggles — will attempt generic denial`);
        } else {
      setStatus('ready', 'Consent banner detected — ready to deny', `CMP: ${cmps.join(', ')} · Click to deny all`);
        }
      }
    } catch (_) {
      setStatus('ready', 'Ready — click to deny all non-essential', 'Click the button to remove non-essential tracking');
    }
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel' + cap(btn.dataset.tab)).classList.add('active');
      
      // Reload history when switching to history tab
      if (btn.dataset.tab === 'history') {
        loadHistory();
      }
    });
  });

  // ── Deny button ───────────────────────────────────────────────────────────
  denyBtn.addEventListener('click', async () => {
    if (denyBtn.disabled || denyBtn.classList.contains('running') || denyBtn.classList.contains('done-state')) return;

    setRunning();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found');

      // Re-inject content script to be safe (handles navigations)
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch (_) {} // already injected

      const result = await chrome.tabs.sendMessage(tab.id, { type: 'RUN_CLEAN' });
      if (!result) throw new Error('No response — ensure a consent banner is visible, then try again');

      renderResults(result);
      setDone(result);
    } catch (err) {
      setError(err.message);
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function setStatus(state, label, detail) {
    statusDot.className = 'status-dot ' + state;
    statusLabel.textContent = label;
    statusDetail.textContent = detail;
  }

  function setRunning() {
    denyBtn.classList.add('running');
    denyBtn.disabled = false;
    btnText.textContent = 'Denying all consents...';
    setStatus('running', 'Working...', 'Finding toggles, unchecking non-essential, closing banner');
    resultsSection.classList.remove('visible');
    bannerStatus.className = 'banner-status';
    bannerStatus.textContent = '';
  }

  function setDone(result) {
    denyBtn.classList.remove('running');
    denyBtn.classList.add('done-state');
    denyBtn.disabled = true;
    btnText.textContent = '✓ All Non-Essential Consents Denied';

    const removed = result.unchecked?.length || 0;
    const kept    = result.mandatory?.length || 0;
    const errs    = result.errors?.length || 0;
    const method  = result.cmpMethod ? ` via ${result.cmpMethod}` : '';
    const runtime = result.runtime ? ` (${(result.runtime/1000).toFixed(1)}s)` : '';
    const sections = result.sectionsProcessed?.length || 0;
    const iframes = result.iframesScanned || 0;

    let detailParts = [`${kept} essential kept`, `banner ${result.bannerClosed ? '✓ closed' : 'not closed'}`];
    if(sections > 0) detailParts.push(`${sections} sections`);
    if(iframes > 0) detailParts.push(`${iframes} iframes`);
    detailParts.push(method);
    detailParts.push(runtime);

    setStatus('done',
      `${removed} consent${removed !== 1 ? 's' : ''} denied`,
      detailParts.filter(Boolean).join(' · ')
    );

    // Banner closed pill
    if (result.bannerClosed) {
      bannerStatus.className = 'banner-status closed';
      bannerStatus.textContent = '✓ Consent banner closed';
    } else {
      bannerStatus.className = 'banner-status not-closed';
      bannerStatus.textContent = '⚠ Banner may still be visible — choices saved';
    }

    footerTime.textContent = 'Completed ' + new Date().toLocaleTimeString();
    incrementRunCount().then(count => {
      if (count >= 3) {
        const bar = document.getElementById('donationBar');
        chrome.storage.local.get('donationSnoozedUntil', d => {
          const snoozedUntil = d.donationSnoozedUntil || 0;
          if (bar && Date.now() >= snoozedUntil) bar.style.display = 'flex';
        });
      }
    });
    maybeSendTelemetry(result);
    resultsSection.classList.add('visible');

    // Update CMP badges from result
    if (result.cmpDetected) renderCmpBadges(parseCmps(result.cmpDetected));
    
    // Save to history
    saveToHistory(result);
    
    // Show donation prompt contextually
    showDonationPrompt(removed);
  }

  function setError(msg) {
    denyBtn.classList.remove('running');
    denyBtn.disabled = false;
    btnText.textContent = 'Deny All Non-Essential Consents';
    setStatus('error', 'Could not complete', msg);
  }

  function renderResults(data) {
    const removed = data.unchecked?.length || 0;
    const kept    = data.mandatory?.length || 0;
    const errs    = data.errors?.length || 0;

    statRemoved.textContent = removed;
    statKept.textContent    = kept;
    statErrors.textContent  = errs;

    document.getElementById('tabRemoved').textContent = `🚫 Denied (${removed})`;
    document.getElementById('tabKept').textContent    = `🔒 Kept (${kept})`;
    document.getElementById('tabErrors').textContent  = `⚠ Errors (${errs})`;

    panelRemoved.innerHTML = removed > 0
      ? data.unchecked.map(item => renderItem(item, 'removed')).join('')
      : '<div class="result-empty">No consents were removed.<br>The banner may not have been visible or already denied.</div>';

    panelKept.innerHTML = kept > 0
      ? data.mandatory.map(item => renderItem(item, 'kept')).join('')
      : '<div class="result-empty">No mandatory/essential items detected on this page.</div>';

    panelErrors.innerHTML = errs > 0
      ? data.errors.map(e => `
          <div class="result-item">
            <span class="item-icon">⚠</span>
            <div class="item-body">
              <div class="item-label">${esc(e.label || 'Unknown')}</div>
              <span class="item-cat">${esc(e.error || 'Unknown error')}</span>
            </div>
          </div>`).join('')
      : '<div class="result-empty">No errors — clean run.</div>';
  }

  function renderItem(item, type) {
    const icon = type === 'removed' ? '🚫' : '🔒';
    const catClass = getCatClass(item.category, item.type);
    const catLabel = item.type ? `${item.category} · ${item.type}` : item.category;
    const section = item.section && item.section !== 'Main' ? ` [${item.section}]` : '';
    return `
      <div class="result-item">
        <span class="item-icon">${icon}</span>
        <div class="item-body">
          <div class="item-label">${esc(item.label || 'Unknown')}${section}</div>
          <span class="item-cat ${catClass}">${esc(catLabel || '')}</span>
        </div>
      </div>`;
  }

  function getCatClass(category, type) {
    const c = (category || '').toLowerCase();
    const t = (type || '').toLowerCase();
    if (t.includes('legitimate') || c.includes('legitimate')) return 'legitimate';
    if (t.includes('consent') || c.includes('consent')) return 'consent';
    if (c.includes('vendor')) return 'vendor';
    if (c.includes('essential') || c.includes('necessary') || c.includes('locked') || c.includes('mandatory')) return 'mandatory';
    return '';
  }

  function parseCmps(str) {
    if (!str || str === 'Generic/Unknown') return [];
    return str.split(',').map(s => s.trim()).filter(Boolean);
  }

  function renderCmpBadges(cmps) {
    cmpBadgeWrap.innerHTML = cmps.map(c => `<span class="cmp-badge">${esc(c)}</span>`).join(' ');
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

// ── History Management ─────────────────────────────────────────────────────

const HISTORY_EXPIRY_DAYS = 30;

async function saveToHistory(result) {
  if (!result || result.unchecked?.length === 0) return; // Don't save empty results
  
  const url = result.url || window.location.href;
  const domain = extractDomain(url);
  
  // Get existing history
  const data = await chrome.storage.local.get('denyHistory');
  let history = data.denyHistory || [];
  
  // Dedupe: Check if we just saved this URL in last 5 seconds
  const recent = history[0];
  if (recent && recent.url === url && Date.now() - recent.timestamp < 5000) {
    return; // Skip duplicate entry
  }
  
  const historyItem = {
    id: Date.now(),
    domain,
    url,
    timestamp: Date.now(),
    denied: result.unchecked?.length || 0,
    kept: result.mandatory?.length || 0,
    cmp: result.cmpDetected || 'Unknown',
    method: result.cmpMethod || 'manual',
    runtime: result.runtime || 0,
    bannerClosed: result.bannerClosed || false,
    actionLog: result.actionLog || [],  // Detailed action log
    consentOrPay: result.consentOrPay || false  // Consent-or-pay detection
  };
  
  // Remove expired entries (older than 30 days)
  const expiryTime = Date.now() - (HISTORY_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  history = history.filter(item => item.timestamp > expiryTime);
  
  // Add new item to beginning
  history.unshift(historyItem);
  
  // No item limit - let it grow naturally, only expire by date
  
  // Save back
  await chrome.storage.local.set({ denyHistory: history });
}

async function loadHistory() {
  const data = await chrome.storage.local.get('denyHistory');
  let history = data.denyHistory || [];
  
  // Remove expired entries
  const expiryTime = Date.now() - (HISTORY_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  history = history.filter(item => item.timestamp > expiryTime);
  
  if (history.length === 0) {
    historyList.innerHTML = '<div class="result-empty">No history yet. Start denying consents!</div>';
    historyStats.textContent = 'No denials recorded';
    return;
  }
  
  // Calculate stats
  const totalDenied = history.reduce((sum, item) => sum + item.denied, 0);
  const uniqueSites = new Set(history.map(item => item.domain)).size;
  
  historyStats.textContent = `${totalDenied.toLocaleString()} total denied · ${uniqueSites} sites · ${history.length} sessions`;
  
  // Render history items
  historyList.innerHTML = history.map((item, index) => {
    const date = new Date(item.timestamp);
    const timeAgo = formatTimeAgo(item.timestamp);
    const hasActionLog = item.actionLog && item.actionLog.length > 0;
    const consentOrPayBadge = item.consentOrPay ? '<span class="consent-or-pay-badge" title="Consent-or-pay detected">⚠️ Pay Wall</span>' : '';
    const bannerStatus = item.bannerClosed ? '✓ Closed' : '⚠ Open';
    const bannerClass = item.bannerClosed ? 'success' : 'warn';
    
    // Format action log
    const actionLogHtml = hasActionLog ? `
      <div class="history-action-log" id="actionLog${index}" style="display:none;">
        <div class="action-log-title">Action Log:</div>
        ${item.actionLog.map(log => `
          <div class="action-log-entry">
            <span class="action-log-time">${log.time}ms</span>
            <span class="action-log-action">${esc(log.action)}</span>
          </div>
        `).join('')}
      </div>
    ` : '';
    
    return `
      <div class="history-item">
        <div class="history-item-header">
          <div class="history-item-domain">
            ${esc(item.domain)}
            ${consentOrPayBadge}
          </div>
          <div class="history-item-date" title="${date.toLocaleString()}">${timeAgo}</div>
        </div>
        <div class="history-item-stats">
          <div class="history-item-stat">
            <span class="history-item-stat-icon">🚫</span>
            <span>${item.denied} denied</span>
          </div>
          <div class="history-item-stat">
            <span class="history-item-stat-icon">🔒</span>
            <span>${item.kept} kept</span>
          </div>
          <div class="history-item-stat">
            <span class="history-item-stat-icon">⚙</span>
            <span>${item.cmp}</span>
          </div>
          <div class="history-item-stat">
            <span class="history-item-stat-icon ${bannerClass}">🎯</span>
            <span>${bannerStatus}</span>
          </div>
        </div>
        ${hasActionLog ? `
          <div class="history-item-expand">
            <button class="expand-log-btn" onclick="toggleActionLog(${index})">
              <span class="expand-icon" id="expandIcon${index}">▶</span>
              View ${item.actionLog.length} actions
            </button>
          </div>
        ` : ''}
        ${actionLogHtml}
      </div>
    `;
  }).join('');
}

// Toggle action log visibility (global function for inline onclick)
window.toggleActionLog = function(index) {
  const log = document.getElementById(`actionLog${index}`);
  const icon = document.getElementById(`expandIcon${index}`);
  if (log && icon) {
    const isHidden = log.style.display === 'none';
    log.style.display = isHidden ? 'block' : 'none';
    icon.textContent = isHidden ? '▼' : '▶';
  }
}

async function clearHistory() {
  if (!confirm('Clear all history? This cannot be undone.')) return;
  
  await chrome.storage.local.set({ denyHistory: [] });
  loadHistory();
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown';
  }
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

// Clear history button handler
document.getElementById('clearHistoryBtn')?.addEventListener('click', clearHistory);

// ── Donation Prompt Management ─────────────────────────────────────────────

const DONATION_SNOOZE_DAYS = 14;

async function showDonationPrompt(deniedCount) {
  const data = await chrome.storage.local.get(['runCount', 'donationPromptSnoozedUntil', 'lastDonationPrompt']);
  const runCount = data.runCount || 0;
  const snoozedUntil = data.donationPromptSnoozedUntil || 0;
  const lastShown = data.lastDonationPrompt || 0;
  
  // Don't show if snoozed, or shown in last 24 hours
  const dayInMs = 24 * 60 * 60 * 1000;
  if (Date.now() < snoozedUntil || (Date.now() - lastShown < dayInMs)) return;
  
  // Show after 5th use, or if user denied a lot (50+) this session
  if (runCount >= 5 || deniedCount >= 50) {
    if (donationPrompt) {
      // Get total denied from history for milestone messages
      const histData = await chrome.storage.local.get('denyHistory');
      const history = histData.denyHistory || [];
      const totalDenied = history.reduce((sum, item) => sum + item.denied, 0);
      
      // Set contextual message
      const titleEl = document.getElementById('donationPromptTitle');
      if (titleEl) {
        if (totalDenied >= 1000) {
          titleEl.textContent = `🎉 You've blocked ${totalDenied.toLocaleString()}+ trackers!`;
        } else if (totalDenied >= 500) {
          titleEl.textContent = `Amazing! ${totalDenied.toLocaleString()} trackers blocked!`;
        } else if (deniedCount >= 50) {
          titleEl.textContent = `${deniedCount} trackers denied this session! 💪`;
        } else {
          titleEl.textContent = 'Enjoying DenyStealthCookies?';
        }
      }
      
      donationPrompt.style.display = 'block';
      chrome.storage.local.set({ lastDonationPrompt: Date.now() });
    }
  }
}

// Donation prompt dismiss handler (snooze for 14 days)
document.getElementById('dismissDonationPrompt')?.addEventListener('click', () => {
  if (donationPrompt) donationPrompt.style.display = 'none';
  const snoozeUntil = Date.now() + (DONATION_SNOOZE_DAYS * 24 * 60 * 60 * 1000);
  chrome.storage.local.set({ donationPromptSnoozedUntil: snoozeUntil });
});

// ── Settings, Donation & Telemetry ─────────────────────────────────────────

async function initSettings() {
  const data = await chrome.storage.local.get(['telemetryOptIn','autoMode','donationSnoozedUntil','runCount']);

  // Telemetry toggle
  const telToggle = document.getElementById('telemetryToggle');
  if (telToggle) {
    telToggle.checked = data.telemetryOptIn === true;
    telToggle.addEventListener('change', () => {
      chrome.storage.local.set({ telemetryOptIn: telToggle.checked });
    });
  }

  // Auto mode toggle
  const autoToggle = document.getElementById('autoModeToggle');
  if (autoToggle) {
    autoToggle.checked = data.autoMode === true;
    autoToggle.addEventListener('change', () => {
      chrome.storage.local.set({ autoMode: autoToggle.checked });
      // Update badge visibility
      const badge = document.getElementById('autoModeBadge');
      if (badge) {
        if (autoToggle.checked) {
          badge.classList.add('active');
        } else {
          badge.classList.remove('active');
        }
      }
    });
  }

  // Donation bar — show after 3rd use, unless snoozed
  const runCount = (data.runCount || 0);
  const snoozedUntil = data.donationSnoozedUntil || 0;
  const donationBar = document.getElementById('donationBar');
  if (donationBar && runCount >= 3 && Date.now() >= snoozedUntil) {
    donationBar.style.display = 'flex';
  }

  const dismissBtn = document.getElementById('dismissDonation');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      if (donationBar) donationBar.style.display = 'none';
      const snoozeUntil = Date.now() + (DONATION_SNOOZE_DAYS * 24 * 60 * 60 * 1000);
      chrome.storage.local.set({ donationSnoozedUntil: snoozeUntil });
    });
  }
}

function initSettingsToggle() {
  const btn = document.getElementById('settingsToggle');
  const drawer = document.getElementById('settingsDrawer');
  if (!btn || !drawer) return;
  btn.addEventListener('click', () => {
    drawer.classList.toggle('open');
    btn.style.color = drawer.classList.contains('open') ? 'var(--accent)' : '';
  });
}

// Increment run count for donation prompt
async function incrementRunCount() {
  const data = await chrome.storage.local.get('runCount');
  const newCount = (data.runCount || 0) + 1;
  chrome.storage.local.set({ runCount: newCount });
  return newCount;
}

// Telemetry ping after successful clean
async function maybeSendTelemetry(result) {
  const data = await chrome.storage.local.get('telemetryOptIn');
  if (!data.telemetryOptIn) return;

  const cmpRaw = result.cmpDetected || 'unknown';
  const known  = ['tcf','onetrust','cookiebot','trustarc','quantcast','didomi','usercentrics','axeptio'];
  const cmp    = known.find(k => cmpRaw.toLowerCase().includes(k)) || 'other';

  const payload = {
    v:      '1.1.0',
    s:      getAnonSession(),
    cmp,
    denied: Math.min(result.unchecked?.length || 0, 9999),
    kept:   Math.min(result.mandatory?.length || 0, 100),
    closed: result.bannerClosed ? 1 : 0,
    ts:     Math.floor(Date.now() / 1000),
  };

  try {
    await fetch('https://telemetry.denystealth.io/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (_) { /* silent */ }
}

function getAnonSession() {
  // Use a per-install random ID stored locally (no personal data)
  // This is only sent if user opted in to telemetry
  return 'dsc-' + Math.random().toString(36).substr(2, 12);
}

// ── Init all extras ─────────────────────────────────────────────────────────
initSettings();
initSettingsToggle();

});
