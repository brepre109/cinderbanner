// Dev-only write channel for the map builder: POST /__map/write drops an authored MapDef module
// into src/world/maps/ so "export as module" is one click instead of a copy-paste into an editor.
//
//   POST /__map/write   {"id":"aqueduct_span","source":"export const DEF = {...}\n"}
//        -> 200 {"ok":true,"id":...,"path":"src/world/maps/aqueduct_span.js","bytes":N,"existed":bool}
//   GET  /__map/list    -> 200 {"ok":true,"ids":[...],"dir":"src/world/maps"}
//
// `apply: 'serve'` is load-bearing: the plugin is not installed in a `vite build`, so a deployed
// static page has no write endpoint at all and io.js must degrade to download/clipboard there.
//
// Two independent guards, because one is a typo away from an arbitrary-file-write:
//   1. the id must match ID_RE -- no dot, no slash, no '..', so it cannot escape by construction;
//   2. the RESOLVED absolute path is re-checked against the maps directory, so even if guard 1 is
//      ever loosened the write still cannot land outside src/world/maps/.
// The id is never interpolated into an import() specifier anywhere; it only ever names a file.
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const ID_RE = /^[a-z][a-z0-9_]*$/;          // == the schema's map-id rule, minus its length cap
const ID_MAX = 48;                          // schema ID_RE is ^[a-z][a-z0-9_]{1,47}$
const BODY_MAX = 1 << 20;                   // 1 MB. A 48x48 def stringifies to ~60 KB; 1 MB is junk.
const REL_DIR = 'src/world/maps';

const send = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
};

// Reads at most BODY_MAX+1 bytes and destroys the socket past that, so a runaway client cannot
// buffer the dev server to death.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > BODY_MAX) { req.destroy(); reject(new Error(`body over ${BODY_MAX} bytes`)); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

export default function mapsPlugin(opts = {}) {
  const relDir = opts.dir || REL_DIR;
  return {
    name: 'cinderbanner-maps-write',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root || process.cwd();
      const mapsDir = path.resolve(root, relDir);

      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (url !== '/__map/write' && url !== '/__map/list') return next();

        if (url === '/__map/list') {
          if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'GET only' });
          const ids = existsSync(mapsDir)
            ? readdirSync(mapsDir).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort()
            : [];
          return send(res, 200, { ok: true, ids, dir: relDir });
        }

        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' });

        let body;
        try { body = JSON.parse(await readBody(req) || '{}'); }
        catch (e) { return send(res, 400, { ok: false, error: 'bad request body: ' + e.message }); }

        const id = body.id;
        if (typeof id !== 'string' || !ID_RE.test(id) || id.length > ID_MAX)
          return send(res, 400, { ok: false, error: `id must match ${ID_RE} and be <= ${ID_MAX} chars`, id });

        const source = body.source;
        if (typeof source !== 'string' || !source.length)
          return send(res, 400, { ok: false, error: 'source must be a non-empty string' });
        if (Buffer.byteLength(source) > BODY_MAX)
          return send(res, 413, { ok: false, error: `source over ${BODY_MAX} bytes` });
        // Cheap shape guard: what lands in src/ must at least be an ES module, so a mis-wired
        // caller cannot park a JSON blob or an HTML error page under a .js the loader will import.
        if (!/(^|\n)\s*export\s/.test(source))
          return send(res, 400, { ok: false, error: 'source has no top-level export; refusing to write' });

        const file = path.resolve(mapsDir, `${id}.js`);
        if (file !== path.join(mapsDir, `${id}.js`) || !file.startsWith(mapsDir + path.sep))
          return send(res, 400, { ok: false, error: 'resolved path escapes ' + relDir });

        try {
          mkdirSync(mapsDir, { recursive: true });
          const existed = existsSync(file);
          // tmp + rename: a half-written map module is an import-time throw for every later
          // reader (mapcheck, sim.mjs, the loader), so the file is only ever swapped whole.
          const tmp = `${file}.tmp-${process.pid}`;
          try { writeFileSync(tmp, source, 'utf8'); renameSync(tmp, file); }
          catch (e) { try { unlinkSync(tmp); } catch { /* tmp may not exist */ } throw e; }
          server.config.logger.info(`  [maps] wrote ${relDir}/${id}.js (${Buffer.byteLength(source)} B)`);
          return send(res, 200, { ok: true, id, path: `${relDir}/${id}.js`, bytes: Buffer.byteLength(source), existed });
        } catch (e) {
          return send(res, 500, { ok: false, error: String(e && e.message || e) });
        }
      });
    },
  };
}
