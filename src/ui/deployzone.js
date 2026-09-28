// Deploy zones and default spacing for the pre-battle DEPLOYMENT phase (src/ui/deploy.js). Pure: no three.js, no DOM,
// so node can check every campaign map (the ux harness) without a browser.
//
// R15 (review15 P7): the zone used to be the map's A spawns plus at most four tiles beside them -- about 2x3 on most
// maps, so five soldiers stood shoulder to shoulder, lances through each other. The zone is now grown per map:
//   - the A spawns, then any tiles the map declares (map.deploy.A / map.deployA);
//   - then tiles within ZONE_R steps of a spawn over walkable ground (a step may climb or drop at most 2), never nearer
//     the enemy than the FRONT of the spawn block (so a free pick can never buy a turn of approach), never on a foe,
//     never on a void / unwalkable tile; nearest-to-the-block first, so the zone stays one compact, readable shape;
//   - until it holds max(MIN_ZONE, 2 x party) tiles.
// spreadDefault() then lays the company out on it with a tile between neighbours wherever the zone allows.
const md = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
const key = (t) => `${t.x},${t.z}`;
export const MIN_ZONE = 12, ZONE_R = 3;

export function deployTiles(map, units = [], party = 5) {
  const A = (map.spawns?.A || []).map(([x, z]) => ({ x, z }));
  const B = (map.spawns?.B || []).map(([x, z]) => ({ x, z }));
  const decl = [].concat(map.deploy?.A || map.deployA || []).map((t) => (Array.isArray(t) ? { x: t[0], z: t[1] } : t));
  const ok = (t) => { const c = map.at(t.x, t.z); return c && c.walk && !c.void; };
  const out = []; const seen = new Set(); const add = (t) => { if (!seen.has(key(t)) && ok(t)) { seen.add(key(t)); out.push({ x: t.x, z: t.z }); } };
  A.forEach(add); decl.forEach(add);
  const foes = units.filter((u) => u.team !== 'A' && !u.removed); const ref = foes.length ? foes : B;
  const want = Math.max(MIN_ZONE, 2 * party);
  if (A.length && ref.length && out.length < want) {
    const near = (t) => Math.min(...ref.map((e) => md(e, t)));
    const front = Math.min(...A.map(near));
    const hOf = (t) => map.at(t.x, t.z).h;
    const foeAt = new Set(foes.map(key));
    // BFS over walkable ground from the spawn block
    const dist = new Map(A.map((s) => [key(s), 0])); const q = A.slice(); const cand = [];
    while (q.length) {
      const c = q.shift(); const d = dist.get(key(c)); if (d >= ZONE_R) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = { x: c.x + dx, z: c.z + dz }; const k = key(t); if (dist.has(k) || !ok(t)) continue;
        if (Math.abs(hOf(t) - hOf(c)) > 2) continue;
        dist.set(k, d + 1); q.push(t);
        if (!seen.has(k) && !foeAt.has(k) && near(t) >= front) cand.push({ ...t, d: d + 1, n: near(t) });
      }
    }
    // compact: fewest steps from the block first, then the tiles further from the enemy (the back rank), then stable
    cand.sort((a, b) => a.d - b.d || b.n - a.n || a.z - b.z || a.x - b.x);
    for (const t of cand) { if (out.length >= want) break; add(t); }
  }
  return out;
}

/**
 * Default placement: the company is laid out on the zone so that nobody stands side by side with another ally, and as
 * few as possible on a diagonal (at two of the four camera stops a diagonal neighbour stands straight behind, sprite
 * over sprite), each as close to its own spawn as the spacing allows. Exhaustive over the zone (<= C(12,5) x 5! tiny
 * cases), so the answer is the best one, not a greedy accident of roster order. Returns [{ unit, x, z }] for the units
 * that move. Deterministic.
 */
export function spreadDefault(allies, tiles, map) {
  const n = allies.length; if (!n || tiles.length < n || n > 6) return [];
  const T = tiles.slice(0, 14); const hOf = (t) => map.at(t.x, t.z)?.h ?? 0;
  const pair = (a, b) => { const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z); return dx + dz === 1 ? 40 : dx === 1 && dz === 1 ? 7 : dx + dz === 2 ? 1 : 0; };
  const home = allies.map((u) => ({ x: u.x, z: u.z }));
  const cost1 = (i, t) => md(home[i], t) * 3 + Math.abs(hOf(t) - hOf(home[i])) * 0.5;
  const perms = []; const permute = (arr, k = 0) => { if (k === arr.length) { perms.push(arr.slice()); return; } for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; permute(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; } };
  permute([...Array(n).keys()]);
  let best = null, bc = Infinity; const pick = [];
  const rec = (start) => {
    if (pick.length === n) {
      let c = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) c += pair(T[pick[i]], T[pick[j]]);
      if (c >= bc) return;
      let ac = Infinity, ap = null; for (const p of perms) { let s = c; for (let i = 0; i < n && s < ac; i++) s += cost1(i, T[pick[p[i]]]); if (s < ac) { ac = s; ap = p; } }
      if (ac < bc) { bc = ac; best = ap.map((pi) => T[pick[pi]]); }
      return;
    }
    for (let i = start; i <= T.length - (n - pick.length); i++) { pick.push(i); rec(i + 1); pick.pop(); }
  };
  rec(0);
  return best ? allies.map((u, i) => ({ unit: u, x: best[i].x, z: best[i].z })).filter((m) => m.x !== m.unit.x || m.z !== m.unit.z) : [];
}
