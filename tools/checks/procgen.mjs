// PLAN §5.3 / §9.5 — the generator's acceptance loop, checked from the outside. generate() already
// validates internally before it returns; this proves it, because a generate-then-verify loop whose
// verifier drifted from validate.js is a loop that accepts broken maps confidently.
//
// The sweep is deliberately SMALL by default. PLAN §9.5 states 500 seeds x 5 archetypes and that is
// the right number for a release sweep, but a per-commit gate that takes a minute stops being run;
// `--proc=<n>` raises the seed count and CI can schedule the full number separately.
//
// GRACEFUL SKIP, not failure: src/world/procgen/index.js belongs to a concurrent wave-3 worker and
// may not exist yet. An absent generator makes this check report `procgen.absent` as INFO and the
// gate stays green — the alternative would be a red build for work that is merely unfinished, which
// trains everyone to ignore the gate. Once the file lands, every assertion below arms itself.

import { readFile } from 'node:fs/promises';

const DEFAULT_SEEDS = 8;
const ENTRY = 'src/world/procgen/index.js';
const VOCAB = 'src/world/procgen/vocab.js';
const CONSUMER = 'src/world/mapdata.js';   // the generator's only consumer, and therefore the only place it can be bundled from
const FALLBACK_ARCHETYPES = ['highlands', 'gorge', 'ruins', 'mesa', 'causeway'];   // PLAN §5.2

/** Archetype ids, from whatever the generator chooses to publish; PLAN §5.2's five are the floor. */
function archetypesOf(mod) {
  for (const k of ['ARCHETYPES', 'ARCHETYPE_IDS', 'VOCAB', 'VOCABS']) {
    const v = mod[k];
    if (Array.isArray(v) && v.length) return v.map((a) => (typeof a === 'string' ? a : a && a.id)).filter(Boolean);
    if (v && typeof v === 'object') { const ks = Object.keys(v); if (ks.length) return ks; }
  }
  return FALLBACK_ARCHETYPES;
}

export function register(registerCheck, api) {
  const want = Number(api.args.rest.proc);
  const seeds = Number.isFinite(want) && want > 0 ? Math.floor(want) : DEFAULT_SEEDS;

  registerCheck({
    id: 'procgen',
    scope: 'property',
    title: `seeded generator sweep, ${seeds} seed(s) per archetype`,
    fn: async (ctx) => {
      const mod = await api.opt(ENTRY);
      if (!mod || typeof mod.generate !== 'function') {
        return { code: 'procgen.absent', severity: 'info', msg: `${ENTRY} exports no generate(); the procgen sweep is skipped, not failed` };
      }
      const { validateDef, compileMap, analyseMap } = ctx.core;
      if (!validateDef || !compileMap) return { code: 'procgen.absent', severity: 'info', msg: 'validate.js or compile.js is missing, so an accepted map cannot be judged' };

      const out = [];
      const rejections = Object.create(null);
      let ok = 0, tried = 0, attempts = 0;
      const ids = archetypesOf(mod).length ? archetypesOf(mod) : archetypesOf((await api.opt(VOCAB)) || {});
      for (const archetype of ids) {
        for (let s = 0; s < seeds; s++) {
          const seed = 1000 + s * 7919;                 // a stride, not 0..n: adjacent seeds share a mulberry32 prefix
          tried++;
          let res;
          try { res = await mod.generate({ seed, archetype }); } catch (err) {
            out.push({ code: 'procgen.threw', severity: 'error', msg: `generate({seed:${seed}, archetype:'${archetype}'}) threw: ${err.message}` });
            continue;
          }
          const def = res && res.def ? res.def : res;
          for (const [k, n] of Object.entries((res && res.rejections) || {})) rejections[k] = (rejections[k] || 0) + n;
          attempts += (res && res.attempts) || 0;
          if (!def || typeof def !== 'object') {
            out.push({ code: 'procgen.no-def', severity: 'error', msg: `generate({seed:${seed}, archetype:'${archetype}'}) returned no def` });
            continue;
          }
          // Every accepted map must clear the SAME validator the corpus clears. Reporting only the
          // first error per candidate keeps a systematically broken archetype to one row per seed.
          const v = validateDef(def);
          if (!v.ok) { out.push({ code: 'procgen.invalid', severity: 'error', at: v.errors[0].at, msg: `seed ${seed} / ${archetype}: accepted map has ${v.errors.length} validator error(s), first ${v.errors[0].code}: ${v.errors[0].msg}` }); continue; }

          // Monotonicity is the generator's own contract (PLAN §5.3 criterion 10) and jumpgraph's
          // theorem: tier subgraphs are nested, so steps can only fall as the climb rises.
          if (analyseMap) {
            let a;
            try { a = analyseMap(compileMap(def), def); } catch (err) {
              out.push({ code: 'procgen.analysis-threw', severity: 'error', msg: `seed ${seed} / ${archetype}: analyseMap threw: ${err.message}` }); continue;
            }
            if (!a.ladder.monotone) { out.push({ code: 'procgen.ladder', severity: 'error', msg: `seed ${seed} / ${archetype}: ladder is not monotone — ${a.ladder.violations.map((x) => x.code).join(', ')}` }); continue; }
            const errs = a.violations.filter((x) => x.severity === 'error');
            if (errs.length) { out.push({ code: 'procgen.contract', severity: 'error', msg: `seed ${seed} / ${archetype}: accepted map breaks its own contract — ${errs[0].code}: ${errs[0].msg}` }); continue; }
          }
          // Reproducibility from the seed alone is what makes a generated map reviewable at all
          // (PLAN §2 `gen`); without it a bug report carries a 20x20 grid instead of a number.
          if (!def.gen || def.gen.seed !== seed) out.push({ code: 'procgen.provenance', severity: 'warn', msg: `seed ${seed} / ${archetype}: def.gen is ${JSON.stringify(def.gen)}, so this map cannot be regenerated from its seed` });
          ok++;
        }
      }
      const rate = tried ? Math.round((ok / tried) * 100) : 0;
      out.push({ code: 'procgen.rate', severity: rate >= 90 || !tried ? 'info' : 'warn',
        msg: `${ok}/${tried} candidates accepted (${rate}%, PLAN §9.5 wants >= 90%), ${attempts} internal attempt(s)` });
      const hist = Object.entries(rejections).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`);
      if (hist.length) out.push({ code: 'procgen.rejections', severity: 'info', msg: `rejection histogram: ${hist.join(', ')}` });
      return out;
    },
  });

  // vocab.js lands before index.js does (an archetype is a data row, PLAN §5.2), and it ships its own
  // consistency check. Running it early means the generator's data is already known-good on the day
  // its builder arrives, instead of both landing untested at once.
  registerCheck({
    id: 'procgen.vocab',
    scope: 'property',
    title: "the archetype table's own consistency check",
    fn: async () => {
      const v = await api.opt(VOCAB);
      if (!v) return { code: 'procgen.absent', severity: 'info', msg: `${VOCAB} is not present yet` };
      const ids = archetypesOf(v);
      const out = typeof v.checkVocab === 'function'
        ? (v.checkVocab() || []).map((line) => ({ code: 'procgen.vocab', severity: 'error', msg: String(line) })) : [];
      for (const id of FALLBACK_ARCHETYPES) if (!ids.includes(id)) out.push({ code: 'procgen.vocab-missing', severity: 'warn', msg: `PLAN §5.2 names archetype '${id}' and the table does not carry it` });
      out.push({ code: 'procgen.vocab-ok', severity: 'info', msg: `${ids.length} archetype(s): ${ids.join(', ')}` });
      return out;
    },
  });

  // Determinism is the whole basis of `?map=proc:<seed>`: the same seed must hand two players the
  // same battlefield, on two machines, in two builds. Cheap to check and catastrophic to lose.
  registerCheck({
    id: 'procgen.determinism',
    scope: 'property',
    title: 'the same seed generates a byte-identical document',
    fn: async () => {
      const mod = await api.opt(ENTRY);
      if (!mod || typeof mod.generate !== 'function') return { code: 'procgen.absent', severity: 'info', msg: `${ENTRY} is not present yet` };
      const { hashDef } = await import(new URL('../../src/world/mapformat/serialize.js', import.meta.url).href);
      const out = [];
      for (const archetype of archetypesOf(mod).slice(0, 3)) {
        const a = await mod.generate({ seed: 4242, archetype }), b = await mod.generate({ seed: 4242, archetype });
        const da = a && a.def ? a.def : a, db = b && b.def ? b.def : b;
        if (!da || !db) continue;
        if (hashDef(da) !== hashDef(db)) out.push({ code: 'procgen.nondeterministic', severity: 'error', msg: `archetype '${archetype}' seed 4242 produced ${hashDef(da)} and then ${hashDef(db)}: ?map=proc:4242 is not reproducible` });
      }
      return out.length ? out : { code: 'procgen.determinism-ok', severity: 'info', msg: 'seed 4242 reproduces byte for byte' };
    },
  });

  // Every check above imports the generator by PATH, under bare node, which is exactly the blind spot
  // that let procgen ship as dead code: mapdata.js is its ONLY consumer and it loaded the module
  // through a variable (`import(/* @vite-ignore */ PROCGEN)`), so rollup emitted no chunk and
  // `?map=proc:<seed>` 404'd into the Wendford fallback in every production build while all three
  // sweeps above stayed green. A dynamic import is only bundled when its specifier is a LITERAL, so
  // that literal is the thing to assert. WARN, not error: this file is not ours to edit and a red
  // gate for another owner's one-line fix teaches everyone to ignore the gate.
  registerCheck({
    id: 'procgen.reachable',
    scope: 'property',
    title: 'the shipped build can actually reach the generator',
    fn: async () => {
      const mod = await api.opt(ENTRY);
      if (!mod || typeof mod.generate !== 'function') return { code: 'procgen.absent', severity: 'info', msg: `${ENTRY} is not present yet` };
      let src;
      try { src = await readFile(new URL(`../../${CONSUMER}`, import.meta.url), 'utf8'); }
      catch { return { code: 'procgen.reachable-skip', severity: 'info', msg: `${CONSUMER} is unreadable, so bundling cannot be judged` }; }
      if (!/procgen/.test(src)) return { code: 'procgen.unwired', severity: 'warn', msg: `${CONSUMER} never mentions procgen: ?map=proc:<seed> resolves to nothing` };
      // Order matters and the first draft of this check got it wrong: mapdata.js documents the fix in a
      // `// TODO` comment that CONTAINS the literal import, so a naive regex read the comment and
      // pronounced the module bundled. So collapse the comments rollup itself skips (the @vite-ignore
      // between `import(` and its argument), then delete every remaining comment, then match code only.
      const code = src.replace(/import\(\s*(?:\/\*[\s\S]*?\*\/\s*)+/g, 'import(')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/[ \t]+\/\/(?!\/).*$/gm, '');
      const literals = [...code.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
      if (literals.some((q) => /procgen\/index\.(m?js)$/.test(q))) {
        return { code: 'procgen.reachable-ok', severity: 'info', msg: `${CONSUMER} imports the generator by literal specifier, so vite emits the chunk` };
      }
      const ignored = /@vite-ignore/.test(src) ? ' (it carries a @vite-ignore)' : '';
      return { code: 'procgen.unbundled', severity: 'warn',
        msg: `${CONSUMER} loads the generator through a non-literal import${ignored}: no chunk is emitted, so ?map=proc:<seed> 404s and falls back in every production build. Fix is one line — import('./procgen/index.js') as a literal.` };
    },
  });
}
