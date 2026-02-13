// content.js — DenyStealthCookies v1.0
// Handles ALL cookie banner types: simple accept/deny, TCF CMPs, OneTrust,
// Cookiebot, Didomi, Usercentrics, TrustArc, Quantcast, and fully generic banners.
// Runs automatically if auto-mode is enabled, or on-demand from popup.

(function () {
  'use strict';

  const VERSION = '1.0.0';
  const MANDATORY_TCF_PURPOSES = new Set([10, 11]);
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
    /^no[,.]? thanks?$/i,/^skip$/i,
    /^(only |just )?(necessary|essential|required|functional)( cookies?)?( only)?$/i,
    /^(allow|use|accept) (only )?(necessary|essential|required|functional)( cookies?)?( only)?$/i,
    /^continue without (accepting|agreeing|consenting|cookies?)$/i,
    /^proceed without (accepting|consenting)$/i,
    /^do not (accept|consent|agree)$/i,
    /^i (do not|don'?t) (accept|consent|agree)$/i,
    /^opt out( of all)?$/i,
    /^tout refuser$/i,/^refuser$/i,/^non merci$/i,  // French
    /^alle ablehnen$/i,/^ablehnen$/i,               // German
    /^rechazar( todo)?$/i,                           // Spanish
    /^rifiuta( tutto)?$/i,                           // Italian
    /^rejeitar( tudo)?$/i,                           // Portuguese
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
      totalTogglesFound:0,timestamp:Date.now()
    };
  }
  let R = freshResults();

  // ── Utilities ──────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r,ms));

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

  function safeUncheck(toggle, label, category, type='consent') {
    try {
      const isCb = toggle.type==='checkbox';
      const checked = isCb ? toggle.checked : toggle.getAttribute('aria-checked')==='true';
      if (!checked) return false;
      toggle.click();
      const nowChecked = isCb ? toggle.checked : toggle.getAttribute('aria-checked')==='true';
      if (nowChecked) {
        if (isCb) { toggle.checked=false; toggle.dispatchEvent(new Event('change',{bubbles:true})); }
        else { toggle.setAttribute('aria-checked','false'); toggle.dispatchEvent(new Event('change',{bubbles:true})); }
      }
      R.unchecked.push({label:label.substring(0,150),category,type});
      return true;
    } catch(err){ R.errors.push({label,error:err.message}); return false; }
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
  function tryDenyButton() {
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
      '#CybotCookiebotDialogBodyButtonDecline',
      '.didomi-continue-without-agreeing','#didomi-notice-disagree-button',
      '[data-testid="uc-deny-all-button"]',
      '[class*="reject-all"],[id*="reject-all"]',
      '[class*="deny-all"],[id*="deny-all"]',
      '[class*="decline-all"],[id*="decline-all"]',
      '[class*="refuse-all"],[id*="refuse-all"]',
      '.js-reject-button','.truste_button2',
    ];
    for (const sel of knownDenySelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) {
          const text = textOf(btn)||sel;
          btn.click();
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

    // OneTrust
    try {
      if (window.OneTrust?.RejectAll) {
        window.OneTrust.RejectAll(); hit=true;
        R.cmpMethod=R.cmpMethod||'api'; R.bannerFound=true; R.bannerClosed=true;
        R.unchecked.push({label:'OneTrust: RejectAll()',category:'CMP API',type:'deny-all'});
      }
    } catch(_){}

    // Cookiebot
    try {
      if (window.Cookiebot?.deny||window.CookieConsent?.deny) {
        (window.Cookiebot?.deny||window.CookieConsent?.deny).call(window.Cookiebot||window.CookieConsent);
        hit=true; R.cmpMethod=R.cmpMethod||'api';
        R.unchecked.push({label:'Cookiebot: deny()',category:'CMP API',type:'deny-all'});
      }
    } catch(_){}

    // Didomi
    try {
      if (window.Didomi?.setUserDisagreeToAll) {
        window.Didomi.setUserDisagreeToAll(); hit=true; R.cmpMethod=R.cmpMethod||'api';
        R.unchecked.push({label:'Didomi: setUserDisagreeToAll()',category:'CMP API',type:'deny-all'});
      }
    } catch(_){}

    // Usercentrics
    try {
      if (window.UC_UI?.denyAllConsents) {
        window.UC_UI.denyAllConsents(); hit=true; R.cmpMethod=R.cmpMethod||'api';
        R.unchecked.push({label:'Usercentrics: denyAllConsents()',category:'CMP API',type:'deny-all'});
      }
    } catch(_){}

    // Osano
    try { if(window.Osano?.cm?.deny){window.Osano.cm.deny();hit=true;} } catch(_){}

    // Iubenda
    try { if(window._iub?.cs?.api?.rejectAll){window._iub.cs.api.rejectAll();hit=true;} } catch(_){}

    // Quantcast
    try { if(window.__qcCmpApi){window.__qcCmpApi('setConsentedToAll',false,null);hit=true;} } catch(_){}

    // IAB TCF v2 — read and report purposes
    try {
      if (window.__tcfapi) {
        await new Promise(resolve=>{
          window.__tcfapi('getTCData',2,(tcData,success)=>{
            if(!success||!tcData){resolve();return;}
            R.cmpMethod=R.cmpMethod||'api';
            Object.entries(tcData?.purpose?.consents||{}).forEach(([id,consented])=>{
              const n=parseInt(id);
              if(MANDATORY_TCF_PURPOSES.has(n)){if(consented)R.mandatory.push({label:TCF_PURPOSE_LABELS[n]||`Purpose ${id}`,category:'TCF (mandatory)',type:'consent'});}
              else if(consented){R.unchecked.push({label:TCF_PURPOSE_LABELS[n]||`Purpose ${id}`,category:'TCF Purpose',type:'consent'});}
            });
            Object.entries(tcData?.purpose?.legitimateInterests||{}).forEach(([id,hasLI])=>{
              if(!MANDATORY_TCF_PURPOSES.has(parseInt(id))&&hasLI)
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
  function scrapeToggles() {
    const toggles = Array.from(document.querySelectorAll(
      'input[type="checkbox"],[role="switch"],[role="checkbox"],[class*="toggle"] input,[class*="switch"] input'
    ));
    R.totalTogglesFound = toggles.length;
    let count=0;

    toggles.forEach(toggle=>{
      if(toggle.disabled||toggle.getAttribute('aria-disabled')==='true'||toggle.readOnly){
        R.mandatory.push({label:getLabel(toggle),category:'Locked by CMP',type:'system'});
        return;
      }
      const label = getLabel(toggle);
      const ctx = (toggle.closest('[class],[id]')?.textContent||'').substring(0,400);
      const all = label+' '+ctx;

      if(hasKeyword(all,MANDATORY_KW)){
        const checked=toggle.type==='checkbox'?toggle.checked:toggle.getAttribute('aria-checked')==='true';
        if(checked) R.mandatory.push({label,category:'Strictly Necessary',type:'consent'});
        return;
      }

      const checked=toggle.type==='checkbox'?toggle.checked:toggle.getAttribute('aria-checked')==='true';
      if(checked){
        const lo=all.toLowerCase();
        const cat=lo.includes('legitimate interest')?'Legitimate Interest'
                 :lo.includes('special feature')?'Special Feature'
                 :lo.includes('vendor')?'Vendor Consent':'Consent';
        if(safeUncheck(toggle,label,cat)) count++;
      }
    });
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
    const managePatterns=[
      /manage( (preferences?|cookies?|settings?|consent))?$/i,
      /^(cookie )?settings?$/i,/^preferences?$/i,
      /^customize$/i,/^customise$/i,/^more options$/i,/^gérer/i,/^einstellungen$/i,
    ];
    const btns=Array.from(document.querySelectorAll('button,[role="button"],a')).filter(isVisible);
    for(const btn of btns){
      const text=textOf(btn);
      if(matchesPats(text,managePatterns)){
        const inBanner=btn.closest('[id*="cookie"],[id*="consent"],[id*="gdpr"],[class*="cookie"],[class*="consent"],[class*="cmp"],[class*="banner"],dialog,[role="dialog"]');
        if(inBanner){
          btn.click();
          await sleep(500);
          break;
        }
      }
    }
    const count=scrapeToggles();
    if(count>0){
      await sleep(300);
      const confirmed=tryConfirm();
      R.bannerFound=true;
      R.cmpMethod=R.cmpMethod||'toggle-scrape';
      if(confirmed) R.bannerClosed=true;
    }
    return count;
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
    const cmps = detectCMPs();
    R.cmpDetected = cmps.length>0 ? cmps.join(', ') : null;

    // Phase 1: Try clicking a Deny/Reject All button (catches all simple banners)
    const denied = tryDenyButton();

    if (!denied) {
      // Phase 2: CMP-specific API calls
      await tryCMPApis();

      // Phase 3: Open manage panel + scrape toggles
      await tryManagePanel();

      // Phase 4: Raw toggle scrape (catches cases where panel was already open)
      if (R.unchecked.length === 0) {
        const count = scrapeToggles();
        if (count > 0) {
          await sleep(300);
          const confirmed = tryConfirm();
          R.bannerFound = true;
          R.cmpMethod = R.cmpMethod || 'toggle-scrape';
          if (confirmed) R.bannerClosed = true;
        }
      }
    }

    // Phase 5: Close banner if still open
    await sleep(500);
    if (!R.bannerClosed) tryHideBanner();

    // Deduplicate
    R.unchecked = dedupe(R.unchecked);
    R.mandatory = dedupe(R.mandatory);
    R.errors    = dedupe(R.errors);

    try {
      chrome.runtime.sendMessage({
        type:'DSC_SCAN_COMPLETE',
        data:{...R, url:window.location.href, title:document.title}
      });
    } catch(_){}

    return R;
  }

  // ── Auto-mode ──────────────────────────────────────────────────────────────
  async function checkAutoMode() {
    try {
      const data = await new Promise(r=>chrome.storage.local.get('autoMode',r));
      if (data.autoMode) {
        await sleep(1500); // Wait for banner to render
        await runDeny();
      }
    } catch(_){}
  }
  checkAutoMode();

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
      const bannerVisible=[
        '[id*="cookie"],[class*="cookie-banner"],[class*="consent"]',
        '#onetrust-banner-sdk','#CybotCookiebotDialog','#didomi-host',
        'dialog[open],[role="dialog"]',
      ].some(sel=>{try{const e=document.querySelector(sel);return e&&isVisible(e);}catch(_){return false;}});
      sendResponse({
        cmps,cmpString:cmps.length>0?cmps.join(', '):null,
        bannerVisible,
        toggleCount:document.querySelectorAll('input[type="checkbox"],[role="switch"],[role="checkbox"]').length,
        url:window.location.href,title:document.title
      });
      return true;
    }
  });

  window.addEventListener('message',e=>{if(e.data?.type==='DSC_CLEAN') runDeny();});

})();
