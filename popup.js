// Snap: toolbar popup. Settings live in chrome.storage and reach the Meet tab
// through bridge.js; one-off actions (vanish, capture) are sent as messages.
const DEFAULTS = { enabled: true, effect: 'dust', duration: 2000, snap: true, sens: 9, pill: true, countdown: 5 };
const EFFECTS = [
  ['dust', 'Dust'], ['burn', 'Burn'], ['beam', 'Teleport'],
  ['ghost', 'Ghost'], ['glitch', 'Glitch'], ['pixel', 'Pixelate'],
  ['melt', 'Melt'], ['portal', 'Portal'], ['random', 'Random'],
];
const isTab = new URLSearchParams(location.search).has('tab');
if (isTab) document.body.classList.add('tab');

const $ = (id) => document.getElementById(id);
let settings = Object.assign({}, DEFAULTS);
let meetTab = null;
let last = null;

async function save(patch) {
  const { settings: cur = {} } = await chrome.storage.local.get('settings');
  settings = Object.assign({}, DEFAULTS, cur, patch);
  await chrome.storage.local.set({ settings });
  renderSettings();
}

async function findMeet() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && active.url && active.url.startsWith('https://meet.google.com/')) return active;
  const all = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
  return all[0] || null;
}

async function send(cmd) {
  if (!meetTab) meetTab = await findMeet();
  if (!meetTab) return null;
  try { return await chrome.tabs.sendMessage(meetTab.id, { snap: 'cmd', cmd }); }
  catch (e) { return null; }
}

function renderSettings() {
  $('enabled').checked = settings.enabled;
  $('main').classList.toggle('off', !settings.enabled);
  for (const b of $('effects').children) b.classList.toggle('sel', b.dataset.fx === settings.effect);
  $('duration').value = settings.duration;
  $('durLabel').textContent = (settings.duration / 1000).toFixed(1) + ' s';
  $('countdown').value = String(settings.countdown);
  $('snap').checked = settings.snap;
  $('sens').value = settings.sens;
  $('sensWrap').style.display = settings.snap ? '' : 'none';
  $('pill').checked = settings.pill;
}

function renderBg(bg) {
  const t = $('thumb');
  t.classList.toggle('has', !!bg);
  t.style.backgroundImage = bg ? `url("${bg.dataUrl}")` : '';
  $('clearBg').style.visibility = bg ? '' : 'hidden';
  if (!bg) $('bgSource').textContent = 'Capture your empty room, or upload the picture you use as your Mac camera background.';
  else {
    const when = new Date(bg.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    $('bgSource').textContent = (bg.source === 'upload' ? 'Your image' : 'Captured room') + ' · ' + when;
  }
}

function renderStatus(st) {
  last = st;
  const dot = $('dot'), txt = $('status'), tg = $('toggle');
  let msg, cls = '';
  if (!settings.enabled) { msg = 'Snap is off. Your camera goes to Meet untouched.'; }
  else if (!meetTab) { msg = 'Open a Google Meet call to use Snap.'; }
  else if (!st) { msg = 'Reload the Meet tab to connect Snap.'; cls = 'warn'; }
  else if (st.flash) { msg = st.flash; cls = 'warn'; }
  else if (st.countdown > 0) { msg = `Step out of frame… ${st.countdown}`; cls = 'warn'; }
  else if (st.countdown < 0) { msg = 'Saving the room…'; cls = 'warn'; }
  else if (!st.camera) { msg = 'Waiting for the camera. Turn it on in Meet.'; }
  else if (!st.bg) { msg = 'Set a background below to get started.'; cls = 'warn'; }
  else if (st.mode === 'gone') { msg = 'Vanished. Snap again to come back.'; cls = 'gone'; }
  else if (st.mode === 'out') { msg = 'Vanishing…'; cls = 'gone'; }
  else if (st.mode === 'in') { msg = 'Coming back…'; cls = 'armed'; }
  else { msg = st.snap === 'on' ? 'Armed. Snap your fingers to vanish.' : 'Armed.'; cls = 'armed'; }
  if (st && st.snap === 'error' && !st.flash && cls !== 'warn') msg += ' (mic unavailable)';
  dot.className = 'dot ' + cls;
  txt.textContent = msg;
  const ready = settings.enabled && st && st.camera && st.bg;
  tg.disabled = !ready;
  tg.textContent = st && (st.mode === 'gone' || st.mode === 'out') ? 'Return' : 'Vanish';
  $('capture').disabled = !(settings.enabled && st && st.camera) || (st && st.countdown !== 0);
}

async function uploadFile(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1280 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  await chrome.storage.local.set({ bg: { dataUrl: c.toDataURL('image/jpeg', 0.9), source: 'upload', ts: Date.now() } });
}

async function init() {
  for (const [k, label] of EFFECTS) {
    const b = document.createElement('button');
    b.dataset.fx = k; b.textContent = label;
    b.addEventListener('click', () => save({ effect: k }));
    $('effects').appendChild(b);
  }
  const { settings: cur = {}, bg } = await chrome.storage.local.get(['settings', 'bg']);
  settings = Object.assign({}, DEFAULTS, cur);
  renderSettings();
  renderBg(bg);

  $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
  $('duration').addEventListener('input', (e) => { $('durLabel').textContent = (e.target.value / 1000).toFixed(1) + ' s'; });
  $('duration').addEventListener('change', (e) => save({ duration: Number(e.target.value) }));
  $('countdown').addEventListener('change', (e) => save({ countdown: Number(e.target.value) }));
  $('snap').addEventListener('change', (e) => save({ snap: e.target.checked }));
  $('sens').addEventListener('change', (e) => save({ sens: Number(e.target.value) }));
  $('pill').addEventListener('change', (e) => save({ pill: e.target.checked }));
  $('toggle').addEventListener('click', async () => renderStatus(await send('toggle')));
  $('capture').addEventListener('click', async () => renderStatus(await send('capture')));
  $('clearBg').addEventListener('click', () => chrome.storage.local.remove('bg'));
  $('shortcuts').addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); });
  // Chrome can close a toolbar popup while the file picker is open, which
  // loses the file. Picking happens in a normal tab instead.
  $('upload').addEventListener('click', () => {
    if (isTab) $('file').click();
    else chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1') });
  });
  $('file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { await uploadFile(f); $('bgSource').textContent = 'Saved. You can close this tab.'; }
    catch (err) { $('bgSource').textContent = 'Could not read that image.'; }
  });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.settings) { settings = Object.assign({}, DEFAULTS, ch.settings.newValue); renderSettings(); renderStatus(last); }
    if (ch.bg) renderBg(ch.bg.newValue);
  });

  meetTab = await findMeet();
  const poll = async () => renderStatus(settings.enabled ? await send('status') : last);
  poll();
  setInterval(poll, 400);
}

init();
