// PLAN §9.3 — every map's DECLARED design promises are proven, not inspected, and the ladder that
// proves them is printed so a reviewer sees the numbers move in a diff.
//
// The division of labour with validate.mjs is deliberate and not redundant: validate.js judges a
// document (shapes, seams, props, spawns, and each contract clause one at a time), while report.js
// answers the design question — does climbing higher actually get you there sooner, and by how much.
// Both run the same jumpgraph kernel, so an agreement between them is worth having; a disagreement
// would show up here as a violation validate.js did not raise, which is itself the finding.
//
// A promise met EXACTLY is reported as a warning, not silence. `savesTurns: 1` measured at exactly 1
// turn is a claim with no headroom: the next terrain tweak breaks it, and the map's author should
// know that before the tweak, not after.
//
// The ladder table is buffered by the per-map check and printed once by a corpus-scope check that
// runs after it — mapcheck runs checks in registration order — and never under --json, which the
// harness documents as machine-readable with nothing else on stdout.

const rows = [];
const num = (v) => (v === undefined || v === null ? '-' : Number.isFinite(v) ? String(v) : v > 0 ? '∞' : '-∞');

function table(headers, body) {
  if (!body.length) return `  ${headers.join('  ')}\n  (none)`;
  const cells = [headers, ...body].map((r) => r.map((v) => String(v ?? '')));
  const wid = headers.map((_, i) => Math.max(...cells.map((r) => [...r[i]].length)));
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
  const line = (r) => '  ' + r.map((v, i) => pad(v, wid[i])).join('  ').trimEnd();
  return [line(cells[0]), '  ' + wid.map((n) => '-'.repeat(n)).join('  '), ...cells.slice(1).map(line)].join('\n');
}

export function register(registerCheck) {
  registerCheck({
    id: 'analysis',
    scope: 'map',
    title: 'the design contract holds and every promise has margin',
    fn: (entry, ctx) => {
      const analyseMap = ctx.core.analyseMap;
      if (!analyseMap) return { code: 'analysis.skipped', severity: 'info', msg: 'analysis/report.js is not present' };
      if (!entry.MAP) return { code: 'analysis.skipped', severity: 'info', msg: `${entry.id} did not compile` };
      const a = analyseMap(entry.MAP, entry.def || null);
      const out = [];

      // report.js already severity-codes everything it refutes — undeclared faces, phantom faces,
      // worthless faces, leaking chokes, unmet promises, a severed base tier — in validate.js's own
      // issue shape, so they pass straight through rather than being re-derived here.
      for (const v of a.violations) out.push({ code: v.code, severity: v.severity, msg: `${entry.id}: ${v.msg}`, at: v.at ? { tile: v.at } : null });

      // Monotonicity is an assertion about jumpgraph.js, not about the map: tier subgraphs are nested
      // sublevel sets of one need[] array, so a higher climb can only ADD edges. A non-monotone ladder
      // means the kernel is wrong and every number above it is untrustworthy.
      if (!a.ladder.monotone) out.push({ code: 'ladder.non-monotone', severity: 'error', msg: `${entry.id}: the tier ladder is not monotone — ${a.ladder.violations.length} violation(s); this is a jumpgraph.js bug, not a map bug` });

      for (const p of a.promises) {
        const label = `promise ${p.promise.from || 'A'}->${p.promise.to || 'B'} at ${num(p.tier)}h`;
        if (!p.ok) continue;                                   // already an error out of a.violations
        if (p.margin <= 0) out.push({ code: 'analysis.promise-no-margin', severity: 'warn', msg: `${entry.id}: ${label} is met exactly (${num(p.measuredTurns)} of ${num(p.requiredTurns)} turns, margin 0) — the next terrain edit breaks it` });
        else out.push({ code: 'analysis.promise-ok', severity: 'info', msg: `${entry.id}: ${label} saves ${num(p.measuredTurns)} turns, needs ${num(p.requiredTurns)}, margin +${num(p.margin)} (MOVE ${p.move})` });
      }

      // The cache is committed so CI can diff it (PLAN §2). Its own hash is taken of the AUTHORED
      // document, so a terrain edit that moves the ladder without refreshing the cache shows up here
      // instead of in a reviewer's head. A null cache is not drift — it is a map that never cached.
      const cached = entry.def && entry.def.analysis;
      if (cached && cached.hash && a.hash && cached.hash !== a.hash) out.push({ code: 'analysis.cache-drift', severity: 'error', msg: `${entry.id}: def.analysis.hash is ${cached.hash} but the document hashes to ${a.hash} — the cached ladder describes an older map` });

      rows.push(...a.ladder.rows.map((r) => [entry.id, r.label, num(r.steps), num(r.turnsBySlowest), num(r.turnsByFastest),
        `${r.slowestMove}-${r.fastestMove}`, r.area, `${Math.round(r.areaFrac * 100)}%`, r.connected ? 'yes' : 'NO']));
      out.push({ code: 'analysis.summary', severity: 'info', msg: `${entry.id}: A->B needs ${num(a.requiredClimbAB)}h (JUMP ${num(a.requiredJumpAB)}), ${a.faces.declared.length} declared / ${a.faces.discovered.length} discovered face(s), ${a.seals.length} choke(s), ${a.pockets.length} pocket(s), ${a.violations.length} violation(s)` });
      return out;
    },
  });

  registerCheck({
    id: 'analysis.ladder',
    scope: 'corpus',
    title: 'print the tier ladder table',
    fn: (corpus, ctx) => {
      if (ctx.args.json || !rows.length) return null;
      console.log(['', 'TIER LADDER  (turns = ceil((steps-1)/MOVE); slowest and fastest class that can take the tier)',
        table(['map', 'tier', 'steps', 'turns↓', 'turns↑', 'MOVE', 'area', 'reach', 'A-B'], rows)].join('\n'));
      // A ladder every rung of which walks the same distance is a map that does not reward JUMP at
      // all; report.js flags it per map, this is just the corpus-wide count in one line.
      const flat = new Set(rows.filter((r) => r[8] === 'NO').map((r) => r[0]));
      return flat.size ? { code: 'analysis.tier-severed', severity: 'info', msg: `${flat.size} map(s) have at least one tier that cannot walk A to B` } : null;
    },
  });
}
