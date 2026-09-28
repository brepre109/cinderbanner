// The primitive registry (PLAN §3.4). Two clients read it and neither may hardcode a primitive:
// the editor's generator palette, which BUILDS its parameter form from `schema`, and the recipe
// runner below, which is what a procgen archetype record and a saved editor macro both replay.
//
// `schema` uses the SAME field record as PROP_SPEC.fields — {k, type, label, def, min, max, enum,
// units, req} — deliberately, so a control generator written once serves prop inspectors and
// primitive brushes instead of two that drift. `k` is the parameter key and `def` is its default;
// a field with no `def` and `req:true` is one the caller must supply. Note the record names the
// DATA type, not a widget: a UI layer maps 'int'/'number' -> number, 'bool' -> toggle, 'string' ->
// text (editor/params.js's CONTROL_TYPES is a widget vocabulary and needs that mapping for
// PROP_SPEC too, not just for this file).
import { TIER_KINDS, REGION_KINDS } from '../mapformat/schema.js';
import { ramp } from './ramp.js';
import { stairFlight } from './stairFlight.js';
import { switchback } from './switchback.js';
import { cliffFace } from './cliffFace.js';
import { ledge } from './ledge.js';
import { chasm } from './chasm.js';
import { catwalk } from './catwalk.js';
import { steppedTower } from './steppedTower.js';
import { mesa } from './mesa.js';
import { canyon } from './canyon.js';
import { aqueduct } from './aqueduct.js';

export { ramp, stairFlight, switchback, cliffFace, ledge, chasm, catwalk, steppedTower, mesa, canyon, aqueduct };

/** Field types the editor must render. 'tile' is [x,z]; 'rect' is [x0,z0,x1,z1]; 'ints' is a list of
 *  indices; 'list' is a repeatable sub-record whose shape is in `of`. */
export const PARAM_TYPES = Object.freeze(['int', 'number', 'bool', 'enum', 'string', 'tile', 'rect', 'ints', 'list']);

const f = (k, type, o = {}) => ({ k, type, label: o.label || k, def: 'def' in o ? o.def : null,
  min: o.min ?? null, max: o.max ?? null, enum: o.enum || null, units: o.units || null,
  req: !!o.req, of: o.of || null });
const AXIS = (def = 'x') => f('axis', 'enum', { enum: ['x', 'z'], def, label: 'run axis' });
const NSEW = (def = 'n', k = 'dir') => f(k, 'enum', { enum: ['n', 's', 'e', 'w'], def, label: 'direction of ascent' });
const H = (k, o = {}) => f(k, 'int', { units: 'h', ...o });
const SURF = ['g', 'k', 'd', 's', 'b', 'r', 'S'];
const LETTER = (k, def, label) => f(k, 'enum', { enum: SURF, def, label });
/** A letter field with NO default. defaultsOf omits it, so the primitive's own `o.x ?? fallback`
 *  keeps deciding — which for the letter channels also means "leave the letter alone". */
const LETTER0 = (k, label) => f(k, 'enum', { enum: SURF, label });
const KIND = (k, list, label) => f(k, 'enum', { enum: list.slice(), label });
// Every primitive writes `note` into the declaration it emits, so the palette must be able to reach
// it: the note is the sentence the analyser's report quotes back at whoever reads the map later.
const NOTE = f('note', 'string', { label: 'declaration note' });

// NOTE is appended here rather than typed into eleven schemas, so a new primitive cannot forget it.
const P = (id, label, fn, role, schema) => [id, { id, label, fn, role, schema: Object.freeze(schema.concat(NOTE)) }];

/** @type {Readonly<Record<string,{id:string,label:string,fn:Function,role:string,schema:object[]}>>} */
export const PRIMITIVES = Object.freeze(Object.fromEntries([
  P('ramp', 'Ramp', ramp, 'the base-tier climb, quantised to the terrace step', [
    f('from', 'tile', { req: true, label: 'low end' }), f('to', 'tile', { req: true, label: 'high end' }),
    f('width', 'int', { def: 2, min: 1, max: 8, units: 'tile' }), H('step', { def: 2, min: 1, max: 4, label: 'riser quantum' }),
    LETTER('t', 'd', 'surface'), H('fromH', { label: 'low-end height (else read off the canvas)' }),
    H('toH', { label: 'high-end height (else read off the canvas)' })]),
  P('stairFlight', 'Stair flight', stairFlight, 'ANTI-shortcut: paired stairs props carry the base tier over a break', [
    f('x', 'int', { req: true, units: 'tile' }), f('z', 'int', { req: true, units: 'tile' }), NSEW('n'),
    H('lowH', { req: true }), H('highH', { req: true }), f('width', 'int', { def: 2, min: 1, max: 4, units: 'tile' }),
    H('rise', { def: 4, min: 2, max: 6, label: 'h per landing' }), LETTER('t', 's', 'surface')]),
  P('switchback', 'Switchback', switchback, 'ANTI-shortcut: the detour that gives every express its value', [
    f('rect', 'rect', { req: true }), f('legs', 'int', { def: 3, min: 2, max: 8 }),
    H('rise', { def: 4, min: 2, max: 4, label: 'h per leg' }), H('base', { label: 'height of leg 0' }),
    AXIS('x'), f('width', 'int', { def: 1, min: 1, max: 4, units: 'tile' }), LETTER('t', 'd', 'surface'),
    f('isolate', 'bool', { def: true, label: 'cut every approach but the two mouths' }),
    f('descend', 'bool', { def: false, label: 'stack downhill (aim the low mouth at the low corner)' }),
    LETTER0('dividerT', 'divider surface')]),
  P('cliffFace', 'Cliff face', cliffFace, 'a named-tier wall with declared breaks', [
    f('x', 'int', { req: true, units: 'tile' }), f('z', 'int', { req: true, units: 'tile' }),
    f('len', 'int', { req: true, min: 1, max: 48, units: 'tile' }), AXIS('x'),
    H('base', { req: true, label: 'foot height' }), H('top', { req: true, label: 'cliff top' }),
    f('side', 'enum', { enum: [1, -1], def: 1, label: 'which side the foot lies on' }),
    f('breaks', 'ints', { def: [], label: 'indices with no parapet (each declares a face)' }),
    f('parapet', 'bool', { def: true }), f('undercut', 'bool', { def: false, label: 'void the foot between breaks' }),
    f('gate', 'bool', { def: true, label: 'cut the foot outside the breaks (a parapet does not block)' }),
    LETTER0('t', 'wall-top surface'), f('foot', 'bool', { def: true, label: 'write the foot row' }),
    LETTER0('footT', 'foot surface'), KIND('kind', TIER_KINDS, 'kind each break declares')]),
  P('ledge', 'Ledge', ledge, 'the canonical express: a shelf reached by exactly one declared vault', [
    f('x', 'int', { req: true, units: 'tile' }), f('z', 'int', { req: true, units: 'tile' }),
    f('len', 'int', { req: true, min: 1, max: 48, units: 'tile' }), AXIS('z'), H('h', { req: true, label: 'shelf height' }),
    f('width', 'int', { def: 1, min: 1, max: 4, units: 'tile' }), f('from', 'tile', { req: true, label: 'the vault source' }),
    f('rail', 'bool', { def: true }), f('railSide', 'enum', { enum: [1, -1], def: 1, label: 'which side the drop is on' }),
    LETTER('t', 'r', 'surface'), f('isolate', 'bool', { def: true, label: 'cut every approach but the vault' }),
    f('minTurnSaving', 'int', { min: 0, max: 8, label: 'turns the face must save to be honest' })]),
  P('chasm', 'Chasm', chasm, 'a void bite, parked below the cut and never beside water', [
    f('rect', 'rect', { req: true }), f('void', 'bool', { def: true, label: 'void (else a dry bed)' }),
    H('floor', { label: 'bed height when not void' }), LETTER('t', 'r', 'bed surface'),
    KIND('kind', REGION_KINDS, 'region kind')]),
  P('catwalk', 'Catwalk', catwalk, 'deck props plus the matching grant, with both approaches forced in reach', [
    f('from', 'tile', { req: true, label: 'near shore' }), f('to', 'tile', { req: true, label: 'far shore' }),
    H('h', { def: 0, label: 'water height' }), f('w', 'int', { def: 1, min: 1, max: 8, units: 'tile', label: 'span width' }),
    f('style', 'enum', { enum: ['stone', 'wood'], def: 'stone' }), f('rail', 'bool', { def: true }),
    f('water', 'bool', { def: true, label: 'cut live water under the span' }), f('choke', 'bool', { def: true, label: 'declare it a choke' }),
    H('tier', { label: 'declared choke tier (else baseTier)' })]),
  P('steppedTower', 'Stepped tower', steppedTower, 'a stack of individually tiered risers; the last gates the crown', [
    f('x', 'int', { req: true, units: 'tile' }), f('z', 'int', { req: true, units: 'tile' }),
    f('size', 'int', { req: true, min: 3, max: 24, units: 'tile' }), H('base', { req: true }),
    f('risers', 'ints', { def: [4, 4, 6], label: 'h per level, innermost last' }),
    NSEW('n', 'access'), LETTER('t', 'r', 'terrace'), LETTER('crownT', 's', 'crown')]),
  P('mesa', 'Mesa', mesa, 'COMPOUND: crown plateau plus an apron moat between landings', [
    f('rect', 'rect', { req: true }), H('base', { req: true, label: 'apron height' }), H('crownH', { req: true }),
    f('landings', 'list', { def: [{ side: 'n', tier: 6 }], label: 'one per designed tier',
      of: [f('side', 'enum', { enum: ['n', 's', 'e', 'w'], def: 'n' }), H('tier', { def: 6 }), f('at', 'int', { units: 'tile' })] }),
    f('moat', 'bool', { def: true }), LETTER('t', 'r', 'apron'), LETTER('crownT', 'k', 'crown')]),
  P('canyon', 'Canyon', canyon, 'COMPOUND: two rims, one floor, N crossings at declared tiers', [
    f('rect', 'rect', { req: true, label: 'the floor band' }), AXIS('z'), H('floorH', { req: true }), H('rimH'),
    f('wall', 'int', { def: 1, min: 1, max: 3, units: 'tile', label: 'undercut width' }),
    f('crossings', 'list', { def: [], label: 'punched through the undercut',
      of: [f('at', 'int', { req: true, units: 'tile' }), H('tier', { def: 4 }),
        f('side', 'enum', { enum: ['lo', 'hi', 'both'], def: 'both' }), f('width', 'int', { def: 1, min: 1, max: 4 })] }),
    LETTER('floorT', 'r', 'floor'), LETTER('benchT', 's', 'crossing')]),
  P('aqueduct', 'Aqueduct', aqueduct, 'COMPOUND: arch piers with a broken span as the tier-gated crossing', [
    f('x', 'int', { req: true, units: 'tile' }), f('z', 'int', { req: true, units: 'tile' }),
    f('len', 'int', { req: true, min: 2, max: 48, units: 'tile' }), AXIS('x'),
    H('h', { req: true, label: 'causeway height' }), H('groundH', { req: true }),
    f('width', 'int', { def: 1, min: 1, max: 4, units: 'tile' }), f('broken', 'ints', { def: [], label: 'fallen span indices' }),
    H('gapH', { label: 'rubble height in the gap' }), f('pierEvery', 'int', { def: 2, min: 1, max: 8, units: 'tile' }),
    f('r', 'number', { def: 0.7, min: 0.1, max: 3, units: 'world', label: 'arch radius' }),
    f('parapet', 'bool', { def: true }), f('trench', 'bool', { def: true, label: 'cut the flanks so only the gap connects' }),
    LETTER0('t', 'causeway surface'), LETTER0('gapT', 'rubble surface')]),
]));

export const PRIMITIVE_IDS = Object.freeze(Object.keys(PRIMITIVES));

/** The schema's declared defaults as a plain params object — what the editor seeds a fresh brush
 *  with, and what a recipe step is merged onto. Fields with `def: null` are omitted, not passed as
 *  null: a primitive's own `?? fallback` is the single source of that value. */
export function defaultsOf(id) {
  const rec = PRIMITIVES[id];
  if (!rec) throw new Error(`primitives: unknown id '${id}'`);
  const out = {};
  for (const fd of rec.schema) if (fd.def !== null) out[fd.k] = Array.isArray(fd.def) ? JSON.parse(JSON.stringify(fd.def)) : fd.def;
  return out;
}

/**
 * The recipe runner. A recipe is data — `[{ use:'canyon', ...params }, ...]` — so an archetype
 * record, a saved editor macro and a hand-authored map file all replay through one code path, and a
 * step that names an unknown primitive fails here rather than silently doing nothing.
 * @param {import('../canvas.js').Canvas} c
 * @param {Array<{use:string, as?:string, [k:string]:any}>} steps
 * @returns {Record<string, object>} each step's result, keyed by `as` (or by `use` plus its index)
 */
export function runRecipe(c, steps) {
  const out = {};
  steps.forEach((step, i) => {
    const { use, as, ...params } = step;
    const rec = PRIMITIVES[use];
    if (!rec) throw new Error(`runRecipe: step ${i} names unknown primitive '${use}'`);
    out[as || `${use}${i}`] = rec.fn(c, { ...defaultsOf(use), ...params });
  });
  return out;
}
