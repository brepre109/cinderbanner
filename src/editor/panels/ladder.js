// THE TIER LADDER PANEL (PLAN §6.9). One row per tier, in TURNS first and steps second, because
// turns are the unit a player feels and steps are the unit that produced them.
//
// THE BAR IS THE POINT. A column of numbers that reads 3, 3, 2, 2 tells you nothing at a glance; the
// same numbers as bars of falling length tell you instantly whether JUMP buys anything on this map.
// Bars are drawn against the BASE row, so the base tier is always full-width and every shorter bar
// is literally the saving. A ladder whose bars are all the same length is a map that does not reward
// verticality — validate.js says so as `ladder.flat`, and this panel shows it before you read that.
//
// RED IS A BROKEN PROMISE, NOT A SLOW ROW. A tier being slow is a design choice; a tier being slower
// than the map's own declared `savesTurns` is a contract failure, so `.ed-meter.bad` is reserved for
// verifyPromises() saying no. The self-check row (ladder.violations) is separate and louder: it
// means jumpgraph's need[] is wrong, which is a code bug, not a map bug.
import { definePanel, has, byId } from '../registry.js';
import { attach } from '../analysis.js';
import { climbToJump } from '../../world/jumpgraph.js';

/** main.js's plugin hook. The FIRST panel module to run latches the shared analysis service onto the
 *  editor context; the other three get the same object back. */
export function init(ctx) { attach(ctx); }

const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const num = (v) => (v === Infinity ? '∞' : v === -Infinity ? '-∞' : v == null || Number.isNaN(v) ? '–' : String(v));
const pct = (f) => `${Math.round((f || 0) * 100)}%`;
const td = (row, txt, cls) => { const c = el('td', cls, txt); row.append(c); return c; };

/**
 * @param {HTMLElement} host a `.ed-panel-body`
 * @param {object} [ctx] main.js's plugin context (or `{}` in a harness). `ctx.analysis` — the service
 *   attach() latched on — supplies results, the camera fly and the overlay handle.
 * @returns {{el:HTMLElement, update:(res:object)=>void, destroy:()=>void}}
 */
export function mountLadderPanel(host, ctx = {}) {
  const svc = ctx.analysis && ctx.analysis.analysis ? ctx.analysis : null;
  const flyTo = ctx.flyTo || (svc ? svc.flyTo : null);
  const root = el('div', 'ed-ladder');
  const view = overlayControls(svc);
  const head = el('div', 'ed-hint');
  const table = el('table', 'ed-table');
  const thead = el('thead'), hr = el('tr');
  // Six columns in a 312px dock: .ed-table cells are `white-space:nowrap`, so a header one word too
  // long pushes `area` off the edge rather than wrapping. Hence 'Δ' for the bar and a narrow meter.
  for (const [h, cls] of [['tier', ''], ['J', 'num'], ['turns', 'num'], ['steps', 'num'], ['Δ', ''], ['area', 'num']]) hr.append(el('th', cls, h));
  thead.append(hr);
  const tbody = el('tbody');
  table.append(thead, tbody);
  const prom = el('div', 'ed-list'), drops = el('div'), warn = el('div');
  root.append(view, head, table, warn, prom, drops);
  host.append(root);
  let sel = null;

  function update(res) {
    tbody.textContent = ''; prom.textContent = ''; drops.textContent = ''; warn.textContent = '';
    const lad = res && res.ladder;
    if (!lad) { head.textContent = 'no analysis yet'; return; }
    const base = lad.rows[0];
    head.textContent = `base ${lad.baseClimb}h (JUMP ${climbToJump(lad.baseClimb)}) · ${lad.walkable} walkable tiles · turns = ceil((steps−1)/MOVE) at the SLOWEST class that can take the tier`;
    // A promise is stated per tier, so index them by tier once and let the row look itself up.
    const bad = new Map();
    for (const p of (res.promises || [])) if (!p.ok) bad.set(p.tier, p);
    const worst = Math.max(1, ...lad.rows.map((r) => (Number.isFinite(r.turnsBySlowest) ? r.turnsBySlowest : 0)));
    for (const r of lad.rows) {
      const tr = el('tr');
      td(tr, num(r.tier) + 'h');
      td(tr, num(r.jump), 'num');
      td(tr, num(r.turnsBySlowest), 'num');
      td(tr, num(r.steps), 'num');
      const cell = td(tr, '');
      const m = el('div', 'ed-meter ' + (bad.has(r.tier) ? 'bad' : 'ct')), i = el('i');
      m.style.minWidth = '34px';
      // Severed rows get a full RED bar rather than an empty one: "cannot walk it at all" must not
      // render as "walks it in zero turns", which is what a 0-width bar would say.
      const frac = Number.isFinite(r.turnsBySlowest) ? r.turnsBySlowest / worst : 1;
      i.style.width = `${Math.max(3, Math.round(frac * 100))}%`;
      if (!r.connected) m.classList.add('bad');
      m.append(i); m.title = r.connected ? `${num(r.turnsBySlowest)} turns at MOVE ${r.slowestMove}, ${num(r.turnsByFastest)} at MOVE ${r.fastestMove}` : 'A and B are severed at this tier';
      cell.append(m);
      td(tr, pct(r.areaFrac), 'num').title = `${r.area} of ${lad.walkable} walkable tiles`;
      if (sel === r.tier) tr.classList.add('sel');
      tr.addEventListener('click', () => {
        sel = r.tier;
        for (const o of tbody.children) o.classList.remove('sel');
        tr.classList.add('sel');
        if (ctx.onPickTier) ctx.onPickTier(r.climb);
        // Flying to the MIDDLE of the tier's own route is the fastest way to see WHY the row is the
        // length it is — the camera lands on the road the number was measured along.
        const mid = r.routeTiles && r.routeTiles.length ? r.routeTiles[r.routeTiles.length >> 1] : null;
        if (flyTo && mid) flyTo(mid[0], mid[1]);
      });
      tbody.append(tr);
    }
    if (!lad.monotone) {
      const b = el('div', 'ed-row err');
      b.append(el('span', 'code', 'ladder.not-monotone'), el('span', 'msg',
        `${lad.violations.map((v) => `${num(v.fromTier)}h→${num(v.toTier)}h got worse (${num(v.from)}→${num(v.to)})`).join('; ')} — tier subgraphs are nested by construction, so this is a bug in jumpgraph need[], not in the map`));
      warn.append(b);
    }
    for (const dr of (lad.drops || [])) {
      const via = dr.viaEdges.length ? dr.viaEdges.map((e) => `${e.from[0]},${e.from[1]}→${e.to[0]},${e.to[1]} ${e.need}h`).join(', ') : 'no new edge on the path';
      const line = el('div', 'ed-hint', `↓ ${num(dr.fromTier)}h→${num(dr.toTier)}h saves ${num(dr.dSteps)} steps / ${num(dr.dTurns)} turns via ${via}`);
      if (flyTo && dr.viaEdges.length) { line.style.cursor = 'pointer'; line.addEventListener('click', () => flyTo(dr.viaEdges[0].from[0], dr.viaEdges[0].from[1])); }
      drops.append(line);
    }
    const ps = res.promises || [];
    if (ps.length) prom.append(el('div', 'ed-hint', `PROMISES · ${ps.filter((p) => p.ok).length}/${ps.length} kept`));
    for (const p of ps) {
      const row = el('div', 'ed-row ' + (p.ok ? 'info' : 'err'));
      row.append(el('span', 'code', `${num(p.tier)}h · MOVE ${p.move}`),
        el('span', 'msg', p.why || `saves ${num(p.measuredTurns)} turns, ${num(p.requiredTurns)} required (base ${num(p.baseSteps)} steps → ${num(p.tierSteps)})${p.ok ? '' : ` — short by ${num(-p.margin)}`}`));
      prom.append(row);
    }
  }
  update(null);
  // The panel drives itself: main.js mounts panels and throws the handle away, so a panel that waited
  // to be fed would sit blank for the life of the editor.
  const off = svc ? svc.subscribe(update) : null;
  return { el: root, update, destroy: () => { if (off) off(); root.remove(); } };
}

// The heatmap lives on THIS panel because the heatmap and the ladder are the same statement in two
// media: the rows say how many turns a tier saves, the tint says which ground it buys.
//
// LABELS ARE SHORT AND THE ROWS WRAP because the dock is 312px and editor.css's .ed-field is a
// non-wrapping flex row — five checkboxes and a four-way segment on one line clip the last of each,
// and a control you cannot see is a control that does not exist.
function overlayControls(svc) {
  const wrap = el('div');
  const ov = () => (svc ? svc.overlays : null);
  const seg = el('div', 'ed-seg');
  for (const [m, label] of [['off', 'off'], ['tier', 'tier'], ['reach', 'one'], ['split', 'A|B']]) {
    const b = el('button', null, label);
    b.title = m === 'reach' ? 'reach of the first compare profile' : m === 'split' ? 'split tile: profile A / profile B' : m;
    b.addEventListener('click', () => { const o = ov(); if (!o) return; o.setMode(m); for (const q of seg.children) q.classList.toggle('on', q === b); });
    if (m === 'tier') b.classList.add('on');
    seg.append(b);
  }
  const f = el('div', 'ed-field'); f.append(el('label', null, 'MAP'), seg);
  const layers = el('div', 'ed-field'); layers.style.flexWrap = 'wrap';
  for (const k of ['edges', 'shortcuts', 'seals', 'props', 'routes']) {
    const lab = el('label', 'ed-check'), box = document.createElement('input');
    box.type = 'checkbox'; box.checked = true;
    box.addEventListener('change', () => { const o = ov(); if (o) o.setLayer(k, box.checked); });
    lab.append(box, el('span', null, k)); layers.append(lab);
  }
  wrap.append(f, layers);
  return wrap;
}

/** Registry record, so the dock can list this panel without importing it by name. `has` guards a
 *  double import (a harness plus main.js), which define() would otherwise refuse at module load. */
export const LADDER_PANEL = has('panel.ladder') ? byId('panel.ladder')
  : definePanel({ id: 'panel.ladder', label: 'Tier ladder', group: 'analysis', order: 10, mount: mountLadderPanel });
