const $ = id => document.getElementById(id);

/** ماسک لینک سابسکریپشن: پروتکل و دامنه نمایان، مسیر/توکن مخفی */
function maskUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname && u.pathname !== '/' ? '/****' : '';
    return `${u.protocol}//${u.hostname}${path}${u.search ? '?****' : ''}`;
  } catch (_) {
    return '****';
  }
}

/** اعتبارسنجی سمت کاربر پیش از ارسال به background (باگ C: URL تکی حتی با پورت صریح) */
function validateManualInput(text) {
  const t = String(text || '').trim();
  if (!t) return { error: 'محتوای ورودی خالی است' };
  if (/^\s*<(!doctype|html)/i.test(t)) {
    return { error: 'محتوای ورودی HTML است، نه سابسکریپشن. متن Base64/URI/Clash/JSON را وارد کنید.', type: 'HTML_RESPONSE' };
  }
  // تک‌خطی + شروع با http/https → همیشه URL است، حتی با port صریح (باگ C)
  if (!t.includes('\n') && t.length < 2000 && /^https?:\/\//i.test(t)) {
    return { error: 'این یک URL است، نه محتوای سابسکریپشن — محتوای Base64 یا متن کانفیگ‌ها را پیست کنید.', type: 'MANUAL_IS_URL' };
  }
  return null;
}

let revealed = false, revealedMirror = false;
let savedUrl = '', savedMirror = '';

async function load() {
  const r = await new Promise(res => chrome.runtime.sendMessage({ type: 'GET_STATE' }, res));
  if (r && r.ok) {
    savedUrl = r.subscriptionUrl || '';
    savedMirror = r.subscriptionUrlMirror || '';
    $('refresh').value = r.refreshIntervalMin || 60;
    $('timeout').value = r.fetchTimeoutSec || 10;
    $('format').value = r.format || 'auto';
    if (r.localCore) {
      $('localCoreHost').value = r.localCore.host;
      $('localCorePort').value = r.localCore.port;
      $('localCoreScheme').value = r.localCore.scheme;
    }
    renderLocalCoreStatus(r.localCoreConnected);
    renderUrlField();
    renderMirrorField();
  }
}

// ── هستهٔ محلی ─────────────────────────────────────────────────

function renderLocalCoreStatus(connected, busy) {
  const el = $('localCoreStatus');
  el.classList.remove('on', 'off', 'busy');
  if (busy) {
    el.classList.add('busy');
    el.textContent = 'در حال اتصال…';
  } else if (connected) {
    el.classList.add('on');
    el.textContent = 'متصل';
  } else {
    el.classList.add('off');
    el.textContent = 'قطع';
  }
}

$('btn-local-connect').addEventListener('click', async () => {
  $('localCoreError').textContent = '';
  const host = $('localCoreHost').value.trim();
  const port = Number($('localCorePort').value);
  const scheme = $('localCoreScheme').value;
  renderLocalCoreStatus(false, true);
  const r = await new Promise(res => chrome.runtime.sendMessage({
    type: 'APPLY_LOCAL_CORE',
    payload: { host, port, scheme }
  }, res));
  if (r && r.ok) {
    renderLocalCoreStatus(true);
    $('settingsError').textContent = '';
  } else {
    renderLocalCoreStatus(false);
    $('localCoreError').textContent = (r && r.error) || 'خطای نامشخص';
  }
});

$('btn-local-disconnect').addEventListener('click', async () => {
  $('localCoreError').textContent = '';
  const r = await new Promise(res => chrome.runtime.sendMessage({ type: 'DISABLE_LOCAL_CORE' }, res));
  if (r && r.ok) {
    renderLocalCoreStatus(false);
  } else {
    $('localCoreError').textContent = (r && r.error) || 'خطای نامشخص';
  }
});

// ── سابسکریپشن ─────────────────────────────────────────────────

function renderUrlField() {
  const input = $('subUrl');
  if (revealed) {
    input.type = 'text';
    input.value = savedUrl;
    input.readOnly = false;
    $('btn-reveal').textContent = 'مخفی‌کردن';
  } else {
    input.type = 'password';
    input.value = savedUrl ? maskUrl(savedUrl) : '';
    input.readOnly = !!savedUrl;
    $('btn-reveal').textContent = 'نمایش لینک';
  }
}

function renderMirrorField() {
  const input = $('subUrlMirror');
  if (revealedMirror) {
    input.type = 'text';
    input.value = savedMirror;
    input.readOnly = false;
    $('btn-reveal-mirror').textContent = 'مخفی‌کردن';
  } else {
    input.type = 'password';
    input.value = savedMirror ? maskUrl(savedMirror) : '';
    input.readOnly = !!savedMirror;
    $('btn-reveal-mirror').textContent = 'نمایش لینک';
  }
}

$('btn-reveal').addEventListener('click', () => { revealed = !revealed; renderUrlField(); });
$('btn-reveal-mirror').addEventListener('click', () => { revealedMirror = !revealedMirror; renderMirrorField(); });

$('btn-clear-url').addEventListener('click', async () => {
  if (!confirm('لینک سابسکریپشن حذف شود؟ (لیست سرورها حفظ می‌شود)')) return;
  savedUrl = ''; revealed = false;
  await chrome.storage.local.remove('subscriptionUrl');
  renderUrlField();
  $('settingsError').textContent = '';
  $('settingsError').style.color = 'var(--ok)';
  $('settingsError').textContent = 'لینک حذف شد';
});

$('btn-clear-mirror').addEventListener('click', async () => {
  savedMirror = ''; revealedMirror = false;
  await chrome.storage.local.remove('subscriptionUrlMirror');
  renderMirrorField();
  $('settingsError').textContent = 'لینک mirror حذف شد';
  $('settingsError').style.color = 'var(--ok)';
});

$('save').addEventListener('click', async () => {
  const url = revealed ? $('subUrl').value.trim() : savedUrl;
  const mirror = revealedMirror ? $('subUrlMirror').value.trim() : savedMirror;
  const r = await new Promise(res => chrome.runtime.sendMessage({
    type: 'SET_SETTINGS',
    patch: {
      subscriptionUrl: url,
      subscriptionUrlMirror: mirror,
      format: $('format').value,
      refreshIntervalMin: Number($('refresh').value) || 60,
      fetchTimeoutSec: Number($('timeout').value) || 10
    }
  }, res));
  if (r && r.ok) {
    savedUrl = url; savedMirror = mirror;
    revealed = false; revealedMirror = false;
    renderUrlField(); renderMirrorField();
    $('settingsError').textContent = 'ذخیره شد';
    $('settingsError').style.color = 'var(--ok)';
  } else {
    $('settingsError').textContent = 'خطا: ' + (r && r.error || 'نامشخص');
    $('settingsError').style.color = 'var(--err)';
  }
});

// ── ورود دستی (باگ A: خطا زیر textarea؛ باگ B: پاک‌کردن textarea) ──

$('btn-import').addEventListener('click', async () => {
  const text = $('manualText').value;
  $('manualError').textContent = '';
  // اعتبارسنجی سریع سمت کاربر
  const v = validateManualInput(text);
  if (v) {
    $('manualError').textContent = 'خطا: ' + v.error;
    return;
  }
  const r = await new Promise(res => chrome.runtime.sendMessage({ type: 'IMPORT_MANUAL', text }, res));
  if (r && r.ok) {
    $('manualError').style.color = 'var(--ok)';
    $('manualError').textContent = `ورود دستی موفق: ${r.count} سرور ذخیره شد`;
    // باگ B: پاک‌کردن محتوای حساس از UI
    $('manualText').value = '';
  } else {
    $('manualError').style.color = 'var(--err)';
    $('manualError').textContent = 'خطا: ' + (r && r.error || 'نامشخص');
  }
});

load();
