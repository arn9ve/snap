// Snap: keyboard shortcuts that work from anywhere in Chrome, and the OFF
// badge on the toolbar icon.
async function meetTabs() {
  const active = await chrome.tabs.query({ active: true, currentWindow: true, url: 'https://meet.google.com/*' });
  return active.length ? active : chrome.tabs.query({ url: 'https://meet.google.com/*' });
}

async function flip(key) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  settings[key] = settings[key] === false;           // both default to on
  await chrome.storage.local.set({ settings });
}

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === 'toggle-vanish') {
    for (const t of await meetTabs()) chrome.tabs.sendMessage(t.id, { snap: 'cmd', cmd: 'toggle' }).catch(() => {});
  } else if (cmd === 'toggle-enabled') {
    await flip('enabled');
  } else if (cmd === 'toggle-snap') {
    await flip('snap');
  }
});

// OFF = Snap switched off, II = snap detection paused
function badge(settings) {
  const on = !settings || settings.enabled !== false;
  const listening = !settings || settings.snap !== false;
  chrome.action.setBadgeText({ text: !on ? 'OFF' : listening ? '' : 'II' });
  chrome.action.setBadgeBackgroundColor({ color: '#55555f' });
}

chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings) badge(ch.settings.newValue); });
const init = async () => badge((await chrome.storage.local.get('settings')).settings);
chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);
