// popup.js — DenyStealthCookies Extension

// ── Debug Configuration ────────────────────────────────────────────────────
// Set to false for production to disable all console logging
const DEBUG = true;
const log = DEBUG ? console.log.bind(console) : () => {};

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
  const teachBtn      = document.getElementById('teachBtn');
  const teachBtnText  = document.getElementById('teachBtnText');
  const learnedPatternsSection = document.getElementById('learnedPatternsSection');
  const learnedPatternsList = document.getElementById('learnedPatternsList');
  const clearPatternsBtn = document.getElementById('clearPatternsBtn');

  // Constants
  const HISTORY_EXPIRY_DAYS = 30;
  const DONATION_SNOOZE_DAYS = 14;
  
  // Global filter state
  let activeFilter = null;

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
  // Wire up clear history button (using arrow function for consistent scoping)
  document.getElementById('clearHistoryBtn')?.addEventListener('click', () => clearHistory());
  // Wire up clear filter button (using arrow function to avoid reference error)
  document.getElementById('clearFilterBtn')?.addEventListener('click', () => clearFilter());
  if (tab?.url) {
    try {
      siteDomain.textContent = new URL(tab.url).hostname.replace(/^www\./, '');
    } catch (_) { siteDomain.textContent = 'Unknown site'; }
  }

  // Check for previous scan results (from auto-mode or manual deny)
  let previousResultShown = false;
  try {
    const previousResult = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_RESULTS' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
    
    console.log('[Popup] Previous result check:', { 
      hasResult: !!previousResult, 
      resultUrl: previousResult?.url,
      currentUrl: tab?.url 
    });
    
    // Normalize URLs for comparison (ignore trailing slash, www, query params, hash)
    const normalizeUrl = (url) => {
      try {
        const u = new URL(url);
        const hostname = u.hostname.replace(/^www\./, '');
        const pathname = u.pathname.replace(/\/$/, '') || '/';
        return `${u.protocol}//${hostname}${pathname}`;
      } catch {
        return url;
      }
    };
    
    // Show previous results if they exist and match current tab URL
    const urlsMatch = previousResult && tab?.url && 
                      normalizeUrl(previousResult.url) === normalizeUrl(tab.url);
    
    // Only show if result is recent (within last 30 minutes) to avoid stale data
    const resultAge = Date.now() - (previousResult?.timestamp || 0);
    const isRecent = resultAge < 30 * 60 * 1000; // 30 minutes
    
    if (urlsMatch && isRecent) {
      console.log('[Popup] Found previous scan result, displaying...');
      console.log('[Popup] Result age:', Math.round(resultAge/1000), 'seconds');
      console.log('[Popup] Normalized URLs match:', normalizeUrl(previousResult.url), '===', normalizeUrl(tab.url));
      renderResults(previousResult);
      setDone(previousResult, true); // true = isPreviousResult
      previousResultShown = true;
      
      // Update CMP badges
      if (previousResult.cmpDetected) {
        renderCmpBadges(parseCmps(previousResult.cmpDetected));
      }
      
      // Hide "No CMP" notice since we have results
      noCmpNotice.classList.remove('visible');
      
      console.log('[Popup] Previous results displayed, skipping SCAN_ONLY');
    } else {
      if (previousResult && !isRecent) {
        console.log('[Popup] Previous result is stale (age:', Math.round(resultAge/1000), 'seconds), will run fresh scan');
      } else if (previousResult && !urlsMatch) {
        console.log('[Popup] URLs do not match:', normalizeUrl(previousResult.url), 'vs', normalizeUrl(tab.url));
      } else {
        console.log('[Popup] No previous result found, will run SCAN_ONLY');
      }
    }
  } catch (err) {
    console.log('[Popup] Could not load previous results:', err);
  }

  // Wait for content script to be ready (it's auto-injected via manifest.json)
  let contentScriptAvailable = false;
  const isRestrictedPage = tab?.url && (
    tab.url.startsWith('chrome://') || 
    tab.url.startsWith('about://') ||
    tab.url.startsWith('chrome-extension://') ||
    tab.url.startsWith('edge://') ||
    tab.url.startsWith('file://')
  );
  
  if (tab?.id && !isRestrictedPage) {
    // Wait up to 2 seconds for content script to be ready
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const pingResponse = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
        if (pingResponse?.ready) {
          contentScriptAvailable = true;
          break;
        }
      } catch (e) {
        // Script not ready yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    if (!contentScriptAvailable) {
      log('[Popup] Content script not ready after 2 seconds');
      // Disable interactive features that require content script
      if (teachBtn) {
        teachBtn.disabled = true;
        teachBtn.title = 'Content script not available on this page';
        teachBtn.style.opacity = '0.5';
        teachBtn.style.cursor = 'not-allowed';
      }
    }
  } else if (isRestrictedPage) {
    log('[Popup] Cannot inject content script on restricted page:', tab?.url);
    // Disable features that need content script
    if (teachBtn) {
      teachBtn.disabled = true;
      teachBtn.title = 'Not available on browser internal pages';
      teachBtn.style.opacity = '0.5';
      teachBtn.style.cursor = 'not-allowed';
    }
    if (denyBtn) {
      denyBtn.disabled = true;
      setStatus('error', 'Cannot run on this page', 'Extension cannot access browser internal pages');
    }
  }

  // Quick CMP scan (only if we haven't shown previous results)
  if (!previousResultShown && tab?.id) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_ONLY' });
      if (resp) {
        const cmps = parseCmps(resp.cmp);
        renderCmpBadges(cmps);
        
        // Check if auto-denial already completed
        if (resp.autoComplete && resp.autoResult) {
          log('[Popup] Auto-denial already completed, showing result');
          
          // Show success status
          const result = {
            unchecked: Array(resp.autoResult.denied).fill(''), // Mock array for count
            mandatory: Array(resp.autoResult.kept).fill(''),
            bannerClosed: resp.autoResult.bannerClosed,
            cmpDetected: resp.autoResult.cmp || cmps.join(', '),
            timestamp: resp.autoResult.timestamp
          };
          
          setDone(result, true); // true = isPreviousResult
          renderResults(result);
          noCmpNotice.classList.remove('visible');
        } else if (cmps.length === 0 || resp.cmp === 'Generic/Unknown') {
          noCmpNotice.classList.add('visible');
          setStatus('ready', 'No standard CMP detected', `Found ${resp.toggleCount || 0} toggles — will attempt generic denial`);
        } else {
          setStatus('ready', 'Consent banner detected — ready to deny', `CMP: ${cmps.join(', ')} · Click to deny all`);
        }
      }
    } catch (scanError) {
      // Content script not available yet - that's okay, user can still click the button
      log('Initial scan failed:', scanError.message);
      setStatus('ready', 'Ready — click to deny all non-essential', 'Click the button to remove non-essential tracking');
    }
  }

  // ── Load and display learned patterns ─────────────────────────────────────
  async function loadLearnedPatterns() {
    if (!tab?.id) return;
    
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_LEARNED_PATTERNS' });
      console.log('[DenyStealthCookies Popup] Received patterns:', resp);
      if (resp?.patterns && resp.patterns.patterns?.length > 0) {
        learnedPatternsSection.style.display = 'block';
        renderLearnedPatterns(resp.patterns.patterns);
      } else {
        learnedPatternsSection.style.display = 'none';
      }
    } catch (err) {
      console.log('Could not load learned patterns:', err.message);
    }
  }

  function renderLearnedPatterns(patterns) {
    if (!patterns || patterns.length === 0) {
      learnedPatternsList.innerHTML = '<div style="color: var(--text-dim); font-size: 11px;">No patterns learned yet</div>';
      return;
    }
    
    // Sort by success count
    const sorted = [...patterns].sort((a, b) => b.successCount - a.successCount);
    
    learnedPatternsList.innerHTML = sorted.map(p => `
      <div class="learned-pattern-item">
        <span class="learned-pattern-text">"${esc(p.text.substring(0, 40))}"</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="learned-pattern-meta">${p.successCount}× used</span>
          <span class="learned-pattern-badge">${p.method === 'user-taught' ? 'Taught' : 'Auto'}</span>
        </div>
      </div>
    `).join('');
  }

  // Load patterns on init
  loadLearnedPatterns();

  // ── Teaching Mode ──────────────────────────────────────────────────────────
  let teachingModeActive = false;
  
  teachBtn?.addEventListener('click', async () => {
    if (!tab?.id) return;
    
    // Check if content script is available before trying to use it
    if (!contentScriptAvailable) {
      alert('Teaching mode requires the content script to be active.\n\nThis feature is not available on:\n• Browser internal pages (chrome://, edge://)\n• Extension pages\n• File:// URLs\n\nTry navigating to a regular website first.');
      return;
    }
    
    if (!teachingModeActive) {
      // Enter teaching mode
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'ENTER_TEACHING_MODE' });
        teachingModeActive = true;
        teachBtn.classList.add('teaching-active');
        teachBtnText.textContent = 'Click the Deny Button on Page...';
        
        // Close popup after a short delay to let user interact with page
        setTimeout(() => window.close(), 300);
      } catch (err) {
        log('Failed to enter teaching mode:', err);
        let errorMsg;
        if (err.message?.includes('body not available')) {
          errorMsg = 'Page not fully loaded. Please wait a moment and try again.';
        } else if (err.message?.includes('Receiving end does not exist')) {
          errorMsg = 'Content script is not responding.\n\nPlease reload the page and try again.';
        } else {
          errorMsg = 'Could not enter teaching mode.\n\nTry reloading the page or navigating to a different website.';
        }
        alert(errorMsg);
      }
    } else {
      // Exit teaching mode
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'EXIT_TEACHING_MODE' });
        teachingModeActive = false;
        teachBtn.classList.remove('teaching-active');
        teachBtnText.textContent = 'Extension Missed a Popup?';
      } catch (err) {
        log('Failed to exit teaching mode:', err);
      }
    }
  });

  // Clear learned patterns for this domain
  clearPatternsBtn?.addEventListener('click', async () => {
    if (!tab?.url) return;
    
    if (!confirm('Clear all learned patterns for this website?')) return;
    
    try {
      const domain = new URL(tab.url).hostname.replace(/^www\./, '');
      const { learnedPatterns } = await chrome.storage.local.get('learnedPatterns');
      
      if (learnedPatterns && learnedPatterns[domain]) {
        delete learnedPatterns[domain];
        await chrome.storage.local.set({ learnedPatterns });
        
        learnedPatternsSection.style.display = 'none';
        alert('Learned patterns cleared for this website.');
      }
    } catch (err) {
      console.error('Failed to clear patterns:', err);
      alert('Failed to clear patterns.');
    }
  });

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
      
      // Load dashboard when switching to dashboard tab
      if (btn.dataset.tab === 'dashboard') {
        loadDashboard();
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

      // Check if we can run on this page
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('about://') || 
          tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('edge://')) {
        throw new Error('Cannot run on browser internal pages');
      }

      // Ping content script to ensure it's ready (with retry)
      let scriptReady = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const pingResponse = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
          if (pingResponse?.ready) {
            scriptReady = true;
            break;
          }
        } catch (e) {
          if (attempt < 4) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }

      if (!scriptReady) {
        throw new Error('Extension not ready. Please refresh the page and try again.');
      }

      const result = await chrome.tabs.sendMessage(tab.id, { type: 'RUN_CLEAN' });
      if (!result) throw new Error('No response — ensure a consent banner is visible, then try again');

      renderResults(result);
      setDone(result);
    } catch (err) {
      let errorMsg = err.message;
      
      // Improve error messaging for common cases
      if (errorMsg.includes('Receiving end does not exist')) {
        errorMsg = 'Extension not ready. Please refresh the page and try again.';
      } else if (errorMsg.includes('Cannot access')) {
        errorMsg = 'Cannot access this page. Try a different website.';
      }
      
      setError(errorMsg);
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

  function setDone(result, isPreviousResult = false) {
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

    // Show timestamp - format based on whether it's a previous result
    if (isPreviousResult && result.timestamp) {
      footerTime.textContent = 'Completed ' + formatTimeAgo(result.timestamp);
    } else {
      footerTime.textContent = 'Completed ' + new Date().toLocaleTimeString();
    }
    
    // Only do these actions for fresh results, not previous results
    if (!isPreviousResult) {
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
      
      // Save to history
      saveToHistory(result);
      
      // Show donation prompt contextually
      showDonationPrompt(removed);
    }
    
    resultsSection.classList.add('visible');

    // Update CMP badges from result
    if (result.cmpDetected) renderCmpBadges(parseCmps(result.cmpDetected));
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
    method: result.cmpMethod || 'manual',
    runtime: result.runtime || 0,
    bannerFound: result.bannerFound || false,
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
  
  // Apply filter if active
  let filteredHistory = history;
  if (activeFilter) {
    filteredHistory = applyFilter(history, activeFilter);
  }
  
  // Calculate stats
  const totalDenied = history.reduce((sum, item) => sum + item.denied, 0);
  const uniqueSites = new Set(history.map(item => item.domain)).size;
  
  // Show filter status or regular stats
  if (activeFilter && filteredHistory.length < history.length) {
    historyStats.textContent = `Showing ${filteredHistory.length} of ${history.length} sessions · ${totalDenied.toLocaleString()} total denied`;
  } else {
    historyStats.textContent = `${totalDenied.toLocaleString()} total denied · ${uniqueSites} sites · ${history.length} sessions`;
  }
  
  // Render filtered history items
  if (filteredHistory.length === 0) {
    historyList.innerHTML = '<div class="result-empty">No sessions match this filter.</div>';
    return;
  }
  
  historyList.innerHTML = filteredHistory.map((item, index) => {
    const date = new Date(item.timestamp);
    const timeAgo = formatTimeAgo(item.timestamp);
    const hasActionLog = item.actionLog && item.actionLog.length > 0;
    const consentOrPayBadge = item.consentOrPay ? '<span class="consent-or-pay-badge" title="Consent-or-pay detected">⚠️ Pay Wall</span>' : '';
    
    // Banner status handling
    let bannerStatus = '';
    let bannerClass = '';
    if (!item.bannerFound && item.denied === 0) {
      bannerStatus = 'No Banner';
      bannerClass = 'warn';
    } else if (item.bannerClosed) {
      bannerStatus = '✓ Closed';
      bannerClass = 'success';
    } else if (item.bannerFound) {
      bannerStatus = '⚠ Not Closed';
      bannerClass = 'warn';
    } else {
      bannerStatus = '⚠ Open';
      bannerClass = 'warn';
    }
    
    // Build detailed denial stats with consent/LI breakdown
    let denialDetails = '';
    if (item.consentDenials || item.legitimateInterestDenials) {
      const parts = [];
      if (item.consentDenials) parts.push(`${item.consentDenials} consent`);
      if (item.legitimateInterestDenials) parts.push(`${item.legitimateInterestDenials} LI`);
      denialDetails = parts.join(', ');
    } else {
      denialDetails = `${item.denied} total`;
    }
    
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
          <div class="history-item-stat" title="${item.denied} total denials">
            <span class="history-item-stat-icon">🚫</span>
            <span>${denialDetails}</span>
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
            <button class="expand-log-btn" data-log-index="${index}">
              <span class="expand-icon" id="expandIcon${index}">▶</span>
              View ${item.actionLog.length} actions
            </button>
          </div>
        ` : ''}
        ${actionLogHtml}
      </div>
    `;
  }).join('');
  
  // Add event delegation for expand buttons (after rendering)
  setTimeout(() => {
    document.querySelectorAll('.expand-log-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = btn.dataset.logIndex;
        const log = document.getElementById(`actionLog${index}`);
        const icon = document.getElementById(`expandIcon${index}`);
        if (log && icon) {
          const isHidden = log.style.display === 'none';
          log.style.display = isHidden ? 'block' : 'none';
          icon.textContent = isHidden ? '▼' : '▶';
        }
      });
    });
  }, 0);
}

// ── Filter Functions ────────────────────────────────────────────────────────

function applyFilter(history, filter) {
  if (!filter) return history;
  
  switch (filter.type) {
    case 'status':
      return history.filter(item => {
        switch (filter.value) {
          case 'fullSuccess':
            return item.bannerClosed;
          case 'partial':
            return item.denied > 0 && !item.bannerClosed;
          case 'failed':
            return item.bannerFound && !item.bannerClosed && item.denied === 0;
          case 'noBanner':
            return !item.bannerFound && item.bannerFound !== undefined;
          default:
            return true;
        }
      });
    
    case 'denialType':
      return history.filter(item => {
        switch (filter.value) {
          case 'consent':
            return (item.consentDenials || 0) > 0;
          case 'li':
            return (item.legitimateInterestDenials || 0) > 0;
          case 'banner':
            return item.bannerClosed;
          default:
            return true;
        }
      });
    
    case 'date':
      const targetDate = new Date(filter.value).toISOString().split('T')[0];
      return history.filter(item => {
        const itemDate = new Date(item.timestamp).toISOString().split('T')[0];
        return itemDate === targetDate;
      });
    
    case 'domain':
      return history.filter(item => item.domain === filter.value);
    
    default:
      return history;
  }
}

function setFilter(type, value, label) {
  activeFilter = { type, value, label };
  
  // Show filter indicator
  const filterIndicator = document.getElementById('filterIndicator');
  const filterText = document.getElementById('filterText');
  if (filterIndicator && filterText) {
    filterText.textContent = label;
    filterIndicator.style.display = 'flex';
  }
  
  // Switch to history tab
  switchToHistoryTab();
  
  // Reload history with filter
  loadHistory();
}

function clearFilter() {
  activeFilter = null;
  
  // Hide filter indicator
  const filterIndicator = document.getElementById('filterIndicator');
  if (filterIndicator) {
    filterIndicator.style.display = 'none';
  }
  
  // Reload history without filter
  loadHistory();
}

function switchToHistoryTab() {
  // Activate history tab
  const historyTab = document.querySelector('[data-tab="history"]');
  const historyPanel = document.getElementById('panelHistory');
  
  if (historyTab && historyPanel) {
    // Remove active from all tabs/panels
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    
    // Activate history tab
    historyTab.classList.add('active');
    historyPanel.classList.add('active');
    
    // Smooth scroll to history list
    setTimeout(() => {
      historyPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }
}

async function clearHistory() {
  if (!confirm('Clear all history? This cannot be undone.')) return;
  
  await chrome.storage.local.set({ denyHistory: [] });
  clearFilter(); // Also clear any active filter
  loadHistory();
}

// ── Dashboard / Analytics ──────────────────────────────────────────────────
let dashboardCharts = {}; // Store chart instances for cleanup

async function loadDashboard() {
  try {
    const data = await chrome.storage.local.get('denyHistory');
    let history = data.denyHistory || [];
    
    // Remove expired entries
    const expiryTime = Date.now() - (HISTORY_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    history = history.filter(item => item.timestamp > expiryTime);
    
    // Calculate statistics
    const stats = calculateDashboardStats(history);
    
    // Update stat cards
    document.getElementById('totalDenials').textContent = stats.totalDenials.toLocaleString();
    document.getElementById('successRate').textContent = stats.successRate + '%';
    document.getElementById('partialDenials').textContent = stats.partialDenials;
    document.getElementById('failedDenials').textContent = stats.failedDenials;
    
    // Create/update charts
    createSuccessChart(stats);
    createTypesChart(stats);
    createTimelineChart(history);
    createTopSitesChart(history);
    
    // Load learning analytics
    await loadLearningAnalytics();
    
  } catch (err) {
    console.error('[Dashboard] Error loading dashboard:', err);
  }
}

function calculateDashboardStats(history) {
  const totalSessions = history.length;
  const totalDenials = history.reduce((sum, item) => sum + item.denied, 0);
  
  // Categorize sessions
  let fullSuccess = 0;  // Banner closed + denials
  let partialSuccess = 0; // Denials but banner not closed
  let noBanner = 0; // No banner found
  let failed = 0; // Banner found but couldn't close
  
  let consentDenials = 0;
  let liDenials = 0;
  let bannerClosures = 0;
  
  history.forEach(item => {
    if (item.bannerClosed) {
      fullSuccess++;
      bannerClosures++;
    } else if (item.denied > 0) {
      partialSuccess++;
    } else if (!item.bannerFound && item.bannerFound !== undefined) {
      // Only count as noBanner if bannerFound is explicitly false
      noBanner++;
    } else if (item.bannerFound && !item.bannerClosed) {
      // Banner was found but not closed
      failed++;
    }
    
    // Use actual consent/LI breakdown if available, otherwise fall back to estimation
    if (item.consentDenials !== undefined || item.legitimateInterestDenials !== undefined) {
      consentDenials += item.consentDenials || 0;
      liDenials += item.legitimateInterestDenials || 0;
    } else {
      // Legacy fallback: estimate based on CMP type for old history items
      const isLI = item.cmp && (item.cmp.toLowerCase().includes('legitimate') || 
                                item.cmp.toLowerCase().includes('tcf'));
      if (isLI && item.denied > 0) {
        liDenials += Math.floor(item.denied * 0.6);
        consentDenials += Math.ceil(item.denied * 0.4);
      } else {
        consentDenials += item.denied;
      }
    }
  });
  
  const successRate = totalSessions > 0 
    ? Math.round((fullSuccess / totalSessions) * 100) 
    : 0;
  
  return {
    totalDenials,
    totalSessions,
    fullSuccess,
    partialSuccess: partialSuccess,
    failedDenials: failed,
    noBanner,
    successRate,
    consentDenials,
    liDenials,
    bannerClosures
  };
}

function createSuccessChart(stats) {
  const ctx = document.getElementById('successChart');
  if (!ctx) return;
  
  // Destroy existing chart
  if (dashboardCharts.success) {
    dashboardCharts.success.destroy();
  }
  
  dashboardCharts.success = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Full Success', 'Partial', 'Failed', 'No Banner'],
      datasets: [{
        data: [
          stats.fullSuccess, 
          stats.partialSuccess, 
          stats.failedDenials, 
          stats.noBanner
        ],
        backgroundColor: [
          'rgba(0, 232, 122, 0.8)',   // success green
          'rgba(255, 184, 0, 0.8)',   // warn yellow
          'rgba(255, 59, 92, 0.8)',   // error red
          'rgba(138, 149, 168, 0.5)'  // dim gray
        ],
        borderColor: [
          'rgba(0, 232, 122, 1)',
          'rgba(255, 184, 0, 1)',
          'rgba(255, 59, 92, 1)',
          'rgba(138, 149, 168, 0.7)'
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const labels = ['fullSuccess', 'partial', 'failed', 'noBanner'];
          const labelTexts = ['Full Success', 'Partial Success', 'Failed Denials', 'No Banner Detected'];
          setFilter('status', labels[index], `📊 ${labelTexts[index]}`);
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#e8edf5',
            font: { size: 10, family: 'DM Sans' },
            padding: 8
          }
        },
        tooltip: {
          backgroundColor: 'rgba(17, 20, 24, 0.95)',
          titleColor: '#e8edf5',
          bodyColor: '#8a95a8',
          borderColor: '#1e2530',
          borderWidth: 1,
          padding: 10,
          displayColors: true
        }
      }
    }
  });
}

function createTypesChart(stats) {
  const ctx = document.getElementById('typesChart');
  if (!ctx) return;
  
  if (dashboardCharts.types) {
    dashboardCharts.types.destroy();
  }
  
  dashboardCharts.types = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Consent Denials', 'LI Denials', 'Banner Closures'],
      datasets: [{
        label: 'Count',
        data: [stats.consentDenials, stats.liDenials, stats.bannerClosures],
        backgroundColor: [
          'rgba(255, 59, 92, 0.7)',
          'rgba(0, 200, 255, 0.7)',
          'rgba(0, 232, 122, 0.7)'
        ],
        borderColor: [
          'rgba(255, 59, 92, 1)',
          'rgba(0, 200, 255, 1)',
          'rgba(0, 232, 122, 1)'
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const types = ['consent', 'li', 'banner'];
          const labels = ['Consent Denials', 'Legitimate Interest Denials', 'Banner Closures'];
          setFilter('denialType', types[index], `📊 ${labels[index]}`);
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { 
            color: '#8a95a8',
            font: { size: 10 }
          },
          grid: {
            color: 'rgba(30, 37, 48, 0.5)'
          }
        },
        x: {
          ticks: { 
            color: '#e8edf5',
            font: { size: 10 }
          },
          grid: {
            display: false
          }
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(17, 20, 24, 0.95)',
          titleColor: '#e8edf5',
          bodyColor: '#8a95a8',
          borderColor: '#1e2530',
          borderWidth: 1,
          padding: 10
        }
      }
    }
  });
}

function createTimelineChart(history) {
  const ctx = document.getElementById('timelineChart');
  if (!ctx) return;
  
  if (dashboardCharts.timeline) {
    dashboardCharts.timeline.destroy();
  }
  
  // Group by day
  const dayMap = {};
  const now = Date.now();
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
  
  history.forEach(item => {
    if (item.timestamp < thirtyDaysAgo) return;
    const dayKey = new Date(item.timestamp).toISOString().split('T')[0];
    if (!dayMap[dayKey]) {
      dayMap[dayKey] = { date: dayKey, denials: 0, sessions: 0 };
    }
    dayMap[dayKey].denials += item.denied;
    dayMap[dayKey].sessions += 1;
  });
  
  // Sort by date and get last 14 days
  const sortedDays = Object.values(dayMap).sort((a, b) => 
    new Date(a.date) - new Date(b.date)
  ).slice(-14);
  
  const labels = sortedDays.map(d => {
    const date = new Date(d.date);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const denialData = sortedDays.map(d => d.denials);
  const sessionData = sortedDays.map(d => d.sessions);
  
  dashboardCharts.timeline = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Denials',
        data: denialData,
        borderColor: 'rgba(255, 59, 92, 1)',
        backgroundColor: 'rgba(255, 59, 92, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3
      }, {
        label: 'Sessions',
        data: sessionData,
        borderColor: 'rgba(0, 200, 255, 1)',
        backgroundColor: 'rgba(0, 200, 255, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const dateStr = sortedDays[index].date;
          const date = new Date(dateStr);
          const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          setFilter('date', dateStr, `📅 ${formatted}`);
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { 
            color: '#8a95a8',
            font: { size: 10 }
          },
          grid: {
            color: 'rgba(30, 37, 48, 0.5)'
          }
        },
        x: {
          ticks: { 
            color: '#e8edf5',
            font: { size: 9 },
            maxRotation: 45,
            minRotation: 45
          },
          grid: {
            display: false
          }
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#e8edf5',
            font: { size: 10 },
            padding: 8,
            usePointStyle: true
          }
        },
        tooltip: {
          backgroundColor: 'rgba(17, 20, 24, 0.95)',
          titleColor: '#e8edf5',
          bodyColor: '#8a95a8',
          borderColor: '#1e2530',
          borderWidth: 1,
          padding: 10
        }
      }
    }
  });
}

function createTopSitesChart(history) {
  const ctx = document.getElementById('topSitesChart');
  if (!ctx) return;
  
  if (dashboardCharts.topSites) {
    dashboardCharts.topSites.destroy();
  }
  
  // Aggregate by domain
  const siteMap = {};
  history.forEach(item => {
    if (!siteMap[item.domain]) {
      siteMap[item.domain] = 0;
    }
    siteMap[item.domain] += item.denied;
  });
  
  // Get top 8 sites
  const topSites = Object.entries(siteMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  
  const fullDomains = topSites.map(([domain]) => domain);
  const labels = topSites.map(([domain]) => {
    // Truncate long domains
    return domain.length > 20 ? domain.substring(0, 17) + '...' : domain;
  });
  const data = topSites.map(([, count]) => count);
  
  dashboardCharts.topSites = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Denials',
        data: data,
        backgroundColor: 'rgba(0, 232, 122, 0.7)',
        borderColor: 'rgba(0, 232, 122, 1)',
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const domain = fullDomains[index];
          setFilter('domain', domain, `🌐 ${domain}`);
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { 
            color: '#8a95a8',
            font: { size: 10 }
          },
          grid: {
            color: 'rgba(30, 37, 48, 0.5)'
          }
        },
        y: {
          ticks: { 
            color: '#e8edf5',
            font: { size: 9 }
          },
          grid: {
            display: false
          }
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(17, 20, 24, 0.95)',
          titleColor: '#e8edf5',
          bodyColor: '#8a95a8',
          borderColor: '#1e2530',
          borderWidth: 1,
          padding: 10
        }
      }
    }
  });
}

// ── Learning Analytics ────────────────────────────────────────────────────
async function loadLearningAnalytics() {
  try {
    // Load learning data from storage
    const data = await chrome.storage.local.get(['globalLearnedPatterns', 'customSemanticPatterns']);
    const globalPatterns = data.globalLearnedPatterns || {};
    const customPatterns = data.customSemanticPatterns || {};
    
    // Calculate statistics
    const allPatterns = Object.values(globalPatterns);
    const totalPatterns = allPatterns.length;
    const promotedCount = Object.keys(customPatterns).length;
    const uniqueDomains = new Set();
    let totalConfidence = 0;
    
    allPatterns.forEach(pattern => {
      if (pattern.domains) {
        pattern.domains.forEach(d => uniqueDomains.add(d));
      }
      totalConfidence += (pattern.confidence || 0.5);
    });
    
    const avgConfidence = totalPatterns > 0 
      ? Math.round((totalConfidence / totalPatterns) * 100) 
      : 0;
    
    // Update stat cards
    document.getElementById('totalLearnedPatterns').textContent = totalPatterns;
    document.getElementById('learningSites').textContent = uniqueDomains.size;
    document.getElementById('avgConfidence').textContent = avgConfidence + '%';
    document.getElementById('promotedPatterns').textContent = promotedCount;
    
    // Render patterns view
    const viewContainer = document.getElementById('learningPatternsView');
    if (totalPatterns === 0) {
      viewContainer.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-dim); font-size: 11px;">
          <div style="font-size: 32px; margin-bottom: 8px;">🌱</div>
          <div>No patterns learned yet</div>
          <div style="margin-top: 4px; opacity: 0.7;">Extension will automatically learn from successful button clicks</div>
        </div>
      `;
      return;
    }
    
    // Sort patterns by confidence * usage
    const sortedPatterns = allPatterns.sort((a, b) => {
      const scoreA = (a.confidence || 0.5) * (a.usageCount || 1);
      const scoreB = (b.confidence || 0.5) * (b.usageCount || 1);
      return scoreB - scoreA;
    }).slice(0, 20); // Show top 20
    
    viewContainer.innerHTML = `
      <div style="font-size: 10px; color: var(--text-dim); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;">
        Top ${Math.min(sortedPatterns.length, 20)} Patterns by Performance
      </div>
      ${sortedPatterns.map(pattern => {
        const confidencePercent = Math.round((pattern.confidence || 0.5) * 100);
        const isPromoted = pattern.text in customPatterns;
        const color = confidencePercent >= 85 ? '#00e87a' : confidencePercent >= 70 ? '#ffb800' : '#8a95a8';
        
        return `
          <div style="
            padding: 8px 10px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 6px;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 11px;
          ">
            <div style="flex: 1; min-width: 0;">
              <div style="
                font-family: var(--mono);
                color: var(--text);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                margin-bottom: 3px;
              ">"${esc(pattern.text)}"</div>
              <div style="display: flex; gap: 8px; font-size: 9px; color: var(--text-dim);">
                <span>🎯 ${pattern.usageCount || 1} uses</span>
                <span>🌍 ${pattern.domains?.length || 1} sites</span>
                <span>📈 ${pattern.classification || 'deny'}</span>
              </div>
            </div>
            <div style="
              background: rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5,7),16)}, 0.15);
              color: ${color};
              padding: 4px 8px;
              border-radius: 4px;
              font-family: var(--mono);
              font-size: 10px;
              font-weight: 700;
              white-space: nowrap;
            ">${confidencePercent}%</div>
            ${isPromoted ? '<div style="color: #9333ea; font-size: 14px;" title="Promoted to semantic library">⭐</div>' : ''}
          </div>
        `;
      }).join('')}
      ${totalPatterns > 20 ? `
        <div style="text-align: center; padding: 8px; color: var(--text-dim); font-size: 10px;">
          ... and ${totalPatterns - 20} more patterns
        </div>
      ` : ''}
    `;
    
  } catch (err) {
    console.error('[Learning Analytics] Error loading learning analytics:', err);
    document.getElementById('learningPatternsView').innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--accent); font-size: 11px;">
        Failed to load learning analytics
      </div>
    `;
  }
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
    await fetch('https://telemetry.guardr.io/ping', {
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
