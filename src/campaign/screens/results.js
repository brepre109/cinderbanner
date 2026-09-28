// Results: VICTORY / DEFEAT banner, per-unit EXP and JP with animated bars and level-up stamps, spoils, recruits.
// Victory -> Continue -> the node's outro scene (first clear) -> world map. Defeat -> Retry or Return to map.
import { nodeImg } from '../regions.js';
import { h, esc, win, menu, sfx, sleep, portraitEl, setScene, pushKeys, dialog } from '../kit.js';
import { loadSave, writeSave } from '../save.js';
import { NODE } from '../data.js';
import { beginBattle, upgradeAdvice, applyAdvice, gearGap, partyRecords, planRowsHtml } from '../campaign.js';
import * as PR from '../progress.js';
import { launch } from './worldmap.js';
import { ITEMS, describe } from '../../game/equipment.js';
import { iconHtml } from '../icons.js';
import { prefs, difficulty } from '../../ui/prefs.js';
import { recommendLearn, applyLearn } from '../../game/progression.js';

export async function show(el, _arg, { go }) {
  const sv = loadSave(); const res = sv?.last; const b = res ? NODE[res.id] : null;
  if (!res || !b || res.outcome === 'retreat') { el.innerHTML = ''; setTimeout(() => go('map', { focus: b?.id }), 0); return; }
  const win_ = res.outcome === 'victory';
  setScene(win_ ? 'results' : 'defeat');
  el.innerHTML = `<div class="rs-bg" style="background-image:url(${nodeImg(b)})"></div><div class="rs-shade${win_ ? '' : ' lost'}"></div>
    <div class="rs-banner${win_ ? '' : ' lost'}"><div class="k-disp">${win_ ? 'Victory' : 'Defeat'}</div><div class="rs-where">${esc(b.name)}${res.diff ? ` &middot; ${esc(difficulty(res.diff).label)} (this battle only)` : ''}${res.rounds ? ` &middot; ${res.rounds} rounds` : res.turns ? ` &middot; ${res.turns} turns` : ''}</div></div>`;
  const byId = new Map(sv.roster.map((r) => [r.id, r]));
  let off = null;
  if (!win_) {
    // R16 SHOP NUDGE: a loss with the company's gear behind the enemy's tier says so, names the shop, and offers the
    // quartermaster's shortcut (the Formation one: the list and its cost first, then buy and put on).
    let adv = null, gap = null; try { gap = gearGap(sv, b); adv = upgradeAdvice(sv, partyRecords(sv)); } catch (e) { console.warn('shop advice', e); }
    let advise = !!(gap?.behind && adv?.plan.length);
    const advHtml = advise ? `<div class="rs-advice">Their steel outclasses yours (tier ${gap.theirs} against ${gap.mine.toFixed(1)}). ${adv.shopSouls && adv.town ? `<b>${esc(adv.town.name)}</b> sells better: ${adv.souls} soldier${adv.souls > 1 ? 's' : ''} could upgrade for ${adv.cost.toLocaleString('en-US')} florins.` : `The chest holds better: ${adv.souls} soldier${adv.souls > 1 ? 's' : ''} could upgrade.`}</div>` : '';
    // R17 JP NUDGE: deployed soldiers with JP they could spend right now -> 'Learn recommended' (confirm, then learn).
    const learnPlan = () => { try { return partyRecords(sv).map((r) => ({ r, picks: recommendLearn(r) })).filter((x) => x.picks.length); } catch (e) { console.warn('recommendLearn', e); return []; } };
    let lp = learnPlan();
    const jpHtml = lp.length ? `<div class="rs-advice rs-jp">Unspent JP: ${lp.slice(0, 3).map((x) => esc(x.r.name)).join(', ')}${lp.length > 3 ? ` +${lp.length - 3}` : ''} could learn ${lp.reduce((t, x) => t + x.picks.length, 0)} new abilit${lp.reduce((t, x) => t + x.picks.length, 0) === 1 ? 'y' : 'ies'} before the retry.</div>` : '';
    const onceHtml = (res.diff || prefs().difficulty) !== 'story' ? `<div class="k-small k-dim rs-oncenote">Retry on Story: foes &minus;2 Lv for this battle only, then back to ${esc(difficulty(prefs().difficulty).label)}.</div>` : '';
    const w = win('The company is routed', 'rs-defeat', `<p class="k-small">The line broke at ${esc(b.name)}${res.diff ? ` (on ${esc(difficulty(res.diff).label)}, this battle only)` : ''}. No experience or spoils were taken, but every soldier lives to fight again.</p>${advHtml}${jpHtml}${onceHtml}`); el.appendChild(w);
    // R15 (review15 P5): a lost fight offers the easier setting in one step. R18 (review17 R3): for THIS battle only --
    // the save's own difficulty is untouched and the next battle is back on it (campaign.js battleDifficulty).
    const easier = (res.diff || prefs().difficulty) !== 'story';
    let m = null;
    const build = (sel = 0) => { m?.destroy(); m = menu(w.querySelector('.k-body'), [{ id: 'retry', label: 'Retry Battle' }, { id: 'formation', label: 'Change Formation' }, { id: 'map', label: 'Return to Map' },
      ...(easier ? [{ id: 'story', label: 'Retry on Story', right: 'this battle only', cls: 'rs-once' }] : []), ...(advise ? [{ id: 'shop', label: 'Optimize from shop', right: adv.cost ? `${adv.cost.toLocaleString('en-US')} G` : 'chest' }] : []), ...(lp.length ? [{ id: 'learn', label: 'Learn recommended', right: `${lp.reduce((t, x) => t + x.picks.length, 0)}` }] : [])], {
      sel, onPick: async (it) => {
        if (it.id === 'learn') {
          m.release();
          const rows = []; for (const { r, picks } of lp) picks.forEach((p, i) => rows.push(`<span class="qm-row"><span class="nm">${i ? '' : esc(r.name)}</span><span class="it"><b>${esc(p.name)}</b></span><span class="g k-blue">${p.cost} JP</span></span>`));
          const pick = await dialog('Learn Recommended', `<span class="qm-lead">Each soldier learns the strongest ability the JP buys:</span><span class="qm-list">${rows.slice(0, 9).join('')}${rows.length > 9 ? `<span class="qm-row k-dim"><span></span><span>+${rows.length - 9} more</span><span></span></span>` : ''}</span>`, [{ id: 'ok', label: 'Learn' }, { id: 'no', label: 'Not now' }], { cls: 'qm-win' });
          if (pick === 'ok') { for (const { r, picks } of lp) applyLearn(r, picks); writeSave(sv); sfx('levelup'); w.querySelector('.rs-jp')?.remove(); lp = []; build(0); return; }
          build(3 + (easier ? 1 : 0) + (advise ? 1 : 0)); return;
        }
        if (it.id === 'shop') {
          m.release();
          const rows = planRowsHtml(adv.plan, { esc });
          const pick = await dialog('Quartermaster', `<span class="qm-list">${rows}</span><span class="qm-tot"><span>Cost <b class="k-gold">${adv.cost.toLocaleString('en-US')} G</b></span><span class="k-dim">Florins ${sv.florins.toLocaleString('en-US')} &rarr; ${(sv.florins - adv.cost).toLocaleString('en-US')}</span></span>`, [{ id: 'buy', label: 'Buy & equip' }, { id: 'no', label: 'Not now' }], { cls: 'qm-win' });
          if (pick === 'buy') { applyAdvice(sv, adv, partyRecords(sv)); writeSave(sv); sfx('levelup'); w.querySelector('.rs-advice')?.remove(); advise = false; build(0); return; }
          build(3 + (easier ? 1 : 0)); return;
        }
        m.release(); if (it.id === 'story') { launch(sv, b.id, { diff: 'story' }); } else if (it.id === 'retry') { beginBattle(sv, b.id); launch(sv, b.id); } else if (it.id === 'formation') go('formation', { battle: b.id }); else go('map', { focus: b.id }); } });
    };
    build(0);
    return () => m?.destroy();
  }
  // R18 (review17 R5): one centred grid (report | side column) sized from the live viewport in CSS, so a resize while the
  // tally runs re-lays it out; the Continue window sits at the foot of the side column.
  const wrap = h('div', 'rs-wrap'); el.appendChild(wrap);
  const list = win('Company Report', 'rs-list'); wrap.appendChild(list);
  const side = h('div', 'rs-side'); wrap.appendChild(side);
  const spoils = win('Spoils', 'rs-spoils', `<div class="rs-florins"><span class="k-small k-dim">Florins</span><b class="n">0</b></div><div class="k-small k-dim rs-total">Treasury ${sv.florins.toLocaleString('en-US')}</div>${res.firstClear ? '' : '<div class="k-small k-dim">Repeat bounty (60%)</div>'}`);
  side.appendChild(spoils);
  // item drops: spoils of the field, and a boss's relic on the first clear (stamped, glowing)
  const drops = (res.drops || []).filter((d) => ITEMS[d.id]);
  if (drops.length) {
    const dl = h('div', 'rs-drops'); spoils.querySelector('.k-body').appendChild(dl);
    for (const d of drops) { const it = ITEMS[d.id];
      dl.appendChild(h('div', `rs-drop${d.rare ? ' rare' : ''}`, `${iconHtml(d.id)}<div class="rs-dt"><b>${esc(it.name)}</b><span class="k-small k-dim">${esc(describe(d.id))}</span></div>${d.relic ? '<span class="rs-relic">Relic</span>' : d.rare ? '<span class="rs-relic">Rare</span>' : ''}`)); }
    dl.appendChild(h('div', 'k-small k-dim rs-chest', 'Added to the company chest.'));
  }
  const body = list.querySelector('.k-body');
  const E = PR.EXP_PER_LEVEL();
  const rows = res.units.map((u) => {
    const r = byId.get(u.id); if (!r) return null;
    const row = h('div', 'rs-row'); row.appendChild(portraitEl(PR.CLASSES[u.cls]?.sprite, 'k-portrait sm', u.name[0]));
    // bar starts at the pre-battle EXP (derived from the gain), fills to 100 per level gained, lands on the current EXP
    const expBefore = ((r.exp - (u.expGained - u.levelsGained * E)) % E + E) % E;
    const st = res.stats?.[u.id]; const did = st ? [st.kills ? `${st.kills} defeated` : null, st.dmg ? `${st.dmg} dmg` : null, st.heal ? `${st.heal} healed` : null].filter(Boolean).join(' &middot; ') : '';
    row.appendChild(h('div', 'rs-info', `<div class="rs-name">${esc(u.name)} <span class="k-small k-dim">${esc(PR.className(u.cls))}</span>${did ? `<span class="rs-did k-small">${did}</span>` : ''}${st?.ko ? '<span class="rs-fell k-small">Fell</span>' : ''}</div>
      <div class="rs-lines k-small"><span class="lv">Lv <b class="lvn">${u.lvl - u.levelsGained}</b></span><div class="k-bar"><i style="width:${expBefore / E * 100}%"></i></div><span class="g">EXP <b>+${u.expGained}</b></span></div>
      <div class="rs-lines k-small"><span class="lv">Job <b class="jln">${(u.jobLv ?? 1) - (u.jobLevelsGained || 0)}</b></span><div class="k-bar jp"><i style="width:0%"></i></div><span class="g jp">JP <b>+${u.jpGained}</b>${u.spill ? ` <span class="k-dim">(+${u.spill})</span>` : ''}</span></div>`));
    const stamp = h('div', 'rs-stamp'); row.appendChild(stamp);
    body.appendChild(row); return { row, u, r, expBefore, stamp };
  }).filter(Boolean);
  if (!rows.length) body.appendChild(h('div', 'k-small k-dim', 'No reports.'));
  if (res.recruits?.length) {
    const rw = win('New Recruit', 'rs-recruit'); side.appendChild(rw);
    for (const n of res.recruits) { const e = h('div', 'rs-rec'); e.appendChild(portraitEl(PR.CLASSES[n.cls]?.sprite, 'k-portrait md', n.name[0])); e.appendChild(h('div', '', `<div class="rs-name">${esc(n.name)}</div><div class="k-small">${esc(PR.className(n.cls))} &middot; Lv ${n.lvl}</div><div class="k-small k-gold">joins the company!</div>`)); rw.querySelector('.k-body').appendChild(e); }
  }
  const unlockedAll = res.units.flatMap((u) => (u.unlocked || []).map((c) => `${u.name}: ${PR.className(c)}`));
  if (unlockedAll.length) side.appendChild(win('Jobs Unlocked', 'rs-unlock', unlockedAll.map((t) => `<div class="k-small">${esc(t)}</div>`).join('')));

  // ---- animate ----
  let skip = false; const wait = (ms) => (skip ? Promise.resolve() : sleep(ms));
  off = pushKeys((k) => { if (k === 'ok' || k === 'back') skip = true; else return false; });
  el.addEventListener('click', () => { skip = true; });
  await wait(500);
  const florinsEl = spoils.querySelector('.n'); const t0 = performance.now();
  const countFlorins = () => { const k = skip ? 1 : Math.min(1, (performance.now() - t0) / 1200); florinsEl.textContent = `+${Math.round(res.florins * k).toLocaleString('en-US')}`; if (k < 1) requestAnimationFrame(countFlorins); };
  countFlorins();
  spoils.querySelectorAll('.rs-drop').forEach((e, i) => { e.style.animationDelay = skip ? '0s' : `${0.5 + i * 0.35}s`; e.classList.add('in'); });
  for (const x of rows) {
    const bar = x.row.querySelector('.k-bar i'), jbar = x.row.querySelector('.k-bar.jp i');
    const total = x.expBefore + x.u.expGained; const laps = Math.floor(total / E);
    for (let l = 0; l < laps; l++) { bar.classList.add('gain'); bar.style.width = '100%'; await wait(700); bar.style.transition = 'none'; bar.style.width = '0%'; void bar.offsetWidth; bar.style.transition = '';
      x.row.querySelector('.lvn').textContent = String(x.u.lvl - x.u.levelsGained + l + 1); x.stamp.innerHTML = '<span>Level Up!</span>'; x.stamp.classList.remove('pop'); void x.stamp.offsetWidth; x.stamp.classList.add('pop'); if (!skip) sfx('levelup'); }
    bar.style.width = `${(total % E) / E * 100}%`;
    const jp = x.u.jpGained; jbar.style.width = `${Math.min(100, jp / 2)}%`;
    if (x.u.jobLevelsGained) { x.row.querySelector('.jln').textContent = String(x.u.jobLv); x.stamp.innerHTML += '<span class="jb">Job Lv Up</span>'; x.stamp.classList.add('pop'); }
    await wait(260);
  }
  skip = true; off(); off = null;
  const cw = win(null, 'rs-next'); side.appendChild(cw);
  const outro = res.firstClear ? b.outro : null;
  const m = menu(cw.querySelector('.k-body'), [{ id: 'go', label: 'Continue' }], { onPick: () => { m.release();
    if (outro?.length) return go('story', { battle: b.id, lines: outro, then: b.final ? 'end' : 'map', epilogue: true });
    return go('map', { focus: b.id }); } });
  return () => { off?.(); m.destroy(); };
}
