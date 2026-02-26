/**
 * Guardr - Learning Module
 * 
 * This module enables the Semantic Library to grow more intelligent over time
 * through self-learning and user teaching.
 * 
 * ARCHITECTURE:
 * - Per-domain patterns (fast, site-specific) - Already implemented in content.js
 * - Global learned patterns (shared across all sites) - NEW
 * - Semantic library updates (permanent additions) - NEW
 * - Confidence scoring (prioritize reliable patterns) - NEW
 * 
 * @version 2.1.0
 * @date 2026-02-26
 */

// ── Debug Configuration ────────────────────────────────────────────────────
// Set to false for production to disable all console logging
const DEBUG_LEARNING = true;
const logLearning = DEBUG_LEARNING ? console.log.bind(console) : () => {};

const LearningModule = {
  
  /**
   * Configuration
   */
  CONFIG: {
    MIN_CONFIDENCE_FOR_LIBRARY: 0.85,     // 85% confidence to add to semantic library
    MIN_USAGE_COUNT_FOR_LIBRARY: 10,      // Must work on 10+ sites before adding
    PATTERN_EXPIRY_DAYS: 180,             // 6 months
    MAX_LEARNED_PATTERNS_GLOBAL: 500,     // Max patterns in global learning storage
    SYNC_TO_LIBRARY_INTERVAL_MS: 7 * 24 * 60 * 60 * 1000, // Sync weekly
  },
  
  /**
   * Global learned patterns (shared across all domains)
   * Structure:
   * {
   *   buttonText: {
   *     text: "Learn more about cookies",
   *     normalizedText: "learn more",
   *     classification: "manage",
   *     confidence: 0.92,
   *     usageCount: 15,
   *     successCount: 14,
   *     domains: ["site1.com", "site2.com", ...],
   *     firstSeen: timestamp,
   *     lastUsed: timestamp,
   *     source: "auto-learned" | "user-taught"
   *   }
   * }
   */
  globalPatterns: {},
  
  /**
   * Initialize learning module
   */
  async init() {
    try {
      // Load global learned patterns from storage
      const result = await chrome.storage.local.get(['globalLearnedPatterns', 'lastLibrarySync']);
      this.globalPatterns = result.globalLearnedPatterns || {};
      this.lastLibrarySync = result.lastLibrarySync || 0;
      
      // Clean expired patterns
      this.cleanExpiredPatterns();
      
      // Check if it's time to sync to semantic library
      const now = Date.now();
      if (now - this.lastLibrarySync > this.CONFIG.SYNC_TO_LIBRARY_INTERVAL_MS) {
        await this.syncToSemanticLibrary();
      }
      
      logLearning(`[Learning] Initialized with ${Object.keys(this.globalPatterns).length} global patterns`);
      return true;
    } catch (err) {
      console.error('[Learning] Initialization failed:', err);
      return false;
    }
  },
  
  /**
   * Learn from a successful button detection
   * @param {string} buttonText - The button text that worked
   * @param {string} classification - What type it was (deny/manage/confirm)
   * @param {string} domain - Domain where it worked
   * @param {string} source - "auto" or "user"
   */
  async learnFromSuccess(buttonText, classification, domain, source = 'auto') {
    if (!buttonText || !classification) return false;
    
    const normalized = this.normalizeText(buttonText);
    const key = normalized;
    
    // Create or update pattern
    if (!this.globalPatterns[key]) {
      this.globalPatterns[key] = {
        text: buttonText,
        normalizedText: normalized,
        classification: classification,
        confidence: source === 'user' ? 0.95 : 0.50, // User teaching starts higher
        usageCount: 1,
        successCount: 1,
        domains: [domain],
        firstSeen: Date.now(),
        lastUsed: Date.now(),
        source: source === 'user' ? 'user-taught' : 'auto-learned'
      };
      logLearning(`[Learning] New pattern learned: "${normalized}" → ${classification}`);
    } else {
      // Update existing pattern
      const pattern = this.globalPatterns[key];
      pattern.usageCount++;
      pattern.successCount++;
      pattern.lastUsed = Date.now();
      
      // Add domain if not already tracked
      if (!pattern.domains.includes(domain)) {
        pattern.domains.push(domain);
      }
      
      // Update confidence (Bayesian-style)
      // Higher usage = higher confidence, but diminishing returns
      const successRate = pattern.successCount / pattern.usageCount;
      const usageFactor = Math.min(pattern.usageCount / 20, 1); // Cap at 20 uses
      pattern.confidence = 0.5 + (successRate * usageFactor * 0.5);
      
      // If user taught, boost confidence
      if (source === 'user' && pattern.source !== 'user-taught') {
        pattern.source = 'user-taught';
        pattern.confidence = Math.max(pattern.confidence, 0.90);
      }
      
      logLearning(`[Learning] Pattern updated: "${normalized}" confidence=${pattern.confidence.toFixed(2)} uses=${pattern.usageCount} domains=${pattern.domains.length}`);
    }
    
    // Check if pattern is ready for semantic library
    const pattern = this.globalPatterns[key];
    if (this.isReadyForLibrary(pattern)) {
      await this.addToSemanticLibrary(pattern);
    }
    
    // Save to storage
    await this.save();
    
    return true;
  },
  
  /**
   * Learn from a failure (pattern didn't work)
   */
  async learnFromFailure(buttonText, domain) {
    const normalized = this.normalizeText(buttonText);
    const key = normalized;
    
    if (this.globalPatterns[key]) {
      const pattern = this.globalPatterns[key];
      pattern.usageCount++;
      // Don't increment successCount
      
      // Recalculate confidence (lower due to failure)
      const successRate = pattern.successCount / pattern.usageCount;
      const usageFactor = Math.min(pattern.usageCount / 20, 1);
      pattern.confidence = 0.5 + (successRate * usageFactor * 0.5);
      
      logLearning(`[Learning] Pattern failed: "${normalized}" confidence=${pattern.confidence.toFixed(2)}`);
      
      await this.save();
    }
  },
  
  /**
   * Normalize button text for pattern matching
   */
  normalizeText(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/[^\w\s]/g, '')        // Remove punctuation
      .substring(0, 50);              // Limit length
  },
  
  /**
   * Check if pattern is ready to be added to semantic library
   */
  isReadyForLibrary(pattern) {
    return (
      pattern.confidence >= this.CONFIG.MIN_CONFIDENCE_FOR_LIBRARY &&
      pattern.usageCount >= this.CONFIG.MIN_USAGE_COUNT_FOR_LIBRARY &&
      pattern.domains.length >= 3 // Worked on at least 3 different sites
    );
  },
  
  /**
   * Add a learned pattern to the semantic library
   */
  async addToSemanticLibrary(pattern) {
    try {
      // Get current semantic library from storage
      const result = await chrome.storage.local.get('customSemanticPatterns');
      const customPatterns = result.customSemanticPatterns || {
        deny: [],
        manage: [],
        confirm: [],
        accept: []
      };
      
      // Determine which category to add to
      const category = this.mapClassificationToCategory(pattern.classification);
      if (!category) return false;
      
      // Create regex pattern from the text
      const regexPattern = this.textToRegex(pattern.normalizedText);
      
      // Check if pattern already exists
      const exists = customPatterns[category].some(p => 
        p.pattern === regexPattern || p.text === pattern.normalizedText
      );
      
      if (!exists) {
        customPatterns[category].push({
          pattern: regexPattern,
          text: pattern.normalizedText,
          originalText: pattern.text,
          confidence: pattern.confidence,
          usageCount: pattern.usageCount,
          domains: pattern.domains.length,
          addedDate: Date.now(),
          source: pattern.source
        });
        
        // Save updated semantic library
        await chrome.storage.local.set({ customSemanticPatterns });
        
        logLearning(`[Learning] ✓ Added to Semantic Library: "${pattern.text}" → ${category}`);
        logLearning(`[Learning]   Confidence: ${pattern.confidence.toFixed(2)}, Used on ${pattern.domains.length} sites`);
        
        return true;
      }
      
      return false;
    } catch (err) {
      console.error('[Learning] Failed to add to semantic library:', err);
      return false;
    }
  },
  
  /**
   * Map classification to semantic library category
   */
  mapClassificationToCategory(classification) {
    const mapping = {
      'deny': 'deny',
      'reject': 'deny',
      'manage': 'manage',
      'confirm': 'confirm',
      'accept': 'accept'
    };
    return mapping[classification] || null;
  },
  
  /**
   * Convert normalized text to regex pattern
   */
  textToRegex(normalizedText) {
    // Escape special regex characters
    const escaped = normalizedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Make whitespace flexible
    const flexible = escaped.replace(/\s+/g, '\\s+');
    
    // Add word boundaries to avoid partial matches
    return `/\\b${flexible}\\b/i`;
  },
  
  /**
   * Get learned pattern for button text (if exists)
   */
  getPattern(buttonText) {
    const normalized = this.normalizeText(buttonText);
    return this.globalPatterns[normalized] || null;
  },
  
  /**
   * Classify button using learned patterns
   * Returns classification with confidence score
   */
  classifyWithLearning(buttonText) {
    const pattern = this.getPattern(buttonText);
    
    if (pattern) {
      return {
        classification: pattern.classification,
        confidence: pattern.confidence,
        source: 'learned',
        usageCount: pattern.usageCount
      };
    }
    
    return null;
  },
  
  /**
   * Clean expired patterns
   */
  cleanExpiredPatterns() {
    const now = Date.now();
    const expiryMs = this.CONFIG.PATTERN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    let cleaned = 0;
    
    for (const key in this.globalPatterns) {
      const pattern = this.globalPatterns[key];
      
      // Keep if:
      // 1. User taught (never expire), OR
      // 2. High confidence and used recently, OR
      // 3. Not expired
      const isUserTaught = pattern.source === 'user-taught';
      const isHighConfidence = pattern.confidence > 0.85 && (now - pattern.lastUsed) < expiryMs;
      const notExpired = (now - pattern.lastUsed) < expiryMs;
      
      if (!isUserTaught && !isHighConfidence && !notExpired) {
        delete this.globalPatterns[key];
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logLearning(`[Learning] Cleaned ${cleaned} expired patterns`);
    }
  },
  
  /**
   * Sync high-confidence patterns to semantic library
   */
  async syncToSemanticLibrary() {
    logLearning('[Learning] Syncing learned patterns to semantic library...');
    
    let added = 0;
    for (const key in this.globalPatterns) {
      const pattern = this.globalPatterns[key];
      if (this.isReadyForLibrary(pattern)) {
        const success = await this.addToSemanticLibrary(pattern);
        if (success) added++;
      }
    }
    
    this.lastLibrarySync = Date.now();
    await chrome.storage.local.set({ lastLibrarySync: this.lastLibrarySync });
    
    logLearning(`[Learning] Sync complete: ${added} patterns added to library`);
  },
  
  /**
   * Save global patterns to storage
   */
  async save() {
    try {
      // Limit storage size
      const keys = Object.keys(this.globalPatterns);
      if (keys.length > this.CONFIG.MAX_LEARNED_PATTERNS_GLOBAL) {
        // Sort by confidence * usageCount, keep top patterns
        const sorted = keys
          .map(k => ({ key: k, pattern: this.globalPatterns[k] }))
          .sort((a, b) => {
            const scoreA = a.pattern.confidence * a.pattern.usageCount;
            const scoreB = b.pattern.confidence * b.pattern.usageCount;
            return scoreB - scoreA;
          })
          .slice(0, this.CONFIG.MAX_LEARNED_PATTERNS_GLOBAL);
        
        const newPatterns = {};
        sorted.forEach(item => {
          newPatterns[item.key] = item.pattern;
        });
        this.globalPatterns = newPatterns;
      }
      
      await chrome.storage.local.set({ globalLearnedPatterns: this.globalPatterns });
      return true;
    } catch (err) {
      console.error('[Learning] Save failed:', err);
      return false;
    }
  },
  
  /**
   * Export learned patterns (for sharing/backup)
   */
  exportPatterns() {
    return {
      version: '2.1.0',
      exportDate: new Date().toISOString(),
      patterns: this.globalPatterns,
      stats: this.getStats()
    };
  },
  
  /**
   * Import learned patterns (from sharing/backup)
   */
  async importPatterns(exportData) {
    try {
      if (!exportData.patterns) {
        throw new Error('Invalid export data');
      }
      
      let imported = 0;
      for (const key in exportData.patterns) {
        const importedPattern = exportData.patterns[key];
        
        // If pattern doesn't exist or imported has higher confidence, use it
        if (!this.globalPatterns[key] || 
            this.globalPatterns[key].confidence < importedPattern.confidence) {
          this.globalPatterns[key] = importedPattern;
          imported++;
        }
      }
      
      await this.save();
      logLearning(`[Learning] Imported ${imported} patterns`);
      return imported;
    } catch (err) {
      console.error('[Learning] Import failed:', err);
      return 0;
    }
  },
  
  /**
   * Get learning statistics
   */
  getStats() {
    const patterns = Object.values(this.globalPatterns);
    
    return {
      totalPatterns: patterns.length,
      byClassification: {
        deny: patterns.filter(p => p.classification === 'deny' || p.classification === 'reject').length,
        manage: patterns.filter(p => p.classification === 'manage').length,
        confirm: patterns.filter(p => p.classification === 'confirm').length,
        accept: patterns.filter(p => p.classification === 'accept').length,
      },
      bySource: {
        autoLearned: patterns.filter(p => p.source === 'auto-learned').length,
        userTaught: patterns.filter(p => p.source === 'user-taught').length,
      },
      avgConfidence: patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length || 0,
      highConfidence: patterns.filter(p => p.confidence > 0.85).length,
      readyForLibrary: patterns.filter(p => this.isReadyForLibrary(p)).length,
      totalDomains: [...new Set(patterns.flatMap(p => p.domains))].length,
    };
  },
  
  /**
   * Reset all learned patterns (for debugging/testing)
   */
  async reset() {
    this.globalPatterns = {};
    await chrome.storage.local.remove(['globalLearnedPatterns', 'customSemanticPatterns', 'lastLibrarySync']);
    logLearning('[Learning] All learned patterns reset');
  }
};

// Export for use in content.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LearningModule;
}
