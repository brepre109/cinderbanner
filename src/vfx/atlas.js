import * as THREE from 'three';
// Procedural VFX sprite atlas (4x4 cells of 160px) and ground-decal textures. Shapes are traced from the PS1 tactics genre
// spell vocabulary: blown-out cores, saturated rims, rolling fire billows, chunky faceted ice, long
// four-point sparkles, long tapered streaks. Everything is white-on-transparent so the particle colour tints it;
// decals carry their own colour where it matters (scorch is black).
export const CELLS = 5, CELL = 160;
// R13: 5x5 -- nine status/ward glyphs (the genre marks every status with a SHAPE: clock for Haste/Slow, hourglass for
// Stop, Z for Sleep, heart for Charm, skull for Doom/Curse, bubble for Poison, hex plates for Protect).
export const F = { glow: 0, core: 1, flame: 2, spark: 3, star: 4, shard: 5, smoke: 6, ring: 7, slash: 8, arrow: 9, stone: 10, shuriken: 11, billow: 12, dust: 13, flare: 14, glint: 15,
  clock: 16, hex: 17, bubble: 18, skull: 19, heart: 20, zee: 21, plus: 22, hourglass: 23, mute: 24 };
F.wisp = F.billow; // legacy alias

function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rad = (g, cx, cy, r, stops) => { const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r); for (const [k, c] of stops) grd.addColorStop(k, c); return grd; };
const W = (a) => `rgba(255,255,255,${a})`;
const blob = (g, x, y, r, a) => { g.fillStyle = rad(g, x, y, r, [[0, W(a)], [0.42, W(a * 0.72)], [0.72, W(a * 0.24)], [1, W(0)]]); g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); };

const cellDrawers = {
  // soft omnidirectional glow — the workhorse behind every core
  [F.glow](g, s) { g.fillStyle = rad(g, s / 2, s / 2, s / 2, [[0, W(1)], [0.16, W(0.8)], [0.42, W(0.32)], [0.72, W(0.07)], [1, W(0)]]); g.fillRect(0, 0, s, s); },
  // blown-out core: flat white plateau then a fast falloff (the genre's white-hot centre)
  [F.core](g, s) { g.fillStyle = rad(g, s / 2, s / 2, s / 2, [[0, W(1)], [0.46, W(1)], [0.60, W(0.78)], [0.78, W(0.22)], [1, W(0)]]); g.fillRect(0, 0, s, s); },
  // flame tongue: broad rolling base, licking tip, hot centre line
  [F.flame](g, s) {
    g.save(); g.filter = 'blur(3px)'; g.fillStyle = W(0.95);
    g.beginPath(); g.moveTo(s * 0.5, s * 0.02);
    g.bezierCurveTo(s * 0.58, s * 0.26, s * 0.72, s * 0.34, s * 0.70, s * 0.5);
    g.bezierCurveTo(s * 0.68, s * 0.60, s * 0.88, s * 0.66, s * 0.86, s * 0.80);
    g.bezierCurveTo(s * 0.84, s * 0.96, s * 0.16, s * 0.96, s * 0.14, s * 0.80);
    g.bezierCurveTo(s * 0.12, s * 0.66, s * 0.32, s * 0.60, s * 0.30, s * 0.5);
    g.bezierCurveTo(s * 0.28, s * 0.34, s * 0.42, s * 0.26, s * 0.5, s * 0.02);
    g.closePath(); g.fill(); g.restore();
    blob(g, s * 0.5, s * 0.74, s * 0.3, 1); blob(g, s * 0.5, s * 0.46, s * 0.15, 0.8);
  },
  // long tapered streak (impact rays, sparks) — nearly the full cell, razor thin
  [F.spark](g, s) { g.save(); g.translate(s / 2, s / 2); g.scale(1, 0.085); g.fillStyle = rad(g, 0, 0, s * 0.5, [[0, W(1)], [0.2, W(1)], [0.5, W(0.6)], [0.8, W(0.14)], [1, W(0)]]); g.fillRect(-s / 2, -s / 2, s, s); g.restore(); blob(g, s / 2, s / 2, s * 0.09, 1); },
  // the genre four-point sparkle: long thin rays, tiny round core (Cure / charge motes)
  [F.star](g, s) {
    const c = s / 2; g.save(); g.filter = 'blur(1.2px)'; g.fillStyle = W(1);
    for (const [rot, len, w] of [[0, 0.5, 0.030], [Math.PI / 2, 0.5, 0.030], [Math.PI / 4, 0.21, 0.012], [-Math.PI / 4, 0.21, 0.012]]) {
      g.save(); g.translate(c, c); g.rotate(rot); g.beginPath(); g.moveTo(-s * len, 0); g.lineTo(0, -s * w); g.lineTo(s * len, 0); g.lineTo(0, s * w); g.closePath(); g.fill(); g.restore();
    }
    g.restore(); blob(g, c, c, s * 0.17, 1); blob(g, c, c, s * 0.07, 1);
  },
  // chunky faceted ice crystal: wide angular gem, hard facet edges, luminous core
  [F.shard](g, s) {
    const P = (x, y) => [s * x, s * y];
    const facets = [
      { pts: [[0.50, 0.01], [0.78, 0.34], [0.66, 0.99], [0.50, 0.99]], a: [0.55, 0.95] },
      { pts: [[0.50, 0.01], [0.22, 0.34], [0.34, 0.99], [0.50, 0.99]], a: [0.85, 1.0] },
      { pts: [[0.50, 0.16], [0.66, 0.40], [0.58, 0.86], [0.42, 0.86], [0.34, 0.40]], a: [1.0, 1.0] },
    ];
    for (const f of facets) { const grd = g.createLinearGradient(0, s, 0, 0); grd.addColorStop(0, W(f.a[0] * 0.55)); grd.addColorStop(0.55, W(f.a[0])); grd.addColorStop(1, W(f.a[1])); g.fillStyle = grd; g.beginPath(); f.pts.forEach((p, i) => { const [x, y] = P(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill(); }
    g.strokeStyle = W(1); g.lineWidth = s * 0.018; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(...P(0.50, 0.01)); g.lineTo(...P(0.78, 0.34)); g.lineTo(...P(0.66, 0.99)); g.moveTo(...P(0.50, 0.01)); g.lineTo(...P(0.22, 0.34)); g.lineTo(...P(0.34, 0.99)); g.moveTo(...P(0.50, 0.01)); g.lineTo(...P(0.50, 0.99)); g.stroke();
    blob(g, s * 0.5, s * 0.30, s * 0.26, 0.85); blob(g, s * 0.5, s * 0.72, s * 0.20, 0.5);
  },
  [F.smoke](g, s) { const r = seeded(7); for (let i = 0; i < 30; i++) { const x = s * (0.5 + (r() - 0.5) * 0.5), y = s * (0.5 + (r() - 0.5) * 0.5), rr = s * (0.15 + r() * 0.2); blob(g, x, y, rr, 0.2); } },
  // hard-edged shock ring with a soft halo
  [F.ring](g, s) { g.save(); g.filter = 'blur(3px)'; g.strokeStyle = W(0.85); g.lineWidth = s * 0.09; g.beginPath(); g.arc(s / 2, s / 2, s * 0.41, 0, 6.2832); g.stroke(); g.restore(); g.strokeStyle = W(1); g.lineWidth = s * 0.022; g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, 6.2832); g.stroke(); g.strokeStyle = W(0.5); g.lineWidth = s * 0.012; g.beginPath(); g.arc(s / 2, s / 2, s * 0.36, 0, 6.2832); g.stroke(); },
  // sword crescent: long tapered arc with a hot leading edge
  [F.slash](g, s) {
    g.save(); g.filter = 'blur(1.2px)'; g.fillStyle = W(0.8); g.beginPath(); g.arc(s * 0.5, s * 0.5, s * 0.48, -Math.PI * 0.46, Math.PI * 0.46); g.arc(s * 0.30, s * 0.5, s * 0.44, Math.PI * 0.46, -Math.PI * 0.46, true); g.closePath(); g.fill(); g.restore();
    g.strokeStyle = W(1); g.lineWidth = s * 0.03; g.beginPath(); g.arc(s * 0.5, s * 0.5, s * 0.472, -Math.PI * 0.42, Math.PI * 0.42); g.stroke();
    g.save(); g.globalCompositeOperation = 'destination-in'; const grd = g.createLinearGradient(0, s * 0.02, 0, s * 0.98); grd.addColorStop(0, W(0)); grd.addColorStop(0.22, W(0.85)); grd.addColorStop(0.5, W(1)); grd.addColorStop(0.78, W(0.85)); grd.addColorStop(1, W(0)); g.fillStyle = grd; g.fillRect(0, 0, s, s); g.restore();
  },
  [F.arrow](g, s) { const y = s / 2; g.strokeStyle = 'rgba(226,214,190,1)'; g.lineWidth = s * 0.022; g.beginPath(); g.moveTo(s * 0.06, y); g.lineTo(s * 0.86, y); g.stroke(); g.fillStyle = 'rgba(238,242,255,1)'; g.beginPath(); g.moveTo(s * 0.99, y); g.lineTo(s * 0.78, y - s * 0.062); g.lineTo(s * 0.78, y + s * 0.062); g.closePath(); g.fill(); g.fillStyle = W(0.92); g.beginPath(); g.moveTo(s * 0.04, y); g.lineTo(s * 0.20, y - s * 0.08); g.lineTo(s * 0.27, y); g.lineTo(s * 0.20, y + s * 0.08); g.closePath(); g.fill(); },
  [F.stone](g, s) { const r = seeded(11); g.beginPath(); for (let i = 0; i < 9; i++) { const a = i / 9 * 6.2832, rr = s * (0.3 + r() * 0.13); const x = s / 2 + Math.cos(a) * rr, y = s / 2 + Math.sin(a) * rr; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.fillStyle = rad(g, s * 0.4, s * 0.38, s * 0.5, [[0, W(1)], [0.6, W(0.75)], [1, W(0.45)]]); g.fill(); g.strokeStyle = W(0.35); g.lineWidth = s * 0.02; g.stroke(); },
  [F.shuriken](g, s) { const c = s / 2; g.fillStyle = W(1); g.beginPath(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.moveTo(c + Math.cos(a) * s * 0.48, c + Math.sin(a) * s * 0.48); g.lineTo(c + Math.cos(a + 0.5) * s * 0.14, c + Math.sin(a + 0.5) * s * 0.14); g.lineTo(c + Math.cos(a + Math.PI / 2 - 0.15) * s * 0.14, c + Math.sin(a + Math.PI / 2 - 0.15) * s * 0.14); g.closePath(); } g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(c, c, s * 0.05, 0, 6.2832); g.fill(); g.globalCompositeOperation = 'source-over'; },
  // rolling fire billow. R13: the soft-gaussian version stacked into a smooth DISC; this one is a
  // cauliflower SILHOUETTE -- hard-shouldered lumps (plateau + short falloff), a lobed rim with a crown of
  // smaller lumps on top, dense hot middle -- so a cluster of billows keeps a readable scalloped outline.
  [F.billow](g, s) {
    const r = seeded(3); const c = s / 2;
    const lump = (x, y, rr, a) => { g.fillStyle = rad(g, x, y, rr, [[0, W(a)], [0.6, W(a * 0.92)], [0.82, W(a * 0.5)], [1, W(0)]]); g.beginPath(); g.arc(x, y, rr, 0, 6.2832); g.fill(); };
    for (let i = 0; i < 11; i++) { const a = i / 11 * 6.2832 + r() * 0.35, d = s * (0.25 + r() * 0.06); lump(c + Math.cos(a) * d, c + Math.sin(a) * d * 0.92 + s * 0.02, s * (0.12 + r() * 0.07), 0.62); }
    for (let i = 0; i < 4; i++) { const a = -Math.PI / 2 + (i - 1.5) * 0.5, d = s * 0.3; lump(c + Math.cos(a) * d, c + Math.sin(a) * d, s * (0.1 + r() * 0.04), 0.6); }
    lump(c, c + s * 0.02, s * 0.3, 0.75); blob(g, c, c * 0.98, s * 0.2, 0.55);
  },
  [F.dust](g, s) { const r = seeded(5); for (let i = 0; i < 30; i++) { const x = s * (0.5 + (r() - 0.5) * 0.6), y = s * (0.5 + (r() - 0.5) * 0.6), rr = s * (0.1 + r() * 0.18); blob(g, x, y, rr, 0.28); } },
  // lens flare cross: two long spikes + two short, blown core (impact pop)
  [F.flare](g, s) { const c = s / 2; for (const [rot, len, w] of [[0, 0.5, 0.030], [Math.PI / 2, 0.5, 0.030], [Math.PI / 4, 0.32, 0.016], [-Math.PI / 4, 0.32, 0.016]]) { g.save(); g.translate(c, c); g.rotate(rot); g.filter = 'blur(1.5px)'; g.fillStyle = W(1); g.beginPath(); g.moveTo(-s * len, 0); g.lineTo(0, -s * w); g.lineTo(s * len, 0); g.lineTo(0, s * w); g.closePath(); g.fill(); g.restore(); } g.fillStyle = rad(g, c, c, s * 0.34, [[0, W(1)], [0.22, W(0.9)], [0.55, W(0.28)], [1, W(0)]]); g.fillRect(0, 0, s, s); },
  [F.glint](g, s) { const c = s / 2; g.fillStyle = W(1); for (const rot of [0, Math.PI / 2]) { g.save(); g.translate(c, c); g.rotate(rot); g.beginPath(); g.moveTo(-s * 0.34, 0); g.lineTo(0, -s * 0.042); g.lineTo(s * 0.34, 0); g.lineTo(0, s * 0.042); g.closePath(); g.fill(); g.restore(); } blob(g, c, c, s * 0.12, 1); },
  // ---- R13 status / ward glyphs (white; tinted by the particle colour) ----
  [F.clock](g, s) { const c = s / 2; g.save(); g.filter = 'blur(2.5px)'; g.strokeStyle = W(0.7); g.lineWidth = s * 0.07; g.beginPath(); g.arc(c, c, s * 0.4, 0, 6.2832); g.stroke(); g.restore();
    g.strokeStyle = W(1); g.lineWidth = s * 0.028; g.beginPath(); g.arc(c, c, s * 0.4, 0, 6.2832); g.stroke(); g.fillStyle = W(0.14); g.beginPath(); g.arc(c, c, s * 0.38, 0, 6.2832); g.fill();
    g.lineCap = 'round'; for (let i = 0; i < 12; i++) { const a = i / 12 * 6.2832, r0 = i % 3 ? 0.31 : 0.26; g.lineWidth = s * (i % 3 ? 0.016 : 0.03); g.beginPath(); g.moveTo(c + Math.cos(a) * s * r0, c + Math.sin(a) * s * r0); g.lineTo(c + Math.cos(a) * s * 0.36, c + Math.sin(a) * s * 0.36); g.stroke(); }
    g.lineWidth = s * 0.036; g.beginPath(); g.moveTo(c, c); g.lineTo(c + s * 0.15, c - s * 0.1); g.stroke(); g.lineWidth = s * 0.024; g.beginPath(); g.moveTo(c, c); g.lineTo(c - s * 0.04, c - s * 0.29); g.stroke(); blob(g, c, c, s * 0.06, 1); },
  [F.hex](g, s) { const c = s / 2; const hx = (R) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * 6.2832 + Math.PI / 6; const x = c + Math.cos(a) * R, y = c + Math.sin(a) * R; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
    g.fillStyle = rad(g, c, c, s * 0.46, [[0, W(0.16)], [0.7, W(0.34)], [1, W(0.62)]]); hx(s * 0.44); g.fill();
    g.save(); g.filter = 'blur(2px)'; g.strokeStyle = W(0.8); g.lineWidth = s * 0.06; hx(s * 0.42); g.stroke(); g.restore();
    g.strokeStyle = W(1); g.lineWidth = s * 0.024; g.lineJoin = 'round'; hx(s * 0.43); g.stroke(); g.strokeStyle = W(0.55); g.lineWidth = s * 0.012; hx(s * 0.3); g.stroke();
    g.fillStyle = W(0.5); g.beginPath(); g.moveTo(c - s * 0.3, c - s * 0.12); g.lineTo(c - s * 0.12, c - s * 0.3); g.lineTo(c - s * 0.04, c - s * 0.26); g.lineTo(c - s * 0.26, c - s * 0.04); g.closePath(); g.fill(); },
  [F.bubble](g, s) { const c = s / 2; g.fillStyle = rad(g, c, c, s * 0.44, [[0, W(0.06)], [0.72, W(0.16)], [0.9, W(0.7)], [0.97, W(0.9)], [1, W(0)]]); g.beginPath(); g.arc(c, c, s * 0.44, 0, 6.2832); g.fill();
    g.strokeStyle = W(1); g.lineWidth = s * 0.05; g.lineCap = 'round'; g.beginPath(); g.arc(c, c, s * 0.3, Math.PI * 1.1, Math.PI * 1.45); g.stroke(); blob(g, c - s * 0.2, c - s * 0.2, s * 0.07, 1); },
  [F.skull](g, s) { const c = s / 2; g.save(); g.filter = 'blur(1px)'; g.fillStyle = W(1); g.beginPath(); g.arc(c, c - s * 0.06, s * 0.3, 0, 6.2832); g.fill(); g.beginPath(); g.roundRect(c - s * 0.18, c + s * 0.1, s * 0.36, s * 0.22, s * 0.05); g.fill(); g.restore();
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = W(1); for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(c + sx * s * 0.115, c - s * 0.02, s * 0.085, s * 0.1, sx * 0.3, 0, 6.2832); g.fill(); }
    g.beginPath(); g.moveTo(c, c + s * 0.08); g.lineTo(c - s * 0.04, c + s * 0.15); g.lineTo(c + s * 0.04, c + s * 0.15); g.closePath(); g.fill();
    g.lineWidth = s * 0.022; g.strokeStyle = W(1); for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(c + i * s * 0.07, c + s * 0.2); g.lineTo(c + i * s * 0.07, c + s * 0.33); g.stroke(); }
    g.globalCompositeOperation = 'source-over'; },
  [F.heart](g, s) { const c = s / 2; const heart = () => { g.beginPath(); g.moveTo(c, c + s * 0.36); g.bezierCurveTo(c - s * 0.5, c + s * 0.02, c - s * 0.3, c - s * 0.4, c, c - s * 0.14); g.bezierCurveTo(c + s * 0.3, c - s * 0.4, c + s * 0.5, c + s * 0.02, c, c + s * 0.36); g.closePath(); };
    g.save(); g.filter = 'blur(5px)'; g.fillStyle = W(0.6); heart(); g.fill(); g.restore(); g.fillStyle = rad(g, c - s * 0.1, c - s * 0.1, s * 0.4, [[0, W(1)], [0.6, W(0.85)], [1, W(0.6)]]); heart(); g.fill(); blob(g, c - s * 0.13, c - s * 0.12, s * 0.07, 1); },
  [F.zee](g, s) { const c = s / 2; const z = () => { g.beginPath(); g.moveTo(c - s * 0.22, c - s * 0.24); g.lineTo(c + s * 0.22, c - s * 0.24); g.lineTo(c - s * 0.22, c + s * 0.24); g.lineTo(c + s * 0.22, c + s * 0.24); };
    g.lineJoin = 'miter'; g.lineCap = 'square'; g.save(); g.filter = 'blur(4px)'; g.strokeStyle = W(0.7); g.lineWidth = s * 0.14; z(); g.stroke(); g.restore(); g.strokeStyle = W(1); g.lineWidth = s * 0.075; z(); g.stroke(); },
  [F.plus](g, s) { const c = s / 2; const pl = (w, L) => { g.beginPath(); g.roundRect(c - w, c - L, w * 2, L * 2, w * 0.6); g.roundRect(c - L, c - w, L * 2, w * 2, w * 0.6); };
    g.save(); g.filter = 'blur(5px)'; g.fillStyle = W(0.6); pl(s * 0.12, s * 0.36); g.fill(); g.restore(); g.fillStyle = W(1); pl(s * 0.075, s * 0.3); g.fill(); blob(g, c, c, s * 0.14, 1); },
  [F.hourglass](g, s) { const c = s / 2; g.save(); g.translate(c, c); g.scale(0.7, 1); g.fillStyle = rad(g, 0, 0, s * 0.5, [[0, W(0.4)], [0.6, W(0.18)], [1, W(0)]]); g.fillRect(-s, -s / 2, s * 2, s); g.restore();
    g.strokeStyle = W(1); g.lineWidth = s * 0.03; g.lineJoin = 'round'; g.beginPath(); g.moveTo(c - s * 0.2, c - s * 0.33); g.lineTo(c + s * 0.2, c - s * 0.33); g.lineTo(c + s * 0.03, c); g.lineTo(c + s * 0.2, c + s * 0.33); g.lineTo(c - s * 0.2, c + s * 0.33); g.lineTo(c - s * 0.03, c); g.closePath(); g.stroke();
    g.fillStyle = W(1); g.fillRect(c - s * 0.27, c - s * 0.4, s * 0.54, s * 0.06); g.fillRect(c - s * 0.27, c + s * 0.34, s * 0.54, s * 0.06);
    g.fillStyle = W(0.85); g.beginPath(); g.moveTo(c - s * 0.1, c - s * 0.18); g.lineTo(c + s * 0.1, c - s * 0.18); g.lineTo(c, c - s * 0.04); g.closePath(); g.fill(); g.beginPath(); g.moveTo(c - s * 0.16, c + s * 0.3); g.lineTo(c + s * 0.16, c + s * 0.3); g.lineTo(c, c + s * 0.16); g.closePath(); g.fill(); g.fillRect(c - s * 0.008, c - s * 0.04, s * 0.016, s * 0.24); },
  [F.mute](g, s) { const c = s / 2; g.save(); g.filter = 'blur(3px)'; g.strokeStyle = W(0.7); g.lineWidth = s * 0.11; g.beginPath(); g.arc(c, c, s * 0.34, 0, 6.2832); g.moveTo(c - s * 0.24, c - s * 0.24); g.lineTo(c + s * 0.24, c + s * 0.24); g.stroke(); g.restore();
    g.strokeStyle = W(1); g.lineWidth = s * 0.06; g.beginPath(); g.arc(c, c, s * 0.34, 0, 6.2832); g.stroke(); g.beginPath(); g.moveTo(c - s * 0.24, c - s * 0.24); g.lineTo(c + s * 0.24, c + s * 0.24); g.stroke();
    g.fillStyle = W(0.8); for (const dx of [-0.13, 0, 0.13]) { g.beginPath(); g.arc(c + dx * s, c + s * 0.02, s * 0.03, 0, 6.2832); g.fill(); } },
};

export function makeAtlas() {
  const c = document.createElement('canvas'); c.width = c.height = CELLS * CELL; const g = c.getContext('2d');
  for (let i = 0; i < CELLS * CELLS; i++) { const fn = cellDrawers[i]; if (!fn) continue; g.save(); g.translate((i % CELLS) * CELL, Math.floor(i / CELLS) * CELL); g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip(); fn(g, CELL); g.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.userData.canvas = c; return t;
}

// ---- ground decals (256px) ----
function decal(draw) { const s = 256; const c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d'); draw(g, s); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
export const DECALS = {
  scorch: () => decal((g, s) => { const r = seeded(21); g.fillStyle = rad(g, s / 2, s / 2, s / 2, [[0, 'rgba(0,0,0,0.92)'], [0.35, 'rgba(10,4,0,0.8)'], [0.7, 'rgba(20,8,0,0.35)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) { const a = r() * 6.2832, d = s * (0.25 + r() * 0.24), rr = s * (0.03 + r() * 0.07); g.fillStyle = rad(g, s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, rr, [[0, 'rgba(0,0,0,0.75)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(0, 0, s, s); }
    g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 40; i++) { const a = r() * 6.2832, d = s * (0.3 + r() * 0.2), rr = s * (0.02 + r() * 0.05); g.fillStyle = rad(g, s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, rr, [[0, 'rgba(0,0,0,0.9)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(0, 0, s, s); } }),
  // embers left glowing inside a fresh scorch
  cinder: () => decal((g, s) => { const r = seeded(23); for (let i = 0; i < 90; i++) { const a = r() * 6.2832, d = s * r() ** 0.6 * 0.46, rr = s * (0.012 + r() * 0.035); blob(g, s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, rr, 0.5 + r() * 0.5); } }),
  frost: () => decal((g, s) => { const r = seeded(31); g.fillStyle = rad(g, s / 2, s / 2, s / 2, [[0, W(0.9)], [0.3, W(0.45)], [0.7, W(0.12)], [1, W(0)]]); g.fillRect(0, 0, s, s);
    g.strokeStyle = W(0.85); g.lineWidth = 2; for (let i = 0; i < 26; i++) { const a = i / 26 * 6.2832 + r() * 0.2, L = s * (0.2 + r() * 0.28); g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + Math.cos(a) * L, s / 2 + Math.sin(a) * L); g.stroke(); const bx = s / 2 + Math.cos(a) * L * 0.6, by = s / 2 + Math.sin(a) * L * 0.6; for (const da of [0.5, -0.5]) { g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(a + da) * L * 0.25, by + Math.sin(a + da) * L * 0.25); g.stroke(); } } }),
  glyph: () => decal((g, s) => { const c = s / 2; g.strokeStyle = W(1); g.lineWidth = 4; g.beginPath(); g.arc(c, c, s * 0.46, 0, 6.2832); g.stroke(); g.lineWidth = 2; g.beginPath(); g.arc(c, c, s * 0.36, 0, 6.2832); g.stroke(); g.beginPath(); g.arc(c, c, s * 0.12, 0, 6.2832); g.stroke();
    g.lineWidth = 2.5; for (const off of [0, Math.PI / 6]) { g.beginPath(); for (let i = 0; i < 3; i++) { const a = off - Math.PI / 2 + i * 6.2832 / 3; const x = c + Math.cos(a) * s * 0.36, y = c + Math.sin(a) * s * 0.36; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.stroke(); }
    const r = seeded(41); g.lineWidth = 2; for (let i = 0; i < 24; i++) { const a = i / 24 * 6.2832; const R = s * 0.41; const x = c + Math.cos(a) * R, y = c + Math.sin(a) * R; g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2); g.beginPath(); const n = 2 + (r() * 3 | 0); for (let k = 0; k < n; k++) { g.moveTo(-4 + r() * 8, -5 + r() * 10); g.lineTo(-4 + r() * 8, -5 + r() * 10); } g.stroke(); g.restore(); }
    g.fillStyle = rad(g, c, c, s * 0.5, [[0, W(0.25)], [0.7, W(0.05)], [1, W(0)]]); g.fillRect(0, 0, s, s); }),
  ring: () => decal((g, s) => { g.save(); g.filter = 'blur(6px)'; g.strokeStyle = W(1); g.lineWidth = s * 0.075; g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, 6.2832); g.stroke(); g.restore(); g.strokeStyle = W(1); g.lineWidth = s * 0.028; g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, 6.2832); g.stroke(); g.strokeStyle = W(0.45); g.lineWidth = s * 0.014; g.beginPath(); g.arc(s / 2, s / 2, s * 0.33, 0, 6.2832); g.stroke(); }),
  // ROUND-5 rank 3 (weak ground contact): a HARDENED scuff - bounded alpha plateau, a DEFINED edge (fast
  // falloff over a narrow band, not 'scorch''s soft unbounded gradient), gouged and scraped so it reads as
  // a rust-dark boot/scuff mark on the tile. White so the use-site `color` tints it rust-dark.
  scuff: () => decal((g, s) => { const r = seeded(71); const c = s / 2;
    g.fillStyle = rad(g, c, c, s * 0.5, [[0, 'rgba(255,255,255,0.95)'], [0.58, 'rgba(255,255,255,0.92)'], [0.73, 'rgba(255,255,255,0.58)'], [0.83, 'rgba(255,255,255,0.16)'], [0.91, 'rgba(255,255,255,0.04)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 30; i++) { const a = r() * 6.2832, d = s * (0.16 + r() * 0.32), rr = s * (0.02 + r() * 0.05); g.fillStyle = rad(g, c + Math.cos(a) * d, c + Math.sin(a) * d, rr, [[0, 'rgba(0,0,0,0.9)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(0, 0, s, s); }
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = s * 0.013;
    for (let i = 0; i < 16; i++) { const a = r() * 6.2832, d0 = s * (0.08 + r() * 0.22), L = s * (0.12 + r() * 0.2); g.beginPath(); g.moveTo(c + Math.cos(a) * d0, c + Math.sin(a) * d0); g.lineTo(c + Math.cos(a) * (d0 + L), c + Math.sin(a) * (d0 + L)); g.stroke(); } }),
  soft: () => decal((g, s) => { g.fillStyle = rad(g, s / 2, s / 2, s / 2, [[0, W(0.85)], [0.35, W(0.4)], [0.7, W(0.1)], [1, W(0)]]); g.fillRect(0, 0, s, s); }),
  // cracked earth left by fx_quake (CRITIQUE_R2 integration bug 10) - radial fissures with hairline
  // branches, drawn white so the decal's `color` tints it earth-brown at use.
  crack: () => decal((g, s) => { const r = seeded(53); const c = s / 2;
    g.lineCap = 'round'; g.strokeStyle = W(0.92);
    for (let i = 0; i < 9; i++) {
      let a = i / 9 * 6.2832 + r() * 0.35, x = c + Math.cos(a) * s * 0.03, y = c + Math.sin(a) * s * 0.03;
      const L = s * (0.20 + r() * 0.22), steps = 7;
      g.lineWidth = s * (0.014 + r() * 0.012); g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < steps; k++) { a += (r() - 0.5) * 0.55; x += Math.cos(a) * L / steps; y += Math.sin(a) * L / steps; g.lineTo(x, y); }
      g.globalAlpha = 0.9 - i * 0.03; g.stroke(); g.globalAlpha = 1;
      if (r() < 0.7) { let ba = a + (r() - 0.5) * 1.6, bx = x, by = y; g.lineWidth = s * 0.007; g.beginPath(); g.moveTo(bx, by);
        for (let k = 0; k < 4; k++) { ba += (r() - 0.5) * 0.6; bx += Math.cos(ba) * s * 0.035; by += Math.sin(ba) * s * 0.035; g.lineTo(bx, by); } g.globalAlpha = 0.55; g.stroke(); g.globalAlpha = 1; }
    }
    g.fillStyle = rad(g, c, c, s * 0.5, [[0, W(0.5)], [0.3, W(0.22)], [0.72, W(0.05)], [1, W(0)]]); g.fillRect(0, 0, s, s); }),
};
