// Chapter world map: the painted realm with battle nodes joined by inked roads, the company's banner-bearer standing
// where it last fought, a glove cursor, the node card, and the command window. Arrows hop between nodes spatially.
import { regionImg } from '../regions.js';
import { h, esc, win, menu, dialog, sfx, pushKeys, portraitEl, bodySprite, setScene, navigate, pageUrl } from '../kit.js';
import { loadSave, writeSave } from '../save.js';
import { BATTLES, NODE, TOWN, MAP_IMG, CHAPTERS, ROADS, CH2_PROLOGUE, chapterInfo } from '../data.js';
import { nodeState, visibleNodes, nextStory, enemiesFor, recLevel, beginBattle, hire, nextHire, chapterDone, partyRecords, visibleTowns, shopStock, shopNext, newWares, regionOf, visibleRoads, chapterPending, enterChapter } from '../campaign.js';
import { CLASSES, className } from '../progress.js';
import { openOptions } from '../options.js';

const pos = (n) => ({ x: (n.x / MAP_IMG.w) * 100, y: (n.y / MAP_IMG.h) * 100 });

export async function show(el, arg, { go }) {
  setScene('worldmap');
  let sv = loadSave();
  // R15 (review15 P8): a company that has won a field is past the first-turn Field Manual (Engage from the map skips
  // Formation, so the flag is set here too).
  if (sv && !sv.seen?.tutorial && Object.values(sv.cleared || {}).some(Boolean)) { sv.seen = { ...(sv.seen || {}), tutorial: 1 }; writeSave(sv, { backup: false }); }
  // Chapter II transition: Chapter I is won and the next chapter not yet entered -- a finale just played, or a save that
  // finished Chapter I before Chapter II existed. Card, then the new chapter's prologue, then its region.
  if (sv && chapterPending(sv)) {
    const was = chapterInfo(sv.chapter || 1), nx = chapterInfo((sv.chapter || 1) + 1);
    el.innerHTML = `<div style="position:absolute;inset:0;background:url(${regionImg(was.no)}) center/cover"></div><div class="wm-vig"></div>`;
    await dialog(`Chapter ${was.roman} Complete`, `${esc(was.name)} is fulfilled. Chapter ${nx.roman}, ${esc(nx.name)}, begins in ${esc(nx.region)}.`, [{ id: 'ok', label: 'Onward' }]);
    enterChapter(sv);
    return go('story', { battle: 'c1', lines: CH2_PROLOGUE, then: 'map', prologue: true, noSeen: true });
  }
  // Which painted region to show: an explicit arg (road travel), else where the banner stands, never past the save's chapter.
  const view = Math.min(sv.chapter || 1, arg?.region || regionOf(arg?.focus || sv.at));
  const CH = chapterInfo(view);
  el.innerHTML = `<div class="wm-stage"><div class="wm-map" style="background-image:url(${regionImg(view)})"></div><svg class="wm-roads" viewBox="0 0 ${MAP_IMG.w} ${MAP_IMG.h}" preserveAspectRatio="none"></svg><div class="wm-nodes"></div><div class="wm-vig"></div></div>
    <div class="k-hint wm-hint"><kbd>&larr;</kbd><kbd>&rarr;</kbd>Travel<kbd>Enter</kbd>Select<kbd>Esc</kbd>Menu</div>
    <div class="wm-legend k-small"><span><i class="lg story"></i>Story battle</span><span><i class="lg side"></i>Skirmish</span><span><i class="lg won"></i>Won</span><span><i class="lg town"></i>Town</span>${(sv.chapter || 1) >= 2 ? '<span><i class="lg road"></i>Road</span>' : ''}</div>`;
  const stage = el.querySelector('.wm-stage'), svg = el.querySelector('.wm-roads'), layer = el.querySelector('.wm-nodes');
  // cover, not contain: the parchment border is painted into the image, so a sliver of it cropping at odd aspects is fine
  const fit = () => { const k = Math.max(innerWidth / MAP_IMG.w, innerHeight / MAP_IMG.h);
    Object.assign(stage.style, { width: `${MAP_IMG.w * k}px`, height: `${MAP_IMG.h * k}px`, left: `${(innerWidth - MAP_IMG.w * k) / 2}px`, top: `${(innerHeight - MAP_IMG.h * k) / 2}px` }); };
  fit(); addEventListener('resize', fit);

  // ---- nodes & roads ----
  const nodes = [...visibleTowns(sv, view).map((t) => ({ ...t, kind: 'town' })), ...visibleRoads(sv, view).map((r) => ({ ...r, kind: 'road' })), ...visibleNodes(sv, view)];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const road = (a, b, fresh) => { const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; const dx = b.x - a.x, dy = b.y - a.y; const L = Math.hypot(dx, dy) || 1; const bend = Math.min(40, L * 0.12);
    const cx = mx - (dy / L) * bend, cy = my + (dx / L) * bend; return `<path class="road${fresh ? ' fresh' : ''}" d="M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}"/>`; };
  let roads = '';
  for (const n of nodes) for (const l of n.links || []) if (byId[l]) roads += road(byId[l], n, n.kind === 'story' && nodeState(sv, n) === 'open');
  svg.innerHTML = `<defs><filter id="ink"><feTurbulence baseFrequency="0.9" numOctaves="1" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="1.6"/></filter></defs>${roads}`;
  const els = nodes.map((n) => {
    const st = n.kind === 'town' ? 'town' : n.kind === 'road' ? 'road' : nodeState(sv, n); const p = pos(n);
    // R16 shop nudge: a town whose shelf has something the company has not seen there yet carries a 'New wares' flag
    const fresh = n.kind === 'town' && n.shop ? newWares(sv, n).length : 0;
    const e = h('div', `wm-node ${n.kind} ${st}${n.lbl ? ` lbl-${n.lbl}` : ''}${fresh ? ' fresh' : ''}`, `<i class="dot"></i><span class="lbl">${esc(n.name)}</span>${fresh ? '<span class="wm-new">New wares</span>' : ''}`);
    e.style.left = `${p.x}%`; e.style.top = `${p.y}%`; layer.appendChild(e);
    e.addEventListener('mouseenter', () => select(nodes.indexOf(n), true));
    e.addEventListener('click', (ev) => { ev.stopPropagation(); select(nodes.indexOf(n)); open(); });
    return e;
  });
  // ---- the banner-bearer token ----
  const tok = h('div', 'wm-token'); layer.appendChild(tok);
  const leader = partyRecords(sv)[0] || sv.roster[0];
  bodySprite(CLASSES[leader.cls]?.sprite).then((b) => { if (!b) return; const hh = 58; tok.innerHTML = `<img src="${b.url}" style="height:${hh}px;width:${Math.round(b.w * hh / b.h)}px">`; });
  const place = (n) => { const p = pos(n); tok.style.left = `${p.x}%`; tok.style.top = `${p.y}%`; };
  place(byId[sv.at] || nodes.find((n) => n.kind === 'road') || nodes.find((n) => n.kind === 'town') || nodes[0] || TOWN);
  const glove = h('div', 'wm-glove'); layer.appendChild(glove);

  // ---- HUD windows ----
  const next = nextStory(sv, view); const elsewhere = !next && view < (sv.chapter || 1) ? chapterInfo(sv.chapter) : null;
  const head = win(null, 'wm-head', `<div class="k-small k-dim">Chapter ${CH.roman}</div><div class="wm-ch">${esc(CH.name)}</div>
    <div class="k-small wm-obj">${next ? `Objective: <b>${esc(next.name)}</b>` : elsewhere ? `Objective: <b>${esc(elsewhere.region)}</b>` : chapterDone(sv, view) ? '<b>Chapter complete</b>' : ''}</div>`); el.appendChild(head);
  const purse = win(null, 'wm-purse', ''); el.appendChild(purse);
  const setPurse = () => { const m = Math.floor(sv.playMs / 60000); purse.querySelector('.k-body').innerHTML = `<div class="row"><span class="k-small k-dim">Florins</span><b>${sv.florins.toLocaleString('en-US')}</b></div><div class="row"><span class="k-small k-dim">Company</span><b>${sv.roster.length}</b></div><div class="row"><span class="k-small k-dim">Time</span><b>${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}</b></div>`; };
  setPurse();
  const card = win('Location', 'wm-card'); el.appendChild(card);

  let sel = 0; let busy = false;
  const describe = (n) => {
    const body = card.querySelector('.k-body');
    if (n.kind === 'road') {
      body.innerHTML = `<div class="wm-cname">${esc(n.name)}</div><div class="k-small wm-ctype"><span>Road</span><span class="k-blue">${esc(chapterInfo(n.to).region)}</span></div><div class="k-small wm-cdesc">${esc(n.desc)}</div>`; return;
    }
    if (n.kind === 'town') {
      const stock = n.shop ? shopStock(sv, n).length : 0; const nx = n.shop ? shopNext(sv, n) : null; const fresh = n.shop ? newWares(sv, n).length : 0;
      body.innerHTML = `<div class="wm-cname">${esc(n.name)}</div><div class="k-small wm-ctype"><span>${n.hire ? 'Company Hall' : 'Town'}${n.shop ? ' &middot; Shop' : ''}${n.hire ? ' &middot; Muster' : ''}</span><span class="k-blue">${fresh ? `<span class="k-gold wm-cnew">${fresh} new</span> &middot; ` : ''}${stock ? `${stock} wares` : ''}</span></div>
        <div class="k-small wm-cdesc">${esc(n.desc)}</div>${nx ? `<div class="k-small k-dim wm-soon">New stock after ${esc(nx.needs.join(', '))}</div>` : ''}`; return;
    }
    const st = nodeState(sv, n); const foes = enemiesFor(sv, n);
    const tag = n.kind === 'side' ? `Skirmish${sv.cleared[n.id] ? ` &middot; won ${sv.cleared[n.id]}&times;` : ''}` : st === 'cleared' ? 'Battle &middot; <span class="k-blue">Won</span>' : 'Battle';
    body.innerHTML = `<div class="wm-cname">${esc(n.name)}</div><div class="k-small wm-ctype"><span>${tag}</span><span class="lv">Enemy Lv ${recLevel(sv, n)}</span></div>
      <div class="k-small wm-cdesc">${esc(n.blurb)}</div><div class="wm-foes"></div>`;
    const f = body.querySelector('.wm-foes');
    for (const e of foes) { const p = portraitEl(CLASSES[e.cls]?.sprite, 'k-portrait sm enemy', e.name[0]); p.title = `${e.name} (${className(e.cls)} Lv ${e.lvl})`; f.appendChild(p); }
  };
  const select = (i, hover = false) => {
    if (i === sel && els[sel].classList.contains('sel')) return; els[sel]?.classList.remove('sel'); sel = i; els[i].classList.add('sel');
    const p = pos(nodes[i]); glove.style.left = `${p.x}%`; glove.style.top = `${p.y}%`; describe(nodes[i]); if (hover) sfx('cursor');
    // the card and command window sit on the half of the screen away from the node, so they never cover it
    const px = stage.offsetLeft + (p.x / 100) * stage.offsetWidth; el.classList.toggle('flip', px < innerWidth / 2);
  };
  const hop = (dx, dy) => { // nearest node whose direction is within 60 degrees of the pressed arrow
    const a = nodes[sel]; let best = -1, bd = 1e9;
    nodes.forEach((n, i) => { if (i === sel) return; const vx = n.x - a.x, vy = n.y - a.y; const d = Math.hypot(vx, vy); const cos = (vx * dx + vy * dy) / d; if (cos < 0.45) return; const score = d * (2 - cos); if (score < bd) { bd = score; best = i; } });
    if (best >= 0) { select(best); sfx('cursor'); }
  };
  const start = (id) => nodes.findIndex((n) => n.id === id);
  // PLAYTEST r9: coming back from a battle that is now won, the glove waits on the NEXT objective (it used to sit on
  // the field just cleared, so the obvious Enter re-opened a finished battle's menu).
  let want = arg?.focus; if (want && NODE[want]?.kind === 'story' && nodeState(sv, NODE[want]) === 'cleared' && next) want = next.id;
  let first = want && start(want) >= 0 ? start(want) : next ? start(next.id) : start(sv.at); if (first < 0) first = 0;
  sel = first; select(first);

  // ---- commands ----
  let cmd = null;
  const closeCmd = () => { cmd?.m.destroy(); cmd?.w.remove(); cmd = null; };
  const open = () => {
    if (busy || cmd) return; const n = nodes[sel];
    const w = win(n.name, 'wm-cmd'); el.appendChild(w);
    let items;
    if (n.kind === 'road') items = [{ id: 'travel', label: 'Travel', right: esc(chapterInfo(n.to).region) }, { id: 'formation', label: 'Formation' }, { id: 'cancel', label: 'Cancel' }];
    else if (n.kind === 'town') {
      const hh = nextHire(sv);
      items = [...(n.shop ? [{ id: 'shop', label: 'Shop', right: 'buy &middot; sell' }] : []), { id: 'formation', label: 'Formation' },
        ...(n.hire ? [{ id: 'hire', label: `Hire ${className(hh.cls)}`, right: `${hh.cost} G`, enabled: sv.florins >= hh.cost && sv.roster.length < 16 }] : []),
        { id: 'options', label: 'Options' }, { id: 'title', label: 'Save & Quit' }];
    } else {
      const won = n.kind === 'story' && nodeState(sv, n) === 'cleared';
      items = [...(won ? [] : [{ id: 'engage', label: n.kind === 'side' && sv.cleared[n.id] ? 'Engage again' : 'Engage' }]), { id: 'formation', label: 'Formation' }, { id: 'cancel', label: 'Cancel' }];
    }
    const m = menu(w.querySelector('.k-body'), items, { onPick: (it) => act(it, n), onBack: closeCmd });
    cmd = { w, m };
  };
  const act = async (it, n) => {
    if (it.id === 'cancel') return closeCmd();
    if (it.id === 'formation') { closeCmd(); return go('formation', { battle: n.kind === 'town' || n.kind === 'road' ? null : n.id }); }
    if (it.id === 'travel') {
      // cross the Greyspine: the banner walks to this road's end, then the other region's matching road
      closeCmd(); busy = true; place(n); await new Promise((r) => setTimeout(r, 520));
      const far = ROADS.find((r) => r.ch === n.to && r.to === view); sv.at = far ? far.id : sv.at; writeSave(sv, { backup: false });
      return go('map', { region: n.to, focus: far?.id });
    }
    if (it.id === 'shop') { closeCmd(); busy = true; place(n); sv.at = n.id; writeSave(sv, { backup: false }); await new Promise((r) => setTimeout(r, 420)); return go('shop', { town: n.id }); }
    if (it.id === 'options') { closeCmd(); await openOptions(); return; }
    if (it.id === 'title') { closeCmd(); writeSave(sv); return go('title'); }
    if (it.id === 'hire') {
      closeCmd(); const r = hire(sv); if (!r) return; sv = loadSave(); setPurse();
      await dialog('Muster', `${esc(r.name)} the ${esc(className(r.cls))} signs the company roll.`, [{ id: 'ok', label: 'Welcome' }]); return;
    }
    if (it.id === 'engage') {
      closeCmd(); busy = true;
      place(n); await new Promise((r) => setTimeout(r, 650));
      const seenIntro = sv.seen[n.id + ':in'];
      const lines = n.kind === 'side' && seenIntro ? (n.repeatIntro || []) : n.intro;
      if (!lines.length) return go('formation', { battle: n.id });
      return go('story', { battle: n.id, lines, then: 'formation' });
    }
  };
  const sys = async () => {
    if (cmd) return; const w = win('Company', 'wm-cmd'); el.appendChild(w);
    const m = menu(w.querySelector('.k-body'), [{ id: 'formation', label: 'Formation' }, { id: 'options', label: 'Options' }, { id: 'title', label: 'Save & Quit' }, { id: 'cancel', label: 'Close' }],
      { onPick: (it) => act(it, TOWN), onBack: closeCmd });
    cmd = { w, m };
  };
  const off = pushKeys((k) => {
    if (busy) return;
    if (k === 'left') hop(-1, 0); else if (k === 'right') hop(1, 0); else if (k === 'up') hop(0, -1); else if (k === 'down') hop(0, 1);
    else if (k === 'ok') { sfx('confirm'); open(); } else if (k === 'back') { sfx('confirm'); sys(); } else if (k === 'next' || k === 'prev') { select((sel + (k === 'next' ? 1 : nodes.length - 1)) % nodes.length); sfx('cursor'); } else return false;
  });
  el.addEventListener('click', () => { if (cmd) { sfx('cancel'); closeCmd(); } });

  if (arg?.chapterEnd && chapterDone(sv, CHAPTERS.length)) {
    await dialog(`Chapter ${chapterInfo(CHAPTERS.length).roman} Complete`, `${esc(chapterInfo(CHAPTERS.length).name)} is ended. The company may still take skirmishes in either region. The next chapter is not yet written.`, [{ id: 'ok', label: 'Onward' }]);
  }
  void BATTLES; void NODE; void navigate; void pageUrl;
  return () => { off(); closeCmd(); removeEventListener('resize', fit); };
}

/** From formation: commit and load the battle page. */
export function launch(sv, id, opts = {}) {
  beginBattle(sv, id, opts); const n = NODE[id];
  navigate(pageUrl(`?battle=1&map=${encodeURIComponent(n.map)}&slot=${encodeURIComponent(id)}`), 600);
}
