// THE ANALYSIS DRIVER (PLAN §6.9, §6.10). Everything the panels and the overlays read is recomputed
// here — debounced behind a settled commit and sliced across frames — so a stroke never pays for the
// analysis of the map it is halfway through building. validateDef alone measures ~47 ms on the shipped
// 20x20 and scales with w*d: run inline on the commit that fires it, that is four to twenty dropped
// frames per brush release. A Worker is out — validate.js hands back live `fix(def)` CLOSURES the
// Issues panel calls, which do not serialise.
//
// THE HONEST LIMIT. No analyser is resumable, so a step is never split: one step starts per frame
// unconditionally (the progress guarantee) and further steps only while the budget holds. That bounds
// latency to ONE STEP per frame, not to `budgetMs`; `timings` names the step that overran. Zero
// three.js and zero DOM at module scope: the driver runs under bare `node`, and the two DOM-touching
// parts (mountScrubber, attach's browser half) are guarded like params.js's.
import { compileMap } from '../world/mapformat/compile.js';
import { validateDef } from '../world/mapformat/validate.js';
import { buildGraph, tierField, pathOf, turnsFor } from '../world/jumpgraph.js';
import { PROFILES, profileOf, CLASS_PROFILES } from '../world/analysis/profiles.js';
import { ladder, verifyPromises, pockets, sealProof } from '../world/analysis/ladder.js';
import { classifyEdges, faceScan, faceKey, toNodes, spanDist } from '../world/analysis/classify.js';

const DOC = typeof document !== 'undefined' ? document : null;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Pass order. compile first (every later step reads `graph`); field last (the ORIGIN invalidates it
 *  alone, so re-picking an origin re-runs exactly one step). */
export const STEPS = Object.freeze(['compile', 'validate', 'ladder', 'shortcuts', 'contract', 'field']);

const STEP_FNS = {
  compile(s) { s.map = compileMap(s.def); s.graph = buildGraph(s.map); s.ctx = ctxOf(s); },
  validate(s) { s.validation = validateDef(s.def); },
  ladder(s) { s.ladder = ladder(s.graph, s.ctx); s.promises = verifyPromises(s.ladder, s.design.promises || []); },
  shortcuts(s) { s.shortcuts = classifyEdges(s.graph, s.ctx); s.faces = facesOf(s); },
  // `chokeTiles`, not `tiles`: sealProof's own `tiles` is the COUNT it deleted, and a spread that
  // clobbered it with the array left the seal overlay iterating a number.
  contract(s) {
    s.seals = (s.design.chokes || []).map((c) => ({ ...sealProof(s.graph, c, { ...s.ctx, climb: c.tier ?? s.ctx.baseClimb }), cid: c.cid || null, chokeTiles: c.tiles || [] }));
    s.pockets = pockets(s.graph, { ...s.ctx, climb: s.ctx.baseClimb }); },
  // PROFILES whole, not the map's declared tiers: a tile no roster tier reaches must read as dead
  // board, not as "outside the tiers I listed", and only the full roster tells those apart.
  field(s) { s.field = tierField(s.graph, PROFILES, s.origin.length ? s.origin : s.ctx.srcA); },
};

const ctxOf = (s) => ({ baseClimb: s.design.baseTier ?? 4, profiles: PROFILES,
  tiers: s.design.tiers && s.design.tiers.length ? s.design.tiers : undefined,
  srcA: toNodes(s.graph, (s.def.spawns || {}).A), srcB: toNodes(s.graph, (s.def.spawns || {}).B) });
// Discovered vs declared, matched on classify.js's order-insensitive edge key. `undeclared` stops an
// accidental shortcut shipping; `phantom` is a declaration the terrain stopped backing up.
function facesOf(s) {
  const g = s.graph;
  const discovered = faceScan(g, s.ctx.baseClimb, { tiers: s.ctx.tiers });
  const declared = (s.design.faces || []).map((f) => {
    const a = f.from ? g.idx(f.from[0], f.from[1]) : -1, b = f.to ? g.idx(f.to[0], f.to[1]) : -1;
    return { ...f, a, b, key: faceKey(a, b) };
  });
  const dk = new Set(declared.map((f) => f.key)), fk = new Set(discovered.map((f) => f.key));
  return { discovered, declared, undeclared: discovered.filter((f) => !dk.has(f.key)), phantom: declared.filter((f) => !fk.has(f.key)) };
}

/** One completed pass. `validation` is validateDef's result with its live `fix` closures intact; the
 *  rest are the analysers' own shapes; `field` is tierField() from `origin`; `timings` is ms per step
 *  (`total` is wall time ACROSS frames) and `failed` names a step that threw.
 *  @typedef {{seq:number, def:object, map:object, graph:object, ctx:object, validation:object, ladder:object,
 *             promises:Array, shortcuts:Array, seals:Array, pockets:Array, faces:object, field:object,
 *             timings:Object, failed:string|null, stale:boolean}} AnalysisResult */
export class Analysis {
  /**
   * @param {{session?:object, def?:object, budgetMs?:number, debounceMs?:number,
   *          origin?:[number,number]|null, onResult?:(r:AnalysisResult)=>void,
   *          onProgress?:(p:{step:string,i:number,n:number})=>void}} o
   */
  constructor({ session = null, def = null, budgetMs = 8, debounceMs = 180, origin = null, onResult = null, onProgress = null } = {}) {
    this.session = session; this._def = def;
    this.budgetMs = budgetMs; this.debounceMs = debounceMs;
    this.onResult = onResult; this.onProgress = onProgress; this._subs = new Set();
    this.origin = origin;                  // [x,z] the heatmap floods from; null = team A's spawns
    this.result = null; this.pending = true; this.running = false;
    this._pass = null; this._at = -1e9; this._seq = 0; this._disposed = false;
    // DESIGN and META move no tile but they move the CONTRACT — a declared face is exactly what turns
    // an undeclared-face error into a clean map — so every channel requests a pass.
    if (session && typeof session.on === 'function') this._off = session.on('change', () => this.request());
  }
  get def() { return this.session ? this.session.doc : this._def; }
  setDef(def) { this._def = def; return this.request(); }
  /** Re-flood the heatmap from one tile; only the `field` step is invalidated, so this is cheap. */
  setOrigin(tile) {
    this.origin = tile ? [tile[0] | 0, tile[1] | 0] : null;
    if (this.result && this.result.graph) { this._pass = this._newPass(STEPS.indexOf('field'), this.result); this.pending = true; this._at = -1e9; }
    else this.request();
    return this;
  }
  /** RESTART, NEVER QUEUE. A burst of commits costs one pass, and an in-flight pass is DISCARDED —
   *  `compile` snapshots map and graph in step 1, so a pass that survived a commit would publish
   *  post-edit findings over a pre-edit board. */
  request() { this.pending = true; this._at = now(); this._pass = null; this.running = false; if (this.result) this.result.stale = true; return this; }
  /** One frame of the driver; `nowMs` is passed in so a test can drive time deterministically.
   *  @returns {boolean} true if any step ran this frame */
  tick(nowMs = now()) {
    if (this._disposed) return false;
    if (!this._pass) {
      if (!this.pending || nowMs - this._at < this.debounceMs) return false;
      const def = this.def;
      if (!def) { this.pending = false; return false; }
      this.pending = false; this._pass = this._newPass(0, null);
    }
    const p = this._pass, t0 = nowMs;
    this.running = true;
    let ran = false;
    // One step per frame minimum: without it, a machine already over budget never finishes a pass.
    while (p.i < STEPS.length && (!ran || now() - t0 < this.budgetMs)) {
      const k = STEPS[p.i], t1 = now();
      try { STEP_FNS[k](p.s); } catch (e) { p.s.failed = k; p.s.error = String((e && e.message) || e); console.error(`[analysis] step ${k} threw`, e); }
      p.s.timings[k] = now() - t1; p.i++; ran = true;
      if (this.onProgress) this.onProgress({ step: k, i: p.i, n: STEPS.length });
    }
    if (p.i >= STEPS.length) this._finish(p);
    return ran;
  }
  /** The whole pass, synchronously — what tools/checks and a node test use. */
  run() { this._pass = null; this.pending = true; this._at = -1e9; const b = this.budgetMs; this.budgetMs = 1e9; this.tick(); this.budgetMs = b; return this.result; }
  _newPass(from, base) {
    const def = this.def, d = (def && def.design) || {};
    const s = base ? { ...base } : { def, design: d, origin: [], timings: {}, failed: null, error: null };
    s.def = def; s.design = d; s.timings = { ...(s.timings || {}) };
    s.origin = this.origin && def ? [(this.origin[1] | 0) * def.size.w + (this.origin[0] | 0)] : [];
    return { i: from, s, t0: now() };
  }
  _finish(p) {
    this._pass = null; this.running = false;
    const s = p.s;
    s.timings.total = now() - p.t0; s.seq = ++this._seq; s.stale = false;
    s.errors = s.validation ? s.validation.errors.length : 0;
    s.warnings = s.validation ? s.validation.warnings.length : 0;
    this.result = s;
    if (this.onResult) this.onResult(s);
    // A listener that throws must not kill the pass that produced the result, or one broken panel
    // takes the other three down with it and the editor looks like it stopped analysing.
    for (const fn of [...this._subs]) { try { fn(s); } catch (e) { console.error('[analysis] subscriber threw', e); } }
  }
  /** @param {(r:AnalysisResult)=>void} fn fired on every completed pass, and immediately if one is
   *  already in hand — a panel mounted after the first pass must not sit blank until the next edit. */
  subscribe(fn) { this._subs.add(fn); if (this.result) { try { fn(this.result); } catch (e) { console.error('[analysis] subscriber threw', e); } } return () => this._subs.delete(fn); }
  dispose() { this._disposed = true; this._pass = null; this._subs.clear(); if (this._off) this._off(); }
}
// ---------------------------------------------------------------------------- the shared service
/**
 * THE ONE ANALYSIS PER EDITOR. main.js globs `panels/*.js`, calls each module's `init(ctx)`, then
 * mounts every registered panel record and DISCARDS the mount handle — so nothing upstream feeds a
 * panel its data. Four panels, the overlays and the scrubber read the SAME pass, and a driver per
 * consumer would run the analysis five times per commit; so the service is latched onto the shared
 * ctx by whichever `init` runs first and every later caller gets that same object back. overlays.js
 * is loaded DYNAMICALLY: it imports three.js and src/core/config.js (which reads `location` at module
 * scope), and a static import would make this module unloadable under bare `node`.
 * @param {object} ctx main.js's plugin context: {session, scene, camera, shell, layers, map, ...}
 * @returns {{analysis:Analysis, compare:RouteCompare, overlays:object|null, result:object|null,
 *            subscribe:(fn:Function)=>Function, flyTo:(x:number,z:number)=>void, dispose:Function}}
 */
export function attach(ctx) {
  if (ctx.analysis && ctx.analysis.analysis instanceof Analysis) return ctx.analysis;
  const analysis = new Analysis({ session: ctx.session, def: ctx.def || null, budgetMs: 8, debounceMs: 180 });
  const compare = new RouteCompare();
  const subs = new Set();
  let ov = null, mod = null, raf = 0, last = 0, dead = false;
  const fan = (r) => { for (const fn of [...subs]) { try { fn(r); } catch (e) { console.error('[analysis] sub threw', e); } } };
  const svc = { analysis, compare, result: null, get overlays() { return ov; },
    subscribe(fn) { subs.add(fn); if (svc.result) { try { fn(svc.result); } catch (e) { console.error(e); } } return () => subs.delete(fn); },
    flyTo(x, z) { if (mod) mod.flyTo(ctx.camera, ctx.map || ctx.MAP, x, z); },
    dispose() { dead = true; if (raf) cancelAnimationFrame(raf); analysis.dispose(); if (ov) ov.dispose(); subs.clear(); ctx.analysis = null; } };
  ctx.analysis = svc;
  analysis.onResult = (r) => {
    svc.result = r; compare.compute(r);
    if (ov) { ov.setResult(r); ov.setRoutes(compare); }
    if (svc.scrubber) svc.scrubber.update(r);
    fan(r);
    if (ctx.shell && ctx.shell.stat) ctx.shell.stat('map', `${r.errors}e ${r.warnings}w`, r.errors ? 'err' : r.warnings ? 'warn' : 'ok'); };
  if (typeof window !== 'undefined' && ctx.scene) {
    import('./overlays.js').then((m) => {
      if (dead) return;
      mod = m; ov = new m.Overlays(ctx.scene, { mode: 'tier', a: compare.a, b: compare.b });
      if (svc.result) { ov.setResult(svc.result); ov.setRoutes(compare); }
      if (!ctx.shell || !ctx.shell.scrub) return;   // a headless harness has no chrome to mount into
      ctx.shell.showScrub(true);
      svc.scrubber = mountScrubber(ctx.shell.scrub, { compare, onChange: () => { ov.setProfiles(compare.a, compare.b); ov.setRoutes(compare); } });
      if (svc.result) svc.scrubber.update(svc.result);
      // The scrubbar is a new grid ROW, so the canvas cell just got shorter; without this the renderer
      // keeps drawing at the old height and the picture stretches (viewport.js's resize note).
      if (ctx.shell.viewportRect && ctx.pipeline) { const r = ctx.shell.viewportRect(); ctx.camera.setAspect(r.width / r.height); ctx.pipeline.resize(r.width, r.height); }
    }).catch((e) => console.error('[analysis] overlays failed to load', e));
    // Its own rAF rather than a hook into main.js's frame(): the driver must keep slicing while the
    // render loop is frozen for a screenshot, and a pump nobody else owns cannot be forgotten.
    // The Layers panel's eye column is main.js's, and layers.js has ONE onChange slot which main.js
    // already owns — so the overlay group reads the flag rather than subscribing to it. A Map lookup
    // per frame is cheaper than the coordination a second subscriber would need.
    const pump = (t) => { if (dead) return; const dt = Math.min(0.05, (t - last) / 1000); last = t;
      analysis.tick(t);
      if (ov) { if (ctx.layers) ov.group.visible = ctx.layers.visible('overlays'); ov.update(dt); }
      raf = requestAnimationFrame(pump); };
    raf = requestAnimationFrame(pump);
  }
  return svc;
}
// ---------------------------------------------------------------------------- route compare
/** The default pair, by CLASS not by tier: a designer thinks "Knight" and "Ninja", and the numbers
 *  come off the LIVE roster — JUMP 2 / 4h / MOVE 3 against JUMP 7 / 14h / MOVE 4 as shipped. */
export const COMPARE_DEFAULT = Object.freeze(['knight', 'ninja']);
/** Every non-teleport class, by climb then name — the scrubber's dropdowns. */
export const compareChoices = () => Object.values(CLASS_PROFILES).filter((p) => p && !p.teleport)
  .sort((a, b) => a.climb - b.climb || (a.name < b.name ? -1 : 1));
/**
 * TWO SHORTEST ROUTES, SCRUBBED — "where does the fast unit peel off, and what does it buy". The one
 * question the tier ladder cannot answer, because the ladder reports a number and this reports the
 * TILE. Both routes are A-to-B shortest paths at their own class's climb, so the divergence index is
 * the first tile the slow class cannot follow onto; turn marks sit every MOVE steps from the start,
 * which is where a player actually ends a turn.
 */
export class RouteCompare {
  constructor(o = {}) { this.a = o.a || COMPARE_DEFAULT[0]; this.b = o.b || COMPARE_DEFAULT[1]; this.step = 0; this.routes = []; this.diverge = -1; }
  setProfiles(a, b) { if (a) this.a = a; if (b) this.b = b; return this; }
  /** @param {AnalysisResult} res */
  compute(res) {
    this.routes = []; this.diverge = -1;
    if (!res || !res.graph || !res.ctx) return this;
    const g = res.graph, { srcA, srcB } = res.ctx;
    for (const cls of [this.a, this.b]) {
      const pr = profileOf(cls);
      if (!pr || !srcA.length || !srcB.length) { this.routes.push(null); continue; }
      const { steps, at, res: fl } = spanDist(g, pr.climb, pr.water, srcA, srcB);
      const path = at >= 0 ? pathOf(g, fl, at) || [] : [], marks = [];
      for (let k = pr.move; k < path.length - 1; k += pr.move) marks.push(k);
      this.routes.push({ cls, profile: pr, path, steps, turns: turnsFor(steps, pr.move), marks,
        label: `${pr.name} · JUMP ${pr.jump} (${pr.climb}h) · MOVE ${pr.move}` });
    }
    const [ra, rb] = this.routes;
    if (ra && rb) {
      const n = Math.min(ra.path.length, rb.path.length);
      // The peel-off tile: the first index the two paths disagree on. Identical paths of different
      // length still diverge — at the end of the shorter one.
      for (let k = 0; k < n; k++) if (ra.path[k][0] !== rb.path[k][0] || ra.path[k][1] !== rb.path[k][1]) { this.diverge = k; break; }
      if (this.diverge < 0 && ra.path.length !== rb.path.length) this.diverge = n - 1;
    }
    this.step = Math.min(this.step, this.max);
    return this;
  }
  get max() { return Math.max(0, ...this.routes.map((r) => (r ? Math.max(0, r.path.length - 1) : 0))); }
  setStep(i) { this.step = Math.max(0, Math.min(this.max, i | 0)); return this; }
  /** Where route k stands at the scrub position; it waits at its destination once arrived. */
  posOf(k) { const r = this.routes[k]; return r && r.path.length ? r.path[Math.min(this.step, r.path.length - 1)] : null; }
  /** Turns route k has spent by the current step. turnsFor()'s own -1 already accounts for the last
   *  step never being taken, so the STEP INDEX goes in unadjusted — +1 overshoots the route total. */
  turnsAt(k) { const r = this.routes[k]; return r ? turnsFor(Math.min(this.step, Math.max(0, r.path.length - 1)), r.profile.move) : 0; }
  /** Turns the SECOND profile saves over the first. A severed route saves nothing, never ∞. */
  get saving() {
    const [ra, rb] = this.routes;
    if (!ra || !rb || !Number.isFinite(ra.turns) || !Number.isFinite(rb.turns)) return 0;
    return ra.turns - rb.turns;
  }
}
// ---------------------------------------------------------------------------- scrubber (DOM)
const fmt = (v) => (Number.isFinite(v) ? String(v) : '∞');
const el = (tag, cls, txt) => { const n = DOC.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const sel = (val, onChange) => {
  const s = el('select', 'ed-select');
  // ignore_height `jump` is MOVEMENTS' 99 sentinel plus its own mods; printed raw it offers the
  // designer a "Wyrmlancer · J103" that is not a stat anybody can reason about.
  for (const p of compareChoices()) { const o = el('option', null, `${p.name} · ${p.ignoreHeight ? 'J∞' : 'J' + p.jump} M${p.move}`); o.value = p.cls; s.append(o); }
  s.value = val; s.addEventListener('change', () => onChange(s.value));
  return s;
};
/** The scrubber, into editor.css's `.ed-scrubbar` (grid area `scrub`; the host must set `html.ed-scrub`
 *  or the row has zero height). @param {HTMLElement} host
 *  @param {{compare?:RouteCompare, onChange?:(rc:RouteCompare)=>void}} [ctx] */
export function mountScrubber(host, ctx = {}) {
  if (!DOC) throw new Error('mountScrubber: no document');
  const rc = ctx.compare || new RouteCompare();
  const fired = () => { if (ctx.onChange) ctx.onChange(rc); };
  const f1 = el('div', 'ed-field'), f2 = el('div', 'ed-field'), f3 = el('div', 'ed-field');
  f1.append(el('label', null, 'ROUTE'), sel(rc.a, (v) => { rc.setProfiles(v, null).compute(last); paint(); fired(); }),
    el('span', 'ed-muted', 'vs'), sel(rc.b, (v) => { rc.setProfiles(null, v).compute(last); paint(); fired(); }));
  const range = DOC.createElement('input'), at = el('span', 'ed-num', '0');
  range.type = 'range'; range.className = 'ed-range'; range.min = 0; range.value = 0;
  range.addEventListener('input', () => { rc.setStep(+range.value); paint(); fired(); });
  f2.append(el('label', null, 'STEP'), range, at);   // .ed-range + .ed-num, the strip's own pairing
  const chips = { a: el('span', 'ed-chip tier'), b: el('span', 'ed-chip tier'), d: el('span', 'ed-chip info'), s: el('span', 'ed-chip') };
  f3.append(chips.a, chips.b, chips.d, chips.s); host.append(f1, f2, f3);
  let last = null;
  function paint() {
    range.max = rc.max; range.value = rc.step; at.textContent = `${rc.step}/${rc.max}`;
    const [ra, rb] = rc.routes, sv = rc.saving;
    chips.a.textContent = ra ? `${ra.profile.name} ${fmt(ra.steps)} steps · ${fmt(ra.turns)}t (now ${rc.turnsAt(0)}t)` : '—';
    chips.b.textContent = rb ? `${rb.profile.name} ${fmt(rb.steps)} steps · ${fmt(rb.turns)}t (now ${rc.turnsAt(1)}t)` : '—';
    // A divergence at index 0 is not a peel-off: the two floods are seeded on ALL of team A's seats,
    // so the faster profile can simply start from a different seat. Say what happened.
    const dv = rc.diverge, tile = dv > 0 && rb ? rb.path[dv] : null;
    chips.d.textContent = tile ? `peels off at ${tile[0]},${tile[1]} (step ${dv})`
      : dv === 0 ? 'a different route from the first tile' : 'same route at both tiers';
    chips.s.textContent = `saves ${sv} turn${Math.abs(sv) === 1 ? '' : 's'}`;
    chips.s.className = 'ed-chip ' + (sv > 0 ? 'tier' : 'warn');
  }
  paint();
  return { el: host, compare: rc, update: (res) => { last = res; rc.compute(res); paint(); },
    destroy: () => { f1.remove(); f2.remove(); f3.remove(); } };
}
