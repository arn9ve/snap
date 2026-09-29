// Snap: bridge between the extension (popup, shortcuts, storage) and the
// page script. Runs in Chrome's isolated world, where the chrome.* APIs
// exist; inject.js runs in the page itself so it can hook the camera.
(() => {
  'use strict';
  const toPage = (msg) => window.postMessage(Object.assign({ snapTo: 'page' }, msg), location.origin);
  const pending = new Map();
  let seq = 0;

  async function pushAll() {
    const { settings, bg } = await chrome.storage.local.get(['settings', 'bg']);
    toPage({ type: 'settings', settings: settings || {} });
    toPage({ type: 'bg', bg: bg || null });
  }
  pushAll();

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.settings) toPage({ type: 'settings', settings: ch.settings.newValue || {} });
    if (ch.bg) toPage({ type: 'bg', bg: ch.bg.newValue || null });
  });

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || !ev.data || ev.data.snapTo !== 'bridge') return;
    const m = ev.data;
    if (m.type === 'hello') pushAll();
    else if (m.type === 'saveSettings' && m.patch && typeof m.patch === 'object') {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: Object.assign(settings, m.patch) });
    } else if (m.type === 'saveBg' && m.bg && typeof m.bg.dataUrl === 'string' && m.bg.dataUrl.startsWith('data:image/')) {
      await chrome.storage.local.set({ bg: { dataUrl: m.bg.dataUrl, source: m.bg.source, ts: m.bg.ts } });
    } else if (m.type === 'reply') {
      const r = pending.get(m.id);
      if (r) { pending.delete(m.id); r(m.status); }
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.snap !== 'cmd') return;
    const id = ++seq;
    pending.set(id, sendResponse);
    setTimeout(() => { if (pending.delete(id)) sendResponse(null); }, 1500);
    toPage({ type: 'cmd', cmd: msg.cmd, id });
    return true;
  });
})();
