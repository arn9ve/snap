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

  // 3. Ghost: goes soft and see-through, drifting up like a spirit.
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

  // 4. Melt: drips down like wax, column by column.
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

  // 6. Hedge: the Homer Simpson ("Homer Loves Flanders", 1994). A hedge wall
  // rises up behind you, you back into it slowly and steadily, darker in its
  // shade, and the leaves swallow you leaf by leaf from the outline inwards,
  // face last. The hedge rustles where you went in, then sinks away and the
  // room is empty. Played backwards it is Homer coming out of the hedge.
  const HEDGE_TOP = 0.16;       // extra height above the frame for the bumpy top edge

  // One hedge layer, taller than the frame so its bumpy top can rise into view.
  // front = sparse clumps that end up in front of you.
  function makeHedge(W, H, front) {
    const HH = Math.round(H * (1 + HEDGE_TOP));
    const c = S.mkCanvas(W, HH), g = c.getContext('2d');
    const k = W / 1280;
    const top = H * HEDGE_TOP * 0.55;
    const edge = (x) => top + Math.sin(x * 0.011 + 1) * 10 * k + Math.sin(x * 0.037) * 7 * k;
    if (!front) {
      g.fillStyle = '#244d1a';
      g.beginPath(); g.moveTo(0, HH);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, edge(x) + 14 * k);
      g.lineTo(W, HH); g.closePath(); g.fill();
    }
    const step = (front ? 130 : 58) * k;
    for (let y = top - step * 0.2; y < HH + step; y += step * 0.68) {
      for (let x = -step / 2; x < W + step; x += step * 0.78) {
        if (front && (Math.random() < 0.5 || y < H * 0.35)) continue;
        const cx = x + (Math.random() - 0.5) * step * 0.6;
        const cy = Math.max(y + (Math.random() - 0.5) * step * 0.5, edge(cx) + step * 0.35);
        const r = step * (0.55 + Math.random() * 0.3);
        const sh = g.createRadialGradient(cx, cy + r * 0.35, 0, cx, cy + r * 0.35, r * 1.2);
        sh.addColorStop(0, 'rgba(6,18,4,0.75)'); sh.addColorStop(1, 'rgba(6,18,4,0)');
        g.fillStyle = sh;
        g.beginPath(); g.arc(cx, cy + r * 0.35, r * 1.2, 0, Math.PI * 2); g.fill();
        for (let n = 0; n < (front ? 30 : 34); n++) {
          const ang = Math.random() * Math.PI * 2, dist = Math.sqrt(Math.random()) * r;
          const lx = cx + Math.cos(ang) * dist, ly = cy + Math.sin(ang) * dist * 0.85;
          if (ly < edge(lx)) continue;
          const up = 1 - (ly - (cy - r)) / (2 * r);                   // top of each clump is lit
          const L = 20 + up * 26 + Math.random() * 8;
          const size = (11 + Math.random() * 10) * k;
          const la = ang + (Math.random() - 0.5);
          g.fillStyle = `hsl(${98 + Math.random() * 16},${48 + Math.random() * 16}%,${L}%)`;
          g.beginPath(); g.ellipse(lx, ly, size, size * 0.5, la, 0, Math.PI * 2); g.fill();
          if (up > 0.6 && Math.random() < 0.5) {
            g.fillStyle = `hsla(86,60%,${L + 18}%,0.55)`;
            g.beginPath(); g.ellipse(lx - size * 0.15, ly - size * 0.12, size * 0.5, size * 0.16, la, 0, Math.PI * 2); g.fill();
          }
        }
      }
    }
    if (!front) {
      const v = g.createLinearGradient(0, top, 0, HH);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,10,0,0.4)');
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = v; g.fillRect(0, 0, W, HH);
    }
    return c;
  }

  // Threshold map made of leaf shapes, so the body is covered one leaf at a time.
  function leafThr(w, h) {
    const c = S.mkCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const count = (w * h) / 14;
    for (let n = 0; n < count; n++) {
      const v = (Math.random() * 255) | 0;
      g.fillStyle = `rgb(${v},${v},${v})`;
      const s = 2.5 + Math.random() * 3.5;
      g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, s, s * 0.5, Math.random() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    const d = g.getImageData(0, 0, w, h).data, t = new Float32Array(w * h);
    for (let i = 0; i < t.length; i++) t[i] = d[i * 4] / 255;
    return t;
  }

  E.hedge = {
    label: 'Hedge',
    durScale: 1.6,              // Homer takes his time
    render: (pl, { e, prevE, vanishing, now }) => {
      const { ctx, W, H, WW, HH, n, box, maskAvg } = pl;
      if (!pl.hedgeBack) { pl.hedgeBack = makeHedge(W, H, false); pl.hedgeFront = makeHedge(W, H, true); }

      // the hedge rises from the floor, and sinks back once you are gone
      const up = smooth(e / 0.16), down = smooth((e - 0.88) / 0.12);
      const hy = -H * HEDGE_TOP + H * (1 + HEDGE_TOP) * (1 - up + down);
      const back = smooth((e - 0.1) / 0.66);                        // walking backwards
      const eng = (x) => smooth((x - 0.25) / 0.65);                 // leaves closing over you
      const g = eng(e), gPrev = prevE == null ? g : eng(prevE);
      // slow start: the outline goes first and there is a lot of it
      const P = S.P_MIN + Math.pow(g, 1.6) * (S.P_MAX - S.P_MIN), PP = S.P_MIN + Math.pow(gPrev, 1.6) * (S.P_MAX - S.P_MIN);
      const lo = Math.min(P, PP), hi = Math.max(P, PP);
      // rustle mostly once you are inside, around where you went in
      const rustle = Math.sin(Math.PI * smooth((e - 0.55) / 0.35));
      const jx = Math.sin(now * 0.05) * 4 * rustle, jy = Math.cos(now * 0.067) * 2.5 * rustle;

      pl.drawBg();
      ctx.drawImage(pl.hedgeBack, 0, hy);

      // alpha: leaf-shaped map, edges of the body first and the face last
      const thr = pl.thrFor('hedge', leafThr);
      const sx = W / WW, sy = H / HH;
      const fcx = box.cx / sx, fcy = (box.cy - box.h * 0.25) / sy;  // roughly the face
      const rx = Math.max(10, box.w / sx / 2), ry = Math.max(10, box.h / sy / 2);
      const a = pl.alphaImg.data, sd = pl.glowImg.data;
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        const m = maskAvg[i] / 255;
        if (m <= 0) { a[j + 3] = 0; sd[j + 3] = 0; continue; }
        const x = i % WW, y = (i / WW) | 0;
        const dx = (x - fcx) / rx, dy = (y - fcy) / ry;
        const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 1.5);
        const th = 0.35 * thr[i] + 0.65 * (1 - dist);
        const vis = m * smooth((th - P) / 0.025 + 0.5);
        a[j + 3] = vis * 255;
        // leaves about to cover you cast a soft shadow on you first
        sd[j] = 6; sd[j + 1] = 20; sd[j + 2] = 4;
        sd[j + 3] = vis * Math.max(0, Math.min(1, 1 - (th - P) / 0.1)) * 140;
        if (vanishing && m > 0.6 && th >= lo && th < hi && Math.random() < 0.01) {
          pl.spawn('leaf', x * sx, y * sy, 40 + ((Math.random() * 40) | 0), 110 + ((Math.random() * 60) | 0), 30, false);
        }
      }
      pl.alphaCtx.putImageData(pl.alphaImg, 0, 0);
      const layer = pl.matte(pl.alphaC);
      pl.glowCtx.putImageData(pl.glowImg, 0, 0);

      // step back: steadily smaller and into the shade, no bobbing
      const s = 1 - 0.2 * back;
      ctx.save();
      ctx.translate(box.cx, box.cy); ctx.scale(s, s); ctx.translate(-box.cx, -box.cy - box.h * 0.04 * back);
      ctx.filter = `brightness(${(1 - 0.45 * back).toFixed(2)}) saturate(${(1 - 0.3 * back).toFixed(2)})`;
      ctx.drawImage(layer, 0, 0);
      ctx.filter = 'blur(3px)';
      ctx.globalAlpha = Math.min(1, g * 3);
      ctx.drawImage(pl.glowC, 0, 0, W, H);
      ctx.restore();

      // clumps in front of you, moving with the hedge
      ctx.globalAlpha = smooth(back * 1.3) * (1 - down);
      ctx.drawImage(pl.hedgeFront, jx, hy + jy);
      ctx.globalAlpha = 1;
    },
  };

  S.effects = E;
  S.effectList = ['dust', 'burn', 'ghost', 'melt', 'portal', 'hedge'];
})();
