// THE INSPECTOR (PLAN §6.9). One panel for every addressable thing on the board — a prop, a spawn
// seat, a declared face/choke/route/region/assist/promise, or a bare tile — and NOT ONE hand-written
// form among them.
//
// GENERATED, BECAUSE THE ALTERNATIVE ROTS. propspec.js already carries the authoritative field list
// for all 26 prop types, with each field's type, label, bounds, units and enum. A hand-built form per
// type would be ~400 lines that silently disagree with props.js the first time somebody adds a roof
// style — and the disagreement would be invisible, because props.js validates nothing and drops what
// it does not recognise. So PROP_SPEC[type].fields is compiled straight into params.js's schema and
// params.js compiles that into the controls. Adding a prop field is one line in propspec.js.
//
// THE DESIGN RECORDS ARE THE ONE TABLE THAT MUST BE WRITTEN DOWN. Their field lists live only in
// schema.js's typedefs, which JSDoc cannot be read back at runtime, so DESIGN_SPEC below is that
// transcription — with every ENUM imported from schema.js rather than retyped, which is the half
// that actually drifts.
//
// COORDINATES GO THROUGH snapCoord(). props.md's most-common authoring bug is a house at x:4.5 or an
// oak at x:4; the inspector is where a number is typed by hand, so it is exactly where that bug would
// be introduced, and it is caught on the way into the transaction rather than by the validator after.
import { definePanel, has, byId } from '../registry.js';
import { attach } from '../analysis.js';
import { buildControls, normalizeSchema } from '../params.js';

export function init(ctx) { attach(ctx); }
import { PROP_SPEC, snapCoord, footprint } from '../../world/mapformat/propspec.js';
import { TIER_KINDS, REGION_KINDS, ASSIST_KINDS, TEAMS, LETTERS } from '../../world/mapformat/schema.js';
import { climbToJump, NO_EDGE } from '../../world/jumpgraph.js';

const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const num = (v) => (v === Infinity ? '∞' : v == null || Number.isNaN(v) ? '–' : String(v));
const opt = (list) => list.map((v) => ({ v, label: v === null ? '(none)' : String(v) }));

/** Design-record field lists, keyed by the `declare(kind, …)` vocabulary session.js already uses.
 *  `path` is dotted and indexes arrays, so a coordinate pair is two ordinary number controls over
 *  one array — Tx.setField walks the same path and records its own inverse. */
export const DESIGN_SPEC = Object.freeze({
  face: { list: 'faces', id: 'fid', label: 'Face', fields: [
    { k: 'from.0', label: 'from x', type: 'number' }, { k: 'from.1', label: 'from z', type: 'number' },
    { k: 'to.0', label: 'to x', type: 'number' }, { k: 'to.1', label: 'to z', type: 'number' },
    { k: 'drop', label: 'drop', type: 'number', unit: 'h', hint: 'validate.js checks this equals |dH| exactly' },
    { k: 'tier', label: 'tier', type: 'number', unit: 'h' },
    { k: 'kind', label: 'kind', type: 'enum', options: opt([...TIER_KINDS]) },
    { k: 'minSaving', label: 'min saving', type: 'number', unit: 'steps' },
    { k: 'minTurnSaving', label: 'min saving', type: 'number', unit: 'turns' },
    { k: 'note', label: 'note', type: 'text' }] },
  choke: { list: 'chokes', id: 'cid', label: 'Choke', fields: [
    { k: 'tier', label: 'tier', type: 'number', unit: 'h' }, { k: 'note', label: 'note', type: 'text' }] },
  route: { list: 'routes', id: 'rid', label: 'Route', fields: [
    { k: 'tier', label: 'tier', type: 'number', unit: 'h' },
    { k: 'from', label: 'from', type: 'enum', options: opt([...TEAMS]) },
    { k: 'to', label: 'to', type: 'enum', options: opt([...TEAMS]) },
    { k: 'note', label: 'note', type: 'text' }] },
  region: { list: 'regions', id: 'rgid', label: 'Region', fields: [
    { k: 'kind', label: 'kind', type: 'enum', options: opt([...REGION_KINDS]) },
    { k: 'rect.0', label: 'x0', type: 'number' }, { k: 'rect.1', label: 'z0', type: 'number' },
    { k: 'rect.2', label: 'x1', type: 'number' }, { k: 'rect.3', label: 'z1', type: 'number' },
    { k: 'note', label: 'note', type: 'text' }] },
  assist: { list: 'assists', id: 'aid', label: 'Assist', fields: [
    { k: 'kind', label: 'kind', type: 'enum', options: opt([...ASSIST_KINDS]) },
    { k: 'dir', label: 'dir', type: 'enum', options: opt(['n', 's', 'e', 'w']) },
    { k: 'bridges.lowH', label: 'low', type: 'number', unit: 'h' },
    { k: 'bridges.highH', label: 'high', type: 'number', unit: 'h' },
    { k: 'note', label: 'note', type: 'text' }] },
  promise: { list: 'promises', id: null, label: 'Promise', fields: [
    { k: 'from', label: 'from', type: 'enum', options: opt([...TEAMS]) },
    { k: 'to', label: 'to', type: 'enum', options: opt([...TEAMS]) },
    { k: 'tier', label: 'tier', type: 'number', unit: 'h' },
    { k: 'savesTurns', label: 'saves', type: 'number', unit: 'turns' }] },
});
// propspec's field vocabulary -> params.js's. 'int' is a number with step 1; everything else keeps
// propspec's own bounds, so a tower shaft cannot be typed past the 8-world-unit ceiling props.js draws.
const P_TYPE = { int: 'number', number: 'number', bool: 'toggle', enum: 'enum' };
function propSchema(type) {
  const s = PROP_SPEC[type];
  if (!s) return normalizeSchema([]);
  return normalizeSchema(s.fields.map((f) => ({ k: f.k, type: P_TYPE[f.type] || 'number', label: f.label,
    def: f.def !== null && f.def !== undefined ? f.def : f.type === 'bool' ? false : f.enum ? f.enum[0] : (f.min ?? 0),
    min: f.min, max: f.max, step: f.type === 'int' ? 1 : 0.5, unit: f.units || '',
    options: f.enum ? opt(f.enum) : null, hint: f.req ? 'required' : '' })));
}
const rd = (o, p) => p.split('.').reduce((v, k) => (v == null ? v : v[k]), o);

/**
 * @param {HTMLElement} host a `.ed-panel-body`
 * @param {object} [ctx] main.js's plugin context: `session` for writes, `analysis` for the live
 *   measurements shown beside each declaration, `toast`, and an optional `onSelect`.
 * @returns {{el, update(res), select(target), target, destroy()}}
 */
export function mountInspectorPanel(host, ctx = {}) {
  const svc = ctx.analysis && ctx.analysis.analysis ? ctx.analysis : null;
  const flyTo = ctx.flyTo || (svc ? svc.flyTo : null);
  const root = el('div', 'ed-inspector');
  // NOT .ed-panel-head: editor.css declares that as a child of .ed-panel, and a second one inside a
  // body reads as a second panel. A gold chip says the same thing inside the contract.
  const title = el('div', 'ed-field'), name = el('span', 'ed-chip tier');
  title.append(name);
  const facts = el('div', 'ed-kv');
  const form = el('div');
  const foot = el('div', 'ed-field');
  const del = el('button', 'ed-btn danger', 'Delete');
  const go = el('button', 'ed-btn', 'Fly to');
  foot.append(go, del);
  root.append(title, facts, form, foot);
  host.append(root);
  let target = null, res = null, ctl = null;
  const say = (m, k) => { if (ctx.toast) ctx.toast(m, k); };
  const doc = () => (ctx.session ? ctx.session.doc : (res && res.def) || null);
  const kv = (k, v) => { facts.append(el('span', 'k', k), el('span', 'v', String(v))); };

  /** @param {{kind:string, pid?:string, id?:string, index?:number, team?:string, slot?:number, x?:number, z?:number}|null} t */
  function select(t) { target = t || null; paint(); if (ctx.onSelect) ctx.onSelect(target); return api; }

  function commitProp(pid, k, v) {
    const d = doc(), p = d && (d.props || []).find((q) => q.pid === pid);
    if (!p || !ctx.session) return;
    // x and z are canonicalised together: snapCoord is per-TYPE, and snapping one axis against the
    // other's stale value is how a tileCentre prop ends up at 4.5, 4 — half on convention.
    if (k === 'x' || k === 'z') {
      const [nx, nz] = snapCoord(p.type, k === 'x' ? +v : p.x, k === 'z' ? +v : p.z);
      ctx.session.edit(`move ${p.type}`, (tx) => tx.updateProp(pid, { x: nx, z: nz }));
    } else ctx.session.edit(`${p.type}.${k}`, (tx) => tx.updateProp(pid, { [k]: v }));
  }
  function commitDesign(kind, index, k, v) {
    const spec = DESIGN_SPEC[kind];
    if (!ctx.session || !spec) return;
    ctx.session.edit(`${kind}.${k}`, (tx) => tx.setField(['design', spec.list, index, ...k.split('.')], v));
  }
  function remove() {
    const d = doc();
    if (!ctx.session || !target || !d) return;
    if (target.kind === 'prop') ctx.session.edit('delete prop', (tx) => tx.removeProp(target.pid));
    else if (DESIGN_SPEC[target.kind]) ctx.session.edit(`delete ${target.kind}`, (tx) => tx.undeclare(target.kind, target.id != null ? target.id : target.index));
    else return say('nothing deletable is selected', 'warn');
    select(null);
  }

  function paint() {
    facts.textContent = ''; form.textContent = '';
    if (ctl) { ctl.destroy(); ctl = null; }
    const d = doc();
    del.disabled = !(target && (target.kind === 'prop' || DESIGN_SPEC[target.kind]));
    go.disabled = !target || !flyTo;
    if (!target || !d) { name.textContent = 'nothing selected'; facts.append(el('span', 'k', ''), el('span', 'v ed-muted', 'pick a prop, a spawn, a tile or a declaration')); return; }
    if (target.kind === 'prop') return paintProp(d);
    if (target.kind === 'spawn') return paintSpawn(d);
    if (target.kind === 'tile') return paintTile(d);
    if (DESIGN_SPEC[target.kind]) return paintDesign(d);
    name.textContent = String(target.kind);
  }

  function paintProp(d) {
    const p = (d.props || []).find((q) => q.pid === target.pid);
    if (!p) { name.textContent = 'prop (gone)'; return; }
    const s = PROP_SPEC[p.type];
    name.textContent = `${p.type} ${p.pid || ''}`;
    kv('coord', s ? s.coord : 'unknown type — props.js will drop it silently');
    if (s) { kv('blocks', s.blocking ? `${footprint(p).length} tile(s)` : 'walk-through'); if (s.variants > 1) kv('variants', `${s.variants} PNGs, round-robined over the props array in ORDER`); if (s.note) kv('note', s.note); }
    const schema = propSchema(p.type);
    ctl = buildControls(schema, p, (k, v) => commitProp(p.pid, k, v), { compact: true });
    form.append(ctl.el);
  }

  function paintSpawn(d) {
    const list = (d.spawns || {})[target.team] || [], pair = list[target.slot];
    name.textContent = `spawn ${target.team}[${target.slot}]`;
    if (!pair) { kv('', 'no such slot'); return; }
    kv('at', `${pair[0]}, ${pair[1]}`);
    // The slot index IS the class: main.js index-matches spawns[team][i] to roster[team][i], so a
    // seat is not a pin and reordering seats redeploys the roster.
    kv('slot', `deploys roster[${target.team}][${target.slot}] — the index is the class`);
    const t = res && res.map && res.map.at(pair[0], pair[1]);
    if (t) kv('ground', `${t.h}h ${t.t}${t.walk ? '' : ' · NOT WALKABLE'}`);
    const schema = normalizeSchema([{ k: 'x', type: 'number', min: 0, max: d.size.w - 1 }, { k: 'z', type: 'number', min: 0, max: d.size.d - 1 }]);
    ctl = buildControls(schema, { x: pair[0], z: pair[1] }, (k, v, all) => {
      if (ctx.session) ctx.session.edit('move spawn', (tx) => tx.setSpawn(target.team, target.slot, all.x | 0, all.z | 0));
    }, { compact: true });
    form.append(ctl.el);
  }

  function paintTile(d) {
    const { x, z } = target;
    name.textContent = `tile ${x},${z}`;
    const t = res && res.map && res.map.at(x, z);
    if (!t) { kv('', 'off the board'); return; }
    const L = LETTERS[d.grid.T[z][x]] || null;
    kv('height', `${t.h}h  (y ${(t.h * 0.25).toFixed(2)})`);
    kv('surface', `${d.grid.T[z][x]} — ${L ? L.label : 'unknown letter: dirt fallback, earthsong falls back to grass'}`);
    kv('flags', [t.walk ? 'walk' : 'blocked', t.water ? 'water' : '', t.void ? 'void' : '', t.deck ? 'deck' : ''].filter(Boolean).join(' · '));
    if (L && L.earthsong) kv('earthsong', L.earthsong);
    const f = res && res.field, i = res && res.graph ? res.graph.idx(x, z) : -1;
    if (f && i >= 0) {
      const c = f.minClimb[i];
      kv('reached by', c === -1 ? 'no class in the roster' : c >= NO_EDGE ? 'ignore_height classes only' : `${c}h — JUMP ${climbToJump(c)} or better`);
      if (f.minTurns[i] >= 0) kv('turns', `${f.minTurns[i]} from the origin, at that tier's slowest MOVE`);
    }
  }

  function paintDesign(d) {
    const spec = DESIGN_SPEC[target.kind], list = ((d.design || {})[spec.list]) || [];
    const index = target.index != null ? target.index : list.findIndex((r) => r && spec.id && r[spec.id] === target.id);
    const rec = list[index];
    name.textContent = `${spec.label.toLowerCase()} ${(rec && spec.id && rec[spec.id]) || `#${index}`}`;
    if (!rec) { kv('', 'no such record'); return; }
    if (Array.isArray(rec.tiles)) kv('tiles', `${rec.tiles.length} tile(s)`);
    if (Array.isArray(rec.via)) kv('via', `${rec.via.length} waypoint(s)`);
    // The measured truth beside the claim: a declared face that classify.js never discovered is a
    // decoration, and a choke whose sealProof failed is the finding the Issues panel is shouting about.
    if (target.kind === 'face' && res && res.shortcuts) {
      const m = res.shortcuts.find((s) => rec.from && s.from[0] === rec.from[0] && s.from[1] === rec.from[1] && s.to[0] === rec.to[0] && s.to[1] === rec.to[1]);
      kv('measured', m ? `${m.need}h · JUMP ${num(m.jump)} · ${m.kind} · +${num(m.routeGain)} steps / +${num(m.maxTurnGain)} turns` : 'NOT a face on this terrain (phantom)');
    }
    if (target.kind === 'choke' && res && res.seals) {
      const s = res.seals.find((q) => q.cid === rec.cid);
      if (s) kv('seal', s.sealed ? (s.vacuous ? 'vacuous — the spawns were already severed at this tier' : `holds: deleting ${s.tiles} tile(s) severs A from B at ${num(s.climb)}h`) : `LEAKS past ${JSON.stringify(s.leak)} in ${num(s.steps)} steps`);
    }
    const schema = normalizeSchema(spec.fields.map((f) => ({ ...f, def: f.type === 'text' ? '' : f.type === 'enum' ? f.options[0].v : 0 })));
    const vals = {};
    for (const f of spec.fields) { const v = rd(rec, f.k); if (v !== undefined && v !== null) vals[f.k] = v; }
    ctl = buildControls(schema, vals, (k, v) => commitDesign(target.kind, index, k, v), { compact: true });
    form.append(ctl.el);
  }

  go.addEventListener('click', () => {
    const d = doc(); if (!target || !flyTo || !d) return;
    if (target.kind === 'tile') return flyTo(target.x, target.z);
    if (target.kind === 'prop') { const p = (d.props || []).find((q) => q.pid === target.pid); if (p) flyTo(Math.floor(p.x), Math.floor(p.z)); return; }
    if (target.kind === 'spawn') { const s = ((d.spawns || {})[target.team] || [])[target.slot]; if (s) flyTo(s[0], s[1]); return; }
    const spec = DESIGN_SPEC[target.kind];
    if (!spec) return;
    const rec = ((d.design || {})[spec.list] || [])[target.index] || null;
    const at = rec && (rec.from && Array.isArray(rec.from) ? rec.from : (rec.tiles || rec.via || [])[0] || (rec.rect ? [rec.rect[0], rec.rect[1]] : null));
    if (at) flyTo(at[0], at[1]);
  });
  del.addEventListener('click', remove);

  const update = (r) => { res = r; paint(); };
  const api = { el: root, select, get target() { return target; }, update,
    destroy: () => { if (off) off(); if (ctl) ctl.destroy(); root.remove(); } };
  paint();
  const off = svc ? svc.subscribe(update) : null;
  // The picking layer names what the pointer hit; main.js has no inspector of its own, so this panel
  // publishes its own selector on the context for the tools that want to drive it.
  if (ctx && !ctx.inspector) ctx.inspector = api;
  return api;
}

export const INSPECTOR_PANEL = has('panel.inspector') ? byId('panel.inspector')
  : definePanel({ id: 'panel.inspector', label: 'Inspector', group: 'analysis', order: 5, mount: mountInspectorPanel });
