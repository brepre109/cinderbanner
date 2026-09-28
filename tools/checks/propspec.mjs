// The props contract (props.md, PLAN §9.4/§9.6). propspec.js is a TRANSCRIPTION of what props.js
// actually builds — five coordinate conventions, a blocking set, a sprite manifest and the stamp
// transform group. Nothing at runtime validates a prop: an unknown type produces no mesh, no error
// and no console line, and a house missing `w`/`d` NaN-loops its footprint to empty and silently
// blocks nothing. So the transcription is only as good as the test that holds it to props.js.
//
// propspec.js and serialize.js ship their own selfTest() and both are run here rather than
// re-implemented, because a second copy of an assertion is a second thing to keep in sync. What this
// file adds on top is everything selfTest cannot see: the SECOND blocking set that lives in
// compile.js, and the corpus's real props — an authored map is a far nastier stamp-transform input
// than a hand-picked sample, and it is the one that ships.

const OPS = ['rot90', 'mirrorX', 'mirrorZ', 'transpose'];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function register(registerCheck) {
  registerCheck({
    id: 'propspec.selftest',
    scope: 'property',
    title: "propspec's own transcription assertions (rot90^4, footprint parity, sprite manifest)",
    fn: async () => {
      const P = await import(new URL('../../src/world/mapformat/propspec.js', import.meta.url).href);
      const out = P.selfTest().map((line) => ({ code: 'propspec.selftest', severity: 'error', msg: line }));
      out.push({ code: 'propspec.selftest-ok', severity: 'info', msg: `${Object.keys(P.PROP_SPEC).length} prop types, ${P.BLOCKING.size} blocking` });
      return out;
    },
  });

  // TWO blocking sets exist: propspec.js DERIVES its Set from PROP_SPEC[t].blocking, compile.js holds
  // the literal transcribed from mapdata.js:28. They are read by different callers (the validator and
  // the compiler), so a drift between them would let a prop block a tile in the rules and not in the
  // editor's preview, or the reverse. footprint() is duplicated for the same reason and compared the
  // same way — on a descriptor of every shape, including the deliberately broken ones.
  registerCheck({
    id: 'propspec.blocking',
    scope: 'property',
    title: 'propspec.BLOCKING and compile.BLOCKING agree, and so do the two footprint()s',
    fn: async () => {
      const P = await import(new URL('../../src/world/mapformat/propspec.js', import.meta.url).href);
      const C = await import(new URL('../../src/world/mapformat/compile.js', import.meta.url).href);
      const out = [];
      for (const t of P.BLOCKING) if (!C.BLOCKING.has(t)) out.push({ code: 'propspec.blocking-drift', severity: 'error', msg: `'${t}' blocks in propspec.js but not in compile.js, so the validator and the compiler disagree about the tile` });
      for (const t of C.BLOCKING) if (!P.BLOCKING.has(t)) out.push({ code: 'propspec.blocking-drift', severity: 'error', msg: `'${t}' blocks in compile.js but not in propspec.js` });
      const cases = [
        { type: 'house', x: 4, z: 4, w: 3, d: 2 }, { type: 'house', x: 4, z: 4 },     // the NaN-loop case
        { type: 'tower', x: 2, z: 18, w: 2, d: 2 }, { type: 'fence', x: 6, z: 17, len: 2, dir: 'x' },
        { type: 'fence', x: 6, z: 17, len: 3, dir: 'z' }, { type: 'ruin', x: 0, z: 16, len: 2, dir: 'z' },
        { type: 'pillar', x: 14.5, z: 5.5 }, { type: 'oak', x: 4.5, z: 10.5 }, { type: 'deck', x: 9, z: 13, len: 2, w: 2, dir: 'z' },
        { type: 'stairs', x: 9, z: 10, dir: 'n' }, { type: 'wall', x: 4, z: 10, len: 5, dir: 'x' }, { type: 'nonesuch', x: 1, z: 1 },
      ];
      for (const p of cases) if (!eq(P.footprint(p), C.footprint(p))) out.push({ code: 'propspec.footprint-drift', severity: 'error', msg: `footprint(${JSON.stringify(p)}) is ${JSON.stringify(P.footprint(p))} in propspec.js and ${JSON.stringify(C.footprint(p))} in compile.js` });
      // A type that blocks must be able to name a tile, and one that does not must never claim one:
      // a walk-through prop with a footprint would close a tile no mesh stands on.
      for (const t of Object.keys(P.PROP_SPEC)) {
        const probe = { type: t, x: 4.5, z: 6.5, w: 2, d: 2, len: 2, dir: 'x', h: 2, th: 2 };
        const fp = P.footprint({ ...probe, ...(P.PROP_SPEC[t].coord === 'nwInt' ? { x: 4, z: 6 } : {}) });
        if (P.BLOCKING.has(t) && !fp.length) out.push({ code: 'propspec.footprint-empty', severity: 'error', msg: `'${t}' is BLOCKING but footprint() of a fully-specified descriptor is empty` });
        if (!P.BLOCKING.has(t) && fp.length) out.push({ code: 'propspec.footprint-phantom', severity: 'error', msg: `'${t}' is walk-through but footprint() claimed ${JSON.stringify(fp)}` });
      }
      return out;
    },
  });

  // The stamp transforms are a group action; the identities below are what make undo, mirror-paint
  // and procgen's 8-orientation re-verification exact rather than approximate. Run over the corpus's
  // OWN props, on the corpus's own non-square boards, because an authored map carries off-convention
  // values (wendford has a cart at an integer coordinate) that a curated sample never would.
  registerCheck({
    id: 'propspec.transforms',
    scope: 'map',
    title: 'rot90^4 = mirrorX^2 = mirrorZ^2 = transpose^2 = identity on every authored prop',
    fn: async (entry) => {
      if (!entry.def || !Array.isArray(entry.def.props)) return { code: 'propspec.skipped', severity: 'info', msg: `${entry.id} has no props` };
      const P = await import(new URL('../../src/world/mapformat/propspec.js', import.meta.url).href);
      const W = entry.def.size.w, D = entry.def.size.d, out = [];
      let n = 0;
      for (const p0 of entry.def.props) {
        if (!P.PROP_SPEC[p0.type]) continue;                 // unknown types are validate.js's finding
        // One transform CANONICALISES an off-convention author value (wendford's cart at 8,17 lands
        // at 8.5,17.5); from that fixed point on the group identities must be exact, so the identity
        // is asserted against the canonical form and not against the raw document.
        const p = P.transformProp(P.transformProp(P.transformProp(P.transformProp(p0, 'rot90', W, D), 'rot90', D, W), 'rot90', W, D), 'rot90', D, W);
        n++;
        let q = p;
        for (let i = 0; i < 4; i++) q = P.transformProp(q, 'rot90', i % 2 ? D : W, i % 2 ? W : D);
        if (!eq(q, p)) out.push({ code: 'propspec.rot90', severity: 'error', at: { prop: p0.pid || p0.type, tile: [Math.floor(p0.x), Math.floor(p0.z)] }, msg: `${entry.id}: rot90^4 moved ${p0.type} ${p0.pid || ''}: ${JSON.stringify(p)} -> ${JSON.stringify(q)}` });
        for (const op of OPS.slice(1)) {
          const dims = op === 'transpose' ? [D, W] : [W, D];
          const r = P.transformProp(P.transformProp(p, op, W, D), op, dims[0], dims[1]);
          if (!eq(r, p)) out.push({ code: 'propspec.involution', severity: 'error', at: { prop: p0.pid || p0.type, tile: [Math.floor(p0.x), Math.floor(p0.z)] }, msg: `${entry.id}: ${op}^2 moved ${p0.type} ${p0.pid || ''}: ${JSON.stringify(p)} -> ${JSON.stringify(r)}` });
        }
      }
      out.push({ code: 'propspec.transforms-ok', severity: 'info', msg: `${entry.id}: ${n} prop(s) survive rot90^4 and all three involutions` });
      return out;
    },
  });

  // Footprint legality, stated against the COMPILED map rather than the document: a blocking prop
  // must stand on tiles that exist, and its rectangle must be one contiguous in-bounds block. An
  // out-of-bounds footprint is not merely untidy — props.js reads map.at(x,z).h unguarded for house,
  // stairs and stall, so an off-board one throws inside buildProps and boots the game.
  registerCheck({
    id: 'propspec.footprints',
    scope: 'map',
    title: 'every authored prop footprint lands on real tiles',
    fn: async (entry) => {
      if (!entry.MAP || !entry.def) return { code: 'propspec.skipped', severity: 'info', msg: `${entry.id} did not compile` };
      const P = await import(new URL('../../src/world/mapformat/propspec.js', import.meta.url).href);
      const { w, d } = entry.def.size, out = [];
      let tiles = 0;
      for (const p of (entry.def.props || [])) {
        const at = { prop: p.pid || p.type, tile: [Math.floor(p.x), Math.floor(p.z)] };
        if (!P.PROP_SPEC[p.type]) continue;
        for (const [x, z] of P.footprint(p)) {
          tiles++;
          if (!Number.isInteger(x) || !Number.isInteger(z)) out.push({ code: 'propspec.footprint-fractional', severity: 'error', at, msg: `${entry.id}: ${p.type} ${p.pid || ''} claims a fractional tile ${x},${z}; MAP.tiles is indexed by integers and the block silently misses` });
          else if (x < 0 || z < 0 || x >= w || z >= d) out.push({ code: 'propspec.footprint-oob', severity: 'error', at, msg: `${entry.id}: ${p.type} ${p.pid || ''} blocks ${x},${z}, outside the ${w}x${d} board` });
          else if (entry.MAP.tiles[z][x].walk) out.push({ code: 'propspec.footprint-open', severity: 'error', at, msg: `${entry.id}: ${p.type} ${p.pid || ''} claims ${x},${z} but the compiled tile is still walkable — the blocking pass did not run over it` });
        }
      }
      out.push({ code: 'propspec.footprints-ok', severity: 'info', msg: `${entry.id}: ${tiles} blocked tile(s) all land on real, closed tiles` });
      return out;
    },
  });
}
