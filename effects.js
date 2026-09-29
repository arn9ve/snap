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

  // 3. Ghost: the colour drains out, the body turns pale and translucent,
  // ripples like heat haze and floats up and towards the camera, leaving
  // soft wisps behind.
  E.ghost = {
    label: 'Ghost',
    render: (pl, { e, now, vanishing, d }) => {
      const { ctx, W, H, WW, HH, box, fx, fxCtx, maskAvg } = pl;
      const layer = pl.fullMatte();
      pl.drawBg();

      // pale, cold copy of the body
      fxCtx.globalCompositeOperation = 'source-over';
      fxCtx.clearRect(0, 0, W, H);
      fxCtx.filter = 'grayscale(1) brightness(1.45) contrast(0.8)';
      fxCtx.drawImage(layer, 0, 0);
      fxCtx.filter = 'none';
      fxCtx.globalCompositeOperation = 'source-atop';
      fxCtx.fillStyle = 'rgba(150,205,255,0.4)';
      fxCtx.fillRect(0, 0, W, H);
      fxCtx.globalCompositeOperation = 'source-over';

      const rise = 80 * e * e;
      const s = 1 + 0.1 * e;
      const amp = 16 * smooth(e / 0.6);
      const body = 1 - smooth(e / 0.4);                               // real colours fade first
      const ghost = 0.85 * smooth(e / 0.25) * (1 - smooth((e - 0.45) / 0.55));
      // rippled copy drawn once into a scratch canvas, then blurred in one go
      if (!pl.fx2) pl.fx2 = S.mkCanvas(W, H);
      const f2 = pl.fx2.getContext('2d');
      const wave = (img, alpha, blurPx, k) => {
        if (alpha <= 0.005) return;
        f2.setTransform(1, 0, 0, 1, 0, 0);
        f2.clearRect(0, 0, W, H);
        f2.translate(box.cx, box.cy - rise);
        f2.scale(s, s);
        f2.translate(-box.cx, -box.cy);
        const strip = 6;
        for (let y = 0; y < H; y += strip) {
          const dx = Math.sin(y * 0.022 + now * 0.004) * amp * k + Math.sin(y * 0.07 - now * 0.007) * amp * 0.3 * k;
          f2.drawImage(img, 0, y, W, strip, dx, y, W, strip);
        }
        ctx.save();
        ctx.globalAlpha = alpha;
        if (blurPx > 0.2) ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
        ctx.drawImage(pl.fx2, 0, 0);
        ctx.restore();
      };
      wave(layer, body, 0, 0.4);
      wave(fx, ghost, 1 + e * 3, 1);
      // soft halo around the ghost
      ctx.globalCompositeOperation = 'lighter';
      wave(fx, ghost * 0.3, 14, 1);
      ctx.globalCompositeOperation = 'source-over';

      // wisps drifting off the body
      if (vanishing && e > 0.08 && e < 0.9) {
        for (let k = 0; k < 40; k++) {
          const i = (Math.random() * WW * HH) | 0;
          if (maskAvg[i] < 160) continue;
          const x = (i % WW) * (W / WW), y = ((i / WW) | 0) * (H / HH) - rise;
          pl.spawn('wisp', x, y, 190, 225, 255, false);
          if (Math.random() < 0.6) break;
        }
      }
    },
  };

  // 4. Melt: the body sags and runs down like hot wax, with long drips,
  // falling drops and a glossy sheen.
  E.melt = {
    label: 'Melt',
    render: (pl, { e, vanishing, d }) => {
      const { ctx, W, H, WW, HH, fx, fxCtx, maskAvg } = pl;
      const layer = pl.fullMatte();
      pl.drawBg();
      const strip = 3;
      const cols = Math.ceil(W / strip);
      if (!pl.meltN || pl.meltN.length !== cols) {
        pl.meltN = new Float32Array(cols);
        pl.meltD = new Float32Array(cols);
        for (let c = 0; c < cols; c++) {
          const drip = Math.pow(vnoise(c / 5, 0, 6), 3);                // sharp peaks = drips
          pl.meltN[c] = 0.55 * vnoise(c / 22, 0, 5) + 0.45 * drip;
          pl.meltD[c] = vnoise(c / 35, 0, 7);                           // when each column starts
        }
      }
      fxCtx.clearRect(0, 0, W, H);
      for (let c = 0; c < cols; c++) {
        const nz = pl.meltN[c];
        const local = smooth((e - pl.meltD[c] * 0.3) / 0.7);
        // the top sinks, the column squashes towards the floor, drips hang below
        const oy = H * Math.pow(local, 1.4) * (0.5 + 0.45 * nz);
        const drip = H * local * nz * nz * 0.9;
        fxCtx.drawImage(layer, c * strip, 0, strip, H, c * strip, oy, strip, H - oy + drip);
      }
      ctx.save();
      ctx.globalAlpha = 1 - smooth((e - 0.75) / 0.25);
      ctx.filter = `blur(0.8px) saturate(${(1 + 0.5 * e).toFixed(2)}) contrast(${(1 + 0.15 * e).toFixed(2)})`;
      ctx.drawImage(fx, 0, 0);
      ctx.restore();
      // wet highlight running down with the wax
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18 * Math.sin(Math.PI * Math.min(1, e * 1.2));
      ctx.filter = 'blur(6px) grayscale(1)';
      ctx.drawImage(fx, 2, -3);
      ctx.restore();
      // drops falling off
      if (vanishing && e > 0.15 && e < 0.85) {
        for (let k = 0; k < 6; k++) {
          const i = (Math.random() * WW * HH) | 0;
          if (maskAvg[i] < 180) continue;
          const j = i * 4, x = (i % WW) * (W / WW), y = ((i / WW) | 0) * (H / HH) + H * e * 0.5;
          if (y < H) pl.spawn('drop', x, y, d[j], d[j + 1], d[j + 2], false);
        }
      }
    },
  };

  // 5. Portal: spins and shrinks into a purple vortex that then closes.
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

  // 6. Hedge: the Homer Simpson move. A hedge grows in behind you, you back
  // slowly into it, darker in its shade, the leaves close over you, it
  // rustles, and then it is gone and the room is empty.
  function makeHedge(W, H, front) {
    const c = S.mkCanvas(W, H), g = c.getContext('2d');
    const k = W / 1280;
    if (!front) { g.fillStyle = '#1b3514'; g.fillRect(0, 0, W, H); }
    // bushy clumps: a dark core, then leaves that get lighter towards the top
    const step = (front ? 150 : 62) * k;
    for (let y = -step / 2; y < H + step; y += step * 0.7) {
      for (let x = -step / 2; x < W + step; x += step * 0.8) {
        if (front && Math.random() < 0.45) continue;
        const cx = x + (Math.random() - 0.5) * step * 0.6, cy = y + (Math.random() - 0.5) * step * 0.5;
        const r = step * (0.55 + Math.random() * 0.3);
        const sh = g.createRadialGradient(cx, cy + r * 0.3, 0, cx, cy + r * 0.3, r * 1.2);
        sh.addColorStop(0, 'rgba(8,20,6,0.8)'); sh.addColorStop(1, 'rgba(8,20,6,0)');
        g.fillStyle = sh;
        g.beginPath(); g.arc(cx, cy + r * 0.3, r * 1.2, 0, Math.PI * 2); g.fill();
        const leaves = front ? 26 : 34;
        for (let n = 0; n < leaves; n++) {
          const ang = Math.random() * Math.PI * 2, dist = Math.sqrt(Math.random()) * r;
          const lx = cx + Math.cos(ang) * dist, ly = cy + Math.sin(ang) * dist * 0.85;
          const up = 1 - (ly - (cy - r)) / (2 * r);                   // top of the clump is lit
          const L = 16 + up * 26 + Math.random() * 8 - (1 - y / H) * -4;
          const size = (11 + Math.random() * 10) * k;
          const la = ang + (Math.random() - 0.5);
          g.fillStyle = `hsl(${100 + Math.random() * 18},${42 + Math.random() * 18}%,${L}%)`;
          g.beginPath(); g.ellipse(lx, ly, size, size * 0.5, la, 0, Math.PI * 2); g.fill();
          if (up > 0.65 && Math.random() < 0.5) {
            g.fillStyle = `hsla(88,55%,${L + 16}%,0.5)`;
            g.beginPath(); g.ellipse(lx - size * 0.15, ly - size * 0.12, size * 0.5, size * 0.16, la, 0, Math.PI * 2); g.fill();
          }
        }
      }
    }
    // darker towards the bottom, like the inside of a real hedge
    if (!front) {
      const v = g.createLinearGradient(0, 0, 0, H);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,10,0,0.45)');
      g.fillStyle = v; g.fillRect(0, 0, W, H);
    }
    return c;
  }

  E.hedge = {
    label: 'Hedge',
    render: (pl, { e, prevE, vanishing, now }) => {
      const { ctx, W, H, WW, HH, n, box, maskAvg } = pl;
      if (!pl.hedgeBack) { pl.hedgeBack = makeHedge(W, H, false); pl.hedgeFront = makeHedge(W, H, true); }
      const hIn = smooth(e / 0.14), hOut = smooth((e - 0.86) / 0.14);
      const hA = hIn * (1 - hOut);
      const eng = (x) => smooth((x - 0.3) / 0.56);                 // leaves closing over you
      const g = eng(e), gPrev = prevE == null ? g : eng(prevE);
      const P = S.P_MIN + g * (S.P_MAX - S.P_MIN), PP = S.P_MIN + gPrev * (S.P_MAX - S.P_MIN);
      const lo = Math.min(P, PP), hi = Math.max(P, PP);
      const rustle = Math.sin(Math.PI * smooth((e - 0.3) / 0.65));
      const jx = Math.sin(now * 0.045) * 4 * rustle, jy = Math.cos(now * 0.061) * 2 * rustle;

      pl.drawBg();
      ctx.globalAlpha = hA;
      ctx.drawImage(pl.hedgeBack, jx * 0.4, jy * 0.4);
      ctx.globalAlpha = 1;

      // leaves close in from the edges of the body towards the middle
      const thr = pl.thrFor('hedge', (w, h) => {
        const t = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[y * w + x] = 0.65 * vnoise(x / 7, y / 7, 21) + 0.35 * vnoise(x / 2.5, y / 2.5, 22);
        return normalize(t);
      });
      const sx = W / WW, sy = H / HH;
      const bcx = box.cx / sx, bcy = box.cy / sy;
      const rx = Math.max(10, box.w / sx / 2), ry = Math.max(10, box.h / sy / 2);
      const a = pl.alphaImg.data;
      for (let i = 0; i < n; i++) {
        const m = maskAvg[i] / 255;
        if (m <= 0) { a[i * 4 + 3] = 0; continue; }
        const x = i % WW, y = (i / WW) | 0;
        const dx = (x - bcx) / rx, dy = (y - bcy) / ry;
        const edge = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const th = 0.5 * thr[i] + 0.5 * (1 - edge);
        a[i * 4 + 3] = m * smooth((th - P) / 0.04 + 0.5) * 255;
        if (vanishing && m > 0.6 && th >= lo && th < hi && Math.random() < 0.012) {
          pl.spawn('leaf', x * sx, y * sy, 40 + ((Math.random() * 40) | 0), 110 + ((Math.random() * 60) | 0), 30, false);
        }
      }
      pl.alphaCtx.putImageData(pl.alphaImg, 0, 0);
      const layer = pl.matte(pl.alphaC);

      // step back: smaller, from the feet, and into the shade
      const back = smooth((e - 0.08) / 0.62);
      const s = 1 - 0.22 * back;
      const ax = box.cx, ay = Math.min(H, box.cy + box.h / 2);
      ctx.save();
      ctx.translate(ax, ay); ctx.scale(s, s); ctx.translate(-ax, -ay);
      ctx.filter = `brightness(${(1 - 0.5 * back).toFixed(2)}) saturate(${(1 - 0.3 * back).toFixed(2)})`;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();

      ctx.globalAlpha = hA * smooth(back * 1.4);
      ctx.drawImage(pl.hedgeFront, jx, jy);
      ctx.globalAlpha = 1;
    },
  };

  S.effects = E;
  S.effectList = ['dust', 'burn', 'ghost', 'melt', 'portal', 'hedge'];
})();
