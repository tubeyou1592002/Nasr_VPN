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

let revealed = false;
let savedUrl = '';

async function load() {
  const r = await new Promise(res => chrome.runtime.sendMessage({ type: 'GET_STATE' }, res));
  if (r && r.ok) {
    savedUrl = r.subscriptionUrl || '';
    $('refresh').value = r.refreshIntervalMin || 60;
    $('timeout').value = r.fetchTimeoutSec || 10;
    $('format').value = r.format || 'auto';
    renderUrlField();
  }
}

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
    input.readOnly = !!savedUrl; // برای ویرایش، ابتدا «نمایش لینک» را بزنید
    $('btn-reveal').textContent = 'نمایش لینک';
  }
}

$('btn-reveal').addEventListener('click', () => { revealed = !revealed; renderUrlField(); });

$('btn-clear-url').addEventListener('click', async () => {
  if (!confirm('لینک سابسکریپشن حذف شود؟ (لیست سرورها حفظ می‌شود)')) return;
  savedUrl = '';
  revealed = false;
  await chrome.storage.local.remove('subscriptionUrl');
  renderUrlField();
  $('msg').textContent = 'لینک حذف شد';
  $('msg').style.color = 'var(--ok)';
});

$('save').addEventListener('click', async () => {
  const url = revealed ? $('subUrl').value.trim() : savedUrl;
  const r = await new Promise(res => chrome.runtime.sendMessage({
    type: 'SET_SETTINGS',
    patch: {
      subscriptionUrl: url,
      format: $('format').value,
      refreshIntervalMin: Number($('refresh').value) || 60,
      fetchTimeoutSec: Number($('timeout').value) || 10
    }
  }, res));
  if (r && r.ok) {
    savedUrl = url;
    revealed = false;
    renderUrlField();
    $('msg').textContent = 'ذخیره شد';
    $('msg').style.color = 'var(--ok)';
  } else {
    $('msg').textContent = 'خطا: ' + (r && r.error || 'نامشخص');
    $('msg').style.color = 'var(--err)';
  }
});

load();
