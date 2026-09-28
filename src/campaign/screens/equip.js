// Equip window (Formation -> unit -> Equip): the genre's equipment screen. Left, the five slots with what is worn; below
// them, the company chest filtered to what fits the chosen slot; right, the unit's stats with a live compare column
// (green = better, red = worse) for whatever the cursor is on, the gear's traits, and the item's description.
// Keys: up/down select, Enter/right open a slot or wear the item, Esc/left back, Q/E previous/next unit.
// Mouse: hover selects, click picks, right-click steps back. Every change autosaves through `save()`.
import { h, esc, win, menu, sfx, pushKeys, portraitEl } from '../kit.js';
import * as PR from '../progress.js';
import { ITEMS, SLOTS, SLOT_NAME, canEquip, equipItem, unequip, optimize, itemValue, invCount, describe, typeName, fitEquip, ensureEquip } from '../../game/equipment.js';
import { iconHtml, slotGhost } from '../icons.js';

export const STAT_ROWS = [['hp', 'HP'], ['mp', 'MP'], ['atk', 'Atk'], ['def', 'Def'], ['mag', 'Mag'], ['res', 'Res'], ['spd', 'Spd'], ['eva', 'Eva'], ['move', 'Move'], ['jump', 'Jump'], ['wp', 'WP'], ['range', 'Range']];
const LOWER_BETTER = new Set(['weight']);
/** Compare grid html: `a` current stats, `b` candidate stats (or null for "no candidate"). */
export function compareHtml(a, b) {
  return `<div class="eq-cmp">${STAT_ROWS.map(([k, l]) => {
    const d = b ? b[k] - a[k] : 0; const cls = !d ? '' : (d > 0) !== LOWER_BETTER.has(k) ? 'up' : 'dn';
    return `<div class="c ${cls}"><span class="k">${l}</span><b class="v">${a[k]}</b>${b ? `<i class="ar">&#9654;</i><b class="n">${b[k]}</b>` : ''}</div>`;
  }).join('')}${a.weight || b?.weight ? `<div class="c ${b && b.weight !== a.weight ? (b.weight < a.weight ? 'up' : 'dn') : ''}"><span class="k">Weight</span><b class="v">${a.weight}</b>${b ? `<i class="ar">&#9654;</i><b class="n">${b.weight}</b>` : ''}</div>` : ''}</div>`;
}
/** Traits of a whole equip map (auto-statuses, immunities, elements) as short tags. */
export function traitsHtml(equip) {
  const tags = [];
  for (const s of SLOTS) { const it = ITEMS[equip?.[s]]; if (!it) continue;
    for (const a of it.auto || []) tags.push(`Auto-${a[0].toUpperCase()}${a.slice(1)}`);
    if (it.immune?.length) tags.push('Status ward'); for (const e of it.absorb || []) tags.push(`Drinks ${e}`); for (const e of it.strengthen || []) tags.push(`${e[0].toUpperCase()}${e.slice(1)} +25%`);
    if (it.onHit) tags.push(`${it.name}: ${it.onHit.status === 'unarmed' ? 'Disarm' : it.onHit.status[0].toUpperCase() + it.onHit.status.slice(1)} on hit`); }
  return [...new Set(tags)].map((t) => `<span class="eq-tag">${esc(t)}</span>`).join('');
}

/**
 * Open the equip window over `host` (the formation screen). opts: { sv, list (records to cycle), index, save(), onClose(r) }.
 * Returns a close function.
 */
export function openEquip(host, { sv, list, index = 0, save, onClose, onSwap }) {
  let i = Math.max(0, Math.min(list.length - 1, index)); let r = list[i];
  host.classList.add('equipping');
  const slotsW = win('Equipment', 'eq-slots'); const itemsW = win('Chest', 'eq-items'); const statW = win('Status', 'eq-stats');
  host.append(slotsW, itemsW, statW);
  let mode = 'slots'; let sm = null, im = null; let slotSel = 0; let itemIds = [];

  const head = () => {
    const b = statW.querySelector('.k-body'); b.innerHTML = '';
    const top = h('div', 'eq-top'); top.appendChild(portraitEl(PR.CLASSES[r.cls]?.sprite, 'k-portrait md', r.name[0]));
    top.appendChild(h('div', 'eq-id', `<div class="eq-name">${esc(r.name)}</div><div class="k-small">${esc(PR.className(r.cls))} &middot; Lv ${r.lvl}</div>
      <div class="k-small k-dim eq-sw">${list.length > 1 ? '<kbd>Q</kbd><kbd>E</kbd> Change unit' : ''}</div>`));
    b.appendChild(top); b.appendChild(h('div', 'eq-cmpwrap')); b.appendChild(h('div', 'eq-traits')); b.appendChild(h('div', 'eq-sum k-small')); b.appendChild(h('div', 'eq-desc k-small'));
  };
  const cur = () => PR.recordStats(r);
  const showCompare = (equip, desc) => {
    const a = cur(); const bStats = equip ? PR.recordStats(r, equip) : null;
    statW.querySelector('.eq-cmpwrap').innerHTML = compareHtml(a, bStats);
    statW.querySelector('.eq-traits').innerHTML = traitsHtml(equip || r.equip);
    statW.querySelector('.eq-desc').innerHTML = desc || '';
    // what each worn piece gives, one line per slot (the parchment under the numbers used to be empty)
    statW.querySelector('.eq-sum').innerHTML = SLOTS.filter((s) => r.equip[s]).map((s) => `<div class="ln">${iconHtml(r.equip[s], 'sm')}<b>${esc(ITEMS[r.equip[s]].name)}</b><span>${esc(describe(r.equip[s]))}</span></div>`).join('');
  };
  const itemDesc = (id) => { const it = ITEMS[id]; if (!it) return ''; return `<b>${esc(it.name)}</b> <span class="k-dim">${esc(typeName(it.type))}${it.rare ? ' &middot; <span class="k-gold">Relic</span>' : ''}</span><br>${esc(describe(id)) || 'No bonuses.'}`; };

  const slotRow = (s) => { const id = r.equip[s]; const it = ITEMS[id];
    return `${id ? iconHtml(id) : slotGhost(s)}<span class="eq-sl"><small>${SLOT_NAME[s]}</small><b class="${it ? '' : 'k-dim'}">${esc(it ? it.name : '—')}</b></span>`; };
  const buildSlots = () => {
    sm?.destroy(); ensureEquip(r);
    const items = SLOTS.map((s) => ({ id: s, html: slotRow(s), cls: 'eq-srow' }))
      .concat([{ id: '__opt', label: 'Optimize', cls: 'eq-act' }, { id: '__clear', label: 'Remove All', cls: 'eq-act' }]);
    sm = menu(slotsW.querySelector('.k-body'), items, { sel: slotSel, keys: false, cls: 'eq-slist', onMove: (it, k) => { slotSel = k; if (mode === 'slots') previewSlot(it.id); }, onPick: (it) => pickSlot(it.id) });
  };
  const previewSlot = (s) => {
    if (!SLOTS.includes(s)) fillItems(s, false);
    if (s === '__opt') { const sim = { inventory: { ...sv.inventory }, florins: 0 }; const rr = { ...r, equip: { ...r.equip } }; optimize(sim, rr); return showCompare(rr.equip, 'Wear the best piece the chest holds in every slot.'); }
    if (s === '__clear') return showCompare({ weapon: null, offhand: null, head: null, body: null, acc: null }, 'Return every piece to the chest.');
    showCompare(null, r.equip[s] ? itemDesc(r.equip[s]) : `<span class="k-dim">Nothing in the ${SLOT_NAME[s].toLowerCase()} slot.</span>`);
    fillItems(s, false);
  };
  const fits = (s) => Object.keys(sv.inventory || {}).filter((id) => invCount(sv, id) > 0 && canEquip(r.cls, r.support, id, s, s === 'offhand' ? r.equip.weapon : null))
    .sort((a, b) => itemValue(r.cls, b, s) - itemValue(r.cls, a, s) || ITEMS[a].name.localeCompare(ITEMS[b].name));
  const fillItems = (s, active) => {
    im?.destroy(); im = null; const body = itemsW.querySelector('.k-body'); body.innerHTML = '';
    if (!SLOTS.includes(s)) { itemsW.classList.add('idle'); itemsW.querySelector('.k-tab').textContent = 'Chest'; body.innerHTML = '<div class="k-small k-dim eq-none">Choose a slot to see what in the chest fits it.</div>'; return; }
    itemIds = fits(s); const rows = [];
    if (r.equip[s]) rows.push({ id: null, html: `<i class="k-ico empty"></i><span class="eq-in">Remove</span>`, cls: 'eq-irow' });
    for (const id of itemIds) rows.push({ id, html: `${iconHtml(id)}<span class="eq-in">${esc(ITEMS[id].name)}</span>`, right: `&times;${invCount(sv, id)}`, cls: 'eq-irow' });
    itemsW.querySelector('.k-tab').textContent = `Chest · ${SLOT_NAME[s]}`;
    itemsW.classList.toggle('idle', !active);
    if (!rows.length) { body.innerHTML = `<div class="k-small k-dim eq-none">Nothing in the chest fits this slot.<br>Buy more at a town shop.</div>`; return; }
    im = menu(body, rows, { keys: false, cls: 'eq-ilist', sel: 0, onMove: (it) => { if (mode !== 'items') return; const e = { ...r.equip, [s]: it.id }; if (s === 'weapon' && it.id && e.offhand && !canEquip(r.cls, r.support, e.offhand, 'offhand', it.id)) e.offhand = null; showCompare(e, it.id ? itemDesc(it.id) : 'Take it off and put it in the chest.'); },
      onPick: (it) => wear(s, it.id) });
    if (!active) im.el.querySelector('.k-item.sel')?.classList.remove('sel');
  };
  const pickSlot = (s) => {
    if (s === '__opt') { const n = optimize(sv, r); save(); sfx(n ? 'confirm' : 'buzz'); refresh(); return; }
    if (s === '__clear') { for (const x of SLOTS) if (ITEMS[r.equip[x]]?.boss !== r.name) unequip(sv, r, x); save(); refresh(); return; }   // QA #17: a soldier's own item stays on
    mode = 'items'; fillItems(s, true);
    if (!im) { sfx('buzz'); mode = 'slots'; return; }
    slotsW.classList.add('idle'); im.set(0);
  };
  const wear = (s, id) => {
    const ok = id == null ? unequip(sv, r, s) : equipItem(sv, r, s, id);
    if (!ok) { sfx('buzz'); return; }
    fitEquip(sv, r); save(); back();
  };
  const back = () => { mode = 'slots'; slotsW.classList.remove('idle'); refresh(); };
  const refresh = () => { head(); buildSlots(); sm.set(slotSel); };
  const swap = (d) => { if (list.length < 2) return; i = (i + d + list.length) % list.length; r = list[i]; onSwap?.(r); sfx('page'); mode = 'slots'; slotsW.classList.remove('idle'); refresh(); };
  const close = () => { off(); sm?.destroy(); im?.destroy(); slotsW.remove(); itemsW.remove(); statW.remove(); host.classList.remove('equipping'); host.removeEventListener('contextmenu', rc, true); onClose?.(r); };
  const off = pushKeys((k) => {
    const m = mode === 'items' ? im : sm; if (!m) return;
    if (k === 'up') m.move(-1); else if (k === 'down') m.move(1);
    else if (k === 'ok' || (k === 'right' && mode === 'slots')) m.pick();
    else if (k === 'back' || (k === 'left' && mode === 'items')) { sfx('cancel'); if (mode === 'items') back(); else close(); }
    else if (k === 'prev' || k === 'next') swap(k === 'next' ? 1 : -1);
    else return false;
  });
  const rc = (e) => { e.preventDefault(); e.stopPropagation(); sfx('cancel'); if (mode === 'items') back(); else close(); };
  host.addEventListener('contextmenu', rc, true);
  refresh();
  return close;
}
