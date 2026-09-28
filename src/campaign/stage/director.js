// Battle-page director for story staging: the node's intro scene before deployment, its outro after a first-clear
// victory, the boss set pieces (nameplate + sting + line on the boss's first turn, the phase change at half HP, the
// mechanic plate under the Win line) and the in-battle lines (ally down, captain in danger, a recruit's first action).
// Wired by src/campaign/battlelink.js only. Mid-battle beats wait for a TURN BOUNDARY: battle.takeTurn is wrapped on
// this instance (battle.js is untouched), so a line or a phase change always plays between two turns, never inside one.
import { STAGE, BOSSES, BARKS, CAST } from '../data.js';
import { foeOpts } from '../campaign.js';
import { loadSave, writeSave } from '../save.js';
import { h, esc, normKey } from '../kit.js';
import { Stage, sting } from './player.js';

export function installDirector(g, { sv, b, q = new URLSearchParams(location.search) }) {
  const { battle } = g; const stage = new Stage(g, { sv, node: b });
  const S = STAGE[b.id] || {}; const cfg = BOSSES[b.id] || null;
  const firstClear = !(sv.cleared?.[b.id] > 0);
  const flag = q.get('stage');   // '0' = never stage, '1' = always (a driver / a replay)
  const mark = (k) => { const cur = loadSave(); if (cur) { cur.seen = { ...(cur.seen || {}), [k]: 1 }; writeSave(cur, { backup: false }); } sv.seen = { ...(sv.seen || {}), [k]: 1 }; };
  let busy = false;

  // ---- keys: while a scene or a line is up, every key goes to it (capture phase, ahead of the HUD / pause menu) ----
  addEventListener('keydown', (e) => {
    if (!stage.active) return;
    e.preventDefault(); e.stopImmediatePropagation(); if (e.repeat && e.key !== 'Escape') return;
    const k = normKey(e);
    if (e.key === 'Escape' || k === 'back') stage.skip(); else if (k === 'ok' || e.key === ' ' || e.key === 'Enter') stage.advance();
  }, true);

  // ---- intro / outro ----
  const introScript = S.intro && flag !== '0' && (flag === '1' || !sv.seen?.[b.id + ':stage']) ? S.intro : null;
  const outroScript = S.outro && flag !== '0' && (flag === '1' || firstClear) ? S.outro : null;
  const api = {
    stage, get busy() { return busy || stage.active; },
    /** call while the entry cover is still up: parks the company for the walk-in */
    prelude(play) { if (introScript && play) stage.prelude(introScript, b.intro || []); },
    async intro(play) {
      if (!introScript || !play) return false;
      busy = true; try { await stage.run(introScript, { lines: b.intro || [] }); } finally { busy = false; }
      mark(b.id + ':stage'); return true;
    },
    hasOutro: !!outroScript,
    async outro() {
      if (!outroScript) return false; busy = true;
      try { g.overlay?.clear?.(); g.ui?.setActive?.(null); stage.reviveParty(); await stage.run(outroScript, { lines: b.outro || [], restore: false }); } finally { busy = false; }
      mark(b.id + ':stageout'); return true;
    },
    /** the finale's black card stays up until the page navigates away */
    get holdBlack() { return !!stage._tableau; },
  };

  // ---- the boss: mechanic plate, win line ----
  const boss = cfg ? battle.units.filter((u) => u.team === 'B')[cfg.idx] || null : null;
  let hintEl = null;
  const showHint = (text, pulse = false) => {
    if (!text) return; if (!hintEl) { hintEl = h('div', 'sg-hint'); document.body.appendChild(hintEl); }
    hintEl.innerHTML = `<span class="lab">Boss</span><span>${esc(text)}</span>`;
    if (pulse) { hintEl.classList.remove('pulse'); void hintEl.offsetWidth; hintEl.classList.add('pulse'); }
  };
  const placeHint = () => {
    if (!hintEl) return; const o = g.ui?.el?.objective; const r = o?.getBoundingClientRect?.();
    if (r && r.height && o.classList.contains('show')) { hintEl.style.top = `${Math.round(r.bottom + 4)}px`; hintEl.style.left = `${Math.round(r.left)}px`; hintEl.style.opacity = '1'; } else hintEl.style.opacity = '0';
  };
  if (cfg && boss) {
    if (cfg.win) { const o = battle.objectiveText.bind(battle); battle.objectiveText = () => ({ ...o(), win: cfg.win }); try { g.ui?.setObjective?.(battle.objectiveText()); } catch { /* ui */ } }
    // the Conditions for Winning banner (turn 1) carries the mechanic too
    const ob = g.ui?.objectiveBanner?.bind(g.ui);
    if (ob) g.ui.objectiveBanner = (o) => { const r = ob(o); try { const bn = g.ui.el?.banner; if (bn && cfg.hint) bn.insertAdjacentHTML('beforeend', `<div class="sg-bhint">${esc(cfg.hint)}</div>`); } catch { /* ui */ } return r; };
    showHint(cfg.hint); setInterval(placeHint, 250);
  }

  // ---- mid-battle queue, played at the next turn boundary ----
  const Q = []; const done = new Set();
  const keyOf = (u) => stage.keyOfUnit(u);
  battle.on('ko', ({ victim }) => {
    if (!victim || battle.over) return;
    if (victim.team === 'A') { const k = keyOf(victim); const line = BARKS.ko[k]; if (line && !done.has('ko:' + victim.id)) { done.add('ko:' + victim.id); Q.push({ lines: [[k, line]], focus: victim }); } }
    else if (victim === boss && cfg?.down && !victim.statuses?.reraise) Q.push({ lines: cfg.down, focus: victim, once: 'down' });
  });
  battle.on('raise', ({ victim, reraise }) => { if (reraise && victim === boss && cfg?.rise && !done.has('rise')) { done.add('rise'); Q.push({ lines: cfg.rise, focus: victim, before: (st) => { st.flash('#ffffff'); sting('dread'); } }); } });

  const heroRec = sv.roster?.find((r) => r.hero); const hero = () => (heroRec && battle.units.find((u) => u.team === 'A' && u.recordId === heroRec.id)) || null;
  async function phaseChange() {
    const P = cfg.phase; done.add('phase');
    const other = P.target ? battle.units.find((u) => u.team === 'B' && u.name === CAST[P.target]?.name && !u.ko && !u.removed) : null;
    await stage.bark(P.lines, { focus: boss, before: async (st) => {
      st.flash(P.flash || '#ffffff'); battle.camera.shake = Math.max(battle.camera.shake || 0, P.shake || 0.3); sting(P.sting || 'boss');
      const p = battle.worldPos(boss.x, boss.z); battle.vfx?.play?.(P.toll ? 'holy' : 'buff', p, p);
      g.ui?.announce?.(P.announce || `${boss.name} changes!`);
      await st.wait(700);
    } });
    const E = battle.engine; const ev = [];
    for (const s of P.self || []) E.applyStatus(boss, s, undefined, ev, boss);
    for (const [m, d] of Object.entries(P.mods || {})) E.applyMod(boss, m, d, ev, boss);
    for (const s of P.allies || []) for (const a of E.alliesOf(boss)) E.applyStatus(a, s, undefined, ev, boss);
    if (other) for (const s of P.other || []) E.applyStatus(other, s, undefined, ev, boss);
    if (P.toll) for (const v of battle.units) if (v.team === boss.team && v !== boss && v.ko && !v.removed) {
      v.ko = false; v.koTurns = 0; v.hp = Math.max(1, Math.floor(v.maxHp * P.toll)); v.ct = 0; v.statuses = {}; v.mods = { atkMod: 0, magMod: 0, defMod: 0, spdMod: 0 };
      ev.push({ type: 'raise', unit: boss, victim: v, amount: v.hp });
    }
    await battle.play(ev);
    for (const [cls, lvl, name] of P.summon || []) {
      const t = stage.ring({ x: boss.x, z: boss.z }, 3).sort((p, q2) => p.d - q2.d)[0]; if (!t) break;
      try {
        const nu = await battle.addUnit('B', cls, t.x, t.z, name, foeOpts({ cls, lvl, over: null }));
        const p = battle.worldPos(t.x, t.z); battle.vfx?.play?.('debuff', p, p); battle.spriteOf(nu).setKO?.(false); await new Promise((r) => setTimeout(r, 380));
      } catch (e) { console.warn('phase summon failed', e); }
    }
    g.ui?.setTurnOrder?.(battle.turnOrder()); for (const u of battle.units) g.ui?.setUnitHp?.(u);
    showHint(P.hint || cfg.hint, true);
  }
  async function preTurn(u) {
    if (battle.over) return;
    // 1) the boss at half HP (or the node's threshold): the phase change
    if (cfg?.phase && boss && !done.has('phase') && !boss.ko && !boss.removed && boss.hp <= boss.maxHp * (cfg.phase.at ?? 0.5)) await phaseChange();
    // 2) queued lines (an ally down, the boss rising / falling): at most two per boundary
    for (let n = 0; n < 2 && Q.length && !battle.over; n++) { const it = Q.shift(); if (it.once) { if (done.has(it.once)) continue; done.add(it.once); } await stage.bark(it.lines, { focus: it.focus, before: it.before }); }
    // 3) the captain in danger
    const H = hero();
    if (H && !done.has('heroLow') && !H.ko && H.hp > 0 && H.hp <= H.maxHp * 0.3) {
      done.add('heroLow'); const present = (k) => { const x = stage.actor(k); return x && stage.alive(x); };
      const lines = BARKS.heroLow.filter(([k]) => k === 'aldric' || present(k)); if (lines.length) await stage.bark(lines, { focus: H });
    }
    // 4) the boss's first turn: nameplate, sting, line
    if (u === boss && !done.has('bossFirst')) {
      done.add('bossFirst');
      await stage.bark(cfg.first || [], { focus: boss, before: async (st) => { st.root && await st.plate(cfg.key); } });
      showHint(cfg.hint, true);
    }
    // 5) a recruit's first action with the company (once per save)
    if (u.team === 'A') { const k = keyOf(u); const line = BARKS.first[k]; if (line && !sv.seen?.['bark:first:' + k] && !done.has('first:' + k)) { done.add('first:' + k); mark('bark:first:' + k); await stage.bark([[k, line]], { focus: u }); } }
  }
  const tt = battle.takeTurn.bind(battle);
  battle.takeTurn = async (u) => { try { busy = true; await preTurn(u); } catch (e) { console.error('stage preTurn', e); } finally { busy = false; } return tt(u); };
  window.__STAGE__ = { stage, api, skip: () => stage.skip(), advance: () => stage.advance(), get active() { return stage.active; }, get mode() { return stage.mode; }, boss, done, preTurn };
  return api;
}
