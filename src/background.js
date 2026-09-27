/**
 * Nasr VPN - Service Worker (MV3)
 * - ذخیرهٔ تنظیمات در chrome.storage.local
 * - اعمال/حذف پروکسی از طریق chrome.proxy (فقط HTTP/HTTPS/SOCKS)
 * - اندازه‌گیری تأخیر با fetch (زمان پاسخ HTTP — نه پینگ ICMP)
 */
import { detectAndParse } from './parsers.js';

const STORE_KEYS = {
  subUrl: 'subscriptionUrl',
  subFormat: 'subscriptionFormat', // auto | base64 | uri | clash | singbox
  servers: 'servers',
  selected: 'selectedServerId',
  refreshIntervalMin: 'refreshIntervalMin',
  fetchTimeoutSec: 'fetchTimeoutSec',
  proxyEnabled: 'proxyEnabled',
  lastFetchedAt: 'lastFetchedAt'
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('nasr-refresh', { periodInMinutes: 60 });
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
        default: sendResponse({ ok: false, error: 'پیام ناشناخته' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // async sendResponse
});

async function getState() {
  const s = await chrome.storage.local.get(null);
  return {
    ok: true,
    subscriptionUrl: s[STORE_KEYS.subUrl] || '',
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

async function fetchSubscription() {
  const { subscriptionUrl: url, subscriptionFormat: _f, fetchTimeoutSec } =
    await chrome.storage.local.get([STORE_KEYS.subUrl, STORE_KEYS.subFormat, STORE_KEYS.fetchTimeoutSec]);
  if (!url) throw new Error('ابتدا لینک سابسکریپشن را در تنظیمات وارد کنید');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), (Number(fetchTimeoutSec) || 10) * 1000);
  let text;
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', redirect: 'follow' });
    if (!res.ok) throw new Error(`دریافت سابسکریپشن ناموفق: HTTP ${res.status}`);
    text = await res.text();
  } finally { clearTimeout(t); }

  const servers = detectAndParse(text);
  await chrome.storage.local.set({
    [STORE_KEYS.servers]: servers,
    [STORE_KEYS.lastFetchedAt]: Date.now()
  });
  return { ok: true, count: servers.length, servers };
}

async function applyProxy(serverId) {
  const { servers } = await chrome.storage.local.get(STORE_KEYS.servers);
  const srv = (servers || []).find(s => s.id === serverId);
  if (!srv) throw new Error('سرور انتخابی یافت نشد');
  if (!srv.chromeSupported) {
    throw new Error(`پروتکل ${srv.protocol} توسط chrome.proxy پشتیبانی نمی‌شود. از کلاینت محلی سازگار استفاده کنید.`);
  }
  const scheme = srv.protocol === 'socks5' || srv.protocol === 'socks' ? 'socks5' : srv.protocol;
  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: { scheme, host: srv.host, port: srv.port },
      bypassList: ['localhost', '127.0.0.1', '[::1]']
    }
  };
  // احراز هویت پروکسی: chrome.proxy از onAuthRequested در webRequest پشتیبانی می‌کند؛
  // اعتبارنامه‌ها به‌دلیل محدودیت MV3 و امنیت در این نسخه پشتیبانی نمی‌شوند.
  await chrome.proxy.settings.set({ value: config, scope: 'regular' });
  await chrome.storage.local.set({ [STORE_KEYS.selected]: serverId, [STORE_KEYS.proxyEnabled]: true });
  return { ok: true };
}

async function disableProxy() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
  await chrome.storage.local.set({ [STORE_KEYS.proxyEnabled]: false });
  return { ok: true };
}

/**
 * اندازه‌گیری تأخیر: زمان پاسخ به یک درخواست HTTP به host:port.
 * توجه: این «پینگ ICMP» نیست؛ فقط زمان پاسخ HTTP/CONNECT-مانند را نشان می‌دهد.
 */
async function testLatency(server) {
  if (!server || !server.host || !server.port) throw new Error('سرور نامعتبر');
  const scheme = server.secure ? 'https' : 'http';
  const url = `${scheme}://${server.host}:${server.port}/`;
  const t0 = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    await fetch(url, { signal: ctrl.signal, mode: 'no-cors', credentials: 'omit' });
    return { ok: true, latencyMs: Math.round(performance.now() - t0), note: 'زمان پاسخ HTTP — معادل پینگ واقعی نیست' };
  } catch (e) {
    // even a network/CORS error after connection gives a rough RTT signal
    const ms = Math.round(performance.now() - t0);
    return { ok: false, latencyMs: ms, error: 'پاسخ دریافت نشد (احتمالاً CORS یا فیلتر)' };
  } finally { clearTimeout(t); }
}

async function wipeData() {
  await chrome.storage.local.clear();
  await disableProxy();
  return { ok: true };
}
