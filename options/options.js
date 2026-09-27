const $ = id => document.getElementById(id);

async function load() {
  const r = await new Promise(res => chrome.runtime.sendMessage({ type: 'GET_STATE' }, res));
  if (r && r.ok) {
    $('subUrl').value = r.subscriptionUrl || '';
    $('format').value = r.format || 'auto';
    $('refresh').value = r.refreshIntervalMin || 60;
    $('timeout').value = r.fetchTimeoutSec || 10;
  }
}

$('save').addEventListener('click', async () => {
  const r = await new Promise(res => chrome.runtime.sendMessage({
    type: 'SET_SETTINGS',
    patch: {
      subscriptionUrl: $('subUrl').value.trim(),
      format: $('format').value,
      refreshIntervalMin: Number($('refresh').value) || 60,
      fetchTimeoutSec: Number($('timeout').value) || 10
    }
  }, res));
  $('msg').textContent = r && r.ok ? 'ذخیره شد' : 'خطا: ' + (r && r.error || 'نامشخص');
  $('msg').style.color = r && r.ok ? 'var(--ok)' : 'var(--err)';
});

load();
