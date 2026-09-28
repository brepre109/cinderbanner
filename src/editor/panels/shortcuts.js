// THE SHORTCUT TABLE (PLAN §6.9). Every edge the base tier cannot take, priced and labelled.
//
// The panel is 312px wide and the interesting data is five-dimensional (where, how steep, what kind,
// steps saved, turns saved PER PROFILE), so the layout is deliberately split: five columns of the
// numbers you sort on, and a detail block under the selection for the per-profile turn savings,
// which is the one axis that genuinely needs a row each. Cramming eight profile columns into 312px
// would produce a table nobody can read and a horizontal scrollbar nobody finds.
//
// THE HEADER CARRIES THE CAVEAT, not a footnote. classify.js prices each edge against the base-tier
// route with TWO floods, which undervalues two high edges taken in series. That is a real limit of a
// real number and a designer who does not know it will mistrust the panel the first time the ladder
// disagrees; so it is printed where the numbers are, and the ladder panel is named as the exact one.
import { definePanel, has, byId } from '../registry.js';
import { attach } from '../analysis.js';
import { EXPRESS_STEPS, EXPRESS_TURNS } from '../../world/analysis/classify.js';

export function init(ctx) { attach(ctx); }
import { PROFILES } from '../../world/analysis/profiles.js';

const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const num = (v) => (v === Infinity ? '∞' : v == null || Number.isNaN(v) ? '–' : String(v));
/** Column set. `get` is the sort key AND the cell, so a column cannot sort by one and print another. */
// h and J are the same fact twice (J = ceil(h / HEIGHT_STEP)), so they share one column: five columns
// fit the 312px dock and six do not, and a clipped '+turns' header is worse than a compact 'need'.
const COLS = [
  { k: 'at', h: 'at', get: (s) => `${s.x},${s.z}${s.dir}`, sort: (s) => s.z * 1000 + s.x, cls: '' },
  { k: 'need', h: 'need', get: (s) => `${s.need}h/J${num(s.jump)}`, sort: (s) => s.need, cls: 'num' },
  { k: 'kind', h: 'kind', get: (s) => (s.kind === 'gate' ? `gate(${s.cutSize})` : s.kind), sort: (s) => ['gate', 'express', 'local', 'trap', 'cosmetic'].indexOf(s.kind), cls: '' },
  { k: 'gain', h: '+st', get: (s) => num(s.routeGain), sort: (s) => s.routeGain, cls: 'num' },
  { k: 'turns', h: '+t', get: (s) => num(s.maxTurnGain), sort: (s) => s.maxTurnGain, cls: 'num' },
];
const CHIP = { gate: 'err', express: 'tier', local: 'info', trap: 'warn', cosmetic: '' };
// Infinity - Infinity is NaN and a NaN comparator makes the sort order depend on the engine, which
// is exactly how a "sorted" table stops being reproducible between two runs of the same map.
const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);

/**
 * @param {HTMLElement} host a `.ed-panel-body`
 * @param {object} [ctx] main.js's plugin context; `ctx.analysis` is the shared service.
 * @returns {{el:HTMLElement, update:(res:object)=>void, destroy:()=>void}}
 */
export function mountShortcutsPanel(host, ctx = {}) {
  const svc = ctx.analysis && ctx.analysis.analysis ? ctx.analysis : null;
  const flyTo = ctx.flyTo || (svc ? svc.flyTo : null);
  const root = el('div', 'ed-shortcuts');
  const head = el('div', 'ed-hint');
  const filter = el('div', 'ed-seg');
  const table = el('table', 'ed-table'), thead = el('thead'), hr = el('tr'), tbody = el('tbody');
  const detail = el('div', 'ed-kv');
  let sortK = 'turns', desc = true, kindFilter = '', rows = [], sel = null;
  for (const c of COLS) {
    const th = el('th', c.cls, c.h);
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => { if (sortK === c.k) desc = !desc; else { sortK = c.k; desc = true; } paint(); });
    hr.append(th);
  }
  for (const k of ['', 'gate', 'express', 'local', 'trap']) {
    const b = el('button', null, k === 'express' ? 'expr' : k || 'all');
    b.dataset.kind = k;
    b.addEventListener('click', () => { kindFilter = k; paint(); });
    filter.append(b);
  }
  thead.append(hr); table.append(thead, tbody);
  root.append(head, filter, table, detail);
  host.append(root);

  function paint() {
    tbody.textContent = '';
    for (const b of filter.children) b.classList.toggle('on', b.dataset.kind === kindFilter);
    const col = COLS.find((c) => c.k === sortK) || COLS[COLS.length - 1];
    const list = rows.filter((s) => !kindFilter || s.kind === kindFilter)
      .slice().sort((p, q) => (desc ? cmp(col.sort(q), col.sort(p)) : cmp(col.sort(p), col.sort(q))) || cmp(q.need, p.need));
    for (const s of list) {
      const tr = el('tr');
      for (const c of COLS) {
        const cell = el('td', c.cls, c.get(s));
        if (c.k === 'kind') { cell.textContent = ''; const ch = el('span', 'ed-chip ' + (CHIP[s.kind] || ''), c.get(s)); cell.append(ch); }
        tr.append(cell);
      }
      if (sel && sel.a === s.a && sel.dir === s.dir) tr.classList.add('sel');
      tr.addEventListener('click', () => { sel = s; paint(); showDetail(s); if (ctx.onSelect) ctx.onSelect(s); if (flyTo) flyTo(s.hi[0], s.hi[1]); });
      tbody.append(tr);
    }
    if (!list.length) { const tr = el('tr'); tr.append(el('td', 'ed-muted', rows.length ? 'no edge of that kind' : 'no edge above the base tier')); tbody.append(tr); }
    showDetail(sel && list.includes(sel) ? sel : null);
  }

  function showDetail(s) {
    detail.textContent = '';
    if (!s) return;
    const kv = (k, v) => { detail.append(el('span', 'k', k), el('span', 'v', v)); };
    kv('edge', `${s.from[0]},${s.from[1]} → ${s.to[0]},${s.to[1]}`);
    kv('demands', `${s.need}h — JUMP ${num(s.jump)} or better`);
    kv('detour', `${num(s.localDetour)} steps the long way round locally; A→B is ${num(s.D0)} → ${num(s.dShort)}`);
    if (s.fallDamage) kv('fall', 'over the knockback threshold: a unit knocked down this takes fall damage');
    if (s.strands) kv('strands', 'sole connector AND a fall drop — a unit knocked off cannot climb back');
    // Turn saving per profile, which is the axis the columns cannot hold. A profile is a (climb,
    // water) bucket of the LIVE roster, so the class list is the real answer to "who does this help".
    for (const p of PROFILES) {
      if (!(p.id in s.turnGain)) continue;
      const v = s.turnGain[p.id];
      detail.append(el('span', 'k', p.id), el('span', 'v', `${v > 0 ? '−' : ''}${num(Math.abs(v))} turn${Math.abs(v) === 1 ? '' : 's'} · MOVE ${p.move} · ${p.classes.slice(0, 4).join(', ')}${p.classes.length > 4 ? '…' : ''}`));
    }
  }

  function update(res) {
    rows = (res && res.shortcuts) || [];
    const g = rows.filter((s) => s.kind === 'gate').length, e = rows.filter((s) => s.kind === 'express').length;
    head.textContent = rows.length
      ? `${rows.length} edge(s) above ${res.ctx.baseClimb}h · ${g} gate, ${e} express (≥${EXPRESS_STEPS} steps or ≥${EXPRESS_TURNS} turns) · single-edge ESTIMATE: two high edges in series are undervalued, the tier ladder is exact`
      : 'no edge above the base tier — every class walks the same board';
    sel = null;
    paint();
  }
  update(null);
  const off = svc ? svc.subscribe(update) : null;
  return { el: root, update, destroy: () => { if (off) off(); root.remove(); } };
}

export const SHORTCUTS_PANEL = has('panel.shortcuts') ? byId('panel.shortcuts')
  : definePanel({ id: 'panel.shortcuts', label: 'Shortcuts', group: 'analysis', order: 20, mount: mountShortcutsPanel });
