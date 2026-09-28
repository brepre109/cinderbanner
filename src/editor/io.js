// Import and export (PLAN §6.8). Four destinations for one document, in descending order of how
// much the author gets for the click:
//
//   1. src/world/maps/<id>.js   via the dev-only POST /__map/write. The map is IN THE TREE, the
//      registry can list it, mapcheck gates it, git diffs it. This is what "export" should mean.
//   2. a .js/.json download     the production fallback, because tools/vite-maps-plugin.js is
//      `apply:'serve'` and a built page therefore has no write endpoint at all.
//   3. the clipboard            for pasting straight into an editor or a review comment.
//   4. a localStorage slot      storage.js's business, not this file's.
//
// The TEXT is never produced here. mapformat/serialize.js is the single canonical writer — one H row
// and one T row and one prop per line, fixed key order, byte-identical for the same document — and
// re-implementing any part of that for "export" is how two writers drift and a save stops matching
// what CI reads. So this file only decides WHERE bytes go and reports what happened.
import { stringifyDef, parseDef, toJson, hashDef } from '../world/mapformat/serialize.js';
import { normalizeDef } from '../world/mapformat/normalize.js';
import { ID_RE } from '../world/mapformat/schema.js';

const WRITE_URL = '/__map/write';
const LIST_URL = '/__map/list';

/** Canonical ES-module source. Deterministic: same document in, same bytes out, always. */
export function exportModule(def) { return stringifyDef(def); }
/** Canonical JSON, in the same KEY_ORDER the module form uses, so the two diffs read alike. */
export function exportJson(def) { return toJson(def); }

/**
 * Read a document out of module source, JSON text or an object, and REPAIR it. parseDef gives the
 * structure; normalizeDef clamps it into the schema and reports every change, because an imported
 * file is the one input that may predate the current schema or have been hand-edited into a shape
 * nothing produces.
 * @param {string|object} input
 * @returns {{def:object, coercions:Array, hash:string}}
 * @throws {SyntaxError} with a byte offset, which the import dialog shows verbatim
 */
export function importText(input) {
  const { def, coercions } = normalizeDef(parseDef(input));
  return { def, coercions, hash: hashDef(def) };
}

/** A legal map id from a document: `def.id` if it is already one, else a slug of the name. The id is
 *  the loader whitelist key AND the filename stem, so it is worth guessing well. */
export function suggestId(def) {
  const id = def && typeof def.id === 'string' ? def.id : '';
  if (ID_RE.test(id)) return id;
  const slug = String((def && def.name) || id || 'untitled').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'm$1').slice(0, 48);
  return ID_RE.test(slug) ? slug : 'untitled_map';
}

/** Is the dev write endpoint here? One GET, cached, so the File menu can grey the item out rather
 *  than offering a click that will fail. A built page answers 404 and this stays false forever. */
let _devWrite = null;
export async function canWriteMaps() {
  if (_devWrite !== null) return _devWrite;
  try {
    const r = await fetch(LIST_URL, { method: 'GET' });
    const j = r.ok && /json/.test(r.headers.get('content-type') || '') ? await r.json() : null;
    _devWrite = !!(j && j.ok);
  } catch { _devWrite = false; }
  return _devWrite;
}
/** Map ids already on disk — the Save dialog warns before overwriting one. */
export async function listMapFiles() {
  try {
    const r = await fetch(LIST_URL);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.ids) ? j.ids : [];
  } catch { return []; }
}

/**
 * POST the module source into src/world/maps/. The plugin re-checks the id AND the resolved path, so
 * this does not have to be the security boundary — but it validates the id anyway, because a client
 * that sends a bad one deserves the error at the call site rather than as a 400 three frames later.
 * @returns {Promise<{ok:boolean, id:string, path?:string, bytes?:number, existed?:boolean, error?:string}>}
 */
export async function writeMapModule(id, source) {
  if (!ID_RE.test(id)) return { ok: false, id, error: `id '${id}' does not match ${ID_RE}` };
  let r;
  try { r = await fetch(WRITE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, source }) }); }
  catch (e) { return { ok: false, id, error: `no dev server write endpoint (${(e && e.message) || e})` }; }
  // A production build answers this URL with the SPA's index.html or a 404 page, not JSON. Parsing
  // that as a result would report success for a write that never happened.
  if (!/json/.test(r.headers.get('content-type') || '')) return { ok: false, id, error: `${WRITE_URL} answered ${r.status} ${r.statusText} without JSON — this is not a dev server` };
  const j = await r.json().catch(() => ({}));
  return r.ok && j.ok ? { ok: true, id, path: j.path, bytes: j.bytes, existed: j.existed } : { ok: false, id, error: j.error || `${r.status} ${r.statusText}` };
}

/** Clipboard, with the pre-permissions fallback: a hidden textarea plus execCommand still works on
 *  every browser this ships to, and an insecure origin (plain http on a LAN dev box) has no
 *  navigator.clipboard at all. */
export async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through: a denied permission is not a reason to lose the text */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch { return false; }
}

/** Blob download. The object URL is revoked on the next tick, not immediately: Firefox cancels an
 *  in-flight download whose URL was revoked in the same task. */
export function downloadText(filename, text, mime = 'text/javascript') {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}

/**
 * The one call the Export menu item makes. Tries the tree, falls back to a download, and SAYS WHICH,
 * because "exported" meaning two different things with no way to tell them apart is how an author
 * loses an afternoon looking for a file that went to ~/Downloads.
 * @param {object} def
 * @param {{id?:string, prefer?:'dev'|'download'|'clipboard'}} [o]
 * @returns {Promise<{ok:boolean, via:string, id:string, path?:string, bytes:number, error?:string}>}
 */
export async function saveMap(def, o = {}) {
  const id = o.id || suggestId(def);
  const source = exportModule({ ...def, id });
  const bytes = source.length;
  if (o.prefer === 'clipboard') return { ok: await copyText(source), via: 'clipboard', id, bytes };
  if (o.prefer !== 'download' && await canWriteMaps()) {
    const r = await writeMapModule(id, source);
    if (r.ok) return { ok: true, via: 'dev', id, path: r.path, bytes: r.bytes, existed: r.existed };
    if (o.prefer === 'dev') return { ok: false, via: 'dev', id, bytes, error: r.error };
  }
  downloadText(`${id}.js`, source);
  return { ok: true, via: 'download', id, bytes, path: `${id}.js` };
}

/** Open a file picker and read one text file. Resolves to null when the author cancels — which is
 *  detected by the window regaining focus with no `change`, because `cancel` is not universal. */
export function pickFile(accept = '.js,.json,.txt') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.style.cssText = 'position:fixed;top:-1000px';
    let done = false;
    const finish = (v) => { if (done) return; done = true; input.remove(); resolve(v); };
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return finish(null);
      const fr = new FileReader();
      fr.onload = () => finish({ name: f.name, text: String(fr.result || '') });
      fr.onerror = () => finish(null);
      fr.readAsText(f);
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
    window.addEventListener('focus', () => setTimeout(() => finish(null), 800), { once: true });
  });
}
