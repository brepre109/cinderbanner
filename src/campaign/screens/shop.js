// Town shop (world map -> town -> Shop): the genre's Buy / Sell counter. The item list is filtered by category tabs
// (Left/Right or Q/E, or click), each row shows the icon, price and how many the company owns (chest + worn); the
// Fitting window beside it shows, for every soldier, whether they can wear the item and what it would change
// (green up / red down against what they wear now). Enter opens a quantity window; the chest is the save's shared
// inventory, and gear is put on in Formation -> Equip. Esc steps back; Esc on the counter leaves for the map.
import { nodeImg } from '../regions.js';
import { h, esc, win, menu, sfx, pushKeys, portraitEl, setScene } from '../kit.js';
import { loadSave, writeSave } from '../save.js';
import { TOWNS, TOWN_BY_ID, MAP_IMG } from '../data.js';
import { shopStock, shopNext, townOpen, newWares, markWaresSeen, waresSeen } from '../campaign.js';
import * as PR from '../progress.js';
import { ITEMS, SLOTS, canEquip, buyItem, sellItem, sellPrice, invCount, equippedCount, describe, typeName, usersOf, equipItem, itemValue } from '../../game/equipment.js';
import { fitText } from '../../ui/fit.js';
import { iconHtml } from '../icons.js';

const CATS = [{ id: 'all', label: 'All' }, { id: 'weapon', label: 'Weapon' }, { id: 'shield', label: 'Shield' }, { id: 'head', label: 'Head' }, { id: 'body', label: 'Body' }, { id: 'acc', label: 'Acc.' }];
const slotOf = (it) => (it.slot === 'shield' ? 'offhand' : it.slot);

export async function show(el, arg, { go }) {
  setScene('worldmap');
  const sv = loadSave();
  let town = TOWN_BY_ID[arg?.town] || TOWN_BY_ID[sv.at] || TOWNS[0];
  if (!town.shop || !townOpen(sv, town)) town = TOWNS[0];
  // R16 shop nudge: what is new on the shelf since the last visit is tagged in the list; the visit clears the map badge
  const visited = !!waresSeen(sv, town); const fresh = new Set(visited ? newWares(sv, town) : []); markWaresSeen(sv, town);
  sv.at = town.id; writeSave(sv, { backup: false });
  const shop = town.shop;
  el.innerHTML = `<div class="sh-bg" style="background-image:url(${nodeImg(town)});background-position:${(town.x / MAP_IMG.w) * 100}% ${(town.y / MAP_IMG.h) * 100}%"></div><div class="sh-shade"></div>
    <div class="k-hint sh-hint"></div>`;
  const hintEl = el.querySelector('.sh-hint');
  const HINTS = {
    cmd: '<kbd>&uarr;</kbd><kbd>&darr;</kbd>Select<kbd>Enter</kbd>Choose<kbd>Esc</kbd>Leave',
    list: '<kbd>&uarr;</kbd><kbd>&darr;</kbd>Item<kbd>&larr;</kbd><kbd>&rarr;</kbd>Category<kbd>Enter</kbd>{v}<kbd>Esc</kbd>Back',
    qty: '<kbd>&larr;</kbd><kbd>&rarr;</kbd>Quantity<kbd>Enter</kbd>Confirm<kbd>Esc</kbd>Cancel',
  };
  const hint = (m) => { hintEl.innerHTML = (HINTS[m] || '').replace('{v}', tab === 'sell' ? 'Sell' : 'Buy'); };

  const head = win(null, 'sh-head'); el.appendChild(head);
  const cmdW = win('Counter', 'sh-cmd'); el.appendChild(cmdW);
  const listW = win('Wares', 'sh-list'); el.appendChild(listW);
  const fitW = win('Fitting', 'sh-fit'); el.appendChild(fitW);
  const descW = win(null, 'sh-desc'); el.appendChild(descW);
  const save = () => writeSave(sv);

  const drawHead = () => {
    const b = head.querySelector('.k-body'); b.innerHTML = '';
    b.appendChild(portraitEl(PR.CLASSES[town.keeper || 'apothecary']?.sprite, 'k-portrait sm', 'S'));
    b.appendChild(h('div', 'sh-who', `<div class="sh-town">${esc(shop.name)} <span class="k-small k-dim">&middot; ${esc(town.name)}</span></div><div class="k-small sh-greet">&ldquo;${esc(shop.greet || 'Take a look.')}&rdquo;</div>`));
    b.appendChild(h('div', 'sh-florins', `<span class="k-small k-dim">Florins</span><b>${sv.florins.toLocaleString('en-US')}</b>`));
  };

  // ---- state ----
  let tab = 'buy'; let cat = 0; let mode = 'cmd'; let lm = null; let listSel = 0; let qty = null;
  const owned = (id) => invCount(sv, id) + equippedCount(sv, id);
  const ids = () => {
    const c = CATS[cat].id; const base = tab === 'buy' ? shopStock(sv, town) : Object.keys(sv.inventory || {}).filter((id) => invCount(sv, id) > 0 && ITEMS[id]);
    return base.filter((id) => c === 'all' || ITEMS[id].slot === c).sort((a, b) => (tab === 'sell' ? SLOTS.indexOf(slotOf(ITEMS[a])) - SLOTS.indexOf(slotOf(ITEMS[b])) : 0) || 0);
  };
  const catsHtml = () => `<div class="sh-cats">${CATS.map((c, i) => `<span class="sh-cat${i === cat ? ' on' : ''}" data-i="${i}">${c.label}</span>`).join('')}</div>`;
  const buildList = (keepSel = false) => {
    lm?.destroy(); lm = null;
    const body = listW.querySelector('.k-body'); body.innerHTML = catsHtml();
    listW.querySelector('.k-tab').textContent = tab === 'buy' ? 'Wares' : 'Your Chest';
    body.querySelectorAll('.sh-cat').forEach((e) => e.addEventListener('click', (ev) => { ev.stopPropagation(); setCat(+e.dataset.i); }));
    const list = h('div', 'sh-scroll'); body.appendChild(list);
    // R15: the list window shows whole rows only (with the row snap in shell.css no row is ever left half-drawn)
    requestAnimationFrame(() => { if (!list.isConnected) return; const row = list.querySelector('.k-item')?.offsetHeight || 38; const hh = list.clientHeight; if (hh > row) { list.style.flex = '0 0 auto'; list.style.height = `${Math.floor(hh / row) * row}px`; } });
    const L = ids();
    if (!L.length) {
      const nx = tab === 'buy' ? shopNext(sv, town) : null;
      list.innerHTML = `<div class="k-small k-dim sh-empty">${tab === 'buy' ? 'Nothing of that kind on the shelves.' : 'Nothing of that kind in the chest.'}${nx ? `<br>New stock after: ${esc(nx.needs.join(', '))}` : ''}</div>`;
      fit(null); desc(null); return;
    }
    const items = L.map((id) => { const it = ITEMS[id]; const price = tab === 'buy' ? it.price : sellPrice(id);
      const afford = tab === 'sell' || sv.florins >= price;
      return { id, html: `${iconHtml(id)}<span class="sh-in"><b>${esc(it.name)}${tab === 'buy' && fresh.has(id) ? '<i class="sh-new">New</i>' : ''}</b><small>${esc(typeName(it.type))}${it.tier ? ` &middot; T${it.tier}` : ''}</small></span>`,
        right: `<span class="sh-own">${tab === 'buy' ? `Own ${owned(id)}` : `&times;${invCount(sv, id)}`}</span><span class="sh-price${afford ? '' : ' no'}">${price.toLocaleString('en-US')}</span>`,
        enabled: afford, cls: 'sh-row' }; });
    if (!keepSel) listSel = 0;
    lm = menu(list, items, { keys: false, sel: Math.min(listSel, items.length - 1), cls: 'sh-items', onMove: (it, i) => { listSel = i; fit(it.id); desc(it.id); }, onPick: (it) => openQty(it.id) });
    if (mode !== 'list') lm.el.querySelector('.k-item.sel')?.classList.add('ghost');
    const nx = tab === 'buy' ? shopNext(sv, town) : null;
    if (nx && CATS[cat].id === 'all') list.appendChild(h('div', 'k-small k-dim sh-soon', `More stock after ${esc(nx.needs.join(', '))}.`));
  };
  const setCat = (i) => { cat = (i + CATS.length) % CATS.length; sfx('page'); if (mode === 'cmd') { mode = 'list'; cm.el.querySelector('.k-item.sel')?.classList.add('ghost'); hint('list'); } buildList(); };

  // ---- fitting: every soldier, can they wear it, what changes ----
  const fit = (id) => {
    const b = fitW.querySelector('.k-body'); b.innerHTML = '';
    if (!id) { b.innerHTML = '<div class="k-small k-dim sh-empty">Pick an item to see who can use it.</div>'; return; }
    const it = ITEMS[id]; const slot = slotOf(it);
    const party = new Set(sv.party); const recs = sv.roster.slice().sort((a, c) => (party.has(c.id) ? 1 : 0) - (party.has(a.id) ? 1 : 0));
    for (const r of recs) {
      const row = h('div', 'sh-fr'); row.appendChild(portraitEl(PR.CLASSES[r.cls]?.sprite, 'k-portrait sh-mini', r.name[0]));
      let right = '';
      const worn = SLOTS.some((s) => r.equip?.[s] === id);
      const ok = canEquip(r.cls, r.support, id, slot, slot === 'offhand' ? r.equip?.weapon : null);
      if (worn) right = '<span class="k-blue">Equipped</span>';
      else if (!ok) right = '<span class="k-dim">Cannot equip</span>';
      else {
        const e = { ...(r.equip || {}), [slot]: id }; const a = PR.recordStats(r), c = PR.recordStats(r, e);
        const ch = [['wp', 'WP'], ['range', 'Rng'], ['hp', 'HP'], ['mp', 'MP'], ['atk', 'Atk'], ['def', 'Def'], ['mag', 'Mag'], ['res', 'Res'], ['spd', 'Spd'], ['eva', 'Eva'], ['move', 'Mv'], ['jump', 'Jmp']]
          .filter(([k]) => c[k] !== a[k]).slice(0, 4).map(([k, l]) => `<span class="${c[k] > a[k] ? 'k-up' : 'k-dn'}">${l} ${c[k] > a[k] ? '+' : ''}${c[k] - a[k]}</span>`);
        right = ch.length ? ch.join(' ') : '<span class="k-dim">No change</span>';
      }
      row.appendChild(h('div', 'sh-fi', `<div class="sh-fn"><b>${esc(r.name)}</b><small>${esc(PR.className(r.cls))}${party.has(r.id) ? ' &middot; <i>Deployed</i>' : ''}</small></div><div class="sh-fd k-small">${right}</div>`));
      if (!ok && !worn) row.classList.add('no');
      b.appendChild(row);
    }
  };
  const desc = (id) => {
    const b = descW.querySelector('.k-body');
    if (!id) { b.innerHTML = `<span class="k-small k-dim">${tab === 'buy' ? 'Gear bought here goes to the company chest. Put it on in Formation &rarr; Equip.' : 'Sell for half the shop price. Worn gear must be taken off first.'}</span>`; return; }
    const it = ITEMS[id]; const users = usersOf(id).map((c) => PR.className(c));
    b.innerHTML = `<div class="sh-dn">${iconHtml(id, 'lg')}<div><div><b>${esc(it.name)}</b> <span class="k-small k-dim">${esc(typeName(it.type))}${it.rare ? ' &middot; <span class="k-gold">Relic</span>' : ''}</span></div>
      <div class="k-small">${esc(describe(id)) || 'No bonuses.'}</div><div class="k-small k-dim sh-users">${users.length > 8 ? `${users.slice(0, 8).map(esc).join(', ')} +${users.length - 8}` : users.map(esc).join(', ')}</div></div></div>`;
    fitText(b.querySelector('.sh-users'), { min: 0.78 });
  };

  // ---- quantity window ----
  const openQty = (id) => {
    const it = ITEMS[id]; const unit = tab === 'buy' ? it.price : sellPrice(id);
    const max = tab === 'buy' ? Math.min(99, Math.floor(sv.florins / unit)) : invCount(sv, id);
    if (max < 1) { sfx('buzz'); flash(tab === 'buy' ? 'Not enough florins.' : 'None to sell.'); return; }
    mode = 'qty'; hint('qty'); let n = 1;
    const w = win(tab === 'buy' ? 'Buy' : 'Sell', 'sh-qty'); el.appendChild(w);
    const draw = () => { w.querySelector('.k-body').innerHTML = `<div class="sh-qn">${iconHtml(id)}<b>${esc(it.name)}</b></div>
      <div class="sh-qrow"><span class="sh-arrow" data-d="-1">&#9664;</span><b class="sh-qv">${n}</b><span class="sh-arrow" data-d="1">&#9654;</span><span class="k-small k-dim">&times; ${unit.toLocaleString('en-US')}</span></div>
      <div class="sh-qtot"><span class="k-small k-dim">${tab === 'buy' ? 'Cost' : 'Paid'}</span><b class="k-gold">${(n * unit).toLocaleString('en-US')}</b></div>
      <div class="sh-qbtns"><span class="sh-btn ok">${tab === 'buy' ? 'Buy' : 'Sell'}</span><span class="sh-btn no">Cancel</span></div>`;
      w.querySelectorAll('.sh-arrow').forEach((a) => a.addEventListener('click', (e) => { e.stopPropagation(); adj(+a.dataset.d); }));
      w.querySelector('.ok').addEventListener('click', (e) => { e.stopPropagation(); confirm(); });
      w.querySelector('.no').addEventListener('click', (e) => { e.stopPropagation(); cancel(); }); };
    const adj = (d) => { const v = Math.max(1, Math.min(max, n + d)); if (v !== n) { n = v; sfx('cursor'); draw(); } };
    const done = () => { offQ(); w.remove(); qty = null; mode = 'list'; hint('list'); };
    const cancel = () => { sfx('cancel'); done(); };
    const confirm = () => {
      const ok = tab === 'buy' ? buyItem(sv, id, n) : sellItem(sv, id, n);
      if (!ok) { sfx('buzz'); return; }
      save(); sfx('confirm'); done(); drawHead(); buildList(true); lm?.set(Math.min(listSel, lm.items.length - 1));
      if (tab === 'buy' && openWear(id, n)) return;
      flash(`${tab === 'buy' ? 'Bought' : 'Sold'} ${n > 1 ? n + ' ' : ''}${it.name}${tab === 'buy' ? ' — it waits in the chest.' : ` for ${(n * unit).toLocaleString('en-US')} florins.`}`);
    };
    const offQ = pushKeys((k) => { if (k === 'left' || k === 'down') adj(-1); else if (k === 'right' || k === 'up') adj(1); else if (k === 'prev') adj(-10); else if (k === 'next') adj(10); else if (k === 'ok') confirm(); else if (k === 'back') cancel(); else return false; });
    qty = { cancel }; draw();
  };

  // ---- R15 (review15 P12): "Equip now?" after a purchase (the genre asks the same). Everyone who can wear the item and would
  // gain from it, deployed soldiers first, best gain first; picking one puts it on at once (their old piece goes to the
  // chest). With several bought the window stays up until they are all worn or the player keeps the rest.
  const openWear = (id, left) => {
    const it = ITEMS[id]; const slot = slotOf(it); const party = new Set(sv.party);
    const cands = () => sv.roster.filter((r) => !SLOTS.some((s) => r.equip?.[s] === id) || it.slot === 'acc')
      .filter((r) => canEquip(r.cls, r.support, id, slot, slot === 'offhand' ? r.equip?.weapon : null) && r.equip?.[slot] !== id)
      .map((r) => ({ r, gain: itemValue(r.cls, id, slot) - (r.equip?.[slot] ? itemValue(r.cls, r.equip[slot], slot) : 0) }))
      .filter((c) => c.gain > 0).sort((a, c) => (party.has(c.r.id) ? 1 : 0) - (party.has(a.r.id) ? 1 : 0) || c.gain - a.gain).slice(0, 5);
    if (!cands().length) return false;
    mode = 'qty'; hint('cmd'); const w = win('Equip now?', 'sh-qty sh-wear'); el.appendChild(w); let m = null;
    const close = (msg) => { offW(); m?.destroy(); w.remove(); qty = null; mode = 'list'; hint('list'); fit(id); drawHead(); if (msg) flash(msg); };
    const draw = () => {
      const list = cands(); if (!left || !list.length) return close(`${it.name}: ${left ? left + ' in the chest.' : 'worn.'}`);
      w.querySelector('.k-body').innerHTML = `<div class="sh-qn">${iconHtml(id)}<b>${esc(it.name)}</b></div><div class="k-small k-dim sh-wq">${left > 1 ? `${left} bought. ` : ''}Who wears it?</div><div class="sh-wl"></div>`;
      const items = list.map(({ r }) => { const e = { ...(r.equip || {}), [slot]: id }; const a = PR.recordStats(r), c = PR.recordStats(r, e);
        const ch = [['wp', 'WP'], ['hp', 'HP'], ['atk', 'Atk'], ['def', 'Def'], ['mag', 'Mag'], ['res', 'Res'], ['spd', 'Spd'], ['eva', 'Eva']].filter(([k]) => c[k] !== a[k]).slice(0, 2)
          .map(([k, l]) => `<span class="${c[k] > a[k] ? 'k-up' : 'k-dn'}">${l} ${c[k] > a[k] ? '+' : ''}${c[k] - a[k]}</span>`).join(' ');
        return { id: r.id, r, html: `<span class="sh-wn">${esc(r.name)}${party.has(r.id) ? '' : ' <small class="k-dim">bench</small>'}</span>`, right: ch }; });
      items.push({ id: '__keep', label: 'Keep in chest', sound: 'cancel' });
      m?.destroy(); m = menu(w.querySelector('.sh-wl'), items, { keys: false, cls: 'small', onPick: (x) => {
        if (x.id === '__keep') return close(`${it.name}${left > 1 ? ` x${left}` : ''} — in the chest.`);
        if (!equipItem(sv, x.r, slot, id)) { sfx('buzz'); return; }
        save(); sfx('confirm'); left--; flash(`${x.r.name} wears the ${it.name}.`); draw(); } });
    };
    const offW = pushKeys((k) => { if (!m) return false; if (k === 'up') m.move(-1); else if (k === 'down') m.move(1); else if (k === 'ok') m.pick(); else if (k === 'back') { sfx('cancel'); close(`${it.name} — in the chest.`); } else return false; });
    qty = { cancel: () => close(null) }; draw(); return true;
  };

  let toast = null;
  const flash = (msg) => { toast?.remove(); toast = win(null, 'fm-toast sh-toast', `<span class="k-small">${esc(msg)}</span>`); el.appendChild(toast); const t = toast; setTimeout(() => t.remove(), 1700); };

  // ---- counter commands ----
  const leave = () => { save(); mode = 'gone'; go('map', { focus: town.id }); };
  const cm = menu(cmdW.querySelector('.k-body'), [{ id: 'buy', label: 'Buy' }, { id: 'sell', label: 'Sell' }, { id: 'leave', label: 'Leave', sound: 'cancel' }], { keys: false,
    onMove: (it) => { if (mode !== 'cmd' || it.id === 'leave' || it.id === tab) return; tab = it.id; cat = 0; buildList(); desc(null); },
    onPick: (it) => { if (it.id === 'leave') return leave(); tab = it.id; if (!lm) { sfx('buzz'); buildList(); return; } mode = 'list'; hint('list'); cm.el.querySelector('.k-item.sel')?.classList.add('ghost'); lm.el.querySelectorAll('.k-item.ghost').forEach((e) => e.classList.remove('ghost')); lm.set(lm.sel); } });
  const toCmd = () => { mode = 'cmd'; hint('cmd'); cm.el.querySelectorAll('.ghost').forEach((e) => e.classList.remove('ghost')); lm?.el.querySelector('.k-item.sel')?.classList.add('ghost'); };
  const off = pushKeys((k) => {
    if (mode === 'cmd') { if (k === 'up') cm.move(-1); else if (k === 'down') cm.move(1); else if (k === 'ok' || k === 'right') cm.pick(); else if (k === 'back') { sfx('cancel'); leave(); } else if (k === 'next' || k === 'prev') setCat(cat + (k === 'next' ? 1 : -1)); else return false; return; }
    if (mode === 'list') { if (!lm) { if (k === 'back') { sfx('cancel'); toCmd(); } else if (k === 'left' || k === 'right' || k === 'prev' || k === 'next') setCat(cat + (k === 'right' || k === 'next' ? 1 : -1)); return; }
      if (k === 'up') lm.move(-1); else if (k === 'down') lm.move(1); else if (k === 'ok') lm.pick(); else if (k === 'back') { sfx('cancel'); toCmd(); }
      else if (k === 'left' || k === 'right' || k === 'prev' || k === 'next') setCat(cat + (k === 'right' || k === 'next' ? 1 : -1)); else return false; }
  });
  // mouse: hovering the list takes the focus there; right-click steps back like Esc
  listW.addEventListener('mouseenter', () => { if (mode === 'cmd' && lm) { mode = 'list'; hint('list'); cm.el.querySelector('.k-item.sel')?.classList.add('ghost'); lm.el.querySelectorAll('.k-item.ghost').forEach((e) => e.classList.remove('ghost')); } });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (mode === 'qty') qty?.cancel(); else if (mode === 'list') { sfx('cancel'); toCmd(); } });
  drawHead(); buildList(); desc(null); hint('cmd'); fit(ids()[0] || null);
  window.__SHELL__.shop = { town: town.id, get mode() { return mode; }, get tab() { return tab; } };
  return () => { off(); qty?.cancel?.(); cm.destroy(); lm?.destroy(); };
}
