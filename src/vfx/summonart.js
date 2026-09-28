// SUMMON16 CREATURE ART -- procedural pixel-art painter for the summon creatures (no three.js here: pure canvas, so
// a plain page can render the sheets for review). Every creature is authored as ordered PARTS (shapes in a y-up,
// feet-at-origin pixel space). Each part is rasterised to a hard mask, given a dome height field from its own
// distance-to-edge, lit from the upper left, quantised onto the part's colour ramp with a 4x4 ordered dither (the
// PS1 sprite look), then outlined: a dark 1px silhouette line, plus a contact line wherever a part sits in front of
// another one. Emissive parts (fire, eyes, orbs) shade from the core out and keep a hot outline instead of a dark one.
//
// paintCreature(id) -> { atlas, glow, cellW, cellH, frames, pad, ppu, footY, meta } (cached per id)
//   atlas: canvas, frames side by side, each cell (w + 2*pad) x (h + 2*pad), feet at (cellW/2, cellH - pad - 2)
//   glow:  same layout, the silhouette blurred into the creature's aura colour (additive halo layer)

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const ramp = (...hs) => hs.map(hex);
const dark = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const LX = -0.5, LY = -0.68, LZ = 0.62; const LN = Math.hypot(LX, LY, LZ); const L = [LX / LN, LY / LN, LZ / LN];

// ---- drawing kit (y-up pixel space, origin = feet, bound to one context) ----
function kit(g) {
  const K = {
    g,
    ell(x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, 6.2832); g.fill(); return K; },
    circ(x, y, r) { return K.ell(x, y, r, r); },
    poly(pts) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); return K; },
    // smooth closed blob through points (quadratic mid-point spline)
    blob(pts) {
      g.beginPath(); const n = pts.length; const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let m = mid(pts[n - 1], pts[0]); g.moveTo(m[0], m[1]);
      for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; m = mid(p, q); g.quadraticCurveTo(p[0], p[1], m[0], m[1]); }
      g.closePath(); g.fill(); return K;
    },
    // a tube swept along a Catmull-Rom spline through pts; radius r may be a number, [r0, r1] or a per-point array
    tube(pts, r) {
      const n = pts.length; const rad = (t) => { if (typeof r === 'number') return r; if (r.length === 2 && n !== 2) return r[0] + (r[1] - r[0]) * t; const f = t * (r.length - 1); const i = Math.min(r.length - 2, Math.floor(f)); return r[i] + (r[i + 1] - r[i]) * (f - i); };
      const P = (i) => pts[Math.max(0, Math.min(n - 1, i))];
      const cr = (a, b, c, d, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); };
      let len = 0; for (let i = 1; i < n; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const steps = Math.max(4, Math.ceil(len * 0.9));
      for (let s = 0; s <= steps; s++) {
        const T = s / steps, f = T * (n - 1), i = Math.min(n - 2, Math.floor(f)), t = f - i;
        const x = cr(P(i - 1)[0], P(i)[0], P(i + 1)[0], P(i + 2)[0], t), y = cr(P(i - 1)[1], P(i)[1], P(i + 1)[1], P(i + 2)[1], t);
        const rr = rad(T); g.beginPath(); g.arc(x, y, Math.max(0.45, rr), 0, 6.2832); g.fill();
      }
      return K;
    },
    // flame / hair tongue: fat root, sharp tip, following a curve
    tongue(pts, r0) { return K.tube(pts, [r0, r0 * 0.9, r0 * 0.55, 0.4].slice(0, Math.max(2, Math.min(4, pts.length + 1)))); },
    line(x0, y0, x1, y1, w = 1) { g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); return K; },
    // limb: shoulder -> elbow -> hand with radii
    cut(x, y, rx, ry = rx) { const op = g.globalCompositeOperation; g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, 6.2832); g.fill(); g.globalCompositeOperation = op; return K; },
    limb(a, b, c, ra, rb, rc) { K.tube([a, b], [ra, rb]); K.tube([b, c], [rb, rc]); return K; },
  };
  return K;
}

// ---- one frame: ordered parts -> shaded, outlined RGBA ----
function paintFrame(w, h, build, opts = {}) {
  const cv = mkCanvas(w, h); const g = cv.getContext('2d', { willReadFrequently: true });
  const parts = []; const N = w * h;
  const id = new Int16Array(N).fill(-1);
  const P = {
    part(rp, o, fn) {
      if (typeof o === 'function') { fn = o; o = {}; }
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
      g.setTransform(1, 0, 0, -1, w / 2, h - 2); g.fillStyle = '#fff'; g.strokeStyle = '#fff';
      fn(kit(g));
      const d = g.getImageData(0, 0, w, h).data; const m = new Uint8Array(N);
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (d[i * 4 + 3] >= 120) { m[i] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      if (x1 < 0) return;
      // chamfer distance to the part's own edge, inside its bounding box only
      const D = new Float32Array(N); const INF = 1e6;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * w + x; if (m[i]) D[i] = INF; }
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * w + x; if (!D[i]) continue; let v = D[i];
        v = Math.min(v, x > 0 ? D[i - 1] + 1 : 1, y > 0 ? D[i - w] + 1 : 1);
        if (x > 0 && y > 0) v = Math.min(v, D[i - w - 1] + 1.414); if (x < w - 1 && y > 0) v = Math.min(v, D[i - w + 1] + 1.414); D[i] = v; }
      for (let y = y1; y >= y0; y--) for (let x = x1; x >= x0; x--) { const i = y * w + x; if (!D[i]) continue; let v = D[i];
        v = Math.min(v, x < w - 1 ? D[i + 1] + 1 : 1, y < h - 1 ? D[i + w] + 1 : 1);
        if (x < w - 1 && y < h - 1) v = Math.min(v, D[i + w + 1] + 1.414); if (x > 0 && y < h - 1) v = Math.min(v, D[i + w - 1] + 1.414); D[i] = v; }
      const pi = parts.length; parts.push({ ramp: rp, o, D, m });
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * w + x; if (m[i]) id[i] = pi; }
    },
  };
  build(P);
  const out = g.createImageData(w, h); const px = out.data;
  const rim = opts.rim ? hex(opts.rim) : null, rimK = opts.rimK ?? 0.45;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const p = id[i]; if (p < 0) continue; const pt = parts[p]; const o = pt.o, rp = pt.ramp, n = rp.length;
    let idx, s = 0;
    if (o.flat != null) idx = o.flat;
    else {
      const R = o.R || 7; const hh = (j, xx, yy) => { if (xx < 0 || yy < 0 || xx >= w || yy >= h) return 0; const t = Math.min(1, pt.D[j] / R); return Math.sqrt(1 - (1 - t) * (1 - t)); };
      if (o.glow) { s = Math.min(1, pt.D[i] / (o.R || 4)); s = 0.15 + 0.85 * s; }
      else {
        const dx = hh(i + 1, x + 1, y) - hh(i - 1, x - 1, y), dy = hh(i + w, x, y + 1) - hh(i - w, x, y - 1);
        const k = R * 0.55; let nx = -dx * k, ny = -dy * k, nz = 1; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        s = (o.amb ?? 0.12) + (o.dif ?? 0.95) * lam;
        // vertical key: the top of a figure catches more light than its feet (the genre sprites are lit from above)
        s += (o.vk ?? 0.12) * (0.5 - y / h);
        s += o.bias || 0;
        pt._n = pt._n || new Float32Array(N * 2); pt._n[i * 2] = nx; pt._n[i * 2 + 1] = ny;
      }
      const v = Math.max(0, Math.min(1, s)) * (n - 1) + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * (o.dither ?? 0.3);
      idx = Math.max(o.min || 0, Math.min(n - 1, Math.round(v)));
    }
    let c = rp[Math.min(n - 1, idx)];
    // outline: silhouette edge, and a contact line where a part in FRONT of this one begins
    let edge = false, contact = false;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) { edge = true; continue; }
      const q = id[yy * w + xx]; if (q < 0) edge = true; else if (q > p && !parts[q].o.noline && !o.noline && parts[q].ramp !== rp) contact = true;
    }
    if (edge && !o.noedge) c = o.glow ? rp[0] : (o.ol ? hex(o.ol) : dark(rp[0], 0.45));
    else if (contact && !o.glow) c = dark(rp[0], 0.8);
    else if (rim && !o.glow && o.flat == null && pt._n) { const nx = pt._n[i * 2], ny = pt._n[i * 2 + 1]; const r = Math.max(0, ny * 0.9 + nx * 0.25) * rimK; if (r > 0.12) c = [c[0] + (rim[0] - c[0]) * r, c[1] + (rim[1] - c[1]) * r, c[2] + (rim[2] - c[2]) * r]; }
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
  }
  return out;
}

// ======================================================================================================
// CREATURES. Coordinates: pixels, y UP, (0,0) = between the feet. Each def: { w, h, ppu, frames: [pose...],
// aura, rim, paint(P, pose) }. Poses are small objects the painter interpolates limbs from.
// ======================================================================================================
const R = {
  // Pyrelord
  skin: ramp('#1c0503', '#4e0f07', '#83200d', '#b83d17', '#e26a2a', '#ffa45a'),
  skinD: ramp('#140302', '#3a0a05', '#661808', '#93300f', '#b8501e'),
  horn: ramp('#1e140a', '#4c3a26', '#86704e', '#c2ac82', '#f2e6c4'),
  fire: ramp('#7a1000', '#d23a06', '#ff7a14', '#ffb83a', '#fff0a8'),
  gold: ramp('#241404', '#5e3a0c', '#a0701c', '#dcaa3c', '#fff0a0'),
  belt: ramp('#100808', '#2e1e1a', '#553a30', '#7e5a48'),
  eyeY: ramp('#ff8a00', '#ffd030', '#fff8c0'),
  claw: ramp('#120c08', '#3a2e24', '#7a6a58', '#d0c4b0'),
  // Frost Maiden
  iceSkin: ramp('#1a2250', '#34478e', '#5a78c4', '#88a8e4', '#bcd6f6', '#eaf4ff'),
  hair: ramp('#06102e', '#0e2a66', '#1a4e9e', '#2e7ad0', '#5eaaec', '#b0e0ff'),
  suit: ramp('#04081c', '#0a1640', '#142a6e', '#22449c', '#3e6ac8'),
  crystal: ramp('#2a5ab0', '#5aa0e8', '#a8dcff', '#f0fcff'),
  eyeB: ramp('#3a8aff', '#b0e8ff', '#ffffff'),
  // Storm Elder
  robe: ramp('#0e0c26', '#221e58', '#3a3690', '#5a5cc2', '#8e96e6'),
  mantle: ramp('#140c06', '#3a2410', '#64401c', '#946430', '#c8904c'),
  beard: ramp('#3c3a48', '#6e6c80', '#a4a4b8', '#d6d6e4', '#ffffff'),
  flesh: ramp('#2a1408', '#6a3a1e', '#a86a40', '#dca070', '#f8d4a8'),
  wood: ramp('#140a04', '#3a220e', '#63401c', '#8e6230', '#b88a50'),
  orb: ramp('#2040c0', '#4a90ff', '#a0e0ff', '#ffffff'),
  trim: ramp('#3a2606', '#8a6414', '#d8a834', '#fff0a0'),
  // Hearthling
  fur: ramp('#4a2a14', '#8a5a2c', '#c08a4c', '#e4b87a', '#fce0b0'),
  wingP: ramp('#0e2a10', '#1e5a22', '#3a8a34', '#78c050'),
  pom: ramp('#6a0a1a', '#c01e36', '#ff4a5a', '#ff9aa0', '#ffe0e4'),
  ember: ramp('#7a2a04', '#d05a10', '#ff9a2a', '#ffd070', '#fff4c0'),
  nose: ramp('#1a0c06', '#3a2010', '#5e3a1e', '#8a6040'),
  ink: ramp('#1a1420', '#2e2438'),
  // Gemfox
  cfur: ramp('#2a0e04', '#6a2a0c', '#a84a18', '#d8782c', '#f4a85a', '#ffe0b8'),
  cbelly: ramp('#5a4a40', '#9a8a7e', '#d8ccc0', '#fff8f0'),
  ruby: ramp('#08206a', '#1a5ae0', '#5ab0ff', '#d0f0ff'),
  // Wyrm Sovereign
  scale: ramp('#0e1430', '#243464', '#3c5898', '#5e82c8', '#8eb0e8', '#d4e4ff'),
  memb: ramp('#140c2c', '#2c1e5a', '#46348a', '#6450b4', '#8a78d8'),
  plate: ramp('#1c140c', '#4a3a26', '#7e6a4a', '#b8a078', '#e8dcbc'),
  bhorn: ramp('#1a1a22', '#4a4a58', '#8a8a9a', '#cacad6', '#ffffff'),
  eyeG: ramp('#ff6a00', '#ffc040', '#ffffe0'),
  maw: ramp('#300008', '#701020', '#c04050'),
};

// small helpers for poses
const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

const DEFS = {
  // ---------------------------------------------------------------- PYRELORD: horned fire demon rising from the flames
  pyrelord: {
    w: 184, h: 200, ppu: 70, aura: '#ff5a10', rim: '#ffb040', rimK: 0.5,
    frames: [
      { la: [[-40, 122], [-52, 94], [-46, 70]], ra: [[40, 122], [54, 96], [48, 72]], head: [0, 147], lean: 0, jaw: 0 },
      { la: [[-40, 124], [-54, 152], [-24, 180]], ra: [[40, 124], [54, 152], [24, 180]], head: [0, 150], lean: 0, jaw: 1, up: 1 },
      { la: [[-40, 120], [-66, 112], [-82, 94]], ra: [[40, 122], [60, 112], [66, 134]], head: [-6, 144], lean: -6, jaw: 1 },
    ],
    paint(P, f) {
      const ln = f.lean || 0; const hx = f.head[0], hy = f.head[1];
      // flame mane behind everything: tongues rising off the shoulders and the back of the skull
      P.part(R.fire, { glow: true, R: 5, noline: true }, (k) => {
        for (const [x0, y0, x1, y1, x2, y2, r] of [[-30, 128, -44, 158, -36, 190, 9], [30, 128, 46, 160, 40, 192, 9], [-16, 150, -26, 178, -14, 198, 8], [16, 150, 24, 176, 18, 198, 8], [0, 156, 6, 180, -2, 199, 9], [-44, 118, -64, 140, -62, 166, 7], [44, 118, 64, 142, 60, 170, 7]])
          k.tongue([[x0 + ln, y0], [x1 + ln, y1], [x2 + ln, y2]], r);
      });
      // legs (behind the loincloth), digitigrade-ish, feet sunk in flame
      P.part(R.skinD, { R: 6 }, (k) => { k.limb([-16, 74], [-28, 40], [-24, 6], 13, 10, 8); k.limb([16, 74], [30, 42], [26, 6], 13, 10, 8); k.ell(-28, 6, 12, 6); k.ell(28, 6, 12, 6); });
      P.part(R.claw, { flat: 2, noline: true }, (k) => { for (const s of [-1, 1]) for (const dx of [-8, -2, 4]) k.poly([[s * 28 + dx - 2, 2], [s * 28 + dx + 2, 2], [s * 28 + dx - 3, -1]]); });
      // torso: V-taper, lean shifts the chest
      P.part(R.skin, { R: 14 }, (k) => {
        k.blob([[-20 + ln * 0.3, 74], [-26 + ln * 0.5, 96], [-36 + ln, 118], [-30 + ln, 134], [0 + ln, 140], [30 + ln, 134], [36 + ln, 118], [26 + ln * 0.5, 96], [20 + ln * 0.3, 74]]);
        k.ell(-38 + ln, 124, 14, 12); k.ell(38 + ln, 124, 14, 12);   // deltoids
        k.ell(hx * 0.5, 136, 16, 8);                                  // trapezius / neck base
      });
      // pecs and abs as shaded sub-parts (contact lines separate them)
      P.part(R.skin, { R: 9, noline: true }, (k) => { k.ell(-14 + ln, 118, 15, 11, 0.15); k.ell(14 + ln, 118, 15, 11, -0.15); });
      P.part(R.skinD, { flat: 1, noline: true }, (k) => { k.line(ln, 108, ln * 0.4, 80, 1.6); for (const y of [100, 90]) { k.line(-9 + ln * 0.6, y, -2 + ln * 0.6, y - 1, 1.3); k.line(2 + ln * 0.6, y - 1, 9 + ln * 0.6, y, 1.3); } });
      // belt + loincloth
      P.part(R.belt, { R: 4 }, (k) => { k.poly([[-22, 70], [22, 70], [24, 80], [-24, 80]]); k.poly([[-12, 72], [12, 72], [16, 36], [2, 42], [-14, 34]]); });
      P.part(R.gold, { R: 3 }, (k) => { k.ell(0, 75, 7, 5); });
      // arms (upper + fore), bracers, fists
      const arm = (a) => { P.part(R.skin, { R: 9 }, (k) => { k.tube([[a[0][0] + ln, a[0][1]], a[1]], [12, 9]); }); P.part(R.skin, { R: 8 }, (k) => { k.tube([a[1], a[2]], [9, 8]); k.circ(a[2][0], a[2][1], 9); }); P.part(R.gold, { R: 4 }, (k) => { k.tube([lerp2(a[1], a[2], 0.35), lerp2(a[1], a[2], 0.7)], 9.5); }); P.part(R.claw, { flat: 3, noline: true }, (k) => { const d = [a[2][0] - a[1][0], a[2][1] - a[1][1]]; const l = Math.hypot(d[0], d[1]) || 1; const ux = d[0] / l, uy = d[1] / l; for (const s of [-4, 0, 4]) k.poly([[a[2][0] + ux * 7 - uy * s, a[2][1] + uy * 7 + ux * s], [a[2][0] + ux * 13 - uy * s * 1.3, a[2][1] + uy * 13 + ux * s * 1.3], [a[2][0] + ux * 8 - uy * (s + 2), a[2][1] + uy * 8 + ux * (s + 2)]]); }); };
      // the far arm first (screen-right in the attack pose is the pulled-back one)
      arm(f.ra); arm(f.la);
      // head: brutal jaw, brow ridge, glowing eyes, fangs; horns sweep up and back
      P.part(R.horn, { R: 4 }, (k) => { for (const s of [-1, 1]) k.tube([[hx + s * 9, hy + 8], [hx + s * 22, hy + 16], [hx + s * 34, hy + 30], [hx + s * 30, hy + 44], [hx + s * 20, hy + 48]], [6, 5, 4, 2.5, 0.8]); });
      P.part(R.skin, { R: 8 }, (k) => { k.ell(hx, hy + 4, 12, 13); k.ell(hx - 2, hy - 6, 11, 8); });
      P.part(R.skinD, { R: 3 }, (k) => { k.poly([[hx - 13, hy + 7], [hx + 13, hy + 7], [hx + 9, hy + 12], [hx - 9, hy + 12]]); });   // brow ridge
      P.part(R.eyeY, { glow: true, R: 1.5, noline: true }, (k) => { k.poly([[hx - 10, hy + 6], [hx - 3, hy + 5], [hx - 4, hy + 2], [hx - 9, hy + 3]]); k.poly([[hx + 10, hy + 6], [hx + 3, hy + 5], [hx + 4, hy + 2], [hx + 9, hy + 3]]); });
      if (f.jaw) P.part(R.maw, { flat: 0, noline: true }, (k) => { k.ell(hx - 2, hy - 9, 7, 4.5); });
      P.part(R.claw, { flat: 3, noline: true }, (k) => { k.poly([[hx - 7, hy - 5], [hx - 5, hy - 5], [hx - 6, hy - 10]]); k.poly([[hx + 3, hy - 5], [hx + 5, hy - 5], [hx + 4, hy - 10]]); });
      // flames licking up the shins (in front)
      P.part(R.fire, { glow: true, R: 4, noline: true }, (k) => { for (const [x, r, t] of [[-40, 8, 26], [-22, 7, 20], [-6, 6, 14], [12, 7, 22], [32, 8, 28], [46, 6, 18]]) k.tongue([[x, 0], [x + 3, t * 0.5], [x - 2, t]], r); });
    },
  },
  // ---------------------------------------------------------------- FROST MAIDEN: ice maiden, hair streaming in a cold wind
  frost_maiden: {
    w: 150, h: 204, ppu: 64, aura: '#5ab8ff', rim: '#c8f0ff', rimK: 0.4,
    frames: [
      { la: [[-15, 136], [-6, 112], [12, 126]], ra: [[15, 136], [8, 112], [-10, 126]], head: [0, 160], hair: 0 },
      { la: [[-15, 136], [-38, 146], [-58, 168]], ra: [[15, 136], [38, 146], [58, 168]], head: [0, 161], hair: 0.6 },
      { la: [[-15, 136], [-40, 132], [-64, 128]], ra: [[15, 136], [30, 154], [26, 176]], head: [-3, 159], hair: 1 },
    ],
    paint(P, f) {
      const hx = f.head[0], hy = f.head[1], hw = f.hair;
      // hair mass streaming behind her to the right
      P.part(R.hair, { R: 6 }, (k) => {
        for (const [dy, r, sw] of [[6, 9, 1], [0, 8, 0.8], [-8, 7, 1.2], [-16, 6, 0.9], [-24, 5, 1.1]]) k.tube([[hx + 2, hy + dy + 4], [hx + 20 + 8 * sw * hw, hy + dy - 6], [hx + 34 + 16 * sw * hw, hy + dy - 30 + 10 * hw], [hx + 44 + 22 * sw * hw, hy + dy - 60 + 22 * hw], [hx + 40 + 30 * sw * hw, hy + dy - 86 + 30 * hw]], [r, r * 1.1, r * 0.9, r * 0.6, 0.6]);
        k.ell(hx + 2, hy + 4, 14, 14);
      });
      // legs: long, crossed at the ankle, floating on tiptoe
      P.part(R.suit, { R: 6 }, (k) => { k.limb([-9, 92], [-13, 50], [-2, 6], 11, 7, 4.5); });
      P.part(R.iceSkin, { R: 5 }, (k) => { k.limb([9, 92], [11, 50], [-6, 10], 11, 7, 4.5); });
      // body: bodysuit torso, narrow waist, hips
      P.part(R.suit, { R: 11 }, (k) => { k.blob([[-17, 86], [-19, 100], [-12, 116], [-19, 136], [0, 143], [19, 136], [12, 116], [19, 100], [17, 86], [0, 80]]); });
      P.part(R.iceSkin, { R: 8, noline: true }, (k) => { k.ell(-7, 128, 7, 6); k.ell(7, 128, 7, 6); k.ell(0, 138, 9, 4); });
      // ice crystal shoulder pieces and hip shards
      P.part(R.crystal, { R: 3 }, (k) => { for (const s of [-1, 1]) { k.poly([[s * 12, 138], [s * 22, 150], [s * 26, 140], [s * 20, 132]]); k.poly([[s * 12, 92], [s * 20, 84], [s * 16, 72], [s * 10, 86]]); } });
      // arms
      const arm = (a) => { P.part(R.iceSkin, { R: 5 }, (k) => { k.limb(a[0], a[1], a[2], 6.5, 5, 4); k.ell(a[2][0], a[2][1], 5, 4.5); }); };
      arm(f.ra); arm(f.la);
      P.part(R.crystal, { R: 2 }, (k) => { for (const a of [f.la, f.ra]) k.tube([lerp2(a[1], a[2], 0.2), lerp2(a[1], a[2], 0.55)], 4.5); });
      // head: slim face, hair framing it, a crystal diadem
      P.part(R.iceSkin, { R: 7 }, (k) => { k.ell(hx, hy, 9, 11); k.tube([[hx, hy - 10], [0, 140]], 3.5); });
      P.part(R.hair, { R: 4 }, (k) => { k.blob([[hx - 11, hy + 2], [hx - 10, hy + 12], [hx, hy + 15], [hx + 11, hy + 10], [hx + 12, hy - 2], [hx + 6, hy + 6], [hx - 4, hy + 8]]); k.tube([[hx - 10, hy + 4], [hx - 13, hy - 10], [hx - 10, hy - 24]], [4, 3, 0.8]); });
      P.part(R.crystal, { glow: true, R: 2, noline: true }, (k) => { k.poly([[hx - 6, hy + 13], [hx, hy + 24], [hx + 6, hy + 13]]); k.poly([[hx - 12, hy + 10], [hx - 12, hy + 19], [hx - 6, hy + 13]]); k.poly([[hx + 12, hy + 10], [hx + 12, hy + 19], [hx + 6, hy + 13]]); });
      P.part(R.eyeB, { glow: true, R: 1, noline: true }, (k) => { k.poly([[hx - 7, hy + 2], [hx - 2, hy + 2], [hx - 3, hy], [hx - 7, hy + 0.5]]); k.poly([[hx + 7, hy + 2], [hx + 2, hy + 2], [hx + 3, hy], [hx + 7, hy + 0.5]]); });
      P.part(R.suit, { flat: 1, noline: true }, (k) => { k.line(hx - 2, hy - 6, hx + 2, hy - 6, 1.2); });
      // frost trailing off her feet
      P.part(R.crystal, { glow: true, R: 2, noline: true }, (k) => { k.tongue([[-4, 8], [-10, 2], [-20, 0]], 3); k.tongue([[-6, 12], [4, 4], [14, 0]], 2.5); });
    },
  },
  // ---------------------------------------------------------------- STORM ELDER: the storm sage, beard and staff
  storm_elder: {
    w: 160, h: 206, ppu: 74, aura: '#6a9aff', rim: '#b0d8ff', rimK: 0.35,
    frames: [
      { la: [[-22, 140], [-34, 112], [-40, 92]], ra: [[22, 140], [30, 112], [22, 96]], staff: [[-42, 6], [-40, 176]], head: [0, 160] },
      { la: [[-22, 142], [-30, 164], [-18, 188]], ra: [[22, 142], [30, 164], [14, 186]], staff: [[-8, 134], [-18, 204]], head: [0, 162] },
      { la: [[-22, 140], [-48, 126], [-64, 118]], ra: [[22, 140], [16, 118], [-26, 118]], staff: [[-10, 124], [-76, 108]], head: [-4, 158] },
    ],
    paint(P, f) {
      const hx = f.head[0], hy = f.head[1]; const [s0, s1] = f.staff;
      // mantle flaring behind
      P.part(R.mantle, { R: 10 }, (k) => { k.blob([[-28, 146], [-44, 90], [-52, 20], [-30, 4], [30, 4], [52, 20], [44, 90], [28, 146], [0, 152]]); });
      // robe
      P.part(R.robe, { R: 14 }, (k) => { k.blob([[-22, 146], [-30, 100], [-40, 30], [-44, 4], [0, 0], [44, 4], [40, 30], [30, 100], [22, 146], [0, 150]]); });
      P.part(R.trim, { R: 2, noline: true }, (k) => { k.tube([[-44, 5], [0, 1], [44, 5]], 2.2); k.tube([[0, 146], [2, 100], [0, 4]], 1.6); k.tube([[-26, 100], [26, 100]], 2); });
      P.part(R.robe, { flat: 1, noline: true }, (k) => { for (const x of [-26, -12, 14, 28]) k.line(x * 0.7, 94, x, 8, 1.2); });
      // staff (drawn under the hands)
      const staff = () => {
        P.part(R.wood, { R: 3 }, (k) => { const d = [s1[0] - s0[0], s1[1] - s0[1]]; k.tube([s0, lerp2(s0, s1, 0.35), [s0[0] + d[0] * 0.7 + 2, s0[1] + d[1] * 0.7], s1], [3, 3.4, 3, 3.6]); k.tube([s1, [s1[0] - 7, s1[1] + 8], [s1[0] - 2, s1[1] + 14]], [2.4, 1.8, 1]); k.tube([s1, [s1[0] + 7, s1[1] + 8], [s1[0] + 2, s1[1] + 15]], [2.4, 1.8, 1]); });
        P.part(R.orb, { glow: true, R: 4, noline: true }, (k) => { k.circ(s1[0], s1[1] + 8, 6); });
      };
      staff();
      // arms in sleeves, hands
      const arm = (a) => { P.part(R.robe, { R: 7 }, (k) => { k.limb(a[0], a[1], a[2], 10, 9, 10); }); P.part(R.trim, { R: 2, noline: true }, (k) => { k.circ(a[2][0], a[2][1], 7); }); P.part(R.flesh, { R: 4 }, (k) => { k.circ(a[2][0] + (a[2][0] - a[1][0]) * 0.28, a[2][1] + (a[2][1] - a[1][1]) * 0.28, 5); }); };
      arm(f.ra); arm(f.la);
      // head: bald crown, bushy brows, long white hair and a beard to the belt
      P.part(R.beard, { R: 6 }, (k) => { k.blob([[hx - 16, hy + 8], [hx - 20, hy - 12], [hx - 18, hy - 40], [hx - 8, hy - 70], [hx, hy - 78], [hx + 8, hy - 70], [hx + 18, hy - 40], [hx + 20, hy - 12], [hx + 16, hy + 8]]); });
      P.part(R.flesh, { R: 7 }, (k) => { k.ell(hx, hy + 6, 11, 12); k.ell(hx - 11, hy + 4, 3, 4); k.ell(hx + 11, hy + 4, 3, 4); });
      P.part(R.beard, { R: 3 }, (k) => { k.tube([[hx - 12, hy + 7], [hx - 5, hy + 10], [hx - 1, hy + 7]], [3, 3.2, 1.6]); k.tube([[hx + 12, hy + 7], [hx + 5, hy + 10], [hx + 1, hy + 7]], [3, 3.2, 1.6]); k.blob([[hx - 12, hy], [hx - 8, hy - 8], [hx, hy - 12], [hx + 8, hy - 8], [hx + 12, hy], [hx, hy - 2]]); });
      P.part(R.beard, { flat: 1, noline: true }, (k) => { for (const x of [-8, 0, 8]) k.line(hx + x, hy - 16, hx + x * 1.3, hy - 64, 1); });
      P.part(R.eyeB, { glow: true, R: 1, noline: true }, (k) => { k.ell(hx - 5, hy + 4.5, 2, 1.2); k.ell(hx + 5, hy + 4.5, 2, 1.2); });
    },
  },
  // ---------------------------------------------------------------- HEARTHLING: round hearth spirit, ember tuft, leaf wings
  hearthling: {
    w: 88, h: 92, ppu: 72, aura: '#ffb060', rim: '#ffe0b0', rimK: 0.3,
    frames: [
      { arm: -0.3, wing: 0, eye: 0 },
      { arm: 1, wing: 1, eye: 1 },
      { arm: 0.4, wing: 0.5, eye: 1 },
    ],
    paint(P, f) {
      const wg = f.wing;
      P.part(R.wingP, { R: 4 }, (k) => { for (const s of [-1, 1]) k.poly([[s * 12, 40], [s * (28 + 6 * wg), 56 + 12 * wg], [s * (34 + 8 * wg), 44 + 8 * wg], [s * (30 + 6 * wg), 38 + 4 * wg], [s * (32 + 4 * wg), 30], [s * 22, 34]]); });
      P.part(R.fur, { R: 9 }, (k) => { k.ell(0, 24, 17, 18); });                                    // body
      P.part(R.fur, { R: 5 }, (k) => { k.ell(-9, 5, 6, 5); k.ell(9, 5, 6, 5); });                  // feet
      const ay = 30 + 16 * f.arm; P.part(R.fur, { R: 4 }, (k) => { k.tube([[-13, 30], [-22, ay]], [5, 4.5]); k.tube([[13, 30], [22, ay]], [5, 4.5]); });
      P.part(R.fur, { R: 11 }, (k) => { k.ell(0, 52, 22, 18); k.ell(-18, 60, 7, 9, 0.5); k.ell(18, 60, 7, 9, -0.5); });   // head + ears
      P.part(R.wingP, { R: 2, noline: true }, (k) => { k.ell(-18, 61, 3, 5, 0.5); k.ell(18, 61, 3, 5, -0.5); });
      P.part(R.ink, { flat: 0, noline: true }, (k) => { if (f.eye) { k.line(-10, 52, -6, 55, 1.4); k.line(-6, 55, -2, 52, 1.4); k.line(2, 52, 6, 55, 1.4); k.line(6, 55, 10, 52, 1.4); } else { k.line(-8, 54, -4, 54, 1.6); k.line(4, 54, 8, 54, 1.6); } });
      P.part(R.nose, { R: 3 }, (k) => { k.ell(0, 47, 4.5, 3.5); });
      // ember tuft: a small hearth-flame burning on the crown of the head
      P.part(R.ember, { glow: true, R: 4, noline: true }, (k) => { k.blob([[-7, 68], [-4, 76], [-1, 73], [1, 84], [4, 75], [7, 78], [8, 68]]); });
    },
  },
  // ---------------------------------------------------------------- GEMFOX: long-eared jewel beast
  gemfox: {
    w: 104, h: 84, ppu: 76, aura: '#5ab0ff', rim: '#ffe8d0', rimK: 0.3,
    frames: [
      { head: [-14, 44], gem: 0, tail: 0 },
      { head: [-12, 50], gem: 1, tail: 1 },
      { head: [-14, 46], gem: 0.6, tail: 0.5 },
    ],
    paint(P, f) {
      const [hx, hy] = f.head; const tl = f.tail;
      P.part(R.cfur, { R: 7 }, (k) => { k.tube([[16, 12], [34, 18], [40 + 4 * tl, 38], [30 + 6 * tl, 56], [20 + 8 * tl, 60]], [7, 9, 10, 8, 3]); });   // bushy tail curling up
      P.part(R.cfur, { R: 10 }, (k) => { k.ell(4, 18, 20, 15); });                                          // haunch/body
      P.part(R.cbelly, { R: 6 }, (k) => { k.ell(-8, 20, 9, 12); });
      P.part(R.cfur, { R: 4 }, (k) => { k.tube([[-10, 16], [-14, 4]], [5, 4]); k.tube([[-2, 14], [-4, 3]], [5, 4]); k.ell(-15, 3, 5, 3); k.ell(-5, 3, 5, 3); k.ell(18, 4, 7, 4); });
      P.part(R.cfur, { R: 6 }, (k) => { k.tube([[hx + 8, hy + 6], [hx + 16, hy + 20], [hx + 22, hy + 34]], [5, 4.5, 1.5]); k.tube([[hx - 4, hy + 6], [hx - 8, hy + 22], [hx - 6, hy + 36]], [5, 4.5, 1.5]); });   // ears
      P.part(R.pom, { flat: 1, noline: true }, (k) => { k.tube([[hx + 9, hy + 10], [hx + 15, hy + 21]], 1.5); k.tube([[hx - 4, hy + 10], [hx - 7, hy + 22]], 1.5); });
      P.part(R.cfur, { R: 9 }, (k) => { k.ell(hx, hy, 14, 12); k.ell(hx - 11, hy - 4, 7, 5); k.tube([[hx + 6, hy - 6], [2, 26]], 7); });   // head + muzzle + neck
      P.part(R.ink, { flat: 0, noline: true }, (k) => { k.ell(hx - 5, hy + 1, 2.2, 2.6); k.ell(hx + 5, hy + 1, 1.8, 2.4); k.circ(hx - 17, hy - 3, 1.3); });
      P.part(R.ruby, { glow: true, R: 2.5, noline: true }, (k) => { const r = 3.5 + 1.5 * f.gem; k.poly([[hx - 1, hy + 8 - r], [hx - 1 + r, hy + 8], [hx - 1, hy + 8 + r], [hx - 1 - r, hy + 8]]); });
    },
  },
  // ---------------------------------------------------------------- WYRM SOVEREIGN: the dragon king, wings spread
  wyrm_sovereign: {
    w: 280, h: 216, ppu: 80, aura: '#6a8cff', rim: '#a0c0ff', rimK: 0.35,
    frames: [
      { neck: [[0, 120], [-18, 150], [-30, 170]], head: [-40, 176], hr: 0.25, mouth: 0, wing: 1 },
      { neck: [[0, 120], [-6, 156], [-10, 184]], head: [-8, 196], hr: -0.6, mouth: 1, wing: 0.7 },
      { neck: [[0, 120], [-30, 132], [-52, 136]], head: [-68, 130], hr: 0.55, mouth: 1, wing: 0.85 },
    ],
    paint(P, f) {
      const wg = f.wing; const [hx, hy] = f.head;
      // wings: arm bone + finger ribs, membrane between; far wing first
      const wing = (s, back) => {
        const sh = [s * 24, 124], el = [s * (56 + 10 * wg), 150 + 30 * wg], wr = [s * (96 + 22 * wg), 136 + 60 * wg];
        const tips = [[s * (138 + 2 * wg), 150 + 62 * wg], [s * (138), 102 + 40 * wg], [s * (116), 58 + 20 * wg], [s * (84), 40]];
        P.part(back ? dark3(R.memb) : R.memb, { R: 10 }, (k) => { k.poly([sh, el, wr, tips[0], tips[1], tips[2], tips[3], [s * 40, 70]]); const pts = [...tips, [s * 30, 84]]; for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[i + 1]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const dx = m[0] - wr[0], dy = m[1] - wr[1], dl = Math.hypot(dx, dy) || 1; k.cut(m[0] + dx / dl * L * 0.3, m[1] + dy / dl * L * 0.3, L * 0.42); } });
        P.part(back ? dark3(R.scale) : R.scale, { R: 4 }, (k) => { k.tube([sh, el, wr], [8, 6, 5]); for (const t of tips) k.tube([wr, lerp2(wr, t, 0.6), t], [4, 2.6, 0.8]); k.circ(wr[0], wr[1], 5); });
        P.part(R.bhorn, { flat: 3, noline: true }, (k) => { k.poly([[wr[0], wr[1] + 4], [wr[0] + s * 4, wr[1] + 14], [wr[0] + s * 6, wr[1] + 2]]); });
      };
      wing(1, true);
      // tail sweeping down and back
      P.part(R.scale, { R: 7 }, (k) => { k.tube([[18, 84], [44, 50], [70, 30], [104, 20], [126, 8]], [16, 12, 8, 5, 1]); });
      P.part(R.bhorn, { flat: 2, noline: true }, (k) => { for (const [x, y] of [[40, 64], [62, 42], [86, 28], [108, 20]]) k.poly([[x - 4, y + 6], [x + 4, y + 8], [x + 2, y + 15]]); });
      // hind legs tucked, clawed
      P.part(R.scale, { R: 7 }, (k) => { k.limb([12, 80], [30, 56], [16, 34], 14, 10, 7); k.limb([-14, 80], [-4, 52], [-22, 36], 14, 10, 7); });
      P.part(R.bhorn, { flat: 3, noline: true }, (k) => { for (const [x, y] of [[16, 34], [-22, 36]]) for (const d of [-5, 0, 5]) k.poly([[x + d - 2, y - 2], [x + d + 2, y - 2], [x + d - 1, y - 9]]); });
      // torso + belly plates
      P.part(R.scale, { R: 18 }, (k) => { k.blob([[-26, 126], [-30, 96], [-18, 72], [10, 64], [28, 80], [30, 112], [18, 134]]); });
      P.part(R.plate, { R: 5 }, (k) => { k.blob([[-18, 122], [-22, 96], [-12, 76], [4, 74], [2, 100], [-6, 124]]); });
      P.part(R.plate, { flat: 1, noline: true }, (k) => { for (const y of [82, 90, 98, 106, 114]) k.line(-19 + (y - 80) * 0.05, y, 1 - (y - 80) * 0.1, y + 1, 1); });
      // fore arms reaching forward
      P.part(R.scale, { R: 6 }, (k) => { k.limb([-16, 112], [-34, 96], [-44, 110], 9, 7, 5); });
      P.part(R.bhorn, { flat: 3, noline: true }, (k) => { for (const d of [-4, 0, 4]) k.poly([[-44 + d, 112], [-48 + d, 118], [-42 + d, 116]]); });
      // neck + head
      P.part(R.scale, { R: 9 }, (k) => { k.tube([...f.neck, [hx + 6, hy - 2]], [16, 13, 10, 9]); });
      P.part(R.plate, { R: 3, noline: true }, (k) => { k.tube([[f.neck[0][0] - 10, f.neck[0][1] - 4], [f.neck[1][0] - 8, f.neck[1][1] - 6], [f.neck[2][0] - 6, f.neck[2][1] - 6]], [5, 4, 3.5]); });
      const c = Math.cos(f.hr), s = Math.sin(f.hr); const H = (x0, y0) => { const x = x0 * 1.45, y = y0 * 1.45; return [hx + x * c - y * s, hy + x * s + y * c]; };   // head frame: +x = back of skull, snout at -x
      P.part(R.bhorn, { R: 3 }, (k) => { k.tube([H(4, 6), H(18, 16), H(34, 20), H(44, 16)], [4, 3.4, 2.2, 0.6]); k.tube([H(2, 2), H(16, 6), H(30, 4)], [3, 2.4, 0.6]); });
      P.part(R.scale, { R: 7 }, (k) => { k.blob([H(10, 8), H(-6, 10), H(-24, 6), H(-32, 2), H(-30, -4), H(-8, -6), H(10, -6)]); });
      if (f.mouth) {
        P.part(R.maw, { flat: 0, noline: true }, (k) => { k.poly([H(-6, -4), H(-30, -3), H(-30, -12)]); });
        P.part(R.scale, { R: 4 }, (k) => { k.blob([H(-4, -6), H(-26, -12), H(-30, -16), H(-10, -14)]); });
        P.part(R.bhorn, { flat: 3, noline: true }, (k) => { for (const x of [-12, -18, -24]) k.poly([H(x, -4), H(x - 2, -4), H(x - 1, -8)]); });
      }
      P.part(R.eyeG, { glow: true, R: 1.2, noline: true }, (k) => { k.poly([H(-8, 5), H(-2, 6), H(-4, 3)]); });
      wing(-1, false);
    },
  },
};
function dark3(rp) { return rp.map((c) => [c[0] * 0.7, c[1] * 0.7, c[2] * 0.78]); }

const cache = {}, frameCache = {};
export const CREATURES = Object.keys(DEFS);
function frameImage(key, i) {
  const fc = frameCache[key] || (frameCache[key] = []); if (fc[i]) return fc[i];
  const d = DEFS[key]; fc[i] = paintFrame(d.w, d.h, (P) => d.paint(P, d.frames[i]), { rim: d.rim, rimK: d.rimK }); return fc[i];
}
// incremental warm-up: paints ONE missing frame (~5-120 ms) and returns true, or false once every frame is cached,
// so an idle loop can spread the whole roster over several idle slices instead of one long stall
// R20: `keys` limits the warm to those creatures (the summons someone on the field can actually cast go first)
export function warmStep(keys = CREATURES) {
  for (const key of keys) { if (!DEFS[key]) continue; const n = DEFS[key].frames.length; for (let i = 0; i < n; i++) if (!(frameCache[key] && frameCache[key][i])) { frameImage(key, i); return true; } }
  return false;
}
// PERF r12: drop a creature's two sheet canvases once its textures are gone (summons.js releases them a few seconds
// after the last creature of that kind leaves). Zeroing the size frees the (GPU-backed) 2-D backing store now rather
// than at the next GC. The painted frames (frameCache ImageData) stay, so the next paintCreature() is a putImageData +
// two blurs per frame, not a repaint.
export function releaseCreature(key) {
  const c = cache[key]; if (!c) return; delete cache[key];
  for (const cv of [c.atlas, c.glow]) { try { cv.width = 0; cv.height = 0; } catch { /* detached */ } }
}
export function paintCreature(key) {
  if (cache[key]) return cache[key];
  const d = DEFS[key]; if (!d) return null;
  const pad = 20, cw = d.w + pad * 2, ch = d.h + pad * 2, n = d.frames.length;
  const atlas = mkCanvas(cw * n, ch), ag = atlas.getContext('2d');
  const glow = mkCanvas(cw * n, ch), gg = glow.getContext('2d');
  const tmp = mkCanvas(cw, ch), tg = tmp.getContext('2d');
  d.frames.forEach((pose, i) => {
    const img = frameImage(key, i);
    ag.putImageData(img, i * cw + pad, pad);
    // halo: silhouette in the aura colour, blurred twice (tight + wide)
    tg.clearRect(0, 0, cw, ch); tg.drawImage(atlas, i * cw, 0, cw, ch, 0, 0, cw, ch);
    tg.globalCompositeOperation = 'source-in'; tg.fillStyle = d.aura; tg.fillRect(0, 0, cw, ch); tg.globalCompositeOperation = 'source-over';
    gg.save(); gg.beginPath(); gg.rect(i * cw, 0, cw, ch); gg.clip();
    gg.filter = 'blur(10px)'; gg.globalAlpha = 0.9; gg.drawImage(tmp, i * cw, 0); gg.filter = 'blur(3px)'; gg.globalAlpha = 0.8; gg.drawImage(tmp, i * cw, 0);
    gg.restore();
  });
  gg.filter = 'none';
  const out = { atlas, glow, cellW: cw, cellH: ch, frames: n, pad, ppu: d.ppu, w: d.w, h: d.h, aura: d.aura };
  cache[key] = out; return out;
}
