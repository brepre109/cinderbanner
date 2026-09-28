// PLAN §9.2 — the highest-value test in the build. jumpgraph.js is a REWRITE of the movement search
// in src/game/rules.js: a static Int16Array of |dh| per edge, thresholded per tier, floodable with a
// ring BFS instead of rules.js's string-keyed Dijkstra. Every map in the catalogue, every declared
// face, every choke and every promise is proven against that rewrite. If the rewrite and the live
// rules ever disagree, the whole catalogue is validated against a fiction — silently, because the
// maps still load and still play. So: run BOTH, from many seeded start tiles, and require the tile
// sets AND the step distances to be identical.
//
// rules.js is the gameplay owner's file and is never edited here. The probe is built through the
// real makeUnit() with a real class and a real MOVEMENTS row, and every confounder rules.js can
// apply is disabled BY CONSTRUCTION rather than by mocking:
//   units = [u]            no occupancy, no enemy blocking, no KO'd bodies to route around
//   only one unit          the rampart_aura seal is enemies-only, so it cannot arm
//   moveBonus = 9999       pilgrims_step / unyielding_step add their conditional +1 only to tiles
//                          with d > move; with move above the board's diameter no tile qualifies
//   teleport excluded      its branch is a Manhattan disc that ignores connectivity AND jump
//   float via u.statuses   rules.js:161 crosses water for terrain_walker or the Float STATUS only,
//                          which is exactly what reachField's `water` flag models
// reachable() drops d === 0, so the origin is removed from the analyser's set before comparing.
import { makeUnit, reachable, MOVEMENTS } from '../../src/game/rules.js';
import { CLASS_PROFILES, profileFor, TELEPORT_MOVEMENT } from '../../src/world/analysis/profiles.js';
import { buildGraph, reachField } from '../../src/world/jumpgraph.js';

const BIG_MOVE = 9999;          // above any legal board's diameter (48x48 -> 2304 tiles)
const DEFAULT_SOURCES = 24;     // per map, per probe. --parity=<n> raises it for a deeper sweep.
const REPORT_CAP = 4;           // divergences listed per map before the tail is counted instead

/**
 * One probe per distinct (climb, water) the live roster can actually field, built from a real
 * class plus a real movement ability and, for the water half, the Float status. Deriving the table
 * instead of listing representative classes is the point: a gameplay owner who adds a class or
 * retunes a MOVEMENTS row changes what CI probes, for free.
 */
function probes() {
  const seen = new Map();
  for (const cls of Object.keys(CLASS_PROFILES)) {
    for (const movement of [undefined, ...Object.keys(MOVEMENTS)]) {
      if (movement === TELEPORT_MOVEMENT) continue;
      for (const float of [false, true]) {
        const p = profileFor(cls, { movement, float });
        if (!p || p.teleport) continue;
        const k = `${p.climb}|${p.water}`;   // climb, not jump: every ignore_height variant is jump 99+ and one identical unbounded flood
        if (!seen.has(k)) seen.set(k, { cls, movement: p.movement, float, jump: p.jump, climb: p.climb, water: p.water });
      }
    }
  }
  return [...seen.values()].sort((a, b) => (a.jump - b.jump) || (a.water ? 1 : -1));
}

// A fixed 32-bit LCG, not Math.random: a failure a rerun cannot reproduce is not a failure anybody
// fixes. The seed is the map id, so two maps sample different tiles and one map samples the same
// tiles on every machine and every commit.
function rng(seedStr) {
  let s = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) s = Math.imul(s ^ seedStr.charCodeAt(i), 0x01000193) >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000;
}

/** Evenly spread sample of the nodes a probe may legally stand on: land tiles for a land probe,
 *  any passable tile (open water included) for a water-capable one. */
function sources(g, water, n, rand) {
  const pool = [];
  for (let i = 0; i < g.n; i++) if (water ? g.pass[i] !== 0 : (g.pass[i] & 1) === 1) pool.push(i);
  if (pool.length <= n) return pool;
  for (let i = pool.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, n).sort((a, b) => a - b);
}

/** The live oracle. Returns node -> step distance, origin excluded, exactly as rules.js reports it. */
function liveField(MAP, g, probe, node) {
  const [x, z] = g.xz(node);
  const u = makeUnit('parity_probe', 'A', probe.cls, x, z, 'probe', { movement: probe.movement });
  if (probe.float) u.statuses.float = true;
  u.moveBonus = BIG_MOVE;
  const out = new Map();
  for (const t of reachable(u, MAP, [u]).tiles) out.set(g.idx(t.x, t.z), t.d);
  return out;
}

export function register(registerCheck, api) {
  const want = Number(api.args.rest.parity);
  const nSources = Number.isFinite(want) && want > 0 ? Math.floor(want) : DEFAULT_SOURCES;
  const table = probes();

  registerCheck({
    id: 'parity',
    scope: 'map',
    title: `reachField vs the live rules.js reachable(), ${table.length} probes x ${nSources} start tiles`,
    fn: (entry) => {
      if (!entry.MAP) return { code: 'parity.skipped', severity: 'info', msg: `${entry.id} did not compile` };
      const g = buildGraph(entry.MAP);
      const out = [];
      let compared = 0, diverged = 0;
      for (const p of table) {
        const rand = rng(`${entry.id}|${p.jump}|${p.water}`);
        for (const s of sources(g, p.water, nSources, rand)) {
          compared++;
          const live = liveField(entry.MAP, g, p, s);
          const mine = reachField(g, { climb: p.climb, water: p.water }, [s]).dist;
          for (let i = 0; i < g.n; i++) {
            const a = i !== s && mine[i] >= 0 ? mine[i] : -1;      // origin excluded: reachable drops d === 0
            const b = live.has(i) ? live.get(i) : -1;
            if (a === b) continue;
            diverged++;
            if (diverged > REPORT_CAP) continue;
            const [sx, sz] = g.xz(s), [tx, tz] = g.xz(i);
            out.push({ code: 'parity.drift', severity: 'error', at: { tile: [tx, tz] },
              msg: `${entry.id}: ${p.cls} (${p.movement}${p.float ? '+float' : ''}, JUMP ${p.jump}, climb ${fmt(p.climb)}h, water ${p.water}) from ${sx},${sz}: jumpgraph says ${a < 0 ? 'unreachable' : a + ' steps'} at ${tx},${tz}, rules.js reachable() says ${b < 0 ? 'unreachable' : b + ' steps'}` });
          }
        }
      }
      if (diverged > REPORT_CAP) out.push({ code: 'parity.drift', severity: 'error', at: null,
        msg: `${entry.id}: ${diverged - REPORT_CAP} further tile disagreement(s) not listed` });
      out.push({ code: 'parity.ok', severity: 'info', msg: `${entry.id}: ${compared} flood(s) compared tile for tile, ${diverged} disagreement(s)` });
      return out;
    },
  });

  // The probe table is derived, so a roster change can silently stop exercising a tier. PLAN §9.2
  // states the sweep over JUMP 1..5; if the live data can no longer build one of those, the parity
  // check above still passes and covers less, which is precisely the rot worth naming out loud.
  registerCheck({
    id: 'parity.coverage',
    scope: 'property',
    title: 'the roster can still field a land probe at JUMP 1..5',
    fn: () => {
      const out = [];
      for (let j = 1; j <= 5; j++) {
        if (!table.some((p) => p.jump === j && !p.water)) out.push({ code: 'parity.no-probe', severity: 'warn', msg: `no class + MOVEMENTS row in the live roster yields JUMP ${j} on land, so the parity sweep no longer covers the ${j * 2}h tier` });
      }
      out.push({ code: 'parity.probes', severity: 'info', msg: `probes: ${table.map((p) => `${p.cls}/${p.movement}${p.float ? '+f' : ''} J${p.jump}${p.water ? 'w' : ''}`).join(', ')}` });
      return out;
    },
  });
}

const fmt = (v) => (Number.isFinite(v) ? v : '∞');
