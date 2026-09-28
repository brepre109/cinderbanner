// Formation / party screen: pick up to five, change jobs, buy abilities with JP, and set the secondary skillset and
// the reaction / support / movement slots. Every change autosaves. From a battle node the last row is "Depart".
// Focus: roster list -> (Enter) unit commands -> (Enter) picker. Esc steps back out; Esc on the roster leaves.
import { h, esc, win, menu, sfx, pushKeys, portraitEl, bodySprite, setScene, dialog } from '../kit.js';
import { loadSave, writeSave } from '../save.js';
import { NODE, objectiveText } from '../data.js';
import { enemiesFor, recLevel, upgradeAdvice, applyAdvice, partyRecords, planRowsHtml } from '../campaign.js';
import * as PR from '../progress.js';
import { launch } from './worldmap.js';
import { openEquip } from './equip.js';
import { ITEMS, SLOTS, SLOT_NAME, fitEquip, ensureEquip } from '../../game/equipment.js';
import { iconHtml, slotGhost } from '../icons.js';
import { DIFFICULTIES, difficulty, prefs, setPrefs } from '../../ui/prefs.js';
import { recommendLearn, applyLearn, spareJp, JP_NUDGE } from '../../game/progression.js';

const MAXP = 5;

export async function show(el, arg, { go }) {
  setScene('formation');   // QA r12: the audio item ships a Formation theme (themes.js formationTheme) that no screen ever asked for
  const sv = loadSave(); const b = arg?.battle ? NODE[arg.battle] : null;
  // R15 (review15 P8): the first-turn Field Manual is for a save's first battle. A company that has already won a field
  // (any cleared node: a Chapter II save, an imported or older save that never set the flag) is marked as taught here,
  // so the plate never covers the field again.
  if (!sv.seen?.tutorial && Object.values(sv.cleared || {}).some(Boolean)) { sv.seen = { ...(sv.seen || {}), tutorial: 1 }; writeSave(sv, { backup: false }); }
  el.innerHTML = `<div class="fm-bg"></div>
    <div class="k-hint fm-hint"></div>`;
  // PLAYTEST r9: the key line follows the focus. It used to say "Enter Commands / Esc Back" in every mode, never
  // mentioned that Left/Right deploys a unit, and Esc on the roster actually leaves for the map.
  const hintEl = el.querySelector('.fm-hint');
  const HINTS = {
    roster: `<kbd>&uarr;</kbd><kbd>&darr;</kbd>Select<kbd>&larr;</kbd><kbd>&rarr;</kbd>Deploy<kbd>Enter</kbd>Commands<kbd>Esc</kbd>${b ? 'Map' : 'Done'}`,
    cmd: '<kbd>&uarr;</kbd><kbd>&darr;</kbd>Select<kbd>Enter</kbd>Choose<kbd>Esc</kbd>Back',
    pick: '<kbd>&uarr;</kbd><kbd>&darr;</kbd>Select<kbd>Enter</kbd>Set<kbd>Esc</kbd>Back',
    learn: '<kbd>&uarr;</kbd><kbd>&darr;</kbd>Select<kbd>Enter</kbd>Learn<kbd>Esc</kbd>Back',
    equip: '<kbd>&uarr;</kbd><kbd>&darr;</kbd>Select<kbd>Enter</kbd>Choose<kbd>Q</kbd><kbd>E</kbd>Unit<kbd>Esc</kbd>Back',
  };
  const hint = (m) => { hintEl.innerHTML = HINTS[m] || ''; };
  hint('roster');
  const head = win(null, 'fm-head'); el.appendChild(head);
  const rosterW = win('Company', 'fm-roster'); el.appendChild(rosterW);
  const unitW = win('Status', 'fm-unit'); el.appendChild(unitW);
  const foeW = b ? win('Enemy Forces', 'fm-foes') : null; if (foeW) el.appendChild(foeW);
  const save = () => writeSave(sv);
  const inParty = (r) => sv.party.includes(r.id);

  const drawHead = () => {
    head.querySelector('.k-body').innerHTML = `<span class="fm-title">Formation</span>${b ? `<span class="fm-dest"><span class="k-small k-dim">Destination</span> ${esc(b.name)}</span>` : ''}
      <span class="fm-count"><span class="k-small k-dim">Deployed</span> <b>${sv.party.length}</b>/${MAXP}</span><span class="fm-florins"><span class="k-small k-dim">Florins</span> ${sv.florins.toLocaleString('en-US')}</span>`;
  };
  if (foeW) {
    const body = foeW.querySelector('.k-body'); body.innerHTML = `<div class="k-small fm-foelv">Enemy Lv ${recLevel(sv, b)}</div><div class="fm-foelist"></div>
      <div class="fm-warn k-small"></div>
      <div class="fm-brief k-small"><span class="k-dim">${esc(b.blurb)}</span><span><span class="k-dim">Victory:</span> ${esc(objectiveText(b).win)}${b.objective?.protect ? ` <span class="k-dim">&middot; Defeat:</span> ${esc(objectiveText(b).lose)}` : ''}</span></div>`;
    const list = body.querySelector('.fm-foelist');
    for (const e of enemiesFor(sv, b)) { const r = h('div', 'fm-foe'); r.appendChild(portraitEl(PR.CLASSES[e.cls]?.sprite, 'k-portrait sm enemy', e.name[0])); r.appendChild(h('div', 'k-small', `<b>${esc(e.name)}</b><br><span class="k-dim">${esc(PR.className(e.cls))} Lv ${e.lvl}</span>`)); list.appendChild(r); }
  }

  // ---- R15 (review15 P5): say what a casual player is never told. Unspent JP (something learnable right now) and a
  // deployed soldier 3+ levels under the enemy's best are flagged on the roster row and listed in the Enemy Forces window.
  const eLv = b ? recLevel(sv, b) : 0;
  const canLearn = (r) => { try { return PR.learnable(r).some((a) => a.available); } catch (e) { return false; } };
  const under = (r) => b && inParty(r) && r.lvl <= eLv - 3;
  // ---- R16 SHOP NUDGE: what the quartermaster would buy and hand out for the deployed five (campaign.upgradeAdvice).
  // Named in the Enemy Forces window, offered as a roster row, and asked once at Depart (from the second field on).
  let adv = null; let nudged = false; let jpNudged = false;
  const advise = () => { try { adv = upgradeAdvice(sv, partyRecords(sv)); } catch (e) { console.warn('upgradeAdvice', e); adv = null; } return adv; };
  const gearLine = (a) => {
    if (!a?.plan.length) return '';
    return a.shopSouls && a.town ? `Better gear at ${a.town.name}: ${a.souls} soldier${a.souls > 1 ? 's' : ''} can upgrade` : `Better gear in the chest: ${a.souls} soldier${a.souls > 1 ? 's' : ''} can upgrade`;
  };
  const planHtml = (a) => {
    const rows = planRowsHtml(a.plan, { esc });
    return `<span class="qm-lead">${esc(gearLine(a))}.</span><span class="qm-list">${rows}</span>`
      + `<span class="qm-tot"><span>Cost <b class="k-gold">${a.cost.toLocaleString('en-US')} G</b></span><span class="k-dim">Florins ${sv.florins.toLocaleString('en-US')} &rarr; ${(sv.florins - a.cost).toLocaleString('en-US')}</span></span>`;
  };
  // 'Optimize from shop': confirm the list with its costs, then buy and put everything on. Resolves true if applied.
  const quartermaster = async () => {
    const a = advise(); if (!a?.plan.length) { flash('Nothing to upgrade with the florins on hand.'); return false; }
    const pick = await dialog('Quartermaster', planHtml(a), [{ id: 'buy', label: a.cost ? `Buy & equip (${a.cost.toLocaleString('en-US')} G)` : 'Equip from the chest' }, { id: 'no', label: 'Not now' }], { cls: 'qm-win' });
    if (pick !== 'buy') return false;
    const n = applyAdvice(sv, a, partyRecords(sv)); save(); sfx('levelup');
    flash(`${n} piece${n === 1 ? '' : 's'} of gear put on${a.cost ? ` for ${a.cost.toLocaleString('en-US')} florins` : ''}.`); return true;
  };
  // ---- R17 JP NUDGE: 'Learn recommended' (progression.recommendLearn: the job's strongest affordable action, then its
  // R/S/M). Per soldier in the unit commands, for the whole company as a roster row, and asked once at Depart
  // ('Before you march') when two or more deployed soldiers sit on JP_NUDGE+ spendable JP.
  const recOf = (r) => { try { return recommendLearn(r); } catch (e) { console.warn('recommendLearn', e); return []; } };
  const learnPlan = (recs) => recs.map((r) => ({ r, picks: recOf(r) })).filter((x) => x.picks.length);
  const jpHeavy = () => sv.roster.filter(inParty).filter((r) => spareJp(r) >= JP_NUDGE);
  const learnHtml = (plan, lead) => {
    const rows = []; for (const { r, picks } of plan) picks.forEach((p, i) => rows.push(`<span class="qm-row"><span class="nm">${i ? '' : esc(r.name)}</span><span class="it">${p.kind === 'action' ? '' : `<span class="k-dim">${esc({ reaction: 'R', support: 'S', movement: 'M' }[p.kind] || '')}</span> `}<b>${esc(p.name)}</b></span><span class="g k-blue">${p.cost} JP</span></span>`));
    const jp = plan.reduce((t, x) => t + x.picks.reduce((a, p) => a + p.cost, 0), 0);
    return `<span class="qm-lead">${esc(lead)}</span><span class="qm-list">${rows.slice(0, 9).join('')}${rows.length > 9 ? `<span class="qm-row k-dim"><span></span><span>+${rows.length - 9} more</span><span></span></span>` : ''}</span>`
      + `<span class="qm-tot"><span>JP spent <b class="k-blue">${jp}</b></span><span class="k-dim">${plan.length} soldier${plan.length === 1 ? '' : 's'}</span></span>`;
  };
  // confirm the picks, then learn them. Resolves true if applied.
  const learnRecommended = async (recs, title = 'Learn Recommended') => {
    const plan = learnPlan(recs); if (!plan.length) { flash('Nothing to learn with the JP on hand.'); return false; }
    const n = plan.reduce((t, x) => t + x.picks.length, 0);
    const pick = await dialog(title, learnHtml(plan, plan.length === 1 ? `${plan[0].r.name} can learn:` : 'Each soldier learns the strongest ability the JP buys, then reaction / support skills:'),
      [{ id: 'learn', label: `Learn ${n} abilit${n === 1 ? 'y' : 'ies'}` }, { id: 'no', label: 'Not now' }], { cls: 'qm-win' });
    if (pick !== 'learn') return false;
    let got = 0; for (const { r, picks } of plan) { got += applyLearn(r, picks); gearFit(r); }
    save(); sfx('levelup'); flash(`${got} abilit${got === 1 ? 'y' : 'ies'} learned.`); return true;
  };
  const drawWarn = () => {
    const w = foeW?.querySelector('.fm-warn'); if (!w) return;
    const deployed = sv.roster.filter(inParty); const jp = deployed.filter(canLearn); const lo = deployed.filter(under);
    const lines = [];
    if (adv?.plan.length) lines.push(`<span class="w-gear">${esc(gearLine(adv))} (Optimize)</span>`);
    if (jp.length) lines.push(`<span class="w-jp">Unspent JP: ${jp.slice(0, 3).map((r) => `${esc(r.name)} ${r.jp?.[r.cls] ?? 0}`).join(', ')}${jp.length > 3 ? ` +${jp.length - 3}` : ''} &mdash; Learn recommended</span>`);
    if (lo.length) lines.push(`<span class="w-lv">Underleveled vs Enemy Lv ${eLv}: ${lo.slice(0, 3).map((r) => `${esc(r.name)} Lv ${r.lvl}`).join(', ')}${lo.length > 3 ? ` +${lo.length - 3}` : ''}</span>`);
    w.innerHTML = lines.join(''); w.style.display = lines.length ? '' : 'none'; foeW.classList.toggle('has-warn', lines.length > 0);
  };

  // ---- unit detail ----
  const drawUnit = (r) => {
    const body = unitW.querySelector('.k-body'); body.innerHTML = '';
    if (r === '__diff') { const d = difficulty(); body.innerHTML = `<div class="fm-depart"><div class="k-disp">${esc(d.label)}</div><div class="k-small">${esc(d.desc)}</div><div class="k-small k-dim">${DIFFICULTIES.map((x) => x.id === d.id ? `<b>${esc(x.label)}</b>` : esc(x.label)).join(' &middot; ')} &mdash; &larr; &rarr; or Enter to change. Applies to every battle.</div></div>`; return; }
    if (r === '__learn') { const plan = learnPlan(sv.roster); const n = plan.reduce((t, x) => t + x.picks.length, 0);
      body.innerHTML = `<div class="fm-depart"><div class="k-disp">Training</div><div class="k-small">${n ? `${plan.length} soldier${plan.length === 1 ? '' : 's'} can learn ${n} abilit${n === 1 ? 'y' : 'ies'} with the JP on hand.` : 'Nothing to learn with the JP on hand.'}</div><div class="k-small k-dim">${n ? `Each soldier learns the strongest ability of the current job the JP buys, then its reaction / support skills. You see the list before any JP is spent.` : ''}</div></div>`; return; }
    if (r === '__shop') { const a = adv; body.innerHTML = `<div class="fm-depart"><div class="k-disp">Quartermaster</div><div class="k-small">${a?.plan.length ? `${esc(gearLine(a))}.` : 'The company wears the best it can afford.'}</div><div class="k-small k-dim">${a?.plan.length ? `Buys and puts on the best affordable upgrades for the deployed soldiers (${a.cost.toLocaleString('en-US')} florins). You see the list and the cost before anything is spent.` : ''}</div></div>`; return; }
    if (!r) { body.innerHTML = `<div class="fm-depart"><div class="k-disp">Depart</div><div class="k-small">${sv.party.length ? `${sv.party.length} will take the field at ${esc(b?.name || '')}.` : 'Deploy at least one unit.'}</div></div>`; return; }
    const s = PR.recordStats(r); const jp = r.jp?.[r.cls] ?? 0; const jlv = r.jobLv?.[r.cls] ?? 1;
    const top = h('div', 'fm-top'); top.appendChild(portraitEl(PR.CLASSES[r.cls]?.sprite, 'k-portrait', r.name[0]));
    const fig = h('div', 'fm-fig'); bodySprite(PR.CLASSES[r.cls]?.sprite).then((bs) => { if (bs) fig.innerHTML = `<img src="${bs.url}" style="height:${Math.min(120, bs.h * 1)}px">`; });
    top.appendChild(h('div', 'fm-id', `<div class="fm-name">${esc(r.name)}${r.hero ? '<span class="fm-hero">Leader</span>' : ''}${inParty(r) ? '<span class="fm-dep">Deployed</span>' : ''}</div>
      <div class="fm-job">${esc(PR.className(r.cls))} <span class="k-small k-dim">${esc(PR.CLASSES[r.cls]?.role || '')}</span></div>
      <div class="fm-lv k-small"><span>Lv <b>${r.lvl}</b></span><span>Job Lv <b>${jlv}</b></span><span>JP <b class="k-blue">${jp}</b></span><span>Resolve <b>${r.brv}</b></span></div>
      <div class="fm-exp"><span class="k-small k-dim">Exp</span><div class="k-bar"><i style="width:${Math.min(100, r.exp / PR.EXP_PER_LEVEL())}%"></i></div><span class="k-small">${r.exp}/${PR.EXP_PER_LEVEL()}</span></div>`));
    top.appendChild(fig); body.appendChild(top);
    const stat = (k, v) => `<div class="st"><span class="k">${k}</span><b>${v}</b></div>`;
    body.appendChild(h('div', 'fm-stats k-small', stat('HP', s.hp) + stat('MP', s.mp) + stat('Atk', s.atk) + stat('Def', s.def) + stat('Mag', s.mag) + stat('Res', s.res) + stat('Spd', s.spd) + stat('Move', s.move) + stat('Jump', s.jump) + stat('Eva', s.eva ?? '-')));
    const slot = (k, v, dim) => `<div class="sl"><span class="k">${k}</span><b class="${dim ? 'k-dim' : ''}">${esc(v)}</b></div>`;
    ensureEquip(r);
    body.appendChild(h('div', 'fm-gear', SLOTS.map((g) => { const it = ITEMS[r.equip[g]]; return `<div class="gi" title="${esc(it ? it.name : SLOT_NAME[g])}">${it ? iconHtml(it.id) : slotGhost(g)}<span class="${it ? '' : 'k-dim'}">${esc(it ? it.name : SLOT_NAME[g])}</span></div>`; }).join('')));
    body.appendChild(h('div', 'fm-slots', slot('Primary', PR.skillsetName(r.cls)) + slot('Secondary', r.secondary ? PR.skillsetName(r.secondary) : '—', !r.secondary)
      + slot('Reaction', PR.slotName('reaction', r.reaction), !r.reaction) + slot('Support', PR.slotName('support', r.support), !r.support) + slot('Movement', PR.slotName('movement', r.movement), !r.movement)));
  };

  // ---- roster list ----
  let rm = null; let rsel = 0; let mode = 'roster';
  const rows = () => sv.roster.map((r) => ({ id: r.id, r, html: rosterRow(r), cls: inParty(r) ? 'on' : '' }));
  function rosterRow(r) {
    const flags = `${canLearn(r) ? '<i class="fm-flag" title="JP to spend: Learn Abilities">JP</i>' : ''}${under(r) ? `<i class="fm-flag lv" title="Enemy Lv ${eLv}">&minus;${eLv - r.lvl}</i>` : ''}`;
    return `<span class="tick${inParty(r) ? ' on' : ''}"></span><span class="rn"><b>${esc(r.name)}</b><i>${esc(PR.className(r.cls))}</i></span><span class="rl k-small"><span>Lv ${r.lvl}</span>${flags ? `<span>${flags}</span>` : ''}</span>`;
  }
  const diffHtml = () => `<span class="fm-diff"><span class="k-dim">Difficulty</span><b>&#9664; ${esc(difficulty().label)} &#9654;</b></span>`;
  const cycleDiff = (d = 1) => {
    const i = DIFFICULTIES.findIndex((x) => x.id === prefs().difficulty); const n = DIFFICULTIES[(Math.max(0, i) + d + DIFFICULTIES.length) % DIFFICULTIES.length];
    setPrefs({ difficulty: n.id }); sfx('cursor');
    if (foeW) { const keep = foeW.querySelector('.fm-foelist'); keep.innerHTML = ''; for (const e of enemiesFor(sv, b)) { const r = h('div', 'fm-foe'); r.appendChild(portraitEl(PR.CLASSES[e.cls]?.sprite, 'k-portrait sm enemy', e.name[0])); r.appendChild(h('div', 'k-small', `<b>${esc(e.name)}</b><br><span class="k-dim">${esc(PR.className(e.cls))} Lv ${e.lvl}</span>`)); keep.appendChild(r); }
      foeW.querySelector('.fm-foelv').textContent = `Enemy Lv ${recLevel(sv, b)}`; }
    const keep = rsel; buildRoster(); rm.set(keep);
  };
  const buildRoster = () => {
    rm?.destroy(); const items = rows(); if (b) items.push({ id: '__depart', html: '<span class="fm-go">Depart for battle</span>', cls: 'depart', enabled: sv.party.length > 0 });
    { const plan = learnPlan(sv.roster); if (plan.length) items.push({ id: '__learn', html: '<span class="fm-shop">Learn recommended</span>', right: `${plan.reduce((t, x) => t + x.picks.length, 0)}`, cls: 'shop' }); }
    advise(); if (adv?.plan.length) items.push({ id: '__shop', html: '<span class="fm-shop">Optimize from shop</span>', right: adv.cost ? `${adv.cost.toLocaleString('en-US')} G` : 'chest', cls: 'shop' });
    items.push({ id: '__diff', html: diffHtml(), cls: 'diff', sound: 'cursor' });
    items.push({ id: '__back', html: `<span class="fm-back">${b ? 'Back to map' : 'Done'}</span>`, cls: 'back', sound: 'cancel' });
    const body = rosterW.querySelector('.k-body'); body.innerHTML = '';
    rm = menu(body, items, { sel: rsel, cls: 'fm-list', keys: false, onMove: (it, i) => { rsel = i; drawUnit(it.r || (it.id === '__diff' || it.id === '__shop' || it.id === '__learn' ? it.id : null)); }, onPick: (it) => pickRoster(it) });
    // portraits beside names
    rm.el.querySelectorAll('.k-item').forEach((row, i) => { const it = items[i]; if (it.r) row.prepend(portraitEl(PR.CLASSES[it.r.cls]?.sprite, 'k-portrait fm-mini', it.r.name[0]));
      // the deploy box is a real control for the mouse too (keyboard: Left/Right)
      const tk = row.querySelector('.tick'); if (tk && it.r) { tk.title = ''; tk.addEventListener('click', (e) => { e.stopPropagation(); if (mode !== 'roster') return; rm.set(i); if (toggle(it.r)) { sfx('confirm'); refresh(it.r); } }); } });
    drawHead(); drawWarn();
  };
  const pickRoster = async (it) => {
    if (it.id === '__back') return leave();
    if (it.id === '__diff') return cycleDiff(1);
    if (it.id === '__learn') { mode = 'dlg'; const ok = await learnRecommended(sv.roster, 'Learn Recommended for All'); mode = 'roster'; const keep = rsel; buildRoster(); rm.set(Math.min(keep, rm.items.length - 1)); if (ok) drawUnit(sv.roster[0]); return; }
    if (it.id === '__shop') { mode = 'dlg'; const ok = await quartermaster(); mode = 'roster'; const keep = rsel; buildRoster(); rm.set(Math.min(keep, rm.items.length - 1)); if (ok) drawUnit(sv.roster[0]); return; }
    if (it.id === '__depart') {
      if (!sv.party.length) return;
      // Depart nudges, asked once each: gear (from the second field on; the first departure goes straight from the
      // prologue into b1) and JP (R17: two or more deployed soldiers with JP_NUDGE+ spendable JP). One dialog names
      // both; taking one comes back to the dialog while the other is still open.
      const veteran = Object.values(sv.cleared || {}).some(Boolean);
      for (let g = 0; g < 3; g++) {
        const gearDue = !nudged && adv?.plan.length && veteran; const heavy = jpNudged ? [] : jpHeavy(); const jpDue = heavy.length >= 2;
        if (!gearDue && !jpDue) break;
        mode = 'dlg';
        const lines = []; if (jpDue) lines.push(`Unspent JP: ${heavy.slice(0, 3).map((r) => `${esc(r.name)} ${spareJp(r)}`).join(', ')}${heavy.length > 3 ? ` +${heavy.length - 3}` : ''}.`); if (gearDue) lines.push(`${esc(gearLine(adv))}.`);
        const opts = []; if (jpDue) opts.push({ id: 'learn', label: 'Learn recommended for all' }); if (gearDue) opts.push({ id: 'opt', label: 'Optimize from shop', right: adv.cost ? `${adv.cost.toLocaleString('en-US')} G` : 'chest' });
        opts.push({ id: 'go', label: 'Depart anyway' }, { id: 'back', label: 'Back to Formation' });
        const pick = await dialog('Before you march', lines.join('<br>'), opts);
        mode = 'roster';
        const redraw = () => { const keep = rsel; buildRoster(); rm.set(Math.min(keep, rm.items.length - 1)); };
        if (pick === 'learn') { jpNudged = true; mode = 'dlg'; const ok = await learnRecommended(sv.roster, 'Learn Recommended for All'); mode = 'roster'; redraw(); if (!ok) return; continue; }
        if (pick === 'opt') { nudged = true; mode = 'dlg'; const ok = await quartermaster(); mode = 'roster'; redraw(); if (!ok) return; continue; }
        if (pick !== 'go') return;
        nudged = true; jpNudged = true; break;
      }
      save(); mode = 'gone';
      // QA r12: Map -> node -> Formation -> Depart skipped the node's intro scene for good (only Engage played it), so a
      // player who checked the formation first never saw the story beat. An unseen intro now plays on the way out.
      const lines = sv.seen[b.id + ':in'] ? [] : (b.intro || []);
      if (lines.length) return go('story', { battle: b.id, lines, then: 'depart' });
      return launch(sv, b.id); }
    openCmd(it.r);
  };
  const leave = () => { save(); mode = 'gone'; go('map', { focus: b?.id }); };
  const toggle = (r) => {
    if (inParty(r)) { if (sv.party.length <= 1) { sfx('buzz'); return false; } sv.party = sv.party.filter((x) => x !== r.id); }
    else { if (sv.party.length >= MAXP) { sfx('buzz'); flash(`Only ${MAXP} may take the field.`); return false; } sv.party.push(r.id); }
    save(); return true;
  };

  // ---- unit commands ----
  let cm = null;
  const closeCmd = () => { cm?.m.destroy(); cm?.w.remove(); cm?.d?.remove(); cm = null; mode = 'roster'; hint('roster'); };
  const openCmd = (r) => {
    closeCmd(); mode = 'cmd';
    const w = win(r.name, 'fm-cmd'); el.appendChild(w);
    const eq = PR.equippable(r); const lrn = PR.learnable(r);
    const nextBuy = lrn.filter((a) => !a.learned).sort((a, c) => a.cost - c.cost)[0]; const recPicks = recOf(r);
    const items = [
      { id: 'deploy', label: inParty(r) ? 'Withdraw' : 'Deploy', desc: inParty(r) ? 'Leave this unit behind for the next battle.' : `Send this unit into the next battle (up to ${MAXP}).` },
      { id: 'job', label: 'Change Job', desc: 'Switch job. Learned skills stay with the unit and can be carried as a secondary.' },
      { id: 'learn', label: 'Learn Abilities', right: `${r.jp?.[r.cls] ?? 0} JP`, enabled: lrn.length > 0,
        desc: `Spend JP on ${PR.skillsetName(r.cls)} skills.${nextBuy && !nextBuy.available ? ` Next: ${nextBuy.name} (${nextBuy.lvReq > (r.jobLv?.[r.cls] ?? 1) ? `needs Job Lv ${nextBuy.lvReq}` : `${nextBuy.cost} JP`}). Earn JP by acting in battle.` : ''}` },
      { id: 'recommend', label: 'Learn recommended', right: recPicks.length ? `${recPicks.length}` : '', enabled: recPicks.length > 0,
        desc: recPicks.length ? `Learn ${recPicks.map((p) => p.name).join(', ')} (${recPicks.reduce((t, p) => t + p.cost, 0)} JP). You confirm first.` : 'Nothing to learn with the JP on hand. Earn JP by acting in battle.' },
      { id: 'equip', label: 'Equip', right: 'gear', desc: 'Weapon, offhand, head, body and accessory from the company chest. Optimize picks the best of each.' },
      { id: 'secondary', label: 'Secondary', enabled: eq.secondary.length > 0, right: eq.secondary.length ? '' : 'none yet',
        desc: eq.secondary.length ? 'Carry another job\'s learned skills into battle alongside this job.' : 'Learn skills in a second job first (Change Job), then carry them here as a secondary skillset.' },
      { id: 'reaction', label: 'Reaction', enabled: eq.reaction.length > 0, right: eq.reaction.length ? '' : 'none yet', desc: 'A skill that fires by itself when this unit is attacked.' },
      { id: 'support', label: 'Support', enabled: eq.support.length > 0, right: eq.support.length ? '' : 'none yet', desc: 'A passive bonus that is always on.' },
      { id: 'movement', label: 'Movement', enabled: eq.movement.length > 0, right: eq.movement.length ? '' : 'none yet', desc: 'A passive that changes how this unit moves.' },
    ];
    const d = win(null, 'fm-desc'); el.appendChild(d);
    const m = menu(w.querySelector('.k-body'), items, { onBack: closeCmd, onPick: (it) => cmdPick(r, it), onMove: (it) => { d.querySelector('.k-body').innerHTML = `<b>${esc(it.label)}</b> <span class="k-small">${esc(it.desc || '')}</span>`; } });
    cm = { w, m, d }; hint('cmd');
  };
  const refresh = (r, reopenAt) => { const keep = rsel; buildRoster(); rm.set(keep); drawUnit(r); if (reopenAt != null) { openCmd(r); cm.m.set(reopenAt); } };
  const cmdPick = async (r, it) => {
    const at = cm.m.sel;
    if (it.id === 'deploy') { toggle(r); refresh(r, at); return; }
    if (it.id === 'equip') {
      closeCmd(); mode = 'equip'; hint('equip');
      return openEquip(el, { sv, list: sv.roster, index: sv.roster.indexOf(r), save, onSwap: (rr) => { rsel = sv.roster.indexOf(rr); rm.set(rsel); }, onClose: (rr) => { mode = 'roster'; rsel = sv.roster.indexOf(rr); refresh(rr, 4); } });
    }
    if (it.id === 'job') return picker(r, 'Change Job', PR.jobsFor(r).map((j) => ({ id: j.cls, label: j.name, right: j.unlocked ? `Lv ${j.jobLv || 1}` : 'Locked', enabled: j.unlocked, cls: j.current ? 'cur' : '',
      desc: j.unlocked ? `${j.role || ''}${j.jp ? ` · ${j.jp} JP banked` : ''}${j.mastered ? ' · Mastered' : ''}` : `Requires ${j.reqs.filter((q) => !q.met).map((q) => q.text).join(', ')}` })),
      (id) => { const ok = PR.setJob(r, id); if (ok !== false) gearFit(r); return ok; }, at, true);
    if (it.id === 'learn') return learnPicker(r, at);
    if (it.id === 'recommend') { mode = 'dlg'; cm.m.release(); const ok = await learnRecommended([r]); refresh(r, at); if (ok) drawUnit(r); return; }
    if (it.id === 'secondary') { const eq = PR.equippable(r); return picker(r, 'Secondary', [{ id: null, label: 'None', desc: 'No secondary skillset.' }, ...eq.secondary.map((s) => ({ id: s.cls, label: s.name, cls: r.secondary === s.cls ? 'cur' : '', desc: `Use learned ${s.name} abilities alongside ${PR.skillsetName(r.cls)}.` }))], (id) => PR.setSecondary(r, id), at); }
    for (const slot of ['reaction', 'support', 'movement']) if (it.id === slot) {
      const eq = PR.equippable(r)[slot];
      return picker(r, it.label, [{ id: null, label: 'None', desc: 'Leave the slot empty.' }, ...eq.map((e) => ({ id: e.id, label: e.name, right: PR.className(e.from), cls: r[slot] === e.id ? 'cur' : '', desc: e.desc }))], (id) => { const ok = PR.equip(r, slot, id); if (ok !== false) gearFit(r); return ok; }, at);
    }
  };
  // ---- pickers ----
  let pk = null;
  const closePick = () => { pk?.m.destroy(); pk?.w.remove(); pk?.d.remove(); pk = null; mode = 'cmd'; hint('cmd'); };
  const picker = (r, title, items, apply, at, closeAll = false) => {
    mode = 'pick'; cm.m.release(); hint('pick'); cm.d?.remove();
    const w = win(title, 'fm-pick'); const d = win(null, 'fm-desc'); el.appendChild(w); el.appendChild(d);
    const cur = Math.max(0, items.findIndex((x) => x.cls === 'cur'));
    const back = () => { closePick(); openCmd(r); cm.m.set(at); };
    const m = menu(w.querySelector('.k-body'), items, { sel: cur, cls: 'small', onMove: (it) => { d.querySelector('.k-body').innerHTML = `<b>${esc(it.label)}</b> <span class="k-small">${esc(it.desc || '')}</span>`; },
      onBack: back,
      onPick: (it) => { if (apply(it.id) === false) { sfx('buzz'); return; } save(); closePick(); refresh(r, closeAll ? null : at); if (closeAll) { closeCmd(); } } });
    pk = { w, m, d, back };
  };
  const learnPicker = (r, at, sel = null) => {
    mode = 'pick'; cm.m.release(); hint('learn'); cm.d?.remove();
    const list = PR.learnable(r); const jp = r.jp?.[r.cls] ?? 0;
    const w = win(`${PR.skillsetName(r.cls)} · ${jp} JP`, 'fm-pick wide'); const d = win(null, 'fm-desc'); el.appendChild(w); el.appendChild(d);
    const kindTag = { action: '', reaction: 'R ', support: 'S ', movement: 'M ' };
    const items = list.map((a) => ({ id: a.id, html: `<span class="kt">${kindTag[a.kind] || ''}</span>${esc(a.name)}`, label: a.name, right: a.learned ? 'Learned' : a.available ? `${a.cost} JP` : a.lvReq > (r.jobLv?.[r.cls] ?? 1) ? `Job Lv ${a.lvReq}` : `${a.cost} JP`,
      enabled: a.available, cls: a.learned ? 'learned' : '', desc: a.desc, sound: 'levelup' }));
    // open on the first thing that can actually be bought (was: row 0, usually an already-learned skill)
    if (sel == null) { sel = items.findIndex((x) => x.enabled); if (sel < 0) sel = Math.max(0, items.findIndex((x) => x.cls !== 'learned')); }
    const m = menu(w.querySelector('.k-body'), items, { sel, cls: 'small', onMove: (it) => { d.querySelector('.k-body').innerHTML = `<b>${esc(it.label)}</b> <span class="k-small">${esc(it.desc || '')}${it.enabled ? '' : it.cls === 'learned' ? ' <span class="k-blue">(learned)</span>' : ` <span class="k-red">(${esc(it.right)})</span>`}</span>`; },
      onBack: () => pk.back(),
      onPick: (it, i) => { if (!PR.buy(r, it.id)) { sfx('buzz'); return; } save(); closePick(); drawUnit(r); learnPicker(r, at, i); } });
    pk = { w, m, d, back: () => { closePick(); refresh(r, at); } };
  };

  // A new job (or dropping Equip Shields / Dual Wield / ...) can leave gear the unit may no longer wear: it goes back to
  // the chest, and the player is told what came off.
  const gearFit = (r) => { const off = fitEquip(sv, r); if (off.length) setTimeout(() => flash(`To the chest: ${off.map((id) => ITEMS[id].name).join(', ')}`), 380); };
  let toast = null;
  const flash = (msg) => { toast?.remove(); toast = win(null, 'fm-toast', `<span class="k-small">${esc(msg)}</span>`); el.appendChild(toast); const t = toast; setTimeout(() => t.remove(), 1600); };

  const off = pushKeys((k) => {
    if (mode !== 'roster') return false;
    if (k === 'up') rm.move(-1); else if (k === 'down') rm.move(1); else if (k === 'ok') rm.pick();
    else if (k === 'back') { sfx('cancel'); leave(); }
    else if (k === 'left' || k === 'right') { const it = rm.items[rm.sel]; if (it?.id === '__diff') cycleDiff(k === 'left' ? -1 : 1); else if (it?.r && toggle(it.r)) { sfx('confirm'); refresh(it.r); } }
    else return false;
  });
  // Mouse: a click on the backdrop, or a right-click anywhere, steps back one layer (picker -> commands -> roster),
  // the same as Esc. Without it a mouse player had no way to close a command window.
  const backOne = () => { if (mode === 'pick' && pk?.back) { sfx('cancel'); pk.back(); } else if (mode === 'cmd') { sfx('cancel'); closeCmd(); } };
  el.addEventListener('click', (e) => { if (!e.target.closest('.k-win')) backOne(); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (mode === 'roster') return; backOne(); });
  buildRoster(); rm.set(0); drawUnit(sv.roster[0]);
  void dialog;
  return () => { off(); closePick(); closeCmd(); rm?.destroy(); };
}
