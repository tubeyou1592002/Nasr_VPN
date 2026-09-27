const $ = id => document.getElementById(id);
const send = msg => new Promise(res => chrome.runtime.sendMessage(msg, res));

const CORE_PROTOCOLS = new Set(['vmess', 'vless', 'trojan', 'shadowsocks', 'ss']);

let state = null;

async function load() {
  const r = await send({ type: 'GET_STATE' });
  if (!r || !r.ok) { $('err').textContent = (r && r.error) || 'خطا در دریافت وضعیت'; return; }
  state = r;
  render();
}

function render() {
  const st = $('proxy-status');
  st.textContent = state.proxyEnabled ? 'پروکسی: فعال' : 'پروکسی: خاموش';
  st.className = 'status ' + (state.proxyEnabled ? 'on' : 'off');
  $('btn-toggle').textContent = state.proxyEnabled ? 'خاموش‌کردن پروکسی' : 'فعال‌سازی پروکسی';

  // نوار هستهٔ محلی
  const bar = $('localCoreBar');
  if (state.localCoreConnected && state.localCore) {
    const lc = state.localCore;
    $('localCoreText').textContent = `متصل به هستهٔ محلی ${lc.host}:${lc.port} (${lc.scheme})`;
    bar.classList.add('show');
  } else {
    bar.classList.remove('show');
  }

  const ul = $('servers');
  ul.innerHTML = '';
  if (!state.servers.length) {
    ul.innerHTML = '<li style="cursor:default">سروری یافت نشد — لینک سابسکریپشن را در تنظیمات وارد کنید.</li>';
    return;
  }
  for (const s of state.servers) {
    const li = document.createElement('li');
    if (state.selected === s.id) li.className = 'active';
    let badge = '';
    let disableActivate = false;
    let tooltip = '';
    if (!s.chromeSupported) {
      badge = `<span class="badge core">پروتکل ${escapeHtml(s.protocol)} — از طریق هستهٔ محلی اجرا می‌شود</span>`;
      if (!state.localCoreConnected) {
        disableActivate = true;
        tooltip = 'برای فعال‌سازی این سرور، از بخش اتصال به هستهٔ محلی در تنظیمات استفاده کنید.';
      }
    }
    const lat = s.latencyMs != null ? ` — ${s.latencyMs}ms` : '';
    li.innerHTML = `<strong>${escapeHtml(s.name)}</strong> ${badge}
      <span class="meta">${escapeHtml(s.protocol)} · ${escapeHtml(s.host)}:${s.port}${lat}</span>`;
    if (disableActivate) {
      li.title = tooltip;
      li.style.opacity = '0.75';
    }
    li.addEventListener('click', () => selectServer(s));
    ul.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function selectServer(s) {
  $('err').textContent = '';
  // سرورهای نیازمند هستهٔ محلی: اگر هستهٔ محلی متصل نیست، راهنمایی بده و اقدام ممنوع
  if (!s.chromeSupported && !state.localCoreConnected) {
    $('err').textContent = 'این پروتکل نیاز به هستهٔ محلی دارد. به تنظیمات → اتصال به هستهٔ محلی بروید.';
    return;
  }
  const r = await send({ type: 'APPLY_PROXY', serverId: s.id });
  if (!r.ok) { $('err').textContent = r.error; return; }
  await load();
}

$('btn-disconnect-core').addEventListener('click', async () => {
  const r = await send({ type: 'DISABLE_LOCAL_CORE' });
  if (!r.ok) { $('err').textContent = r.error; return; }
  await load();
});

$('btn-toggle').addEventListener('click', async () => {
  const r = state.proxyEnabled
    ? await send({ type: 'DISABLE_PROXY' })
    : await send({ type: 'APPLY_PROXY', serverId: state.selected });
  if (!r.ok) { $('err').textContent = r.error; return; }
  await load();
});

$('btn-refresh').addEventListener('click', async () => {
  $('err').textContent = '';
  const r = await send({ type: 'FETCH_SUBSCRIPTION' });
  if (!r.ok) { $('err').textContent = r.error; return; }
  await load();
});

$('btn-test').addEventListener('click', async () => {
  $('err').textContent = 'در حال تست تأخیر...';
  for (const s of state.servers) {
    const r = await send({ type: 'TEST_LATENCY', server: s });
    s.latencyMs = r.latencyMs;
  }
  $('err').textContent = '';
  render();
});

$('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

$('btn-wipe').addEventListener('click', async () => {
  if (!confirm('همهٔ داده‌ها (سابسکریپشن، سرورها، تنظیمات) پاک شود؟')) return;
  await send({ type: 'WIPE_DATA' });
  await load();
});

load();
