// Item icons: 16x16 pixel art drawn procedurally per item type (sword, bow, hat, ring ...) and tinted per item
// material (iron, steel, ember, frost ...), then bevelled and ink-outlined the way the genre's item glyphs are. Emitted as
// crisp-edged SVG data URLs (same path as the glove cursor in kit.js), cached per item, so any window can show them
// at 2x / 3x with no blur and no image files. No DOM needed beyond the string.
import { ITEMS } from '../game/equipment.js';

const N = 16;
// Material ramps: l light, a mid, c dark. Handles/wood (h, k) and trim (g gold, w white) are shared.
const MAT = {
  iron: ['#d7dde2', '#8e99a3', '#4e5761'], steel: ['#eef3f8', '#a9b6c4', '#5b6878'], silver: ['#ffffff', '#c9d6e6', '#7487a3'],
  gold: ['#fff4b8', '#e8b93a', '#97650e'], ember: ['#ffd6a0', '#e8662a', '#8a2410'], frost: ['#f0ffff', '#8fd6f2', '#2f7aa6'],
  storm: ['#fff9c8', '#c9b8ff', '#5b48b0'], venom: ['#e6ffb8', '#7cc43a', '#2f6a14'], holy: ['#ffffff', '#fbe9a8', '#b8923a'],
  dark: ['#d9b8ff', '#7a4ab0', '#301a52'], wood: ['#e8c48e', '#a8733c', '#5c3814'], cloth: ['#f4ecd8', '#cdbd98', '#8a7a58'],
  leather: ['#e2b07c', '#9c6232', '#56300e'], red: ['#ffc0b0', '#d0402c', '#6e1408'], blue: ['#cfe0ff', '#4f73c8', '#1c2d66'],
  green: ['#d6f2b0', '#5f9a38', '#24480e'],
};
const FIX = { h: '#8a5a2a', k: '#4a2c10', g: '#f2c64a', G: '#9a6a10', w: '#ffffff', r: '#e04a3a', '#': '#1c140c' };

function grid() { return Array.from({ length: N }, () => Array(N).fill('.')); }
function draw(fn) {
  const g = grid(); const set = (x, y, k) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = k; };
  const line = (x0, y0, x1, y1, k, w = 1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1; for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; set(x, y, k); if (w > 1) set(x + 1, y, k); if (w > 2) set(x, y + 1, k); } };
  const rect = (x, y, w, h, k) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, k); };
  const disc = (cx, cy, r, k, hollow = 0) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = x * x + y * y; if (d <= r * r + r * 0.6 && (!hollow || d >= (r - hollow) * (r - hollow))) set(cx + x, cy + y, k); } };
  const rows = (y0, spans, k) => spans.forEach(([a, b], j) => { for (let x = a; x <= b; x++) set(x, y0 + j, k); });   // filled scanlines
  fn({ set, line, rect, disc, rows, g });
  return g;
}
// Bevel the mid-tone 'a' pixels (light on the upper-left edge, dark on the lower-right), then ink-outline everything.
function finish(g) {
  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? '.' : g[y][x]);
  const out = g.map((r) => r.slice());
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (g[y][x] !== 'a') continue;
    if (at(x + 1, y) === '.' || at(x, y + 1) === '.') out[y][x] = 'c'; else if (at(x - 1, y) === '.' || at(x, y - 1) === '.') out[y][x] = 'l';
  }
  const ink = out.map((r) => r.slice());
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (out[y][x] === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const v = y + dy >= 0 && y + dy < N && x + dx >= 0 && x + dx < N ? out[y + dy][x + dx] : '.'; return v !== '.' && v !== '#'; })) ink[y][x] = '#';
  return ink;
}

// ---- shapes (blade tip points up-right, like the genre's item glyphs) ----
const SHAPES = {
  sword: (d) => { d.line(6, 9, 13, 2, 'a'); d.line(7, 9, 14, 2, 'l'); d.line(6, 10, 13, 3, 'c'); d.set(14, 1, 'w'); d.line(3, 8, 7, 12, 'g'); d.line(4, 11, 2, 13, 'h'); d.set(1, 14, 'g'); },
  ksword: (d) => { for (let o = -1; o <= 1; o++) d.line(6 + o, 9, 13 + o, 2, o ? 'a' : 'l'); d.line(6, 11, 13, 4, 'c'); d.set(14, 1, 'w'); d.line(2, 8, 7, 13, 'g'); d.line(3, 9, 7, 13, 'G'); d.line(4, 12, 2, 14, 'h'); d.set(1, 15, 'g'); },
  dagger: (d) => { d.line(7, 9, 11, 5, 'a'); d.line(8, 9, 12, 5, 'l'); d.line(7, 10, 11, 6, 'c'); d.set(12, 4, 'w'); d.line(5, 8, 8, 11, 'g'); d.line(6, 11, 4, 13, 'h'); d.set(3, 14, 'G'); },
  katana: (d) => { d.line(6, 9, 10, 5, 'a'); d.line(10, 5, 14, 2, 'a'); d.line(7, 9, 11, 5, 'l'); d.line(11, 5, 14, 3, 'l'); d.set(15, 1, 'w'); d.rect(4, 9, 3, 3, 'g'); d.set(5, 10, 'G'); d.line(4, 11, 1, 14, 'k'); d.set(3, 12, 'w'); d.set(1, 14, 'w'); },
  rapier: (d) => { d.line(7, 8, 14, 1, 'l'); d.line(7, 9, 13, 3, 'a'); d.disc(5, 10, 2, 'g'); d.set(5, 10, 'G'); d.line(4, 11, 2, 13, 'h'); d.set(1, 14, 'g'); },
  axe: (d) => { d.line(3, 13, 11, 5, 'h'); d.line(3, 14, 11, 6, 'k'); d.rows(2, [[10, 11], [9, 13], [9, 14], [10, 14], [11, 14], [12, 13]], 'a'); d.line(13, 3, 14, 5, 'l'); },
  hammer: (d) => { d.line(2, 14, 9, 7, 'h'); d.line(3, 14, 10, 7, 'k'); d.rows(2, [[10, 11], [9, 12], [8, 13], [8, 14], [9, 14], [10, 13], [11, 12]], 'a'); d.set(11, 3, 'l'); },
  spear: (d) => { d.line(1, 14, 10, 5, 'h'); d.line(2, 14, 11, 5, 'k'); d.line(8, 7, 10, 9, 'g'); d.rows(1, [[13, 14], [12, 14], [11, 13], [11, 12]], 'a'); d.set(14, 1, 'w'); },
  bow: (d) => { let px = 3, py = 2; for (let t = 1; t <= 24; t++) { const a = -Math.PI / 2 + (Math.PI / 2) * t / 24; const x = 3 + 10 * Math.cos(a), y = 12 + 10 * Math.sin(a); d.line(px, py, x, y, 'a', 2); px = x; py = y; }
    d.line(3, 3, 12, 12, 'w'); d.line(9, 4, 11, 6, 'h'); d.set(3, 2, 'g'); d.set(13, 12, 'g'); },
  rod: (d) => { d.line(3, 13, 9, 7, 'h'); d.line(4, 13, 10, 7, 'k'); d.disc(11, 5, 2, 'a'); d.set(10, 4, 'w'); d.line(8, 8, 10, 8, 'g'); },
  staff: (d) => { d.line(1, 15, 10, 6, 'h'); d.line(2, 15, 11, 6, 'k'); d.disc(12, 4, 3, 'a', 1); d.set(12, 4, 'w'); d.set(12, 3, 'l'); },
  gun: (d) => { d.rect(3, 5, 12, 2, 'a'); d.line(3, 5, 14, 5, 'l'); d.rect(14, 4, 1, 1, 'a'); d.rows(7, [[2, 6], [1, 5], [1, 4], [1, 4], [2, 4]], 'h'); d.rect(6, 7, 2, 2, 'g'); d.set(7, 9, 'k'); },
  shield: (d) => { const w = [4, 5, 6, 6, 6, 6, 6, 5, 5, 4, 3, 2, 1]; w.forEach((hw, j) => d.line(8 - hw, 2 + j, 7 + hw, 2 + j, 'a')); d.line(7, 3, 7, 13, 'g'); d.line(8, 3, 8, 13, 'G'); d.line(3, 6, 12, 6, 'g'); },
  hat: (d) => { d.rows(4, [[6, 9], [5, 10], [5, 10], [4, 11], [4, 11]], 'a'); d.line(4, 8, 11, 8, 'g'); d.rows(9, [[2, 13], [1, 14], [2, 13]], 'a'); d.set(10, 3, 'r'); d.set(11, 2, 'r'); },
  helm: (d) => { d.rows(2, [[6, 9], [4, 11], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [4, 11], [4, 11], [5, 10]], 'a'); d.line(4, 7, 11, 7, 'k'); d.line(7, 8, 8, 12, 'k'); d.line(7, 2, 8, 2, 'g'); },
  clothes: (d) => { d.rows(2, [[4, 6], [3, 12], [1, 14], [1, 14], [2, 13], [4, 11], [4, 11], [4, 11], [4, 11], [4, 11], [4, 11], [4, 11]], 'a'); d.rows(2, [[9, 11]], 'a'); d.line(7, 3, 8, 3, '.'); d.line(4, 8, 11, 8, 'h'); d.set(7, 8, 'g'); },
  robe: (d) => { d.rows(1, [[6, 9], [5, 10], [4, 11], [2, 13], [1, 14], [3, 12], [3, 12], [3, 12], [2, 12], [2, 13], [2, 13], [1, 14], [1, 14], [1, 14]], 'a'); d.line(7, 3, 8, 3, 'k'); d.line(7, 5, 7, 14, 'g'); },
  light: (d) => { d.rows(2, [[3, 5], [3, 12], [2, 13], [2, 13], [3, 12], [4, 11], [4, 11], [4, 11], [4, 11], [4, 11], [5, 10]], 'a'); d.rows(2, [[10, 12]], 'a'); d.line(7, 3, 8, 3, '.'); for (const [x, y] of [[5, 6], [10, 6], [5, 9], [10, 9], [7, 11], [8, 11]]) d.set(x, y, 'g'); },
  heavy: (d) => { d.rows(2, [[1, 4], [1, 5], [1, 14], [2, 13], [3, 12], [3, 12], [4, 11], [4, 11], [4, 11], [5, 10], [5, 10], [6, 9]], 'a'); d.rows(2, [[11, 14], [10, 14]], 'a'); d.line(7, 5, 7, 12, 'l'); d.line(8, 5, 8, 12, 'c'); d.line(4, 9, 11, 9, 'g'); },
  ring: (d) => { d.disc(8, 9, 4, 'a', 1.6); d.disc(8, 4, 2, 'g'); d.set(8, 4, 'w'); d.set(7, 3, 'w'); },
  bracer: (d) => { d.rows(4, [[4, 11], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [3, 12], [4, 11]], 'a'); d.line(3, 6, 12, 6, 'g'); d.line(3, 9, 12, 9, 'g'); d.set(7, 7, 'w'); d.set(8, 8, 'w'); },
  amulet: (d) => { d.line(3, 1, 7, 8, 'g'); d.line(12, 1, 8, 8, 'g'); d.rows(8, [[7, 8], [6, 9], [5, 10], [5, 10], [6, 9], [7, 8]], 'a'); d.set(7, 10, 'w'); },
  boots: (d) => { d.rows(2, [[5, 9], [5, 9], [5, 9], [5, 9], [5, 9], [5, 9], [5, 10], [4, 12], [4, 13], [4, 14], [4, 14]], 'a'); d.line(5, 2, 9, 2, 'g'); d.line(4, 12, 14, 12, 'k'); },
  ribbon: (d) => { d.rows(4, [[1, 3], [1, 5], [1, 6], [2, 7], [1, 6], [1, 5], [1, 3]], 'a'); d.rows(4, [[12, 14], [10, 14], [9, 14], [8, 13], [9, 14], [10, 14], [12, 14]], 'a'); d.rect(7, 6, 2, 3, 'g'); d.line(6, 9, 4, 14, 'a'); d.line(9, 9, 11, 14, 'a'); },
  gem: (d) => { d.rows(3, [[6, 9], [4, 11], [3, 12], [3, 12], [4, 11], [5, 10], [6, 9], [7, 8]], 'a'); d.line(4, 5, 11, 5, 'l'); d.set(6, 4, 'w'); d.set(7, 7, 'w'); },
};
export const iconKind = (it) => it.icon || it.type;

const cache = new Map();
/** CSS `url(...)` for an item id (or a bare shape name with `mat`). */
export function iconUrl(id, mat) {
  const it = ITEMS[id]; const kind = it ? iconKind(it) : id; const m = MAT[mat || it?.mat] || MAT.steel;
  const key = kind + ':' + (mat || it?.mat); if (cache.has(key)) return cache.get(key);
  const g = finish(draw(SHAPES[kind] || SHAPES.gem));
  const col = { l: m[0], a: m[1], c: m[2], ...FIX };
  let rects = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = col[g[y][x]]; if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`; }
  const url = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${N} ${N}' width='${N}' height='${N}' shape-rendering='crispEdges'>${rects}</svg>`)}")`;
  cache.set(key, url); return url;
}
/** `<i class="k-ico">` markup with the icon as its background (size via CSS: .k-ico = 32px, .k-ico.sm = 24px). */
export const iconHtml = (id, cls = '') => (id ? `<i class="k-ico ${cls}${ITEMS[id]?.rare ? ' rare' : ''}" style="background-image:${iconUrl(id).replace(/"/g, '&quot;')}"></i>` : `<i class="k-ico empty ${cls}"></i>`);
/** Empty-slot glyph per slot (a faint silhouette of what goes there). */
const SLOT_KIND = { weapon: 'sword', offhand: 'shield', head: 'helm', body: 'clothes', acc: 'ring' };
export const slotGhost = (slot) => `<i class="k-ico ghost" style="background-image:${iconUrl(SLOT_KIND[slot], 'cloth').replace(/"/g, '&quot;')}"></i>`;
