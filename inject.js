// Snap: hooks the camera in Google Meet, runs the vanish state machine,
// talks to the extension (popup, shortcuts) through bridge.js, and draws the
// small control pill.
(() => {
  'use strict';
  const S = (window.__snap = window.__snap || {});
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia || S.installed) return;
  S.installed = true;

  const DEFAULTS = { enabled: true, effect: 'dust', duration: 2000, snap: true, sens: 9, pill: true, countdown: 5 };
  const settings = Object.assign({}, DEFAULTS);
  const shared = {
    enabled: true, mode: 'live', t0: 0, t: 0, dur: 2000, effect: 'dust', transId: 0,
    bg: null, bgVer: 0, bgFlip: false, bgSource: null, bgTs: 0, pendingFlip: false,
    active: null, pipes: new Set(), onFrame: null, onChange: null,
  };
  S.shared = shared;
  S.settings = settings;
  const origGUM = md.getUserMedia.bind(md);

  let uiRefresh = () => {};
  let flashMsg = '', flashUntil = 0;
  let countdown = 0;           // >0 counting, -1 saving, 0 idle
  let snapState = 'off';       // off | starting | on | error
  let detector = null;

  function flash(msg, ms = 2200) { flashMsg = msg; flashUntil = performance.now() + ms; uiRefresh(); setTimeout(uiRefresh, ms + 50); }
  shared.onChange = () => { uiRefresh(); };

  // ---------- talking to bridge.js (isolated world) ----------
  const post = (msg) => window.postMessage(Object.assign({ snapTo: 'bridge' }, msg), location.origin);

  function status() {
    const m = S.snapMeter;
    const mic = { level: m.level, trigger: m.trigger, heardAt: m.heardAt, state: m.state };
    m.level = 0;   // peak since the last read
    return {
      mic,
      enabled: shared.enabled, mode: shared.mode, camera: !!shared.active, bg: !!shared.bg,
      bgSource: shared.bgSource, effect: settings.effect, countdown, snap: snapState,
      flash: performance.now() < flashUntil ? flashMsg : '',
    };
  }

  function saveSettings(patch) { post({ type: 'saveSettings', patch }); }

  function applySettings(next) {
    const wasEnabled = settings.enabled;
    for (const k of Object.keys(DEFAULTS)) if (next && next[k] !== undefined) settings[k] = next[k];
    shared.enabled = !!settings.enabled;
    S.setSensitivity(Number(settings.sens));
    if (wasEnabled && !shared.enabled) {
      // switching off: come back instantly and stop everything heavy
      shared.mode = 'live';
      shared.pipes.forEach((p) => { p.parts.length = 0; });
      countdown = 0;
    }
    updateDetector();
    uiRefresh();
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.snapTo !== 'page') return;
    const m = ev.data;
    if (m.type === 'env') { if (typeof m.workletUrl === 'string' && m.workletUrl.startsWith('chrome-extension://')) S.workletUrl = m.workletUrl; }
    else if (m.type === 'settings') applySettings(m.settings);
    else if (m.type === 'bg') receiveBg(m.bg);
    else if (m.type === 'cmd') {
      if (m.cmd === 'toggle') toggle();
      else if (m.cmd === 'capture') startCapture();
      else if (m.cmd === 'enable') { applySettings({ enabled: !settings.enabled }); saveSettings({ enabled: settings.enabled }); }
      post({ type: 'reply', id: m.id, status: status() });
    }
  });

  // ---------- background (empty room or uploaded image) ----------
  function canvasToDataUrl(c) {
    // keep it small enough for extension storage
    const max = 1280, s = Math.min(1, max / c.width);
    let src = c;
    if (s < 1) {
      src = S.mkCanvas(Math.round(c.width * s), Math.round(c.height * s));
      src.getContext('2d').drawImage(c, 0, 0, src.width, src.height);
    }
    return src.toDataURL('image/jpeg', 0.9);
  }

  async function dataUrlToCanvas(url) {
    // decode by hand: Meet's page rules may block loading data: URLs as images
    const b64 = url.slice(url.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes]));
    const c = S.mkCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close && bmp.close();
    return c;
  }

  function setBg(canvas, source, ts) {
    shared.bg = canvas;
    shared.bgSource = canvas ? source : null;
    shared.bgTs = ts || 0;
    shared.bgFlip = false;
    shared.pendingFlip = !!canvas && source === 'upload';
    shared.bgVer++;
    shared.mode = 'live';
    shared.pipes.forEach((p) => { p.parts.length = 0; });
    uiRefresh();
  }

  async function receiveBg(bg) {
    if (!bg || !bg.dataUrl) { if (shared.bg) setBg(null); return; }
    if (bg.ts && bg.ts === shared.bgTs) return;       // our own save echoing back
    try { setBg(await dataUrlToCanvas(bg.dataUrl), bg.source, bg.ts); }
    catch (e) { console.warn('[snap] could not load the saved background', e); }
  }

  function storeBg(canvas, source) {
    const ts = Date.now();
    setBg(canvas, source, ts);
    try { post({ type: 'saveBg', bg: { dataUrl: canvasToDataUrl(canvas), source, ts } }); }
    catch (e) { console.warn('[snap] could not save the background', e); }
  }

  // An uploaded image (for example the same picture set as the macOS camera
  // background) may be mirrored compared to the camera. Pick whichever
  // orientation matches the live frame better.
  function checkFlip() {
    const p = shared.active;
    if (!shared.pendingFlip || !p || !shared.bg || p.video.readyState < 2) return;
    shared.pendingFlip = false;
    try {
      const flip = p.scoreBg(shared.bg, true) < p.scoreBg(shared.bg, false) * 0.9;
      if (flip !== shared.bgFlip) { shared.bgFlip = flip; shared.bgVer++; }
    } catch (e) { /* ignore */ }
  }

  function beep(freq, ms) {
    const ac = detector && detector.ac;
    if (!ac || ac.state !== 'running') return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = freq; g.gain.value = 0.06;
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + ms / 1000);
  }

  function startCapture() {
    if (!shared.enabled) return flash('snap is off');
    const p = shared.active;
    if (!p) return flash('no camera yet');
    if (countdown) return;
    shared.mode = 'live';
    countdown = Math.max(1, Math.min(15, Number(settings.countdown) || 5));
    uiRefresh();
    beep(660, 90);
    const tick = setInterval(() => {
      countdown--;
      if (countdown > 0) { beep(660, 90); uiRefresh(); return; }
      clearInterval(tick);
      const pipe = shared.active || p;
      if (!shared.enabled || pipe.dead) { countdown = 0; uiRefresh(); return; }
      countdown = -1;
      uiRefresh();
      pipe.captureBg().then((c) => {
        countdown = 0;
        storeBg(c, 'capture');
        beep(990, 160);
        flash('room saved, come back in');
      }).catch((e) => {
        countdown = 0;
        console.warn('[snap] capture failed', e);
        flash('capture failed, try again');
      });
    }, 1000);
  }
  S.capture = startCapture;

  async function uploadFile(file) {
    try {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, 1920 / bmp.width);
      const c = S.mkCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      storeBg(c, 'upload');
      flash('background loaded');
    } catch (e) {
      console.warn('[snap] upload failed', e);
      flash('could not read that image');
    }
  }

  // ---------- vanish / return ----------
  function toggle() {
    if (!shared.enabled) return flash('snap is off');
    if (!shared.active) return flash('no camera yet');
    if (!shared.bg) return flash('set a background first');
    const now = performance.now();
    S.tick(shared, now);
    const dur = Math.max(500, Math.min(6000, Number(settings.duration) || 2000));
    if (shared.mode === 'live' || shared.mode === 'gone') {
      const fx = S.effects[settings.effect] ? settings.effect : 'dust';
      // coming back uses the same effect you left with, in reverse
      if (shared.mode === 'live') shared.effect = fx;
      shared.mode = shared.mode === 'live' ? 'out' : 'in';
      shared.dur = dur * (S.effects[shared.effect].durScale || 1);
      shared.t0 = now;
      shared.t = 0;
      shared.transId++;
    } else {
      // mid-way: turn around from where we are, no waiting
      shared.mode = shared.mode === 'out' ? 'in' : 'out';
      shared.t0 = now - (1 - shared.t) * shared.dur;
      shared.t = 1 - shared.t;
    }
    uiRefresh();
  }
  S.toggle = toggle;

  // safety net: finish transitions even if no frames are being drawn
  setInterval(() => S.tick(shared, performance.now()), 250);

  // ---------- snap detection (only while enabled and a camera is open) ----------
  async function updateDetector() {
    const want = shared.enabled && settings.snap && !!shared.active;
    if (want && !detector && snapState !== 'starting') {
      snapState = 'starting';
      try {
        const d = await S.startSnapDetector(origGUM, () => toggle());
        const stillWant = shared.enabled && settings.snap && !!shared.active;
        if (!stillWant) { d.stop(); snapState = 'off'; }
        else { detector = d; snapState = 'on'; }
      } catch (e) {
        console.warn('[snap] mic snap detection unavailable', e);
        snapState = 'error';
        flash('snap sound off, use the button');
      }
      uiRefresh();
    } else if (!want && detector) {
      detector.stop();
      detector = null;
      snapState = 'off';
      uiRefresh();
    } else if (!want && snapState === 'error') snapState = 'off';
  }

  // ---------- camera hook ----------
  md.getUserMedia = async function (constraints) {
    if (!constraints || !constraints.video) return origGUM(constraints);
    const real = await origGUM(constraints);
    try {
      const vt = real.getVideoTracks()[0];
      if (!vt) return real;
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([vt]);
      await new Promise((res) => {
        video.onloadedmetadata = res;
        setTimeout(res, 3000);
      });
      await video.play().catch(() => {});

      const pipe = new S.Pipeline(video, shared);
      shared.pipes.add(pipe);
      shared.active = pipe;
      pipe.start();

      const outTrack = pipe.canvas.captureStream(30).getVideoTracks()[0];
      const realStop = outTrack.stop.bind(outTrack);
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        pipe.destroy();
        try { vt.stop(); } catch (e) { /* ignore */ }
        updateDetector();
        uiRefresh();
      };
      outTrack.stop = () => { realStop(); cleanup(); };
      vt.addEventListener('ended', () => { cleanup(); try { outTrack.dispatchEvent(new Event('ended')); } catch (e) { /* ignore */ } });
      const vs = vt.getSettings ? vt.getSettings() : {};
      outTrack.getSettings = () => Object.assign({}, vs, { width: pipe.W, height: pipe.H });
      outTrack.applyConstraints = async () => {};
      try { Object.defineProperty(outTrack, 'label', { value: vt.label }); } catch (e) { /* ignore */ }

      updateDetector();
      uiRefresh();
      return new MediaStream([outTrack, ...real.getAudioTracks()]);
    } catch (e) {
      console.warn('[snap] falling back to the normal camera', e);
      return real;
    }
  };

  // ---------- UI ----------
  function mountUI() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;top:12px;left:12px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    // built with DOM calls, not innerHTML: Meet enforces Trusted Types and
    // would silently block innerHTML
    const el = (tag, props, kids) => {
      const n = document.createElement(tag);
      Object.assign(n, props || {});
      (kids || []).forEach((k) => n.appendChild(k));
      return n;
    };
    const style = el('style', { textContent: `
        *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
        .pill{display:flex;align-items:center;gap:8px;background:rgba(14,14,16,.88);color:#e9e9ee;
          border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:6px 12px;font-size:12px;
          backdrop-filter:blur(8px);user-select:none;cursor:pointer;width:max-content}
        .dot{width:8px;height:8px;border-radius:50%;background:#6b6b76}
        .dot.armed{background:#7cf0b4}.dot.gone{background:#b48cff}.dot.warn{background:#ffb86b}
        .panel{display:none;margin-top:8px;background:rgba(14,14,16,.94);color:#e9e9ee;border:1px solid rgba(255,255,255,.12);
          border-radius:14px;padding:10px;font-size:12px;gap:8px;flex-direction:column;width:230px}
        .panel.open{display:flex}
        .row{display:flex;gap:6px}.row>*{flex:1}
        button,select{background:#23232a;color:#e9e9ee;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:7px 10px;
          font-size:12px;cursor:pointer}
        button:hover{background:#2e2e37}
        button.main{background:#6d4cff;border-color:#8a70ff}button.main:hover{background:#7d60ff}
        label{display:flex;flex-direction:column;gap:4px;color:#a9a9b6}
        input[type=range]{width:100%}
        .hint{color:#8d8d9a;line-height:1.4}
      ` });
    const range = el('input', { id: 'sens', type: 'range', min: '3', max: '14', step: '0.5', dir: 'rtl' });
    const sel = el('select', { id: 'fx' }, S.effectList.map((k) =>
      el('option', { value: k, textContent: S.effects[k].label })));
    const file = el('input', { id: 'file', type: 'file', accept: 'image/*' });
    file.style.display = 'none';
    const panel = el('div', { className: 'panel', id: 'panel' }, [
      el('div', { className: 'row' }, [
        el('button', { id: 'tg', className: 'main', textContent: 'vanish / return' }),
        el('button', { id: 'ps', textContent: 'pause snap' }),
      ]),
      el('label', { textContent: 'effect' }, [sel]),
      el('div', { className: 'row' }, [
        el('button', { id: 'cap', textContent: 'capture room' }),
        el('button', { id: 'up', textContent: 'upload image' }),
      ]),
      file,
      el('label', { textContent: 'snap sensitivity' }, [range]),
      el('div', { className: 'hint', textContent: 'Capture: step out of frame and wait for the beep. Upload: use the same picture as your Mac camera background. Cmd/Ctrl + Shift + X vanishes, Alt/Option + Shift + P pauses the snap, Cmd/Ctrl + Shift + H hides this. More in the toolbar icon.' }),
    ]);
    const pill = el('div', { className: 'pill', id: 'pill' }, [
      el('span', { className: 'dot', id: 'dot' }),
      el('span', { id: 'st', textContent: 'snap' }),
    ]);
    [style, pill, panel].forEach((n) => root.appendChild(n));
    const $ = (id) => root.getElementById(id);
    let open = false;

    function render() {
      host.style.display = settings.enabled && settings.pill ? '' : 'none';
      $('panel').classList.toggle('open', open);
      const dot = $('dot'), st = $('st');
      let txt, cls = '';
      if (performance.now() < flashUntil) { txt = flashMsg; cls = 'warn'; }
      else if (countdown > 0) { txt = 'step out... ' + countdown; cls = 'warn'; }
      else if (countdown < 0) { txt = 'saving the room...'; cls = 'warn'; }
      else if (!shared.active) { txt = 'snap: waiting for camera'; }
      else if (!shared.bg) { txt = 'snap: set a background'; cls = 'warn'; }
      else if (shared.mode === 'gone') { txt = 'vanished'; cls = 'gone'; }
      else if (shared.mode === 'live' && !settings.snap) { txt = 'snap paused'; cls = 'warn'; }
      else if (shared.mode === 'live') { txt = snapState === 'on' ? 'armed, snap to vanish' : 'armed'; cls = 'armed'; }
      else txt = shared.mode === 'out' ? 'vanishing' : 'returning';
      dot.className = 'dot ' + cls;
      st.textContent = txt;
      if (root.activeElement !== sel) sel.value = S.effects[settings.effect] ? settings.effect : 'dust';
      if (root.activeElement !== range) range.value = settings.sens;
      $('ps').textContent = settings.snap ? 'pause snap' : 'resume snap';
    }
    uiRefresh = render;
    shared.onFrame = (() => { let last = 0; return () => { checkFlip(); const n = performance.now(); if (n - last > 250) { last = n; render(); } }; })();

    $('pill').addEventListener('click', () => { open = !open; render(); });
    $('tg').addEventListener('click', toggle);
    $('ps').addEventListener('click', () => {
      applySettings({ snap: !settings.snap });
      saveSettings({ snap: settings.snap });
      flash(settings.snap ? 'snap listening again' : 'snap paused', 1500);
    });
    $('cap').addEventListener('click', () => { open = false; startCapture(); });
    $('up').addEventListener('click', () => file.click());
    file.addEventListener('change', () => { if (file.files[0]) uploadFile(file.files[0]); file.value = ''; });
    sel.addEventListener('change', () => { settings.effect = sel.value; saveSettings({ effect: sel.value }); });
    range.addEventListener('input', () => { settings.sens = parseFloat(range.value); S.setSensitivity(settings.sens); });
    range.addEventListener('change', () => saveSettings({ sens: settings.sens }));

    window.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.code === 'KeyX') { e.preventDefault(); toggle(); }
      if (e.code === 'KeyH') { e.preventDefault(); settings.pill = !settings.pill; saveSettings({ pill: settings.pill }); render(); }
    }, true);

    (document.body || document.documentElement).appendChild(host);
    render();
    setInterval(render, 1000);
  }

  const safeMount = () => { try { mountUI(); } catch (e) { console.error('[snap] could not draw the control pill', e); } };
  if (document.body) safeMount();
  else document.addEventListener('DOMContentLoaded', safeMount);
  post({ type: 'hello' });
})();
