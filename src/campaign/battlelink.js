// Campaign side of a battle page (?battle=1&map=<id>&slot=<node>). battleboot.js calls prepare(q) before it builds
// anything and attach(ctx) after window.__GAME__ is published; everything campaign-specific in a battle lives here:
// the deployed party and enemy line-up, the fade in, the pause menu (Esc / P / the corner button), battle speed,
// and the victory/defeat hand-off to the results screen. Only ever loaded when the URL carries ?slot.
import './kit.css';
import './battle.css';
import { loadSave, writeSave, loadOptions, speedValue } from './save.js';
import { NODE, CHAPTER, objectiveFor, objectiveText } from './data.js';
import { partyRecords, enemiesFor, finishBattle, foeOpts, battleDiffId, battleDifficulty } from './campaign.js';
import * as PR from './progress.js';
import { h, esc, win, sleep, sfx, dialog, navigate, applyVolumes, audio, handleKey, pageUrl } from './kit.js';
import { openOptions } from './options.js';
import { installDirector } from './stage/director.js';   // STORY STAGING (R15): scenes on the map, boss set pieces, in-battle lines
import { openRewind, installRewindThumbs, rewindFx } from '../ui/rewind.js';   // REWIND: pick a turn start, go back to it
import { rewindLimit } from '../ui/prefs.js';

let cover = null;
export async function prepare(q) {
  cover = h('div', 'k-cover', ''); document.body.appendChild(cover);
  const sv = loadSave(); const b = NODE[q.get('slot')];
  if (!sv || !b) { console.warn('campaign battle: no save or unknown slot; running the demo line-up'); cover.remove(); cover = null; return null; }
  const once = battleDiffId(sv, b); cover.innerHTML = `<div class="k-cover-t"><small>Chapter ${CHAPTER.roman}</small>${b.name}${once ? `<span class="k-cover-once">${esc(battleDifficulty(sv, b).label)} &middot; this battle only</span>` : ''}</div>`;
  await PR.loadProgression();
  let party = partyRecords(sv); if (!party.length) party = sv.roster.slice(0, 5);
  party = party.slice(0, 5);
  const foes = enemiesFor(sv, b).slice(0, 5);
  const opts = { A: party.map((r) => ({ ...PR.unitOpts(r), recordId: r.id, leader: !!r.hero })), B: foes.map((e) => foeOpts(e)) };
  const ctx = { sv, b, party, foes, units: new Map() };
  return {
    roster: { A: party.map((r) => r.cls), B: foes.map((e) => e.cls) },
    names: { A: party.map((r) => r.name), B: foes.map((e) => e.name) },
    opts, title: b.name, subtitle: b.kind === 'side' ? 'SKIRMISH' : `CHAPTER ${CHAPTER.roman}`,
    placed(team, i, u) {
      // levels/recordIds for engines that predate progression's opts (harmless when makeUnit already set them)
      const o = opts[team][i] || {}; if (u.recordId == null && o.recordId) u.recordId = o.recordId;
      if (o.lvl && u.lvl !== o.lvl && !u.base) u.lvl = o.lvl;
      ctx.units.set(u.id, u);
    },
    attach: (g) => attach(ctx, g),
  };
}

function attach(ctx, g) {
  const { battle, player } = g; const { sv, b } = ctx;
  // R15 story staging. Installed first: its key listener must run ahead of the pause key below while a scene is up.
  let dir = null; try { dir = installDirector(g, { sv, b }); } catch (e) { console.error('story staging disabled', e); }
  // Battle objective from the node (leader kill, protect the hero); plain routs keep the engine default.
  try { const obj = objectiveFor(b, battle.units, ctx.party); if (obj.type !== 'rout' || obj.protect) battle.setObjective?.(obj); } catch (e) { console.warn('objective not applied', e); }
  const goal = objectiveText(b);
  const o = loadOptions(); battle.speed = speedValue(o);
  audio().then((m) => { applyVolumes(o); try { m?.setScene?.('battle'); } catch { /* optional */ } });

  // ---- stats tracker: the fallback for battle.summary() ----
  const st = new Map(); const row = (u) => { if (!u) return null; if (!st.has(u.id)) st.set(u.id, { kills: 0, dmg: 0, heal: 0, actions: 0, ko: false, team: u.team, lvl: u.lvl }); return st.get(u.id); };
  let turns = 0;
  battle.on('turnStart', () => { turns++; });
  battle.on('abilityStart', (e) => { if (!e.reaction) { const r = row(e.unit); if (r) r.actions++; } });
  battle.on('charge', (e) => { const r = row(e.unit); if (r) r.actions++; });
  battle.on('damage', (e) => { const r = row(e.unit); if (r && e.unit !== e.victim) r.dmg += e.amount || 0; });
  battle.on('heal', (e) => { const r = row(e.unit); if (r) r.heal += e.amount || 0; });
  battle.on('ko', (e) => { const v = row(e.victim); if (v) v.ko = true; const k = row(e.by); if (k && e.by?.team !== e.victim?.team) k.kills++; });
  const summarize = (winner) => {
    let s = null; try { s = typeof battle.summary === 'function' ? battle.summary() : null; } catch (e) { console.warn('battle.summary threw', e); }
    if (s && s.units && Object.keys(s.units).length) return { ...s, winner: s.winner ?? winner };
    const units = {}; for (const u of battle.units) { const r = row(u); units[u.recordId || u.id] = { ...r, ko: !!u.ko || u.removed || r.ko }; }
    return { winner, turns, units };
  };

  // ---- REWIND: what rides along in every turn snapshot besides the engine (src/game/battle.js registerSnapshot) ----
  // the fallback record and turn counter here, and the stage director's once-only beats (phase change, boss lines),
  // so a rewound boss re-plays its half-HP phase when the new timeline reaches it again.
  // R18: a one-battle Story retry (campaign.js battleDiffId) keeps Story's unlimited rewind too
  const onceDiff = battleDiffId(sv, b); const rwLimit = () => (onceDiff === 'story' ? Infinity : rewindLimit());
  battle.rewindLimit = rwLimit();
  battle.registerSnapshot?.('link', { save: () => ({ turns, st: [...st] }), load: (v) => { turns = v.turns; st.clear(); for (const [k, x] of v.st) st.set(k, x); } });
  if (window.__STAGE__?.done) battle.registerSnapshot?.('stage', { save: () => [...window.__STAGE__.done], load: (v) => { const d = window.__STAGE__.done; d.clear(); for (const x of v) d.add(x); } });
  try { installRewindThumbs(g); } catch (e) { console.warn('rewind thumbs', e); }

  // ---- pause gate: the loop halts at the next turn boundary; input to the field is blocked while the menu is up ----
  let paused = false; let wake = null; let menuOpen = false; let ended = false;
  const origStep = battle.step.bind(battle);
  battle.step = async () => { while (paused) await new Promise((r) => { wake = r; }); return origStep(); };
  const btn = h('button', 'k-pausebtn', '<span>Menu</span><kbd>Esc</kbd>'); document.body.appendChild(btn);
  btn.addEventListener('click', (e) => { e.stopPropagation(); openPause(); });
  const openPause = async () => {
    if (menuOpen || ended) return; menuOpen = true; paused = true; sfx('confirm');
    const shield = h('div', 'k-shield'); document.body.appendChild(shield);
    let rw = null;
    for (;;) {
      const nRw = battle.rewindTargets?.().length || 0;
      const pick = await dialog('Paused', `${b.name} · Turn ${turns}${onceDiff ? ` · ${battleDifficulty(sv, b).label} (this battle only)` : ''}`, [
        { id: 'resume', label: 'Resume' }, { id: 'options', label: 'Options' },
        { id: 'rewind', label: 'Rewind', right: nRw ? `${nRw} turn${nRw > 1 ? 's' : ''}` : 'none yet', enabled: nRw > 0 && battle.rewindLimit !== 0 }, { id: 'retreat', label: b.kind === 'side' ? 'Retreat to Map' : 'Retreat to Map', right: 'no rewards' },
      ], { cls: 'k-pause' });
      if (pick === 'options') { await openOptions({ onSpeed: (oo) => { battle.speed = speedValue(oo); } }); battle.rewindLimit = rwLimit(); continue; }
      if (pick === 'rewind') { rw = await openRewind({ battle, camera: g.camera }); if (!rw) continue; break; }
      if (pick === 'retreat') {
        const ok = await dialog('Retreat?', 'The company withdraws. Nothing is gained, nothing is lost.', [{ id: 'yes', label: 'Retreat' }, { id: 'no', label: 'Keep fighting' }], { sel: 1 });
        if (ok !== 'yes') continue;
        ended = true; finishBattle(loadSave() || sv, b.id, 'retreat', null); navigate(pageUrl('?screen=map'), 520); return;
      }
      break;
    }
    shield.remove(); menuOpen = false;
    if (rw) { await rewindFx(rw); battle.requestRewind(rw); }
    paused = false; wake?.(); wake = null;
  };
  // R (rebindable, src/ui/prefs.js 'rewind'): the Rewind window straight from the field, on the player's own turn only
  // (while a command, a tile or a facing is being picked -- never while anything animates).
  const openRewindKey = async () => {
    if (menuOpen || ended || battle.over) return;
    if (!player?.awaitingInput?.()) { g.ui?.announce?.('Rewind opens on your turn'); return; }
    if (!battle.rewindTargets().length || battle.rewindLimit === 0) { sfx('buzz'); g.ui?.announce?.(battle.rewindLimit === 0 ? 'Rewind is off (Options)' : 'No turn to return to yet'); return; }
    menuOpen = true; paused = true; sfx('confirm'); const shield = h('div', 'k-shield'); document.body.appendChild(shield);
    let s = null; try { s = await openRewind({ battle, camera: g.camera }); } finally { shield.remove(); menuOpen = false; }
    if (s) { await rewindFx(s); battle.requestRewind(s); }
    paused = false; wake?.(); wake = null;
  };
  // Esc opens the menu only when the player controller has nothing to back out of (its own Esc = cancel).
  // While the menu is up every key is routed to the menu only (capture phase, ahead of player.js / battleboot keys).
  window.addEventListener('keydown', (e) => {
    if (menuOpen) { e.stopImmediatePropagation(); handleKey(e); return; }
    if (ended) return;
    // PLAYTEST r9: the corner button promises "Menu [Esc]", but at the top command window Esc was eaten by the
    // controller's no-op 'back'. With nothing to back out of there (no move to undo), Esc now opens the menu too.
    const topMenu = g.ui?.menuTitle === 'Menu' && g.ui.menuItems && !g.ui.menuItems.some((i) => i.id === 'undo') && !player?.pick && !player?.facingFn;
    if ((e.key === 'r' || e.key === 'R') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); openRewindKey(); return; }
    if (e.key === 'p' || e.key === 'P' || e.key === 'F1' || (e.key === 'Escape' && (!player?.cancel || topMenu))) { e.preventDefault(); e.stopImmediatePropagation(); openPause(); }
  }, true);

  // ---- PLAYTEST r9: field manual on the company's first turn (once per save) ----
  // A new player used to land on a Move/Act/Wait window with no word on what the colours mean, how a turn is built or
  // which keys exist. A NON-modal plate (it never takes a key, so the command menu and every script that drives it work
  // unchanged) appears beside the first command menu and folds away when that turn ends or on a click. H reopens the
  // full key list any time (src/ui/ui.js).
  let taught = !!(loadSave() || sv).seen?.tutorial; let manual = null;
  const closeManual = () => { if (!manual) return; const m = manual; manual = null; m.classList.add('out'); setTimeout(() => m.remove(), 260); };
  battle.on('turnStart', async (e) => {
    const u = e?.unit || battle.active; if (manual && u?.team !== 'A') closeManual();
    if (taught || ended || u?.team !== 'A') return; taught = true;
    for (let i = 0; i < 200 && !(g.ui.menuItems && battle.active?.team === 'A'); i++) await sleep(50);
    if (ended) return;
    const k = (x) => `<kbd>${x}</kbd>`;
    manual = win('Field Manual', 'k-manual', `<div class="k-man">
      <div><b>Goal</b><span>${goal.win.replace(/[.!]$/, "")}.${goal.lose !== 'All allies fall' ? ' Lose if ' + goal.lose + '.' : ''}</span></div>
      <div><b>Turn</b><span>Move and Act in any order, then face the foe.</span></div>
      <div><b>Tiles</b><span><i class="k-sw mv"></i>walk <i class="k-sw tg"></i>strike &middot; the dark card previews each hit.</span></div>
      <div><b>Edge</b><span>Hit from the side or back; strike down from high ground.</span></div>
      <div><b>Foes</b><span>Point at one: <i class="k-sw" style="background:#c8485c"></i>it can walk, <i class="k-sw" style="background:#e8904a"></i>it can also hit.</span></div>
      <div class="keys">${k('Q')}${k('E')}Rotate ${k('I')}Status ${k('F')}Speed ${k('H')}Keys</div></div>`);
    document.body.appendChild(manual); manual.addEventListener('click', (ev) => { ev.stopPropagation(); sfx('cancel'); closeManual(); });
    // It must never sit on top of another window: any window-opening key (Status / Keys / pause) folds it away.
    const onKey = (ev) => { if (!manual) { removeEventListener('keydown', onKey, true); return; } if (/^(i|h|p|escape)$/i.test(ev.key)) closeManual(); };
    addEventListener('keydown', onKey, true);
    if (g.ui.openStatus && !g.ui._manualWrapped) { const os = g.ui.openStatus.bind(g.ui); g.ui.openStatus = (...a) => { closeManual(); return os(...a); }; g.ui._manualWrapped = true; }
    const cur = loadSave(); if (cur) { cur.seen = { ...(cur.seen || {}), tutorial: 1 }; writeSave(cur, { backup: false }); }
  });
  battle.on('turnEnd', () => closeManual());
  battle.on('victory', () => closeManual());

  // ---- victory / defeat -> results ----
  // A lost field (a player at the keys, a turn to go back to) first offers the Chariot: retry from the last turn the
  // company had, or pick an earlier one. Only a declined offer reaches finishBattle and the Defeat screen, so the
  // results only ever describe the timeline that was kept.
  const offerRetry = async () => {
    const list = battle.rewindTargets?.() || []; if (!list.length || battle.rewindLimit === 0 || !battle.controller || new URLSearchParams(location.search).get('retry') === '0') return null;
    await sleep(1700); menuOpen = true;
    try {
      for (;;) {
        const last = list[0];
        const pick = await dialog('The line breaks', `Turn back the hour? The field returns to the start of that turn, exactly as it stood.`, [
          { id: 'last', label: `Retry from Turn ${last.turn}`, right: esc(last.name) }, ...(list.length > 1 ? [{ id: 'choose', label: 'Choose a turn…', right: `${list.length} kept` }] : []), { id: 'accept', label: 'Accept defeat' },
        ], { cls: 'rw-retrywin', ovCls: 'rw-retry' });
        if (pick === 'last') return last;
        if (pick === 'choose') { const s = await openRewind({ battle, camera: g.camera, title: 'Retry from', note: `the line broke on turn ${battle.engine.turn}` }); if (s) return s; continue; }
        if (pick === 'accept') return null;
      }
    } finally { menuOpen = false; }
  };
  battle.on('victory', async (e) => {
    if (ended) return; ended = true;
    const winner = e?.team ?? e?.winner ?? null; const outcome = winner === 'A' ? 'victory' : 'defeat';
    if (outcome === 'defeat') {
      let s = null; try { s = await offerRetry(); } catch (err) { console.error('retry offer', err); }
      if (s) {
        await rewindFx(s); await battle.rewindNow(s); ended = false;
        try { const m = await audio(); m?.setScene?.('battle'); } catch { /* optional */ }
        battle.auto = true; battle.run(); return;
      }
    }
    btn.remove();
    try { const m = await audio(); m?.setScene?.(outcome === 'victory' ? 'results' : 'defeat'); } catch { /* optional */ }
    const summary = summarize(winner);
    const cur = loadSave() || sv; finishBattle(cur, b.id, outcome, summary);
    // R15: a first-clear victory on a staged node plays its outro on the field (after the banner), then the results.
    if (outcome === 'victory' && dir?.hasOutro) { await sleep(2400); try { await dir.outro(); } catch (err) { console.error('stage outro', err); } navigate(pageUrl('?screen=results'), dir.holdBlack ? 200 : 700); return; }
    await sleep(2800); navigate(pageUrl('?screen=results'), 700);
  });

  // ---- open: fade the cover, then the DEPLOYMENT phase (src/ui/deploy.js), then start the clock ----
  // Deployment runs only when a player is at the keys: play mode (battle.controller set) and no ?deploy=0. A driver
  // that boots ?mode=ai, or hands team A to the AI (controller = null) during it, goes straight to the fight.
  let deploy = null;
  (async () => {
    // R15: a staged intro plays only with a player at the keys (play mode), like the deployment after it.
    const play = !!battle.controller && !ended;
    try { dir?.prelude(play); } catch (e) { console.error('stage prelude', e); }
    await sleep(250); cover?.classList.add('off'); await sleep(900); cover?.remove(); cover = null;
    let staged = false; try { staged = !!(await dir?.intro(play)); } catch (e) { console.error('stage intro', e); }
    await sleep(staged ? 300 : 1400);
    const q = new URLSearchParams(location.search);
    if (battle.controller && q.get('deploy') !== '0' && !ended) {
      try {
        const { runDeployment } = await import('../ui/deploy.js');
        deploy = runDeployment(g, { sfx });
        await deploy.finished;
      } catch (e) { console.error('deployment skipped', e); }
    }
    if (ended) return;
    battle.auto = true; battle.run();
  })();
  window.__CAMPAIGN__ = { save: sv, node: b, summarize, pause: openPause, rewind: openRewindKey, get paused() { return paused; }, get deploy() { return deploy; }, get deploying() { return !!deploy?.active; }, get staging() { return !!dir?.busy; } };
}
