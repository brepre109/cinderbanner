// Story scene: the location's battle map as the stage (a still of the diorama, slow pan), a title card, the speaker
// standing tall at the side of the frame (the listener dimmed opposite), then dialogue windows with portraits and a
// typewriter. Enter / click advances (first press completes the line), Esc skips the scene.
// R15 story staging: a node with a staged scene (data.js STAGE) acts its dialogue out ON THE BATTLE MAP instead, so this
// screen keeps only the narration for it (travel between battles). A chapter finale ends on the Chapter Complete card.
// arg: { battle, lines: [[speaker, text]], then: 'formation' | 'map' | 'end' | 'depart', prologue?, epilogue? }
import { h, esc, sleep, sfx, pushKeys, portraitEl, setScene, bodySprite, audio } from '../kit.js';
import { NODE, CAST, CHAPTER, STAGE, BATTLES, chOf, chapterInfo, CH2_PROLOGUE } from '../data.js';
import { loadSave, writeSave } from '../save.js';
import { CLASSES } from '../progress.js';
import { chapterPending, enterChapter, partyRecords } from '../campaign.js';
import { backdropOf, hasBackdrop } from '../stage/backdrops.js';
import { textRate } from '../../ui/prefs.js';   // OPTIONS hook: message speed
import '../stage/story.css';

const isEndLine = ([who, t]) => who === 'narrator' && /^End of Chapter/i.test(t || '');
export async function show(el, arg, { go }) {
  const b = NODE[arg?.battle]; let lines = arg?.lines || []; setScene('story');
  const sv = loadSave(); const S = b ? STAGE[b.id] : null;
  // Staged nodes: the dialogue is acted out on the map (stage/director.js); keep the narration here.
  if (S?.intro && !arg?.epilogue && !arg?.noSeen) lines = lines.filter(([w]) => w === 'narrator');
  // ...and after a staged outro, only the lines the field scene did not already play
  if (S?.outro && arg?.epilogue && sv?.seen?.[b.id + ':stageout']) lines = lines.filter((l, i) => !(S.outro || []).some((o) => (o[0] === 'narr' || o[0] === 'line') && o[1] === i));
  const finale = arg?.then === 'end'; if (finale) lines = lines.filter((l) => !isEndLine(l));
  const bg = backdropOf(b); const real = hasBackdrop(b);
  el.innerHTML = `<div class="st2-bg${real ? '' : ' region'}" style="background-image:url(${bg})"></div><div class="st2-shade"></div>
    <img class="st2-fig l" alt=""><img class="st2-fig r" alt="">
    <div class="st-card"><small>${arg?.epilogue ? 'Aftermath' : arg?.prologue ? `Chapter ${CHAPTER.roman} &middot; ${esc(CHAPTER.name)}` : b?.kind === 'side' ? 'Skirmish' : `Chapter ${CHAPTER.roman}`}</small><span>${esc(b?.name || '')}</span></div>
    <div class="k-hint st-hint"><kbd>Enter</kbd>Next<kbd>Esc</kbd>Skip</div>`;
  const card = el.querySelector('.st-card'); const figs = { l: el.querySelector('.st2-fig.l'), r: el.querySelector('.st2-fig.r') };
  let alive = true; let off = null; let ending = false;
  const box = h('div', 'st-box'); el.appendChild(box);
  const finish = async () => {
    if (!alive || ending) return; ending = true; if (!finale) off?.();
    if (sv && b && !arg?.noSeen) { sv.seen[b.id + (arg?.epilogue ? ':out' : ':in')] = 1; writeSave(sv, { backup: false }); }
    if (finale) { await chapterCard(el, b); off?.(); alive = false; return afterFinale(); }
    alive = false;
    if (arg?.then === 'formation') return go('formation', { battle: b.id });
    if (arg?.then === 'depart') { const { launch } = await import('./worldmap.js'); return launch(loadSave() || sv, b.id); }
    return go('map', { focus: b?.id });
  };
  // After the chapter card: Chapter I opens Chapter II's prologue directly (the world map would otherwise put up its
  // one-line "Chapter I Complete" dialog on top of the card that just played); the last chapter returns to the map.
  const afterFinale = () => {
    const cur = loadSave() || sv;
    if (cur && chapterPending(cur)) { enterChapter(cur); return go('story', { battle: 'c1', lines: CH2_PROLOGUE, then: 'map', prologue: true, noSeen: true }); }
    return go('map', { focus: b?.id });
  };
  let i = -1; let typing = null; let carding = true; let endCard = null; let lastWho = null;
  const next = () => {
    if (ending) { cardNext?.(); return; }
    if (carding) { endCard?.(); return; }
    if (typing) { typing.done(); return; }
    i++; if (i >= lines.length) return finish();
    sfx('page'); stageFigs(lines[i][0]); typing = say(box, lines[i], () => { typing = null; });
  };
  // the speaker's figure: party left, foes right; the other side dims (and leaves when a narrator speaks)
  const stageFigs = (who) => {
    const c = CAST[who]; if (!c?.cls) { for (const f of Object.values(figs)) f.classList.add('dim'); return; }
    const side = c.foe ? 'r' : 'l'; const f = figs[side]; const o = figs[side === 'l' ? 'r' : 'l'];
    o.classList.add('dim'); f.classList.remove('dim');
    if (f.dataset.who !== who) {
      f.dataset.who = who; f.classList.remove('in');
      const cls = sv?.roster?.find((r) => r.key === who)?.cls || c.cls;
      bodySprite(CLASSES[cls]?.sprite || cls).then((s) => { if (!s || f.dataset.who !== who) return; f.src = s.url; void f.offsetWidth; f.classList.add('in'); });
    } else if (lastWho !== who) { f.classList.remove('talk'); void f.offsetWidth; f.classList.add('talk'); }
    lastWho = who;
  };
  let cardNext = null;
  off = pushKeys((k) => { if (k === 'ok') next(); else if (k === 'back') { if (ending) cardNext?.(); else { sfx('cancel'); finish(); } } else return false; });
  el.addEventListener('click', () => { if (alive) next(); });
  await sleep(250); card.classList.add('in');
  await new Promise((r) => { endCard = r; setTimeout(r, lines.length ? 1300 : 1800); }); carding = false; if (!alive) return;
  card.classList.add('up');
  next();
  // ---- Chapter Complete: title, the company in a line, the chapter's numbers ----
  async function chapterCard(host, node) {
    const ch = chapterInfo(chOf(node)); const cur = loadSave() || sv || {};
    const nodes = BATTLES.filter((n) => chOf(n) === chOf(node)); const won = nodes.filter((n) => n.kind === 'story' && cur.cleared?.[n.id]).length;
    const side = nodes.filter((n) => n.kind === 'side').reduce((a, n) => a + (cur.cleared?.[n.id] || 0), 0);
    const roster = cur.roster || []; const party = partyRecords(cur); const avg = roster.length ? Math.round(roster.reduce((a, r) => a + (r.lvl || 1), 0) / roster.length) : 0;
    const mins = Math.round((cur.playMs || 0) / 60000); const time = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
    const wrap = h('div', 'st2-card-end', `<div class="st2-end"><div class="ttl"><small>Chapter ${ch.roman} Complete</small>${esc(ch.name)}</div><div class="st2-line"></div>
      <div class="k-win st2-stats"><div>Story battles<b>${won} / ${nodes.filter((n) => n.kind === 'story').length}</b></div><div>Skirmishes won<b>${side}</b></div><div>Company<b>${roster.length} sworn</b></div>
      <div>Average level<b>Lv ${avg}</b></div><div>Treasury<b>${(cur.florins || 0).toLocaleString('en-US')} florins</b></div><div>Time on the road<b>${time}</b></div></div>
      <div class="st2-next">${chapterPending(cur) ? `Chapter ${chapterInfo(ch.no + 1).roman} &middot; ${esc(chapterInfo(ch.no + 1).name)} awaits` : 'The next chapter is not yet written'}<kbd>Enter</kbd></div></div>`);
    box.remove(); for (const f of Object.values(figs)) f.classList.remove('in'); card.classList.remove('in');
    host.appendChild(wrap); audio().then((m) => m?.uiSfx?.('levelup'));
    const line = wrap.querySelector('.st2-line'); const who = (party.length ? party : roster).slice(0, 6);
    who.forEach((r, n) => { bodySprite(CLASSES[r.cls]?.sprite || r.cls).then((s) => { if (!s) return; const im = new Image(); im.src = s.url; im.style.animationDelay = `${0.4 + n * 0.14}s`; im.title = r.name; line.appendChild(im); }); });
    await sleep(900);
    await new Promise((r) => { cardNext = r; setTimeout(r, 30000); });
    cardNext = null; sfx('confirm');
  }
  return () => { alive = false; off?.(); };
}

function say(box, [who, text], onDone) {
  const c = CAST[who] || { name: who, cls: null }; const narr = !c.cls;
  const foe = !!c.foe;
  box.className = `st-box k-win${narr ? ' narr slate' : ''}${foe ? ' foe' : ''}`;
  box.innerHTML = `${narr ? '' : `<div class="k-tab${foe ? ' foe' : ''}">${esc(c.name)}</div>`}<div class="st-txt"></div><i class="st-more"></i>`;
  if (!narr) { const p = portraitEl(CLASSES[c.cls]?.sprite, `k-portrait st-face${foe ? ' enemy' : ''}`, c.name[0]); box.prepend(p); }
  // restart the window's entry animation for each line
  box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
  const t = box.querySelector('.st-txt'); let n = 0; let timer = 0; let fin = false;
  const done = () => { if (fin) return; fin = true; clearInterval(timer); t.textContent = text; box.classList.add('done'); onDone(); };
  // OPTIONS hook (Gameplay > Message Speed, src/ui/prefs.js textRate): 1 = the shipped 2 characters per 22 ms tick.
  const step = 2 * textRate(); let blip = 0; if (step >= 60) { setTimeout(done, 0); return { done }; }
  timer = setInterval(() => { n += step; const m = Math.floor(n); t.textContent = text.slice(0, m); if (m - blip >= 6) { blip = m; sfx('text'); } if (m >= text.length) done(); }, 22);
  return { done };
}
