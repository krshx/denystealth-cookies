// telemetry.js — DenyStealthCookies opt-in anonymous telemetry
// OFF by default. User must explicitly enable in settings.
// Sends ONLY: session token (random, non-identifying), CMP type, denial count, version.
// No URLs, no domains, no personal data of any kind.

const TELEMETRY_ENDPOINT = 'https://telemetry.denystealth.io/ping'; // Your Cloudflare Worker URL
const EXTENSION_VERSION  = '1.1.0';

// Generate a random session token (not tied to user/device - regenerated each browser session)
function getSessionToken() {
  const key = 'dsc_session_token';
  let token = sessionStorage.getItem(key);
  if (!token) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2,'0')).join('');
    sessionStorage.setItem(key, token);
  }
  return token;
}

// Check if user has opted in
async function isTelemetryEnabled() {
  return new Promise(resolve => {
    chrome.storage.local.get('telemetryOptIn', data => {
      resolve(data.telemetryOptIn === true);
    });
  });
}

// Send anonymous ping — called after a denial run
async function sendTelemetryPing({ cmpType, deniedCount, keptCount, bannerClosed }) {
  const enabled = await isTelemetryEnabled();
  if (!enabled) return;

  const payload = {
    v:       EXTENSION_VERSION,
    s:       getSessionToken(),   // anonymous session token only
    cmp:     sanitizeCmp(cmpType),
    denied:  Math.min(deniedCount, 9999),
    kept:    Math.min(keptCount, 100),
    closed:  bannerClosed ? 1 : 0,
    ts:      Math.floor(Date.now() / 1000),
  };

  try {
    await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (_) {
    // Telemetry failures are silently ignored — never affect the user
  }
}

// Sanitize CMP string — only allow known CMP names, no freeform text
function sanitizeCmp(raw) {
  const known = ['tcf','onetrust','cookiebot','trustarc','quantcast','didomi',
                 'usercentrics','axeptio','cookieyes','generic'];
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  return known.find(k => lower.includes(k)) || 'other';
}

// Cloudflare Worker code (deploy separately at telemetry.denystealth.io):
/*
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('OK');
    try {
      const body = await request.json();
      // Validate shape
      if (typeof body.denied !== 'number') return new Response('Bad Request', {status:400});
      // Store only aggregates in D1
      await env.DB.prepare(
        'INSERT INTO pings (version, cmp, denied, kept, closed, ts) VALUES (?,?,?,?,?,?)'
      ).bind(body.v, body.cmp, body.denied, body.kept, body.closed, body.ts).run();
      return new Response('OK', {headers:{'Access-Control-Allow-Origin':'*'}});
    } catch(e) {
      return new Response('Error', {status:500});
    }
  }
}
*/
