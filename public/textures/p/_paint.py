#!/usr/bin/env python3
"""Procedural hand-painted-style terrain set for Cinderbanner (terrain owner).
64 texels per tile (matches the 32-48 px sprite density), palette-ramped, tileable.
Run: python3 public/textures/p/_paint.py   → writes PNGs + contact sheet next to this file.
"""
import os, json, math
import numpy as np
from PIL import Image, ImageDraw

OUT = os.path.dirname(os.path.abspath(__file__))
T = 64  # texels per tile

def hexc(h):
    h = h.lstrip('#'); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], dtype=np.float32)

def lattice_noise(w, h, px, py, rng):
    """Tileable value noise: random lattice with period (px,py) cells, cubic-smoothed bilinear."""
    gx, gy = max(1, w // px), max(1, h // py)
    lat = rng.random((gy, gx)).astype(np.float32)
    ys, xs = np.mgrid[0:h, 0:w]
    fx, fy = xs / px, ys / py
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - x0, fy - y0
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty)
    x1, y1 = (x0 + 1) % gx, (y0 + 1) % gy
    x0 %= gx; y0 %= gy
    a = lat[y0, x0]; b = lat[y0, x1]; c = lat[y1, x0]; d = lat[y1, x1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty

def fbm(w, h, octaves, rng):
    """octaves: list of (period_x, period_y, weight)."""
    f = np.zeros((h, w), np.float32); tot = 0
    for px, py, wt in octaves:
        f += lattice_noise(w, h, px, py, rng) * wt; tot += wt
    return f / tot

def normalize(f):
    lo, hi = np.percentile(f, 1), np.percentile(f, 99)
    return np.clip((f - lo) / max(1e-6, hi - lo), 0, 1)

def ramp(field, colors, jitter=None, rng=None):
    """Posterise a 0..1 field onto a colour ramp (list of hex)."""
    cols = np.stack([hexc(c) for c in colors])
    n = len(colors)
    f = field.copy()
    if jitter and rng is not None:
        f = f + (rng.random(f.shape).astype(np.float32) - 0.5) * jitter
    idx = np.clip((f * n).astype(int), 0, n - 1)
    return cols[idx]

class Canvas:
    def __init__(self, w, h, rgb=None, alpha=255):
        self.w, self.h = w, h
        self.rgb = np.zeros((h, w, 3), np.float32) if rgb is None else rgb.astype(np.float32)
        self.a = np.full((h, w), alpha, np.float32)
    def put(self, x, y, col, a=1.0):
        x %= self.w; y %= self.h
        self.rgb[y, x] = self.rgb[y, x] * (1 - a) + np.asarray(col, np.float32) * a
    def put_alpha(self, x, y, col, a=1.0):
        x %= self.w; y %= self.h
        self.rgb[y, x] = np.asarray(col, np.float32); self.a[y, x] = max(self.a[y, x], 255 * a)
    def blob(self, cx, cy, rx, ry, col, a=1.0, alpha_write=False):
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    (self.put_alpha if alpha_write else self.put)(x, y, col, a)
    def line(self, pts, col, a=1.0, alpha_write=False):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
            for i in range(n + 1):
                t = i / max(1, n)
                (self.put_alpha if alpha_write else self.put)(int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t)), col, a)
    def image(self, with_alpha=True):
        rgb = np.clip(self.rgb, 0, 255).astype(np.uint8)
        if with_alpha:
            return Image.fromarray(np.dstack([rgb, np.clip(self.a, 0, 255).astype(np.uint8)]), 'RGBA')
        return Image.fromarray(rgb, 'RGB')

def pebble(c, x, y, r, light, dark, mid, rng, alpha_write=False):
    rx = r * (0.8 + rng.random() * 0.6); ry = r * (0.6 + rng.random() * 0.5)
    c.blob(x, y, rx, ry, mid, 1, alpha_write)
    c.blob(x - rx * 0.25, y - ry * 0.3, rx * 0.55, ry * 0.45, light, 1, alpha_write)
    # shadow on the lower-right rim + contact shadow under
    c.line([(x - rx * 0.4, y + ry), (x + rx * 0.5, y + ry)], dark, 1, alpha_write)
    c.line([(x + rx, y - ry * 0.2), (x + rx, y + ry * 0.6)], dark, 1, alpha_write)

def tuft(c, x, y, cols, rng, h=None, alpha_write=False):
    """Small grass tuft: 2-3 blades rising from (x,y)."""
    dark, mid, light = cols
    n = 2 + int(rng.random() * 2)
    for i in range(n):
        hh = (h or (2 + rng.random() * 3)) * (0.6 + rng.random() * 0.6)
        dx = (i - (n - 1) / 2) * 1.2 + (rng.random() - 0.5)
        pts = [(x + dx * 0.3, y), (x + dx, y - hh)]
        c.line(pts, mid if rng.random() < 0.7 else dark, 1, alpha_write)
        c.put_alpha(int(round(x + dx)), int(round(y - hh)), light) if alpha_write else c.put(int(round(x + dx)), int(round(y - hh)), light)
    c.line([(x - 1, y + 1), (x + 1, y + 1)], dark, 0.6, alpha_write)

# ---------------------------------------------------------------- tops

def paint_grass(name, seed, ramp_cols, tuft_cols, pebble_n, flower=True, size=2 * T):
    rng = np.random.default_rng(seed)
    w = h = size
    big = fbm(w, h, [(64, 64, 0.35), (32, 32, 0.7), (16, 16, 0.6), (8, 8, 0.3)], rng)
    fine = fbm(w, h, [(4, 4, 1.0), (2, 2, 0.5)], rng)
    f = normalize(big * 0.74 + fine * 0.26)
    c = Canvas(w, h, ramp(f, ramp_cols, jitter=0.12, rng=rng))
    # brushy strokes: short horizontal dashes of neighbouring ramp tones (painted-mottle feel)
    cols = [hexc(k) for k in ramp_cols]
    for _ in range(w * h // 40):
        x, y = rng.integers(0, w), rng.integers(0, h)
        i = int(np.clip(f[y, x] * len(cols) + rng.integers(-1, 2), 0, len(cols) - 1))
        L = rng.integers(2, 6)
        c.line([(x, y), (x + L, y + rng.integers(-1, 2))], cols[i], 0.85)
    # tufts (clusters)
    for _ in range(w * h // 150):
        cx, cy = rng.random() * w, rng.random() * h
        for _ in range(1 + rng.integers(0, 3)):
            tuft(c, cx + (rng.random() - 0.5) * 6, cy + (rng.random() - 0.5) * 4, [hexc(k) for k in tuft_cols], rng)
    # pale pebbles + the occasional flower
    for _ in range(pebble_n):
        pebble(c, rng.random() * w, rng.random() * h, 1.2 + rng.random() * 1.4, hexc('#d9d6c4'), hexc('#3a4a20'), hexc('#aeab98'), rng)
    if flower:
        for _ in range(size // 16):
            x, y = rng.integers(0, w), rng.integers(0, h)
            c.put(x, y, hexc('#f3efc8')); c.put(x + 1, y, hexc('#e9d36a'))
    c.image(False).save(f'{OUT}/{name}.png')

def paint_dirt(name, seed, ramp_cols, size=2 * T, pebbles=90, tufts=10, cracks=6, streak=0.30, angle=(0.62, 0.30)):
    """Trodden earth. the genre's big dirt flats stay alive from three things and we do all of them:
    broad low-frequency value bands, long directional drag strokes (cart ruts / brush direction), and litter."""
    rng = np.random.default_rng(seed)
    w = h = size
    big = fbm(w, h, [(64, 64, 0.85), (32, 32, 0.7), (16, 16, 0.45), (8, 8, 0.25)], rng)
    fine = fbm(w, h, [(4, 4, 1.0), (2, 2, 0.6)], rng)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    nw = fbm(w, h, [(32, 32, 1.0), (16, 16, 0.5)], rng) - 0.5
    drag = 0.5 + 0.5 * np.sin(2 * math.pi * (angle[0] * 6 * xs + angle[1] * 6 * ys) / w + nw * 7.0)
    f = normalize(big * (0.72 - streak * 0.5) + fine * 0.26 + drag * streak)
    c = Canvas(w, h, ramp(f, ramp_cols, jitter=0.1, rng=rng))
    cols = [hexc(k) for k in ramp_cols]
    # long drag strokes along the brush direction
    for _ in range(w * h // 90):
        x, y = rng.integers(0, w), rng.integers(0, h)
        i = int(np.clip(f[y, x] * len(cols) + rng.integers(-1, 2), 0, len(cols) - 1))
        L = rng.integers(6, 22)
        c.line([(x, y), (x + L * angle[0] * 2, y + L * angle[1] * 2 + rng.integers(-1, 2))], cols[i], 0.55)
    # short mottle
    for _ in range(w * h // 60):
        x, y = rng.integers(0, w), rng.integers(0, h)
        i = int(np.clip(f[y, x] * len(cols) + rng.integers(-1, 2), 0, len(cols) - 1))
        c.line([(x, y), (x + rng.integers(2, 7), y + rng.integers(-1, 2))], cols[i], 0.8)
    dark = hexc(ramp_cols[0]); light = hexc(ramp_cols[-1])
    for _ in range(pebbles):
        r = 1 + rng.random() * 2.2
        pebble(c, rng.random() * w, rng.random() * h, r, light * 0.5 + hexc('#e0d2b0') * 0.5, dark * 0.8, hexc(ramp_cols[len(ramp_cols) // 2]) * 0.6 + hexc('#b9aa8e') * 0.4, rng)
    for _ in range(cracks):  # wandering dark crack
        x, y = rng.random() * w, rng.random() * h
        pts = [(x, y)]
        for _ in range(rng.integers(6, 14)):
            x += rng.random() * 6 - 3; y += rng.random() * 6 - 3; pts.append((x, y))
        c.line(pts, dark * 0.8, 0.9)
    for _ in range(tufts):
        tuft(c, rng.random() * w, rng.random() * h, [hexc('#5b5a24'), hexc('#8b8a34'), hexc('#c2bd62')], rng)
    c.image(False).save(f'{OUT}/{name}.png')

def paint_sand(name, seed, ramp_cols, size=2 * T):
    rng = np.random.default_rng(seed)
    w = h = size
    n = fbm(w, h, [(32, 32, 1.0), (16, 16, 0.5)], rng)
    ys, xs = np.mgrid[0:h, 0:w]
    ripple = 0.5 + 0.5 * np.sin((xs * 0.55 + ys * 0.35) * 2 * math.pi / 22 + n * 5)
    f = normalize(ripple * 0.55 + n * 0.45)
    c = Canvas(w, h, ramp(f, ramp_cols, jitter=0.08, rng=rng))
    for _ in range(40):
        pebble(c, rng.random() * w, rng.random() * h, 1 + rng.random() * 1.5, hexc('#f6ecc8'), hexc('#8a7346'), hexc('#d6c193'), rng)
    c.image(False).save(f'{OUT}/{name}.png')

def paint_flag(name, seed, ramp_cols, size=2 * T):
    """Flagstone paving, 2x2 tiles: 7 courses of irregular slabs, 1-px mortar, chips and cracks. Slab values stay
    within one ramp step of each other so the repeat never reads as a checker."""
    rng = np.random.default_rng(seed)
    w = h = size
    mortar = hexc('#3a372f'); c = Canvas(w, h, np.tile(mortar, (h, w, 1)))
    cols = [hexc(k) for k in ramp_cols]
    rows = 7; y = 0
    ys_edges = [0]
    for r in range(rows):
        y += size // rows + (rng.integers(-2, 3) if r < rows - 1 else 0); ys_edges.append(min(y, size))
    ys_edges[-1] = size
    for r in range(rows):
        y0, y1 = ys_edges[r], ys_edges[r + 1]
        x = rng.integers(0, 10); edges = [0]
        while x < size - 8:
            edges.append(x); x += rng.integers(12, 26)
        edges.append(size)
        for i in range(len(edges) - 1):
            x0, x1 = edges[i], edges[i + 1]
            if x1 - x0 < 5: continue
            base = int(np.clip(3 + (1 if rng.random() < 0.3 else 0) - (1 if rng.random() < 0.3 else 0), 0, len(cols) - 1))
            n = fbm(x1 - x0, y1 - y0, [(8, 8, 1.0), (3, 3, 0.5)], rng)
            for yy in range(y0 + 1, y1):
                for xx in range(x0 + 1, x1):
                    k = int(np.clip(base + (n[yy - y0, xx - x0] - 0.5) * 1.8, 0, len(cols) - 1))
                    c.put(xx, yy, cols[k])
            # bevel: light top/left, dark bottom/right
            for xx in range(x0 + 1, x1): c.put(xx, y0 + 1, cols[min(len(cols) - 1, base + 2)], 0.6); c.put(xx, y1 - 1, cols[max(0, base - 2)], 0.7)
            for yy in range(y0 + 1, y1): c.put(x0 + 1, yy, cols[min(len(cols) - 1, base + 1)], 0.5); c.put(x1 - 1, yy, cols[max(0, base - 2)], 0.7)
            if rng.random() < 0.45:  # crack
                px, py = rng.integers(x0 + 2, x1 - 1), y0 + 2; pts = [(px, py)]
                for _ in range(rng.integers(3, 7)): px += rng.integers(-2, 3); py += rng.integers(1, 4); pts.append((int(np.clip(px, x0 + 1, x1 - 2)), int(min(py, y1 - 2))))
                c.line(pts, cols[max(0, base - 3)], 0.9)
            if rng.random() < 0.5:  # chip in a corner
                cx, cy = (x1 - 2, y1 - 2) if rng.random() < 0.5 else (x0 + 2, y1 - 2)
                c.blob(cx, cy, 1.5, 1, cols[max(0, base - 3)], 0.9)
    # sprinkle of sandy grit in the mortar lines + moss dots
    for _ in range(40):
        x, y = rng.integers(0, w), rng.integers(0, h)
        if np.allclose(c.rgb[y, x], mortar): c.put(x, y, hexc('#6b6553'), 0.8)
    for _ in range(12):
        x, y = rng.integers(0, w), rng.integers(0, h); c.put(x, y, hexc('#5c6e2f'), 0.8)
    c.image(False).save(f'{OUT}/{name}.png')

def paint_rock_top(name, seed, size=2 * T):
    rng = np.random.default_rng(seed)
    w = h = size
    c = Canvas(w, h)
    facets(c, rng, cell_w=24, cell_h=20, cols=['#5a5342', '#7a7158', '#968c6e', '#b0a583', '#c8bd95', '#dbd1aa'], crevice='#2b281f', moss='#5d7a30', moss_p=0.2, lit=(-0.35, -0.55))
    c.image(False).save(f'{OUT}/{name}.png')

def paint_bed(name, seed, size=2 * T):
    rng = np.random.default_rng(seed)
    w = h = size
    f = normalize(fbm(w, h, [(32, 32, 1.0), (16, 16, 0.6), (4, 4, 0.4)], rng))
    c = Canvas(w, h, ramp(f, ['#3f4d3f', '#4c5a48', '#5a6852', '#68765c', '#778468'], jitter=0.1, rng=rng))
    for _ in range(140):
        r = 1 + rng.random() * 2.5
        pebble(c, rng.random() * w, rng.random() * h, r, hexc('#a9ad94'), hexc('#2e3a2c'), hexc('#7f8770'), rng)
    c.image(False).save(f'{OUT}/{name}.png')

# ---------------------------------------------------------------- sides

def facets(c, rng, cell_w, cell_h, cols, crevice, moss, moss_p, lit, strata_jitter=0.0):
    """Voronoi-style rock facets with dark crevices between cells, lighter toward (lit) direction inside each cell."""
    w, h = c.w, c.h
    cols = [hexc(k) for k in cols]
    gx, gy = max(1, w // cell_w), max(1, h // cell_h)
    pts = []
    for j in range(gy):
        for i in range(gx):
            pts.append(((i + 0.05 + rng.random() * 0.9) * cell_w, (j + 0.05 + rng.random() * 0.9) * cell_h, int(np.clip(len(cols) // 2 + rng.integers(-1, 2) + (1 if rng.random() < 0.25 else 0), 0, len(cols) - 1)), rng.random()))
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    warp = fbm(w, h, [(16, 16, 1.0), (8, 8, 0.6), (4, 4, 0.3)], rng) - 0.5
    warp2 = fbm(w, h, [(16, 16, 1.0), (8, 8, 0.6), (4, 4, 0.3)], rng) - 0.5
    wx = xs + warp * 12; wy = ys + warp2 * 9 * (1 - strata_jitter) + warp * 4 * strata_jitter
    d1 = np.full((h, w), 1e9, np.float32); d2 = d1.copy(); idx = np.zeros((h, w), int); ox = np.zeros((h, w), np.float32); oy = ox.copy()
    for k, (px, py, ci, rr) in enumerate(pts):
        dx = (wx - px + w / 2) % w - w / 2; dy = (wy - py + h / 2) % h - h / 2
        d = np.sqrt(dx * dx + (dy * cell_w / cell_h) ** 2)
        m2 = (d < d2) & ~(d < d1); d2 = np.where(m2, d, d2)
        m1 = d < d1; d2 = np.where(m1, d1, d2); d1 = np.where(m1, d, d1); idx = np.where(m1, k, idx); ox = np.where(m1, dx, ox); oy = np.where(m1, dy, oy)
    edge = d2 - d1
    grain = fbm(w, h, [(6, 6, 1.0), (3, 3, 0.7)], rng) - 0.5
    cell_col = np.array([p[2] for p in pts]); cell_rand = np.array([p[3] for p in pts])
    base = cell_col[idx].astype(np.float32)
    shade = (ox / cell_w) * lit[0] * 2 + (oy / cell_h) * lit[1] * 2  # lit side brighter
    # facet shading: lit side gets +2 ramp steps, shadow side -2; grain breaks it up
    k = np.clip(np.round(base + shade * 2.4 + grain * 1.6), 0, len(cols) - 1).astype(int)
    rgb = np.stack(cols)[k]
    crev = hexc(crevice)
    edge_mask = edge < 0.9 + np.clip(grain, 0, 1) * 1.4
    rgb[edge_mask] = crev
    edge_soft = (edge >= 0.9) & (edge < 2.2)
    rgb[edge_soft] = rgb[edge_soft] * 0.6 + crev * 0.4
    # moss: flecks that collect in the crevices of some cells
    mossc = hexc(moss)
    mossy = (cell_rand[idx] < moss_p) & (edge < 3.2) & (grain > 0.02)
    rgb[mossy] = rgb[mossy] * 0.3 + mossc * 0.7
    c.rgb = rgb

def paint_rock_side(name, seed, w=2 * T, h=T):
    rng = np.random.default_rng(seed)
    c = Canvas(w, h)
    facets(c, rng, cell_w=30, cell_h=12, cols=['#544c3c', '#736a50', '#8f8567', '#aba07c', '#c5b990', '#dbd0a6', '#ece2bd'], crevice='#2a2620', moss='#5a7a2c', moss_p=0.22, lit=(-0.3, -0.7), strata_jitter=0.6)
    # a few long horizontal strata cracks
    for i in range(4):
        y = (i + rng.random()) * h / 4; x = 0; pts = [(0, y)]
        while x < w: x += rng.integers(5, 12); y += rng.random() * 3 - 1.5; pts.append((x, y))
        c.line(pts, hexc('#2a271f'), 0.85)
    # darker, damper toward the base
    ys = np.arange(h, dtype=np.float32)[:, None, None] / h
    c.rgb = c.rgb * (1 - 0.18 * ys)
    c.image(False).save(f'{OUT}/{name}.png')

def paint_earth_side(name, seed, w=2 * T, h=T):
    rng = np.random.default_rng(seed)
    ramp_cols = ['#4b321c', '#5b3e24', '#6a4a2b', '#795633', '#88633b', '#976f44', '#a67b4d']
    cols = [hexc(k) for k in ramp_cols]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    wob = fbm(w, h, [(32, 32, 1.0), (16, 16, 0.5)], rng) - 0.5
    band = (ys + wob * 6) / 9.0
    bi = np.floor(band).astype(int)
    band_rand = rng.random(64)
    k = np.clip(np.round(2.5 + (band_rand[bi % 64] - 0.5) * 3.2 + (fbm(w, h, [(5, 5, 1.0), (2, 2, 0.6)], rng) - 0.5) * 2.4), 0, len(cols) - 1).astype(int)
    rgb = np.stack(cols)[k]
    # strata seams
    seam = (band - bi) < 0.14
    rgb[seam] = rgb[seam] * 0.6 + hexc('#2f1f10') * 0.4
    c = Canvas(w, h, rgb)
    for _ in range(40):  # embedded stones
        r = 1.2 + rng.random() * 2.8
        pebble(c, rng.random() * w, rng.random() * h, r, hexc('#c8b896'), hexc('#2a1c0e'), hexc('#8f8262'), rng)
    # roots hanging from the top, branching
    for _ in range(9):
        x = rng.random() * w; y = 0; pts = [(x, y)]
        L = rng.integers(14, 40)
        while y < L: y += rng.integers(2, 5); x += rng.random() * 4 - 2; pts.append((x, y))
        c.line(pts, hexc('#2c1c0c'), 0.95)
        c.line([(p[0] + 1, p[1]) for p in pts[:len(pts) // 2]], hexc('#6a4f2e'), 0.5)
        for _ in range(2):
            i = rng.integers(1, len(pts)); bx, by = pts[i]; c.line([(bx, by), (bx + rng.random() * 8 - 4, by + rng.integers(3, 9))], hexc('#2c1c0c'), 0.8)
    for _ in range(14):  # fine pale roots
        x = rng.random() * w; c.line([(x, 0), (x + rng.random() * 4 - 2, rng.integers(4, 14))], hexc('#b39a70'), 0.6)
    ys1 = np.arange(h, dtype=np.float32)[:, None, None] / h
    c.rgb = c.rgb * (1 - 0.2 * ys1)
    c.image(False).save(f'{OUT}/{name}.png')

def paint_stone_side(name, seed, w=T, h=T):
    """Dressed masonry: 4 courses per tile (one per height step), 2 blocks per course, running bond."""
    rng = np.random.default_rng(seed)
    cols = [hexc(k) for k in ['#4d483f', '#605a50', '#736c61', '#857d71', '#968d80', '#a69d8f', '#b5ac9e']]
    mortar = hexc('#2b2822')
    c = Canvas(w, h, np.tile(mortar, (h, w, 1)))
    course = h // 4; bw = w // 2
    for r in range(4):
        y0, y1 = r * course, (r + 1) * course
        off = (bw // 2) if r % 2 else 0
        for bi in range(-1, 3):
            x0 = bi * bw + off; x1 = x0 + bw
            base = int(np.clip(3 + rng.integers(-1, 2), 1, len(cols) - 2))
            n = fbm(bw, course, [(8, 8, 1.0), (3, 3, 0.6)], rng)
            for yy in range(y0 + 1, y1 - 1):
                for xx in range(x0 + 1, x1 - 1):
                    k = int(np.clip(base + (n[yy - y0, (xx - x0) % bw] - 0.5) * 2.6, 0, len(cols) - 1))
                    # grime streaks sit lower on each block
                    if (yy - y0) > course * 0.6 and n[yy - y0, (xx - x0) % bw] < 0.42: k = max(0, k - 1)
                    c.put(xx, yy, cols[k])
            for xx in range(x0 + 1, x1 - 1): c.put(xx, y0 + 1, cols[min(len(cols) - 1, base + 2)], 0.85); c.put(xx, y1 - 2, cols[max(0, base - 2)], 0.9)
            for yy in range(y0 + 1, y1 - 1): c.put(x0 + 1, yy, cols[min(len(cols) - 1, base + 1)], 0.7); c.put(x1 - 2, yy, cols[max(0, base - 2)], 0.9)
            if rng.random() < 0.4:  # chipped corner
                c.blob(x1 - 3, y1 - 3, 1.6, 1.2, cols[max(0, base - 3)], 0.9)
            if rng.random() < 0.35:  # crack
                px, py = x0 + rng.integers(3, bw - 3), y0 + 2; pts = [(px, py)]
                for _ in range(3): px += rng.integers(-2, 3); py += rng.integers(2, 5); pts.append((px, min(py, y1 - 3)))
                c.line(pts, cols[max(0, base - 3)], 0.9)
    # moss/lichen flecks
    for _ in range(18):
        x, y = rng.integers(0, w), rng.integers(0, h); c.put(x, y, hexc('#5e7233'), 0.75)
    c.image(False).save(f'{OUT}/{name}.png')

def paint_planks(name, seed, w=T, h=T, vertical=True, n=5):
    rng = np.random.default_rng(seed)
    cols = [hexc(k) for k in ['#4e3419', '#5f4222', '#6f4f2a', '#7f5c32', '#8e6a3b', '#9c7745', '#ab8550']]
    gap = hexc('#241709')
    c = Canvas(w, h, np.tile(gap, (h, w, 1)))
    span = (w if vertical else h) / n
    for i in range(n):
        a0 = int(round(i * span)); a1 = int(round((i + 1) * span))
        base = int(np.clip(3 + rng.integers(-1, 2), 1, len(cols) - 2))
        grain = fbm(w, h, [(64, 3, 1.0), (16, 2, 0.5)] if vertical else [(3, 64, 1.0), (2, 16, 0.5)], rng)
        for b in range(h if vertical else w):
            for a in range(a0 + 1, a1 - 1):
                x, y = (a, b) if vertical else (b, a)
                k = int(np.clip(base + (grain[y, x] - 0.5) * 3.0, 0, len(cols) - 1))
                c.put(x, y, cols[k])
        # edge highlight / shadow
        for b in range(h if vertical else w):
            c.put(*((a0 + 1, b) if vertical else (b, a0 + 1)), cols[min(len(cols) - 1, base + 2)], 0.7)
            c.put(*((a1 - 2, b) if vertical else (b, a1 - 2)), cols[max(0, base - 2)], 0.9)
        # knot + nails
        if rng.random() < 0.6:
            kx = rng.integers(a0 + 3, a1 - 3); ky = rng.integers(6, h - 6)
            (c.blob(kx, ky, 1.8, 1.2, cols[max(0, base - 3)]) if vertical else c.blob(ky, kx, 1.2, 1.8, cols[max(0, base - 3)]))
        for e in (4, (h if vertical else w) - 5):
            x, y = ((a0 + a1) // 2, e) if vertical else (e, (a0 + a1) // 2)
            c.put(x, y, hexc('#2a2a2a')); c.put(x, y - 1, hexc('#8d8d8d'), 0.8)
    c.image(False).save(f'{OUT}/{name}.png')

# ---------------------------------------------------------------- decals (alpha)

def paint_fringe(name, seed, kind, w=2 * T, h=T // 4):
    """Overhang strip glued to the top of cliff faces. Opaque at the top, ragged tufts/crumbs hanging down."""
    rng = np.random.default_rng(seed)
    c = Canvas(w, h, alpha=0)
    if kind == 'grass':
        cols = [hexc(k) for k in ['#2b4416', '#3a5a1c', '#4b6f22', '#5f862a', '#7ba035']]
        edge = fbm(w, 1, [(8, 1, 1.0), (3, 1, 0.6)], rng)[0]
        for x in range(w):
            depth = 3 + int(edge[x] * 6)
            for y in range(depth):
                c.put_alpha(x, y, cols[1 if y < depth - 1 else 0])
            c.put_alpha(x, 0, cols[3] if rng.random() < 0.5 else cols[2])
        for _ in range(w // 3):  # hanging blades
            x = rng.integers(0, w); L = rng.integers(4, h - 2)
            xs = x + (rng.random() - 0.5) * 2
            for y in range(L):
                c.put_alpha(int(round(x + (xs - x) * y / L)), y, cols[0 if y > L * 0.6 else 1])
            c.put_alpha(int(round(xs)), L, cols[0], 0.8)
        for _ in range(w // 6):  # lighter tips catching light near the top
            x = rng.integers(0, w); c.put_alpha(x, 1 + rng.integers(0, 2), cols[4])
    else:  # earth: crumbling dirt lip with pebbles and a few roots
        cols = [hexc(k) for k in ['#3f2a16', '#563a20', '#6b4a2a', '#856038']]
        edge = fbm(w, 1, [(6, 1, 1.0), (3, 1, 0.6)], rng)[0]
        for x in range(w):
            depth = 2 + int(edge[x] * 5)
            for y in range(depth):
                c.put_alpha(x, y, cols[2 if y < depth - 1 else 0])
            c.put_alpha(x, 0, cols[3])
        for _ in range(w // 8):
            pebble(c, rng.random() * w, 2 + rng.random() * 4, 1 + rng.random(), hexc('#c8b896'), hexc('#2a1c0e'), hexc('#8f8262'), rng, alpha_write=True)
        for _ in range(w // 12):
            x = rng.random() * w; y = 2; pts = [(x, y)]
            for _ in range(rng.integers(2, 5)): y += rng.integers(2, 4); x += rng.random() * 3 - 1.5; pts.append((x, min(y, h - 1)))
            c.line(pts, cols[0], 0.95, alpha_write=True)
    c.image(True).save(f'{OUT}/{name}.png')

def paint_spill(name, seed, kind, w=2 * T, h=T * 3 // 8):
    """Junction spill: material A creeping onto neighbour B. Opaque at v=top (the shared edge), ragged toward the bottom."""
    rng = np.random.default_rng(seed)
    c = Canvas(w, h, alpha=0)
    if kind == 'dirt':
        cols = [hexc(k) for k in ['#7f5c38', '#916b43', '#a37b4f', '#b48c5c', '#c39c6b']]
        edge = fbm(w, 1, [(10, 1, 1.0), (4, 1, 0.6), (2, 1, 0.3)], rng)[0]
        fine = fbm(w, h, [(4, 4, 1.0), (2, 2, 0.5)], rng)
        for x in range(w):
            depth = 4 + edge[x] * (h - 6)
            for y in range(h):
                if y < depth:
                    k = int(np.clip(2 + (fine[y, x] - 0.5) * 3, 0, len(cols) - 1)); c.put_alpha(x, y, cols[k])
                elif y < depth + 3 and rng.random() < 0.35:
                    c.put_alpha(x, y, cols[1 + rng.integers(0, 2)])
        for _ in range(w // 6):
            pebble(c, rng.random() * w, rng.random() * h * 0.6, 1 + rng.random() * 1.2, hexc('#d9cdb0'), hexc('#4a3520'), hexc('#a99a80'), rng, alpha_write=True)
    elif kind == 'sand':
        cols = [hexc(k) for k in ['#d6b878', '#e2c788', '#ecd498', '#f4e0aa']]
        edge = fbm(w, 1, [(12, 1, 1.0), (4, 1, 0.5)], rng)[0]
        for x in range(w):
            depth = 3 + edge[x] * (h - 5)
            for y in range(h):
                if y < depth: c.put_alpha(x, y, cols[rng.integers(0, len(cols))] if rng.random() < 0.3 else cols[2])
                elif y < depth + 4 and rng.random() < 0.3: c.put_alpha(x, y, cols[1])
    else:  # grass creeping over stone/dirt
        cols = [hexc(k) for k in ['#3d5a1e', '#4d6b22', '#5c7d27', '#6c8e2c', '#7d9e32']]
        edge = fbm(w, 1, [(6, 1, 1.0), (3, 1, 0.7)], rng)[0]
        for x in range(w):
            depth = 1 + edge[x] * (h * 0.45)
            for y in range(int(depth)): c.put_alpha(x, y, cols[1 + (y % 2)])
        for _ in range(w // 2):
            x = rng.random() * w; y = rng.random() * h * 0.7
            tuft(c, x, y + 3, cols[0:3], rng, h=3, alpha_write=True)
    c.image(True).save(f'{OUT}/{name}.png')

def paint_water(name, seed, size=2 * T):
    """Water field for the surface shader. Not a colour map: three smooth tileable channels.
      R = broad swell height (slow layer)   G = fine chop (fast layer)   B = long directional roller
    Sampled with LINEAR filtering, so no posterisation here - the shader shapes crests from the gradients."""
    rng = np.random.default_rng(seed)
    w = h = size
    swell = normalize(fbm(w, h, [(64, 64, 0.5), (32, 32, 1.0), (16, 16, 0.5)], rng))
    chop = normalize(fbm(w, h, [(16, 16, 1.0), (8, 8, 0.6), (4, 4, 0.3)], rng))
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    n = fbm(w, h, [(32, 32, 1.0), (16, 16, 0.5)], rng) - 0.5
    roll = 0.5 + 0.5 * np.sin(2 * math.pi * (3 * xs + 1 * ys) / w + n * 4.0)
    roll = roll * 0.75 + normalize(fbm(w, h, [(24, 24, 1.0)], rng)) * 0.25
    img = np.dstack([swell, chop, roll])
    Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8), 'RGB').save(f'{OUT}/{name}.png')

def paint_caustic(name, seed, size=2 * T):
    """Bright soft web for the shallow bed. LINEAR, tileable, mostly black with thin light veins."""
    rng = np.random.default_rng(seed)
    w = h = size
    a = normalize(fbm(w, h, [(11, 11, 1.0), (5, 5, 0.5)], rng))
    b = normalize(fbm(w, h, [(10, 10, 1.0), (5, 5, 0.5)], rng))
    v = 1.0 - np.abs(a - b) * 14.0
    v = np.clip(v, 0, 1) ** 2.0
    v *= normalize(fbm(w, h, [(16, 16, 1.0), (8, 8, 0.6)], rng))   # break the web into patches
    img = (v * 255).astype(np.uint8)
    Image.fromarray(np.dstack([img, img, img]), 'RGB').save(f'{OUT}/{name}.png')

# ---------------------------------------------------------------- scatter decals (alpha, one per tile-ish)

def _ragged_mask(w, h, rng, radius=0.42, wob=0.22, oct=((10, 10, 1.0), (5, 5, 0.6), (2, 2, 0.3)), erode=0.55):
    """Irregular patch mask centred in the cell, hard-edged (alphaTest friendly). The patch is warped by
    fbm and then eroded by a second field, so it breaks into a cluster instead of reading as a disc."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = (xs + 0.5) / w - 0.5, (ys + 0.5) / h - 0.5
    d = np.sqrt(dx * dx + dy * dy) / max(1e-4, radius)     # 0 at centre, 1 at the nominal rim
    n = fbm(w, h, list(oct), rng) - 0.5
    e = fbm(w, h, [(7, 7, 1.0), (3, 3, 0.7)], rng)
    core = d + n * (wob / max(1e-4, radius))
    return (core < 1.0) & (e > np.clip(core - 0.15, 0, 1) * erode)

def paint_scatter(name, seed, kind, size=T):
    rng = np.random.default_rng(seed)
    w = h = size
    c = Canvas(w, h, alpha=0)
    if kind == 'pebbles':
        for _ in range(rng.integers(7, 12)):
            x = w * (0.15 + rng.random() * 0.7); y = h * (0.15 + rng.random() * 0.7)
            pebble(c, x, y, 1.4 + rng.random() * 2.6, hexc('#ded8c2'), hexc('#3a352a'), hexc('#a9a390'), rng, alpha_write=True)
        for _ in range(rng.integers(6, 14)):  # grit
            c.put_alpha(int(rng.random() * w), int(rng.random() * h), hexc('#8e8877'), 0.9)
    elif kind == 'tufts':
        cols = [hexc(k) for k in ['#2c4514', '#4f7522', '#7fa63a']]
        for _ in range(rng.integers(8, 14)):
            tuft(c, w * (0.1 + rng.random() * 0.8), h * (0.2 + rng.random() * 0.75), cols, rng, alpha_write=True)
        for _ in range(rng.integers(2, 5)):  # tiny flowers
            x, y = int(rng.random() * w), int(rng.random() * h)
            col = hexc('#f0e7b4') if rng.random() < 0.6 else hexc('#e4a8c0')
            c.put_alpha(x, y, col); c.put_alpha(x + 1, y, col * 0.85)
    elif kind == 'weeds':
        cols = [hexc(k) for k in ['#4c4a1c', '#7d7a2e', '#b6ae52']]
        for _ in range(rng.integers(6, 11)):
            tuft(c, w * (0.1 + rng.random() * 0.8), h * (0.2 + rng.random() * 0.75), cols, rng, alpha_write=True)
        for _ in range(rng.integers(3, 7)):
            pebble(c, rng.random() * w, rng.random() * h, 1 + rng.random() * 1.6, hexc('#d6cdb0'), hexc('#3a3226'), hexc('#9a8f76'), rng, alpha_write=True)
    elif kind == 'bare':      # worn bare earth showing through grass
        m = _ragged_mask(w, h, rng, 0.38, 0.20, erode=0.75)
        cols = [hexc(k) for k in ['#5f4a30', '#75603e', '#8a744e', '#9c8560', '#ab9572', '#b7a384']]
        f = fbm(w, h, [(12, 12, 1.0), (5, 5, 0.6), (2, 2, 0.35)], rng)
        for y in range(h):
            for x in range(w):
                if m[y, x]:
                    c.put_alpha(x, y, cols[int(np.clip(f[y, x] * len(cols), 0, len(cols) - 1))])
        for _ in range(rng.integers(5, 10)):
            x, y = rng.random() * w, rng.random() * h
            if m[int(y) % h, int(x) % w]:
                pebble(c, x, y, 1 + rng.random() * 1.8, hexc('#ddd3b6'), hexc('#3c2e1c'), hexc('#a1927a'), rng, alpha_write=True)
        for _ in range(rng.integers(3, 7)):   # grass creeping back in at the rim
            tuft(c, w * (0.12 + rng.random() * 0.76), h * (0.2 + rng.random() * 0.7), [hexc('#33491a'), hexc('#4f6f24'), hexc('#7ea137')], rng, h=3, alpha_write=True)
    elif kind == 'moss':      # damp moss / lichen creeping over stone
        m = _ragged_mask(w, h, rng, 0.34, 0.24, ((8, 8, 1.0), (4, 4, 0.7), (2, 2, 0.4)), erode=0.85)
        cols = [hexc(k) for k in ['#33461b', '#3f5620', '#4c6626', '#59762c', '#688734']]
        f = fbm(w, h, [(9, 9, 1.0), (4, 4, 0.6), (2, 2, 0.4)], rng)
        for y in range(h):
            for x in range(w):
                if m[y, x]:
                    c.put_alpha(x, y, cols[int(np.clip(f[y, x] * len(cols), 0, len(cols) - 1))])
    elif kind == 'gravel':    # pale scree patch for dirt / rock tops
        m = _ragged_mask(w, h, rng, 0.36, 0.22, erode=0.85)
        for y in range(h):
            for x in range(w):
                if m[y, x] and rng.random() < 0.45:
                    c.put_alpha(x, y, hexc('#8c8471'), 0.8)
        for _ in range(rng.integers(10, 18)):
            x, y = rng.random() * w, rng.random() * h
            if m[int(y) % h, int(x) % w]:
                pebble(c, x, y, 1.2 + rng.random() * 2.2, hexc('#e2dcc6'), hexc('#3b372c'), hexc('#aaa48f'), rng, alpha_write=True)
    c.image(True).save(f'{OUT}/{name}.png')

def paint_wetband(name, seed, w=2 * T, h=T // 2):
    """Damp shoreline band laid on the land tile that touches water. Opaque at v=1 (the water edge),
    ragged and fading inland toward v=0. Dark saturated soil, wet pebbles, a couple of reeds."""
    rng = np.random.default_rng(seed)
    c = Canvas(w, h, alpha=0)
    cols = [hexc(k) for k in ['#2c2418', '#3a2f1f', '#493c28', '#584a32', '#66573c']]
    edge = fbm(w, 1, [(10, 1, 1.0), (4, 1, 0.7), (2, 1, 0.35)], rng)[0]
    fine = fbm(w, h, [(6, 6, 1.0), (3, 3, 0.5)], rng)
    for x in range(w):
        depth = 3 + edge[x] * (h - 5)          # how far inland the damp reaches, in texels from the top (v=1 side)
        for y in range(h):
            yy = h - 1 - y                      # y=0 is v=0 (inland); the water edge is the last row
            if y > h - 1 - depth:
                k = int(np.clip(1 + (fine[y, x] - 0.5) * 3.4 + (h - 1 - y) / max(1.0, depth) * 2.2, 0, len(cols) - 1))
                c.put_alpha(x, y, cols[k])
            elif y > h - 4 - depth and rng.random() < 0.4:
                c.put_alpha(x, y, cols[2 + rng.integers(0, 2)])
    for _ in range(w // 5):                     # wet pebbles sit in the band
        pebble(c, rng.random() * w, h - 1 - rng.random() * h * 0.5, 1 + rng.random() * 1.8,
               hexc('#b9b19a'), hexc('#1c160e'), hexc('#7a7160'), rng, alpha_write=True)
    for _ in range(w // 10):                    # reeds leaning inland
        tuft(c, rng.random() * w, h - 2 - rng.random() * 3, [hexc('#22300f'), hexc('#3d5518'), hexc('#6d8a2c')], rng, h=5, alpha_write=True)
    c.image(True).save(f'{OUT}/{name}.png')

def contact():
    files = sorted(f for f in os.listdir(OUT) if f.endswith('.png') and not f.startswith('_'))
    cell = 132; cols = 5; rows = (len(files) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell, rows * (cell + 14)), (20, 20, 24)); d = ImageDraw.Draw(sheet)
    for i, f in enumerate(files):
        im = Image.open(f'{OUT}/{f}').convert('RGBA')
        sc = 128 / max(im.width, im.height)
        im = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))), Image.NEAREST)
        x, y = (i % cols) * cell, (i // cols) * (cell + 14)
        sheet.paste(im, (x + 2, y + 14), im); d.text((x + 2, y + 1), f[:-4], fill=(220, 220, 220))
    sheet.save(f'{OUT}/_contact.png')

if __name__ == '__main__':
    paint_grass('grass', 11, ['#425a22', '#4e6926', '#5a782a', '#68872f', '#769535', '#85a33c', '#95b046'], ['#3a5418', '#5e8228', '#a5c24a'], pebble_n=26)
    paint_grass('grass_dark', 12, ['#243c17', '#2d4a1b', '#37581f', '#416624', '#4c7429', '#578230'], ['#203414', '#436326', '#7fa03a'], pebble_n=10, flower=False)
    # second grass: drier, more olive/yellow at the same value range. Chosen per tile by a low-frequency
    # noise field so big lawns break into meadow patches instead of one repeating stamp.
    paint_grass('grass2', 61, ['#4a5722', '#556325', '#61712a', '#6d7f31', '#7b8d38', '#8b9c42', '#9dac4f'], ['#3d4c16', '#6a7b26', '#b3bc4c'], pebble_n=34)
    paint_dirt('dirt', 13, ['#6b4a2c', '#7c5936', '#8d6840', '#9d774a', '#ad8755', '#bb9662', '#c8a470'])
    paint_dirt('dirt2', 62, ['#63472c', '#755635', '#856541', '#95744c', '#a48458', '#b39365', '#c1a274'],
               pebbles=150, tufts=4, cracks=9, streak=0.42, angle=(0.30, 0.62))
    paint_sand('sand', 14, ['#c2a163', '#cfaf70', '#dbbe7f', '#e5cb8f', '#edd69f', '#f4e0b0'])
    paint_flag('flag', 15, ['#5e5a50', '#6f6b61', '#807c71', '#918d82', '#a19d91', '#b0aca0', '#bfbbae'])
    paint_rock_top('rock_top', 16)
    paint_bed('bed', 17)
    paint_rock_side('rock_side', 21)
    paint_earth_side('earth_side', 22)
    paint_stone_side('stone_side', 23)
    paint_planks('plank_top', 24, vertical=True, n=5)
    paint_planks('plank_side', 25, vertical=False, n=4)
    paint_fringe('fringe_grass', 31, 'grass')
    paint_fringe('fringe_earth', 32, 'earth')
    paint_spill('spill_dirt', 41, 'dirt')
    paint_spill('spill_sand', 42, 'sand')
    paint_spill('spill_grass', 43, 'grass')
    paint_water('ripple', 51)
    paint_caustic('caustic', 52)
    paint_scatter('sc_pebbles', 71, 'pebbles')
    paint_scatter('sc_tufts', 72, 'tufts')
    paint_scatter('sc_weeds', 73, 'weeds')
    paint_scatter('sc_bare', 74, 'bare')
    paint_scatter('sc_moss', 75, 'moss')
    paint_scatter('sc_gravel', 76, 'gravel')
    paint_wetband('wetband', 81)
    contact()
    json.dump({'texels_per_tile': T, 'note': 'painted set by the terrain owner; see _paint.py'}, open(f'{OUT}/manifest.json', 'w'), indent=1)
    print('painted', OUT)
