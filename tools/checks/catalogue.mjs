// PLAN §7 — the whole map catalogue, proved as a corpus rather than one map at a time.
//
// Every other check module answers a question about a MECHANISM (does the compiler round-trip, does
// undo restore the hash, does the generator accept). This one answers the question about the
// PRODUCT: are there N shippable maps in src/world/maps/, does each of them mean what its design
// block claims, and does climbing higher actually get a player there sooner on every one of them.
// The summary table at the bottom is the artefact — base-tier turns and the best express saving,
// one row per map — because that single table is what shows the feature exists at all.
//
// THE THING THIS FILE HAD TO GET RIGHT: the catalogue is declared BEFORE the maps are written, so
// most of it is a promise rather than a file. Three states have to be told apart and only one of
// them is a fault:
//   * catalogued, no module on disk        -> INFO. That is this week; nothing is wrong.
//   * module on disk, REGISTRY line still commented out -> WARN, with the line to uncomment. A map
//     that was authored and never wired up loads for nobody, and nothing else in the tree notices.
//   * registered, and it still fails       -> ERROR, in full.
// The distinction is drawn from the FILESYSTEM, not from an import error string, so a typo inside a
// real map file cannot disguise itself as an absent one.
//
// The legacy map is the other deliberate softening. wendford_crossing.js predates the format: its
// declared 6h and 10h tiers walk the same 10 steps the 4h tier walks, which validate.js already
// reports twice as `contract.ladder`. Escalating that to an error here would red the gate over a
// finding that is already on the board and belongs to the map's owner, so a bridged legacy map gets
// WARN where a native DEF gets ERROR. A map authored to this format signed up for the contract.
import { stat } from 'node:fs/promises';
import path from 'node:path';

const num = (v) => (v === undefined || v === null ? '-' : Number.isFinite(v) ? String(v) : v > 0 ? '∞' : '-∞');
// Keyed by map id, not appended: the per-map check fills these and the corpus check prints them, and
// a harness that visits a map twice (the editor's live panel does) must get one row per map, not one
// row per visit.
const rows = new Map();    // id -> the map's row in the corpus table
const notes = new Map();   // id -> its MAP_META refresh line

function table(headers, body) {
  if (!body.length) return `  ${headers.join('  ')}\n  (none)`;
  const cells = [headers, ...body].map((r) => r.map((v) => String(v ?? '')));
  const wid = headers.map((_, i) => Math.max(...cells.map((r) => [...r[i]].length)));
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
  const line = (r) => '  ' + r.map((v, i) => pad(v, wid[i])).join('  ').trimEnd();
  return [line(cells[0]), '  ' + wid.map((n) => '-'.repeat(n)).join('  '), ...cells.slice(1).map(line)].join('\n');
}

/** The best single face on the map, by steps saved, with the turns that buys the slowest class. */
function bestExpress(a) {
  let best = null;
  for (const [fid, s] of Object.entries(a.faces.savings)) {
    const turns = Math.max(0, ...Object.values(s.turns || {}).filter(Number.isFinite));
    if (!best || s.saving > best.saving) best = { fid, saving: s.saving, turns, climb: s.climb };
  }
  return best;
}

export function register(registerCheck, api) {
  registerCheck({
    id: 'catalogue',
    scope: 'map',
    title: 'every registered map imports, compiles, validates, and keeps its promises',
    fn: async (entry, ctx) => {
      const { validateDef, compileMap, analyseMap } = ctx.core;
      const out = [];

      // -------- 1. it imports. An absent module is today's state, not a fault.
      if (!entry.def) {
        const file = path.join(ctx.ROOT, 'src', 'world', 'maps', `${entry.id}.js`);
        const onDisk = await stat(file).then((s) => s.isFile(), () => false);
        return { code: onDisk ? 'catalogue.broken' : 'catalogue.pending',
          severity: onDisk ? 'error' : 'info',
          msg: onDisk
            ? `${entry.id}: src/world/maps/${entry.id}.js exists but yielded no MapDef — ${entry.notes.join('; ') || 'no DEF and no legacy WENDFORD export'}`
            : `${entry.id}: not landed yet (no src/world/maps/${entry.id}.js); the registry entry is waiting for it` };
      }
      // Legacy-vs-native is decided by what the MODULE exports, not by what the bridged document
      // looks like: fromLegacy() synthesises a design block complete with tiers, so a document-shape
      // test would call wendford_crossing native and hold it to a contract it was written before.
      const mod = await api.opt(`src/world/maps/${entry.id}.js`);
      const legacy = !!(mod && !mod.DEF && mod.WENDFORD);
      const sev = legacy ? 'warn' : 'error';

      // -------- 2. it compiles.
      if (!entry.MAP) return { code: 'catalogue.compile', severity: 'error',
        msg: `${entry.id}: compileMap failed — ${entry.notes.join('; ') || 'no reason recorded'}` };

      // -------- 3. it validates with zero errors. Reported one line per code, not per instance: a
      // map with 40 prop faults is one broken pass, and 40 rows would bury the other maps' findings.
      if (validateDef) {
        const v = validateDef(entry.def);
        const byCode = new Map();
        for (const e of v.errors) byCode.set(e.code, (byCode.get(e.code) || 0) + 1);
        for (const [code, n] of byCode) out.push({ code: 'catalogue.invalid', severity: 'error',
          at: v.errors.find((e) => e.code === code).at,
          msg: `${entry.id}: ${n} x ${code} — ${v.errors.find((e) => e.code === code).msg}` });
      }
      if (!analyseMap) { out.push({ code: 'catalogue.skipped', severity: 'info', msg: `${entry.id}: analysis/report.js absent, so the design contract is unproven` }); return out; }
      const a = analyseMap(entry.MAP, entry.def);
      const declared = (entry.def.design && entry.def.design.tiers) || [];

      // -------- 4. every declared promise is met WITH MARGIN. report.js already errors on an unmet
      // promise, so what is added here is the zero-margin case: `savesTurns: 2` measured at exactly
      // 2 is a claim with no headroom, and a map that declares no promise at all has claimed
      // nothing a reviewer can check — which on a catalogue map is itself the finding.
      if (!a.promises.length) out.push({ code: 'catalogue.no-promise', severity: legacy ? 'info' : 'warn',
        msg: `${entry.id}: design.promises is empty — nothing about this map's tiers is machine-checked` });
      for (const p of a.promises) {
        if (!p.ok) out.push({ code: 'catalogue.promise-unmet', severity: 'error',
          msg: `${entry.id}: promise at ${num(p.tier)}h saves ${num(p.measuredTurns)} of the ${num(p.requiredTurns)} turns it claims (MOVE ${p.move})` });
        else if (p.margin <= 0) out.push({ code: 'catalogue.promise-tight', severity: 'warn',
          msg: `${entry.id}: promise at ${num(p.tier)}h is met exactly (${num(p.measuredTurns)}/${num(p.requiredTurns)} turns, margin 0) — one terrain edit breaks it` });
      }

      // -------- 5. turns strictly decrease across the DECLARED tiers. Turns, not steps: a 6-step
      // saving is worth 2 turns to a MOVE 3 Knight and 0 to nobody, and turns are what a player
      // spends. Split three ways because the three failures mean different things — an inversion is
      // a jumpgraph bug (a tier subgraph is a superset, so it cannot route worse), a tie is a rung
      // that earns nothing, and no net gain over the whole span is a map that does not reward JUMP.
      const lad = a.ladder.rows.filter((r) => r.tier === a.baseClimb || declared.includes(r.tier));
      for (let i = 1; i < lad.length; i++) {
        const p = lad[i - 1], q = lad[i];
        if (q.turnsBySlowest > p.turnsBySlowest) out.push({ code: 'catalogue.ladder-inversion', severity: 'error',
          msg: `${entry.id}: ${num(p.tier)}h walks ${num(p.turnsBySlowest)} turns and ${num(q.tier)}h walks ${num(q.turnsBySlowest)} — climbing higher got WORSE, which is a jumpgraph.js need[] bug, not a map bug` });
        else if (q.turnsBySlowest === p.turnsBySlowest) out.push({ code: 'catalogue.ladder-tie', severity: 'warn',
          msg: `${entry.id}: declared tier ${num(q.tier)}h delivers nothing over ${num(p.tier)}h — both walk ${num(q.steps)} steps (${num(q.turnsBySlowest)} turns at MOVE ${q.slowestMove})` });
      }
      if (lad.length > 1 && !(lad[lad.length - 1].turnsBySlowest < lad[0].turnsBySlowest))
        out.push({ code: 'catalogue.ladder-flat', severity: sev,
          msg: `${entry.id}: the whole ladder from ${num(lad[0].tier)}h to ${num(lad[lad.length - 1].tier)}h saves no turns at all — this map does not reward JUMP` });
      if (!lad.length || !lad[0].connected) out.push({ code: 'catalogue.base-severed', severity: 'error',
        msg: `${entry.id}: the base tier (${num(a.baseClimb)}h) cannot walk A to B` });

      // -------- 6. every declared choke seal-proves BY DELETION, and not vacuously: a choke that
      // "seals" because the spawns were already severed at that climb has proved nothing about the
      // door, and would keep reporting sealed after someone deleted the door entirely.
      if (!a.seals.length) out.push({ code: 'catalogue.no-choke', severity: 'info', msg: `${entry.id}: no declared chokes` });
      for (const s of a.seals) {
        if (!s.sealed) out.push({ code: 'catalogue.choke-leaks', severity: 'error', at: s.leak,
          msg: `${entry.id}: choke ${s.cid || '?'} does not seal at ${num(s.climb)}h — deleting its ${s.tiles} tile(s) still leaves a ${num(s.steps)}-step route past ${JSON.stringify(s.leak)}` });
        else if (s.vacuous) out.push({ code: 'catalogue.choke-vacuous', severity: 'warn',
          msg: `${entry.id}: choke ${s.cid || '?'} seals only because A and B were already severed at ${num(s.climb)}h — the proof is empty` });
      }

      // -------- 7. MAP_META is a cache of def.size (mapregistry.js says so); prove it, and print the
      // literal to paste when it is stale or not yet taken.
      const reg = await api.opt('src/world/mapregistry.js');
      const m = reg && typeof reg.metaOf === 'function' ? reg.metaOf(entry.id) : null;
      if (m && !m.size) notes.set(entry.id, `  ${entry.id}: cache its size — meta('${entry.id}', '${m.name}', ${entry.def.size.w}, ${entry.def.size.d})`);
      else if (m && (m.size.w !== entry.def.size.w || m.size.d !== entry.def.size.d)) {
        out.push({ code: 'catalogue.meta-drift', severity: 'warn',
          msg: `${entry.id}: MAP_META caches ${m.size.w}x${m.size.d} and the document is ${entry.def.size.w}x${entry.def.size.d}; a picker draws the stale number` });
        notes.set(entry.id, `  ${entry.id}: STALE — meta('${entry.id}', '${m.name}', ${entry.def.size.w}, ${entry.def.size.d})`);
      }

      const b = bestExpress(a);
      const worstMargin = a.promises.length ? Math.min(...a.promises.map((p) => p.margin)) : null;
      rows.set(entry.id, [entry.id, `${a.w}x${a.d}`, `${num(a.baseClimb)}h`, num(lad[0] && lad[0].steps),
        num(lad[0] && lad[0].turnsBySlowest), declared.map((t) => `${t}h`).join(' ') || '-',
        num(lad.length > 1 ? lad[0].turnsBySlowest - lad[lad.length - 1].turnsBySlowest : 0),
        b ? `${b.fid} ${num(b.saving)}st/${num(b.turns)}t` : '-',
        `${a.promises.filter((p) => p.ok).length}/${a.promises.length}`,
        worstMargin === null ? '-' : `${worstMargin >= 0 ? '+' : ''}${num(worstMargin)}`,
        `${a.seals.filter((s) => s.sealed && !s.vacuous).length}/${a.seals.length}`,
        a.violations.filter((v) => v.severity === 'error').length || '']);
      out.push({ code: 'catalogue.ok', severity: 'info',
        msg: `${entry.id}: ${a.w}x${a.d}, base ${num(a.baseClimb)}h in ${num(lad[0] && lad[0].turnsBySlowest)} turns, ${a.promises.length} promise(s) kept, ${a.seals.length} choke(s) sealed` });
      return out;
    },
  });

  // PLAN §7 asks for a catalogue, not for whatever happens to be wired up, so the thing to measure
  // is the gap between the two. mapcheck's own corpus is built from MAP_IDS and therefore CANNOT see
  // a catalogued map that is not registered; this check reads MAP_META instead, which is the only
  // place the full catalogue is written down.
  registerCheck({
    id: 'catalogue.registry',
    scope: 'property',
    title: 'every catalogued map is on disk and wired into REGISTRY',
    fn: async () => {
      const reg = await api.opt('src/world/mapregistry.js');
      if (!reg || !Array.isArray(reg.MAP_META)) return { code: 'catalogue.no-registry', severity: 'error', msg: 'src/world/mapregistry.js exports no MAP_META' };
      const out = [], waiting = [];
      for (const m of reg.MAP_META) {
        const file = path.join(api.ROOT, 'src', 'world', 'maps', `${m.id}.js`);
        const onDisk = await stat(file).then((st) => st.isFile(), () => false);
        if (!m.pending && !onDisk) out.push({ code: 'catalogue.registered-absent', severity: 'error',
          msg: `${m.id} is registered but src/world/maps/${m.id}.js does not exist — this breaks \`npx vite build\`, which cannot resolve the literal specifier` });
        else if (m.pending && onDisk) out.push({ code: 'catalogue.unwired', severity: 'warn',
          msg: `${m.id}: src/world/maps/${m.id}.js exists but nothing can load it — uncomment \`${m.id}: () => import('./maps/${m.id}.js'),\` in src/world/mapregistry.js` });
        else if (m.pending) waiting.push(m.id);
      }
      if (waiting.length) out.push({ code: 'catalogue.awaiting', severity: 'info',
        msg: `${waiting.length} catalogued map(s) not written yet: ${waiting.join(', ')}` });
      out.push({ code: 'catalogue.size', severity: 'info',
        msg: `catalogue declares ${reg.MAP_META.length} map(s), ${reg.MAP_IDS.length} loadable` });
      return out;
    },
  });

  registerCheck({
    id: 'catalogue.summary',
    scope: 'corpus',
    title: 'the corpus table: base-tier cost and the best express on every map',
    fn: async (corpus, ctx) => {
      if (ctx.args.json) return null;                     // --json promises nothing else on stdout
      const reg = await api.opt('src/world/mapregistry.js');
      const total = (reg && reg.MAP_META && reg.MAP_META.length) || corpus.length;
      const pending = total - rows.size;
      if (rows.size) console.log(['', 'MAP CATALOGUE  (turns at the base tier vs. the whole declared ladder; express = the single best declared face)',
        table(['map', 'size', 'base', 'steps', 'turns', 'declared tiers', 'turns saved', 'best express', 'promises', 'margin', 'chokes', 'err'], [...rows.values()])].join('\n'));
      if (notes.size) console.log(['', 'MAP_META refresh (src/world/mapregistry.js):', ...notes.values()].join('\n'));
      // A catalogue of eight that proves one map is not a catalogue; say so in one line rather than
      // letting a green run over a mostly-empty corpus read as a finished feature.
      return { code: 'catalogue.corpus', severity: pending > 0 ? 'warn' : 'info',
        msg: `${rows.size}/${total} catalogued map(s) present and proven` +
          (pending > 0 ? `; ${pending} still to land — the catalogue is incomplete` : '') };
    },
  });
}
