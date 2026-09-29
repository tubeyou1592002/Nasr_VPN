/**
 * Nasr VPN - Service Worker (MV3)
 * - Watchdog: auto-reconnect only when proxy active and server unreachable.
 * - Manual disconnect (DISABLE_PROXY) sets userDisconnected flag; watchdog never auto-reconnects after it.
 */
import { detectAndParse } from './parsers.js';

const STORE_KEYS = {
  subUrl: 'subscriptionUrl',
  subUrlMirror: 'subscriptionUrlMirror',
  subFormat: 'subscriptionFormat',
  servers: 'servers',
  selected: 'selectedServerId',
  refreshIntervalMin: 'refreshIntervalMin',
  fetchTimeoutSec: 'fetchTimeoutSec',
  proxyEnabled: 'proxyEnabled',
  lastFetchedAt: 'lastFetchedAt',
  userDisconnected: 'userDisconnected'
};

const UA_HEADER = 'v2rayNG/1.8.0';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('nasr-refresh', { periodInMinutes: 60 });
  chrome.alarms.create('nasr-watchdog', { periodInMinutes: 1 });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'FETCH_SUBSCRIPTION': sendResponse(await fetchSubscription()); break;
        case 'APPLY_PROXY': sendResponse(await applyProxy(msg.serverId)); break;
        case 'DISABLE_PROXY': sendResponse(await disableProxy()); break;
        case 'TEST_LATENCY': sendResponse(await testLatency(msg.server)); break;
        case 'GET_STATE': sendResponse(await getState()); break;
        case 'SET_SETTINGS': sendResponse(await setSettings(msg.patch)); break;
        case 'WIPE_DATA': sendResponse(await wipeData()); break;
        case 'IMPORT_MANUAL': sendResponse(await importManual(msg.text)); break;
        default: sendResponse({ ok: false, error: 'Unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e), errorType: e && e.type });
    }
  })();
  return true;
});

// ==============================
// Watchdog auto-reconnect
// ==============================
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'nasr-watchdog') watchdogTick();
});

async function watchdogTick() {
  try {
    const s = await chrome.storage.local.get([
      STORE_KEYS.proxyEnabled,
      STORE_KEYS.userDisconnected,
      STORE_KEYS.selected,
      STORE_KEYS.servers
    ]);
    if (!s[STORE_KEYS.proxyEnabled] || s[STORE_KEYS.userDisconnected]) return; // manual disconnect -> do nothing

    const servers = s[STORE_KEYS.servers] || [];
    const selectedId = s[STORE_KEYS.selected];
    const selected = servers.find(x => x.id === selectedId);
    if (!selected) return;

    const health = await testLatency(selected);
    if (health.ok) return; // server healthy

    // Server timed out -> retry same server first, then others by latency
    try { await applyProxy(selectedId); return; } catch (_) {}
    const others = servers
      .filter(x => x.id !== selectedId && x.chromeSupported)
      .sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity));
    for (const srv of others) {
      try { await applyProxy(srv.id); return; } catch (_) {}
    }
  } catch (_) {}
}

async function getState() {
  const s = await chrome.storage.local.get(null);
  return {
    ok: true,
    subscriptionUrl: s[STORE_KEYS.subUrl] || '',
    subscriptionUrlMirror: s[STORE_KEYS.subUrlMirror] || '',
    format: s[STORE_KEYS.subFormat] || 'auto',
    servers: s[STORE_KEYS.servers] || [],
    selected: s[STORE_KEYS.selected] || null,
    proxyEnabled: !!s[STORE_KEYS.proxyEnabled],
    refreshIntervalMin: s[STORE_KEYS.refreshIntervalMin] || 60,
    fetchTimeoutSec: s[STORE_KEYS.fetchTimeoutSec] || 10,
    lastFetchedAt: s[STORE_KEYS.lastFetchedAt] || null
  };
}

async function setSettings(patch) {
  const map = {
    subscriptionUrl: STORE_KEYS.subUrl,
    subscriptionUrlMirror: STORE_KEYS.subUrlMirror,
    format: STORE_KEYS.subFormat,
    refreshIntervalMin: STORE_KEYS.refreshIntervalMin,
    fetchTimeoutSec: STORE_KEYS.fetchTimeoutSec
  };
  const toSet = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (map[k] !== undefined) toSet[map[k]] = v;
  }
  if (toSet[STORE_KEYS.refreshIntervalMin] !== undefined) {
    const min = Math.max(5, Number(toSet[STORE_KEYS.refreshIntervalMin]) || 60);
    toSet[STORE_KEYS.refreshIntervalMin] = min;
    chrome.alarms.create('nasr-refresh', { periodInMinutes: min });
  }
  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
  return { ok: true };
}

function buildUaRule(url) {
  try {
    const host = new URL(url).hostname;
    return {
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'User-Agent', operation: 'set', value: UA_HEADER }]
      },
      condition: { requestDomains: [host], resourceTypes: ['xmlhttprequest'] }
    };
  } catch (_) { return null; }
}

async function fetchWithUaHeader(url, timeoutSec) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'User-Agent': UA_HEADER }
    });
  } finally { clearTimeout(t); }
}

async function fetchWithDnrUa(url, timeoutSec) {
  const rule = buildUaRule(url);
  if (!rule) throw new Error('Invalid subscription URL');
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [rule]
  });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
    try {
      return await fetch(url, { signal: ctrl.signal, credentials: 'omit', redirect: 'follow' });
    } finally {
      clearTimeout(t);
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1] });
    }
  } catch (e) {
    try { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1] }); } catch (_) {}
    throw e;
  }
}

function looksLikeHtml(text) {
  return /^\s*<(!doctype|html)/i.test(text);
}

function looksLikeBareUrl(text) {
  const t = text.trim();
  return !t.includes('\n') && t.length < 2000 && /^https?:\/\//i.test(t);
}

async function fetchOne(url, timeoutSec) {
  let res;
  let usedDnr = false;
  try {
    res = await fetchWithUaHeader(url, timeoutSec);
  } catch (_) {
    usedDnr = true;
    res = await fetchWithDnrUa(url, timeoutSec);
  }
  if (!res.ok) throw new Error(`Subscription fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  return { text, usedDnr };
}

async function fetchSubscription() {
  const s = await chrome.storage.local.get([
    STORE_KEYS.subUrl, STORE_KEYS.subUrlMirror, STORE_KEYS.subFormat, STORE_KEYS.fetchTimeoutSec
  ]);
  const primary = s[STORE_KEYS.subUrl];
  const mirror = s[STORE_KEYS.subUrlMirror];
  if (!primary && !mirror) throw new Error('Set a subscription URL first');
  const timeoutSec = Number(s[STORE_KEYS.fetchTimeoutSec]) || 10;

  const attempts = [];
  if (primary) attempts.push({ label: 'primary', url: primary });
  if (mirror) attempts.push({ label: 'mirror', url: mirror });

  let lastErr = null;
  for (const a of attempts) {
    try {
      const { text, usedDnr } = await fetchOne(a.url, timeoutSec);
      if (looksLikeHtml(text)) {
        throw new Error('Server returned HTML instead of a subscription. Use mirror or manual import.');
      }
      const servers = detectAndParse(text);
      await chrome.storage.local.set({
        [STORE_KEYS.servers]: servers,
        [STORE_KEYS.lastFetchedAt]: Date.now()
      });
      return { ok: true, count: servers.length, servers, source: a.label, viaDnr: usedDnr };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Subscription fetch failed');
}

async function importManual(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Input is empty');
  if (looksLikeHtml(t)) {
    const err = new Error('Input is HTML, not a subscription. Paste Base64/URI/Clash/JSON.');
    err.type = 'HTML_RESPONSE';
    throw err;
  }
  if (looksLikeBareUrl(t)) {
    const err = new Error('This is a URL, not subscription content. Paste Base64 or config text.');
    err.type = 'MANUAL_IS_URL';
    throw err;
  }
  const servers = detectAndParse(t);
  await chrome.storage.local.set({
    [STORE_KEYS.servers]: servers,
    [STORE_KEYS.lastFetchedAt]: Date.now()
  });
  return { ok: true, count: servers.length, servers, source: 'manual' };
}

async function applyProxy(serverId) {
  const { servers } = await chrome.storage.local.get(STORE_KEYS.servers);
  const srv = (servers || []).find(s => s.id === serverId);
  if (!srv) throw new Error('Selected server not found');
  if (!srv.chromeSupported) {
    throw new Error(`Protocol ${srv.protocol} is not supported by chrome.proxy.`);
  }
  const scheme = srv.protocol === 'socks5' || srv.protocol === 'socks' ? 'socks5' : srv.protocol;
  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: { scheme, host: srv.host, port: srv.port },
      bypassList: ['localhost', '127.0.0.1', '[::1]']
    }
  };
  await chrome.proxy.settings.set({ value: config, scope: 'regular' });
  await chrome.storage.local.set({
    [STORE_KEYS.selected]: serverId,
    [STORE_KEYS.proxyEnabled]: true,
    [STORE_KEYS.userDisconnected]: false // new connection clears manual-disconnect flag
  });
  return { ok: true };
}

async function disableProxy() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
  await chrome.storage.local.set({
    [STORE_KEYS.proxyEnabled]: false,
    [STORE_KEYS.userDisconnected]: true // manual disconnect -> watchdog must not reconnect
  });
  return { ok: true };
}

async function testLatency(server) {
  if (!server || !server.host || !server.port) throw new Error('Invalid server');
  const scheme = server.secure ? 'https' : 'http';
  const url = `${scheme}://${server.host}:${server.port}/`;
  const t0 = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    await fetch(url, { signal: ctrl.signal, mode: 'no-cors', credentials: 'omit' });
    return { ok: true, latencyMs: Math.round(performance.now() - t0) };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    return { ok: false, latencyMs: ms, error: 'No response (CORS or filtered)' };
  } finally { clearTimeout(t); }
}

async function wipeData() {
  await chrome.storage.local.clear();
  await disableProxy();
  return { ok: true };
}
