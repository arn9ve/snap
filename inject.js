// Snap: hooks the camera in Google Meet, adds the small control pill,
// and wires snap detection + hotkeys to the vanish effect.
(() => {
  'use strict';
  const S = (window.__snap = window.__snap || {});
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia || S.installed) return;
  S.installed = true;

  const shared = { mode: 'live', bg: null, bgVer: 0, active: null, onFrame: null };
  S.shared = shared;
  const origGUM = md.getUserMedia.bind(md);

  let detectorStarted = false;
  let uiRefresh = () => {};
  let flashMsg = '', flashUntil = 0;

  function flash(msg, ms = 2200) { flashMsg = msg; flashUntil = performance.now() + ms; uiRefresh(); setTimeout(uiRefresh, ms + 50); }

  function toggle() {
    const p = shared.active;
    if (!p) return flash('no camera yet');
    const r = p.trigger();
    if (r === 'nobg') flash('capture the room first');
    uiRefresh();
  }
  S.toggle = toggle;

  async function startDetector() {
    if (detectorStarted) return;
    detectorStarted = true;
    try {
      await S.startSnapDetector(origGUM, () => toggle());
    } catch (e) {
      console.warn('[snap] mic snap detection unavailable', e);
      flash('snap sound off, use the button');
    }
  }

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
      pipe.start();
      shared.active = pipe;

      const outTrack = pipe.canvas.captureStream(30).getVideoTracks()[0];
      const realStop = outTrack.stop.bind(outTrack);
      const cleanup = () => { pipe.destroy(); try { vt.stop(); } catch (e) { /* ignore */ } };
      outTrack.stop = () => { realStop(); cleanup(); };
      vt.addEventListener('ended', () => { cleanup(); try { outTrack.dispatchEvent(new Event('ended')); } catch (e) { /* ignore */ } });
      const vs = vt.getSettings ? vt.getSettings() : {};
      outTrack.getSettings = () => Object.assign({}, vs, { width: pipe.W, height: pipe.H });
      outTrack.applyConstraints = async () => {};
      try { Object.defineProperty(outTrack, 'label', { value: vt.label }); } catch (e) { /* ignore */ }

      startDetector();
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
          backdrop-filter:blur(8px);user-select:none}
        .dot{width:8px;height:8px;border-radius:50%;background:#6b6b76}
        .dot.armed{background:#7cf0b4}.dot.gone{background:#b48cff}.dot.warn{background:#ffb86b}
        #st{cursor:pointer;letter-spacing:.02em}
        .panel{display:none;margin-top:8px;background:rgba(14,14,16,.92);color:#e9e9ee;border:1px solid rgba(255,255,255,.12);
          border-radius:14px;padding:10px;font-size:12px;gap:8px;flex-direction:column;width:210px}
        .panel.open{display:flex}
        button{background:#23232a;color:#e9e9ee;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:7px 10px;
          font-size:12px;cursor:pointer}
        button:hover{background:#2e2e37}
        label{display:flex;flex-direction:column;gap:4px;color:#a9a9b6}
        input{width:100%}
        .hint{color:#8d8d9a;line-height:1.4}
      ` });
    const range = el('input', { id: 'sens', type: 'range', min: '3', max: '14', step: '0.5' });
    const panel = el('div', { className: 'panel', id: 'panel' }, [
      el('button', { id: 'cap', textContent: 'capture empty room' }),
      el('button', { id: 'tg', textContent: 'vanish / return' }),
      el('label', { textContent: 'snap sensitivity' }, [range]),
      el('div', { className: 'hint', textContent: 'Step out of frame, press capture, wait 3 seconds. Then snap. Cmd or Ctrl + Shift + X also works. Cmd or Ctrl + Shift + H hides this.' }),
    ]);
    const pill = el('div', { className: 'pill' }, [
      el('span', { className: 'dot', id: 'dot' }),
      el('span', { id: 'st', textContent: 'snap' }),
    ]);
    [style, pill, panel].forEach((n) => root.appendChild(n));
    const $ = (id) => root.getElementById(id);
    let open = false, countdown = 0;

    function render() {
      const panel = $('panel');
      panel.classList.toggle('open', open);
      const dot = $('dot'), st = $('st');
      let txt, cls = '';
      if (performance.now() < flashUntil) { txt = flashMsg; cls = 'warn'; }
      else if (countdown > 0) { txt = 'step out... ' + countdown; cls = 'warn'; }
      else if (countdown < 0) { txt = 'saving the room...'; cls = 'warn'; }
      else if (!shared.active) { txt = 'snap: waiting for camera'; }
      else if (!shared.bg) { txt = 'snap: capture the room'; cls = 'warn'; }
      else if (shared.mode === 'gone') { txt = 'vanished'; cls = 'gone'; }
      else if (shared.mode === 'live') { txt = 'armed'; cls = 'armed'; }
      else txt = shared.mode === 'vanishing' ? 'vanishing' : 'returning';
      dot.className = 'dot ' + cls;
      st.textContent = txt;
    }
    uiRefresh = render;
    shared.onFrame = (() => { let last = 0; return () => { const n = performance.now(); if (n - last > 250) { last = n; render(); } }; })();

    $('st').addEventListener('click', () => { open = !open; render(); });
    $('tg').addEventListener('click', toggle);
    $('cap').addEventListener('click', () => {
      const p = shared.active;
      if (!p) return flash('no camera yet');
      countdown = 3;
      render();
      const tick = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
          clearInterval(tick);
          countdown = -1;
          render();
          p.captureBg().then(() => { countdown = 0; open = false; flash('room saved'); });
        }
        render();
      }, 1000);
    });
    const sens = $('sens');
    sens.value = S.sensitivity;
    sens.addEventListener('input', () => S.setSensitivity(parseFloat(sens.value)));

    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyX') { e.preventDefault(); toggle(); }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyH') { e.preventDefault(); host.style.display = host.style.display === 'none' ? '' : 'none'; }
    }, true);

    (document.body || document.documentElement).appendChild(host);
    render();
    setInterval(render, 1000);
  }

  const safeMount = () => { try { mountUI(); } catch (e) { console.error('[snap] could not draw the control pill', e); } };
  if (document.body) safeMount();
  else document.addEventListener('DOMContentLoaded', safeMount);
})();
