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
  const MIN_ABS = 0.006;   // never trigger below this, whatever the room
  const MAX_BURST = 110;   // ms, longer than this is not a snap
  const COOLDOWN = 1200;   // ms between two snaps
  const BRIGHT = 0.18;     // share of the energy above 2 kHz

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
    // ScriptProcessor is old but it needs no extra files, so Meet's page
    // security rules cannot block it
    const sp = ac.createScriptProcessor(CHUNK, 2, 1);
    const mute = ac.createGain();
    mute.gain.value = 0;
    merge.connect(sp); sp.connect(mute); mute.connect(ac.destination);

    // Chrome starts audio "asleep" until the page gets a click or key press
    const resume = () => { if (ac.state === 'suspended') ac.resume().catch(() => {}); };
    ['pointerdown', 'keydown', 'click'].forEach((ev) => window.addEventListener(ev, resume, true));
    const wake = setInterval(resume, 2000);
    resume();

    const meter = S.snapMeter;
    let floor = 0.002;
    let state = 'idle';            // idle | burst | reject
    let peak = 0, t0 = 0, lastFire = -1e9, rejectAt = 0;
    let frames = 0;
    const hist = [0, 0, 0];        // high-band level of the previous chunks

    sp.onaudioprocess = (e) => {
      const raw = e.inputBuffer.getChannelData(0);
      const hi = e.inputBuffer.getChannelData(1);
      let sr = 0, sh = 0;
      for (let i = 0; i < hi.length; i++) { sr += raw[i] * raw[i]; sh += hi[i] * hi[i]; }
      const rmsR = Math.sqrt(sr / raw.length), rms = Math.sqrt(sh / hi.length);
      // time from the sample count: exact even when callbacks arrive in bursts
      const now = (frames * CHUNK * 1000) / ac.sampleRate;
      frames++;

      // noise floor: drops quickly, rises slowly, never gets stuck
      floor += (rms - floor) * (rms < floor ? 0.2 : 0.003);
      if (floor < 0.0003) floor = 0.0003;
      const trigger = Math.max(floor * S.sensitivity, MIN_ABS);
      // quiet just before (skipping the chunk right before, which may hold the attack)
      const before = Math.max(hist[0], hist[1]);
      meter.level = Math.max(meter.level, rms);
      meter.trigger = trigger;
      meter.state = ac.state;

      if (state === 'idle') {
        if (rms > trigger && before < trigger * 0.35 && rms > rmsR * BRIGHT) { state = 'burst'; peak = rms; t0 = now; }
      } else if (state === 'burst') {
        peak = Math.max(peak, rms);
        const dur = now - t0;
        if (dur > MAX_BURST) { state = 'reject'; rejectAt = now; }
        else if (rms < peak * 0.3) {
          state = 'idle';
          if (now - lastFire > COOLDOWN) {
            lastFire = now;
            meter.heardAt = Date.now();
            try { onSnap({ peak, dur }); } catch (err) { console.warn('[snap]', err); }
          }
        }
      } else if (rms < trigger * 0.5 || now - rejectAt > 400) {
        state = 'idle';
      }
      hist[0] = hist[1]; hist[1] = hist[2]; hist[2] = rms;
    };

    return {
      ac,
      stop() {
        sp.onaudioprocess = null;
        clearInterval(wake);
        stream.getTracks().forEach((t) => t.stop());
        ['pointerdown', 'keydown', 'click'].forEach((ev) => window.removeEventListener(ev, resume, true));
        ac.close().catch(() => {});
        meter.state = 'off';
      },
    };
  };
})();
