// Snap: finger snap detector.
// Listens to the microphone (raw, without the browser's noise suppression,
// which would eat the click) and looks for a short, sudden, bright burst:
// much louder than the room a moment before, mostly high frequencies, and
// over within ~100 ms. Claps work too.
(() => {
  'use strict';
  const S = (window.__snap = window.__snap || {});

  S.sensitivity = 9; // multiplier over the room noise floor, lower = more sensitive
  S.setSensitivity = (v) => { if (v >= 2 && v <= 20) S.sensitivity = v; };

  // live numbers for the popup meter
  S.snapMeter = { level: 0, trigger: 0, heardAt: 0, state: 'off' };

  const CHUNK = 256;       // samples per analysis step (~5 ms)
  const MIN_ABS = 0.0024;  // x sensitivity: never trigger below this, whatever the room
  const MAX_BURST = 90;    // ms, longer than this is not a snap
  const COOLDOWN = 1000;   // ms between two snaps
  const BRIGHT = 0.3;      // share of the energy above 2 kHz
  const QUIET_BEFORE = 50; // chunks (~270 ms) that must be quiet before a snap
  const ALONE_AFTER = 220; // ms with no other click after it (typing is many clicks)

  S.startSnapDetector = async function (getUserMedia, onSnap) {
    const stream = await getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const src = ac.createMediaStreamSource(stream);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    // channel 0 = raw mic, channel 1 = only the high frequencies
    const merge = ac.createChannelMerger(2);
    src.connect(merge, 0, 0);
    src.connect(hp); hp.connect(merge, 0, 1);
    const mute = ac.createGain();
    mute.gain.value = 0;
    mute.connect(ac.destination);
    // Chrome starts audio "asleep" until the page gets a click or key press
    const resume = () => { if (ac.state === 'suspended') ac.resume().catch(() => {}); };
    ['pointerdown', 'keydown', 'click'].forEach((ev) => window.addEventListener(ev, resume, true));
    const wake = setInterval(resume, 2000);
    resume();

    const meter = S.snapMeter;
    let floor = 0.002;
    let state = 'idle';            // idle | burst | confirm | reject
    let peak = 0, t0 = 0, tEnd = 0, lastFire = -1e9, rejectAt = 0, dur = 0;
    const hist = new Float32Array(QUIET_BEFORE);   // high-band level of the previous chunks
    const histR = new Float32Array(QUIET_BEFORE);  // full-band level (voices, hums)
    let hp_ = 0, peakR = 0, rawBefore = 0;

    // one analysis step: full-band level, high-band level, time in ms
    function step(rmsR, rms, now) {
      // noise floor: drops quickly, rises slowly, never gets stuck
      floor += (rms - floor) * (rms < floor ? 0.2 : 0.003);
      if (floor < 0.0003) floor = 0.0003;
      const trigger = Math.max(floor * S.sensitivity, MIN_ABS * S.sensitivity);
      // quiet just before (skipping the chunk right before, which may hold the attack)
      let before = 0, beforeR = 0;
      for (let k = 0; k < QUIET_BEFORE - 1; k++) {
        const q = (hp_ + k) % QUIET_BEFORE;
        if (hist[q] > before) before = hist[q];
        if (histR[q] > beforeR) beforeR = histR[q];
      }
      meter.level = Math.max(meter.level, rms);
      meter.trigger = trigger;
      meter.state = ac.state;

      if (state === 'idle') {
        if (rms > trigger && before < trigger * 0.3 && rms > rmsR * BRIGHT) { state = 'burst'; peak = rms; peakR = rmsR; rawBefore = beforeR; t0 = now; }
      } else if (state === 'burst') {
        peak = Math.max(peak, rms);
        peakR = Math.max(peakR, rmsR);
        dur = now - t0;
        if (dur > MAX_BURST) { state = 'reject'; rejectAt = now; }
        // someone was already talking: a consonant, not a snap
        else if (rawBefore > peakR * 0.2) { state = 'reject'; rejectAt = now; }
        else if (rms < peak * 0.25) { state = 'confirm'; tEnd = now; }
      } else if (state === 'confirm') {
        // a second click right after means typing, knocking or talking
        if (rms > Math.max(trigger * 0.5, peak * 0.35) || rmsR > peakR * 0.3) { state = 'reject'; rejectAt = now; }
        else if (now - tEnd > ALONE_AFTER) {
          state = 'idle';
          if (now - lastFire > COOLDOWN) {
            lastFire = now;
            meter.heardAt = Date.now();
            try { onSnap({ peak, dur }); } catch (err) { console.warn('[snap]', err); }
          }
        }
      } else if ((rms < trigger * 0.4 && now - rejectAt > 150) || now - rejectAt > 600) {
        state = 'idle';
      }
      hist[hp_] = rms; histR[hp_] = rmsR; hp_ = (hp_ + 1) % QUIET_BEFORE;
    }

    // Preferred: an AudioWorklet (modern, off the main thread). The module is
    // an extension file; bridge.js tells us its URL. If Meet's page rules
    // block it, fall back to the old ScriptProcessor.
    let node = null, sp = null;
    try {
      if (!S.workletUrl || !ac.audioWorklet) throw new Error('no worklet');
      await Promise.race([
        ac.audioWorklet.addModule(S.workletUrl),
        new Promise((_, no) => setTimeout(() => no(new Error('worklet load timed out')), 3000)),
      ]);
      node = new AudioWorkletNode(ac, 'snap-meter', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
      node.port.onmessage = (ev) => { const [r, h, frame] = ev.data; step(r, h, (frame * 1000) / ac.sampleRate); };
      merge.connect(node); node.connect(mute);
    } catch (err) {
      console.info('[snap] audio worklet unavailable, using the fallback', err && err.message);
      let frames = 0;
      sp = ac.createScriptProcessor(CHUNK, 2, 1);
      sp.onaudioprocess = (e) => {
        const raw = e.inputBuffer.getChannelData(0), hi = e.inputBuffer.getChannelData(1);
        let sr = 0, sh = 0;
        for (let i = 0; i < hi.length; i++) { sr += raw[i] * raw[i]; sh += hi[i] * hi[i]; }
        step(Math.sqrt(sr / raw.length), Math.sqrt(sh / hi.length), (frames++ * CHUNK * 1000) / ac.sampleRate);
      };
      merge.connect(sp); sp.connect(mute);
    }

    return {
      ac,
      stop() {
        if (node) node.port.onmessage = null;
        if (sp) sp.onaudioprocess = null;
        clearInterval(wake);
        stream.getTracks().forEach((t) => t.stop());
        ['pointerdown', 'keydown', 'click'].forEach((ev) => window.removeEventListener(ev, resume, true));
        ac.close().catch(() => {});
        meter.state = 'off';
      },
    };
  };
})();
