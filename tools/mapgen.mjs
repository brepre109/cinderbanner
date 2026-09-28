#!/usr/bin/env node
// The generator's command line (PLAN §5). Everything it does, the game already does at
// `?map=proc:<seed>`; what this adds is the ability to PROMOTE one of those seeds into a committed
// map file, and to answer "is this archetype healthy?" without opening a browser.
//
//   node tools/mapgen.mjs --archetype=gorge --seed=7 --size=20x20 --out=src/world/maps/
//   node tools/mapgen.mjs --archetype=gorge --seed=7 --dry        analyse, write nothing
//   node tools/mapgen.mjs --sweep=50 --dry                        acceptance rate over 50 seeds
//   node tools/mapgen.mjs --seed=7 --id=twin_span --out=src/world/maps/ --force
//
// Flags: --archetype --seed --size=WxD --tiers=6,10,14 --orient=N --attempts=N --id --name
//        --out --force --dry --sweep=N --json
//
// THE RULE THIS FILE EXISTS TO ENFORCE: nothing invalid is ever written to disk. generate() already
// runs the acceptance loop internally, but a writer that trusted it would be a writer with no
// second opinion, and the failure mode of a generate-then-write pipeline is a committed map that
// only its own generator believes in. So the def is re-validated and re-analysed HERE, from the
// outside, against the same validate.js and report.js the CI gate runs, and a non-empty error list
// aborts the write with the errors printed. --force overrides an existing FILE, never a finding.
//
// Zero three.js, like everything under src/world/: this runs under bare `node` with no bundler.
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, ARCHETYPE_IDS } from '../src/world/procgen/index.js';
import { validateDef } from '../src/world/mapformat/validate.js';
import { compileMap } from '../src/world/mapformat/compile.js';
import { stringifyDef, parseDef, hashDef } from '../src/world/mapformat/serialize.js';
import { ID_RE } from '../src/world/mapformat/schema.js';
import { analyseMap, formatReport } from '../src/world/analysis/report.js';
import { PENDING_IDS, hasMap, metaOf } from '../src/world/mapregistry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SWEEP_STRIDE = 7919;   // a prime stride, not 0..n: adjacent seeds share a mulberry32 prefix

export function parseArgs(argv) {
  const a = { archetype: null, seed: 0, w: undefined, d: undefined, tiers: null, orient: undefined,
    attempts: undefined, id: null, name: null, out: null, force: false, dry: false, sweep: 0, json: false };
  for (const s of argv) {
    const m = /^--([a-z][\w-]*)(?:=(.*))?$/.exec(s);
    if (!m) { if (s !== '--') throw new Error(`mapgen: unrecognised argument '${s}'`); continue; }
    const [, k, v] = m;
    switch (k) {
      case 'archetype': case 'g': a.archetype = v || null; break;
      case 'seed': a.seed = Number(v) || 0; break;
      case 'size': {
        const p = /^(\d+)\s*[xX*]\s*(\d+)$/.exec(v || '');
        if (!p) throw new Error(`mapgen: --size wants WxD, got '${v}'`);
        a.w = Number(p[1]); a.d = Number(p[2]); break;
      }
      case 'tiers': a.tiers = (v || '').split(',').map(Number).filter(Number.isFinite); break;
      case 'orient': a.orient = Number(v); break;
      case 'attempts': a.attempts = Number(v); break;
      case 'id': a.id = (v || '').trim(); break;
      case 'name': a.name = v || null; break;
      case 'out': a.out = v || null; break;
      case 'force': a.force = v !== 'false'; break;
      case 'dry': a.dry = v !== 'false'; break;
      case 'json': a.json = v !== 'false'; break;
      case 'sweep': a.sweep = Math.max(0, Math.trunc(Number(v) || 0)); break;
      case 'help': a.help = true; break;
      default: throw new Error(`mapgen: unknown flag --${k}`);
    }
  }
  return a;
}

/** generate() + the outside second opinion. Never writes; the caller decides that. */
function make(args, seed) {
  const res = generate({ seed, archetype: args.archetype || undefined, w: args.w, d: args.d,
    tiers: args.tiers || undefined, orient: args.orient, attempts: args.attempts });
  const def = rename(res.def, args);
  const v = validateDef(def);
  const a = analyseMap(compileMap(def), def);
  return { ...res, def, validation: v, analysis: a,
    errors: [...v.errors.map((e) => `${e.code}: ${e.msg}`),
      ...a.violations.filter((x) => x.severity === 'error').map((x) => `${x.code}: ${x.msg}`),
      ...(a.ladder.monotone ? [] : ['ladder.non-monotone: the tier ladder went backwards'])] };
}

/**
 * A promoted map is a catalogue map, and a catalogue map's id IS its filename stem and its registry
 * key (mapregistry.js). So --id is applied here, before validation, and def.analysis.hash is retaken
 * afterwards: hashDef covers the id, so renaming a generated map without refreshing the cache would
 * commit a document whose own cached hash describes the map it used to be — precisely the drift
 * tools/checks/analysis.mjs reports as an error.
 */
function rename(def0, args) {
  if (!args.id && !args.name) return def0;
  const def = { ...def0 };
  if (args.id) {
    if (!ID_RE.test(args.id)) throw new Error(`mapgen: --id '${args.id}' does not match ${ID_RE}`);
    def.id = args.id;
    def.name = args.name || args.id.replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  if (args.name) def.name = args.name;
  if (def.analysis) def.analysis = { ...def.analysis, hash: hashDef(def) };
  return def;
}

/** Where a promoted map lands. `--out` is a directory unless it already names a .js file. */
function outPath(args, def) {
  if (!args.out) return null;
  const p = path.resolve(ROOT, args.out);
  return /\.m?js$/.test(p) ? p : path.join(p, `${def.id}.js`);
}
const exists = (p) => access(p).then(() => true, () => false);
// Repo-relative when it IS in the repo; absolute otherwise. `path.relative` happily returns
// '../../../../tmp/...' for a --out somewhere else, which reads as a path traversal rather than as
// the scratch directory the operator actually typed.
function show(p) { const r = path.relative(ROOT, p); return r.startsWith('..') ? p : r; }

async function one(args) {
  const r = make(args, args.seed);
  const file = outPath(args, r.def);
  if (args.json) {
    console.log(JSON.stringify({ ok: !r.errors.length, id: r.def.id, archetype: r.archetype,
      seed: args.seed, attempts: r.attempts, orient: r.orient, hash: hashDef(r.def),
      size: r.def.size, errors: r.errors, warnings: r.validation.warnings.map((w) => w.code),
      analysis: r.analysis.analysis, file: args.dry ? null : file }, null, 2));
  } else {
    console.log(formatReport(r.analysis));
    console.log(`GENERATED  archetype '${r.archetype}' seed ${args.seed} in ${r.attempts} attempt(s), orient ${r.orient}` +
      (r.repairs.length ? `, repairs [${r.repairs.join(', ')}]` : '') +
      `\n  id '${r.def.id}'  ${r.def.size.w}x${r.def.size.d}  hash ${hashDef(r.def)}  ` +
      `${r.validation.warnings.length} validator warning(s)`);
    const hist = Object.entries(r.rejections).sort((p, q) => q[1] - p[1]).map(([k, n]) => `${k} x${n}`);
    if (hist.length) console.log(`  rejected on the way: ${hist.join(', ')}`);
  }
  if (r.errors.length) {
    console.error(`\n  REFUSING TO WRITE: ${r.errors.length} error(s) in the accepted map — generate() and the outside\n` +
      `  validator disagree, which is a procgen bug, not a flag to override.`);
    for (const e of r.errors) console.error(`    ERROR ${e}`);
    return 1;
  }
  if (args.dry || !file) {
    if (!args.json) console.log(args.out ? '\n  --dry: nothing written.' : '\n  no --out: nothing written. Pass --out=src/world/maps/ to promote this seed.');
    return 0;
  }
  if (await exists(file) && !args.force) {
    console.error(`\n  REFUSING TO OVERWRITE ${show(file)} — pass --force if that is what you mean.`);
    return 1;
  }
  const src = stringifyDef(r.def);
  // The file is only worth writing if it reads back as the same document: stringifyDef/parseDef are
  // a matched pair and a drift between them would commit a map that the loader silently reads
  // differently from the one that was analysed above.
  if (hashDef(parseDef(src)) !== hashDef(r.def)) {
    console.error('\n  REFUSING TO WRITE: the module source does not parse back to the same document (serialize.js round-trip failure).');
    return 1;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, src, 'utf8');
  // A written map that nothing can load is the failure this line exists to prevent: REGISTRY is an
  // explicit whitelist and a catalogue id's line is COMMENTED OUT until its module exists, so the
  // last step of a promotion is always a one-line edit somebody has to be told to make.
  const wire = hasMap(r.def.id) ? '  already registered.'
    : PENDING_IDS.includes(r.def.id) ? `  now uncomment \`${r.def.id}: () => import('./maps/${r.def.id}.js'),\` in src/world/mapregistry.js`
      : `  now add \`${r.def.id}: () => import('./maps/${r.def.id}.js'),\` to REGISTRY and a MAP_META row in src/world/mapregistry.js`;
  // MAP_META's size is a cache of def.size, so it is only worth mentioning when it is missing or now
  // wrong; repeating a number that is already correct trains the operator to skip the whole block.
  const m = metaOf(r.def.id);
  const cache = !m || !m.size || m.size.w !== r.def.size.w || m.size.d !== r.def.size.d
    ? `\n  cache its size in MAP_META: meta('${r.def.id}', '${(m && m.name) || r.def.name}', ${r.def.size.w}, ${r.def.size.d})` : '';
  console.log(`\n  wrote ${show(file)} (${src.length} bytes)\n${wire}${cache}`);
  return 0;
}

// ------------------------------------------------------------------------------- sweep
/**
 * Acceptance rate per archetype. The number that matters is not "did generate() return" but "did it
 * return something the OUTSIDE validator and analyser also accept", so the sweep runs the same
 * make() a real promotion runs. A seed that costs 200 internal attempts is a health signal too, so
 * the mean attempt count is reported beside the rate.
 */
function sweep(args) {
  const ids = args.archetype ? [args.archetype] : ARCHETYPE_IDS;
  const rows = [], rejections = Object.create(null);
  let seeds = 0, okAll = 0;
  for (const archetype of ids) {
    let made = 0, clean = 0, attempts = 0, worst = 0;
    const fails = Object.create(null);
    for (let i = 0; i < args.sweep; i++) {
      const seed = (args.seed || 1000) + i * SWEEP_STRIDE;
      seeds++;
      let r;
      try { r = make({ ...args, archetype }, seed); }
      catch (err) {
        // generate() throws only after exhausting MAX_ATTEMPTS; its message carries the histogram.
        const code = /\(([^)]*)\)\s*$/.exec(String(err.message))?.[1]?.split(',')[0]?.trim() || 'threw';
        fails[`exhausted:${code}`] = (fails[`exhausted:${code}`] || 0) + 1;
        continue;
      }
      made++; attempts += r.attempts; worst = Math.max(worst, r.attempts);
      for (const [k, n] of Object.entries(r.rejections)) rejections[k] = (rejections[k] || 0) + n;
      if (r.errors.length) fails[r.errors[0].split(':')[0]] = (fails[r.errors[0].split(':')[0]] || 0) + 1;
      else { clean++; okAll++; }
    }
    const top = Object.entries(fails).sort((p, q) => q[1] - p[1]).map(([k, n]) => `${k} x${n}`);
    rows.push([archetype, args.sweep, made, clean, `${Math.round((clean / args.sweep) * 100)}%`,
      made ? (attempts / made).toFixed(1) : '-', worst || '-', top.join(', ') || '-']);
  }
  if (args.json) { console.log(JSON.stringify({ seeds, accepted: okAll, rate: okAll / seeds, rows, rejections }, null, 2)); return okAll === seeds ? 0 : 1; }
  console.log(`\nSWEEP  ${args.sweep} seed(s) x ${ids.length} archetype(s), base seed ${args.seed || 1000}, stride ${SWEEP_STRIDE}` +
    (args.w ? `, pinned ${args.w}x${args.d}` : '') + '\n');
  console.log(table(['archetype', 'seeds', 'made', 'clean', 'rate', 'avg tries', 'max tries', 'failures'], rows));
  const hist = Object.entries(rejections).sort((p, q) => q[1] - p[1]).slice(0, 12).map(([k, n]) => `${k} x${n}`);
  console.log(`\n  ${okAll}/${seeds} seeds produced a map that validates and analyses clean (${Math.round((okAll / seeds) * 100)}%).`);
  if (hist.length) console.log(`  internal rejections: ${hist.join(', ')}`);
  console.log('');
  return okAll === seeds ? 0 : 1;
}

function table(headers, rows) {
  const cells = [headers, ...rows].map((r) => r.map((v) => String(v ?? '')));
  const wid = headers.map((_, i) => Math.max(...cells.map((r) => [...r[i]].length)));
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
  const line = (r) => '  ' + r.map((v, i) => pad(v, wid[i])).join('  ').trimEnd();
  return [line(cells[0]), '  ' + wid.map((n) => '-'.repeat(n)).join('  '), ...cells.slice(1).map(line)].join('\n');
}

const USAGE = `mapgen — generate, analyse and promote a procedural map.

  node tools/mapgen.mjs --archetype=gorge --seed=7 --size=20x20 --out=src/world/maps/
  node tools/mapgen.mjs --archetype=gorge --seed=7 --dry
  node tools/mapgen.mjs --sweep=50 --dry

  --archetype=<id>   ${ARCHETYPE_IDS.join(' | ')} (default: chosen from the seed)
  --seed=<n>         the seed; also the base seed of a --sweep
  --size=WxD         pin the map size (default: the archetype's own range)
  --tiers=6,10,14    narrow the archetype's face tiers
  --orient=<0..7>    pin the dihedral frame (default: derived from the seed)
  --attempts=<n>     acceptance-loop budget (default 240)
  --id=<stem>        rename the map; this is the registry key and the filename stem
  --name=<text>      display name
  --out=<dir|file>   where to write; a directory gets <id>.js
  --force            overwrite an existing file
  --dry              analyse and print, write nothing
  --sweep=<n>        acceptance rate over n seeds per archetype
  --json             machine-readable`;

export async function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); } catch (err) { console.error(`  ${err.message}\n`); console.error(USAGE); return 2; }
  if (args.help) { console.log(USAGE); return 0; }
  if (args.sweep) return sweep(args);
  try { return await one(args); }
  catch (err) { console.error(`  mapgen failed: ${err.message}`); return 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
