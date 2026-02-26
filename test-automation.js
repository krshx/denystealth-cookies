#!/usr/bin/env node
/**
 * Guardr Automated Testing Script
 * 
 * Requirements:
 *   npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
 * 
 * Usage:
 *   node test-automation.js
 * 
 * Output:
 *   - test-results.json (structured data)
 *   - screenshots/ (per-site screenshots)
 *   - test-report.md (human-readable report)
 */

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

// Test sites from TESTING.md
const TEST_SITES = {
  'TCF/Major CMPs': [
    { url: 'https://whatismyipaddress.com', cmp: 'TCF/IAB', priority: 'HIGH' },
    { url: 'https://www.forbes.com', cmp: 'Quantcast', priority: 'HIGH' },
    { url: 'https://www.cnn.com', cmp: 'OneTrust', priority: 'HIGH' },
    { url: 'https://www.theguardian.com', cmp: 'Sourcepoint', priority: 'HIGH' },
    { url: 'https://www.wired.com', cmp: 'TCF/IAB', priority: 'MEDIUM' },
  ],
  'Platform-Specific': [
    { url: 'https://medium.com', cmp: 'Custom', priority: 'MEDIUM' },
    { url: 'https://stackoverflow.com', cmp: 'Custom', priority: 'MEDIUM' },
    { url: 'https://www.reddit.com', cmp: 'Custom', priority: 'MEDIUM' },
  ],
  'International': [
    { url: 'https://www.bbc.com', cmp: 'BBC Custom', priority: 'HIGH' },
    { url: 'https://www.spiegel.de', cmp: 'Usercentrics', priority: 'MEDIUM' },
    { url: 'https://www.lemonde.fr', cmp: 'Didomi', priority: 'MEDIUM' },
  ],
  'Edge Cases': [
    { url: 'https://www.youtube.com', cmp: 'Google FC', priority: 'HIGH' },
    { url: 'https://www.github.com', cmp: 'None', priority: 'LOW' },
    { url: 'https://www.wikipedia.org', cmp: 'None', priority: 'LOW' },
  ]
};

const EXTENSION_PATH = __dirname; // Current directory
const RESULTS_DIR = path.join(__dirname, 'test-results');
const SCREENSHOTS_DIR = path.join(RESULTS_DIR, 'screenshots');

class ExtensionTester {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
  }

  async init() {
    // Create results directories
    await fs.mkdir(RESULTS_DIR, { recursive: true });
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

    // Launch browser with extension loaded
    console.log('🚀 Launching Chrome with Guardr extension...');
    this.browser = await puppeteer.launch({
      headless: false, // Must be false to load extensions
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
      defaultViewport: { width: 1920, height: 1080 }
    });

    console.log('✅ Browser launched successfully\n');
  }

  async testSite(siteInfo, category) {
    const { url, cmp, priority } = siteInfo;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${url}`);
    console.log(`Expected CMP: ${cmp} | Priority: ${priority}`);
    console.log('='.repeat(60));

    const result = {
      url,
      category,
      expectedCMP: cmp,
      priority,
      timestamp: new Date().toISOString(),
      success: false,
      error: null,
      metrics: {},
      autoModeEnabled: true
    };

    const page = await this.browser.newPage();

    try {
      // Enable test mode for auto-mode (via sessionStorage flag)
      console.log('⚙️  Enabling test mode for auto-mode...');
      await page.evaluateOnNewDocument(() => {
        sessionStorage.setItem('guardr_test_mode', 'true');
      });

      // Navigate to site
      console.log('📍 Navigating to site...');
      const navStart = Date.now();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      result.metrics.navigationTime = Date.now() - navStart;
      console.log(`✅ Loaded in ${result.metrics.navigationTime}ms`);

      // Wait for CMPs to render (before auto-mode triggers)
      console.log('⏳ Waiting for CMP to render (5 seconds)...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Take screenshot before auto-mode processing
      const domain = new URL(url).hostname.replace(/\./g, '-');
      await page.screenshot({ 
        path: path.join(SCREENSHOTS_DIR, `${domain}-before.png`),
        fullPage: false 
      });

      // Check if cookie banner visible initially
      console.log('🔍 Checking for cookie banner...');
      const bannerVisible = await page.evaluate(() => {
        const selectors = [
          '[id*="cookie"]', '[class*="cookie"]',
          '[id*="consent"]', '[class*="consent"]',
          '[role="dialog"]', 'dialog',
          '[id*="gdpr"]', '[class*="gdpr"]',
          '[class*="cmp"]', '[id*="cmp"]'
        ];
        return selectors.some(sel => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && 
                 style.display !== 'none' && 
                 style.visibility !== 'hidden' &&
                 style.opacity !== '0';
        });
      });

      result.bannerDetected = bannerVisible;
      console.log(bannerVisible ? '✅ Banner found' : '⚠️  No banner detected');

      // Now wait for auto-mode to process (it should have detected CMP by now)
      console.log('🤖 Auto-mode processing banner...');
      await new Promise(resolve => setTimeout(resolve, 7000));

      // Take screenshot after
      await page.screenshot({ 
        path: path.join(SCREENSHOTS_DIR, `${domain}-after.png`),
        fullPage: false 
      });

      // Check if banner still visible
      const bannerStillVisible = await page.evaluate(() => {
        const selectors = [
          '[id*="cookie"]', '[class*="consent"]',
          '[role="dialog"]', 'dialog'
        ];
        return selectors.some(sel => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      });

      result.bannerClosed = bannerVisible && !bannerStillVisible;
      result.success = true;

      console.log(result.bannerClosed ? '✅ Banner closed' : '⚠️  Banner still visible');
      
      // Capture action log and consent-or-pay detection from extension
      try {
        const extensionResult = await page.evaluate(() => {
          const resultEl = document.getElementById('__guardr_result__');
          if (resultEl) {
            const dataStr = resultEl.getAttribute('data-result');
            if (dataStr) {
              return JSON.parse(dataStr);
            }
          }
          return null;
        });
        
        if (extensionResult) {
          result.actionLog = extensionResult.actionLog || [];
          result.consentOrPay = extensionResult.consentOrPay || false;
          result.cmpMethod = extensionResult.cmpMethod || null;
          result.cmpDetected = extensionResult.cmpDetected || null;
          result.uncheckedCount = extensionResult.unchecked?.length || 0;
          result.mandatoryCount = extensionResult.mandatory?.length || 0;
          result.errorsCount = extensionResult.errors?.length || 0;
          
          console.log(`📊 Extension logged ${result.actionLog.length} actions, method: ${result.cmpMethod || 'none'}`);
          if (result.consentOrPay) {
            console.log('⚠️  Consent-or-pay wall detected');
          }
        } else {
          console.log('⚠️  No extension result captured (extension may not have run)');
        }
      } catch (err) {
        console.log(`⚠️  Could not capture extension result: ${err.message}`);
      }

    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      result.error = error.message;
    } finally {
      await page.close();
    }

    this.results.push(result);
    return result;
  }

  async runAllTests() {
    console.log('\n🧪 Starting comprehensive test suite...\n');

    for (const [category, sites] of Object.entries(TEST_SITES)) {
      console.log(`\n📂 Category: ${category}`);
      console.log('-'.repeat(60));

      for (const site of sites) {
        await this.testSite(site, category);
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  async generateReport() {
    const totalTime = Date.now() - this.startTime;
    const totalTests = this.results.length;
    const successful = this.results.filter(r => r.success).length;
    const bannersDetected = this.results.filter(r => r.bannerDetected).length;
    const bannersClosed = this.results.filter(r => r.bannerClosed).length;

    // Save JSON results
    await fs.writeFile(
      path.join(RESULTS_DIR, 'test-results.json'),
      JSON.stringify(this.results, null, 2)
    );

    // Generate markdown report
    const report = `# Guardr Test Report

**Date:** ${new Date().toISOString()}  
**Total Runtime:** ${(totalTime / 1000).toFixed(2)}s  
**Tests Run:** ${totalTests}  
**Success Rate:** ${((successful / totalTests) * 100).toFixed(1)}%

## Summary

| Metric | Count | Percentage |
|--------|-------|------------|
| Total tests | ${totalTests} | 100% |
| Successful | ${successful} | ${((successful / totalTests) * 100).toFixed(1)}% |
| Banners detected | ${bannersDetected} | ${((bannersDetected / totalTests) * 100).toFixed(1)}% |
| Banners closed | ${bannersClosed} | ${bannersDetected > 0 ? ((bannersClosed / bannersDetected) * 100).toFixed(1) : 0}% |

## Detailed Results

${Object.entries(TEST_SITES).map(([category, sites]) => `
### ${category}

| Site | Expected CMP | Status | Banner | Closed | Nav Time |
|------|--------------|--------|--------|--------|----------|
${sites.map(site => {
  const result = this.results.find(r => r.url === site.url);
  if (!result) return '';
  return `| ${site.url} | ${site.cmp} | ${result.success ? '✅' : '❌'} | ${result.bannerDetected ? '✅' : '⚠️'} | ${result.bannerClosed ? '✅' : '❌'} | ${result.metrics.navigationTime}ms |`;
}).join('\n')}
`).join('\n')}

## Errors

${this.results.filter(r => r.error).map(r => `
### ${r.url}
\`\`\`
${r.error}
\`\`\`
`).join('\n') || 'No errors encountered ✅'}

## Screenshots

See \`test-results/screenshots/\` for before/after images of each site.

---

**Note:** This automated test has limitations:
- Extension popup interaction requires manual trigger
- Some CMPs load dynamically after initial page load
- Cross-origin iframe CMPs cannot be fully tested
- Results may vary based on geolocation and user state

For complete testing, manual verification is recommended using TESTING.md checklist.
`;

    await fs.writeFile(
      path.join(RESULTS_DIR, 'test-report.md'),
      report
    );

    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total tests: ${totalTests}`);
    console.log(`Successful: ${successful} (${((successful / totalTests) * 100).toFixed(1)}%)`);
    console.log(`Banners detected: ${bannersDetected}`);
    console.log(`Banners closed: ${bannersClosed}`);
    console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log('\n📄 Reports saved:');
    console.log(`   - ${path.join(RESULTS_DIR, 'test-results.json')}`);
    console.log(`   - ${path.join(RESULTS_DIR, 'test-report.md')}`);
    console.log(`   - ${SCREENSHOTS_DIR}/`);
    console.log('='.repeat(60) + '\n');
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

// Main execution
async function main() {
  const tester = new ExtensionTester();

  try {
    await tester.init();
    await tester.runAllTests();
    await tester.generateReport();
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  } finally {
    await tester.cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { ExtensionTester };
