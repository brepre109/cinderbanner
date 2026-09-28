import * as THREE from 'three';
import { cutHides, cutEpoch, cutSignature, focusStrengthAt, propRecords } from '../render/cutaway.js';
// R12 GHOST GATE: which occluded units get a silhouette, and how loud it is.
// Every blind A/B critic named the same thing: a big dithered team-colour silhouette of the Wyrm behind a roof,
// reading as a 'debug overlay' and dominating the frame. The GPU depth test (FRAG_GHOST in sprites.js) still
// decides WHICH PIXELS are behind something; this module decides WHETHER a unit gets a ghost at all and at what
// strength, from a cheap CPU visibility estimate:
//   - 12 sample points over the unit's body core (not its frame cell) cast a ray toward the lens against a
//     uniform xz grid of the static world's triangles (terrain + props, captured once from the scene);
//   - a hit only counts if it is at least the ghost's own depth margin nearer than the unit (the same
//     GHOST_PUSH the shader uses), and if the cutaway has not opened that prop (cutaway.js cutHides, the CPU mirror
//     of the section shader) -- so a focus the cutaway already reveals gets no ghost on top of it;
//   - occluded fraction < 0.3 => no ghost at all (the unit is findable by itself); it ramps in to full by 0.6;
//   - focus units (the actor, the cursor's unit, the ability pair) ghost at full strength, everyone else at a
//     quieter PROMINENCE, so the eye goes to the unit that matters;
//   - ghost meshes stay invisible (no draw call) unless the strength is > 0.
// The test runs inside scene.onBeforeRender -- after three has updated the world matrices and BEFORE it builds its
// render lists -- so a capture that moves the camera and renders once (applyPreset + render()) gets the right
// answer on that very frame. It re-tests a unit only when the unit, the camera or the cutaway changed (breathing
// and idle frames do not count), at most BUDGET units per frame unless a snap asks for all of them.

const SAMPLES_X = 3, SAMPLES_Y = 4;
const PUSH = 1.30 + 0.10;          // sprites.js GHOST_PUSH + uGroundBias: view units an occluder must be nearer
const OCC_LO = 0.30, OCC_HI = 0.60;
const PROMINENCE = 0.62;           // non-focus ghost strength relative to a focus unit's
const FADE_S = 0.18;               // seconds for a ghost to fade fully in or out
const BUDGET = 4;                  // re-tests per frame while things move
const CAP_PX = 96;                 // at most this many screen px of the body (from the head down) is ghosted
const MONSTER_CAP = 0.62;          // silhouettes wider than a tile ghost only their upper part
const FADE_PX = 14;                // soft bottom edge of the clipped ghost

const sprites = new Set();
/** QA/perf readout (window.__UNITS__.occ): world capture cost, last pass cost, re-tests in the last pass, per-unit state. */
export const occStats = { buildMs: 0, tris: 0, passMs: 0, tested: 0, units: () => [...sprites].map((s) => ({ team: s.team, occ: +s._occ.occ.toFixed(2), s: +s._occ.s.toFixed(2), vis: s.ghost.visible })) };
let scene = null, world = null, lastCam = 0, lastCut = NaN, lastEpoch = -1, lastT = 0, rr = 0;
const _p = new THREE.Vector3(), _g = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4();

export function registerSprite(s) {
  sprites.add(s);
  s._occ = { sig: NaN, occ: 0, target: 0, s: 0, dirty: true };
}
/** Install the per-render hook on the scene the sprite lives in (idempotent; called from UnitSprite.update). */
export function attachScene(root) {
  if (scene) return;
  let o = root; while (o.parent) o = o.parent;
  if (!o.isScene) return;
  scene = o;
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, sc, camera, rt) {
    try { prev?.call(this, renderer, sc, camera, rt); } finally { if (camera && (camera.isOrthographicCamera || camera.isPerspectiveCamera)) pass(renderer, camera); }
  };
}

// ---- world capture: triangles of terrain + props on a 1-unit xz grid ------------------------------------------
function buildWorld() {
  const tris = []; const owner = [];   // owner: index into boxes, -1 = terrain (never cut)
  const boxes = [];
  const add = (mesh, bi) => {
    const g = mesh.geometry; const P = g.attributes.position; if (!P) return;
    const idx = g.index; const n = idx ? idx.count : P.count; mesh.updateWorldMatrix(true, false); const M = mesh.matrixWorld;
    for (let i = 0; i + 2 < n; i += 3) {
      for (let j = 0; j < 3; j++) { _p.fromBufferAttribute(P, idx ? idx.getX(i + j) : i + j).applyMatrix4(M); tris.push(_p.x, _p.y, _p.z); }
      owner.push(bi);
    }
  };
  const terrain = scene.getObjectByName('terrain');
  terrain?.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.renderOrder !== 0 || !o.visible) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.transparent || !m.depthWrite) return;
    add(o, -1);
  });
  if (propRecords.length) {
    for (const r of propRecords) { const bi = boxes.length; boxes.push(r.box); for (const o of r.parts) { const m = o.material; if (m && !m.transparent && m.depthWrite !== false && o.renderOrder === 0) add(o, bi); } }
  } else {
    const props = scene.getObjectByName('props_batch') || scene.getObjectByName('props');
    props?.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.visible && o.renderOrder === 0 && !o.material.transparent && o.material.depthWrite) add(o, -1); });
  }
  const T = new Float32Array(tris), O = new Int32Array(owner), nt = O.length;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, ymax = -Infinity;
  for (let i = 0; i < nt * 3; i++) { const x = T[i * 3], y = T[i * 3 + 1], z = T[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y > ymax) ymax = y; }
  x0 = Math.floor(x0); z0 = Math.floor(z0);
  const W = Math.max(1, Math.ceil(x1) - x0), D = Math.max(1, Math.ceil(z1) - z0);
  const count = new Int32Array(W * D);
  const each = (t, fn) => {
    const a = t * 9; const ax = Math.min(T[a], T[a + 3], T[a + 6]), bx = Math.max(T[a], T[a + 3], T[a + 6]);
    const az = Math.min(T[a + 2], T[a + 5], T[a + 8]), bz = Math.max(T[a + 2], T[a + 5], T[a + 8]);
    const i0 = Math.max(0, Math.floor(ax - x0)), i1 = Math.min(W - 1, Math.floor(bx - x0)), k0 = Math.max(0, Math.floor(az - z0)), k1 = Math.min(D - 1, Math.floor(bz - z0));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) fn(k * W + i);
  };
  for (let t = 0; t < nt; t++) each(t, (c) => count[c]++);
  const start = new Int32Array(W * D + 1); for (let c = 0; c < W * D; c++) start[c + 1] = start[c] + count[c];
  const list = new Int32Array(start[W * D]); const fill = start.slice(0, W * D);
  for (let t = 0; t < nt; t++) each(t, (c) => { list[fill[c]++] = t; });
  return { T, O, boxes, x0, z0, W, D, start, list, ymax, stamp: new Uint32Array(nt), ray: 0 };
}

// Möller-Trumbore; returns t or -1
function hitTri(Wd, t, ox, oy, oz, dx, dy, dz) {
  const T = Wd.T, a = t * 9;
  const e1x = T[a + 3] - T[a], e1y = T[a + 4] - T[a + 1], e1z = T[a + 5] - T[a + 2];
  const e2x = T[a + 6] - T[a], e2y = T[a + 7] - T[a + 1], e2z = T[a + 8] - T[a + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-9) return -1;
  const inv = 1 / det; const sx = ox - T[a], sy = oy - T[a + 1], sz = oz - T[a + 2];
  const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}
// Is there an un-cut occluder on the ray o + d t, t in [tMin, until above the world]?
function occluded(Wd, ox, oy, oz, dx, dy, dz, tMin, view) {
  const tMax = dy > 1e-4 ? (Wd.ymax + 0.05 - oy) / dy : 40;
  if (tMax <= tMin) return false;
  const ray = ++Wd.ray; const st = Wd.stamp;
  // Amanatides-Woo over the xz grid
  let cx = Math.floor(ox - Wd.x0), cz = Math.floor(oz - Wd.z0);
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = Math.abs(dx) > 1e-9 ? Math.abs(1 / dx) : Infinity, tdz = Math.abs(dz) > 1e-9 ? Math.abs(1 / dz) : Infinity;
  let tx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? cx + 1 : cx) + Wd.x0 - ox) / dx : Infinity;
  let tz = Math.abs(dz) > 1e-9 ? ((dz > 0 ? cz + 1 : cz) + Wd.z0 - oz) / dz : Infinity;
  let t0 = 0;
  for (let guard = 0; guard < 256 && t0 <= tMax; guard++) {
    if (cx >= 0 && cz >= 0 && cx < Wd.W && cz < Wd.D) {
      const c = cz * Wd.W + cx;
      for (let k = Wd.start[c], e = Wd.start[c + 1]; k < e; k++) {
        const tri = Wd.list[k]; if (st[tri] === ray) continue; st[tri] = ray;
        const th = hitTri(Wd, tri, ox, oy, oz, dx, dy, dz);
        if (th < tMin || th > tMax) continue;
        const bi = Wd.O[tri];
        if (bi >= 0 && cutHides(ox + dx * th, oy + dy * th, oz + dz * th, Wd.boxes[bi], view)) continue;
        return true;
      }
    } else if ((cx < 0 && sx < 0) || (cz < 0 && sz < 0) || (cx >= Wd.W && sx > 0) || (cz >= Wd.D && sz > 0)) break;
    if (tx < tz) { t0 = tx; tx += tdx; cx += sx; } else { t0 = tz; tz += tdz; cz += sz; }
  }
  return false;
}

function occludedFraction(s, camera) {
  const meta = s.meta, f = meta.frames[s.frame]; if (!f) return 0;
  const view = camera.matrixWorldInverse; const e = camera.matrixWorld.elements;
  const dx = e[8], dy = e[9], dz = e[10];   // camera +z in world = toward the lens
  const coreW = meta.coreW || meta.bodyW || f.w * 0.6, coreH = meta.coreH || meta.bodyH || f.h * 0.7;
  const M = s.mesh.matrixWorld;
  s.root.getWorldPosition(_g);
  let hits = 0, n = 0;
  for (let j = 0; j < SAMPLES_Y; j++) for (let i = 0; i < SAMPLES_X; i++) {
    const tx = f.ax + coreW * 0.8 * ((i + 0.5) / SAMPLES_X - 0.5);
    const ty = f.ay + coreH * (0.12 + 0.82 * j / (SAMPLES_Y - 1));
    _p.set(tx / f.w - 0.5, ty / f.h, 0).applyMatrix4(M);
    const tMin = PUSH - ((_p.x - _g.x) * dx + (_p.y - _g.y) * dy + (_p.z - _g.z) * dz);
    n++; if (occluded(world, _p.x, _p.y, _p.z, dx, dy, dz, Math.max(0.02, tMin), view)) hits++;
  }
  return n ? hits / n : 0;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function camSig(c) { const e = c.matrixWorld.elements; return e[12] * 1.3 + e[13] * 2.7 + e[14] * 3.1 + e[8] * 17 + e[9] * 19 + e[10] * 23 + c.zoom * 29 + c.top * 31; }
function unitSig(s) {
  const p = s.root.position, o = s.off, h = s.walk ? s.walk.hop || 0 : s.hop || 0;
  return Math.round((p.x + o.x) * 40) * 1.7 + Math.round((p.y + o.y + h) * 40) * 3.3 + Math.round((p.z + o.z) * 40) * 7.1 + (s.row ? 0.5 : 0) + (s.mirror ? 0.25 : 0);
}

function pass(renderer, camera) {
  if (!sprites.size) return;
  const tp0 = performance.now();
  if (!world) { try { world = buildWorld(); occStats.buildMs = +(performance.now() - tp0).toFixed(1); occStats.tris = world.O.length; } catch (e) { console.warn('ghost occlusion: world capture failed', e); world = { T: new Float32Array(0), O: new Int32Array(0), boxes: [], x0: 0, z0: 0, W: 1, D: 1, start: new Int32Array(2), list: new Int32Array(0), ymax: 0, stamp: new Uint32Array(0), ray: 0 }; } }
  const now = performance.now(); const dt = lastT ? Math.min(0.25, (now - lastT) / 1000) : 1; lastT = now;
  const ep = cutEpoch(); const snap = ep !== lastEpoch; lastEpoch = ep;
  const cs = camSig(camera), ks = cutSignature();
  const globalDirty = cs !== lastCam || ks !== lastCut; lastCam = cs; lastCut = ks;
  const list = [...sprites];
  let budget = snap ? Infinity : BUDGET;
  // round-robin so a long camera move re-tests everyone within a few frames
  const r0 = rr % list.length; let tested = 0;
  for (let q = 0; q < list.length; q++) {
    const s = list[(r0 + q) % list.length], O = s._occ;
    const allowed = s.ghostOn && s.silhouetteAllowed && s.root.visible && !!s.root.parent;
    if (!allowed) { O.target = 0; O.s = 0; s.ghost.visible = false; continue; }
    const us = unitSig(s);
    if (globalDirty || us !== O.sig) O.dirty = true;
    if (O.dirty && budget > 0) {
      budget--; O.dirty = false; O.sig = us;
      O.occ = occludedFraction(s, camera); tested++;
    }
    const focus = focusStrengthAt(s.root.position.x, s.root.position.z);
    O.target = smooth(OCC_LO, OCC_HI, O.occ) * (PROMINENCE + (1 - PROMINENCE) * Math.min(1, focus * 1.5));
    O.s = snap ? O.target : O.s + Math.max(-dt / FADE_S, Math.min(dt / FADE_S, O.target - O.s));
    s.ghost.visible = O.s > 0.01;
    if (s.ghost.visible) applyLook(s, renderer, camera, O.s);
  }
  rr = r0 + tested;
  occStats.passMs = +(performance.now() - tp0).toFixed(2); occStats.tested = tested;
}

// strength + the head-and-shoulders clip for big bodies at big zoom
function applyLook(s, renderer, camera, strength) {
  const meta = s.meta, f = meta.frames[s.frame]; if (!f) return;
  s.gu.uGhostA.value = strength;
  const hPx = (renderer.domElement.clientHeight || 620) * camera.zoom / Math.max(1e-3, camera.top - camera.bottom);
  const coreH = meta.coreH || meta.bodyH || f.h * 0.7;
  const bodyPx = coreH * s.k * hPx;
  let frac = Math.min(1, CAP_PX / Math.max(1, bodyPx));
  if ((meta.silBudget || 1) > 1.2) frac = Math.min(frac, MONSTER_CAP);
  const vFeet = f.ay / f.h, vTop = Math.min(1, (f.ay + coreH * 1.04) / f.h);
  const cut = frac >= 0.999 ? -1 : vTop - frac * (vTop - vFeet);
  const cardPx = f.h * s.k * hPx;
  s.gu.uGhostClip.value.set(cut, FADE_PX / Math.max(1, cardPx));
}
