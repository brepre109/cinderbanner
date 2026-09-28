// The hole this closes: mapcheck's CORPUS table computes E/W per map from the findings REGISTERED
// checks return, and until this file existed nothing ever called validateDef. A corpus of broken
// maps therefore printed `0 0` and exited 0 — a green gate that proved nothing. This check runs the
// real validator, the same one the editor's Issues panel runs, over every corpus map.
//
// Findings are re-emitted in mapcheck's issue shape and DELIBERATELY stripped of `fix`: a fix is a
// closure, --json must stay serialisable, and CI has nobody to click it.
//
// `strict` is exposed as `--strict` rather than assumed. PLAN §2 makes strict ("every warn is an
// error") the bar a SHIPPING map must clear, but the corpus holds work in progress, so the default
// gate is errors-only and the strict sweep is a flag a release check turns on.

const CODE_SKIP = 'validate.skipped';

/** @param {(c:object)=>string} registerCheck @param {{core:object,args:object}} api */
export function register(registerCheck, api) {
  const strict = !!api.args.rest.strict;

  registerCheck({
    id: 'validate',
    scope: 'map',
    title: `validateDef over every corpus map${strict ? ' (strict)' : ''}`,
    fn: (entry, ctx) => {
      const validateDef = ctx.core.validateDef;
      if (!validateDef) return { code: CODE_SKIP, severity: 'info', msg: 'validate.js is not present' };
      if (!entry.def) return { code: CODE_SKIP, severity: 'info', msg: `${entry.id} has no def to validate` };
      const r = validateDef(entry.def, { strict });
      const out = [];
      // Infos are carried too: mapcheck hides them unless --verbose, and a `design.pocket` or a
      // `hazard.fall` is exactly the kind of fact a reviewer wants on demand and never by default.
      for (const i of r.issues) out.push({ code: i.code, severity: i.severity, msg: i.msg, at: i.at });
      // The validator caps findings per code at 16 and emits meta.suppressed for the tail, so a
      // 48x48 sheet of garbage cannot bury the one row that matters; that tail is already an issue.
      if (!out.length) out.push({ code: 'validate.clean', severity: 'info', msg: `${entry.id}: no findings` });
      return out;
    },
  });

  // A validator that cannot survive its own repairs is not a repair tool. Every fix in PLAN §3.1 is
  // documented PURE and IDEMPOTENT, and both halves are cheap to prove: apply once, apply twice,
  // require the second application to change nothing and the source document to be untouched.
  registerCheck({
    id: 'validate.fixes',
    scope: 'map',
    title: 'every offered fix is pure and idempotent',
    fn: async (entry, ctx) => {
      const validateDef = ctx.core.validateDef;
      if (!validateDef || !entry.def) return { code: CODE_SKIP, severity: 'info', msg: 'no validator or no def' };
      const { hashDef } = await import(new URL('../../src/world/mapformat/serialize.js', import.meta.url).href);
      const before = hashDef(entry.def);
      const out = [];
      let n = 0;
      for (const i of validateDef(entry.def).issues) {
        if (!i.fix || typeof i.fix.apply !== 'function') continue;
        n++;
        let once, twice;
        try { once = i.fix.apply(entry.def); twice = i.fix.apply(once); } catch (err) {
          out.push({ code: 'validate.fix-threw', severity: 'error', at: i.at, msg: `fix '${i.fix.label}' for ${i.code} threw: ${err.message}` });
          continue;
        }
        if (hashDef(entry.def) !== before) out.push({ code: 'validate.fix-impure', severity: 'error', at: i.at, msg: `fix '${i.fix.label}' for ${i.code} mutated the input document` });
        if (hashDef(once) !== hashDef(twice)) out.push({ code: 'validate.fix-unstable', severity: 'error', at: i.at, msg: `fix '${i.fix.label}' for ${i.code} is not idempotent: a second apply changed the document again` });
      }
      out.push({ code: 'validate.fix-count', severity: 'info', msg: `${entry.id}: ${n} offered fix(es) checked` });
      return out;
    },
  });

  // The codes ARE the API (mapcheck diffs finding sets by code between commits). A finding whose
  // code is not in ISSUE_CODES has no declared severity and silently defaults to 'warn' inside
  // validateDef's add(), so a typo'd code downgrades an error into a warning with no other symptom.
  registerCheck({
    id: 'validate.codes',
    scope: 'property',
    title: 'every emitted code is declared in ISSUE_CODES',
    fn: async (ctx) => {
      if (!ctx.core.validateDef) return { code: CODE_SKIP, severity: 'info', msg: 'validate.js is not present' };
      const { ISSUE_CODES, validateDef } = await import(new URL('../../src/world/mapformat/validate.js', import.meta.url).href);
      const out = [];
      const seen = new Set();
      for (const e of ctx.corpus) {
        if (!e.def) continue;
        for (const i of validateDef(e.def).issues) {
          seen.add(i.code);
          if (!ISSUE_CODES[i.code]) out.push({ code: 'validate.code-undeclared', severity: 'error', at: i.at, msg: `${e.id} emitted '${i.code}', which ISSUE_CODES does not declare, so its severity silently defaulted to warn` });
        }
      }
      out.push({ code: 'validate.code-coverage', severity: 'info', msg: `${seen.size} of ${Object.keys(ISSUE_CODES).length} declared codes exercised by the corpus` });
      return out;
    },
  });
}
