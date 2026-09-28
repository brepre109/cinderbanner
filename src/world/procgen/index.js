// generate() — the acceptance loop (PLAN §5.3). Generate, validate, repair, ANALYSE, and only then
// return; every rejection increments a code in the histogram, so a failing archetype is diagnosable
// ("gen.too-shallow x37") instead of mysterious ("no valid map in 240 attempts").
//
// The acceptance contract, in the order it is applied, is the whole point of the module:
//   1. validateDef reports zero ERRORS — the same validator the shipped map clears.
//   2. The analysis ladder's TURNS strictly decrease across every tier the archetype promises.
//      Turns, not steps: a Knight (MOVE 3) and a Ninja (MOVE 4) convert one 8-step saving into 3
//      turns and 2, and turns are what a player experiences.
//   3. Every declared face is classified EXPRESS by analysis/classify.js — not `cosmetic` (earns
//      nothing), not `trap` (a fall, not a route), not `gate` (the only connector, so it is not a
//      shortcut at all). A face nobody would take is a decoration the author believes is a mechanic.
//   4. faceScan finds NO undeclared face, the base tier connects A to B, every declared choke
//      seal-proves by deletion, every promise holds for the SLOWEST class in its tier, and the
//      pocket budget is not exceeded.
// Only then is the road cobbled, the provenance stamped, and one of orient.js's eight dihedral
// frames applied — after verification, because those are isometries and every measured number
// survives them exactly.
//
// Zero three.js: the whole tree under procgen/ runs under bare `node`, which is what lets
// tools/mapcheck.mjs sweep it in CI.
import { validateDef } from '../mapformat/validate.js';
import { compileMap } from '../mapformat/compile.js';
import { hashDef } from '../mapformat/serialize.js';
import { analyseMap } from '../analysis/report.js';
import { mulberry32 } from './rng.js';
import { ARCHETYPES, ARCHETYPE_IDS, archetypeOf, checkVocab } from './vocab.js';
import { buildSkeleton, canvasToDef, SkeletonError } from './skeleton.js';
import { decorate } from './decorate.js';
import { repair } from './repair.js';
import { orient, ORIENTS } from './orient.js';

export { ARCHETYPES, ARCHETYPE_IDS, archetypeOf, checkVocab } from './vocab.js';
export { ORIENTS, orient } from './orient.js';
export { repair } from './repair.js';

/** the prototype used 160. 240 costs nothing when the acceptance rate is high and buys headroom for a pinned
 *  size that only one archetype in five can satisfy. */
export const MAX_ATTEMPTS = 240;
const GOLDEN = 0x9E3779B9;   // one seed, one attempt index, one uncorrelated stream

/**
 * @param {{seed?:number, archetype?:string, w?:number, d?:number, tiers?:number[],
 *          attempts?:number, verifyOrient?:boolean, orient?:number}} [opts]
 *   tiers — cap the ladder to these face tiers (the editor's generator panel narrows a big
 *           archetype down); an archetype's own faces are otherwise used in full.
 *   verifyOrient — re-validate the presented map. The transform is an isometry, so this can only
 *           ever fail on a bug in orient.js; it is on by default because that is precisely the bug
 *           that would ship eight broken maps for every one that was verified.
 * @returns {{def:object, attempts:number, rejections:Record<string,number>, archetype:string,
 *            orient:number, repairs:string[], analysis:object}}
 */
export function generate(opts = {}) {
  const seed = Number.isFinite(opts.seed) ? Math.trunc(opts.seed) : 0;
  const maxAttempts = Number.isFinite(opts.attempts) && opts.attempts > 0 ? Math.trunc(opts.attempts) : MAX_ATTEMPTS;
  const pinned = opts.archetype ? archetypeOf(opts.archetype) : null;
  if (opts.archetype && !pinned) throw new Error(`procgen: unknown archetype '${opts.archetype}' (have: ${ARCHETYPE_IDS.join(', ')})`);
  const size = {}; if (Number.isFinite(opts.w)) size.w = Math.trunc(opts.w); if (Number.isFinite(opts.d)) size.d = Math.trunc(opts.d);
  const rejections = Object.create(null);
  const bump = (code) => { rejections[code] = (rejections[code] || 0) + 1; };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // A fresh stream per attempt, decorrelated from the seed: `seed + attempt` would make attempt 2
    // of seed 7 identical to attempt 1 of seed 8 and quietly halve the space the loop searches.
    const rng = mulberry32((seed ^ Math.imul(attempt + 1, GOLDEN)) >>> 0);
    const V = pinned || ARCHETYPES[(Math.abs(seed) + attempt) % ARCHETYPES.length];
    const vocab = narrow(V, opts.tiers);
    let def;
    try {
      const c = buildSkeleton(rng, vocab, size);
      decorate(c, rng, vocab);
      def = canvasToDef(c, vocab, { id: idFor(vocab.id, seed) });
    } catch (err) { bump(err instanceof SkeletonError ? err.code : `gen.threw:${(err && err.message) || err}`); continue; }

    let v = validateDef(def), repairs = [];
    if (!v.ok) { const r = repair(def, v.issues); if (r.applied.length) { def = r.def; repairs = r.applied; v = validateDef(def); } }
    if (!v.ok) { bump(v.errors[0].code); continue; }

    let a = analyseMap(compileMap(def), def);
    const why = judge(a, def, vocab);
    if (why) { bump(why); continue; }

    def = cobble(def, a, vocab);
    a = analyseMap(compileMap(def), def);
    const after = validateDef(def);
    if (!after.ok) { bump(`cobble:${after.errors[0].code}`); continue; }

    def.gen = { generator: vocab.id, seed, attempt, orient: 0, params: { w: def.size.w, d: def.size.d, tiers: vocab.faces.map((f) => f.tier) },
      ...(repairs.length ? { repairs } : {}) };
    def.brief = { ...def.brief, notes: `${vocab.notes} Measured: ${a.ladder.rows.map((r) => `${r.tier}h ${r.steps} steps / ${r.turnsBySlowest} turns`).join(', ')}.` };
    def.analysis = { ...a.analysis, hash: hashDef(def) };

    const t = Number.isFinite(opts.orient) ? Math.trunc(opts.orient) : (seed >>> 3) % ORIENTS.length;
    let shown = orient(def, t);
    if (opts.verifyOrient !== false && !validateDef(shown).ok) { bump('orient.broke'); shown = orient(def, 0); }
    shown.analysis = { ...a.analysis, hash: hashDef(shown) };
    return { def: shown, attempts: attempt + 1, rejections, archetype: vocab.id,
      orient: shown.gen ? shown.gen.orient : 0, repairs, analysis: a };
  }
  const hist = Object.entries(rejections).sort((p, q) => q[1] - p[1]).map(([kk, n]) => `${kk} x${n}`).join(', ');
  throw new Error(`procgen: no map passed acceptance in ${maxAttempts} attempts (${hist || 'no rejections recorded'})`);
}

/** `?map=proc:<seed>` must be enough to reproduce the map, so the id carries the seed and the
 *  archetype and nothing else. Constrained to schema.js's ID_RE, which is also the filename stem. */
const idFor = (arch, seed) => `proc_${arch}_${(seed >>> 0).toString(36)}`.slice(0, 48);

/** A caller-supplied tier list narrows the archetype's faces; it never invents one, because a face
 *  tier the record does not carry has no note, no minimum saving and no promise to be judged by. */
function narrow(V, tiers) {
  if (!Array.isArray(tiers) || !tiers.length) return V;
  const want = new Set(tiers), faces = V.faces.filter((f) => want.has(f.tier));
  return faces.length >= 2 ? { ...V, faces } : V;
}

/**
 * The acceptance contract. Returns null to accept, or the rejection code to record — one code, the
 * first failure, so the histogram counts causes rather than symptoms.
 */
function judge(a, def, V) {
  const rows = a.ladder.rows;
  if (!rows.length || !rows[0].connected) return 'accept.base-severed';
  if (!a.ladder.monotone) return 'accept.ladder-not-monotone';     // a bug in jumpgraph's need[], not the map
  for (let i = 1; i < rows.length; i++) if (!(rows[i].turnsBySlowest < rows[i - 1].turnsBySlowest)) return 'accept.turns-not-strict';
  if (a.faces.undeclared.length) return 'accept.face-undeclared';
  if (a.faces.phantom.length) return 'accept.face-phantom';
  const kindOf = new Map(a.shortcuts.map((s) => [s.key, s.kind]));
  for (const f of a.faces.declared) { if (kindOf.get(f.key) !== 'express') return `accept.face-${kindOf.get(f.key) || 'missing'}`;
    const s = a.faces.savings[f.fid]; if (!s || !(s.saving >= (f.minSaving ?? 1))) return 'accept.face-saving'; }
  for (const s of a.seals) { if (!s.sealed) return 'accept.choke-leaks'; if (s.vacuous) return 'accept.choke-vacuous'; }
  for (const p of a.promises) if (!p.ok) return 'accept.promise-unmet';
  let pocket = 0; for (const p of a.pockets) pocket += p.size;
  if (pocket > (V.pocketBudget || 0)) return 'accept.pocket-budget';
  const err = a.violations.find((x) => x.severity === 'error');
  return err ? `accept.${err.code}` : null;
}

/**
 * PLAN §5.1 stage 11. Repaint the VERIFIED base-tier route as dirt so the map shows its own
 * intended path in its texture — the one place a purely cosmetic pass is worth the lines, because
 * it turns an invisible proof into something a player reads off the ground. Letters are all
 * walkable, so this cannot move a graph edge; the caller re-validates anyway.
 */
function cobble(def, a, V) {
  const tiles = (a.ladder.rows[0] && a.ladder.rows[0].routeTiles) || [];
  if (!tiles.length || V.palette.road === 'd') return def;
  const T = def.grid.T.slice();
  for (const [x, z] of tiles) { const row = T[z]; if (typeof row !== 'string' || x < 0 || x >= row.length) continue;
    if (row[x] === 'w' || row[x] === 'v') continue; T[z] = row.slice(0, x) + 'd' + row.slice(x + 1); }
  return { ...def, grid: { ...def.grid, T } };
}
