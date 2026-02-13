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

  // ── Init ──────────────────────────────────────────────────────────────────
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

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
    const found   = result.bannerFound ? ' · banner found' : ' · no banner detected';

    setStatus('done',
      `${removed} consent${removed !== 1 ? 's' : ''} denied`,
      `${kept} essential kept · banner ${result.bannerClosed ? '✓ closed' : 'not closed'}${method}`
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
        chrome.storage.local.get('donationDismissed', d => {
          if (bar && !d.donationDismissed) bar.style.display = 'flex';
        });
      }
    });
    maybeSendTelemetry(result);
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
    return `
      <div class="result-item">
        <span class="item-icon">${icon}</span>
        <div class="item-body">
          <div class="item-label">${esc(item.label || 'Unknown')}</div>
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
// ── Settings, Donation & Telemetry ─────────────────────────────────────────

async function initSettings() {
  const data = await chrome.storage.local.get(['telemetryOptIn','autoMode','donationDismissed','runCount']);

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
    });
  }

  // Donation bar — show after 3rd use, unless dismissed
  const runCount = (data.runCount || 0);
  const donationBar = document.getElementById('donationBar');
  if (donationBar && runCount >= 3 && !data.donationDismissed) {
    donationBar.style.display = 'flex';
  }

  const dismissBtn = document.getElementById('dismissDonation');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      if (donationBar) donationBar.style.display = 'none';
      chrome.storage.local.set({ donationDismissed: true });
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
