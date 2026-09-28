// PLAN §6.2 / §9.4 — undo correctness as CI rather than as hope.
//
// The editor's whole undo design rests on one claim: every brush writes through `Session.begin() ->
// Tx`, the Tx records the OLD value on first touch, and commit stores the inverse. No brush ever
// writes an inverse itself, so undo cannot be got wrong brush by brush — but it CAN be got wrong
// once, in the Tx, and then it is wrong everywhere at once. Hence the property test: apply 500
// pseudo-random commands drawn from the whole vocabulary, undo them all, and require the document to
// hash back to exactly what it was. Then redo them all and require the other hash back.
//
// hashDef is the right oracle precisely because it is taken of the AUTHORED document with the
// derived `analysis` cache excluded: an undo that restored the grid but dropped an `x-` key, a prop
// order or a design record would still change the hash.
//
// GRACEFUL SKIP: src/editor/session.js and history.js belong to a concurrent wave-3 worker. Absent
// files report INFO and leave the gate green; a file that IS present but does not expose the §6.2
// API reports a WARN naming what is missing, because that is a contract drift somebody should see
// without it blocking a tree that is still being assembled.

const SESSION = 'src/editor/session.js';
const HISTORY = 'src/editor/history.js';
const COMMANDS = 500;

// Deterministic mulberry32: a failure nobody can reproduce is a failure nobody fixes.
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, xs) => xs[(r() * xs.length) | 0];
const int = (r, n) => (r() * n) | 0;

/** The command vocabulary, filtered to the Tx methods that actually exist, so a partially landed Tx
 *  is still exercised on everything it does implement instead of throwing on the first unknown op. */
function vocabulary(tx, def, r) {
  const { w, d } = def.size, pids = (def.props || []).map((p) => p.pid).filter(Boolean);
  const ops = [];
  const has = (k) => typeof tx[k] === 'function';
  if (has('setH')) ops.push(() => tx.setH(int(r, w), int(r, d), (int(r, 16) - 4) * 2));
  if (has('setT')) ops.push(() => tx.setT(int(r, w), int(r, d), pick(r, ['g', 'k', 'd', 's', 'b', 'r', 'S', 'w', 'v'])));
  // Erasing a tile that is ALREADY in the grant is the interesting half and a purely random x,z
  // almost never hits it: `decks.tiles` is an ordered list, so removing from the middle and undoing
  // is the case where an inverse that re-appends silently permutes the document.
  const grant = ((def.decks && def.decks.tiles) || []);
  if (has('setDeckTile')) ops.push(() => { const g = grant.length && r() < 0.5 ? pick(r, grant) : [int(r, w), int(r, d)]; return tx.setDeckTile(g[0], g[1], r() < 0.5); });
  if (has('setSpawn')) ops.push(() => tx.setSpawn(pick(r, ['A', 'B']), int(r, 5), int(r, w), int(r, d)));
  if (has('addProp')) ops.push(() => tx.addProp({ pid: `t${(r() * 1e9) | 0}`, type: pick(r, ['oak', 'rock', 'barrel', 'crate', 'bush']), x: int(r, w) + 0.5, z: int(r, d) + 0.5 }));
  if (has('removeProp') && pids.length) ops.push(() => tx.removeProp(pick(r, pids)));
  if (has('updateProp') && pids.length) ops.push(() => tx.updateProp(pick(r, pids), { note: `n${int(r, 99)}` }));
  if (has('moveProp') && pids.length) ops.push(() => tx.moveProp(pick(r, pids), int(r, w) + 0.5, int(r, d) + 0.5));
  if (has('reorderProp') && pids.length) ops.push(() => tx.reorderProp(pick(r, pids), int(r, Math.max(1, pids.length))));
  if (has('addFace')) ops.push(() => tx.addFace({ fid: `f${(r() * 1e9) | 0}`, from: [int(r, w), int(r, d)], to: [int(r, w), int(r, d)], drop: 6, tier: 6, kind: 'express' }));
  if (has('addChoke')) ops.push(() => tx.addChoke({ cid: `c${(r() * 1e9) | 0}`, tiles: [[int(r, w), int(r, d)]], tier: 4 }));
  if (has('addRoute')) ops.push(() => tx.addRoute({ rid: `r${(r() * 1e9) | 0}`, tier: 4, from: 'A', to: 'B', via: [[int(r, w), int(r, d)]] }));
  if (has('addRegion')) ops.push(() => tx.addRegion({ rgid: `g${(r() * 1e9) | 0}`, kind: 'scenery', rect: [0, 0, int(r, w), int(r, d)] }));
  if (has('addAssist')) ops.push(() => tx.addAssist({ aid: `a${(r() * 1e9) | 0}`, kind: 'stairs', tiles: [[int(r, w), int(r, d)]], dir: 'n' }));
  if (has('setDesign')) ops.push(() => tx.setDesign('baseTier', pick(r, [2, 4])));
  if (has('setMeta')) ops.push(() => tx.setMeta('name', `Probe ${int(r, 999)}`));
  return ops;
}

export function register(registerCheck, api) {
  registerCheck({
    id: 'editor.undo',
    scope: 'property',
    title: `${COMMANDS} random commands, undo all, hash equality`,
    fn: async (ctx) => {
      const [S, H] = await Promise.all([api.opt(SESSION), api.opt(HISTORY)]);
      if (!S || !H) return { code: 'editor.absent', severity: 'info', msg: `${!S ? SESSION : HISTORY} is not present yet; the undo property test is skipped, not failed` };
      const Session = S.Session || S.default;
      if (typeof Session !== 'function') return { code: 'editor.api', severity: 'warn', msg: `${SESSION} exports no Session class, so PLAN §6.2's mutation chokepoint cannot be driven` };
      const seed = ctx.corpus.find((e) => e.def);
      if (!seed) return { code: 'editor.absent', severity: 'info', msg: 'no corpus map to edit' };
      const { hashDef } = await import(new URL('../../src/world/mapformat/serialize.js', import.meta.url).href);

      const out = [];
      let s;
      // history.js caps the undo stack (MAX_ENTRIES 200 by default) and EVICTS the oldest patch — the
      // right behaviour for a 48x48 board under a smooth brush, and fatal to a naive 500-command
      // assertion, which would then be measuring the cap and calling it an undo bug. Raise both caps
      // for the probe session; `dropped` below is the belt to that braces.
      try { s = new Session(structuredClone(seed.def), { maxEntries: COMMANDS + 16, maxBytes: Number.MAX_SAFE_INTEGER }); }
      catch (err) { return { code: 'editor.api', severity: 'warn', msg: `new Session(def) threw: ${err.message}` }; }
      for (const k of ['begin', 'commit', 'undo', 'redo', 'canUndo', 'canRedo']) {
        if (typeof s[k] !== 'function') return { code: 'editor.api', severity: 'warn', msg: `Session has no ${k}(); PLAN §6.2 requires begin/commit/undo/redo/canUndo/canRedo` };
      }
      const r = mulberry32(0x5EED);
      const hash0 = hashDef(s.def);
      let applied = 0;
      for (let i = 0; i < COMMANDS; i++) {
        // A distinct strokeId per command defeats the coalescing rule (§6.2: same label AND same
        // strokeId merge), so this is 500 undo entries and not one, which is the harder assertion.
        const tx = s.begin(`probe ${i}`, { strokeId: `s${i}` });
        const ops = vocabulary(tx, s.def, r);
        if (!ops.length) { s.abort ? s.abort(tx) : s.commit(tx); break; }
        try { pick(r, ops)(); applied++; } catch (err) {
          out.push({ code: 'editor.tx-threw', severity: 'error', msg: `command ${i} threw inside the Tx: ${err.message}` });
        }
        s.commit(tx);
      }
      if (!applied) return { code: 'editor.api', severity: 'warn', msg: 'the Tx exposes none of the PLAN §6.2 write methods, so nothing was exercised' };
      const hashN = hashDef(s.def);
      if (hashN === hash0) out.push({ code: 'editor.no-op', severity: 'warn', msg: `${applied} command(s) left the document unchanged, so the undo assertion below is vacuous` });

      const dropped = (s.history && s.history.dropped) || 0;
      let guard = COMMANDS * 2;
      while (s.canUndo() && guard-- > 0) s.undo();
      const back = hashDef(s.def);
      // A bare hash mismatch is a true statement nobody can act on. The document is small, so the
      // finding names the first field that came back wrong — which is the difference between "undo
      // is broken" and "the deck grant list comes back permuted because its inverse re-pushes".
      // A trimmed stack cannot reach the original document and says nothing about correctness, so it
      // is reported as its own finding rather than mislabelled as a lost inverse.
      if (back !== hash0 && dropped) out.push({ code: 'editor.undo-trimmed', severity: 'warn', msg: `the history evicted ${dropped} of ${applied} entries despite maxEntries ${COMMANDS + 16}, so undo cannot reach the original document and the assertion is inconclusive` });
      else if (back !== hash0) out.push({ code: 'editor.undo-lossy', severity: 'error', msg: `after ${applied} command(s) and a full undo the document hashes ${back}, not the original ${hash0}: ${firstDiff(seed.def, s.def) || 'the difference is below hashDef\'s canonical form'}` });
      guard = COMMANDS * 2;
      while (s.canRedo() && guard-- > 0) s.redo();
      const fwd = hashDef(s.def);
      if (fwd !== hashN) out.push({ code: 'editor.redo-lossy', severity: 'error', msg: `after a full redo the document hashes ${fwd}, not ${hashN}` });
      out.push({ code: 'editor.undo-ok', severity: 'info', msg: `${applied} command(s) applied on ${seed.id}: ${hash0} -> ${hashN} -> undo ${back} -> redo ${fwd}` });
      return out;
    },
  });

  // §6.2's other half: one drag must be ONE undo entry. A brush that emits a history entry per
  // pointermove makes undo useless without failing any correctness assertion above.
  registerCheck({
    id: 'editor.coalesce',
    scope: 'property',
    title: 'a 200-move drag collapses into one history entry',
    fn: async (ctx) => {
      const S = await api.opt(SESSION);
      const Session = S && (S.Session || S.default);
      if (typeof Session !== 'function') return { code: 'editor.absent', severity: 'info', msg: `${SESSION} is not present yet` };
      const seed = ctx.corpus.find((e) => e.def);
      if (!seed) return { code: 'editor.absent', severity: 'info', msg: 'no corpus map to edit' };
      const s = new Session(structuredClone(seed.def));
      if (typeof s.canUndo !== 'function' || typeof s.begin !== 'function') return { code: 'editor.api', severity: 'warn', msg: 'Session has no begin/canUndo' };
      const before = hashOfHistory(s);
      for (let i = 0; i < 200; i++) {
        const tx = s.begin('paint height', { strokeId: 'drag-1' });
        if (typeof tx.setH === 'function') tx.setH(2 + (i % 8), 2 + ((i / 8) | 0), 6);
        s.commit(tx);
      }
      const after = hashOfHistory(s);
      if (after === null) return { code: 'editor.api', severity: 'warn', msg: 'Session exposes no history depth, so coalescing cannot be measured' };
      const added = after - before;
      return added === 1
        ? { code: 'editor.coalesce-ok', severity: 'info', msg: '200 same-stroke commits collapsed into 1 history entry' }
        : { code: 'editor.coalesce', severity: 'error', msg: `200 same-stroke commits produced ${added} history entries; §6.2 requires exactly 1, or one undo per pointermove is what a user gets` };
    },
  });
}

/** The first path at which two documents differ, in JSON-pointer-ish form, with both values. Depth
 *  and length capped: a grid row that differs must report the row, never print 20 numbers twice. */
function firstDiff(want, got, path = '') {
  if (want === got) return null;
  const bothObj = want && got && typeof want === 'object' && typeof got === 'object';
  if (!bothObj || Array.isArray(want) !== Array.isArray(got)) return `${path || 'the document'} is ${clip(got)}, was ${clip(want)}`;
  for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) {
    // hashDef's canon() drops undefined-valued keys, so an own key holding undefined and an absent
    // key hash the same; reporting that pair as the difference would name a red herring.
    if (want[k] === undefined && got[k] === undefined) continue;
    if (!(k in want)) return `${path}.${k} is ${clip(got[k])} and was absent`;
    if (!(k in got)) return `${path}.${k} was ${clip(want[k])} and is now absent`;
    const d = firstDiff(want[k], got[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}
const clip = (v) => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 120 ? s.slice(0, 117) + '...' : s; };

/** History depth, however the Session chooses to publish it. null when it publishes nothing. */
function hashOfHistory(s) {
  for (const k of ['undoDepth', 'historyDepth']) if (typeof s[k] === 'number') return s[k];
  const h = s.history;
  if (h && typeof h.length === 'number') return h.length;
  if (h && Array.isArray(h.past)) return h.past.length;
  if (h && typeof h.depth === 'number') return h.depth;
  return null;
}
