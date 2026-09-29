// Snap: vanish effects.
// Each effect gets e (0 = fully visible, 1 = fully gone, already eased) and
// draws one output frame. Coming back plays the same effect in reverse.
// Two families:
//  - dissolves eat the body pixel by pixel following a threshold map
//  - transforms move / distort the whole cut-out body
(() => {
  'use strict';
  const S = (window.__snap = window.__snap || {});
  const { smooth } = S;

  // ---------- small noise helpers ----------
  function hash2(x, y, s) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function normalize(t) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < t.length; i++) { if (t[i] < lo) lo = t[i]; if (t[i] > hi) hi = t[i]; }
    const k = 1 / (hi - lo || 1);
    for (let i = 0; i < t.length; i++) t[i] = (t[i] - lo) * k;
    return t;
  }

  // ---------- shared dissolve ----------
  // cfg: { name, makeThr(WW, HH), band, spawn, kind, color?, glow?: { width, c:[r,g,b] } }
  function dissolve(pl, cfg, { e, prevE, vanishing, d }) {
    const { WW, HH, n, W, H, ctx } = pl;
    const thr = pl.thrFor(cfg.name, cfg.makeThr);
    const P = S.P_MIN + e * (S.P_MAX - S.P_MIN);
    const PP = prevE == null ? P : S.P_MIN + prevE * (S.P_MAX - S.P_MIN);
    const lo = Math.min(P, PP), hi = Math.max(P, PP);
    const a = pl.alphaImg.data, mask = pl.maskAvg;
    const g = cfg.glow ? pl.glowImg.data : null;
    const gw = cfg.glow ? cfg.glow.width : 1, gc = cfg.glow ? cfg.glow.c : null;
    const sx = W / WW, sy = H / HH;
    for (let i = 0; i < n; i++) {
      const m = mask[i] / 255;
      const th = thr[i];
      a[i * 4 + 3] = m * smooth((th - P) / cfg.band + 0.5) * 255;
      if (g) {
        const j = i * 4;
        const gv = m * Math.max(0, 1 - Math.abs(th - P) / gw);
        g[j] = gc[0]; g[j + 1] = gc[1]; g[j + 2] = gc[2]; g[j + 3] = gv * 255;
      }
      if (m > 0.6 && th >= lo && th < hi && Math.random() < cfg.spawn) {
        const j = i * 4;
        const c = cfg.color ? cfg.color() : [d[j], d[j + 1], d[j + 2]];
        pl.spawn(cfg.kind, (i % WW) * sx, ((i / WW) | 0) * sy, c[0], c[1], c[2], !vanishing);
      }
    }
    pl.alphaCtx.putImageData(pl.alphaImg, 0, 0);
    pl.drawBg();
    ctx.drawImage(pl.matte(pl.alphaC), 0, 0);
    if (g) {
      pl.glowCtx.putImageData(pl.glowImg, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = 'blur(2px)';
      ctx.drawImage(pl.glowC, 0, 0, W, H);
      ctx.restore();
    }
  }

  const E = {};

  // 1. Dust: the original. Fine grains sweep away to the right.
  E.dust = {
    label: 'Dust',
    render: (pl, st) => dissolve(pl, {
      name: 'dust', band: 0.035, spawn: 0.1, kind: 'dust',
      makeThr: (WW, HH) => {
        const t = new Float32Array(WW * HH);
        for (let y = 0; y < HH; y++) for (let x = 0; x < WW; x++) t[y * WW + x] = 0.55 * (x / WW) + 0.45 * Math.random();
        return t;
      },
    }, st),
  };

  // 2. Burn: paper burning, glowing orange edge and embers floating up.
  E.burn = {
    label: 'Burn',
    render: (pl, st) => dissolve(pl, {
      name: 'burn', band: 0.02, spawn: 0.05, kind: 'ember',
      glow: { width: 0.045, c: [255, 140, 40] },
      color: () => [255, 120 + ((Math.random() * 120) | 0), 30],
      makeThr: (WW, HH) => {
        const t = new Float32Array(WW * HH);
        const k = 1 / WW;
        for (let y = 0; y < HH; y++) for (let x = 0; x < WW; x++) {
          const nx = x * k, ny = y * k;
          t[y * WW + x] = 0.55 * vnoise(nx * 5, ny * 5, 1) + 0.3 * vnoise(nx * 12, ny * 12, 2) + 0.15 * vnoise(nx * 30, ny * 30, 3);
        }
        return normalize(t);
      },
    }, st),
  };

  // 3. Teleport: beamed up, from the feet to the head, with cyan sparks.
  E.beam = {
    label: 'Teleport',
    render: (pl, st) => dissolve(pl, {
      name: 'beam', band: 0.03, spawn: 0.12, kind: 'spark',
      glow: { width: 0.06, c: [120, 220, 255] },
      color: () => (Math.random() < 0.5 ? [200, 245, 255] : [90, 200, 255]),
      makeThr: (WW, HH) => {
        const t = new Float32Array(WW * HH);
        const col = new Float32Array(WW);
        for (let x = 0; x < WW; x++) col[x] = Math.random();
        for (let y = 0; y < HH; y++) for (let x = 0; x < WW; x++) t[y * WW + x] = 0.78 * (1 - y / HH) + 0.12 * col[x] + 0.1 * Math.random();
        return t;
      },
    }, st),
  };

  // 4. Ghost: goes soft and see-through, drifting up like a spirit.
  E.ghost = {
    label: 'Ghost',
    render: (pl, { e }) => {
      const { ctx, W, H, box } = pl;
      const layer = pl.fullMatte();
      pl.drawBg();
      const s = 1 + 0.06 * e;
      ctx.save();
      ctx.translate(box.cx, box.cy - 30 * e);
      ctx.scale(s, s);
      ctx.translate(-box.cx, -box.cy);
      ctx.filter = `blur(${(e * 10).toFixed(1)}px)`;
      ctx.globalAlpha = Math.pow(1 - e, 1.4);
      ctx.drawImage(layer, 0, 0, W, H);
      // a fainter echo a little higher up
      ctx.globalAlpha = 0.35 * Math.sin(Math.PI * Math.min(1, e * 1.2));
      ctx.translate(0, -40 * e);
      ctx.drawImage(layer, 0, 0, W, H);
      ctx.restore();
    },
  };

  // 5. Glitch: the signal breaks up, slices jump, colours split, then cut.
  E.glitch = {
    label: 'Glitch',
    render: (pl, { e, now }) => {
      const { ctx, W, H, fx, fxCtx } = pl;
      const layer = pl.fullMatte();
      pl.drawBg();
      const alpha = 1 - smooth((e - 0.7) / 0.3);
      const seed = Math.floor(now / 70);
      if (alpha <= 0.01 || (e > 0.25 && hash2(seed, 7, 3) < e * 0.35)) return;   // dropped frames
      const slices = 22, sh = H / slices;
      ctx.globalAlpha = alpha;
      for (let k = 0; k < slices; k++) {
        const r = hash2(seed, k, 1);
        const off = r < 0.25 + e * 0.5 ? (hash2(seed, k, 2) - 0.5) * e * W * 0.3 : 0;
        ctx.drawImage(layer, 0, k * sh, W, sh + 1, off, k * sh, W, sh + 1);
      }
      // chromatic split: red and cyan ghosts of the body, offset sideways
      const dx = 4 + e * 28;
      for (const [col, sx] of [['rgb(255,0,60)', dx], ['rgb(0,220,255)', -dx]]) {
        fxCtx.globalCompositeOperation = 'source-over';
        fxCtx.clearRect(0, 0, W, H);
        fxCtx.drawImage(layer, 0, 0);
        fxCtx.globalCompositeOperation = 'source-atop';
        fxCtx.fillStyle = col;
        fxCtx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = alpha * (0.1 + 0.3 * e);
        ctx.drawImage(fx, sx, 0);
      }
      ctx.globalCompositeOperation = 'source-over';
      // a few bright noise lines
      ctx.globalAlpha = alpha * 0.25 * e;
      ctx.fillStyle = '#fff';
      for (let k = 0; k < 6; k++) if (hash2(seed, k, 9) < e) ctx.fillRect(0, hash2(seed, k, 8) * H, W, 1 + hash2(seed, k, 5) * 3);
      ctx.globalAlpha = 1;
    },
  };

  // 6. Pixelate: turns into big blocks that fall out one by one.
  E.pixel = {
    label: 'Pixelate',
    render: (pl, { e, prevE, vanishing }) => {
      const { ctx, W, H } = pl;
      const layer = pl.fullMatte();
      pl.drawBg();
      const b = Math.round(1 + 39 * smooth(e / 0.55));
      if (b < 3) { ctx.drawImage(layer, 0, 0); return; }
      const pw = Math.ceil(W / b), ph = Math.ceil(H / b);
      if (!pl.pixC) { pl.pixC = S.mkCanvas(pw, ph); pl.pixCtx = pl.pixC.getContext('2d', { willReadFrequently: true }); }
      if (pl.pixC.width !== pw || pl.pixC.height !== ph) { pl.pixC.width = pw; pl.pixC.height = ph; }
      const pc = pl.pixCtx;
      pc.clearRect(0, 0, pw, ph);
      pc.drawImage(layer, 0, 0, pw, ph);
      const k = smooth((e - 0.4) / 0.6), kPrev = prevE == null ? k : smooth((prevE - 0.4) / 0.6);
      if (k > 0) {
        const img = pc.getImageData(0, 0, pw, ph), px = img.data;
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
          const j = (y * pw + x) * 4;
          if (px[j + 3] < 40) continue;
          const r = hash2(Math.floor((x * b) / 40), Math.floor((y * b) / 40), 11) * 0.5 + hash2(x, y, b) * 0.5;
          if (r < k) {
            if (vanishing && r >= kPrev && px[j + 3] > 160) pl.spawn('pixel', x * b, y * b, px[j], px[j + 1], px[j + 2], false, { size: b });
            px[j + 3] = 0;
          }
        }
        pc.putImageData(img, 0, 0);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pl.pixC, 0, 0, pw * b, ph * b);
      ctx.imageSmoothingEnabled = true;
    },
  };

  // 7. Melt: drips down like wax, column by column.
  E.melt = {
    label: 'Melt',
    render: (pl, { e }) => {
      const { ctx, W, H } = pl;
      const layer = pl.fullMatte();
      pl.drawBg();
      const strip = 6;
      const cols = Math.ceil(W / strip);
      if (!pl.meltN || pl.meltN.length !== cols) {
        pl.meltN = new Float32Array(cols);
        for (let c = 0; c < cols; c++) pl.meltN[c] = 0.6 * vnoise(c / 14, 0, 5) + 0.4 * vnoise(c / 4, 0, 6);
      }
      const drop = Math.pow(e, 1.7);
      ctx.globalAlpha = 1 - smooth((e - 0.65) / 0.35);
      for (let c = 0; c < cols; c++) {
        const nz = pl.meltN[c];
        const oy = H * drop * (0.35 + 1.1 * nz);
        const stretch = 1 + e * 0.8 * nz;
        ctx.drawImage(layer, c * strip, 0, strip, H, c * strip, oy, strip, H * stretch);
      }
      ctx.globalAlpha = 1;
    },
  };

  // 8. Portal: spins and shrinks into a purple vortex that then closes.
  E.portal = {
    label: 'Portal',
    render: (pl, { e, vanishing }) => {
      const { ctx, W, H, box } = pl;
      const layer = pl.fullMatte();
      pl.drawBg();
      const cx = box.cx, cy = box.cy;
      const R = Math.max(40, Math.min(W, H) * 0.32) * Math.sin(Math.PI * Math.min(1, e * 1.05));
      if (R > 1) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, 'rgba(10,0,25,0.95)');
        g.addColorStop(0.6, 'rgba(40,10,90,0.85)');
        g.addColorStop(0.85, 'rgba(170,110,255,0.7)');
        g.addColorStop(1, 'rgba(170,110,255,0)');
        ctx.save();
        ctx.fillStyle = g;
        ctx.translate(cx, cy); ctx.scale(1, 0.8); ctx.translate(-cx, -cy);
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        if (vanishing) for (let k = 0; k < 8; k++) {
          const ang = Math.random() * Math.PI * 2;
          pl.spawn('swirl', cx, cy, 200 + ((Math.random() * 55) | 0), 160, 255, false, { cx, cy, ang, rad: R * (1 + Math.random() * 0.5) });
        }
      }
      const s = Math.pow(1 - e, 1.3);
      if (s < 0.005) return;
      ctx.save();
      ctx.globalAlpha = 1 - smooth((e - 0.85) / 0.15);
      ctx.translate(cx, cy);
      ctx.rotate(e * e * 3);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      ctx.drawImage(layer, 0, 0, W, H);
      ctx.restore();
    },
  };

  S.effects = E;
  S.effectList = ['dust', 'burn', 'beam', 'ghost', 'glitch', 'pixel', 'melt', 'portal'];
})();
