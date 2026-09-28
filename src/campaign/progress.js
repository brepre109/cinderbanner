// Adapter over the GAMEPLAY owner's src/game/progression.js. Every function is feature-detected: if the module (or
// one export) is missing or throws, a small built-in stand-in keeps the campaign playable. Loaded through
// import.meta.glob so a missing file is an empty map at build time, never an unresolved-import build failure.
import { CLASSES, ABILITIES, REACTIONS, SUPPORTS, MOVEMENTS } from '../game/data.js';

const mods = import.meta.glob('../game/progression.js');
let P = {};
export async function loadProgression() {
  const load = Object.values(mods)[0];
  if (load) { try { P = await load(); } catch (e) { console.warn('campaign: progression.js failed to load, using stand-ins', e); P = {}; } }
  return P;
}
const call = (name, fb) => (...a) => { if (typeof P[name] === 'function') { try { return P[name](...a); } catch (e) { console.warn(`progression.${name} threw; using stand-in`, e); } } return fb(...a); };

const actionsOf = (cls) => (CLASSES[cls]?.abilities || []).filter((id) => id !== 'attack' && ABILITIES[id] && !ABILITIES[id].hidden);
let seq = 0;
const fbRecruit = (cls, name, lvl = 1) => {
  const c = CLASSES[cls]; const sig = actionsOf(cls)[0];
  return { id: `r${Date.now().toString(36)}${(seq++).toString(36)}`, name: name || c.name, cls, lvl, exp: 0, brv: c.brv, jp: { [cls]: 0 }, jpTotal: { [cls]: 0 }, jobLv: { [cls]: 1 },
    learned: { [cls]: sig ? [sig] : [] }, secondary: null, reaction: c.reaction, support: c.support, movement: c.movement };
};
const fbApply = (records, summary) => {
  const out = [];
  for (const r of records) { const s = summary?.units?.[r.id]; if (!s) continue;
    const exp = 12 * ((s.actions || 0) + (s.kills || 0)) + (summary.winner === 'A' ? 10 : 0); r.exp += exp; let lv = 0; while (r.exp >= 100) { r.exp -= 100; r.lvl++; lv++; }
    const jp = 10 * (s.actions || 0) + 5 * (s.kills || 0); r.jp[r.cls] = (r.jp[r.cls] || 0) + jp;
    out.push({ id: r.id, name: r.name, cls: r.cls, expGained: exp, levelsGained: lv, jpGained: jp, spill: 0, jobLevelsGained: 0, unlocked: [], lvl: r.lvl, jobLv: r.jobLv[r.cls] || 1 }); }
  return out;
};

export const newRecruit = call('newRecruit', fbRecruit);
export const unitOpts = call('unitOpts', (r) => ({ recordId: r.id, lvl: r.lvl, brv: r.brv }));
export const enemyOpts = call('enemyOpts', (cls, lvl) => ({ lvl }));
export const applyResults = call('applyResults', fbApply);
export const jobsFor = call('jobsFor', (r) => [{ cls: r.cls, name: CLASSES[r.cls].name, role: CLASSES[r.cls].role, current: true, unlocked: true, jobLv: r.jobLv?.[r.cls] || 1, jp: r.jp?.[r.cls] || 0, reqs: [] }]);
export const setJob = call('setJob', (r, cls) => { r.cls = cls; return true; });
export const setSecondary = call('setSecondary', (r, cls) => { r.secondary = cls; return true; });
export const equip = call('equip', (r, slot, id) => { r[slot] = id; return true; });
export const equippable = call('equippable', () => ({ secondary: [], reaction: [], support: [], movement: [] }));
export const learnable = call('learnable', () => []);
export const buy = call('buy', () => false);
export const recordStats = call('recordStats', (r) => { const c = CLASSES[r.cls]; return { hp: c.hp, mp: c.mp, atk: c.atk, def: c.def, mag: c.mag, res: c.res, spd: c.spd, eva: c.eva, move: c.move, jump: c.jump, brv: r.brv }; });
export const swearHero = call('swearHero', (r) => { r.hero = true; return r; });
export const skillsetName = call('skillsetName', (cls) => CLASSES[cls]?.name || cls);
export const jobLevelFor = call('jobLevelFor', () => 1);
export const EXP_PER_LEVEL = () => P.EXP_PER_LEVEL || 100;

export const className = (cls) => CLASSES[cls]?.name || cls;
export const slotName = (slot, id) => (id ? ((slot === 'reaction' ? REACTIONS : slot === 'support' ? SUPPORTS : MOVEMENTS)[id]?.name || id) : '—');
export const slotDesc = (slot, id) => (id ? ((slot === 'reaction' ? REACTIONS : slot === 'support' ? SUPPORTS : MOVEMENTS)[id]?.desc || '') : '');
export { CLASSES, ABILITIES };
