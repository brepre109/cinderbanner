"""Build classic-style 128x128 seamless pixel textures from gpt-5-image-mini output + procedural fallbacks."""
import glob, json, os, colorsys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SCR = os.path.dirname(os.path.abspath(__file__))
GEN = os.environ.get('TEX_GEN', os.path.join(SCR, 'gen'))  # dir holding the raw gpt-5-image-mini PNGs (<name>_2026*.png)
OUT = os.path.join(SCR, '..', 'public', 'textures')
os.makedirs(OUT, exist_ok=True)
SIZE = 128
BAND = 128  # seam-repair band half-width at source scale

# ---------------------------------------------------------------- helpers

def src(prefix):
    return sorted(glob.glob(os.path.join(GEN, prefix + '_2026*.png')))[0]

def load(prefix):
    a = np.asarray(Image.open(src(prefix)).convert('RGB')).astype(np.float32)
    # strip picture-frame borders (near-black rows/cols at the edges)
    g = a.mean(2)
    rm, cm = g.mean(1), g.mean(0)
    top = int(np.argmax(rm > 40)); bot = int(len(rm) - np.argmax(rm[::-1] > 40))
    left = int(np.argmax(cm > 40)); right = int(len(cm) - np.argmax(cm[::-1] > 40))
    # pad a little inside the border so anti-aliased frame edges go too
    pad = 6 if (top or left or bot < a.shape[0] or right < a.shape[1]) else 0
    return a[top + pad:bot - pad, left + pad:right - pad]

def best_periodic_crop(a, axis, period, n, k=16, dark_pref=0.25):
    """Crop n periods along axis, choosing the start so the wrap seam is least visible.
    Compares a k-wide band across the wrap and prefers a dark boundary (gap / mortar / shadow line)."""
    b = a if axis == 0 else a.transpose(1, 0, 2)
    L = b.shape[0]
    bright = b.mean(2).mean(1)             # per-row mean brightness
    best = None
    for P in range(period - 10, period + 11):
        span = n * P
        if span + k > L:
            continue
        for s in range(0, L - span - k):
            e = np.abs(b[s:s + k] - b[s + span:s + span + k]).mean()
            e = e + dark_pref * bright[s]
            if best is None or e < best[0]:
                best = (e, s, span)
    e, s, span = best
    return (a[s:s + span] if axis == 0 else a[:, s:s + span]), s, span, e

def min_cut_path(err):
    """err: (H, W). Return per-row column index of the min-cost top-to-bottom path (moves -1/0/+1)."""
    H, W = err.shape
    cost = err.copy()
    back = np.zeros((H, W), dtype=np.int8)
    for y in range(1, H):
        prev = cost[y - 1]
        left = np.concatenate(([np.inf], prev[:-1]))
        right = np.concatenate((prev[1:], [np.inf]))
        stack = np.stack([left, prev, right])
        arg = np.argmin(stack, 0)
        cost[y] += stack[arg, np.arange(W)]
        back[y] = arg - 1
    path = np.zeros(H, dtype=int)
    path[-1] = int(np.argmin(cost[-1]))
    for y in range(H - 1, 0, -1):
        path[y - 1] = path[y] + back[y, path[y]]
    return path

def fix_vertical_seam(a, band=BAND):
    """Make a wrap horizontally: roll by w/2 (seam lands mid-image), patch the seam with the
    original (continuous there) using min-error-boundary cuts on each side."""
    H, W, _ = a.shape
    half = W // 2
    R = np.roll(a, half, axis=1)          # seam at column `half`
    x0, x1 = half - band, half + band
    out = R.copy()
    # left overlap [x0, half): R on the left of the cut, A on the right
    errL = ((R[:, x0:half] - a[:, x0:half]) ** 2).sum(2)
    pL = min_cut_path(errL) + x0
    # right overlap [half, x1): A on the left, R on the right
    errR = ((R[:, half:x1] - a[:, half:x1]) ** 2).sum(2)
    pR = min_cut_path(errR) + half
    xs = np.arange(W)[None, :]
    mask = (xs >= pL[:, None]) & (xs < pR[:, None])
    out[mask] = a[mask]
    return np.roll(out, -half, axis=1)   # roll back so the picture keeps its original framing

def fix_horizontal_seam(a, band=BAND):
    return fix_vertical_seam(a.transpose(1, 0, 2), band).transpose(1, 0, 2)

def make_seamless(a, band=BAND):
    return fix_horizontal_seam(fix_vertical_seam(a, band), band)

def adjust(a, sat=1.0, hue=0.0, val=1.0):
    """Global HSV tweak in float space. hue in turns (e.g. +0.02 = towards yellow from red)."""
    if sat == 1.0 and hue == 0.0 and val == 1.0:
        return a
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert('HSV')
    h = np.asarray(im).astype(np.float32)
    h[..., 0] = (h[..., 0] + hue * 255) % 255
    h[..., 1] = np.clip(h[..., 1] * sat, 0, 255)
    h[..., 2] = np.clip(h[..., 2] * val, 0, 255)
    return np.asarray(Image.fromarray(h.astype(np.uint8), 'HSV').convert('RGB')).astype(np.float32)

def downscale_quantize(a, size=SIZE, colors=32):
    """Tile 2x2 so LANCZOS sees the wrap, resize, crop one tile, quantize with no dither."""
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    W, H = im.size
    big = Image.new('RGB', (W * 2, H * 2))
    for dx in (0, W):
        for dy in (0, H):
            big.paste(im, (dx, dy))
    small = big.resize((size * 2, size * 2), Image.LANCZOS).crop((0, 0, size, size))
    q = small.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    return q.convert('RGBA')

def save(name, im):
    im.save(os.path.join(OUT, name + '.png'))
    print('wrote', name, im.size, 'colors', len(im.convert('RGB').getcolors(4096)))

# ---------------------------------------------------------------- AI-sourced textures

def stochastic(prefix, name, band=BAND, **adj):
    a = load(prefix)
    a = adjust(a, **adj)
    a = make_seamless(a, band)
    save(name, downscale_quantize(a))

def periodic(prefix, name, row_period=None, rows=None, col_period=None, cols=None, band=32, k=16, **adj):
    a = load(prefix)
    a = adjust(a, **adj)
    if row_period:
        a, s, span, e = best_periodic_crop(a, 0, row_period, rows, k=k)
        print(f'  {name}: rows crop start {s} span {span} seam err {e:.1f}')
    if col_period:
        a, s, span, e = best_periodic_crop(a, 1, col_period, cols, k=k)
        print(f'  {name}: cols crop start {s} span {span} seam err {e:.1f}')
    a = make_seamless(a, band=band)
    save(name, downscale_quantize(a))

# ---------------------------------------------------------------- procedural textures

def wrap_noise(h, w, scale, seed, octaves=3):
    """Tileable value noise in [0,1] built from wrapped bilinear-upsampled random grids."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        gh, gw = max(2, h // (scale >> o)), max(2, w // (scale >> o))
        g = rng.random((gh, gw)).astype(np.float32)
        ys = np.arange(h) * gh / h; xs = np.arange(w) * gw / w
        y0 = ys.astype(int); x0 = xs.astype(int)
        fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
        y1 = (y0 + 1) % gh; x1 = (x0 + 1) % gw
        v = (g[y0][:, x0] * (1 - fy) * (1 - fx) + g[y0][:, x1] * (1 - fy) * fx
             + g[y1][:, x0] * fy * (1 - fx) + g[y1][:, x1] * fy * fx)
        out += v * amp; total += amp; amp *= 0.5
    return out / total

def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)

def proc_wood_plank_side():
    """4 horizontal clapboard planks, 32px each, lit top edge + dark shadow under each board."""
    H = W = SIZE
    img = np.zeros((H, W, 3), np.float32)
    pal = dict(black='#22150b', dark='#4a2f1b', mid='#6a4527', light='#8a5c31', tan='#a97a44', hi='#c8955a')
    n = wrap_noise(H, W, 8, 11, 2)
    rng = np.random.default_rng(5)
    for p in range(4):
        y0 = p * 32
        # board body with wrapped horizontal grain streaks
        for y in range(y0, y0 + 32):
            row = np.full(W, 0, np.float32)
            # grain: long runs decided by a wrapped 1D noise per row
            g = wrap_noise(1, W, 16, 100 + p * 40 + y, 2)[0][:, None]
            base = np.where(g > 0.62, hexrgb(pal['light']), hexrgb(pal['mid']))
            base = np.where(g < 0.36, hexrgb(pal['dark']), base)
            img[y] = base
        # lit top lip (2px) and mid highlight line, then shadow of the board above (3px)
        img[y0:y0 + 2] = hexrgb(pal['tan'])
        img[y0 + 2] = np.where((n[y0 + 2] > 0.5)[:, None], hexrgb(pal['hi']), hexrgb(pal['tan']))
        img[y0 + 29:y0 + 32] = hexrgb(pal['black'])
        img[y0 + 28] = np.where((n[y0 + 28] > 0.55)[:, None], hexrgb(pal['black']), hexrgb(pal['dark']))
        # a knot on two of the boards
        if p in (1, 3):
            kx = int(rng.integers(20, 100)); ky = y0 + int(rng.integers(8, 22))
            for dy in range(-3, 4):
                for dx in range(-5, 6):
                    d = (dx / 5.0) ** 2 + (dy / 3.0) ** 2
                    if d <= 1.0:
                        img[ky + dy, (kx + dx) % W] = hexrgb(pal['dark'] if d > 0.45 else pal['black'])
        # nail heads at two positions per board (wrapped)
        for kx in (10, 74):
            img[y0 + 14:y0 + 16, kx:kx + 2] = hexrgb('#2e2418')
            img[y0 + 14, kx] = hexrgb('#5a5048')
    return img

def proc_plaster_wall():
    """Cream plaster panel with dark timber framing: post at left, sill beam at top, diagonal brace."""
    H = W = SIZE
    cream, cream_lo, cream_hi = hexrgb('#e7dcc1'), hexrgb('#d6c6a4'), hexrgb('#f3ead4')
    n = wrap_noise(H, W, 4, 7, 2)
    cream_hi = cream * 0.5 + cream_hi * 0.5; cream_lo = cream * 0.4 + cream_lo * 0.6
    img = np.where((n > 0.66)[..., None], cream_hi, np.where((n < 0.34)[..., None], cream_lo, cream))
    # sparse dirt speckles
    rng = np.random.default_rng(3)
    for _ in range(90):
        x = int(rng.integers(0, W)); y = int(rng.integers(0, H))
        img[y, x] = cream_lo
    beam_hi, beam, beam_lo, beam_black = hexrgb('#8d6238'), hexrgb('#5c3d22'), hexrgb('#3b2614'), hexrgb('#22160c')
    grain = wrap_noise(H, W, 6, 21, 2)

    def paint_beam(mask):
        body = np.where((grain > 0.72)[..., None], beam_hi * 0.35 + beam * 0.65, beam)
        body = np.where((grain < 0.3)[..., None], beam_lo, body)
        img[mask] = body[mask]

    yy, xx = np.mgrid[0:H, 0:W]
    BW = 14
    post = xx < BW                       # vertical post along the left edge
    sill = yy < BW                       # horizontal beam along the top edge
    # diagonal brace from the bottom of the post up to the sill on the right side of the panel
    # runs from (x=BW, y=H-1) to (x=W-1-BW, y=BW) with thickness ~10px
    x_a, y_a, x_b, y_b = BW, H, W - 4, BW
    t = ((xx - x_a) * (y_b - y_a) - (yy - y_a) * (x_b - x_a)) / np.hypot(x_b - x_a, y_b - y_a)
    along = ((xx - x_a) * (x_b - x_a) + (yy - y_a) * (y_b - y_a)) / (np.hypot(x_b - x_a, y_b - y_a) ** 2)
    brace = (np.abs(t) < 6) & (along > 0) & (along < 1) & ~post & ~sill
    paint_beam(post | sill | brace)
    # bevels: lit edge on the right of the post / bottom of the sill / upper edge of the brace, shadow on the other side
    img[(xx == BW - 1) & ~sill] = beam_hi
    img[(yy == BW - 1) & ~post] = beam_hi
    img[(xx == 0)] = beam_black
    img[(yy == 0)] = beam_black
    img[(t > 4.2) & (t < 6) & brace] = beam_hi
    img[(t < -4.2) & (t > -6) & brace] = beam_black
    # plaster shadow cast just right of the post and just below the sill
    shadow = ((xx == BW) & ~sill) | ((yy == BW) & ~post)
    img[shadow] = cream_lo * 0.92
    return img

def procedural(name, fn):
    a = fn()
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    q = im.quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGBA')
    save(name, q)

# ---------------------------------------------------------------- run

ROLE = {
    'grass_top': 'top', 'grass_dark_top': 'top', 'dirt_top': 'top', 'sand_top': 'top', 'cobble_top': 'top',
    'stone_block_side': 'side', 'rock_cliff_side': 'side', 'earth_cliff_side': 'side',
    'wood_plank_top': 'top', 'wood_plank_side': 'side', 'roof_tile': 'side', 'plaster_wall': 'side',
    'water': 'water', 'bridge_plank': 'top',
}
SOURCE = {}

def main():
    # stochastic AI textures (palette nudged toward the genre captures)
    stochastic('grass_top', 'grass_top', sat=0.82, hue=0.012)      # sage/olive, less neon
    stochastic('grass_dark_top', 'grass_dark_top', sat=0.85, val=1.05)
    stochastic('dirt_top', 'dirt_top', sat=0.9)
    stochastic('sand_top', 'sand_top')
    stochastic('cobble_top', 'cobble_top', band=200)
    stochastic('rock_cliff_side', 'rock_cliff_side', band=200, sat=0.62, val=0.95)   # grey-brown, not orange
    stochastic('earth_cliff_side', 'earth_cliff_side', sat=0.9)
    stochastic('water', 'water')
    # periodic AI textures: crop whole periods first
    periodic('bridge_plank', 'bridge_plank', row_period=200, rows=4)
    periodic('wood_plank_top', 'wood_plank_top', col_period=235, cols=4)
    periodic('roof_tile', 'roof_tile', row_period=155, rows=4, col_period=150, cols=4, band=96, k=48, sat=0.68, val=0.84, hue=0.008)
    periodic('stone_block_side', 'stone_block_side', row_period=225, rows=4, col_period=248, cols=4)
    for k in ['grass_top', 'grass_dark_top', 'dirt_top', 'sand_top', 'cobble_top', 'rock_cliff_side',
              'earth_cliff_side', 'water', 'bridge_plank', 'wood_plank_top', 'roof_tile', 'stone_block_side']:
        SOURCE[k] = 'ai'
    # procedural
    procedural('wood_plank_side', proc_wood_plank_side); SOURCE['wood_plank_side'] = 'procedural'
    procedural('plaster_wall', proc_plaster_wall); SOURCE['plaster_wall'] = 'procedural'
    write_manifest()
    seam_report()
    contact_sheet()

def seam_report():
    print('seam check: wrap-edge diff vs mean interior neighbour diff (ratio near 1 = seamless)')
    for name in ROLE:
        a = np.asarray(Image.open(os.path.join(OUT, name + '.png')).convert('RGB')).astype(float)
        inner_h = np.abs(a[:, 1:] - a[:, :-1]).mean(); wrap_h = np.abs(a[:, 0] - a[:, -1]).mean()
        inner_v = np.abs(a[1:] - a[:-1]).mean(); wrap_v = np.abs(a[0] - a[-1]).mean()
        print(f'  {name:18s} horiz {wrap_h/inner_h:4.2f}  vert {wrap_v/inner_v:4.2f}')

def write_manifest():
    man = {}
    for name, role in ROLE.items():
        im = Image.open(os.path.join(OUT, name + '.png')).convert('RGB')
        avg = np.asarray(im).reshape(-1, 3).mean(0)
        man[name + '.png'] = {'tile': True, 'role': role, 'avgColor': '#%02x%02x%02x' % tuple(int(round(v)) for v in avg)}
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(man, f, indent=2)
    print('manifest written')

def contact_sheet():
    names = list(ROLE)
    cell = SIZE * 2; cols = 4; rows = (len(names) + cols - 1) // cols; label = 18
    sheet = Image.new('RGB', (cols * (cell + 8), rows * (cell + label + 8)), (24, 24, 28))
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(names):
        im = Image.open(os.path.join(OUT, name + '.png')).convert('RGB')
        x = (i % cols) * (cell + 8) + 4; y = (i // cols) * (cell + label + 8) + label
        for dx in (0, SIZE):
            for dy in (0, SIZE):
                sheet.paste(im, (x + dx, y + dy))
        d.text((x, y - label + 3), name, fill=(240, 240, 240))
    sheet.save(os.path.join(OUT, '_contact.png'))
    print('contact sheet written')

if __name__ == '__main__':
    main()
