// THE ISSUES PANEL (PLAN §6.9). validateDef's findings, filtered by severity, anchored to a tile the
// camera flies to, and — for the third of them that carry one — an Apply Fix wired to the finding's
// own `fix.apply(def)` closure.
//
// WHY THE CLOSURE AND NOT A CODE TABLE. Every fix validate.js emits is PURE (clones, never mutates)
// and IDEMPOTENT, and it was written next to the check that found the problem, by the person who
// knows what "correct" means for that code. A panel that re-derived the repair from the code string
// would be a second, drifting implementation of thirty repairs. So this file knows nothing about any
// individual code: it calls `fix.apply` and puts the returned document through the session.
//
// A FIX IS ONE TRANSACTION AND ONE UNDO ENTRY. `fix.apply` returns a WHOLE new document, so the write
// is Tx.replaceDoc — which session.js seals as the only write in its transaction, precisely so a
// whole-document swap cannot be interleaved with cell writes and come apart on undo. Apply-all is
// therefore a fold: apply every fix to a working copy, then commit the result ONCE. Committing per
// fix would give an author twelve undo steps to walk back out of one button press.
//
// A STALE FIX IS A NO-OP, NOT A THROW (validate.js's own contract). So apply-all never aborts
// halfway; it reports how many findings actually moved the document.
import { definePanel, has, byId } from '../registry.js';
import { attach } from '../analysis.js';
import { hashDef } from '../../world/mapformat/serialize.js';

export function init(ctx) { attach(ctx); }

const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const SEVS = [['', 'all'], ['error', 'errors'], ['warn', 'warnings'], ['info', 'info']];
const CLS = { error: 'err', warn: 'warn', info: 'info' };
/** The tile a finding points at. validate.js writes `where` for tile-anchored codes and leaves the
 *  richer `at` for everything else; analysis findings only ever carry `at` as a bare [x,z] pair. */
function tileOf(i) {
  if (i.where && Number.isFinite(i.where.x)) return [i.where.x, i.where.z];
  const a = i.at;
  if (Array.isArray(a) && a.length >= 2) return [a[0], a[1]];
  if (a && Array.isArray(a.tile)) return [a.tile[0], a.tile[1]];
  if (a && Number.isFinite(a.x)) return [a.x, a.z];
  return null;
}

/**
 * @param {HTMLElement} host a `.ed-panel-body` or a `.ed-drawer-body`
 * @param {object} [ctx] main.js's plugin context: `session` to write fixes through, `toast`, and
 *   `analysis` (the shared service) for results and the camera fly. `count` is an optional
 *   `.ed-count` element this panel keeps in step with the findings.
 * @returns {{el:HTMLElement, update:(res:object)=>void, destroy:()=>void}}
 */
export function mountIssuesPanel(host, ctx = {}) {
  const svc = ctx.analysis && ctx.analysis.analysis ? ctx.analysis : null;
  const flyTo = ctx.flyTo || (svc ? svc.flyTo : null);
  const root = el('div', 'ed-issues');
  const bar = el('div', 'ed-field');
  const seg = el('div', 'ed-seg');
  const all = el('button', 'ed-btn', 'Apply all fixes');
  const list = el('div', 'ed-list');
  const head = el('div', 'ed-hint');
  let sev = '', issues = [], sel = null;
  for (const [k, label] of SEVS) {
    const b = el('button', null, label);
    b.addEventListener('click', () => { sev = k; paint(); });
    seg.append(b);
  }
  bar.append(seg);
  const actions = el('div', 'ed-field'); actions.append(all);
  root.append(head, bar, actions, list);
  host.append(root);

  const say = (m, k) => { if (ctx.toast) ctx.toast(m, k); else console.log('[issues]', m); };

  /** Fold every listed fix onto one working copy, commit once. Order-independent by construction:
   *  validate.js's fixes are idempotent and each addresses its own tile/prop/field. */
  function applyAll() {
    const s = ctx.session, fixes = shown().filter((i) => i.fix);
    if (!s || !fixes.length) return say(fixes.length ? 'no session to write to' : 'nothing here carries a fix', 'warn');
    let next = s.doc, n = 0;
    for (const i of fixes) {
      const before = hashDef(next);
      try { next = i.fix.apply(next); } catch (e) { console.error('[issues] fix threw', i.code, e); continue; }
      if (hashDef(next) !== before) n++;
    }
    if (!n) return say('every fix here was already applied', 'warn');
    s.edit(`fix ${n} finding(s)`, (tx) => tx.replaceDoc(next));
    say(`applied ${n} of ${fixes.length} fix(es)`, 'ok');
  }
  function applyOne(i) {
    const s = ctx.session;
    if (!s || !i.fix) return;
    let next;
    try { next = i.fix.apply(s.doc); } catch (e) { console.error('[issues] fix threw', i.code, e); return say(`${i.code}: the fix threw`, 'err'); }
    if (hashDef(next) === s.hash()) return say(`${i.code}: already fixed`, 'warn');
    s.edit(i.fix.label || `fix ${i.code}`, (tx) => tx.replaceDoc(next));
    say(i.fix.label || `fixed ${i.code}`, 'ok');
  }
  const shown = () => issues.filter((i) => !sev || i.severity === sev);

  function paint() {
    list.textContent = '';
    for (const b of seg.children) b.classList.toggle('on', b.textContent === (SEVS.find(([k]) => k === sev) || SEVS[0])[1]);
    const rows = shown();
    all.disabled = !rows.some((i) => i.fix) || !ctx.session;
    if (ctx.count) ctx.count.textContent = `${issues.filter((i) => i.severity === 'error').length}e ${issues.filter((i) => i.severity === 'warn').length}w`;
    for (const i of rows) {
      const row = el('div', 'ed-row ' + (CLS[i.severity] || 'info'));
      const tile = tileOf(i);
      row.append(el('span', 'code', i.code + (tile ? ` @ ${tile[0]},${tile[1]}` : '')));
      row.append(el('span', 'msg', i.msg));
      if (i.fix) {
        const f = el('span', 'fix', i.fix.label || 'Apply fix');
        // stopPropagation, or the row's own click flies the camera at the same moment the document
        // is swapped and the author watches the map jump for a reason they did not ask for.
        f.addEventListener('click', (e) => { e.stopPropagation(); applyOne(i); });
        row.append(f);
      }
      if (sel === i) row.classList.add('sel');
      row.addEventListener('click', () => {
        sel = i;
        for (const o of list.children) o.classList.remove('sel');
        row.classList.add('sel');
        if (tile && flyTo) flyTo(tile[0], tile[1]);
        if (ctx.onSelect) ctx.onSelect(i);
      });
      list.append(row);
    }
    if (!rows.length) list.append(el('div', 'ed-hint', issues.length ? 'nothing at this severity' : 'no findings — the map validates clean'));
  }

  function update(res) {
    const v = res && res.validation;
    issues = v ? v.issues.slice() : [];
    // Errors first, then warnings, then info; within a severity, keep validate.js's own emission
    // order, which is grid order and therefore reads down the board rather than at random.
    const rank = { error: 0, warn: 1, info: 2 };
    issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
    const caps = v && v.stats && Object.keys(v.stats.capped || {}).length;
    head.textContent = v
      ? `${v.errors.length} error(s), ${v.warnings.length} warning(s), ${v.infos.length} info${caps ? ' · some codes capped at 16 findings' : ''}${res.failed ? ` · analysis step '${res.failed}' failed: ${res.error}` : ''}`
      : 'no analysis yet';
    sel = null;
    paint();
  }
  all.addEventListener('click', applyAll);
  update(null);
  const off = svc ? svc.subscribe(update) : null;
  return { el: root, update, destroy: () => { if (off) off(); root.remove(); } };
}

export const ISSUES_PANEL = has('panel.issues') ? byId('panel.issues')
  : definePanel({ id: 'panel.issues', label: 'Issues', group: 'analysis', order: 30, mount: mountIssuesPanel });
