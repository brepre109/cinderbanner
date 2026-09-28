import * as THREE from 'three';
import { HSTEP } from '../core/config.js';
import { createPipeline } from '../render/pipeline.js';
import { buildLighting } from '../render/lighting.js';
import { BattleCamera } from '../render/camera.js';
import { buildTerrain } from '../world/terrain.js';
import { buildProps } from '../world/props.js';
import { compileMap } from '../world/mapformat/compile.js';
import { footprint } from '../world/mapformat/propspec.js';
import { disposeBuilt, retain } from './disposer.js';
import { Ghost } from './ghost.js';

// The editor's three.js scene, and the four-tier render ladder over it (PLAN 6.4).
//
// The whole point of this file is that it reimplements NOTHING. createPipeline, buildLighting,
// BattleCamera, buildTerrain and buildProps are imported exactly as the game imports them, so what
// the author paints is the frame that ships — not an approximation drawn by a second renderer that
// then drifts. Everything below is scheduling.
//
// WHY THE LADDER IS TEMPORAL AND NOT SPATIAL. terrain.js derives every decoration from ABSOLUTE
// loop indices: top UV is [(x+lx)/sc, (z+ly)/sc]; tileTint is smoothNoise(x,z,...)+hash(x,z,1);
// variant(x,z,9) picks grass vs grass2; hash(x,z,7) picks the dihedral rotation; hash(x,z,41..45)
// picks the scatter stamp. A chunked sub-build must renumber its tiles to 0..cw, so tint, dither,
// rotation and scatter all change — and change at the chunk seams, which is the one artefact a
// WYSIWYG tool may never show. Chunking is therefore not "slow to do right", it is wrong. The
// budget is met by doing the FULL build less often instead: ghost while the pointer is down, one
// true build on release, and an adaptive idle that re-truths mid-stroke only on a machine fast
// enough to afford it.

/** Dirty channels as bit flags. Named CHANNEL, not CH, because session.js exports its own `CH` of
 *  the same seven channels as STRINGS; chFlags() below accepts either, so a caller can pass the
 *  session's event payload straight through without translating it. */
export const CHANNEL = { HEIGHT: 1, SURFACE: 2, DECK: 4, PROP: 8, SPAWN: 16, DESIGN: 32, META: 64 };
const CH_BY_NAME = { heights: 1, height: 1, surfaces: 2, surface: 2, decks: 4, deck: 4, props: 8, prop: 8, spawns: 16, spawn: 16, design: 32, meta: 64 };
/** Channels that change the terrain mesh. SPAWN/DESIGN/META are overlay-only and never rebuild it. */
const STRUCTURAL = CHANNEL.HEIGHT | CHANNEL.SURFACE | CHANNEL.DECK;
const ALL = 127;
const PROP_DEBOUNCE = 300, DERIVED_DEBOUNCE = 250, SIZE_WARN = 32, SIZE_MAX = 48;

/** Accepts a bitmask, a channel name, or a list of either — the session's event shape is its own. */
function chFlags(kind) {
  if (kind == null) return STRUCTURAL;
  if (typeof kind === 'number') return kind;
  if (typeof kind === 'string') return CH_BY_NAME[kind] || 0;
  let f = 0; for (const k of kind) f |= chFlags(k); return f;
}

/**
 * Scene, renderer, lighting rig and camera for an editor page — the game shell minus Battle, UI
 * and player. `canvas` may be inset between docks, which is why resize() is mandatory here:
 * createPipeline reads innerWidth/innerHeight directly and would otherwise render at window size.
 * @param {{canvas:HTMLCanvasElement, map:object}} o
 */
export function createViewport({ canvas, map }) {
  const pipeline = createPipeline(canvas);
  const scene = new THREE.Scene();
  const lighting = buildLighting(scene, map);
  lighting.drift = false;          // an author needs the same frame twice; the +-4% cloud drift is for play
  const camera = new BattleCamera(1);
  let clock = 0;
  const vp = {
    scene, camera, pipeline, lighting,
    /** Call on every layout change. Both halves are required: the frustum AND the framebuffer. */
    resize(w, h) {
      const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
      camera.setAspect(W / H); pipeline.resize(W, H); return vp;
    },
    /** Frame a compiled MAP: the same box lighting.js fits its shadow camera to. */
    fit(m) {
      const maxH = m.tiles.flat().reduce((a, t) => Math.max(a, t.h), 0) * HSTEP;
      camera.setBounds(new THREE.Vector3(-0.5, -0.6, -0.5), new THREE.Vector3(m.w + 0.5, maxH + 2.6, m.d + 0.5));
      camera.lookAt(new THREE.Vector3(m.w / 2, maxH * 0.45, m.d / 2), true);
      camera.snap(); return vp;
    },
    render(dt = 0) {
      clock += dt; camera.update(dt); lighting.update(clock);
      pipeline.render(scene, camera.cam, dt);
      return vp;
    },
    dispose() { pipeline.renderer.dispose(); },
  };
  const r = canvas.getBoundingClientRect();
  vp.resize(r.width || canvas.width || 1, r.height || canvas.height || 1);
  vp.fit(map);
  return vp;
}

export class RenderLadder {
  /**
   * @param {{scene:THREE.Scene, session?:object, def?:object, lighting?:object, camera?:object,
   *          onBuild?:function, onDerived?:function}} o
   *   `session` is the mutation chokepoint (editor/session.js); a bare `def` works too, which is
   *   what the headless harness and a read-only preview use.
   */
  constructor({ scene, session = null, def = null, lighting = null, camera = null, onBuild = null, onDerived = null }) {
    this.scene = scene; this.session = session; this.lighting = lighting; this.camera = camera;
    this.onBuild = onBuild; this.onDerived = onDerived;
    this._def = def;
    this.ghost = new Ghost(scene);
    this.map = null;
    this._terrain = null; this._props = null; this._drop = [];
    this._dirty = 0; this._propDirty = false; this._derivedDue = false;
    this._rect = null;                       // union of every dirty rect since the last true build
    this._stroke = false; this._rectAll = true; this._lastInput = 0; this._propGen = 0; this._disposed = false;
    this.draft = false; this.oversize = false; this._fitSig = '';
    // Seeded at the shipped map's measured cost so the first stroke coalesces sanely instead of
    // re-truthing on every frame until it has learned the machine.
    this.lastTerrainMs = 50; this.idleMs = 200;
    this.stats = { terrain: 0, props: 0, discarded: 0, refused: 0 };
    if (session && typeof session.on === 'function') {
      // undo/redo/abort replace values wholesale across an arbitrary patch, so they take tier 4
      // rather than trying to reason about which cells the inverse touched.
      this._off = session.on('change', (e) => {
        if (e && (e.cause === 'undo' || e.cause === 'redo' || e.cause === 'abort')) this.rebuildAll();
        else this.markDirty(e && e.bounds, e && e.channels);
      });
    }
    this.rebuildAll();
  }

  /** The live document. Read through the session every time: undo replaces the object wholesale. */
  get doc() { return this.session ? this.session.def : this._def; }
  /** GETTERS, never cached by the frame loop: `terrain.userData.update(t)` must be called THROUGH
   *  this or the water shader freezes on the first rebuild (terrain.md 6.12). */
  get terrain() { return this._terrain; }
  get props() { return this._props; }

  /** Swap the whole document (map load, undo, redo, paste) and take tier 4: a full rebuild. */
  setDef(def) { this._def = def; this.rebuildAll(); return this; }

  /**
   * @param {{x0:number,z0:number,x1:number,z1:number}|null} rect tiles touched, inclusive
   * @param {number|string|string[]} kind CH bit flags, or channel name(s)
   */
  markDirty(rect, kind) {
    const f = chFlags(kind);
    this._dirty |= f;
    if (f & CHANNEL.PROP) this._propDirty = true;
    if (f) this._derivedDue = true;
    if (rect) {
      const r = this._rect;
      this._rect = r ? { x0: Math.min(r.x0, rect.x0), z0: Math.min(r.z0, rect.z0), x1: Math.max(r.x1, rect.x1), z1: Math.max(r.z1, rect.z1) } : { ...rect };
    } else if (f & STRUCTURAL) { this._rect = null; this._rectAll = true; }
    this._lastInput = now();
    return this;
  }

  beginStroke() { this._stroke = true; this._lastInput = now(); return this; }
  /** Release: the ghost has said its piece, the truth is owed on the very next tick. */
  endStroke() { this._stroke = false; this._lastInput = -1e9; return this; }
  /** Draft mode: hold the ghost and skip tier 1 until flush(). For 48x48 maps on soft GL. */
  setDraft(on) { this.draft = !!on; if (!on) this._lastInput = -1e9; return this; }
  /** Tier 4 — map load / undo / redo / paste / Draft commit. Terrain rebuilds synchronously (the
   *  caller wants the new document on screen now); tiers 2 and 3 are left to the next tick, which
   *  is also what keeps the group being replaced alive for one drawn frame. */
  rebuildAll() { this._dirty = ALL; this._propDirty = true; this._derivedDue = true; this._rectAll = true; this._rect = null; this._lastInput = -1e9; this._truth(); return this; }
  flush() { return this.rebuildAll(); }

  /**
   * One frame of the ladder. Call BEFORE pipeline.render.
   * @param {number} [nowMs] performance.now(), passed in so a test can drive time deterministically
   */
  tick(nowMs = now()) {
    if (this._disposed) return this;
    // Swap before you drop: the replacement went in last tick and a frame has been drawn with it,
    // so the old group's VAOs are provably not in flight. Freeing them in the same tick that added
    // the replacement risks a buffer deleted under a queued draw. (The old group leaves the scene
    // at swap time, not here — deferring the REMOVAL too would draw both for a frame and z-fight.)
    if (this._drop.length) { for (const g of this._drop) disposeBuilt(g); this._drop.length = 0; }
    const idle = nowMs - this._lastInput;
    if ((this._dirty & STRUCTURAL) && !this.draft && (!this._stroke || idle >= this.idleMs)) this._truth(nowMs);
    if (this._propDirty && !this._stroke && idle >= PROP_DEBOUNCE) this._propsTruth();
    if (this._derivedDue && idle >= DERIVED_DEBOUNCE) this._derived();
    return this;
  }

  /** Tier 1. compileMap + buildTerrain, timed, because that timing IS the coalescing budget. */
  _truth(nowMs = now()) {
    const def = this.doc;
    if (!def) return;
    const w = def.size ? def.size.w : 0, d = def.size ? def.size.d : 0;
    if (w > SIZE_MAX || d > SIZE_MAX) {
      if (!this.oversize) console.warn(`[viewport] ${w}x${d} exceeds ${SIZE_MAX}: live preview refused, use Draft`);
      this.oversize = true; this.stats.refused++; this._dirty &= ~STRUCTURAL; return;
    }
    if (w > SIZE_WARN || d > SIZE_WARN) console.warn(`[viewport] ${w}x${d} is above ${SIZE_WARN}; each true build is ~${Math.round(this.lastTerrainMs)} ms`);
    const t0 = now();
    let map, next;
    try { map = compileMap(def); next = buildTerrain(map); } catch (e) {
      // A build that throws must not take the editor with it: keep the last good mesh on screen,
      // drop the dirty flags so we do not spin, and let the issues panel explain it.
      console.error('[viewport] terrain build failed', e); this._dirty &= ~STRUCTURAL; return;
    }
    this.scene.add(retain(next));
    if (this._terrain) { this.scene.remove(this._terrain); this._drop.push(this._terrain); }
    this._terrain = next; this.map = map;
    this.lastTerrainMs = now() - t0;
    // The only self-correcting latency budget in the editor: a fast machine re-truths after ~120 ms
    // of hesitation, SwiftShader (?gpu=soft, which is what tools/shot.mjs runs) only on release.
    this.idleMs = Math.min(600, Math.max(120, 2.5 * this.lastTerrainMs));
    if (this._heightTouchedAProp(map)) this._propDirty = true;
    this._dirty &= ~STRUCTURAL; this._rect = null; this._rectAll = false;
    this.ghost.hide();
    this.stats.terrain++;
    if (this.onBuild) this.onBuild(map, 'terrain');
  }

  /** Tier 2 skips entirely unless PROP is dirty or a height moved under some prop's footprint —
   *  props sit ON the terrain (props.js reads map.at(x,z).h), so a raise under a house must rebuild. */
  _heightTouchedAProp(map) {
    if (!(this._dirty & CHANNEL.HEIGHT)) return false;
    if (this._rectAll || !this._rect) return true;
    const r = this._rect;
    for (const p of map.props) {
      // footprint() is the BLOCKING rectangle and is empty for stairs, decks, walls and decals —
      // all of which still read map.at(x,z).h when they are built. Fall back to the anchor tile.
      const tiles = footprint(p);
      if (!tiles.length) { const x = Math.floor(p.x), z = Math.floor(p.z); if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true; continue; }
      for (const [x, z] of tiles) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
    }
    return false;
  }

  /** Tier 2, async and generation-guarded: a late resolve is DISCARDED, never installed. */
  async _propsTruth() {
    this._propDirty = false; this._dirty &= ~CHANNEL.PROP;
    const map = this.map;
    if (!map) return;
    const gen = ++this._propGen;
    let g = null;
    try { g = await buildProps(map); } catch (e) { console.error('[viewport] props build failed', e); return; }
    if (gen !== this._propGen || this._disposed) { this.stats.discarded++; disposeBuilt(g); return; }
    this.scene.add(retain(g));
    if (this._props) { this.scene.remove(this._props); this._drop.push(this._props); }
    this._props = g;
    this.stats.props++;
    if (this.onBuild) this.onBuild(map, 'props');
  }

  /** Tier 3: the cheap derived work that must never drop a frame. Analysis proper is debounced and
   *  frame-sliced by editor/analysis.js; what belongs HERE is only what the scene itself needs. */
  _derived() {
    this._derivedDue = false;
    const map = this.map;
    if (!map) return;
    const maxH = map.tiles.flat().reduce((a, t) => Math.max(a, t.h), 0) * HSTEP;
    // Only when the DIORAMA changed shape. camera.setBounds re-runs the per-yaw silhouette fit and
    // re-clamps the focus, so calling it after every edit would tug the lens on each brush stroke.
    const sig = `${map.w}x${map.d}x${maxH}`;
    if (sig === this._fitSig) { if (this.onDerived) this.onDerived(map); return; }
    this._fitSig = sig;
    if (this.lighting && this.lighting.bounds) {
      this.lighting.bounds.min.set(-0.5, -0.6, -0.5);
      this.lighting.bounds.max.set(map.w + 0.5, maxH + 3.0, map.d + 0.5);
      this.lighting.refit();
      const ud = this.scene.userData.diorama;
      if (ud) { ud.center.set(map.w / 2, maxH * 0.45, map.d / 2); ud.radius = this.lighting.bounds.getSize(new THREE.Vector3()).length() * 0.5; }
    }
    if (this.camera) this.camera.setBounds(new THREE.Vector3(-0.5, -0.6, -0.5), new THREE.Vector3(map.w + 0.5, maxH + 2.6, map.d + 0.5));
    if (this.onDerived) this.onDerived(map);
  }

  dispose() {
    this._disposed = true;
    if (this._off) this._off();
    this.ghost.dispose();
    for (const g of [...this._drop, this._terrain, this._props]) {
      if (!g) continue;
      if (g.parent) g.parent.remove(g);
      disposeBuilt(g);
    }
    this._drop.length = 0; this._terrain = null; this._props = null;
  }
}

function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
