// Snap: video pipeline.
// Draws the real camera onto a canvas. During a transition the person (found
// by comparing the live frame with the saved background) is cut out and handed
// to the selected effect in effects.js, which makes them vanish or come back.
//
// State lives in `shared` and is driven by time, not by any one pipeline, so
// Meet can open several camera tracks (preview + call) without them fighting
// over the mode, and a transition always finishes even if a frame is missed.
(() => {
  'use strict';
  const S = (window.__snap = window.__snap || {});

  const WORK_W = 480;          // width of the low-res mask
  const DIFF_T = 70;           // colour difference that counts as "person"
  const MAX_PARTICLES = 4500;
  const BG_FRAMES = 14;        // frames averaged for the empty room photo
  S.P_MIN = -0.05;
  S.P_MAX = 1.05;

  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  S.mkCanvas = mkCanvas;

  function blurH(src, dst, w, h, r) {
    const k = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        dst[row + x] = (sum / k) | 0;
        sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
  }

  function blurV(src, dst, w, h, r) {
    const k = 2 * r + 1;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += src[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = (sum / k) | 0;
        sum += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
      }
    }
  }

  function blur(a, tmp, w, h, r) { blurH(a, tmp, w, h, r); blurV(tmp, a, w, h, r); }

  S.smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  S.ease = (t) => 0.5 * t + 0.5 * (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

  // Advance the shared state machine. Modes: live, out (vanishing), gone,
  // in (coming back). Returns q: 0 = fully visible, 1 = fully gone.
  S.tick = function (sh, now) {
    if (sh.mode === 'out' || sh.mode === 'in') {
      const t = Math.min(1, Math.max(0, (now - sh.t0) / sh.dur));
      sh.t = t;
      if (t >= 1) {
        sh.mode = sh.mode === 'out' ? 'gone' : 'live';
        if (sh.onChange) sh.onChange();
      }
    }
    if (sh.mode === 'out') return sh.t;
    if (sh.mode === 'in') return 1 - sh.t;
    return sh.mode === 'gone' ? 1 : 0;
  };

  // Draw an image into a canvas the way macOS / most apps fill a camera
  // frame: scaled to cover, centred, optionally mirrored.
  function drawCover(ctx, img, W, H, flip) {
    const iw = img.width || img.videoWidth, ih = img.height || img.videoHeight;
    const s = Math.max(W / iw, H / ih);
    const dw = iw * s, dh = ih * s;
    ctx.save();
    if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
  }

  class Pipeline {
    constructor(video, shared) {
      this.video = video;
      this.sh = shared;
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      const scale = Math.min(1, 1280 / vw);
      this.W = Math.max(2, Math.round((vw * scale) / 2) * 2);
      this.H = Math.max(2, Math.round((vh * scale) / 2) * 2);
      this.WW = Math.min(WORK_W, this.W);
      this.HH = Math.max(2, Math.round((this.WW * this.H) / this.W));

      this.canvas = mkCanvas(this.W, this.H);
      this.ctx = this.canvas.getContext('2d');
      this.layer = mkCanvas(this.W, this.H);
      this.layerCtx = this.layer.getContext('2d');
      this.fx = mkCanvas(this.W, this.H);            // scratch canvas for effects
      this.fxCtx = this.fx.getContext('2d');
      this.bgFull = mkCanvas(this.W, this.H);
      this.small = mkCanvas(this.WW, this.HH);
      this.smallCtx = this.small.getContext('2d', { willReadFrequently: true });
      this.alphaC = mkCanvas(this.WW, this.HH);
      this.alphaCtx = this.alphaC.getContext('2d');
      this.alphaImg = this.alphaCtx.createImageData(this.WW, this.HH);
      this.glowC = mkCanvas(this.WW, this.HH);
      this.glowCtx = this.glowC.getContext('2d');
      this.glowImg = this.glowCtx.createImageData(this.WW, this.HH);

      const n = this.WW * this.HH;
      this.n = n;
      this.mask = new Uint8Array(n);
      this.maskAvg = new Float32Array(n);
      this.tmp = new Uint8Array(n);
      this.bin = new Uint8Array(n);
      this.labels = new Int32Array(n);
      this.stack = new Int32Array(n);
      this.thrCache = {};
      this.box = { cx: this.W / 2, cy: this.H / 2, w: this.W / 3, h: this.H / 2 };

      this.bgVer = -1;
      this.bgSmall = null;
      this.parts = [];
      this.transId = -1;
      this.prevE = null;
      this.maskFrames = 0;
      this.last = performance.now();
      this.timer = null;
      this.dead = false;
    }

    start() {
      this.timer = setInterval(() => this.frame(), 1000 / 30);
      this.frame();
    }

    destroy() {
      this.dead = true;
      clearInterval(this.timer);
      this.sh.pipes.delete(this);
      if (this.sh.active === this) {
        // hand over to another live pipeline if Meet still has one open
        const rest = [...this.sh.pipes];
        this.sh.active = rest[rest.length - 1] || null;
      }
    }

    // Save the empty room. Averages several frames so camera noise is
    // smoothed out and the later comparison is cleaner. Returns a canvas.
    async captureBg() {
      const { W, H } = this;
      const grab = mkCanvas(W, H);
      const gctx = grab.getContext('2d', { willReadFrequently: true });
      const acc = new Float32Array(W * H * 3);
      for (let f = 0; f < BG_FRAMES; f++) {
        gctx.drawImage(this.video, 0, 0, W, H);
        const d = gctx.getImageData(0, 0, W, H).data;
        for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { acc[j] += d[i]; acc[j + 1] += d[i + 1]; acc[j + 2] += d[i + 2]; }
        await new Promise((r) => setTimeout(r, 45));
      }
      const out = gctx.createImageData(W, H);
      for (let i = 0, j = 0; i < out.data.length; i += 4, j += 3) {
        out.data[i] = acc[j] / BG_FRAMES; out.data[i + 1] = acc[j + 1] / BG_FRAMES; out.data[i + 2] = acc[j + 2] / BG_FRAMES; out.data[i + 3] = 255;
      }
      gctx.putImageData(out, 0, 0);
      this.parts.length = 0;
      return grab;
    }

    // How different is the background image from what the camera sees right
    // now? Used to guess if an uploaded image needs mirroring.
    scoreBg(img, flip) {
      const { WW, HH } = this;
      const c = mkCanvas(WW, HH);
      const cx = c.getContext('2d', { willReadFrequently: true });
      drawCover(cx, img, WW, HH, flip);
      const b = cx.getImageData(0, 0, WW, HH).data;
      this.smallCtx.drawImage(this.video, 0, 0, WW, HH);
      const d = this.smallCtx.getImageData(0, 0, WW, HH).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 16) s += Math.abs(d[i] - b[i]) + Math.abs(d[i + 1] - b[i + 1]) + Math.abs(d[i + 2] - b[i + 2]);
      return s;
    }

    syncBg() {
      const sh = this.sh;
      const g = this.bgFull.getContext('2d');
      g.clearRect(0, 0, this.W, this.H);
      drawCover(g, sh.bg, this.W, this.H, sh.bgFlip);
      this.smallCtx.drawImage(this.bgFull, 0, 0, this.WW, this.HH);
      this.bgSmall = this.smallCtx.getImageData(0, 0, this.WW, this.HH).data.slice();
      this.bgVer = sh.bgVer;
    }

    // Threshold map for dissolve effects, built once per effect.
    thrFor(name, make) {
      if (!this.thrCache[name]) this.thrCache[name] = make(this.WW, this.HH);
      return this.thrCache[name];
    }

    // Find the person: compare the live frame with the background photo,
    // then clean the result (drop stray patches, fill holes, soften edges).
    computeMask(d) {
      const { WW, HH, n, bgSmall, bin, tmp, labels, stack, mask, maskAvg } = this;

      // 1. lighting can drift, so estimate the overall brightness shift from
      //    the pixels that look unchanged and ignore it
      let o0 = 0, o1 = 0, o2 = 0;
      for (let pass = 0; pass < 2; pass++) {
        let s0 = 0, s1 = 0, s2 = 0, c = 0;
        for (let i = 0; i < n; i += 3) {
          const j = i * 4;
          const e0 = d[j] - bgSmall[j] - o0, e1 = d[j + 1] - bgSmall[j + 1] - o1, e2 = d[j + 2] - bgSmall[j + 2] - o2;
          if (Math.abs(e0) + Math.abs(e1) + Math.abs(e2) < 70 || pass === 0) {
            s0 += e0 + o0; s1 += e1 + o1; s2 += e2 + o2; c++;
          }
        }
        if (c) { o0 = s0 / c; o1 = s1 / c; o2 = s2 / c; }
      }
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        const diff = Math.abs(d[j] - bgSmall[j] - o0) + Math.abs(d[j + 1] - bgSmall[j + 1] - o1) + Math.abs(d[j + 2] - bgSmall[j + 2] - o2);
        bin[i] = diff > DIFF_T ? 255 : 0;
      }

      // 2. remove speckle, then grow back a little
      blur(bin, tmp, WW, HH, 2);
      for (let i = 0; i < n; i++) bin[i] = bin[i] > 150 ? 255 : 0;
      blur(bin, tmp, WW, HH, 3);
      for (let i = 0; i < n; i++) bin[i] = bin[i] > 70 ? 1 : 0;

      // 3. keep only the big blob(s): the person, not lighting glitches
      labels.fill(0);
      const sizes = [0];
      let next = 0;
      for (let s = 0; s < n; s++) {
        if (!bin[s] || labels[s]) continue;
        next++;
        let sp = 0, size = 0;
        stack[sp++] = s; labels[s] = next;
        while (sp) {
          const p = stack[--sp]; size++;
          const x = p % WW;
          if (x > 0 && bin[p - 1] && !labels[p - 1]) { labels[p - 1] = next; stack[sp++] = p - 1; }
          if (x < WW - 1 && bin[p + 1] && !labels[p + 1]) { labels[p + 1] = next; stack[sp++] = p + 1; }
          if (p >= WW && bin[p - WW] && !labels[p - WW]) { labels[p - WW] = next; stack[sp++] = p - WW; }
          if (p < n - WW && bin[p + WW] && !labels[p + WW]) { labels[p + WW] = next; stack[sp++] = p + WW; }
        }
        sizes.push(size);
      }
      let largest = 0;
      for (let k = 1; k < sizes.length; k++) if (sizes[k] > largest) largest = sizes[k];
      const minKeep = Math.max(n * 0.015, largest * 0.25);
      for (let i = 0; i < n; i++) bin[i] = labels[i] && sizes[labels[i]] >= minKeep ? 1 : 0;

      // 4. fill holes: anything not connected to the frame edge and not
      //    person is inside the person
      labels.fill(0);
      let sp = 0;
      const seed = (p) => { if (!bin[p] && !labels[p]) { labels[p] = 1; stack[sp++] = p; } };
      for (let x = 0; x < WW; x++) { seed(x); seed((HH - 1) * WW + x); }
      for (let y = 0; y < HH; y++) { seed(y * WW); seed(y * WW + WW - 1); }
      while (sp) {
        const p = stack[--sp];
        const x = p % WW;
        if (x > 0) seed(p - 1);
        if (x < WW - 1) seed(p + 1);
        if (p >= WW) seed(p - WW);
        if (p < n - WW) seed(p + WW);
      }
      for (let i = 0; i < n; i++) mask[i] = bin[i] || !labels[i] ? 255 : 0;

      // 5. soft edge, plus a little smoothing over time so it does not flicker
      blur(mask, tmp, WW, HH, 2);
      const k = this.maskFrames === 0 ? 1 : 0.5;
      for (let i = 0; i < n; i++) maskAvg[i] += (mask[i] - maskAvg[i]) * k;
      this.maskFrames++;

      // 6. bounding box of the person, for effects that move the whole body
      let x0 = WW, y0 = HH, x1 = -1, y1 = -1;
      for (let y = 0; y < HH; y += 2) {
        const row = y * WW;
        for (let x = 0; x < WW; x += 2) {
          if (maskAvg[row + x] > 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
      }
      if (x1 >= 0) {
        const sx = this.W / WW, sy = this.H / HH;
        this.box = { cx: ((x0 + x1) / 2) * sx, cy: ((y0 + y1) / 2) * sy, w: (x1 - x0) * sx, h: (y1 - y0) * sy };
      }
    }

    // Cut the person out of the live video using a low-res alpha canvas.
    // Returns this.layer (full size, transparent around the person).
    matte(alphaCanvas) {
      const { W, H, layerCtx: lc } = this;
      lc.globalCompositeOperation = 'source-over';
      lc.clearRect(0, 0, W, H);
      lc.drawImage(this.video, 0, 0, W, H);
      lc.globalCompositeOperation = 'destination-in';
      lc.filter = 'blur(1.5px)';
      lc.drawImage(alphaCanvas, 0, 0, W, H);
      lc.filter = 'none';
      lc.globalCompositeOperation = 'source-over';
      return this.layer;
    }

    // Person matte with no dissolve applied (for effects that transform the
    // whole body instead of eating it pixel by pixel).
    fullMatte() {
      const a = this.alphaImg.data, m = this.maskAvg;
      for (let i = 0; i < this.n; i++) a[i * 4 + 3] = m[i];
      this.alphaCtx.putImageData(this.alphaImg, 0, 0);
      return this.matte(this.alphaC);
    }

    drawBg() { this.ctx.drawImage(this.bgFull, 0, 0, this.W, this.H); }

    // kind: dust | ember | wisp | drop | leaf | swirl. x, y in full-size pixels.
    spawn(kind, x, y, r, g, b, inward, extra) {
      if (this.parts.length >= MAX_PARTICLES) return;
      const p = { kind, x, y, r, g, b, age: 0, inward, size: 1.5 + Math.random() * 2.5, add: false };
      if (kind === 'dust') {
        p.life = 0.9 + Math.random() * 0.9;
        p.vx = 30 + Math.random() * 150; p.vy = -(20 + Math.random() * 110);
        p.ox = 60 + Math.random() * 160; p.oy = -(40 + Math.random() * 110);
      } else if (kind === 'ember') {
        p.life = 0.6 + Math.random() * 1.0;
        p.vx = (Math.random() - 0.5) * 40; p.vy = -(40 + Math.random() * 90);
        p.ox = (Math.random() - 0.5) * 60; p.oy = -(60 + Math.random() * 120);
        p.add = true; p.size = 1.5 + Math.random() * 2;
      } else if (kind === 'wisp') {
        p.life = 1.0 + Math.random() * 1.2;
        p.vx = (Math.random() - 0.5) * 20; p.vy = -(35 + Math.random() * 60);
        p.ox = (Math.random() - 0.5) * 40; p.oy = -(60 + Math.random() * 100);
        p.add = true; p.size = 2 + Math.random() * 4; p.soft = true;
      } else if (kind === 'drop') {
        p.life = 0.8 + Math.random() * 0.6;
        p.vx = (Math.random() - 0.5) * 10; p.vy = 20 + Math.random() * 60;
        p.size = 2 + Math.random() * 3;
      } else if (kind === 'leaf') {
        p.life = 1.0 + Math.random() * 0.8;
        p.vx = (Math.random() - 0.5) * 90; p.vy = -(20 + Math.random() * 70);
        p.ox = (Math.random() - 0.5) * 120; p.oy = -(30 + Math.random() * 90);
        p.size = 3 + Math.random() * 4;
      } else if (kind === 'swirl') {
        p.life = 0.6 + Math.random() * 0.5;
        p.cx = extra.cx; p.cy = extra.cy; p.ang = extra.ang; p.rad = extra.rad; p.rad0 = extra.rad;
        p.add = true; p.size = 1.5 + Math.random() * 2;
      }
      if (inward) { p.tx = x; p.ty = y; }
      this.parts.push(p);
    }

    updateParticles(dt) {
      const arr = this.parts;
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        p.age += dt;
        if (p.age >= p.life) continue;
        if (!p.inward) {
          if (p.kind === 'dust') { p.x += p.vx * dt; p.y += p.vy * dt; p.vx += 40 * dt; p.vy -= 15 * dt; }
          else if (p.kind === 'ember') { p.x += (p.vx + Math.sin(p.age * 9 + p.y) * 25) * dt; p.y += p.vy * dt; }
          else if (p.kind === 'wisp') { p.x += (p.vx + Math.sin(p.age * 3 + p.y * 0.02) * 30) * dt; p.y += p.vy * dt; }
          else if (p.kind === 'drop') { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; }
          else if (p.kind === 'leaf') { p.x += (p.vx + Math.sin(p.age * 6) * 40) * dt; p.y += p.vy * dt; p.vy += 220 * dt; p.vx *= 1 - dt; }
          else if (p.kind === 'swirl') {
            const u = p.age / p.life;
            p.ang += dt * (3 + 6 * u);
            p.rad = p.rad0 * (1 - u) * (1 - u);
            p.x = p.cx + Math.cos(p.ang) * p.rad; p.y = p.cy + Math.sin(p.ang) * p.rad * 0.8;
          }
        }
        arr[w++] = p;
      }
      arr.length = w;
    }

    drawParticles() {
      const ctx = this.ctx;
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalCompositeOperation = pass ? 'lighter' : 'source-over';
        for (const p of this.parts) {
          if (p.add !== !!pass) continue;
          const u = p.age / p.life;
          let x = p.x, y = p.y, a;
          if (p.inward) {
            const k = (1 - u) * (1 - u);
            x = p.tx + p.ox * k; y = p.ty + p.oy * k; a = Math.min(1, u * 1.6);
          } else {
            a = p.kind === 'ember' ? (1 - u) * (0.6 + 0.4 * Math.sin(p.age * 30)) : 1 - u;
          }
          ctx.globalAlpha = Math.max(0, a) * (p.soft ? 0.35 : 1);
          ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
          if (p.soft) { ctx.beginPath(); ctx.arc(x, y, p.size, 0, 6.2832); ctx.fill(); }
          else if (p.kind === 'leaf') { ctx.beginPath(); ctx.ellipse(x, y, p.size, p.size * 0.45, p.age * 4 + p.r, 0, 6.2832); ctx.fill(); }
          else ctx.fillRect(x, y, p.size, p.size);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    frame() {
      if (this.dead) return;
      const v = this.video;
      if (v.paused) v.play().catch(() => {});
      if (v.readyState < 2) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const sh = this.sh;
      const ctx = this.ctx;
      if (sh.bg && this.bgVer !== sh.bgVer) this.syncBg();
      const q = S.tick(sh, now);

      if (!sh.enabled || !sh.bg || sh.mode === 'live') {
        ctx.drawImage(v, 0, 0, this.W, this.H);
        this.prevE = null;
      } else if (sh.mode === 'gone') {
        this.drawBg();
        this.prevE = null;
      } else {
        this.transition(q, now);
      }
      this.updateParticles(dt);
      if (this.parts.length) this.drawParticles();
      if (sh.onFrame && sh.active === this) sh.onFrame();
    }

    transition(q, now) {
      const sh = this.sh;
      if (this.transId !== sh.transId) { this.transId = sh.transId; this.maskFrames = 0; this.prevE = null; }
      const e = S.ease(q);
      this.smallCtx.drawImage(this.video, 0, 0, this.WW, this.HH);
      const d = this.smallCtx.getImageData(0, 0, this.WW, this.HH).data;
      this.computeMask(d);
      const fx = (S.effects && S.effects[sh.effect]) || S.effects.dust;
      fx.render(this, { e, prevE: this.prevE, vanishing: sh.mode === 'out', d, now });
      this.prevE = e;
    }
  }

  S.Pipeline = Pipeline;
})();
