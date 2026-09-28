#!/usr/bin/env node
// The headless CI gate (PLAN §9). One entry point, no browser, no bundler, no DOM — everything it
// exercises lives under src/world/mapformat|analysis and imports zero three.js, so this file runs
// the SAME code the browser does.
//
//   node tools/mapcheck.mjs                  full corpus + every registered check
//   node tools/mapcheck.mjs --map=twin_span  one map
//   node tools/mapcheck.mjs --only=gate,seal one or more checks by id
//   node tools/mapcheck.mjs --verbose        list every finding, info included
//   node tools/mapcheck.mjs --json           machine-readable; nothing else on stdout
//
// SHAPE OF THE THING: this file owns the harness — arg parsing, corpus loading, the run loop, the
// table — and NOTHING ELSE. Checks live in tools/checks/*.mjs, one file per owner, each exporting
// `register(registerCheck, api)`. Waves 1-5 therefore only ever ADD a file; nobody edits this one,
// and no two workers collide on it. A missing tools/checks/ directory is not an error, it is today.
//
// Everything downstream is optional by construction: the corpus loader, the compiler and the
// validator are each behind a try/catch, so mapcheck runs green on a tree where only schema.js
// exists and degrades to a shorter table as pieces land, instead of failing to start.

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCOPES = new Set(['corpus', 'map', 'property']);
const SEV = { error: 0, warn: 1, info: 2 };

// ------------------------------------------------------------------ the check registry
const CHECKS = [];
/**
 * @param {{id:string, scope?:'corpus'|'map'|'property', title?:string, fn:Function}} c
 *   scope 'map'      -> fn(entry, ctx)   once per corpus map
 *   scope 'corpus'   -> fn(corpus, ctx)  once, over every map
 *   scope 'property' -> fn(ctx)          once, no map (undo/normalizer/procgen property tests)
 * fn returns an issue, an array of issues, or nothing. An issue is validate.js's shape:
 * {code, severity:'error'|'warn'|'info', msg, at?}. A thrown error is itself an error finding, so a
 * broken check can never be mistaken for a passing one.
 */
export function registerCheck(c) {
  if (!c || typeof c.fn !== 'function') throw new TypeError('registerCheck: fn required');
  if (!c.id) throw new TypeError('registerCheck: id required');
  const scope = c.scope || 'map';
  if (!SCOPES.has(scope)) throw new TypeError(`registerCheck: bad scope '${scope}'`);
  if (CHECKS.some((k) => k.id === c.id)) throw new Error(`registerCheck: duplicate id '${c.id}'`);
  CHECKS.push({ id: c.id, scope, title: c.title || c.id, fn: c.fn });
  return c.id;
}

// ------------------------------------------------------------------ args
export function parseArgs(argv) {
  const a = { map: null, only: null, verbose: false, json: false, rest: {} };
  for (const s of argv) {
    const m = /^--([a-z][\w-]*)(?:=(.*))?$/.exec(s);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'map') a.map = v || null;
    else if (k === 'only') a.only = (v || '').split(',').map((t) => t.trim()).filter(Boolean);
    else if (k === 'verbose') a.verbose = v !== 'false';
    else if (k === 'json') a.json = v !== 'false';
    else a.rest[k] = v === undefined ? true : v;   // --proc=500, --migrate: owned by later workers
  }
  return a;
}

// ------------------------------------------------------------------ optional imports
async function opt(rel) {
  try { return await import(pathToFileURL(path.join(ROOT, rel)).href); } catch { return null; }
}

// The core, best-effort. Each field is null until its wave-1/2 owner lands the file; every consumer
// below tests for null rather than assuming.
async function loadCore() {
  const [schema, compile, legacy, validate, report] = await Promise.all([
    opt('src/world/mapformat/schema.js'), opt('src/world/mapformat/compile.js'),
    opt('src/world/mapformat/legacy.js'), opt('src/world/mapformat/validate.js'),
    opt('src/world/analysis/report.js'),
  ]);
  return {
    schema, compileMap: compile?.compileMap || null, fromLegacy: legacy?.fromLegacy || null,
    validateDef: validate?.validateDef || null, analyseMap: report?.analyseMap || null,
  };
}

// ------------------------------------------------------------------ corpus
// A corpus entry is {id, name, def, MAP, notes[]}. `def` and `MAP` may be null; a check that needs
// one must say so itself. The registry is the real source once W2-C lands it; Wendford is loaded
// directly as the floor, because the gate test (§9.1) is stated against it and it must be present
// even on a tree with no registry at all.
async function loadCorpus(core, want) {
  const out = [];
  const seen = new Set();
  const reg = await opt('src/world/mapregistry.js');
  for (const id of reg?.MAP_IDS || []) {
    if (want && id !== want) continue;
    const e = { id, name: id, def: null, MAP: null, notes: [] };
    try {
      const mod = await reg.REGISTRY[id]();
      e.def = mod.DEF || (core.fromLegacy && mod.WENDFORD ? core.fromLegacy(mod) : null);
      if (!e.def) e.notes.push('no DEF export');
    } catch (err) { e.notes.push(`import threw: ${err.message}`); }
    seen.add(id); out.push(e);
  }
  if (!seen.has('wendford_crossing') && (!want || want === 'wendford_crossing')) {
    const e = { id: 'wendford_crossing', name: 'Wendford Crossing', def: null, MAP: null, notes: [] };
    const mod = await opt('src/world/maps/wendford_crossing.js');
    if (!mod) e.notes.push('import failed');
    else if (core.fromLegacy) { try { e.def = core.fromLegacy(mod); } catch (err) { e.notes.push(`fromLegacy threw: ${err.message}`); } }
    else e.notes.push('legacy.js pending (W1-B)');
    if (mod?.WENDFORD) { e.name = mod.WENDFORD.name; e.legacy = mod; }
    out.push(e);
  }
  for (const e of out) {
    if (e.def) { e.name = e.def.name || e.name; e.w = e.def.size?.w; e.d = e.def.size?.d; }
    else if (e.legacy?.WENDFORD) { e.w = e.legacy.WENDFORD.w; e.d = e.legacy.WENDFORD.d; }
    if (e.def && core.compileMap) {
      try { e.MAP = core.compileMap(e.def); } catch (err) { e.notes.push(`compileMap threw: ${err.message}`); }
    }
  }
  return out;
}

// ------------------------------------------------------------------ running
function asIssues(r) {
  if (!r) return [];
  const list = Array.isArray(r) ? r : [r];
  return list.filter(Boolean).map((i) => ({
    code: i.code || '?', severity: SEV[i.severity] === undefined ? 'error' : i.severity,
    msg: i.msg || '', at: i.at || null,
  }));
}

async function runChecks(corpus, ctx) {
  const rows = [];
  for (const c of CHECKS) {
    const t0 = Date.now();
    const found = [];
    const call = async (arg, mapId) => {
      try { for (const i of asIssues(await c.fn(arg, ctx))) found.push({ ...i, check: c.id, map: mapId }); }
      catch (err) {
        found.push({ code: 'check.threw', severity: 'error', check: c.id, map: mapId,
          msg: `${err.message}${ctx.args.verbose && err.stack ? `\n${err.stack}` : ''}`, at: null });
      }
    };
    if (c.scope === 'corpus') await call(corpus, null);
    else if (c.scope === 'property') await call(ctx, null);
    else for (const e of corpus) await call(e, e.id);
    rows.push({ id: c.id, scope: c.scope, ms: Date.now() - t0, found });
  }
  return rows;
}

// ------------------------------------------------------------------ table
function table(headers, rows) {
  if (!rows.length) return `  ${headers.join('  ')}\n  (none)`;
  const cells = [headers, ...rows].map((r) => r.map((v) => String(v ?? '')));
  const wid = headers.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  const line = (r) => '  ' + r.map((v, i) => (i && !isNaN(Number(v)) && v !== '' ? v.padStart(wid[i]) : v.padEnd(wid[i]))).join('  ').trimEnd();
  return [line(cells[0]), '  ' + wid.map((n) => '-'.repeat(n)).join('  '), ...cells.slice(1).map(line)].join('\n');
}

function severityCount(list, sev) { return list.filter((i) => i.severity === sev).length; }

function printReport(corpus, rows, args, core) {
  const all = rows.flatMap((r) => r.found);
  const out = [];
  out.push('', 'CORPUS');
  out.push(table(['map', 'size', 'def', 'MAP', 'E', 'W', 'notes'], corpus.map((e) => {
    const mine = all.filter((i) => i.map === e.id);
    return [e.id, e.w && e.d ? `${e.w}x${e.d}` : '-', e.def ? 'yes' : '-', e.MAP ? 'yes' : '-',
      severityCount(mine, 'error'), severityCount(mine, 'warn'), e.notes.join('; ')];
  })));
  out.push('', 'CHECKS');
  out.push(table(['check', 'scope', 'ms', 'E', 'W', 'I'], rows.map((r) => [r.id, r.scope, r.ms,
    severityCount(r.found, 'error'), severityCount(r.found, 'warn'), severityCount(r.found, 'info')])));
  const shown = all.filter((i) => args.verbose || i.severity !== 'info')
    .sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  if (shown.length) {
    out.push('', 'FINDINGS');
    for (const i of shown) {
      const at = i.at ? ` ${JSON.stringify(i.at)}` : '';
      out.push(`  ${i.severity.toUpperCase().padEnd(5)} ${i.code}  [${i.map || i.check}]${at}  ${i.msg}`);
    }
  }
  const missing = ['compileMap', 'fromLegacy', 'validateDef', 'analyseMap'].filter((k) => !core[k]);
  if (missing.length) out.push('', `  pending core: ${missing.join(', ')} — checks needing them are skipped`);
  if (!CHECKS.length) out.push('  no checks registered — add tools/checks/<owner>.mjs exporting register(registerCheck, api)');
  out.push('', `  ${corpus.length} map(s), ${CHECKS.length} check(s), ` +
    `${severityCount(all, 'error')} error(s), ${severityCount(all, 'warn')} warning(s)`, '');
  console.log(out.join('\n'));
}

// ------------------------------------------------------------------ check module discovery
async function loadCheckModules(api) {
  let files = [];
  try { files = (await readdir(path.join(HERE, 'checks'))).filter((f) => /\.m?js$/.test(f)).sort(); }
  catch { return []; }                                  // no tools/checks/ yet: that is wave 0
  const loaded = [];
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(path.join(HERE, 'checks', f)).href);
      if (typeof mod.register === 'function') await mod.register(registerCheck, api);
      loaded.push(f);
    } catch (err) { console.error(`  ! tools/checks/${f}: ${err.message}`); }
  }
  return loaded;
}

// ------------------------------------------------------------------ main
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const core = await loadCore();
  const api = { core, args, ROOT, opt };
  await loadCheckModules(api);
  if (args.only) for (let i = CHECKS.length - 1; i >= 0; i--) if (!args.only.includes(CHECKS[i].id)) CHECKS.splice(i, 1);
  const corpus = await loadCorpus(core, args.map);
  const ctx = { args, core, corpus, ROOT };
  const rows = await runChecks(corpus, ctx);
  const errors = rows.reduce((n, r) => n + severityCount(r.found, 'error'), 0);
  if (args.json) {
    console.log(JSON.stringify({ ok: errors === 0, errors,
      corpus: corpus.map((e) => ({ id: e.id, name: e.name, w: e.w, d: e.d, hasDef: !!e.def, hasMap: !!e.MAP, notes: e.notes })),
      checks: rows.map((r) => ({ id: r.id, scope: r.scope, ms: r.ms, found: r.found })) }, null, 2));
  } else printReport(corpus, rows, args, core);
  // A corpus that lost its maps is a failure too: a green run over zero maps proves nothing.
  return errors > 0 || corpus.length === 0 ? 1 : 0;
}

// Importable as a library (a check module may `import { registerCheck } from '../mapcheck.mjs'`)
// without re-entering main; only a direct `node tools/mapcheck.mjs` runs.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(await main());
}
