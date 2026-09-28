import * as THREE from 'three';
import { HSTEP } from '../core/config.js';
import { NO_EDGE } from '../world/jumpgraph.js';
import { profileOf } from '../world/analysis/profiles.js';
import { propTiles, footprint } from '../world/mapformat/propspec.js';

// THE VERTICALITY OVERLAYS (PLAN §6.10). This is where a designer SEES the jump graph, and every
// decision here is about making one glance answer a question a number cannot.
//
// TILE COLOUR IS THE MINIMUM JUMP THAT REACHES THE TILE, never the tile's own height. Height is
// already on screen — the terrain draws it. What is invisible, and what the whole tool exists for,
// is REACHABILITY: two tiles at the same height can be Knight ground and Ninja-only ground, and
// nothing in the rendered frame distinguishes them. tierField() answers that in one ascending sweep
// and this file paints its `minJump` array.
//
// THE SPLIT TILE. A heatmap of the minimum tier still makes you hold "Knight is JUMP 2" in your head
// while you read it. Split mode drops that: each tile is two triangles across its diagonal, the NW
// half tinted for profile A and the SE half for profile B, so ground both can reach is two-tone,
// ground only the jumper can reach is HALF DARK, and dead board is fully dark. Knight-vs-Ninja is
// then a texture you read at a glance instead of a legend you decode.
//
// COORDINATES. Tile (x,z) spans world [x,x+1) x [z,z+1) and its surface is at Y = h * HSTEP — the
// convention picking.js floors and terrain.js's Y() builds to. Overlays sit LIFT above that with
// depthWrite off, so they tint the ground without fighting it and without occluding props.
//
// GEOMETRY IS REBUILT, NOT ANIMATED. A rebuild happens once per analysis pass (a few times a second
// at most, behind analysis.js's debounce), so the cost of new attribute buffers is irrelevant and
// the alternative — preallocated buffers with a live write cursor, like ghost.js — would buy nothing
// and cost the whole per-frame budget it exists to protect. Only the pulse touches a material.

const LIFT = 0.012, EDGE_OUT = 0.004, ROUTE_LIFT = 0.09;
/** Colour per required JUMP stat. Cool where every class walks, hot where only a specialist does —
 *  the same reading direction as the tier ladder's rows, so the panel and the board agree. */
export const JUMP_COLOUR = Object.freeze([0x30364e, 0x4faa55, 0x86cf4e, 0xe4d24a, 0xf0a437, 0xe8752a, 0xd8452c, 0xc03c78, 0xa8348c]);
export const COLOUR_INF = 0x8a63d8;     // reached only by the ignore_height tier (Wyrmlancer, Wyrm, Behemoth)
export const COLOUR_DEAD = 0x141a2e;    // no roster tier reaches it at all: dead board
export const COLOUR_A = 0x6fd05a, COLOUR_B = 0x69b4ff;   // split mode: profile A / profile B halves
const KIND_COLOUR = { gate: 0xffd24a, express: 0x69e0ff, local: 0x9fc4ff, cosmetic: 0x707a9c, trap: 0xff5a4a };
export const LAYERS = Object.freeze(['tiers', 'edges', 'shortcuts', 'seals', 'props', 'routes']);
export const MODES = Object.freeze(['off', 'tier', 'reach', 'split']);

/** JUMP stat -> colour. `-1`/0 is unreached, non-finite is the unbounded tier. */
export function colourForJump(j) {
  if (j === null || j === undefined || j < 0) return COLOUR_DEAD;
  if (!Number.isFinite(j) || j >= NO_EDGE) return COLOUR_INF;
  return JUMP_COLOUR[Math.min(JUMP_COLOUR.length - 1, Math.max(0, j))];
}
/** The legend the panels draw, in the same order the board is tinted. */
export function legendFor(mode, a, b) {
  if (mode === 'split') return [{ label: `${a} only`, colour: COLOUR_A }, { label: `${b} only`, colour: COLOUR_B }, { label: 'neither', colour: COLOUR_DEAD }];
  const out = [1, 2, 3, 4, 5, 6, 7].map((j) => ({ label: `JUMP ${j} (${j * 2}h)`, colour: JUMP_COLOUR[j] }));
  out.push({ label: 'ignore_height', colour: COLOUR_INF }, { label: 'unreachable', colour: COLOUR_DEAD });
  return out;
}

const rgb = (c, out, o) => { out[o] = (c >> 16) & 255; out[o + 1] = (c >> 8) & 255; out[o + 2] = c & 255; };

/** Fly the editor camera to a tile top. Lives here, not in analysis.js, because the Vector3 comes
 *  from the camera's own focus and HSTEP is a RENDER unit — analysis.js runs under bare node and may
 *  not reach for src/core/config.js, which reads `location` at module scope. */
export function flyTo(camera, map, x, z) {
  if (!camera || !camera.focus || typeof camera.lookAt !== 'function') return false;
  const t = map && typeof map.at === 'function' ? map.at(x, z) : null;
  camera.lookAt(camera.focus.clone().set(x + 0.5, (t ? t.h : 0) * HSTEP, z + 0.5), false, 'travel');
  return true;
}

export class Overlays {
  /** @param {THREE.Scene} scene @param {{mode?:string, a?:string, b?:string}} [o] */
  constructor(scene, o = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'ed-overlays'; this.group.renderOrder = 20; this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    this.mode = o.mode || 'tier';
    this.a = o.a || 'knight'; this.b = o.b || 'ninja';
    this.layers = Object.fromEntries(LAYERS.map((k) => [k, true]));
    this.res = null; this.rc = null; this._clock = 0;
    this.tiles = this._mesh('ov_tiles', 0.5, 22);
    this.faces = this._mesh('ov_faces', 0.78, 23);
    this.marks = this._lines('ov_marks', 0xffe08a, 0.9, 24, { vc: true });
    // depthTest STAYS ON for the glow. It was off for one build, and the trap crosses on the base
    // plain drew straight through the plateaus standing in front of them — a marker that lies about
    // which tile it is on is worse than no marker.
    this.glow = this._lines('ov_glow', 0xffffff, 1, 26, { vc: true });
    this.routeA = this._lines('ov_route_a', COLOUR_A, 0.95, 27, { noDepth: true });
    this.routeB = this._lines('ov_route_b', COLOUR_B, 0.95, 27, { noDepth: true });
  }
  // Vertex-coloured, unlit, double-sided, never depth-writing: an overlay must not be graded by the
  // tone pass and must not punch its own hole in the depth buffer for the props behind it.
  _mesh(name, opacity, order) {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity, depthWrite: false, toneMapped: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    m.name = name; m.renderOrder = order; m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false;
    this.group.add(m); return m;
  }
  _lines(name, colour, opacity, order, o = {}) {
    const l = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
      color: colour, transparent: true, opacity, toneMapped: false, depthTest: !o.noDepth, vertexColors: !!o.vc }));
    l.name = name; l.renderOrder = order; l.frustumCulled = false; l.matrixAutoUpdate = false; l.visible = false;
    this.group.add(l); return l;
  }

  setMode(mode) { this.mode = MODES.includes(mode) ? mode : 'off'; return this._paint(); }
  setProfiles(a, b) { if (a) this.a = a; if (b) this.b = b; return this._paint(); }
  setLayer(k, on) { if (k in this.layers) this.layers[k] = !!on; return this._paint(); }
  toggleLayer(k) { return this.setLayer(k, !this.layers[k]); }
  /** @param {import('./analysis.js').AnalysisResult} res */
  setResult(res) { this.res = res && res.graph ? res : null; return this._paint(); }
  /** @param {import('./analysis.js').RouteCompare} rc */
  setRoutes(rc) { this.rc = rc; return this._routes(); }

  _paint() {
    const r = this.res;
    if (!r) { for (const m of this.group.children) m.visible = false; return this; }
    this._tiles(r); this._edges(r); this._glow(r); this._marks(r); this._routes();
    return this;
  }

  // ---- the tier heatmap / reach preview / split-tile A-B --------------------------------------
  _tiles(r) {
    const on = this.layers.tiers && this.mode !== 'off';
    this.tiles.visible = on;
    if (!on) return;
    const g = r.graph, f = r.field, map = r.map;
    const pa = profileOf(this.a), pb = profileOf(this.b);
    // byTier is keyed by profile id, and PROFILES buckets by (climb, water) — so two classes at the
    // same tier share one flood and asking for a class hands back that class's real reachability.
    const da = pa && f.byTier.get(pa.tier), db = pb && f.byTier.get(pb.tier);
    const n = g.n, pos = new Float32Array(n * 18), col = new Uint8Array(n * 18);
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (!(g.pass[i] & 1)) continue;                       // void, open water and prop-closed: no tint
      const x = i % g.w, z = (i / g.w) | 0, y = map.tiles[z][x].h * HSTEP + LIFT;
      let c0, c1;
      if (this.mode === 'split') { c0 = da && da[i] >= 0 ? COLOUR_A : COLOUR_DEAD; c1 = db && db[i] >= 0 ? COLOUR_B : COLOUR_DEAD; }
      else if (this.mode === 'reach') { c0 = c1 = da && da[i] >= 0 ? colourForJump(pa.jump) : COLOUR_DEAD; }
      else c0 = c1 = colourForJump(f.minClimb[i] === -1 ? -1 : f.minJump[i] >= NO_EDGE ? Infinity : f.minJump[i]);
      // The diagonal runs NW->SE, so the two halves are the same shape on every tile and the eye
      // reads a field of half-lit tiles as one texture rather than as noise.
      const q = [[x, z], [x + 1, z], [x, z + 1], [x + 1, z], [x + 1, z + 1], [x, z + 1]];
      for (let k = 0; k < 6; k++) { const o = v * 3; pos[o] = q[k][0]; pos[o + 1] = y; pos[o + 2] = q[k][1]; rgb(k < 3 ? c0 : c1, col, o); v++; }
    }
    this._swap(this.tiles, pos, col, v);
  }

  // ---- edge-requirement ribbons: every steep edge, coloured by the jump it demands --------------
  _edges(r) {
    const on = this.layers.edges;
    this.faces.visible = on;
    if (!on) return;
    const g = r.graph, map = r.map, faces = r.faces ? r.faces.discovered : [];
    const pos = new Float32Array(faces.length * 18), col = new Uint8Array(faces.length * 18);
    let v = 0;
    for (const fc of faces) {
      const c = colourForJump(fc.jump);
      const hi = map.tiles[fc.hi[1]][fc.hi[0]].h * HSTEP, lo = map.tiles[fc.lo[1]][fc.lo[0]].h * HSTEP;
      // The ribbon stands ON the shared boundary, nudged EDGE_OUT towards the low side so it clears
      // the cliff face terrain.js already drew there instead of z-fighting it.
      const s = fc.dir === 'x' ? (fc.hi[0] < fc.lo[0] ? 1 : -1) : (fc.hi[1] < fc.lo[1] ? 1 : -1);
      const q = fc.dir === 'x'
        ? (() => { const X = Math.max(fc.a % g.w, fc.b % g.w) + s * EDGE_OUT, z = (fc.a / g.w | 0); return [[X, lo, z], [X, lo, z + 1], [X, hi, z + 1], [X, lo, z], [X, hi, z + 1], [X, hi, z]]; })()
        : (() => { const Z = Math.max((fc.a / g.w | 0), (fc.b / g.w | 0)) + s * EDGE_OUT, x = fc.a % g.w; return [[x, lo, Z], [x + 1, lo, Z], [x + 1, hi, Z], [x, lo, Z], [x + 1, hi, Z], [x, hi, Z]]; })();
      for (const p of q) { const o = v * 3; pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2]; rgb(c, col, o); v++; }
    }
    this._swap(this.faces, pos, col, v);
  }

  // ---- shortcut glow: the priced edges, by kind, with traps called out -------------------------
  _glow(r) {
    const on = this.layers.shortcuts && r.shortcuts;
    this.glow.visible = on;
    if (!on) return;
    const g = r.graph, map = r.map, P = [], C = [];
    const push = (x0, y0, z0, x1, y1, z1, c) => { P.push(x0, y0, z0, x1, y1, z1); const b = [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255]; C.push(...b, ...b); };
    for (const s of r.shortcuts) {
      const c = KIND_COLOUR[s.kind] || 0xffffff;
      const hiN = map.tiles[s.hi[1]][s.hi[0]].h * HSTEP + LIFT * 2, x = s.a % g.w, z = (s.a / g.w) | 0;
      if (s.dir === 'x') push(x + 1, hiN, z, x + 1, hiN, z + 1, c); else push(x, hiN, z + 1, x + 1, hiN, z + 1, c);
      // A trap is the one shortcut that costs the taker HP (classify.js: |dh| > 2*HEIGHT_STEP is
      // rules.js's knockback fall-damage threshold), so it is marked on the tile you LAND on rather
      // than on the edge you left — that is the tile a designer has to look at.
      if (s.kind === 'trap' || s.fallDamage) {
        const lx = s.lo[0], lz = s.lo[1], ly = map.tiles[lz][lx].h * HSTEP + LIFT * 2, m = 0.18;
        push(lx + m, ly, lz + m, lx + 1 - m, ly, lz + 1 - m, KIND_COLOUR.trap);
        push(lx + 1 - m, ly, lz + m, lx + m, ly, lz + 1 - m, KIND_COLOUR.trap);
      }
    }
    this._swapLines(this.glow, P, C);
  }

  // ---- seal markers and prop footprints --------------------------------------------------------
  _marks(r) {
    const wantSeal = this.layers.seals, wantProp = this.layers.props;
    this.marks.visible = wantSeal || wantProp;
    if (!this.marks.visible) return;
    const map = r.map, P = [], C = [];
    const ring = (x, z, inset, c, lift) => {
      const t = map.at(x, z); if (!t) return;
      const y = t.h * HSTEP + (lift || LIFT * 3), a = x + inset, b = x + 1 - inset, u = z + inset, w = z + 1 - inset;
      const pts = [[a, u], [b, u], [b, w], [a, w], [a, u]], cc = [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
      for (let k = 0; k < 4; k++) { P.push(pts[k][0], y, pts[k][1], pts[k + 1][0], y, pts[k + 1][1]); C.push(...cc, ...cc); }
    };
    if (wantSeal) for (const s of (r.seals || [])) {
      // A choke that does not seal is the finding; drawing it in the same gold as one that does
      // would hide exactly the case the marker exists to surface.
      const c = s.sealed ? (s.vacuous ? 0xe0b64e : 0x8dc257) : 0xe2544a;
      for (const t of (s.chokeTiles || [])) ring(t[0], t[1], 0.10, c);
      if (s.leak) ring(s.leak[0], s.leak[1], 0.02, 0xff5a4a, LIFT * 5);
    }
    // Footprint, not geometry extent: what a designer needs to see is the tiles that stopped being
    // walkable, which is footprint()'s answer. propTiles() adds the tiles the MESH merely overlaps,
    // drawn thinner, because a house whose eaves hang over the road still leaves the road open.
    if (wantProp) for (const p of (map.props || [])) {
      for (const [x, z] of propTiles(p)) ring(x, z, 0.30, 0x4a5da8);
      for (const [x, z] of footprint(p)) ring(x, z, 0.16, 0x9fd8ff);
    }
    this._swapLines(this.marks, P, C);
  }

  // ---- route compare -------------------------------------------------------------------------
  _routes() {
    const rc = this.rc, on = this.layers.routes && rc && rc.routes.length && this.res;
    this.routeA.visible = !!on; this.routeB.visible = !!on;
    if (!on) return this;
    const map = this.res.map;
    for (let k = 0; k < 2; k++) {
      const line = k ? this.routeB : this.routeA, r = rc.routes[k], P = [];
      if (!r || !r.path.length) { this._swapLines(line, P, null); continue; }
      // Two routes on the same tiles would be one line; the B route rides a hair higher so an
      // identical stretch still reads as two, and the peel-off is a visible fork rather than a guess.
      const lift = ROUTE_LIFT + k * 0.035;
      const at = (t) => [t[0] + 0.5, map.tiles[t[1]][t[0]].h * HSTEP + lift, t[1] + 0.5];
      for (let i = 1; i < r.path.length; i++) P.push(...at(r.path[i - 1]), ...at(r.path[i]));
      // Turn boundaries: a cross at every MOVE-th step, which is where the player's turn ends, plus
      // a bigger cross at the scrub head so the two units are visibly walking in step.
      const cross = (t, m, y) => { const p = at(t); P.push(p[0] - m, p[1] + y, p[2], p[0] + m, p[1] + y, p[2], p[0], p[1] + y, p[2] - m, p[0], p[1] + y, p[2] + m); };
      for (const mk of r.marks) if (r.path[mk]) cross(r.path[mk], 0.22, 0);
      const head = rc.posOf(k);
      if (head) { cross(head, 0.42, 0.02); const p = at(head); P.push(p[0] - 0.42, p[1] + 0.02, p[2] - 0.42, p[0] + 0.42, p[1] + 0.02, p[2] + 0.42, p[0] + 0.42, p[1] + 0.02, p[2] - 0.42, p[0] - 0.42, p[1] + 0.02, p[2] + 0.42); }
      this._swapLines(line, P, null);
    }
    return this;
  }

  /** Per-frame pulse. Only the express/gate glow breathes — a board where everything moves is a
   *  board where nothing draws the eye. */
  update(dt = 0) {
    this._clock += dt;
    if (this.glow.visible) this.glow.material.opacity = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this._clock * 3.2));
    return this;
  }

  _swap(mesh, pos, col, verts) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    geo.setDrawRange(0, verts);
    mesh.geometry.dispose(); mesh.geometry = geo;
    mesh.visible = mesh.visible && verts > 0;
  }
  // A vertexColors material with no `color` attribute renders black, so a colourless payload into a
  // vertex-coloured line is filled with the material's own colour rather than left undefined.
  _swapLines(line, P, C) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    if (line.material.vertexColors) geo.setAttribute('color', new THREE.Float32BufferAttribute(C || new Array(P.length).fill(1), 3));
    line.geometry.dispose(); line.geometry = geo;
    line.visible = line.visible && P.length > 0;
  }
  dispose() {
    for (const o of [...this.group.children]) { o.geometry.dispose(); o.material.dispose(); }
    this.group.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
