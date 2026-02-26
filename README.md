# Guardr 🛡️

**One-click denial of all non-essential cookies and tracking consents.**  
Intelligent Chrome extension with **self-learning capabilities** that automatically handles any CMP using universal semantic detection.

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-blue)](https://chromewebstore.google.com/)
[![Version](https://img.shields.io/badge/version-2.1.0-green)](https://github.com/krshx/guardr)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

---

## 🆕 What's New

### v2.1.0 - **Intelligent Learning System** 🧠
The extension now **grows smarter over time**:
- **Auto-learns** from successful button detections
- **Shares patterns** across all websites  
- **Promotes patterns** to permanent library after 10+ proven uses
- **Confidence scoring** ensures reliability (Bayesian-style)
- **Export/import** learned patterns for sharing

[📚 Read Learning System Documentation →](LEARNING_SYSTEM_DOCS.md)

### v2.0.0 - **Universal Semantic Detection** 🌍
Works on **any** cookie banner without site-specific rules:
- **15+ Languages**: English, French, German, Spanish, Italian, Portuguese, Dutch, Danish, Swedish, Norwegian, Finnish, Polish, Czech, Romanian, Greek, Hungarian
- **400+ Patterns**: Comprehensive button text library
- **Shadow DOM Support**: Handles Usercentrics, custom elements
- **Dark Pattern Detection**: "No thanks", "Later", "Click here", etc.

[📖 Read v2.0 Release Notes →](RELEASE_NOTES_v2.0.0.md)

---

## ✨ Features

- **🚀 One-Click Denial** — Deny all non-essential consents instantly
- **🎯 Multi-Level Support** — Navigates through Partners, Legitimate Interest, Vendors tabs automatically
- **🖼️ Iframe Scanning** — Detects and handles CMPs loaded in iframes
- **🏢 Enhanced CMP Coverage** — Improved support for TCF/IAB, OneTrust, Cookiebot, Didomi, Usercentrics, TrustArc, Quantcast, Sourcepoint, and more
- **⚡ Smart Auto-Mode** — Automatically detects and denies CMPs on page load with retry logic
- **🔄 Dynamic Detection** — Handles slow-loading and delayed CMPs with multiple detection attempts
- **📊 Detailed Results** — Shows exactly what was denied, what was kept mandatory, and where
- **🔒 Privacy First** — No tracking, no data collection unless you opt-in to anonymous telemetry
- **🌍 Multi-Language** — Supports English, French, German, Spanish, Italian, Portuguese, Dutch

**New in v1.3.0:**
- 🔍 **Action Logging** — Comprehensive log of all operations (button clicks, API calls, fallback strategies)
- ⚠️ **Consent-or-Pay Detection** — Smart detection of "Accept OR Subscribe/Pay" walls with automatic abort
- 📊 **Enhanced History** — Expandable action logs, banner status indicators, pay wall warnings
- 🧹 **Clear History** — User control over stored data with one-click clearing
- 🎯 **Transparency** — See exactly what the extension did, when, and how
- 🧪 **Test Results** — Action logs and detection flags in test-results.json for debugging

**New in v1.2.0:**
- ✨ Completely rewritten OneTrust handler (CNN, major news sites)
- ✨ Enhanced Quantcast support (Forbes)
- ✨ Added Sourcepoint detection and handling (The Guardian)
- ✨ Smart retry logic for slow-loading CMPs
- ✨ Improved auto-mode timing and reliability
- ✨ Test mode for automated validation

---

## 🎯 What It Does

DenyStealthCookies automatically:
1. ✅ Detects cookie consent banners and CMPs
2. ✅ Clicks "Reject All" / "Deny All" / "Object All" buttons
3. ✅ Opens preference panels and navigates through all sections
4. ✅ Unchecks all non-essential consent toggles (advertising, tracking, personalization, etc.)
5. ✅ Keeps only mandatory/strictly necessary cookies checked
6. ✅ Saves your choices and closes the banner

**Example:** On sites like whatismyipaddress.com with complex multi-tab CMPs:
- Opens "More Options" → Clicks "Reject All"
- Navigates to "Partners" tab → Clicks "Reject All" for all vendors
- Navigates to "Legitimate Interest" tab → Clicks "Object All"
- Processes all sections recursively → Saves preferences

---

## 📦 Installation

### From Chrome Web Store (Recommended)
1. Visit [Chrome Web Store](#) (coming soon)
2. Click "Add to Chrome"
3. Click the extension icon when you see a cookie banner

### Manual Installation (Development)
1. Clone this repository:
   ```bash
   git clone https://github.com/krshx/denystealth-cookies.git
   cd denystealth-cookies
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top-right)

4. Click "Load unpacked" and select the `guardr` folder

5. The extension icon will appear in your toolbar

---

## 🚀 Usage

### Manual Mode (Default)
1. Visit any website with a cookie banner
2. Click the **Guardr** extension icon
3. Click **"Deny All Non-Essential Consents"**
4. View detailed results in the popup

### Auto Mode (Optional)
1. Click the extension icon
2. Click the ⚙️ Settings icon
3. Toggle **"Auto-deny on every page"**
4. The extension will now run automatically on page load

---

## 🏗️ Architecture

### Files
- **`manifest.json`** — Extension configuration
- **`content.js`** — Core CMP detection and denial logic (multi-level navigation, iframe scanning)
- **`background.js`** — Service worker for message handling
- **`popup.html/js`** — User interface and results display
- **`telemetry.js`** — Optional anonymous usage statistics (opt-in only)
- **`docs/index.html`** — Privacy policy

### Detection Strategies
The extension uses 6 phases to ensure maximum coverage:

1. **Direct Button Click** — Finds and clicks deny/reject buttons
2. **CMP API Calls** — Uses vendor-specific APIs (OneTrust.RejectAll(), etc.)
3. **Multi-Section Navigation** — Opens preferences, navigates through all tabs (Partners, Vendors, LI)
4. **Toggle Scraping** — Unchecks all non-essential checkboxes/switches
5. **Iframe Scanning** — Processes CMPs inside iframes
6. **Banner Hiding** — Force-hides banner if still visible

---

## 🛡️ Privacy

- **No tracking by default** — Telemetry is opt-in only
- **All processing happens locally** — Nothing is sent to external servers (except opt-in telemetry)
- **No personal data collected** — We never see what sites you visit
- **Open source** — Audit the code yourself

**Optional Telemetry:** If enabled, sends anonymous statistics (CMP type, consent count) to help improve CMP coverage. See [Privacy Policy](https://krshx.github.io/guardr/).

---

## 🤝 Contributing

Contributions welcome! To contribute:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Reporting Issues
Found a site where it doesn't work? [Open an issue](https://github.com/krshx/guardr/issues) with:
- URL of the site
- CMP type (if known)
- Screenshot of the cookie banner
- Extension popup showing results

---

## 📄 License

MIT License — see [LICENSE](LICENSE) file for details

---

## 💬 Contact

- GitHub Issues: [krshx/guardr/issues](https://github.com/krshx/guardr/issues)
- Email: [dev+guardr@gmail.com](mailto:dev+guardr@gmail.com)

---

## ☕ Support

If this extension saves you time and protects your privacy, consider supporting development:

- [Ko-fi](https://ko-fi.com/krshx)
- [GitHub Sponsors](https://github.com/sponsors/krshx) (coming soon)

---

**Built with ❤️ for people, not platforms**
