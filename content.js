// content.js — DenyStealthCookies v1.2
// Production-grade cookie consent denial with multi-tab navigation, iframe support,
// recursive section scanning, and comprehensive CMP coverage.
// Handles: TCF/IAB, OneTrust, Cookiebot, Didomi, Usercentrics, TrustArc, Quantcast,
// and generic CMPs with multi-level structures.

(function () {
  'use strict';

  // ── Environment Check ──────────────────────────────────────────────────────
  // Extension content scripts always run with JS enabled, but check for CSP issues
  if (typeof window === 'undefined' || !document) {
    console.error('[DenyStealthCookies] Cannot run: no DOM access');
    return;
  }

  const VERSION = '1.3.0';
  const MANDATORY_TCF_PURPOSES = new Set([10, 11]);
  const MAX_WAIT_PER_SECTION = 1000; // ms - wait for dynamic content after clicking tabs
  const MAX_TOTAL_RUNTIME = 30000; // ms - safety timeout for entire operation
  const MAX_RETRIES_PER_ACTION = 2;
  const TCF_PURPOSE_LABELS = {
    1:'Store and/or access information on a device',2:'Use limited data to select advertising',
    3:'Create profiles for personalised advertising',4:'Use profiles to select personalised advertising',
    5:'Create profiles to personalise content',6:'Use profiles to select personalised content',
    7:'Measure advertising performance',8:'Measure content performance',
    9:'Understand audiences through statistics or combinations of data',
    10:'Develop and improve services',11:'Use limited data to select content',
  };

  // Text patterns for buttons that mean "deny/reject all non-essential"
  const DENY_PATTERNS = [
    /^deny( all)?$/i,/^reject( all)?$/i,/^refuse( all)?$/i,/^decline( all)?$/i,
    /^object( all)?$/i,/^object to all$/i, // For legitimate interests
    /^no[,.]? thanks?$/i,/^skip$/i,/^disagree$/i,
    /^(only |just )?(necessary|essential|required|functional)( cookies?)?( only)?$/i,
    /^(allow|use|accept) (only )?(necessary|essential|required|functional)( cookies?)?( only)?$/i,
    /^continue without (accepting|agreeing|consenting|cookies?)$/i,
    /^proceed without (accepting|consenting)$/i,
    /^do not (accept|consent|agree)$/i,
    /^i (do not|don'?t) (accept|consent|agree)$/i,
    /^opt out( of all)?$/i,/^withdraw( all)?( consent)?$/i,
    /^tout refuser$/i,/^refuser( tout)?$/i,/^non merci$/i,/^continuer sans accepter$/i,  // French
    /^alle ablehnen$/i,/^ablehnen$/i,/^nein danke$/i,                                    // German
    /^rechazar( todo)?$/i,/^no gracias$/i,                                                // Spanish
    /^rifiuta( tutto)?$/i,/^no grazie$/i,                                                 // Italian
    /^rejeitar( tudo)?$/i,/^não obrigado$/i,                                             // Portuguese
    /^afwijzen$/i,/^weigeren$/i,                                                          // Dutch
  ];

  // Text patterns for "save/confirm choices" buttons (after unchecking toggles)
  const CONFIRM_PATTERNS = [
    /^save( my)? (preferences?|choices?|settings?|selection)$/i,
    /^confirm( my)? (choices?|selection|preferences?|settings?)$/i,
    /^(accept|allow)( my)? selection$/i,
    /^apply( settings?)?$/i,/^update( preferences?)?$/i,
    /^done$/i,/^got it$/i,/^close$/i,/^dismiss$/i,
    /^(ok|okay)$/i,/^continue$/i,
    /^enregistrer( mes (choix|pr[ée]f[ée]rences))?$/i, // French
    /^speichern$/i,/^weiter$/i,                          // German
  ];

  // Keywords: do NOT uncheck these (mandatory/essential)
  const MANDATORY_KW = [
    'strictly necessary','strictly-necessary','essential','necessary cookies',
    'technically required','technically necessary','basic functionality',
    'security','fraud prevention','detect fraud','ensure security',
    'fix errors','deliver content','technically deliver','functional',
    'prevent fraud','system security','required','mandatory',
    'performance of contract','legal obligation','vital interests',
    'deliver and present','technical compatibility','transmission of content',
  ];

  // ── State ──────────────────────────────────────────────────────────────────
  function freshResults() {
    return {
      unchecked:[],mandatory:[],errors:[],
      cmpDetected:null,cmpMethod:null,
      bannerFound:false,bannerClosed:false,
      totalTogglesFound:0,
      sectionsProcessed:[],  // Track which sections/tabs were clicked
      iframesScanned:0,
      startTime:Date.now(),
      timestamp:Date.now(),
      processedLabels:new Set(),  // Dedupe during processing
      actionLog:[],  // Detailed action log for debugging and history
      consentOrPay:false  // Flag for "consent or pay/subscribe" scenarios
    };
  }
  let R = freshResults();
  let operationStartTime = 0;
  const MAX_ACTION_LOG_ENTRIES = 100;  // Prevent unbounded growth

  // ── Utilities ──────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r,ms));

  // Log action with timestamp (capped at MAX_ACTION_LOG_ENTRIES)
  function logAction(action) {
    if (R.actionLog.length >= MAX_ACTION_LOG_ENTRIES) return;
    R.actionLog.push({
      time: Date.now() - R.startTime,  // Relative time in ms
      action: String(action).substring(0, 200)  // Sanitize and limit length
    });
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect(), s = window.getComputedStyle(el);
      return r.width>0 && r.height>0 && s.display!=='none' &&
             s.visibility!=='hidden' && parseFloat(s.opacity)>0 && el.offsetParent!==null;
    } catch(_){ return false; }
  }

  function textOf(el) {
    return ((el?.textContent||el?.innerText||el?.value||'').trim().replace(/\s+/g,' '));
  }

  function matchesPats(text, pats) { return pats.some(p => p.test(text.trim())); }

  function hasKeyword(text, kws) {
    const lo = (text||'').toLowerCase();
    return kws.some(k => lo.includes(k));
  }

  // Detect "consent or pay/subscribe" scenarios
  function detectConsentOrPay() {
    const payKeywords = ['subscribe to continue', 'subscribe to read', 'sign up to continue',
                         'register to continue', 'premium members only', 'paid subscription',
                         'consent or pay', 'accept or subscribe', 'accept or register'];
    const bodyText = document.body?.innerText?.toLowerCase() || '';
    
    // Look for payment/subscription walls
    for (const kw of payKeywords) {
      if (bodyText.includes(kw)) {
        logAction(`⚠️ Consent-or-pay detected: "${kw}"`);
        R.consentOrPay = true;
        return true;
      }
    }
    
    // Check for registration/login requirements near banners
    const bannerSelectors = ['.onetrust-banner-sdk', '#didomi-host', '.qc-cmp2-container', 
                            '[role="dialog"]', '[aria-modal="true"]'];
    for (const sel of bannerSelectors) {
      const banner = document.querySelector(sel);
      if (banner) {
        const bannerText = banner.innerText?.toLowerCase() || '';
        if ((bannerText.includes('subscribe') || bannerText.includes('register') || 
             bannerText.includes('premium')) && bannerText.includes('continue')) {
          logAction(`⚠️ Consent-or-pay wall detected in banner: ${sel}`);
          R.consentOrPay = true;
          return true;
        }
      }
    }
    return false;
  }

  function getLabel(el) {
    const tries = [
      ()=>el.getAttribute('aria-label'),
      ()=>el.getAttribute('title'),
      ()=>{ const id=el.id; return id?document.querySelector(`label[for="${id}"]`)?.textContent?.trim():null; },
      ()=>el.closest('label')?.textContent?.trim(),
      ()=>el.closest('[class*="vendor"],[class*="purpose"],[class*="category"]')
             ?.querySelector('[class*="name"],[class*="title"],h3,h4,strong,span')?.textContent?.trim(),
      ()=>{ const row=el.closest('tr,li,[role="row"],[class*="item"],[class*="row"]');
            return row?.querySelector('span,p,h3,h4,strong')?.textContent?.trim(); },
      ()=>el.parentElement?.textContent?.trim()?.substring(0,120),
    ];
    for (const fn of tries) {
      try { const l=fn(); if(l&&l.length>1&&l.length<200) return l.replace(/\s+/g,' ').trim(); } catch(_){}
    }
    return 'Unknown item';
  }

  function safeUncheck(toggle, label, category, type='consent', section='') {
    try {
      // Dedupe check
      const dedupeKey = `${label}|${category}|${type}`;
      if (R.processedLabels.has(dedupeKey)) return false;
      
      const isCb = toggle.type==='checkbox';
      const checked = isCb ? toggle.checked : toggle.getAttribute('aria-checked')==='true';
      if (!checked) return false;
      
      // Try click first
      toggle.click();
      let nowChecked = isCb ? toggle.checked : toggle.getAttribute('aria-checked')==='true';
      
      // Force uncheck if click didn't work
      if (nowChecked) {
        if (isCb) { 
          toggle.checked=false; 
          toggle.dispatchEvent(new Event('change',{bubbles:true})); 
          toggle.dispatchEvent(new Event('input',{bubbles:true}));
        } else { 
          toggle.setAttribute('aria-checked','false'); 
          toggle.dispatchEvent(new Event('change',{bubbles:true})); 
        }
      }
      
      R.processedLabels.add(dedupeKey);
      R.unchecked.push({
        label:label.substring(0,150),
        category,
        type,
        section: section.substring(0,50) || 'Main'
      });
      return true;
    } catch(err){ 
      R.errors.push({label:label.substring(0,100),error:err.message}); 
      return false; 
    }
  }

  function dedupe(arr) {
    const seen=new Set();
    return arr.filter(i=>{ const k=(i.label||'')+(i.category||''); return seen.has(k)?false:(seen.add(k),true); });
  }

  // ── CMP Detection ──────────────────────────────────────────────────────────
  function detectCMPs() {
    const checks = [
      ['OneTrust',      ()=>!!(window.OneTrust||document.getElementById('onetrust-banner-sdk')||document.querySelector('.onetrust-banner-sdk'))],
      ['Cookiebot',     ()=>!!(window.Cookiebot||window.CookieConsent||document.getElementById('CybotCookiebotDialog'))],
      ['Didomi',        ()=>!!(window.Didomi||document.getElementById('didomi-host'))],
      ['Usercentrics',  ()=>!!(window.UC_UI||document.querySelector('[data-testid="uc-center-container"]'))],
      ['TrustArc',      ()=>!!(window.truste||document.getElementById('truste-consent-track'))],
      ['Quantcast',     ()=>!!(window.__qcCmpApi||document.getElementById('qc-cmp2-ui'))],
      ['Sourcepoint',   ()=>!!(window._sp_||document.getElementById('sp_message_container')||document.querySelector('[id^="sp_message"]'))],
      ['Axeptio',       ()=>!!(window.axeptio||document.getElementById('axeptio_overlay'))],
      ['CookieYes',     ()=>!!document.querySelector('.cky-consent-container,[class*="cookieyes"]')],
      ['Osano',         ()=>!!(window.Osano||document.querySelector('.osano-cm-window'))],
      ['Termly',        ()=>!!document.querySelector('#termly-code-snippet-support')],
      ['TCF/IAB',       ()=>!!(window.__tcfapi||window.__cmp||document.cookie.includes('FCCDCF'))],
      ['Iubenda',       ()=>!!(window._iub||document.querySelector('.iubenda-cs-banner'))],
      ['Complianz',     ()=>!!document.querySelector('.cmplz-cookiebanner')],
      ['CookieLaw',     ()=>!!document.querySelector('.cc-window,.cc-banner')],
      ['WP Cookie',     ()=>!!document.querySelector('#cookie-notice,.cookie-notice-container')],
    ];
    const detected = checks.filter(([,fn])=>{ try{return fn();}catch(_){return false;} }).map(([n])=>n);

    // Generic: any visible element with cookie/consent text
    if (detected.length===0) {
      const sels = ['[id*="cookie"],[class*="cookie-banner"]','[id*="consent"],[class*="gdpr"]',
                    'dialog,[role="dialog"],[role="alertdialog"]'];
      for (const sel of sels) {
        try {
          const el = document.querySelector(sel);
          if (el && isVisible(el)) {
            const txt = textOf(el).toLowerCase();
            if (txt.includes('cookie')||txt.includes('consent')||txt.includes('gdpr')) {
              detected.push('Generic'); break;
            }
          }
        } catch(_){}
      }
    }
    return detected;
  }

  // ── Strategy 1: Find & click deny/reject button directly ──────────────────
  async function tryDenyButton() {
    const BANNER_SEL = [
      '[id*="cookie"],[id*="consent"],[id*="gdpr"],[id*="privacy"],[id*="banner"]',
      '[class*="cookie"],[class*="consent"],[class*="gdpr"],[class*="cmp"],[class*="banner"]',
      '.onetrust-banner-sdk','#didomi-host','#CybotCookiebotDialog',
      '.qc-cmp2-container','dialog','[role="dialog"]','[aria-modal="true"]',
    ].join(',');

    // All visible buttons/links on page
    const clickables = Array.from(document.querySelectorAll(
      'button,[role="button"],a[class*="btn"],a[class*="button"],input[type="button"],input[type="submit"]'
    )).filter(isVisible);

    // First pass: buttons inside known banner containers
    for (const el of clickables) {
      const text = textOf(el);
      const attrs = [el.getAttribute('aria-label'),el.getAttribute('title'),el.id,el.className].filter(Boolean).join(' ');
      if (matchesPats(text,DENY_PATTERNS) || matchesPats(attrs,DENY_PATTERNS)) {
        try {
          if (el.closest(BANNER_SEL)) {
            el.click();
            R.bannerFound=true; R.bannerClosed=true; R.cmpMethod='button-click';
            R.unchecked.push({label:`Clicked "${text||attrs}" button`,category:'Banner Action',type:'deny-all'});
            return true;
          }
        } catch(_){}
      }
    }

    // Second pass: deny buttons by text anywhere on page (catches floating bars)
    for (const el of clickables) {
      const text = textOf(el);
      if (matchesPats(text,DENY_PATTERNS)) {
        // Guard: not inside nav/header content, and text is short (button-like)
        const inNav = el.closest('nav,header') && !el.closest('[class*="banner"],[class*="consent"],[class*="cookie"]');
        if (!inNav && text.length < 60) {
          el.click();
          R.bannerFound=true; R.bannerClosed=true; R.cmpMethod='button-click';
          R.unchecked.push({label:`Clicked "${text}" button`,category:'Banner Action',type:'deny-all'});
          return true;
        }
      }
    }

    // Third pass: known CMP deny selectors
    const knownDenySelectors = [
      // OneTrust
      '#onetrust-reject-all-handler','#onetrust-pc-btn-handler','.onetrust-close-btn-handler',
      // Cookiebot
      '#CybotCookiebotDialogBodyButtonDecline','a[id*="CookiebotDialogBodyButtonDecline"]',
      // Didomi
      '.didomi-continue-without-agreeing','#didomi-notice-disagree-button','button[id*="didomi-notice-disagree"]',
      // Quantcast
      'button[mode="secondary"][class*="qc-cmp"]','button[aria-label*="Reject"]',
      // Usercentrics
      '[data-testid="uc-deny-all-button"]','button[data-testid="uc-deny-all-button"]',
      // Sourcepoint
      'button[title*="Reject"]','button[title*="reject"]','button[title*="Decline"]',
      '#sp_message_container button','button[class*="sp_choice_type_11"]',
      'button.sp-button','button[aria-label*="Reject"]','button[aria-label*="Decline"]',
      '[class*="message-component"] button[class*="secondary"]','
      // OneTrust additional
      'button[aria-label*="Reject"]','button[title*="Reject"]',
      // Generic reject/deny
      '[class*="reject-all"],[id*="reject-all"]',
      '[class*="deny-all"],[id*="deny-all"]',
      '[class*="decline-all"],[id*="decline-all"]',
      '[class*="refuse-all"],[id*="refuse-all"]',
      // TrustArc
      '.js-reject-button','.truste_button2','#truste-buttons button',
      // Generic
      'button[class*="reject"]','button[class*="decline"]',
    ];
    for (const sel of knownDenySelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) {
          const text = textOf(btn)||sel;
          logAction(`Clicking deny button: ${text} (selector: ${sel})`);
          btn.click();
          await sleep(200); // Let click process
          R.bannerFound=true; R.bannerClosed=true; R.cmpMethod='button-click';
          R.unchecked.push({label:`Clicked deny button: ${text}`,category:'Banner Action',type:'deny-all'});
          return true;
        }
      } catch(_){}
    }

    return false;
  }

  // ── Strategy 2: CMP API calls ──────────────────────────────────────────────
  async function tryCMPApis() {
    let hit = false;

    // OneTrust - Try multiple approaches
    try {
      logAction('Checking OneTrust CMP...');
      // First, try to find and click reject button directly (most reliable)
      const oneTrustRejectBtn = document.querySelector(
        '#onetrust-reject-all-handler,.onetrust-close-btn-handler,.save-preference-btn-handler,button[id*="onetrust"][id*="reject"]'
      );
      if (oneTrustRejectBtn && isVisible(oneTrustRejectBtn)) {
        logAction('OneTrust: Clicking reject button directly');
        oneTrustRejectBtn.click();
        await sleep(500);
        hit = true;
        R.cmpMethod=R.cmpMethod||'button-click'; R.bannerFound=true; R.bannerClosed=true;
        R.unchecked.push({label:'OneTrust: Reject button clicked',category:'CMP API',type:'deny-all'});
        
        // Try to close the banner
        try {
          window.OneTrust?.Close?.();
          const banner = document.getElementById('onetrust-banner-sdk');
          if (banner) banner.style.display = 'none';
        } catch(_){}
      } else if (window.OneTrust?.RejectAll) {
        // Fallback to API
        logAction('OneTrust: Calling RejectAll() API');
        window.OneTrust.RejectAll(); 
        await sleep(500);
        hit=true;
        R.cmpMethod=R.cmpMethod||'api'; R.bannerFound=true; R.bannerClosed=true;
        R.unchecked.push({label:'OneTrust: RejectAll()',category:'CMP API',type:'deny-all'});
        
        try {
          window.OneTrust?.Close?.();
          const banner = document.getElementById('onetrust-banner-sdk');
          if (banner) banner.style.display = 'none';
        } catch(_){}
      } else if (window.OneTrust && document.getElementById('onetrust-banner-sdk')) {
        // OneTrust exists but no API - try button click
        logAction('OneTrust: Opening preference center for manual rejection');
        const btn = document.querySelector('#onetrust-pc-btn-handler');
        if (btn && isVisible(btn)) {
          btn.click();
          await sleep(800); // Wait for preference center
          const rejectAll = document.querySelector('.ot-pc-refuse-all-handler,button[class*="rejectAll"]');
          if (rejectAll && isVisible(rejectAll)) {
            logAction('OneTrust: Clicking reject all in preference center');
            rejectAll.click();
            await sleep(300);
            hit = true;
          }
        }
      }
    } catch(_){}

    // Cookiebot
    try {
      if (window.Cookiebot?.deny||window.CookieConsent?.deny) {
        logAction('Cookiebot: Calling deny() API');
        (window.Cookiebot?.deny||window.CookieConsent?.deny).call(window.Cookiebot||window.CookieConsent);
        hit=true; R.cmpMethod=R.cmpMethod||'api';
        R.unchecked.push({label:'Cookiebot: deny()',category:'CMP API',type:'deny-all'});
      }
    } catch(_){}

    // Didomi
    try {
      if (window.Didomi?.setUserDisagreeToAll) {
        logAction('Didomi: Calling setUserDisagreeToAll()');
        window.Didomi.setUserDisagreeToAll(); hit=true; R.cmpMethod=R.cmpMethod||'api';
        R.unchecked.push({label:'Didomi: setUserDisagreeToAll()',category:'CMP API',type:'deny-all'});
      }
    } catch(_){}

    // Usercentrics
    try {
      if (window.UC_UI?.denyAllConsents) {
        logAction('Usercentrics: Calling denyAllConsents()');
        window.UC_UI.denyAllConsents(); hit=true; R.cmpMethod=R.cmpMethod||'api';
        R.unchecked.push({label:'Usercentrics: denyAllConsents()',category:'CMP API',type:'deny-all'});
      }
    } catch(_){}

    // Osano
    try { if(window.Osano?.cm?.deny){window.Osano.cm.deny();hit=true;} } catch(_){}

    // Iubenda
    try { if(window._iub?.cs?.api?.rejectAll){window._iub.cs.api.rejectAll();hit=true;} } catch(_){}

    // Sourcepoint
    try {
      if (window._sp_?.pushData) {
        logAction('Sourcepoint: Calling pushData(\'reject_all\')');
        window._sp_.pushData('reject_all');
        hit = true;
        R.unchecked.push({label:'Sourcepoint: reject_all',category:'CMP API',type:'deny-all'});
      }
    } catch(_){}

    // Quantcast - Enhanced handling
    try { 
      if(window.__qcCmpApi){
        logAction('Quantcast: Calling setConsentedToAll(false)');
        window.__qcCmpApi('setConsentedToAll',false,null);
        await sleep(300);
        // Also try to close the UI
        const qcUI = document.getElementById('qc-cmp2-ui');
        if (qcUI) qcUI.style.display = 'none';
        hit=true;
        R.cmpMethod=R.cmpMethod||'api';
        R.unchecked.push({label:'Quantcast: setConsentedToAll(false)',category:'CMP API',type:'deny-all'});
      } 
    } catch(_){}

    // IAB TCF v2 — read and report purposes, then try to reject
    try {
      if (window.__tcfapi) {
        logAction('TCF/IAB: Attempting rejectAll()');
        // First try to reject all via TCF API
        let tcfSuccess = false;
        await new Promise(resolve=>{
          window.__tcfapi('rejectAll', 2, (success) => {
            if (success) {
              logAction('TCF/IAB: rejectAll() succeeded');
              tcfSuccess = true;
              hit = true;
              R.unchecked.push({label:'TCF: rejectAll()',category:'CMP API',type:'deny-all'});
            }
            resolve();
          });
          setTimeout(resolve, 1000); // Timeout fallback
        });
        
        // Read TCF data for reporting
        await new Promise(resolve=>{
          window.__tcfapi('getTCData',2,(tcData,success)=>{
            if(!success||!tcData){resolve();return;}
            R.cmpMethod=R.cmpMethod||'api';
            Object.entries(tcData?.purpose?.consents||{}).forEach(([id,consented])=>{
              const n=parseInt(id);
              if(MANDATORY_TCF_PURPOSES.has(n)){if(consented)R.mandatory.push({label:TCF_PURPOSE_LABELS[n]||`Purpose ${id}`,category:'TCF (mandatory)',type:'consent'});}
              else if(consented && !tcfSuccess){R.unchecked.push({label:TCF_PURPOSE_LABELS[n]||`Purpose ${id}`,category:'TCF Purpose',type:'consent'});}
            });
            Object.entries(tcData?.purpose?.legitimateInterests||{}).forEach(([id,hasLI])=>{
              if(!MANDATORY_TCF_PURPOSES.has(parseInt(id))&&hasLI && !tcfSuccess)
                R.unchecked.push({label:TCF_PURPOSE_LABELS[parseInt(id)]||`Purpose ${id}`,category:'TCF Purpose',type:'legitimate interest'});
            });
            resolve();
          });
        });
        hit=true;
      }
    } catch(_){}

    return hit;
  }

  // ── Strategy 3: Toggle scraping ────────────────────────────────────────────
  function scrapeToggles(section='Main', contextEl=document) {
    const toggles = Array.from(contextEl.querySelectorAll(
      'input[type="checkbox"],[role="switch"],[role="checkbox"],[class*="toggle"] input,[class*="switch"] input'
    ));
    R.totalTogglesFound += toggles.length;
    let count=0;

    toggles.forEach(toggle=>{
      if(!isVisible(toggle.closest('label,div,li,tr')||toggle)) return; // Skip hidden
      
      if(toggle.disabled||toggle.getAttribute('aria-disabled')==='true'||toggle.readOnly){
        const label = getLabel(toggle);
        const dedupeKey = `${label}|Locked by CMP|system`;
        if(!R.processedLabels.has(dedupeKey)){
          R.processedLabels.add(dedupeKey);
          R.mandatory.push({label,category:'Locked by CMP',type:'system',section});
        }
        return;
      }
      const label = getLabel(toggle);
      const ctx = (toggle.closest('[class],[id]')?.textContent||'').substring(0,400);
      const all = label+' '+ctx;

      if(hasKeyword(all,MANDATORY_KW)){
        const checked=toggle.type==='checkbox'?toggle.checked:toggle.getAttribute('aria-checked')==='true';
        if(checked) {
          const dedupeKey = `${label}|Strictly Necessary|consent`;
          if(!R.processedLabels.has(dedupeKey)){
            R.processedLabels.add(dedupeKey);
            R.mandatory.push({label,category:'Strictly Necessary',type:'consent',section});
          }
        }
        return;
      }

      const checked=toggle.type==='checkbox'?toggle.checked:toggle.getAttribute('aria-checked')==='true';
      if(checked){
        const lo=all.toLowerCase();
        const cat=lo.includes('legitimate interest')?'Legitimate Interest'
                 :lo.includes('special feature')?'Special Feature'
                 :lo.includes('vendor')?'Vendor Consent':'Consent';
        if(safeUncheck(toggle,label,cat,'consent',section)) count++;
      }
    });
    return count;
  }

  // ── Strategy 3b: Multi-tab/section navigation ──────────────────────────────
  async function navigateAndScrapeAllSections() {
    if(Date.now() - operationStartTime > MAX_TOTAL_RUNTIME) return 0;
    
    let totalUnchecked = 0;
    
    // Tab patterns to click through
    const TAB_PATTERNS = [
      /^partners?$/i, /^vendors?$/i, /^legitimate interests?$/i,
      /^special (purposes?|features?)$/i, /^purposes?$/i, /^features?$/i,
      /^(third[- ]?party|third parties)$/i, /^custom vendors?$/i,
      /^stacks?$/i, /^personali[sz]ation$/i, /^advertising$/i,
      /^analytics?$/i, /^measurement$/i, /^content selection$/i,
    ];
    
    // Section/accordion patterns
    const SECTION_PATTERNS = [
      /show (all |more )?vendors?/i, /view (all )?vendors?/i,
      /see (all )?(partners?|purposes?|vendors?)/i,
      /expand (all|vendors?|partners?)/i,
      /\d+ vendors?/i, // "123 vendors"
    ];

    // Find tabs/sections to click
    const clickableSelectors = [
      'button,[role="button"],[role="tab"],a[class*="tab"]',
      '[class*="accordion"] button,[class*="expand"] button',
      '[class*="vendor"] button,[class*="partner"] button',
    ].join(',');
    
    const clickables = Array.from(document.querySelectorAll(clickableSelectors))
      .filter(el => isVisible(el) && !el.disabled);

    const tabsToClick = [];
    const sectionsToClick = [];

    for(const el of clickables) {
      const text = textOf(el);
      const ariaLabel = el.getAttribute('aria-label')||'';
      const combined = `${text} ${ariaLabel}`;
      
      if(TAB_PATTERNS.some(p => p.test(combined))) {
        tabsToClick.push({el, text: text||ariaLabel, type: 'tab'});
      } else if(SECTION_PATTERNS.some(p => p.test(combined))) {
        sectionsToClick.push({el, text: text||ariaLabel, type: 'section'});
      }
    }

    // Click tabs and scrape each
    for(const {el, text, type} of tabsToClick) {
      if(Date.now() - operationStartTime > MAX_TOTAL_RUNTIME) break;
      
      try {
        const alreadyActive = el.getAttribute('aria-selected')==='true' || 
                             el.classList.contains('active') ||
                             el.classList.contains('selected');
        
        if(!alreadyActive) {
          el.click();
          await sleep(MAX_WAIT_PER_SECTION);
          R.sectionsProcessed.push(`${type}: ${text}`.substring(0,60));
        }
        
        // Scrape this tab's content
        const parent = el.closest('[role="tabpanel"],[class*="panel"],[class*="content"]')?.parentElement || document;
        const count = scrapeToggles(text, parent);
        totalUnchecked += count;
        
        // Look for deny/object buttons within this tab
        await tryDenyButtonInContext(parent, text);
        
      } catch(err) {
        R.errors.push({label: `Failed to process ${type}: ${text}`, error: err.message});
      }
    }

    // Expand accordion sections
    for(const {el, text} of sectionsToClick) {
      if(Date.now() - operationStartTime > MAX_TOTAL_RUNTIME) break;
      
      try {
        const isExpanded = el.getAttribute('aria-expanded')==='true' ||
                          el.classList.contains('expanded');
        
        if(!isExpanded) {
          el.click();
          await sleep(300);
          R.sectionsProcessed.push(`section: ${text}`.substring(0,60));
          
          const parent = el.closest('[class*="accordion"],[class*="section"]') || el.parentElement;
          const count = scrapeToggles(text, parent);
          totalUnchecked += count;
        }
      } catch(err) {
        R.errors.push({label: `Failed to expand ${text}`, error: err.message});
      }
    }

    return totalUnchecked;
  }

  // Helper: Look for deny/reject/object buttons within a specific context
  async function tryDenyButtonInContext(contextEl, sectionName) {
    const buttons = Array.from(contextEl.querySelectorAll('button,[role="button"]'))
      .filter(isVisible);
    
    for(const btn of buttons) {
      const text = textOf(btn);
      const ariaLabel = btn.getAttribute('aria-label')||'';
      const combined = `${text} ${ariaLabel}`;
      
      if(matchesPats(combined, DENY_PATTERNS)) {
        try {
          btn.click();
          await sleep(200);
          R.unchecked.push({
            label: `Clicked "${text}" in ${sectionName}`,
            category: 'Banner Action',
            type: 'deny-all',
            section: sectionName
          });
          return true;
        } catch(_) {}
      }
    }
    return false;
  }

  // ── Strategy 3c: Iframe scanning ───────────────────────────────────────────
  async function scanIframes() {
    if(Date.now() - operationStartTime > MAX_TOTAL_RUNTIME) return 0;
    
    let count = 0;
    const iframes = document.querySelectorAll('iframe');
    
    for(const iframe of iframes) {
      if(!isVisible(iframe)) continue;
      
      try {
        // Try to access iframe content (same-origin only)
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if(!iframeDoc) continue;
        
        R.iframesScanned++;
        
        // Check if iframe contains CMP
        const hasCmpContent = Array.from(iframeDoc.querySelectorAll('[id],[class]'))
          .some(el => {
            const id = el.id?.toLowerCase() || '';
            const cls = el.className?.toLowerCase() || '';
            return id.includes('cookie') || id.includes('consent') || 
                   cls.includes('cookie') || cls.includes('consent') ||
                   id.includes('cmp') || cls.includes('cmp');
          });
        
        if(!hasCmpContent) continue;
        
        // Try deny button in iframe
        const iframeBtns = Array.from(iframeDoc.querySelectorAll('button,[role="button"]'));
        for(const btn of iframeBtns) {
          const text = textOf(btn);
          if(matchesPats(text, DENY_PATTERNS)) {
            btn.click();
            R.unchecked.push({
              label: `Clicked "${text}" in iframe`,
              category: 'Banner Action (iframe)',
              type: 'deny-all',
              section: 'iframe'
            });
            count++;
            break;
          }
        }
        
        // Scrape toggles in iframe
        const iframeCount = scrapeToggles('iframe', iframeDoc);
        count += iframeCount;
        
      } catch(err) {
        // Cross-origin iframe, skip silently
        continue;
      }
    }
    
    return count;
  }

  // ── Strategy 4: Confirm/save after toggling ────────────────────────────────
  function tryConfirm() {
    // Known selectors
    const sels=['.save-preference-btn-handler',
      '#CybotCookiebotDialogBodyLevelButtonAcceptSelected',
      '[data-testid="uc-save-button"]',
      '.qc-cmp2-summary-buttons button:last-child'];
    for(const sel of sels){
      try{const b=document.querySelector(sel);if(b&&isVisible(b)){b.click();return true;}}catch(_){}
    }
    // Text-based
    const btns=Array.from(document.querySelectorAll('button,[role="button"]')).filter(isVisible);
    for(const btn of btns){
      if(matchesPats(textOf(btn),CONFIRM_PATTERNS)){btn.click();return true;}
    }
    return false;
  }

  // ── Strategy 5: Open manage panel then scrape ──────────────────────────────
  async function tryManagePanel() {
    if(Date.now() - operationStartTime > MAX_TOTAL_RUNTIME) return 0;
    
    const managePatterns=[
      /manage( (preferences?|cookies?|settings?|consent))?$/i,
      /^(cookie )?settings?$/i,/^preferences?$/i,/^more options?$/i,
      /^customize$/i,/^customise$/i,/^gérer/i,/^einstellungen$/i,
      /^vendor preferences?$/i, /^privacy settings?$/i,
    ];
    const btns=Array.from(document.querySelectorAll('button,[role="button"],a')).filter(isVisible);
    
    let clicked = false;
    for(const btn of btns){
      if(Date.now() - operationStartTime > MAX_TOTAL_RUNTIME) break;
      
      const text=textOf(btn);
      if(matchesPats(text,managePatterns)){
        const inBanner=btn.closest('[id*="cookie"],[id*="consent"],[id*="gdpr"],[class*="cookie"],[class*="consent"],[class*="cmp"],[class*="banner"],dialog,[role="dialog"]');
        if(inBanner){
          btn.click();
          await sleep(MAX_WAIT_PER_SECTION);
          clicked = true;
          R.sectionsProcessed.push(`Opened: ${text}`.substring(0,60));
          break;
        }
      }
    }
    
    if(!clicked) return 0;
    
    // After opening panel, navigate through all tabs/sections
    const navCount = await navigateAndScrapeAllSections();
    
    // Also do a general scrape of any remaining visible toggles
    const generalCount = scrapeToggles('Main Panel');
    
    const totalCount = navCount + generalCount;
    
    if(totalCount>0){
      await sleep(300);
      const confirmed=tryConfirm();
      R.bannerFound=true;
      R.cmpMethod=R.cmpMethod||'multi-section-scrape';
      if(confirmed) R.bannerClosed=true;
    }
    return totalCount;
  }

  // ── Strategy 6: Hide banner element ───────────────────────────────────────
  function tryHideBanner() {
    const sels=[
      '#onetrust-banner-sdk','#onetrust-consent-sdk',
      '#CybotCookiebotDialog','#qc-cmp2-ui','#truste-consent-track','#truste-overlay',
      '#didomi-host','#didomi-popup',
      '[data-testid="uc-center-container"]',
      '.osano-cm-window','.iubenda-cs-banner','#cmpbox','#sp_message_container',
      '.cc-window','.cc-banner','.cookielawinfo-bar',
      '#cookie-notice','.cookie-notice-container','.cmplz-cookiebanner','.fc-consent-root',
      '[id*="cookie-banner"],[class*="cookie-banner"]',
      '[id*="consent-banner"],[class*="consent-banner"]',
      '[id*="gdpr-banner"],[class*="gdpr-banner"]',
      '[id*="cookie-popup"],[class*="cookie-popup"]',
      '[id*="privacy-banner"],[class*="privacy-banner"]',
    ];
    for(const sel of sels){
      try{
        const el=document.querySelector(sel);
        if(el&&isVisible(el)){
          el.style.setProperty('display','none','important');
          el.setAttribute('aria-hidden','true');
          document.body.style.overflow='';
          document.documentElement.style.overflow='';
          ['modal-open','no-scroll','overflow-hidden','noscroll','body-lock']
            .forEach(c=>document.body.classList.remove(c));
          R.bannerFound=true; R.bannerClosed=true;
          return true;
        }
      }catch(_){}
    }
    // Generic dialogs with cookie text
    const dialogs=document.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"]');
    for(const el of dialogs){
      if(!isVisible(el)) continue;
      const txt=textOf(el).toLowerCase();
      if(txt.includes('cookie')||txt.includes('consent')||txt.includes('gdpr')){
        el.style.setProperty('display','none','important');
        document.body.style.overflow='';
        R.bannerFound=true; R.bannerClosed=true;
        return true;
      }
    }
    return false;
  }

  // ── Main ───────────────────────────────────────────────────────────────────
  async function runDeny() {
    R = freshResults();
    operationStartTime = Date.now();
    logAction('Starting consent denial operation');
    
    const cmps = detectCMPs();
    R.cmpDetected = cmps.length>0 ? cmps.join(', ') : null;
    logAction(`CMP detection: ${R.cmpDetected || 'No standard CMP detected'}`);
    
    // Early consent-or-pay detection
    detectConsentOrPay();
    if (R.consentOrPay) {
      logAction('⚠️ Aborting: Consent-or-pay scenario detected. User action required.');
      R.errors.push({label: 'Consent or Pay Wall', error: 'Site requires acceptance or paid subscription. Extension avoided auto-denying to prevent access issues.'});
      return R;  // Exit early to avoid locking user out
    }

    try {
      // Phase 1: Try clicking a Deny/Reject All button (catches simple banners)
      logAction('Phase 1: Attempting direct deny button click');
      const denied = await tryDenyButton();
      if (denied) logAction('✓ Phase 1 successful: Deny button clicked');

      if (!denied && Date.now() - operationStartTime < MAX_TOTAL_RUNTIME) {
        // Phase 2: CMP-specific API calls
        logAction('Phase 2: Attempting CMP-specific API calls');
        await tryCMPApis();

        // Phase 3: Open manage panel + multi-section scrape
        logAction('Phase 3: Attempting manage panel navigation');
        const panelCount = await tryManagePanel();

        // Phase 4: Raw toggle scrape if nothing found yet
        if (R.unchecked.length === 0 && Date.now() - operationStartTime < MAX_TOTAL_RUNTIME) {
          logAction('Phase 4: Scraping toggles from page');
          const mainCount = scrapeToggles('Main');
          logAction(`Found ${mainCount} toggles in main section`);
          
          // Navigate through tabs/sections if toggles found
          if (mainCount > 0) {
            await navigateAndScrapeAllSections();
          }
          
          if (R.unchecked.length > 0) {
            await sleep(300);
            logAction('Attempting to confirm changes with Save/Accept button');
            const confirmed = tryConfirm();
            R.bannerFound = true;
            R.cmpMethod = R.cmpMethod || 'toggle-scrape';
            if (confirmed) {
              R.bannerClosed = true;
              logAction('✓ Changes confirmed and banner closed');
            }
          }
        }
        
        // Phase 5: Scan iframes for CMPs
        if (Date.now() - operationStartTime < MAX_TOTAL_RUNTIME) {
          logAction('Phase 5: Scanning iframes for embedded CMPs');
          await scanIframes();
        }
      }

      // Phase 6: Close banner if still open
      await sleep(500);
      if (!R.bannerClosed && Date.now() - operationStartTime < MAX_TOTAL_RUNTIME) {
        logAction('Phase 6: Attempting to hide banner if still visible');
        tryHideBanner();
        if (R.bannerClosed) logAction('✓ Banner hidden successfully');
      }

    } catch(err) {
      logAction(`❌ Error: ${err.message}`);
      R.errors.push({label: 'Operation error', error: err.message});
    }

    // Summary
    const runtime = Date.now() - operationStartTime;
    logAction(`Operation complete: ${R.unchecked.length} denied, ${R.mandatory.length} kept, ${R.errors.length} errors, runtime ${runtime}ms`);

    // Cleanup results
    R.unchecked = dedupe(R.unchecked);
    R.mandatory = dedupe(R.mandatory);
    R.errors = dedupe(R.errors);
    delete R.processedLabels; // Don't send Set to popup

    try {
      chrome.runtime.sendMessage({
        type:'DSC_SCAN_COMPLETE',
        data:{
          ...R, 
          url:window.location.href, 
          title:document.title,
          runtime: Date.now() - operationStartTime
        }
      });
    } catch(_){}
    
    // Expose result for test automation (inject into page's main world via DOM)
    try {
      let resultEl = document.getElementById('__denystealth_result__');
      if (!resultEl) {
        resultEl = document.createElement('div');
        resultEl.id = '__denystealth_result__';
        resultEl.style.display = 'none';
        document.body.appendChild(resultEl);
      }
      resultEl.setAttribute('data-result', JSON.stringify({
        ...R,
        url: window.location.href,
        runtime: Date.now() - operationStartTime
      }));
    } catch(_){}

    return R;
  }

  // ── Auto-mode ──────────────────────────────────────────────────────────────
  let autoModeObserver = null; // Module-level to allow cleanup
  
  async function checkAutoMode() {
    try {
      // Cleanup any existing observer first
      if (autoModeObserver) {
        autoModeObserver.disconnect();
        autoModeObserver = null;
      }
      
      // Check for test mode flag (set by automation)
      const testMode = sessionStorage.getItem('denystealth_test_mode') === 'true';
      
      const data = await new Promise(r=>chrome.storage.local.get('autoMode',r));
      if (!data.autoMode && !testMode) return;

      // Strategy 1: Check if CMP is already visible (with retries for slow-loading CMPs)
      let cmpDetected = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const cmps = detectCMPs();
        if (cmps.length > 0) {
          cmpDetected = true;
          await sleep(1500); // Increased delay for CMP to fully render
          await runDeny();
          return;
        }
        // Wait before retry
        if (attempt < 2) await sleep(1000);
      }
      
      if (!cmpDetected) {
        // Also check for banners without specific CMP detection
        const genericBanner = document.querySelector(
          '[id*="cookie"],[class*="cookie-banner"],[id*="consent"],[class*="consent-banner"]'
        );
        if (genericBanner && isVisible(genericBanner)) {
          await sleep(1200);
          await runDeny();
          return;
        }
      }

      // Strategy 2: Watch for CMP elements to appear (smart detection)
      let hasRun = false;
      let detectionAttempts = 0;
      const maxAttempts = 3;
      const observerStartTime = Date.now();
      
      autoModeObserver = new MutationObserver(async (mutations) => {
        if (hasRun) return;
        
        // Throttle detection to avoid excessive processing
        detectionAttempts++;
        if (detectionAttempts > maxAttempts && Date.now() - observerStartTime < 2000) {
          // Too many mutations too quickly, wait a bit
          return;
        }
        detectionAttempts = 0;
        
        // Check if any mutation added CMP-related elements
        for (const mutation of mutations) {
          if (mutation.addedNodes.length === 0) continue;
          
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            
            // Check if added node or its children match CMP patterns
            const el = node;
            const id = el.id?.toLowerCase() || '';
            const cls = el.className?.toLowerCase() || '';
            
            // Enhanced CMP pattern detection
            const hasCmpPattern = 
              // ID patterns
              id.includes('cookie') || id.includes('consent') || id.includes('cmp') || id.includes('gdpr') ||
              id.includes('onetrust') || id.includes('cookiebot') || id.includes('quantcast') || 
              id.includes('didomi') || id.includes('usercentrics') || id.includes('truste') ||
              // Class patterns
              cls.includes('cookie') || cls.includes('consent') || cls.includes('cmp') || cls.includes('gdpr') ||
              cls.includes('onetrust') || cls.includes('cookiebot') || cls.includes('quantcast') ||
              cls.includes('didomi') || cls.includes('usercentrics') || cls.includes('banner') ||
              // Dialog/modal patterns
              el.getAttribute('role') === 'dialog' || el.getAttribute('role') === 'alertdialog' ||
              el.tagName === 'DIALOG' ||
              // Deep search for CMP elements
              el.querySelector('[id*="cookie"],[id*="consent"],[class*="cookie"],[class*="consent"],[id*="cmp"],[class*="cmp"]');
            
            if (hasCmpPattern) {
              hasRun = true;
              autoModeObserver.disconnect();
              autoModeObserver = null;
              await sleep(800); // Let CMP finish rendering and binding events
              await runDeny();
              
              // Notify background to update badge
              try {
                chrome.runtime.sendMessage({ type: 'AUTO_DENY_SUCCESS' });
              } catch(_){}
              return;
            }
          }
        }
      });

      // Start observing DOM changes
      autoModeObserver.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Fallback: Stop observing after 15 seconds if nothing found
      setTimeout(() => {
        if (!hasRun && autoModeObserver) {
          autoModeObserver.disconnect();
          autoModeObserver = null;
        }
      }, 15000);

    } catch(_){}
  }
  checkAutoMode();

  // Cleanup observer on page navigation/unload
  window.addEventListener('beforeunload', () => {
    if (autoModeObserver) {
      autoModeObserver.disconnect();
      autoModeObserver = null;
    }
  });

  // ── Message listener ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if (msg.type==='RUN_CLEAN') {
      runDeny().then(r=>sendResponse({
        success:true,unchecked:r.unchecked,mandatory:r.mandatory,errors:r.errors,
        cmpDetected:r.cmpDetected,cmpMethod:r.cmpMethod,
        bannerFound:r.bannerFound,bannerClosed:r.bannerClosed,
        totalTogglesFound:r.totalTogglesFound,
        url:window.location.href,title:document.title
      })).catch(err=>sendResponse({success:false,error:err.message}));
      return true;
    }
    if (msg.type==='SCAN_ONLY') {
      const cmps=detectCMPs();
      const cmpString = cmps.length>0 ? cmps.join(', ') : 'Generic/Unknown';
      const bannerVisible=[
        '[id*="cookie"],[class*="cookie-banner"],[class*="consent"]',
        '#onetrust-banner-sdk','#CybotCookiebotDialog','#didomi-host',
        'dialog[open],[role="dialog"]',
      ].some(sel=>{try{const e=document.querySelector(sel);return e&&isVisible(e);}catch(_){return false;}});
      sendResponse({
        cmps,
        cmp: cmpString,
        bannerVisible,
        toggleCount:document.querySelectorAll('input[type="checkbox"],[role="switch"],[role="checkbox"]').length,
        url:window.location.href,
        title:document.title
      });
      return true;
    }
  });

  window.addEventListener('message',e=>{if(e.data?.type==='DSC_CLEAN') runDeny();});

})();
