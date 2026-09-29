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
      const { ctx, W, H, fx, fxCtx } = pl;
      const layer = pl.fullMatte();
      pl.drawBg();
      const strip = 6;
      const cols = Math.ceil(W / strip);
      if (!pl.meltN || pl.meltN.length !== cols) {
        pl.meltN = new Float32Array(cols);
        for (let c = 0; c < cols; c++) pl.meltN[c] = 0.6 * vnoise(c / 14, 0, 5) + 0.4 * vnoise(c / 4, 0, 6);
      }
      const drop = Math.pow(e, 1.7);
      // strips go to a scratch canvas first, then onto the output in one draw
      fxCtx.clearRect(0, 0, W, H);
      for (let c = 0; c < cols; c++) {
        const nz = pl.meltN[c];
        const oy = H * drop * (0.35 + 1.1 * nz);
        const stretch = 1 + e * 0.8 * nz;
        fxCtx.drawImage(layer, c * strip, 0, strip, H, c * strip, oy, strip, H * stretch);
      }
      ctx.globalAlpha = 1 - smooth((e - 0.65) / 0.35);
      ctx.drawImage(fx, 0, 0);
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

  // 6. Hedge: the Homer Simpson ("Homer Loves Flanders", 1994). You step back
  // while two hedges slide in from the left and the right in front of you,
  // swaying as they come. They close with a rustle and a burst of leaves,
  // then part again and you are gone. Played backwards: Homer stepping out.
  const PANEL = 0.6;            // each hedge is this share of the frame width

  // One hedge panel with a leafy, bumpy inner edge. side: -1 left, +1 right.
  function makePanel(W, H, side) {
    const k = W / 1280;
    const pw = Math.round(W * PANEL), ext = Math.round(H * 0.08);
    const c = S.mkCanvas(pw, H + ext * 2), g = c.getContext('2d');
    const CH = c.height;
    // inner edge (x from the outer side), wobbly like a real bush
    const seed = Math.random() * 10;
    const edge = (y) => pw - 60 * k + Math.sin(y * 0.011 + seed) * 30 * k + Math.sin(y * 0.034 + seed * 2) * 18 * k + Math.sin(y * 0.09 + seed * 3) * 6 * k;
    const X = (x) => (side < 0 ? x : pw - x);                      // mirror for the right hedge
    const body = new Path2D();
    body.moveTo(X(0), 0);
    for (let y = 0; y <= CH; y += 8) body.lineTo(X(edge(y) - 14 * k), y);
    body.lineTo(X(0), CH); body.closePath();
    g.fillStyle = '#1f4617';
    g.fill(body);

    const step = 58 * k;
    for (let y = -step / 2; y < CH + step; y += step * 0.68) {
      for (let x = -step / 2; x < pw + step; x += step * 0.78) {
        const cy = y + (Math.random() - 0.5) * step * 0.5;
        const cx = Math.min(x + (Math.random() - 0.5) * step * 0.6, edge(cy) - step * 0.3);
        const r = step * (0.55 + Math.random() * 0.3);
        const sh = g.createRadialGradient(X(cx), cy + r * 0.35, 0, X(cx), cy + r * 0.35, r * 1.2);
        sh.addColorStop(0, 'rgba(6,18,4,0.75)'); sh.addColorStop(1, 'rgba(6,18,4,0)');
        // the dark core stays inside the bush, never spills past its edge
        g.save(); g.clip(body);
        g.fillStyle = sh;
        g.beginPath(); g.arc(X(cx), cy + r * 0.35, r * 1.2, 0, Math.PI * 2); g.fill();
        g.restore();
        for (let n = 0; n < 34; n++) {
          const ang = Math.random() * Math.PI * 2, dist = Math.sqrt(Math.random()) * r;
          const lx = cx + Math.cos(ang) * dist, ly = cy + Math.sin(ang) * dist * 0.85;
          if (lx > edge(ly) + 16 * k) continue;                    // a few leaves poke out
          const up = 1 - (ly - (cy - r)) / (2 * r);                 // top of each clump is lit
          const inner = lx / pw;                                    // lighter towards the opening
          const L = 18 + up * 24 + inner * 6 + Math.random() * 8;
          const size = (11 + Math.random() * 10) * k;
          const la = ang + (Math.random() - 0.5);
          g.fillStyle = `hsl(${98 + Math.random() * 16},${48 + Math.random() * 16}%,${L}%)`;
          g.beginPath(); g.ellipse(X(lx), ly, size, size * 0.5, la, 0, Math.PI * 2); g.fill();
          if (up > 0.6 && Math.random() < 0.5) {
            g.fillStyle = `hsla(86,60%,${L + 18}%,0.55)`;
            g.beginPath(); g.ellipse(X(lx - size * 0.15), ly - size * 0.12, size * 0.5, size * 0.16, la, 0, Math.PI * 2); g.fill();
          }
        }
      }
    }
    // rounded shading along the inner edge, so it reads as a thick bush
    const sg = g.createLinearGradient(X(pw), 0, X(pw - 90 * k), 0);
    sg.addColorStop(0, 'rgba(0,12,0,0.45)'); sg.addColorStop(1, 'rgba(0,12,0,0)');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = sg; g.fillRect(0, 0, pw, CH);
    const v = g.createLinearGradient(0, 0, 0, CH);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,10,0,0.18)');
    g.fillStyle = v; g.fillRect(0, 0, pw, CH);
    return { c, pw, ext };
  }

  // Draw a panel in horizontal bands that sway separately, like foliage
  // moving in the wind or being pushed.
  function drawPanel(ctx, p, x, t, sway) {
    const band = 6, CH = p.c.height;
    for (let y = 0; y < CH; y += band) {
      const dx = (Math.sin(y * 0.006 + t * 1.6) * 0.7 + Math.sin(y * 0.015 - t * 2.3) * 0.3) * sway;
      ctx.drawImage(p.c, 0, y, p.pw, band + 1, x + dx, y - p.ext, p.pw, band + 1);
    }
  }

  E.hedge = {
    label: 'Hedge',
    render: (pl, { e, prevE, vanishing, now }) => {
      const { ctx, W, H, box } = pl;
      if (!pl.hedgeL) { pl.hedgeL = makePanel(W, H, -1); pl.hedgeR = makePanel(W, H, 1); }
      const k = W / 1280, t = now / 1000;
      const CLOSED = 0.42;                                        // moment the hedges meet
      const c = Math.min(1, e / CLOSED);
      const close = c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
      // they meet with a small springy bounce instead of a hard stop
      const after = Math.max(0, e - CLOSED);
      const bounce = after > 0 ? Math.exp(-after * 22) * Math.sin(after * 55) * 0.035 : 0;
      const open = smooth((e - 0.58) / 0.42);
      const pos = (close + bounce) * (1 - open);                  // 0 = off screen, 1 = closed
      const hit = Math.exp(-Math.pow((e - CLOSED - 0.03) / 0.07, 2)); // rustle when they meet
      const sway = (4 + 6 * Math.sin(Math.PI * c) + 16 * hit) * k;

      pl.drawBg();

      // you, stepping back and into the shade of the hedges, until they close
      if (e < CLOSED + 0.02) {
        const layer = pl.fullMatte();
        const back = smooth(c);
        const s = 1 - 0.16 * back;
        ctx.save();
        ctx.translate(box.cx, box.cy); ctx.scale(s, s); ctx.translate(-box.cx, -box.cy - box.h * 0.03 * back);
        ctx.filter = `brightness(${(1 - 0.4 * back).toFixed(2)})`;
        ctx.drawImage(layer, 0, 0);
        ctx.restore();
      }

      // the two hedges; at pos 1 their leafy edges overlap in the middle
      const L = pl.hedgeL, R = pl.hedgeR;
      const reach = W / 2 + 36 * k;
      if (pos > 0.001) {
        drawPanel(ctx, L, -L.pw + pos * reach, t, sway);
        drawPanel(ctx, R, W - pos * reach, t + 1.7, sway);
      }

      // a burst of leaves where they meet
      if (vanishing && hit > 0.3 && prevE != null) {
        for (let n = 0; n < 8 * hit; n++) {
          const x = W / 2 + (Math.random() - 0.5) * 80 * k, y = Math.random() * H;
          pl.spawn('leaf', x, y, 40 + ((Math.random() * 50) | 0), 105 + ((Math.random() * 70) | 0), 30, false);
        }
      }
    },
  };

  S.effects = E;
  S.effectList = ['dust', 'burn', 'ghost', 'melt', 'portal', 'hedge'];
})();
