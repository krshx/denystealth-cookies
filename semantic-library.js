/**
 * DenyStealthCookies - Comprehensive Semantic Button Library
 * 
 * This library contains patterns to identify cookie consent buttons across
 * all CMPs, languages, and dark pattern variations. Updated based on:
 * - Real-world CMP analysis (OneTrust, Usercentrics, Cookiebot, etc.)
 * - GDPR/CCPA compliance research
 * - Dark pattern studies
 * - Multilingual cookie consent requirements
 * 
 * @version 2.0.0
 * @date 2026-02-25
 */

const SemanticLibrary = {
  
  /**
   * DENY/REJECT PATTERNS
   * Buttons that decline non-essential cookies.
   * Includes dark patterns like "No thanks", "Continue without accepting"
   */
  DENY_PATTERNS: {
    
    // English - Primary deny actions
    english_direct: [
      /^deny( all)?$/i,
      /^reject( all)?$/i,
      /^refuse( all)?$/i,
      /^decline( all)?$/i,
      /^object( all)?$/i,
      /^object to all$/i,
      /^disagree( all)?$/i,
    ],
    
    // English - Contextual deny phrases
    english_contextual: [
      /^no[,.]?\s*thanks?$/i,
      /^no thank you$/i,
      /^skip$/i,
      /^dismiss$/i,
      /^not now$/i,
      /^maybe later$/i,
      /^later$/i,
    ],
    
    // English - Essential/necessary only (implies rejection of others)
    english_essential: [
      /^(only|just)\s*(necessary|essential|required|functional)(\s*cookies?)?(\s*only)?$/i,
      /^(allow|use|accept)\s*(only\s*)?(necessary|essential|required|functional)(\s*cookies?)?\s*(only)?$/i,
      /^necessary\s*only$/i,
      /^essential\s*only$/i,
      /^strictly\s*necessary$/i,
    ],
    
    // English - Specific reject types
    english_specific: [
      /^reject\s+(additional|all|non-essential|optional|tracking|analytics|marketing|advertising|non-necessary)(\s*cookies?)?$/i,
      /^decline\s+(additional|all|non-essential|optional|tracking|analytics|marketing)(\s*cookies?)?$/i,
      /^deny\s+(additional|all|non-essential|optional)(\s*cookies?)?$/i,
      /^refuse\s+(additional|all|non-essential|optional)(\s*cookies?)?$/i,
    ],
    
    // English - Continue/proceed without
    english_without: [
      /^continue\s+without\s+(accepting|agreeing|consenting|cookies?)$/i,
      /^proceed\s+without\s+(accepting|consenting)$/i,
      /^browse\s+without\s+(accepting|cookies)$/i,
      /^go\s+without$/i,
    ],
    
    // English - Explicit negative consent
    english_negative: [
      /^(i\s+)?(do\s+not|don'?t)\s+(accept|consent|agree)$/i,
      /^opt\s+out(\s+of\s+all)?$/i,
      /^withdraw(\s+all)?(\s+consent)?$/i,
      /^I\s+do\s+not\s+agree$/i,
    ],
    
    // French - Reject patterns
    french: [
      /^refuser(\s+tout)?$/i,
      /^tout\s+refuser$/i,
      /^rejeter(\s+tout)?$/i,
      /^non\s+merci$/i,
      /^continuer\s+sans\s+accepter$/i,
      /^décliner$/i,
      /^ne\s+pas\s+accepter$/i,
      /^uniquement\s+(nécessaire|essentiel)s?$/i,
    ],
    
    // German - Reject patterns
    german: [
      /^ablehnen$/i,
      /^alle\s+ablehnen$/i,
      /^zurückweisen$/i,
      /^verweigern$/i,
      /^nein\s+danke$/i,
      /^nur\s+(notwendige|erforderliche|essentielle)(\s*cookies?)?$/i,
      /^ohne\s+akzeptieren\s+fortfahren$/i,
      /^nicht\s+zustimmen$/i,
    ],
    
    // Spanish - Reject patterns
    spanish: [
      /^rechazar(\s+todo)?$/i,
      /^rechazar\s+todas?$/i,
      /^denegar$/i,
      /^declinar$/i,
      /^no\s+gracias$/i,
      /^solo\s+(necesarias|esenciales)$/i,
      /^continuar\s+sin\s+aceptar$/i,
      /^no\s+aceptar$/i,
    ],
    
    // Italian - Reject patterns
    italian: [
      /^rifiuta(\s+tutto)?$/i,
      /^rifiutare(\s+tutt[oi])?$/i,
      /^nega$/i,
      /^declina$/i,
      /^no\s+grazie$/i,
      /^solo\s+(necessari|essenziali)$/i,
      /^continua\s+senza\s+accettare$/i,
      /^non\s+accettare$/i,
    ],
    
    // Portuguese - Reject patterns
    portuguese: [
      /^rejeitar(\s+tudo)?$/i,
      /^recusar(\s+tudo)?$/i,
      /^negar$/i,
      /^não\s+obrigad[oa]$/i,
      /^apenas\s+(necessários|essenciais)$/i,
      /^continuar\s+sem\s+aceitar$/i,
      /^não\s+aceitar$/i,
    ],
    
    // Dutch - Reject patterns
    dutch: [
      /^afwijzen$/i,
      /^weigeren$/i,
      /^alles\s+afwijzen$/i,
      /^nee\s+bedankt$/i,
      /^alleen\s+(noodzakelijke|essentiële)(\s*cookies?)?$/i,
      /^niet\s+accepteren$/i,
      /^doorgaan\s+zonder\s+te\s+accepteren$/i,
    ],
    
    // Danish - Reject patterns
    danish: [
      /^afvis$/i,
      /^afvis\s+alle$/i,
      /^nej\s+tak$/i,
      /^kun\s+(nødvendige|essentielle)$/i,
      /^fortsæt\s+uden\s+at\s+acceptere$/i,
    ],
    
    // Swedish - Reject patterns
    swedish: [
      /^avvisa$/i,
      /^avvisa\s+alla$/i,
      /^nej\s+tack$/i,
      /^endast\s+(nödvändiga|väsentliga)$/i,
      /^fortsätt\s+utan\s+att\s+acceptera$/i,
    ],
    
    // Norwegian - Reject patterns
    norwegian: [
      /^avvis$/i,
      /^avvis\s+alle$/i,
      /^nei\s+takk$/i,
      /^kun\s+(nødvendige|essensielle)$/i,
      /^fortsett\s+uten\s+å\s+akseptere$/i,
    ],
    
    // Finnish - Reject patterns
    finnish: [
      /^hylkää$/i,
      /^hylkää\s+kaikki$/i,
      /^ei\s+kiitos$/i,
      /^vain\s+(välttämättömät|tarpeelliset)$/i,
      /^jatka\s+hyväksymättä$/i,
    ],
    
    // Polish - Reject patterns
    polish: [
      /^odrzuć$/i,
      /^odrzuć\s+wszystko$/i,
      /^nie\s+dziękuję$/i,
      /^tylko\s+(niezbędne|konieczne)$/i,
      /^kontynuuj\s+bez\s+akceptacji$/i,
    ],
    
    // Czech - Reject patterns
    czech: [
      /^odmítnout$/i,
      /^odmítnout\s+vše$/i,
      /^ne\s+děkuji$/i,
      /^pouze\s+(nezbytné|nutné)$/i,
    ],
    
    // Romanian - Reject patterns
    romanian: [
      /^respinge$/i,
      /^respinge\s+tot$/i,
      /^nu\s+mulțumesc$/i,
      /^doar\s+(necesare|esențiale)$/i,
    ],
    
    // Greek - Reject patterns
    greek: [
      /^απόρριψη$/i,
      /^απόρριψη\s+όλων$/i,
      /^όχι\s+ευχαριστώ$/i,
      /^μόνο\s+(απαραίτητα|αναγκαία)$/i,
    ],
    
    // Hungarian - Reject patterns
    hungarian: [
      /^elutasít$/i,
      /^mindent\s+elutasít$/i,
      /^nem\s+köszönöm$/i,
      /^csak\s+(szükséges|alapvető)$/i,
    ],
  },
  
  /**
   * MANAGE/SETTINGS PATTERNS
   * Buttons that open preferences panel.
   * Includes variations like "Customize", "Learn more", "More options", "Click here"
   */
  MANAGE_PATTERNS: {
    
    // English - Manage/settings
    english_manage: [
      /^manage(\s+cookies?)?(\s+(preferences?|settings?|choices?|options?))?$/i,
      /^customize(\s+cookies?)?(\s+(preferences?|settings?|choices?))?$/i,
      /^settings?$/i,
      /^preferences?$/i,
      /^options?$/i,
      /^choices?$/i,
      /^cookie\s+(settings?|preferences?|options?|choices?)$/i,
      /^privacy\s+(settings?|preferences?|options?)$/i,
    ],
    
    // English - Learn/view more
    english_learn: [
      /^learn\s+more$/i,
      /^more\s+(information|info|details|options?)$/i,
      /^show\s+(more|details|options?)$/i,
      /^view\s+(cookie\s*)?(settings?|preferences?|details?|options?)$/i,
      /^see\s+(details|options)$/i,
      /^details?$/i,
    ],
    
    // English - Click here variants (dark pattern)
    english_click: [
      /^click\s+here$/i,
      /^click\s+here\s+to\s+(manage|customize|change|update)$/i,
      /^click\s+for\s+(more|details|options)$/i,
      /^here$/i,
    ],
    
    // English - Change/edit
    english_edit: [
      /^change(\s+my)?(\s+(settings?|preferences?|choices?))?$/i,
      /^edit(\s+(settings?|preferences?))?$/i,
      /^update(\s+(preferences?|settings?))?$/i,
      /^modify(\s+(settings?|preferences?))?$/i,
      /^adjust(\s+(settings?|preferences?))?$/i,
    ],
    
    // English - Advanced/granular
    english_advanced: [
      /^advanced\s+(settings?|options?)$/i,
      /^granular\s+control$/i,
      /^detailed\s+(settings?|preferences?)$/i,
      /^individual\s+(settings?|preferences?)$/i,
    ],
    
    // French - Manage patterns
    french: [
      /^gérer(\s+(les\s+)?cookies?)?(\s+(préférences?|paramètres?))?$/i,
      /^personnaliser(\s+(les\s+)?cookies?)?$/i,
      /^paramètres?$/i,
      /^préférences?$/i,
      /^en\s+savoir\s+plus$/i,
      /^plus\s+d'?options?$/i,
      /^cliquez\s+ici$/i,
      /^modifier(\s+(les\s+)?paramètres?)?$/i,
    ],
    
    // German - Manage patterns
    german: [
      /^verwalten$/i,
      /^cookie(-|\s+)?einstellungen$/i,
      /^einstellungen(\s+verwalten)?$/i,
      /^präferenzen$/i,
      /^anpassen$/i,
      /^mehr\s+(erfahren|informationen?)$/i,
      /^hier\s+klicken$/i,
      /^optionen$/i,
      /^ändern$/i,
    ],
    
    // Spanish - Manage patterns
    spanish: [
      /^administrar(\s+cookies?)?(\s+(preferencias?|configuración))?$/i,
      /^gestionar(\s+cookies?)?$/i,
      /^personalizar(\s+cookies?)?$/i,
      /^configuración$/i,
      /^preferencias?$/i,
      /^más\s+(información|opciones)$/i,
      /^saber\s+más$/i,
      /^haz\s+clic\s+aquí$/i,
      /^opciones?$/i,
    ],
    
    // Italian - Manage patterns
    italian: [
      /^gestisci(\s+(i\s+)?cookies?)?(\s+(preferenze|impostazioni))?$/i,
      /^personalizza(\s+(i\s+)?cookies?)?$/i,
      /^impostazioni$/i,
      /^preferenze$/i,
      /^maggiori\s+informazioni$/i,
      /^più\s+opzioni$/i,
      /^clicca\s+qui$/i,
      /^opzioni$/i,
    ],
    
    // Portuguese - Manage patterns
    portuguese: [
      /^gerenciar(\s+cookies?)?(\s+(preferências?|configurações?))?$/i,
      /^gerenciar$/i,
      /^personalizar(\s+cookies?)?$/i,
      /^configurações?$/i,
      /^preferências?$/i,
      /^saber\s+mais$/i,
      /^mais\s+(informações?|opções)$/i,
      /^clique\s+aqui$/i,
      /^opções?$/i,
    ],
    
    // Dutch - Manage patterns
    dutch: [
      /^beheren(\s+cookies?)?(\s+voorkeuren?)?$/i,
      /^aanpassen$/i,
      /^instellingen$/i,
      /^voorkeuren$/i,
      /^meer\s+(informatie|opties)$/i,
      /^klik\s+hier$/i,
      /^opties$/i,
    ],
    
    // Other languages - common manage words
    multilingual: [
      /^(gestionar|gerenciar|zarządzaj|spravovat|gestionare)$/i, // Manage
      /^(ajustes|nastavení|impostazioni|inställningar)$/i, // Settings
      /^(préférences?|preferenze|voorkeuren|предпочтения)$/i, // Preferences
    ],
  },
  
  /**
   * CONFIRM/SAVE PATTERNS
   * Buttons that save preferences after user unchecks toggles.
   */
  CONFIRM_PATTERNS: {
    
    english: [
      /^save(\s+my)?(\s+(preferences?|choices?|settings?|selection))?$/i,
      /^confirm(\s+my)?(\s+(choices?|selection|preferences?|settings?))?$/i,
      /^(accept|allow)(\s+my)?\s+selection$/i,
      /^apply(\s+settings?)?$/i,
      /^update(\s+preferences?)?$/i,
      /^submit$/i,
      /^done$/i,
      /^got\s+it$/i,
      /^close$/i,
      /^dismiss$/i,
      /^(ok|okay)$/i,
      /^continue$/i,
      /^proceed$/i,
    ],
    
    french: [
      /^enregistrer(\s+(mes\s+)?(choix|préférences?))?$/i,
      /^valider$/i,
      /^confirmer$/i,
      /^appliquer$/i,
      /^continuer$/i,
      /^fermer$/i,
    ],
    
    german: [
      /^speichern$/i,
      /^bestätigen$/i,
      /^übernehmen$/i,
      /^anwenden$/i,
      /^weiter$/i,
      /^fortfahren$/i,
      /^schließen$/i,
    ],
    
    spanish: [
      /^guardar(\s+(mis\s+)?(preferencias?|opciones))?$/i,
      /^confirmar$/i,
      /^aplicar$/i,
      /^continuar$/i,
      /^cerrar$/i,
    ],
    
    italian: [
      /^salva(re)?(\s+(le\s+mie\s+)?(preferenze|impostazioni))?$/i,
      /^confermare?$/i,
      /^applica(re)?$/i,
      /^continua(re)?$/i,
      /^chiudi(re)?$/i,
    ],
    
    portuguese: [
      /^salvar(\s+(minhas\s+)?(preferências?|opções))?$/i,
      /^confirmar$/i,
      /^aplicar$/i,
      /^continuar$/i,
      /^fechar$/i,
    ],
    
    dutch: [
      /^opslaan$/i,
      /^bevestigen$/i,
      /^toepassen$/i,
      /^doorgaan$/i,
      /^sluiten$/i,
    ],
  },
  
  /**
   * ACCEPT PATTERNS (NEGATIVE - We want to AVOID these)
   * Buttons that accept all cookies. Used to exclude false positives.
   */
  ACCEPT_PATTERNS: {
    
    english: [
      /^accept(\s+all)?(\s+cookies?)?$/i,
      /^agree(\s+and\s+close)?$/i,
      /^allow(\s+all)?(\s+cookies?)?$/i,
      /^consent$/i,
      /^(i\s+)?(understand|got\s+it)$/i,
      /^yes(\s*,)?\s*(i\s+)?(accept|agree|allow)$/i,
    ],
    
    french: [
      /^accepter(\s+tout)?$/i,
      /^tout\s+accepter$/i,
      /^autoriser(\s+tout)?$/i,
      /^j'?accepte$/i,
      /^d'?accord$/i,
    ],
    
    german: [
      /^akzeptieren$/i,
      /^alle\s+akzeptieren$/i,
      /^zustimmen$/i,
      /^einverstanden$/i,
      /^ich\s+stimme\s+zu$/i,
    ],
    
    spanish: [
      /^aceptar(\s+todo)?$/i,
      /^aceptar\s+todas?$/i,
      /^permitir(\s+todo)?$/i,
      /^estoy\s+de\s+acuerdo$/i,
      /^de\s+acuerdo$/i,
    ],
    
    italian: [
      /^accetta(re)?(\s+tutt[oi])?$/i,
      /^accettare\s+tutt[oi]$/i,
      /^consenti(re)?$/i,
      /^autorizza(re)?$/i,
      /^sono\s+d'?accordo$/i,
    ],
    
    portuguese: [
      /^aceitar(\s+tudo)?$/i,
      /^aceitar\s+todos$/i,
      /^permitir(\s+tudo)?$/i,
      /^concordo$/i,
      /^estou\s+de\s+acordo$/i,
    ],
    
    dutch: [
      /^accepteren$/i,
      /^alles\s+accepteren$/i,
      /^toestaan$/i,
      /^akkoord$/i,
      /^ik\s+ga\s+akkoord$/i,
    ],
  },
  
  /**
   * MANDATORY KEYWORDS
   * These indicate essential/necessary cookies that should NOT be unchecked.
   */
  MANDATORY_KEYWORDS: [
    'strictly necessary',
    'strictly-necessary',
    'essential',
    'necessary cookies',
    'technically required',
    'technically necessary',
    'basic functionality',
    'security',
    'fraud prevention',
    'detect fraud',
    'ensure security',
    'fix errors',
    'deliver content',
    'technically deliver',
    'functional',
    'prevent fraud',
    'system security',
    'required',
    'mandatory',
    'performance of contract',
    'legal obligation',
    'vital interests',
    'deliver and present',
    'technical compatibility',
    'transmission of content',
    // Multilingual equivalents
    'strikt notwendig', // German
    'strictement nécessaire', // French
    'estrictamente necesario', // Spanish
    'strettamente necessario', // Italian
    'estritamente necessário', // Portuguese
    'strikt noodzakelijk', // Dutch
  ],
  
  /**
   * Helper function: Check if text matches any pattern in a category
   * Also checks custom learned patterns if available
   */
  matchesPatterns(text, patternCategory) {
    if (!text || typeof text !== 'string') return false;
    
    const normalized = text.trim();
    
    // If patternCategory is an object with subcategories, check all
    if (typeof patternCategory === 'object' && !Array.isArray(patternCategory)) {
      for (const subCategory of Object.values(patternCategory)) {
        if (Array.isArray(subCategory) && subCategory.some(p => p.test(normalized))) {
          return true;
        }
      }
      return false;
    }
    
    // Otherwise assume it's an array of patterns
    if (Array.isArray(patternCategory)) {
      return patternCategory.some(p => p.test(normalized));
    }
    
    return false;
  },
  
  /**
   * Custom patterns learned by the extension (loaded from storage)
   */
  customPatterns: {
    deny: [],
    manage: [],
    confirm: [],
    accept: []
  },
  
  /**
   * Load custom patterns from storage
   */
  async loadCustomPatterns() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get('customSemanticPatterns');
        if (result.customSemanticPatterns) {
          this.customPatterns = result.customSemanticPatterns;
          console.log('[SemanticLibrary] Loaded custom patterns:', {
            deny: this.customPatterns.deny?.length || 0,
            manage: this.customPatterns.manage?.length || 0,
            confirm: this.customPatterns.confirm?.length || 0,
            accept: this.customPatterns.accept?.length || 0
          });
        }
      }
    } catch (err) {
      console.error('[SemanticLibrary] Failed to load custom patterns:', err);
    }
  },
  
  /**
   * Check if text matches custom learned patterns
   */
  matchesCustomPatterns(text, category) {
    if (!this.customPatterns[category] || !Array.isArray(this.customPatterns[category])) {
      return false;
    }
    
    const normalized = text.toLowerCase().trim();
    
    return this.customPatterns[category].some(pattern => {
      // Pattern might be regex string or already contains the text
      if (pattern.text && normalized.includes(pattern.text)) {
        return true;
      }
      if (pattern.pattern) {
        try {
          // Parse regex string like "/\\bpattern\\b/i"
          const match = pattern.pattern.match(/^\/(.+)\/([gimu]*)$/);
          if (match) {
            const regex = new RegExp(match[1], match[2]);
            return regex.test(text);
          }
        } catch (err) {
          // Invalid regex, skip
        }
      }
      return false;
    });
  },
  
  /**
   * Classify button intent based on text content
   * Checks custom learned patterns FIRST before built-in patterns
   * @param {string} text - Button text or aria-label
   * @returns {'deny'|'accept'|'manage'|'confirm'|'unknown'}
   */
  classifyButton(text) {
    if (!text || typeof text !== 'string') return 'unknown';
    
    const normalized = text.trim();
    
    // PRIORITY 1: Check custom learned patterns first (highest priority)
    if (this.matchesCustomPatterns(normalized, 'deny')) {
      return 'deny';
    }
    if (this.matchesCustomPatterns(normalized, 'confirm')) {
      return 'confirm';
    }
    if (this.matchesCustomPatterns(normalized, 'manage')) {
      return 'manage';
    }
    if (this.matchesCustomPatterns(normalized, 'accept')) {
      // Make sure it's not "accept selection" (after customizing)
      if (!/\b(selection|my\s+(choices?|preferences?|settings?))\b/i.test(normalized)) {
        return 'accept';
      }
    }
    
    // PRIORITY 2: Check built-in patterns (standard library)
    // First check if it's an accept button (we want to avoid these)
    if (this.matchesPatterns(normalized, this.ACCEPT_PATTERNS)) {
      // But make sure it's not a false positive like "accept selection" (after customizing)
      if (!/\b(selection|my\s+(choices?|preferences?|settings?))\b/i.test(normalized)) {
        return 'accept';
      }
    }
    
    // Check for deny/reject patterns
    if (this.matchesPatterns(normalized, this.DENY_PATTERNS)) {
      // Make sure it's not a double negative like "do not reject"
      if (!/\bdo\s+not\s+(reject|deny|decline)\b/i.test(normalized)) {
        return 'deny';
      }
    }
    
    // Check for confirm/save patterns (after user customized settings)
    if (this.matchesPatterns(normalized, this.CONFIRM_PATTERNS)) {
      return 'confirm';
    }
    
    // Check for manage/settings patterns
    if (this.matchesPatterns(normalized, this.MANAGE_PATTERNS)) {
      return 'manage';
    }
    
    return 'unknown';
  },
  
  /**
   * Check if a toggle should be kept checked (mandatory/essential)
   */
  isMandatory(text) {
    if (!text || typeof text !== 'string') return false;
    
    const lowerText = text.toLowerCase();
    return this.MANDATORY_KEYWORDS.some(kw => lowerText.includes(kw.toLowerCase()));
  },
};

// Export for use in content.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SemanticLibrary;
}
