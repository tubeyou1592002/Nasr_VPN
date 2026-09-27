/**
 * Nasr VPN - Subscription Parsers
 * پشتیبانی: Base64 ساده، URI (vmess/vless/ss/trojan/http/socks)، Clash Meta YAML، sing-box JSON
 * خروجی استاندارد: { protocol, host, port, name, raw, secure }
 */

export function detectAndParse(text) {
  const t = (text || '').trim();
  if (!t) throw new Error('محتوای سابسکریپشن خالی است');

  // گارد: ورودی HTML (صفحهٔ وب، نه سابسکریپشن)
  if (/^\s*<(!doctype|html)/i.test(t)) {
    const err = new Error('این یک صفحهٔ HTML است، نه محتوای سابسکریپشن — محتوای Base64 یا متن کانفیگ‌ها را پیست کنید.');
    err.type = 'HTML_RESPONSE';
    throw err;
  }

  // گارد: یک URL تکی (کاربر لینک ساب را به‌جای محتوای آن پیست کرده)
  const singleLine = !t.includes('\n');
  if (singleLine && t.length < 2000 && /^https?:\/\//i.test(t)) {
    const err = new Error('این یک URL است، نه محتوای سابسکریپشن — محتوای Base64 یا متن کانفیگ‌ها را پیست کنید.');
    err.type = 'MANUAL_IS_URL';
    throw err;
  }

  // 1) تلاش برای Base64
  const decoded = tryBase64Decode(t);
  if (decoded && /:\/\//.test(decoded)) {
    return parseUriList(decoded);
  }
  // 2) URI مستقیم
  if (/^[a-zA-Z0-9+.-]+:\/\//.test(t) || t.split('\n').some(l => /^[a-zA-Z0-9+.-]+:\/\//.test(l))) {
    return parseUriList(t);
  }
  // 3) JSON (sing-box / v2ray config)
  let jsonParseErr = null;
  try {
    const j = JSON.parse(t);
    const out = parseSingBox(j) || parseV2rayConfig(j);
    if (out && out.length) return out;
    jsonParseErr = new Error('JSON معتبر است ولی سرور قابل استخراجی در آن یافت نشد (فرمت sing-box/V2Ray پشتیبانی‌شده نیست)');
  } catch (e) {
    jsonParseErr = e; // not JSON — fallback to Clash
  }
  // 4) Clash YAML (تحلیل خطی ساده‌ی proxies)
  const clash = parseClashProxies(t);
  if (clash.length) return clash;

  throw new Error('فرمت سابسکریپشن شناسایی نشد (پشتیبانی: Base64، URI، Clash، sing-box)');
}

function tryBase64Decode(s) {
  try {
    const clean = s.replace(/\s+/g, '');
    const norm = clean.replace(/-/g, '+').replace(/_/g, '/');
    const pad = norm + '='.repeat((4 - norm.length % 4) % 4);
    const bin = atob(pad);
    // UTF-8 decode
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  } catch (_) { return null; }
}

const PROXY_IN_CHROME = new Set(['http', 'https', 'socks4', 'socks5']);
const KNOWN = new Set(['vmess', 'vless', 'trojan', 'ss', 'socks', 'socks4', 'socks5', 'http', 'https', 'hysteria', 'hysteria2', 'tuic', 'wireguard']);

function parseUriList(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const isMultiLine = lines.length > 1;
  const out = [];
  for (const line of lines) {
    try {
      const srv = parseUri(line);
      // گارد: ورودی‌های http/https فقط وقتی سرور معتبرند که در یک لیست چندخطی
      // باشند و port صریح در URL ذکر شده باشد — نه یک URL تکی (لینک ساب).
      if (srv.protocol === 'http' || srv.protocol === 'https') {
        const hasExplicitPort = /:\/\/[^/\s#]+:\d+/.test(line.split('#')[0]);
        if (!isMultiLine || !hasExplicitPort) continue;
      }
      out.push(srv);
    } catch (_) { /* skip bad line */ }
  }
  if (!out.length) throw new Error('هیچ سرور معتبری در سابسکریپشن یافت نشد');
  return out;
}

function parseUri(line) {
  const scheme = line.split('://')[0].toLowerCase();
  if (!KNOWN.has(scheme)) throw new Error('پروتکل ناشناخته: ' + scheme);
  if (scheme === 'vmess') return parseVmess(line);
  const url = new URL(line);
  const host = url.hostname || url.username && url.pathname && '';
  const port = Number(url.port) || (scheme === 'https' || scheme === 'trojan' ? 443 : 80);
  const name = decodeURIComponent(url.hash ? url.hash.slice(1) : '') || `${host}:${port}`;
  const base = {
    protocol: scheme === 'ss' ? 'shadowsocks' : scheme,
    host,
    port,
    name,
    secure: scheme === 'https' || scheme === 'trojan' || scheme === 'vless',
    raw: line
  };
  if (scheme === 'ss') {
    // ss://base64(method:pass)@host:port#tag  یا  ss://base64(method:pass@host:port)#tag
    const userinfo = url.username ? decodeURIComponent(url.username) : null;
    let method = '', password = '';
    if (userinfo) {
      try {
        const dec = tryBase64Decode(userinfo) || userinfo;
        const idx = dec.indexOf(':');
        method = dec.slice(0, idx); password = dec.slice(idx + 1);
      } catch (_) { password = userinfo; }
    } else {
      const dec = tryBase64Decode(line.slice(5).split('#')[0]) || '';
      const m = dec.match(/^(.+?):(.*)@(.+):(\d+)$/);
      if (m) { method = m[1]; password = m[2]; base.host = m[3]; base.port = Number(m[4]); }
    }
    base.method = method; base.password = mask(password);
  } else if (scheme === 'socks' || scheme === 'socks5' || scheme === 'socks4' || scheme === 'http' || scheme === 'https') {
    if (url.username) {
      base.username = decodeURIComponent(url.username);
      base.password = mask(decodeURIComponent(url.password || ''));
    }
  }
  base.chromeSupported = PROXY_IN_CHROME.has(base.protocol === 'socks' ? 'socks5' : base.protocol);
  return base;
}

function parseVmess(line) {
  // vmess://base64(json)
  const json = tryBase64Decode(line.slice(8));
  if (!json) {
    const err = new Error('پیکربندی VMess نامعتبر: بدنهٔ Base64 قابل رمزگشایی نیست');
    err.type = 'VMESS_INVALID';
    throw err;
  }
  let o;
  try {
    o = JSON.parse(json);
  } catch (e) {
    console.debug('VMess payload JSON parse failed (details suppressed from UI/storage)', e && e.message);
    const err = new Error('پیکربندی VMess نامعتبر: بدنهٔ Base64 حاوی JSON معتبر نیست');
    err.type = 'VMESS_INVALID';
    throw err;
  }
  return {
    protocol: 'vmess',
    host: String(o.add || ''),
    port: Number(o.port || 443),
    name: o.ps || o.remarks || String(o.add || ''),
    secure: String(o.tls || '') === 'tls',
    network: o.net || 'tcp',
    uuid: mask(o.id || ''),
    raw: line,
    chromeSupported: false
  };
}

function parseClashProxies(text) {
  // استخراج خطی بخش proxies: در YAML بدون وابستگی خارجی
  const out = [];
  const lines = text.split('\n');
  let inProxies = false, cur = null, buf = '';
  const flush = () => {
    if (cur) { try { out.push(fromClashEntry(cur)); } catch (_) {} }
    cur = null; buf = '';
  };
  for (const raw of lines) {
    const line = raw.replace(/\t/g, ' ');
    if (/^proxies\s*:/.test(line)) { inProxies = true; continue; }
    if (inProxies && /^[A-Za-z-]+\s*:/.test(line)) { flush(); inProxies = false; continue; }
    if (!inProxies) continue;
    if (/^\s*-\s*\{/.test(line)) {
      // entry درون‌خطی
      flush();
      try { cur = parseInlineMap(line.replace(/^\s*-\s*/, '')); } catch (_) {}
      continue;
    }
    if (/^\s*-\s/.test(line) && buf) { flush(); buf = line.trim().replace(/^-\s*/, ''); continue; }
    if (/^\s*-\s/.test(line)) { buf = line.trim().replace(/^-\s*/, ''); continue; }
    if (buf) {
      const kv = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
      if (kv) { cur = cur || {}; cur[kv[1].trim()] = unquote(kv[2].trim()); }
    }
    if (buf && !cur) { cur = parseInlineMap(buf); buf = ''; }
  }
  flush();
  return out;
}

function parseInlineMap(s) {
  const o = {};
  const inner = s.trim().replace(/^\{/, '').replace(/\}$/, '');
  for (const part of inner.split(',')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    o[part.slice(0, i).trim()] = unquote(part.slice(i + 1).trim());
  }
  return o;
}
function unquote(s) { return s.replace(/^['"]|['"]$/g, ''); }

function fromClashEntry(p) {
  if (!p || !p.server || !p.port) throw new Error('ورودی Clash ناقص');
  const type = String(p.type || '').toLowerCase();
  const protoMap = { ss: 'shadowsocks', socks5: 'socks5', http: 'http' };
  const protocol = protoMap[type] || type;
  return {
    protocol,
    host: String(p.server),
    port: Number(p.port),
    name: String(p.name || p.server),
    secure: ['trojan', 'vmess', 'vless'].includes(type) && (p.tls === true || p.tls === 'true'),
    chromeSupported: ['http', 'socks5', 'socks4'].includes(protocol),
    raw: JSON.stringify(p)
  };
}

function parseSingBox(j) {
  if (!j || !Array.isArray(j.outbounds)) return null;
  const out = [];
  for (const ob of j.outbounds) {
    if (!ob || !ob.type || !ob.server) continue;
    const protocol = String(ob.type);
    out.push({
      protocol,
      host: String(ob.server),
      port: Number(ob.server_port || 443),
      name: String(ob.tag || ob.server),
      secure: ['trojan', 'vmess', 'vless', 'hysteria2', 'tuic'].includes(protocol) && !!ob.tls,
      chromeSupported: ['http', 'socks'].includes(protocol),
      raw: JSON.stringify(ob)
    });
  }
  return out.length ? out : null;
}

function parseV2rayConfig(j) {
  if (!j || !Array.isArray(j.outbounds)) return null;
  const out = [];
  for (const ob of j.outbounds) {
    if (!ob || !ob.protocol) continue;
    const ss = ob.streamSettings && ob.streamSettings.settings || {};
    const addr = (ss.servers && ss.servers[0] && ss.servers[0].address) || (ob.settings && ob.settings.vnext && ob.settings.vnext[0] && ob.settings.vnext[0].address);
    const port = (ss.servers && ss.servers[0] && ss.servers[0].port) || (ob.settings && ob.settings.vnext && ob.settings.vnext[0] && ob.settings.vnext[0].port);
    if (!addr || !port) continue;
    out.push({
      protocol: String(ob.protocol),
      host: String(addr),
      port: Number(port),
      name: String(ob.tag || addr),
      secure: String(ob.protocol) === 'trojan' || (ob.streamSettings && ob.streamSettings.security === 'tls'),
      chromeSupported: ['http', 'socks'].includes(String(ob.protocol)),
      raw: JSON.stringify(ob)
    });
  }
  return out.length ? out : null;
}

/** ماسک کردن مقادیر حساس قبل از ذخیره در حالت نمایش */
export function mask(s) {
  if (!s) return '';
  s = String(s);
  if (s.length <= 4) return '****';
  return s.slice(0, 2) + '****' + s.slice(-2);
}
