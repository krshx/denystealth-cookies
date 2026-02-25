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

  const VERSION = '1.4.0';
  const MANDATORY_TCF_PURPOSES = new Set([10, 11]);
  const MAX_WAIT_PER_SECTION = 1000; // ms - wait for dynamic content after clicking tabs
  const MAX_TOTAL_RUNTIME = 30000; // ms - safety timeout for entire operation
  const MAX_RETRIES_PER_ACTION = 2;
  const MAX_LEARNED_PATTERNS_PER_DOMAIN = 10; // Limit learned patterns per domain
  const LEARNED_PATTERN_EXPIRY_DAYS = 90; // Expire old patterns after 90 days
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
    /^no[,.]? thanks?$/i,/^no,? thanks?$/i,/^skip$/i,/^(i )?disagree( all)?$/i,
    /^(only |just )?(necessary|essential|required|functional)( cookies?)?( only)?$/i,
    /^(allow|use|accept) (only )?(necessary|essential|required|functional)( cookies?)?( only)?$/i,
    /^continue without (accepting|agreeing|consenting|cookies?)$/i,
    /^proceed without (accepting|consenting)$/i,
    /^do not (accept|consent|agree)$/i,
    // BBC and similar sites: "Reject additional cookies", "Reject all cookies"
    /reject (additional|all|non-essential|optional|tracking|analytics|marketing)( cookies?)?$/i,
    /decline (additional|all|non-essential|optional|tracking)( cookies?)?$/i,
    /deny (additional|all|non-essential|optional)( cookies?)?$/i,
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

  // ── Universal Modal & Button Detection ────────────────────────────────────
  // This system detects ANY modal/overlay and intelligently classifies buttons
  // Works universally without needing site-specific patterns
  
  /**
   * Find all modals/overlays on page (by structure, not keywords)
   * Returns elements that look like modals based on CSS properties
   */
  function findAllModals() {
    const candidates = document.querySelectorAll(
      'dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"],' +
      '[class*="modal"],[class*="overlay"],[class*="popup"],[class*="banner"],' +
      '[class*="panel"],[class*="drawer"],[class*="slide"],[class*="onetrust"],' +
      '[class*="cookie"],[class*="consent"],[class*="privacy"],[class*="gdpr"],' +
      '[id*="modal"],[id*="overlay"],[id*="popup"],[id*="banner"],' +
      '[id*="panel"],[id*="drawer"],[id*="onetrust"],' +
      '[id*="cookie"],[id*="consent"],[id*="privacy"],[id*="gdpr"]'
    );
    
    console.log(`[DenyStealthCookies] findAllModals: Found ${candidates.length} candidate elements`);
    
    const modals = [];
    for (const el of candidates) {
      if (!isVisible(el)) {
        console.log('[DenyStealthCookies]   Candidate not visible, skipping');
        continue;
      }
      
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      
      // Must be positioned (fixed/absolute) and have high z-index OR be a dialog
      const isPositioned = style.position === 'fixed' || style.position === 'absolute' || el.tagName === 'DIALOG';
      const zIndex = style.zIndex;
      const zIndexNum = zIndex === 'auto' ? 0 : parseInt(zIndex || 0);
      // Accept if positioned with ANY z-index (including auto), OR has high z-index, OR is a dialog
      const hasValidZIndex = (isPositioned && zIndex !== '') || zIndexNum > 10 || el.tagName === 'DIALOG';
      
      // Size requirements: More lenient for consent elements
      // Cookie bars are often wide but short (e.g., 1400x60)
      const isReasonablyLarge = rect.width > 200 && rect.height > 100;
      const isWideBar = rect.width > 500 && rect.height > 40; // Wide but short bars
      
      // Also check if it looks like a consent element by ID/class
      const id = el.id?.toLowerCase() || '';
      const cls = String(el.className || '').toLowerCase();
      const looksLikeConsent = id.includes('cookie') || id.includes('consent') || 
                               cls.includes('cookie') || cls.includes('consent') || 
                               cls.includes('gdpr') || cls.includes('privacy') ||
                               id.includes('onetrust') || cls.includes('onetrust') ||
                               id.includes('cmpbox') || cls.includes('cmpbox');
      
      console.log(`[DenyStealthCookies]   Candidate: pos=${style.position}, zIndex=${zIndex}, size=${rect.width}x${rect.height}, tag=${el.tagName}, looksLikeConsent=${looksLikeConsent}, id=${id.substring(0,30)}`);
      
      // Accept if:
      // 1. Looks like consent AND (reasonably large OR wide bar), OR
      // 2. Properly positioned with valid z-index AND reasonably large
      if (looksLikeConsent && (isReasonablyLarge || isWideBar)) {
        console.log('[DenyStealthCookies]   ✓ Modal detected (consent element)!');
        modals.push(el);
      } else if (isPositioned && hasValidZIndex && isReasonablyLarge) {
        console.log('[DenyStealthCookies]   ✓ Modal detected (positioned overlay)!');
        modals.push(el);
      } else {
        console.log(`[DenyStealthCookies]   ✗ Rejected: positioned=${isPositioned}, validZ=${hasValidZIndex}, consent=${looksLikeConsent}, largeEnough=${isReasonablyLarge}, wideBar=${isWideBar}`);
      }
    }
    
    // Sort by z-index (highest first) - likely the most important modal
    modals.sort((a, b) => {
      const zA = parseInt(window.getComputedStyle(a).zIndex || 0);
      const zB = parseInt(window.getComputedStyle(b).zIndex || 0);
      return zB - zA;
    });
    
    return modals;
  }
  
  /**
   * Check if a modal is about privacy/cookies/consent
   * Uses semantic analysis instead of hardcoded selectors
   * @param {Element} modal - The modal element to check
   * @param {number} referenceTime - Time to check "appeared recently" against (defaults to page load)
   */
  function isPrivacyModal(modal, referenceTime = null) {
    const text = textOf(modal).toLowerCase();
    const words = text.split(/\s+/);
    
    // Must contain privacy-related keywords
    const privacyKeywords = ['cookie', 'privacy', 'consent', 'personal data', 'tracking', 
                             'gdpr', 'data protection', 'your choices', 'we value', 
                             'we use cookies', 'this website uses', 'we and our partners',
                             'store and/or access', 'legitimate interest', 'personalised ads'];
    const hasPrivacyKeyword = privacyKeywords.some(kw => text.includes(kw));
    
    // Must contain choice-related words (indicating user needs to make decision)
    const choiceKeywords = ['accept', 'reject', 'agree', 'disagree', 'allow', 'deny', 
                           'decline', 'refuse', 'manage', 'settings', 'preferences'];
    const hasChoiceKeyword = choiceKeywords.some(kw => text.includes(kw));
    
    // Must have buttons (indicating interaction)
    const buttons = modal.querySelectorAll('button,[role="button"],a[class*="btn"],a[class*="button"]');
    const visibleButtons = Array.from(buttons).filter(isVisible);
    const hasButtons = visibleButtons.length >= 1;
    
    // Special case: If modal has both "reject" and "accept" buttons, it's almost certainly a consent banner
    // even without explicit privacy keywords (for minimalist banners like Air France)
    const buttonTexts = visibleButtons.map(b => textOf(b).toLowerCase());
    const hasRejectButton = buttonTexts.some(t => /\b(reject|decline|deny|no thanks?)\b/i.test(t));
    const hasAcceptButton = buttonTexts.some(t => /\b(accept|agree|allow|yes)\b/i.test(t));
    const isRejectAcceptPair = hasRejectButton && hasAcceptButton;
    
    // Check if appeared recently  
    // If referenceTime is provided (e.g., when clicking "manage" opened a new panel), use that
    // Otherwise use page load time
    const checkTime = referenceTime || performance.timing?.navigationStart || (Date.now() - 60000);
    const appearedRecently = Date.now() - checkTime < 60000; // 60 second window (extended for slow-loading sites)
    
    console.log(`[DenyStealthCookies] isPrivacyModal check:`, {
      hasPrivacyKeyword,
      hasChoiceKeyword, 
      hasButtons,
      isRejectAcceptPair,
      appearedRecently,
      checkTime: new Date(checkTime).toISOString(),
      textPreview: text.substring(0, 100)
    });
    
    // Return true if either:
    // 1. Has privacy keywords + choice keywords + buttons
    // 2. Has reject/accept button pair (minimalist consent banners)
    return ((hasPrivacyKeyword && hasChoiceKeyword) || isRejectAcceptPair) && hasButtons && appearedRecently;
  }
  
  /**
   * Classify a button's intent: 'accept', 'reject', 'manage', or 'unknown'
   * Uses semantic analysis of text and context
   */
  function classifyButton(button) {
    const text = textOf(button).toLowerCase().trim();
    const attrs = [
      button.getAttribute('aria-label'),
      button.getAttribute('title'),
      button.id,
      button.className
    ].filter(Boolean).join(' ').toLowerCase();
    
    const combined = text + ' ' + attrs;
    
    // Accept/Allow patterns (we want to AVOID these)
    const acceptPatterns = [
      /\b(accept|allow|agree|consent|yes|(allow|accept)\s*(all|everything))\b/i,
      /\b(i\s*agree|got\s*it|okay|ok)\b/i,
      /\bcontinue\b/i, // Only if not "continue without"
    ];
    
    // Reject/Deny patterns (we WANT these)
    const rejectPatterns = [
      /\b(reject|deny|decline|refuse|disagree|no)\b/i,
      /\b(opt\s*out|do\s*not|don'?t)\b/i,
      /\b(only\s*(necessary|essential|required)|necessary\s*only)\b/i,
      /\b(continue\s*without|proceed\s*without|no\s*thanks?)\b/i,
      /\b(save\s*(my\s*)?choice|confirm\s*choice)\b/i,
    ];
    
    // Manage/Settings patterns (neutral - opens settings)
    const managePatterns = [
      /\b(manage|customize|settings|preferences|options|choices|learn\s*more|more\s*options)\b/i,
      /\b(view\s*(cookie\s*)?(settings|preferences))\b/i,
    ];
    
    // Check patterns in order of priority
    if (rejectPatterns.some(p => p.test(combined))) {
      // But make sure it's not a false positive like "I do not reject"
      if (!/\bdo\s*not\s*(reject|deny|decline)\b/i.test(combined)) {
        return 'reject';
      }
    }
    
    if (acceptPatterns.some(p => p.test(combined))) {
      // Exclude "continue without accepting"
      if (!/\b(without|no)\b/i.test(text)) {
        return 'accept';
      }
    }
    
    if (managePatterns.some(p => p.test(combined))) {
      return 'manage';
    }
    
    return 'unknown';
  }
  
  /**
   * Universal modal handler - finds privacy modals and clicks the most restrictive option
   * Returns true if successfully handled a modal
   * @param {number} depth - Recursion depth to prevent infinite loops (max 3 levels)
   * @param {WeakSet} processedModals - Set of modals already processed to avoid re-processing
   */
  async function handleUniversalModal(depth = 0, processedModals = new WeakSet()) {
    if (depth > 2) {
      console.log('[DenyStealthCookies] Max recursion depth reached, stopping');
      return false;
    }
    
    console.log('[DenyStealthCookies] Universal Detection: Scanning for modals...' + (depth > 0 ? ` (step ${depth + 1})` : ''));
    const modals = findAllModals();
    console.log(`[DenyStealthCookies] Found ${modals.length} modal(s) on page`);
    
    for (const modal of modals) {
      // Skip already processed modals
      if (processedModals.has(modal)) {
        console.log('[DenyStealthCookies] Modal already processed (first step), skipping');
        continue;
      }
      
      if (!isPrivacyModal(modal)) {
        console.log('[DenyStealthCookies] Modal found but not privacy-related, skipping');
        continue;
      }
      
      console.log('[DenyStealthCookies] ✓ Privacy modal detected! Analyzing buttons...');
      
      // Find all buttons in modal
      const buttons = Array.from(modal.querySelectorAll(
        'button,[role="button"],a[class*="btn"],a[class*="button"],input[type="button"],input[type="submit"]'
      )).filter(isVisible);
      
      console.log(`[DenyStealthCookies] Found ${buttons.length} buttons in modal`);
      
      // Classify all buttons
      const classified = buttons.map(btn => ({
        element: btn,
        text: textOf(btn),
        type: classifyButton(btn)
      }));
      
      // Log classification
      classified.forEach(({ text, type }) => {
        console.log(`[DenyStealthCookies]   Button: "${text.substring(0, 40)}" → ${type}`);
      });
      
      // Priority: reject > manage > unknown > accept (never accept!)
      let targetButton = classified.find(b => b.type === 'reject');
      
      if (!targetButton) {
        // No reject button found - try manage/settings to access more options
        targetButton = classified.find(b => b.type === 'manage');
        console.log('[DenyStealthCookies] No reject button found, trying manage/settings');
      }
      
      if (!targetButton) {
        // Last resort: click any unknown button (but never 'accept')
        targetButton = classified.find(b => b.type === 'unknown');
        console.log('[DenyStealthCookies] No reject/manage found, trying unknown button');
      }
      
      if (targetButton) {
        console.log(`[DenyStealthCookies] Clicking button: "${targetButton.text}"`);
        logAction(`Universal detection: Clicking "${targetButton.text}" (type: ${targetButton.type})`);
        
        // Mark this modal as processed before clicking
        processedModals.add(modal);
        
        clickElement(targetButton.element);
        await sleep(800);
        
        // If we clicked "manage", wait for settings panel to appear and scan again
        if (targetButton.type === 'manage') {
          console.log('[DenyStealthCookies] Clicked manage button, waiting for settings panel to appear...');
          
          // Don't mark banner closed yet - there's another step
          R.bannerFound = true;
          R.unchecked.push({
            label: `Universal: Clicked "${targetButton.text}" (Step 1)`,
            category: 'Universal Detection',
            type: targetButton.type
          });
          
          const manageClickTime = Date.now(); // Save time when we clicked manage
          await sleep(1800); // Wait longer for settings panel animation/load (OneTrust can be slow)
          
          // Scan for NEW modals (side panels, drawers, etc.) that appeared after clicking manage
          console.log('[DenyStealthCookies] Scanning for new modals (settings panels, side drawers)...');
          const allModalsNow = findAllModals();
          console.log(`[DenyStealthCookies] Total modals now visible: ${allModalsNow.length}`);
          
          // Debug: Show details of all modals found
          allModalsNow.forEach((m, i) => {
            const id = m.id || '(no id)';
            const cls = m.className || '(no class)';
            const tag = m.tagName;
            const isProcessed = processedModals.has(m);
            console.log(`[DenyStealthCookies]   Modal ${i+1}: ${tag} id="${id}" class="${cls}" processed=${isProcessed}`);
          });
          
          // Process any NEW modals that weren't in our processed set
          for (const newModal of allModalsNow) {
            if (processedModals.has(newModal)) {
              console.log('[DenyStealthCookies] Skipping already-processed first modal');
              continue;
            }
            
            // Check if privacy-related, using manageClickTime as reference for "appeared recently"
            if (!isPrivacyModal(newModal, manageClickTime)) {
              console.log('[DenyStealthCookies] New modal not privacy-related (or appeared too long ago), skipping');
              continue;
            }
            
            console.log('[DenyStealthCookies] ✓ NEW settings panel detected! Analyzing buttons...');
            
            const settingsButtons = Array.from(newModal.querySelectorAll(
              'button,[role="button"],a[class*="btn"],a[class*="button"],input[type="button"],input[type="submit"]'
            )).filter(isVisible);
            
            const settingsClassified = settingsButtons.map(btn => ({
              element: btn,
              text: textOf(btn),
              type: classifyButton(btn)
            }));
            
            console.log(`[DenyStealthCookies] Step 2: Found ${settingsButtons.length} buttons in new settings panel`);
            settingsClassified.forEach(({ text, type }) => {
              console.log(`[DenyStealthCookies]   Button: "${text.substring(0, 40)}" → ${type}`);
            });
            
            // Look for reject button
            const rejectBtn = settingsClassified.find(b => b.type === 'reject');
            if (rejectBtn) {
              console.log(`[DenyStealthCookies] Step 2: Clicking "${rejectBtn.text}" in settings panel`);
              logAction(`Universal detection: Clicking "${rejectBtn.text}" (Step 2)`);
              
              processedModals.add(newModal);
              clickElement(rejectBtn.element);
              await sleep(800);
              
              // Check if both modals are gone
              const bothGone = !isVisible(modal) && !isVisible(newModal);
              R.bannerClosed = bothGone;
              if (!R.cmpDetected) {
                R.cmpDetected = 'Universal/Generic';
              }
              R.cmpMethod = 'universal-detection-multistep';
              R.unchecked.push({
                label: `Universal: Clicked "${rejectBtn.text}" (Step 2)`,
                category: 'Universal Detection',
                type: 'reject'
              });
              
              logAction(bothGone ? '✓ Both modals closed successfully' : '⚠ Some modals still visible');
              return true; // Success!
            }
          }
          
          // No new settings panel found with reject button - let other phases try
          console.log('[DenyStealthCookies] No settings panel with reject button found, continuing to other phases');
          return false;
        }
        
        // For reject/unknown buttons, check if modal closed and finalize
        const modalGone = !isVisible(modal);
        R.bannerFound = true;
        R.bannerClosed = modalGone;
        // Only set cmpDetected if not already detected by standard CMP detection
        if (!R.cmpDetected) {
          R.cmpDetected = 'Universal/Generic';
        }
        R.cmpMethod = 'universal-detection';
        R.unchecked.push({
          label: `Universal: Clicked "${targetButton.text}"`,
          category: 'Universal Detection',
          type: targetButton.type
        });
        
        logAction(modalGone ? '✓ Modal closed successfully' : '⚠ Modal still visible');
        
        return true;
      }
      
      console.log('[DenyStealthCookies] No suitable button found in modal');
    }
    
    if (depth > 0) {
      console.log('[DenyStealthCookies] No new modals found in step ' + (depth + 1));
    }
    return false;
  }

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
  let learnedPatterns = null; // Loaded from storage
  let teachingMode = false; // Manual selection mode
  
  // Inject CSS animations for notifications
  (function injectAnimations() {
    if (document.getElementById('denystealth-animations')) return;
    const style = document.createElement('style');
    style.id = 'denystealth-animations';
    style.textContent = `
      @keyframes slideIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes slideInRight {
        from { opacity: 0; transform: translateX(20px); }
        to { opacity: 1; transform: translateX(0); }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  })();

  // ── Utilities ──────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r,ms));

  // ── Learned Patterns Storage ───────────────────────────────────────────────
  async function loadLearnedPatterns() {
    try {
      const result = await chrome.storage.local.get('learnedPatterns');
      learnedPatterns = result.learnedPatterns || {};
      
      // Clean expired patterns
      const now = Date.now();
      const expiryMs = LEARNED_PATTERN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      
      for (const domain in learnedPatterns) {
        learnedPatterns[domain].patterns = (learnedPatterns[domain].patterns || []).filter(
          p => (now - p.learned) < expiryMs
        );
        
        // Remove domain if no patterns left
        if (learnedPatterns[domain].patterns.length === 0) {
          delete learnedPatterns[domain];
        }
      }
      
      logAction(`Loaded ${Object.keys(learnedPatterns).length} domains with learned patterns`);
      return learnedPatterns;
    } catch(err) {
      logAction(`Failed to load learned patterns: ${err.message}`);
      learnedPatterns = {};
      return {};
    }
  }

  async function saveLearnedPattern(domain, pattern) {
    try {
      if (!learnedPatterns[domain]) {
        learnedPatterns[domain] = { patterns: [], successCount: 0 };
      }
      
      // Check if pattern already exists
      const exists = learnedPatterns[domain].patterns.some(
        p => p.text === pattern.text && p.selector === pattern.selector
      );
      
      if (!exists) {
        // Keep only the most recent patterns per domain
        if (learnedPatterns[domain].patterns.length >= MAX_LEARNED_PATTERNS_PER_DOMAIN) {
          // Sort by success count (descending), keep top patterns
          learnedPatterns[domain].patterns.sort((a, b) => b.successCount - a.successCount);
          learnedPatterns[domain].patterns = learnedPatterns[domain].patterns.slice(0, MAX_LEARNED_PATTERNS_PER_DOMAIN - 1);
        }
        
        learnedPatterns[domain].patterns.push({
          ...pattern,
          learned: Date.now(),
          successCount: 1
        });
        
        logAction(`Learned new pattern for ${domain}: "${pattern.text}"`);
      } else {
        // Increment success count for existing pattern
        const existing = learnedPatterns[domain].patterns.find(
          p => p.text === pattern.text && p.selector === pattern.selector
        );
        if (existing) {
          existing.successCount++;
          existing.lastSuccess = Date.now();
          logAction(`Updated pattern success count for ${domain}: "${pattern.text}" (${existing.successCount} times)`);
        }
      }
      
      learnedPatterns[domain].successCount++;
      await chrome.storage.local.set({ learnedPatterns });
      console.log('[DenyStealthCookies] Pattern saved to storage. Total patterns for', domain, ':', learnedPatterns[domain].patterns.length);
    } catch(err) {
      logAction(`Failed to save learned pattern: ${err.message}`);
    }
  }

  function getDomainKey(url) {
    try {
      const hostname = new URL(url).hostname;
      // Remove www. prefix for consistency
      return hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  // Log action with timestamp (capped at MAX_ACTION_LOG_ENTRIES)
  function logAction(action) {
    if (R.actionLog.length >= MAX_ACTION_LOG_ENTRIES) return;
    const logEntry = {
      time: Date.now() - R.startTime,  // Relative time in ms
      action: String(action).substring(0, 200)  // Sanitize and limit length
    };
    R.actionLog.push(logEntry);
    // Also log to console for real-time debugging
    console.log(`[DenyStealthCookies] ${logEntry.action}`);
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect(), s = window.getComputedStyle(el);
      return r.width>0 && r.height>0 && s.display!=='none' &&
             s.visibility!=='hidden' && parseFloat(s.opacity)>0 && el.offsetParent!==null;
    } catch(_){ return false; }
  }

  // Enhanced click with proper event dispatching for better compatibility
  function clickElement(el) {
    try {
      // Try focus first (some buttons need it)
      if (el.focus) el.focus();
      
      // Dispatch proper mouse events
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      
      // Also try direct click as fallback
      el.click();
      return true;
    } catch (err) {
      // Fallback to simple click
      try {
        el.click();
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  // Check if banner is still visible after clicking
  function isBannerVisible() {
    const bannerSelectors = [
      '[id*="cookie"],[id*="consent"],[id*="gdpr"]',
      '[class*="cookie"],[class*="consent"],[class*="gdpr"]',
      '[class*="banner"][class*="cookie"],[class*="banner"][class*="consent"]',
      '#onetrust-banner-sdk','#CybotCookiebotDialog','#didomi-host',
      '.qc-cmp2-container','dialog[open]','[role="dialog"][aria-modal="true"]',
      '[class*="modal"][class*="cookie"],[class*="modal"][class*="consent"]',
      '[class*="overlay"][class*="cookie"],[class*="overlay"][class*="consent"]',
    ];
    
    // Special handling: OneTrust preference center (#onetrust-pc-sdk) is NOT the main banner
    // Only count it as "banner visible" if the main banner (#onetrust-banner-sdk) is also visible
    const oneTrustPC = document.getElementById('onetrust-pc-sdk');
    const oneTrustBanner = document.getElementById('onetrust-banner-sdk');
    if (oneTrustPC && isVisible(oneTrustPC) && oneTrustBanner && !isVisible(oneTrustBanner)) {
      // Preference center is open but main banner is closed - this is OK (user opened settings)
      // Don't count as "banner visible"
      console.log('[DenyStealthCookies] OneTrust PC visible but main banner closed - considering banner gone');
    }
    
    for (const sel of bannerSelectors) {
      try {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          // Skip OneTrust preference center if main banner is closed
          if (el.id === 'onetrust-pc-sdk' && oneTrustBanner && !isVisible(oneTrustBanner)) {
            continue;
          }
          
          if (isVisible(el)) {
            const text = textOf(el).toLowerCase();
            // Must contain cookie/consent keywords to be a banner
            if (text.includes('cookie') || text.includes('consent') || text.includes('gdpr') || text.includes('privacy')) {
              return true;
            }
          }
        }
      } catch (_) {}
    }
    return false;
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
      ['Usercentrics',  ()=>!!(window.UC_UI||document.querySelector('[data-testid="uc-center-container"]')||document.querySelector('[id*="usercentrics"]')||document.querySelector('[class*="uc-banner"]'))],
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
                    'dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"],[class*="modal"],[class*="overlay"]'];
      for (const sel of sels) {
        try {
          const el = document.querySelector(sel);
          if (el && isVisible(el)) {
            const txt = textOf(el).toLowerCase();
            if ((txt.includes('cookie')||txt.includes('consent')||txt.includes('gdpr')||
                 txt.includes('privacy')||txt.includes('personal data')||txt.includes('tracking')) &&
                (txt.includes('agree')||txt.includes('accept')||txt.includes('reject')||txt.includes('deny'))) {
              detected.push('Generic'); break;
            }
          }
        } catch(_){}
      }
    }
    return detected;
  }

  // Generate a unique CSS selector for an element (for learning)
  function getUniqueSelector(el) {
    if (!el) return null;
    
    // Try ID first (most unique)
    if (el.id) return `#${el.id}`;
    
    // Try data-testid (common in modern apps)
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;
    
    // Try aria-label (descriptive)
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
    
    // Try class combination (if unique enough)
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).slice(0, 3).join('.');
      if (classes) {
        const selector = `${el.tagName.toLowerCase()}.${classes}`;
        // Check if selector is unique
        try {
          if (document.querySelectorAll(selector).length === 1) {
            return selector;
          }
        } catch (_) {}
      }
    }
    
    // Fallback: tag + position in parent
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(el);
      const parentSel = parent.id ? `#${parent.id}` : parent.tagName.toLowerCase();
      return `${parentSel} > ${el.tagName.toLowerCase()}:nth-child(${index + 1})`;
    }
    
    return el.tagName.toLowerCase();
  }

  // ── Strategy 0: Try learned patterns first ────────────────────────────────
  async function tryLearnedPatterns() {
    const domain = getDomainKey(window.location.href);
    if (!domain || !learnedPatterns || !learnedPatterns[domain]) {
      return false;
    }
    
    const domainPatterns = learnedPatterns[domain].patterns || [];
    if (domainPatterns.length === 0) {
      return false;
    }
    
    logAction(`Trying ${domainPatterns.length} learned patterns for ${domain}`);
    
    // Sort by success count (most successful first)
    const sorted = [...domainPatterns].sort((a, b) => b.successCount - a.successCount);
    
    for (const pattern of sorted) {
      try {
        let button = null;
        
        // Try by selector first (most precise)
        if (pattern.selector) {
          button = document.querySelector(pattern.selector);
        }
        
        // Fallback to text matching
        if (!button && pattern.text) {
          const buttons = Array.from(document.querySelectorAll('button,[role="button"],a'))
            .filter(isVisible);
          button = buttons.find(btn => {
            const text = textOf(btn);
            return text.toLowerCase() === pattern.text.toLowerCase();
          });
        }
        
        if (button && isVisible(button)) {
          logAction(`Found learned pattern: "${pattern.text}" (used ${pattern.successCount} times)`);
          clickElement(button);
          await sleep(500);
          
          const bannerGone = !isBannerVisible();
          R.bannerFound = true;
          R.bannerClosed = bannerGone;
          R.cmpMethod = 'learned-pattern';
          R.unchecked.push({
            label: `Clicked learned button: "${pattern.text}"`,
            category: 'Learned Pattern',
            type: 'deny-all'
          });
          
          if (bannerGone) {
            // Reinforce success
            await saveLearnedPattern(domain, {
              text: pattern.text,
              selector: pattern.selector,
              method: 'auto-learned'
            });
            logAction('✓ Learned pattern worked! Reinforced.');
            return true;
          }
        }
      } catch (err) {
        logAction(`Error trying learned pattern: ${err.message}`);
      }
    }
    
    return false;
  }

  // ── Strategy 1: Find & click deny/reject button directly ──────────────────
  async function tryDenyButton(learnIfSuccessful = false) {
    const BANNER_SEL = [
      '[id*="cookie"],[id*="consent"],[id*="gdpr"],[id*="privacy"],[id*="banner"]',
      '[class*="cookie"],[class*="consent"],[class*="gdpr"],[class*="cmp"],[class*="banner"]',
      '.onetrust-banner-sdk','#didomi-host','#CybotCookiebotDialog',
      '.qc-cmp2-container','dialog','[role="dialog"]','[aria-modal="true"]',
      '[data-testid*="uc-"]','[id*="usercentrics"]','[class*="usercentrics"]',
      '.uc-banner','#uc-banner','[class*="uc-"]',
    ].join(',');

    // All visible buttons/links on page
    const clickables = Array.from(document.querySelectorAll(
      'button,[role="button"],a[class*="btn"],a[class*="button"],input[type="button"],input[type="submit"]'
    )).filter(isVisible);
    
    console.log(`[DenyStealthCookies] Phase 1: Scanning ${clickables.length} clickable elements for deny buttons`);

    // First pass: buttons inside known banner containers
    for (const el of clickables) {
      const text = textOf(el);
      const attrs = [el.getAttribute('aria-label'),el.getAttribute('title'),el.id,String(el.className||'')].filter(Boolean).join(' ');
      if (matchesPats(text,DENY_PATTERNS) || matchesPats(attrs,DENY_PATTERNS)) {
        try {
          if (el.closest(BANNER_SEL)) {
            console.log(`[DenyStealthCookies] Phase 1: Found deny button in banner: "${text || attrs}"`);
            logAction(`Found deny button in banner: "${text || attrs}"`);
            clickElement(el);
            await sleep(500); // Wait for animation/processing
            const bannerGone = !isBannerVisible();
            R.bannerFound=true; 
            R.bannerClosed=bannerGone; 
            R.cmpMethod='button-click';
            R.unchecked.push({label:`Clicked "${text||attrs}" button`,category:'Banner Action',type:'deny-all'});
            logAction(bannerGone ? '✓ Banner closed successfully' : '⚠ Banner still visible after click');
            
            // Learn this pattern if successful
            if (bannerGone && learnIfSuccessful) {
              const domain = getDomainKey(window.location.href);
              if (domain) {
                await saveLearnedPattern(domain, {
                  text: text || attrs,
                  selector: getUniqueSelector(el),
                  method: 'auto-learned'
                });
              }
            }
            
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
          console.log(`[DenyStealthCookies] Phase 1: Found deny button (2nd pass): "${text}"`);
          logAction(`Found deny button: "${text}"`);
          clickElement(el);
          await sleep(1000); // Wait longer for animation/processing (OneTrust can be slow)
          
          // Check banner visibility with retry logic (animations can be delayed)
          let bannerGone = !isBannerVisible();
          if (!bannerGone) {
            await sleep(500); // Wait another 500ms and check again
            bannerGone = !isBannerVisible();
          }
          
          R.bannerFound=true; 
          R.bannerClosed=bannerGone; 
          R.cmpMethod='button-click';
          R.unchecked.push({label:`Clicked "${text}" button`,category:'Banner Action',type:'deny-all'});
          logAction(bannerGone ? '✓ Banner closed successfully' : '⚠ Banner still visible after click');
          
          // Learn this pattern if successful
          if (bannerGone && learnIfSuccessful) {
            const domain = getDomainKey(window.location.href);
            if (domain) {
              await saveLearnedPattern(domain, {
                text: text,
                selector: getUniqueSelector(el),
                method: 'auto-learned'
              });
            }
          }
          
          return true;
        }
      }
    }

    // Third pass: known CMP deny selectors
    const knownDenySelectors = [
      // OneTrust (removed #onetrust-pc-btn-handler - it's a manage button, not reject)
      '#onetrust-reject-all-handler','.onetrust-close-btn-handler',
      // Cookiebot
      '#CybotCookiebotDialogBodyButtonDecline','a[id*="CookiebotDialogBodyButtonDecline"]',
      // Didomi
      '.didomi-continue-without-agreeing','#didomi-notice-disagree-button','button[id*="didomi-notice-disagree"]',
      // Quantcast
      'button[mode="secondary"][class*="qc-cmp"]','button[aria-label*="Reject"]',
      // Usercentrics
      '[data-testid="uc-deny-all-button"]','button[data-testid="uc-deny-all-button"]',
      '[data-testid="uc-deny-button"]','button[data-testid="uc-deny-button"]',
      'button[class*="uc-deny"]','button[id*="uc-deny"]',
      '.uc-deny-all-button','#uc-deny-all-button',
      'button.sc-button-secondary','button.sc-button-deny',
      // Sourcepoint
      'button[title*="Reject"]','button[title*="reject"]','button[title*="Decline"]',
      '#sp_message_container button','button[class*="sp_choice_type_11"]',
      'button.sp-button','button[aria-label*="Reject"]','button[aria-label*="Decline"]',
      '[class*="message-component"] button[class*="secondary"]',
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
          clickElement(btn);
          await sleep(1000); // Wait longer for animation/processing
          
          // Check banner visibility with retry logic
          let bannerGone = !isBannerVisible();
          if (!bannerGone) {
            await sleep(500);
            bannerGone = !isBannerVisible();
          }
          
          R.bannerFound=true; 
          R.bannerClosed=bannerGone; 
          R.cmpMethod='button-click';
          R.unchecked.push({label:`Clicked deny button: ${text}`,category:'Banner Action',type:'deny-all'});
          logAction(bannerGone ? '✓ Banner closed successfully' : '⚠ Banner still visible after click');
          return true;
        }
      } catch(__){}  
    }

    // Fourth pass: Usercentrics-specific text search (handles cases where buttons load dynamically)
    const ucContainers = document.querySelectorAll('[id*="usercentrics"],[class*="usercentrics"],[data-testid*="uc-"],[class*="uc-"]');
    if (ucContainers.length > 0) {
      logAction(`Found ${ucContainers.length} Usercentrics container(s), searching for deny buttons...`);
      let allButtons = [];
      
      for (const container of ucContainers) {
        if (!isVisible(container)) continue;
        
        const buttons = Array.from(container.querySelectorAll('button,[role="button"]')).filter(isVisible);
        allButtons.push(...buttons);
        
        if (buttons.length > 0) {
          console.log(`[DenyStealthCookies] Found ${buttons.length} buttons in Usercentrics container`);
        }
        
        for (const btn of buttons) {
          const text = textOf(btn);
          const cleanText = text.trim().replace(/\s+/g, ' '); // Normalize whitespace
          const dataTestId = btn.getAttribute('data-testid') || '';
          const ariaLabel = btn.getAttribute('aria-label') || '';
          
          console.log('[DenyStealthCookies] Usercentrics button:', {
            text: cleanText,
            dataTestId,
            ariaLabel,
            className: btn.className
          });
          
          // Match various deny/reject button texts (more flexible) and attributes
          const isDenyButton = 
            /^reject\s*all$/i.test(cleanText) || 
            /^deny\s*all$/i.test(cleanText) ||
            /^refuse\s*all$/i.test(cleanText) ||
            /decline.*all/i.test(cleanText) ||
            dataTestId.includes('deny') ||
            dataTestId.includes('reject') ||
            ariaLabel.toLowerCase().includes('deny') ||
            ariaLabel.toLowerCase().includes('reject');
          
          if (isDenyButton) {
            logAction(`Found Usercentrics deny button: "${cleanText}" (testId: ${dataTestId}) - clicking now`);
            clickElement(btn);
            await sleep(1000); // Wait longer for Usercentrics animations
            
            // Check with retry
            let bannerGone = !isBannerVisible();
            if (!bannerGone) {
              await sleep(500);
              bannerGone = !isBannerVisible();
            }
            
            R.bannerFound = true;
            R.bannerClosed = bannerGone;
            R.cmpMethod = 'button-click';
            R.unchecked.push({label:`Clicked Usercentrics "${cleanText}" button`,category:'Banner Action',type:'deny-all'});
            logAction(bannerGone ? '✓ Banner closed successfully' : '⚠ Banner still visible after click');
            
            // Learn if successful
            if (bannerGone && learnIfSuccessful) {
              const domain = getDomainKey(window.location.href);
              if (domain) {
                await saveLearnedPattern(domain, {
                  text: cleanText,
                  selector: getUniqueSelector(btn),
                  method: 'auto-learned'
                });
              }
            }
            
            return true;
          }
        }
      }
      
      // Log all button texts if we didn't find a match
      if (allButtons.length > 0) {
        logAction('⚠ No Reject/Deny All button found in Usercentrics. Available buttons: ' + 
          allButtons.slice(0, 5).map(b => `"${textOf(b).trim().substring(0, 30)}"`).join(', ') +
          (allButtons.length > 5 ? ` (and ${allButtons.length - 5} more)` : ''));
      }
    }

    console.log('[DenyStealthCookies] Phase 1 complete: No deny buttons found');
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

    // Usercentrics (enhanced with multiple strategies)
    try {
      let ucHandled = false;
      
      // Strategy 1: API call
      if (window.UC_UI?.denyAllConsents) {
        logAction('Usercentrics: Calling UC_UI.denyAllConsents()');
        window.UC_UI.denyAllConsents();
        ucHandled = true;
        hit = true;
        R.cmpMethod = R.cmpMethod || 'api';
        R.unchecked.push({label:'Usercentrics: denyAllConsents()',category:'CMP API',type:'deny-all'});
      }
      
      // Strategy 2: Try alternative API methods
      if (!ucHandled && window.UC_UI?.denyAll) {
        logAction('Usercentrics: Calling UC_UI.denyAll()');
        window.UC_UI.denyAll();
        ucHandled = true;
        hit = true;
      }
      
      // Strategy 3: Try clicking deny button if API didn't work or isn't available
      if (!ucHandled || !window.UC_UI) {
        const ucDenySelectors = [
          '[data-testid="uc-deny-all-button"]',
          'button[data-testid="uc-deny-all-button"]',
          '[data-testid="uc-deny-button"]',
          'button[data-testid="uc-deny-button"]',
          'button.sc-button-secondary',
          'button[aria-label*="Deny"]',
          'button[aria-label*="Reject"]',
          'button.uc-deny-button',
          'button[class*="uc-deny"]',
          'button[id*="uc-deny"]',
          '.uc-banner button:not([data-testid*="accept"])',
          // Add specific text-based selectors for Usercentrics
          'button[data-testid="uc-reject-all-button"]',
          'button[data-testid*="reject"]',
          'button.uc-list-button__deny',
        ];
        
        for (const sel of ucDenySelectors) {
          const btn = document.querySelector(sel);
          if (btn && isVisible(btn)) {
            const btnText = textOf(btn);
            logAction(`Usercentrics: Clicking button "${btnText}" (${sel})`);
            clickElement(btn);
            await sleep(500);
            ucHandled = true;
            hit = true;
            R.cmpMethod = R.cmpMethod || 'button-click';
            R.unchecked.push({label:`Usercentrics: Clicked "${btnText}"`,category:'CMP Button',type:'deny-all'});
            break;
          }
        }
        
        // Strategy 4: Try to find "Reject All" button by text within Usercentrics container
        if (!ucHandled) {
          logAction('Usercentrics: Trying text-based button search...');
          const ucContainers = document.querySelectorAll('[id*="usercentrics"],[class*="usercentrics"],[data-testid*="uc-"],[class*="uc-banner"]');
          for (const container of ucContainers) {
            if (!isVisible(container)) continue;
            
            const buttons = Array.from(container.querySelectorAll('button,[role="button"]')).filter(isVisible);
            
            console.log(`[DenyStealthCookies] Phase 2 Usercentrics: Found ${buttons.length} buttons in container`);
            
            for (const btn of buttons) {
              const text = textOf(btn).trim();
              const dataTestId = btn.getAttribute('data-testid') || '';
              const ariaLabel = btn.getAttribute('aria-label') || '';
              
              console.log('[DenyStealthCookies] Phase 2 Usercentrics button:', {
                text: text.substring(0, 40),
                dataTestId,
                ariaLabel
              });
              
              // Look for "Reject All" or similar deny text, or deny-related attributes
              const isDeny = /^reject\s*all$/i.test(text) || 
                           /^deny\s*all$/i.test(text) || 
                           /^refuse\s*all$/i.test(text) ||
                           /decline.*all/i.test(text) ||
                           dataTestId.includes('deny') ||
                           dataTestId.includes('reject') ||
                           ariaLabel.toLowerCase().includes('deny') ||
                           ariaLabel.toLowerCase().includes('reject');
              
              if (isDeny) {
                logAction(`Usercentrics: Found "${text || dataTestId}" button by enhanced search`);
                clickElement(btn);
                await sleep(1000);
                
                // Check with retry
                let bannerGone = !isBannerVisible();
                if (!bannerGone) {
                  await sleep(500);
                  bannerGone = !isBannerVisible();
                }
                
                hit = true;
                ucHandled = true;
                R.bannerFound = true;
                R.bannerClosed = bannerGone;
                R.cmpMethod = R.cmpMethod || 'button-click';
                R.unchecked.push({label:`Usercentrics: Clicked "${text || dataTestId}" button`,category:'CMP Button',type:'deny-all'});
                logAction(bannerGone ? '✓ Banner closed successfully' : '⚠ Banner still visible after click');
                break;
              }
            }
            if (ucHandled) break;
          }
        }
      }
      
      if (ucHandled) {
        // Already checked above, no need to check again
      } else {
        logAction('⚠ Usercentrics: No API or deny button found');
      }
    } catch(err) {
      logAction(`Usercentrics error: ${err.message}`);
    }

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
          
          // After clicking tab, check for newly appeared deny/disagree buttons
          await sleep(200); // Extra time for dynamic content
          const parent = el.closest('[role="tabpanel"],[class*="panel"],[class*="content"]')?.parentElement || document;
          const denyFound = await tryDenyButtonInContext(parent, text);
          if(denyFound && R.bannerClosed) {
            logAction(`✓ Found and clicked deny button in ${text} section`);
            return totalUnchecked + 1; // Exit early if banner was closed
          }
        }
        
        // Scrape this tab's content
        const parent = el.closest('[role="tabpanel"],[class*="panel"],[class*="content"]')?.parentElement || document;
        const count = scrapeToggles(text, parent);
        totalUnchecked += count;
        
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
          
          // Also check for deny buttons in this expanded section
          await tryDenyButtonInContext(parent, text);
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
          logAction(`Found deny button "${text}" in section: ${sectionName}`);
          clickElement(btn);
          await sleep(500);
          
          const bannerGone = !isBannerVisible();
          R.unchecked.push({
            label: `Clicked "${text}" in ${sectionName}`,
            category: 'Banner Action',
            type: 'deny-all',
            section: sectionName
          });
          
          if(bannerGone) {
            R.bannerClosed = true;
            logAction(`✓ Banner closed after clicking "${text}"`);
          }
          
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
            const cls = String(el.className || '').toLowerCase();
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
      /^learn more$/i,/^(show|view) (more|details?)$/i,
      /^view (our )?partners?$/i,/^details?$/i,/^(show|see) (all )?partners?$/i,
      /^customize$/i,/^customise$/i,/^gérer/i,/^einstellungen$/i,
      /^vendor preferences?$/i, /^privacy settings?$/i,
      /^more information$/i,/^(read|see) more$/i,
      /^more information$/i,/^(read|see) more$/i,
    ];
    // Look for buttons/links that might open detailed consent options
    const btns=Array.from(document.querySelectorAll('button,[role="button"],a,span[role="button"]')).filter(isVisible);
    
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
    
    // After opening panel, first check if deny/disagree buttons appeared
    await sleep(500); // Give more time for content to load
    logAction('Checking for deny buttons after opening manage panel');
    const denyFoundAfterOpen = await tryDenyButton();
    if(denyFoundAfterOpen) {
      logAction('✓ Found and clicked deny button after opening panel');
      return 1;
    }
    
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
          R.bannerFound=true; R.bannerClosed=true; R.cmpMethod=R.cmpMethod||'banner-hide';
          R.unchecked.push({label:'Banner hidden (CSS)',category:'Banner Action',type:'hide'});
          return true;
        }
      }catch(_){}
    }
    // Generic dialogs with cookie text
    const dialogs=document.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"]');
    for(const el of dialogs){
      if(!isVisible(el)) continue;
      const txt=textOf(el).toLowerCase();
      if(txt.includes('cookie')||txt.includes('consent')||txt.includes('gdpr')||txt.includes('privacy')){
        el.style.setProperty('display','none','important');
        document.body.style.overflow='';
        R.bannerFound=true; R.bannerClosed=true; R.cmpMethod=R.cmpMethod||'banner-hide';
        R.unchecked.push({label:'Privacy dialog hidden (CSS)',category:'Banner Action',type:'hide'});
        return true;
      }
    }
    return false;
  }

  /**
   * After Phase 0.5 closes main banner, scrape toggles from any remaining visible privacy panels
   * (e.g., child modals with legitimate interests/consents that were opened via "learn more")
   */
  function scrapeTogglesFromRemainingPanels() {
    try {
      // Find all currently visible modal-like elements
      const allPanels = findAllModals();
      
      let totalScraped = 0;
      for (const panel of allPanels) {
        if (!isVisible(panel)) continue;
        
        // Check if this panel has privacy-related toggles
        const togglesInPanel = panel.querySelectorAll(
          'input[type="checkbox"],[role="switch"],[role="checkbox"]'
        );
        
        if (togglesInPanel.length === 0) continue;
        
        // Check if panel contains privacy-related text
        const panelText = textOf(panel).toLowerCase();
        const hasPrivacyContent = 
          panelText.includes('legitimate interest') ||
          panelText.includes('consent') ||
          panelText.includes('vendor') ||
          panelText.includes('partner') ||
          panelText.includes('cookie') ||
          panelText.includes('tracking') ||
          panelText.includes('purpose') ||
          panelText.includes('special feature');
        
        if (!hasPrivacyContent) continue;
        
        // This panel has privacy toggles - scrape them!
        console.log(`[DenyStealthCookies] Post-Phase-0.5: Found remaining privacy panel with ${togglesInPanel.length} toggles`);
        logAction(`Post-Phase-0.5: Scraping toggles from remaining panel (${togglesInPanel.length} found)`);
        
        const scraped = scrapeToggles('Child Panel (Post-Close)', panel);
        totalScraped += scraped;
        
        if (scraped > 0) {
          console.log(`[DenyStealthCookies] Post-Phase-0.5: Unchecked ${scraped} toggles from remaining panel`);
        }
      }
      
      if (totalScraped > 0) {
        logAction(`✓ Post-Phase-0.5: Captured ${totalScraped} additional toggles from child panels`);
        
        // Try to confirm/save changes if toggles were found and unchecked
        const confirmed = tryConfirm();
        if (confirmed) {
          logAction('✓ Post-Phase-0.5: Changes saved successfully');
        }
      }
      
      return totalScraped;
    } catch (err) {
      console.error('[DenyStealthCookies] Error scraping remaining panels:', err);
      return 0;
    }
  }

  // ── Main ───────────────────────────────────────────────────────────────────
  async function runDeny() {
    R = freshResults();
    operationStartTime = Date.now();
    logAction('Starting consent denial operation');
    
    // Load learned patterns from storage
    await loadLearnedPatterns();
    
    const cmps = detectCMPs();
    R.cmpDetected = cmps.length>0 ? cmps.join(', ') : null;
    logAction(`CMP detection: ${R.cmpDetected || 'No standard CMP detected'}`);
    
    // If a CMP is detected, mark banner as found (even if we can't close it later)
    if (R.cmpDetected) {
      R.bannerFound = true;
    }
    // Early consent-or-pay detection
    detectConsentOrPay();
    if (R.consentOrPay) {
      logAction('⚠️ Aborting: Consent-or-pay scenario detected. User action required.');
      R.errors.push({label: 'Consent or Pay Wall', error: 'Site requires acceptance or paid subscription. Extension avoided auto-denying to prevent access issues.'});
      return R;  // Exit early to avoid locking user out
    }

    try {
      // Phase 0: Try learned patterns first (highest confidence)
      logAction('Phase 0: Trying learned patterns from previous visits');
      const learnedWorked = await tryLearnedPatterns();
      if (learnedWorked) {
        logAction('✓ Phase 0 successful: Learned pattern worked!');
        return R; // Exit early if learned pattern worked
      }
      
      // Phase 0.5: Universal modal detection (semantic analysis - works on most sites)
      logAction('Phase 0.5: Attempting universal modal detection');
      const universalWorked = await handleUniversalModal();
      if (universalWorked && R.bannerClosed) {
        logAction('✓ Phase 0.5 successful: Universal detection handled modal!');
        
        // Before returning early, check for remaining privacy panels with toggles
        // (e.g., child modals with legitimate interests/consents from "learn more" buttons)
        await sleep(500); // Brief wait for any child panels to stabilize
        const additionalToggles = scrapeTogglesFromRemainingPanels();
        
        if (additionalToggles > 0) {
          logAction(`✓ Phase 0.5: Captured ${additionalToggles} additional toggles from child panels`);
        }
        
        return R; // Exit early if universal detection closed the banner
      }
      
      // Phase 1: Try clicking a Deny/Reject All button (pattern-based fallback)
      logAction('Phase 1: Attempting direct deny button click (pattern-based)');
      const denied = await tryDenyButton(true); // Enable learning
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
    
    // Log summary to console
    if (R.bannerClosed) {
      console.log(`[DenyStealthCookies] ✅ SUCCESS: Banner closed via ${R.cmpMethod}`);
    } else if (R.bannerFound) {
      console.log(`[DenyStealthCookies] ⚠️ Banner found but not closed. ${R.unchecked.length} cookies denied.`);
    } else {
      console.log(`[DenyStealthCookies] ℹ️ No banner detected on this page.`);
    }

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

      console.log('[DenyStealthCookies] Auto-mode enabled, watching for CMPs...');

      // Strategy 1: Check if CMP is already visible (with retries for slow-loading CMPs)
      let cmpDetected = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const cmps = detectCMPs();
        if (cmps.length > 0) {
          console.log(`[DenyStealthCookies] CMP detected on attempt ${attempt + 1}:`, cmps.join(', '));
          cmpDetected = true;
          
          // Wait longer for Usercentrics (known to be slow)
          const hasUsercentrics = cmps.some(cmp => cmp === 'Usercentrics');
          const waitTime = hasUsercentrics ? 3000 : 1500;
          console.log(`[DenyStealthCookies] Waiting ${waitTime}ms for CMP to fully render...`);
          await sleep(waitTime);
          
          console.log(`[DenyStealthCookies] Starting denial operation...`);
          const result = await runDeny();
          console.log(`[DenyStealthCookies] Denial operation complete.`);
          showAutoModeNotification(result);
          return;
        }
        // Wait before retry (longer for later attempts)
        if (attempt < 4) await sleep(attempt < 2 ? 800 : 1500);
      }
      
      if (!cmpDetected) {
        // Use universal detection to find any modal/overlay with privacy content
        console.log('[DenyStealthCookies] No specific CMP detected, trying universal modal detection...');
        const modals = findAllModals();
        
        if (modals.length > 0) {
          console.log(`[DenyStealthCookies] Found ${modals.length} modal(s), checking if privacy-related...`);
          
          for (const modal of modals) {
            if (isPrivacyModal(modal)) {
              console.log('[DenyStealthCookies] Privacy modal detected by universal detection, attempting denial...');
              await sleep(1200);
              const result = await runDeny();
              showAutoModeNotification(result);
              return;
            }
          }
        }
        
        // Aggressive fallback: Look for cookie-related buttons anywhere on page
        console.log('[DenyStealthCookies] No modal detected, scanning for standalone cookie buttons...');
        const allButtons = Array.from(document.querySelectorAll('button,[role="button"],a[class*="btn"]')).filter(isVisible);
        const cookieButtons = allButtons.filter(btn => {
          const text = textOf(btn).toLowerCase();
          const id = btn.id?.toLowerCase() || '';
          const cls = String(btn.className || '').toLowerCase();
          
          // Check if button or its container mentions cookies
          const mentionsCookies = text.includes('cookie') || text.includes('consent') || 
                                  id.includes('cookie') || id.includes('consent') ||
                                  cls.includes('cookie') || cls.includes('consent');
          
          // Check if it's a reject/accept action
          const isAction = /\b(reject|accept|agree|decline|allow|deny)\b/i.test(text);
          
          return mentionsCookies && isAction;
        });
        
        if (cookieButtons.length > 0) {
          console.log(`[DenyStealthCookies] Found ${cookieButtons.length} standalone cookie button(s), attempting denial...`);
          await sleep(1200);
          const result = await runDeny();
          showAutoModeNotification(result);
          return;
        }
      }

      console.log('[DenyStealthCookies] No CMP detected yet, setting up observer...');

      // Strategy 2: Watch for CMP elements to appear (smart detection)
      let hasRun = false;
      let detectionAttempts = 0;
      const maxAttempts = 3;
      const observerStartTime = Date.now();
      
      autoModeObserver = new MutationObserver(async (mutations) => {
        if (hasRun || teachingMode) return; // Skip if already run or in teaching mode
        
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
            const cls = String(el.className || '').toLowerCase();
            
            // Enhanced CMP pattern detection
            const hasCmpPattern = 
              // ID patterns
              id.includes('cookie') || id.includes('consent') || id.includes('cmp') || id.includes('gdpr') ||
              id.includes('onetrust') || id.includes('cookiebot') || id.includes('quantcast') || 
              id.includes('didomi') || id.includes('usercentrics') || id.includes('truste') || id.startsWith('uc-') ||
              // Class patterns
              cls.includes('cookie') || cls.includes('consent') || cls.includes('cmp') || cls.includes('gdpr') ||
              cls.includes('onetrust') || cls.includes('cookiebot') || cls.includes('quantcast') ||
              cls.includes('didomi') || cls.includes('usercentrics') || cls.includes('banner') || cls.includes('uc-') ||
              cls.includes('modal') || cls.includes('overlay') || cls.includes('popup') ||
              // Dialog/modal patterns
              el.getAttribute('role') === 'dialog' || el.getAttribute('role') === 'alertdialog' ||
              el.getAttribute('aria-modal') === 'true' || el.tagName === 'DIALOG' ||
              // Deep search for CMP elements
              el.querySelector('[id*="cookie"],[id*="consent"],[class*="cookie"],[class*="consent"],[id*="cmp"],[class*="cmp"]');
            
            // Also use universal detection for privacy modals
            const isPotentialPrivacyModal = isPrivacyModal(el);
            
            if (hasCmpPattern || isPotentialPrivacyModal) {
              hasRun = true;
              autoModeObserver.disconnect();
              autoModeObserver = null;
              
              // Check if it's Usercentrics (needs more time to fully load)
              const isUsercentrics = id.includes('usercentrics') || cls.includes('usercentrics') || 
                                    id.startsWith('uc-') || cls.includes('uc-');
              const waitTime = isUsercentrics ? 2000 : 1200;
              
              const detectionType = isPotentialPrivacyModal ? 'Privacy modal (universal)' : 'CMP element';
              console.log(`[DenyStealthCookies] ${detectionType} appeared in DOM` + 
                         (isUsercentrics ? ' (Usercentrics - waiting longer)' : '') + 
                         ', triggering auto-deny...');
              await sleep(waitTime);
              const result = await runDeny();
              showAutoModeNotification(result);
              
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

      // Fallback: Stop observing after 20 seconds if nothing found
      setTimeout(() => {
        if (!hasRun && autoModeObserver) {
          console.log('[DenyStealthCookies] Auto-mode timeout - no CMP detected after 20 seconds');
          autoModeObserver.disconnect();
          autoModeObserver = null;
        }
      }, 20000);

    } catch(err){
      console.error('[DenyStealthCookies] Auto-mode error:', err);
    }
  }
  checkAutoMode();

  // Cleanup observer on page navigation/unload
  window.addEventListener('beforeunload', () => {
    if (autoModeObserver) {
      autoModeObserver.disconnect();
      autoModeObserver = null;
    }
  });

  // ── Teaching Mode ──────────────────────────────────────────────────────────
  let teachingOverlay = null;
  let teachingClickHandler = null;
  
  function enterTeachingMode() {
    if (teachingMode) return; // Already in teaching mode
    
    teachingMode = true;
    logAction('Entering teaching mode');
    
    // Disable auto-mode observer during teaching mode to prevent cascade
    if (autoModeObserver) {
      autoModeObserver.disconnect();
      autoModeObserver = null;
      console.log('[DenyStealthCookies] Auto-mode observer disabled during teaching mode');
    }
    
    // Create overlay with instructions (non-blocking)
    teachingOverlay = document.createElement('div');
    teachingOverlay.id = 'denystealth-teaching-overlay';
    teachingOverlay.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        font-family: system-ui, -apple-system, sans-serif;
        animation: slideIn 0.3s ease-out;
      ">
        <div style="
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px 24px;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          max-width: 320px;
          color: white;
        ">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <span style="font-size: 24px;">🎯</span>
            <h2 style="margin: 0; font-size: 16px; font-weight: 600;">
              Teaching Mode Active
            </h2>
          </div>
          <p style="margin: 0 0 16px 0; font-size: 13px; line-height: 1.5; opacity: 0.95;">
            Click any button on the page to teach the extension. I'll learn which button you clicked and use it automatically next time.
          </p>
          <button id="denystealth-cancel-teaching" style="
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.3);
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            width: 100%;
            transition: background 0.2s;
          ">
            Cancel Teaching
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(teachingOverlay);
    
    // Add cancel button handlers
    const cancelBtn = document.getElementById('denystealth-cancel-teaching');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', exitTeachingMode);
      // Add hover effect via event listeners (CSP-compliant)
      cancelBtn.addEventListener('mouseover', () => {
        cancelBtn.style.background = 'rgba(255,255,255,0.3)';
      });
      cancelBtn.addEventListener('mouseout', () => {
        cancelBtn.style.background = 'rgba(255,255,255,0.2)';
      });
    }
    
    // Add click handler to capture user's selection
    teachingClickHandler = async (e) => {
      // Only capture clicks on buttons/links
      const target = e.target.closest('button,[role="button"],a');
      if (!target || target.closest('#denystealth-teaching-overlay')) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const text = textOf(target);
      const selector = getUniqueSelector(target);
      
      console.log('[DenyStealthCookies] Teaching mode: Captured button click:', { text, selector });
      
      // Save the learned pattern
      const domain = getDomainKey(window.location.href);
      if (domain) {
        await saveLearnedPattern(domain, {
          text: text,
          selector: selector,
          method: 'user-taught'
        });
        
        console.log('[DenyStealthCookies] Pattern saved for domain:', domain);
        
        // Notify popup/background that teaching was successful
        try {
          chrome.runtime.sendMessage({ 
            type: 'TEACHING_COMPLETE',
            domain: domain,
            pattern: { text, selector }
          });
        } catch (err) {
          console.log('[DenyStealthCookies] Could not notify about teaching completion:', err);
        }
        
        // Show success message
        showTeachingSuccess(text);
        
        // Try to click the actual button to close the banner
        try {
          clickElement(target);
          logAction(`Teaching mode: Clicked user-taught button "${text}"`);
        } catch (err) {
          console.error('[DenyStealthCookies] Failed to click taught button:', err);
        }
        
        // Exit teaching mode after a delay
        setTimeout(exitTeachingMode, 2500);
      }
    };
    
    document.addEventListener('click', teachingClickHandler, true);
  }
  
  function exitTeachingMode() {
    if (!teachingMode) return;
    
    teachingMode = false;
    logAction('Exiting teaching mode');
    
    if (teachingOverlay) {
      teachingOverlay.remove();
      teachingOverlay = null;
    }
    
    if (teachingClickHandler) {
      document.removeEventListener('click', teachingClickHandler, true);
      teachingClickHandler = null;
    }
    
    // Re-enable auto-mode observer if auto-mode is on
    (async () => {
      try {
        const data = await new Promise(r => chrome.storage.local.get('autoMode', r));
        if (data.autoMode) {
          console.log('[DenyStealthCookies] Re-enabling auto-mode observer after teaching mode');
          checkAutoMode();
        }
      } catch(err) {
        console.log('[DenyStealthCookies] Could not check auto-mode status:', err);
      }
    })();
  }
  
  function showAutoModeNotification(result) {
    const isSuccess = result.bannerClosed;
    const isDenied = result.unchecked && result.unchecked.length > 0;
    const isError = result.errors && result.errors.length > 0;
    
    let icon, title, message, bgGradient;
    
    if (isSuccess) {
      icon = '✅';
      title = 'Auto-Mode Success';
      message = `Blocked ${result.unchecked.length} tracking cookies`;
      bgGradient = 'linear-gradient(135deg, #27ae60 0%, #2ecc71 100%)';
    } else if (isDenied) {
      icon = '⚠️';
      title = 'Partially Complete';
      message = `Blocked ${result.unchecked.length} cookies, banner still visible`;
      bgGradient = 'linear-gradient(135deg, #f39c12 0%, #f1c40f 100%)';
    } else if (result.consentOrPay) {
      icon = '🔒';
      title = 'Consent-or-Pay Detected';
      message = 'Requires manual action - check popup for details';
      bgGradient = 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)';
    } else {
      icon = 'ℹ️';
      title = 'Auto-Mode Complete';
      message = 'No cookie banner detected';
      bgGradient = 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)';
    }
    
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${bgGradient};
      color: white;
      padding: 16px 20px;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      z-index: 2147483648;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      max-width: 320px;
      animation: slideInRight 0.3s ease-out;
    `;
    
    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 24px;">${icon}</span>
        <div>
          <div style="font-weight: 600; margin-bottom: 4px;">${title}</div>
          <div style="opacity: 0.95; font-size: 12px;">${message}</div>
        </div>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
      notification.style.transition = 'opacity 0.3s, transform 0.3s';
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(20px)';
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  }
  
  function showTeachingSuccess(buttonText) {
    const successMsg = document.createElement('div');
    successMsg.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
      color: white;
      padding: 18px 28px;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(39, 174, 96, 0.3);
      z-index: 2147483648;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      text-align: center;
      animation: slideInDown 0.4s ease-out;
      min-width: 280px;
    `;
    successMsg.innerHTML = `
      <div style="font-size: 28px; margin-bottom: 8px;">✓</div>
      <strong style="font-size: 15px;">Pattern Learned!</strong><br>
      <span style="opacity: 0.9; font-size: 13px;">Button: "${buttonText.substring(0, 40)}${buttonText.length > 40 ? '...' : ''}"</span><br>
      <span style="opacity: 0.8; font-size: 12px; margin-top: 8px; display: block;">Will be used automatically next time</span>
    `;
    
    document.body.appendChild(successMsg);
    
    setTimeout(() => {
      successMsg.style.animation = 'slideOutUp 0.3s ease-in';
      setTimeout(() => successMsg.remove(), 300);
    }, 2500);
  }

  // ── Message listener ──────────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if (msg.type==='PING') {
      // Quick health check to see if content script is ready
      sendResponse({ ready: true, version: VERSION });
      return true;
    }
    
    if (msg.type==='ENTER_TEACHING_MODE') {
      enterTeachingMode();
      sendResponse({ success: true, teachingMode: true });
      return true;
    }
    
    if (msg.type==='EXIT_TEACHING_MODE') {
      exitTeachingMode();
      sendResponse({ success: true, teachingMode: false });
      return true;
    }
    
    if (msg.type==='GET_LEARNED_PATTERNS') {
      // Always reload from storage to get the latest patterns
      loadLearnedPatterns().then(() => {
        const domain = getDomainKey(window.location.href);
        const patterns = domain && learnedPatterns ? learnedPatterns[domain] : null;
        console.log('[DenyStealthCookies] Sending learned patterns for', domain, ':', patterns);
        sendResponse({ domain, patterns });
      }).catch(err => {
        console.error('[DenyStealthCookies] Error loading patterns:', err);
        sendResponse({ domain: null, patterns: null });
      });
      return true; // Keep channel open for async response
    }
        
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
