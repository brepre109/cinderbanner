#!/usr/bin/python3
"""Pack head-and-shoulders PORTRAITS from the high-resolution extracted frames (portraits owner).

Usage: /usr/bin/python3 tools/pack_portraits.py [--debug] [<sheet> ...]     (no sheet args = every sheet in roster.js)
Output: public/portraits/<sheet>.png      96x96 RGBA, transparent background (the UI draws the frame)
        public/portraits/<sheet>@48.png   48x48 RGBA
        public/portraits/index.json       {sheet: {crop:[x,y,w,h], src, flip, auto}}  (crop in source-frame pixels)
        shots/portraits/sheet.png         contact sheet of every portrait (96 + 48) over the UI's slate/khaki tones
        shots/portraits/debug.png         (--debug) crop boxes drawn over every source frame

Source = the FRONT IDLE frame ../extracted_frames/<sheet>/r1_c1.png (pack_sprites.py row 0 col 0 == POSE.idle),
320x512, figure ~230 px tall. It is mirrored exactly when pack_sprites mirrored row 0 (meta.rowFlip[0]) and gets the
same per-sheet value/chroma conditioning the atlas got (meta.cond g/sat), so the face matches the unit on the field.

Framing (humans): the head is found on a morphologically OPENED mask (a 9-px opening erases spear/staff shafts, bow
strings, halos, sword blades seen edge-on) inside a central band around the torso axis (so a raised sword or wing to
the side cannot become 'the head'). The crop side is a fixed fraction of the character's CORE height (same measure
pack_sprites.py scales by), so every human bust has the same head size; the head top sits a fixed fraction below the
crop's top edge. Monsters and the few hard humans use OVERRIDES (source-pixel crop), listed below with the reason.
Downscale: premultiplied LANCZOS (+ in-mask unsharp) from pack_sprites.resize_premul -> hard alpha -> 1-px ink ring
(pack_sprites.outline), i.e. the exact pixel-art treatment of the atlas levels. The extractor's white matte fringe is
removed first with pack_sprites.defringe.
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pack_sprites as P  # noqa: E402  (defringe, outline, resize_premul, roster_sizes, core_metrics, ...)

ROOT = os.path.join(HERE, '..')
OUT = os.path.join(ROOT, 'public', 'portraits')
SPRITES = os.path.join(ROOT, 'public', 'sprites')
SHOTS = os.path.join(ROOT, 'shots', 'portraits')
SIZES = (96, 48)

# Human framing constants (fractions of the crop side S; S = SIDE_K * core height of the idle frame).
SIDE_K = 0.44      # crop side / core height  -> head ~45 % of the frame, shoulders in the bottom third
TOP_K = 0.08       # gap between the crop top and the head top, as a fraction of S
OPEN_PX = 9        # opening kernel (px, source): erases thin shafts / strings / blades
BAND_K = 0.16      # half-width of the central search band, fraction of core height

# Per-sheet overrides. Keys are sheet names; values are dicts:
#   crop: [x, y, side]  exact square crop in (unflipped) source-frame pixels -- used for monsters, whose 'face' is not
#                       at the top-centre of the silhouette
#   dx, dy, k:          nudges to the AUTOMATIC human framing (dx/dy in fractions of S, k multiplies S)
OVERRIDES = {
    # nudges to the automatic framing (headgear/hair that the head-top finder correctly counts, but that pushes the
    # face below the ~40 % eye line)
    '02_amazon':                 {'dx': 0.06},             # ponytail widens the head run to the left
    '04_wizard_mage':            {'dy': 0.05},             # deep hood
    '06_valkyrie_freya':         {'dy': 0.05},             # winged helm
    '12_angel_seraph':           {'dy': 0.10},             # halo sits well above the hair
    # humans whose top-of-silhouette is not their head
    '26_ironclad_steam_knight':  {'crop': [115, 175, 100]},  # smokestack plume above the helm read as the head
    '39_bell_ringer_exorcist':   {'crop': [120, 163, 100]},  # the bell is raised above his head
    '40_falconer_sky_hunter':    {'crop': [66, 158, 100]},   # the falcon on his arm is taller than he is
    # monsters: face / upper body, chosen by eye on shots/portraits/grid_*.png (source px, unflipped)
    '71_rhinoceros_beetle_siegebreaker': {'crop': [165, 175, 110]},  # head + horn
    '73_thorn_treant_rootwarden': {'crop': [80, 130, 150]},
    '82_ash_hound':               {'crop': [165, 258, 100]},
    '84_magma_cerberus':          {'crop': [100, 170, 130]},  # centre head, flanked by the other two
    '85_eclipse_cerberus':        {'crop': [105, 165, 125]},
    '88_ossuary_wheel':           {'crop': [85, 185, 130]},   # the green eye and the skull rim
    '94_ironback_siege_boar':     {'crop': [130, 185, 110]},  # snout + tusks
}


def load_idle(name):
    a = np.asarray(Image.open(os.path.join(P.SRC, name, 'r1_c1.png')).convert('RGBA')).astype(np.float32)
    return P.defringe(a)


def sheet_meta(name):
    try:
        return json.load(open(os.path.join(SPRITES, name + '.json')))
    except OSError:
        return {}


def apply_cond(a, cond):
    """pack_sprites.condition() with the sheet's recorded (g, sat): same gamma, chroma gain and highlight knee."""
    g, sat = float(cond.get('g', 1.0)), float(cond.get('sat', 1.0))
    c = 255.0 * np.power(np.clip(a[..., :3], 0, 255) / 255.0, g)
    L = (c @ P.LUMA_W)[..., None]
    c = L + (c - L) * sat
    hi = c > P.ART_KNEE
    if hi.any():
        k = P.ART_CEIL - P.ART_KNEE
        c[hi] = P.ART_KNEE + k * (1.0 - np.exp(-(c[hi] - P.ART_KNEE) / k))
    b = a.copy()
    b[..., :3] = np.clip(c, 0.0, P.ART_CEIL)
    return b


def opened(m, px=OPEN_PX):
    im = Image.fromarray((m * 255).astype(np.uint8))
    im = im.filter(ImageFilter.MinFilter(px)).filter(ImageFilter.MaxFilter(px))
    return np.asarray(im) > 127


def run_at(row, x):
    """[x0, x1) of the opaque run in `row` that contains x, or the nearest run within reach; None if the row is empty."""
    xs = np.where(row)[0]
    if len(xs) == 0:
        return None
    if not row[x]:
        x = int(xs[np.argmin(np.abs(xs - x))])
    x0 = x
    while x0 > 0 and row[x0 - 1]:
        x0 -= 1
    x1 = x
    while x1 < len(row) - 1 and row[x1 + 1]:
        x1 += 1
    return x0, x1 + 1


def auto_crop(a):
    """Square [x, y, side] head-and-shoulders crop for a standing humanoid, plus diagnostics."""
    m = P.mask_of(a)
    core_w, core_h = P.core_metrics(m)
    b = P.bbox(m)
    mo = opened(m)
    bh = b[3] - b[1]
    # torso axis: columns carrying >=30 % of the bbox height (legs + torso), weighted by their mass
    colsum = mo.sum(axis=0).astype(np.float32)
    core_cols = colsum >= 0.30 * bh
    xs = np.arange(m.shape[1])
    cx = float((xs * colsum * core_cols).sum() / max((colsum * core_cols).sum(), 1)) if core_cols.any() else (b[0] + b[2]) / 2
    band = int(BAND_K * core_h)
    x0b, x1b = int(max(0, cx - band)), int(min(m.shape[1], cx + band))
    need = max(6, int(0.055 * core_h))
    head_top = None
    for y in range(b[1], b[3]):
        r = run_at(mo[y], int(round(cx)))
        if r is None:
            continue
        ov = min(r[1], x1b) - max(r[0], x0b)
        if ov >= need:
            head_top = y
            break
    if head_top is None:
        head_top = b[1]
    # head centre: the runs through the axis over the top 13 % of the core height (skull + face)
    hs = []
    for y in range(head_top, min(m.shape[0], head_top + int(0.13 * core_h))):
        r = run_at(mo[y], int(round(cx)))
        if r is None:
            continue
        r0, r1 = max(r[0], x0b), min(r[1], x1b)
        if r1 > r0:
            hs.append((r0 + r1) / 2)
    hx = float(np.median(hs)) if hs else cx
    S = SIDE_K * core_h
    return hx, head_top, S, dict(cx=cx, core_h=core_h)


def crop_for(name, a):
    ov = OVERRIDES.get(name, {})
    if 'crop' in ov:
        x, y, s = ov['crop']
        return [int(x), int(y), int(s), int(s)], False
    hx, top, S, _ = auto_crop(a)
    S *= ov.get('k', 1.0)
    x = hx - S / 2 + ov.get('dx', 0.0) * S
    y = top - TOP_K * S + ov.get('dy', 0.0) * S
    s = int(round(S))
    return [int(round(x)), int(round(y)), s, s], True


def cut(a, crop):
    """Crop with transparent padding where the square leaves the source frame."""
    x, y, w, h = crop
    out = np.zeros((h, w, 4), np.float32)
    H, W = a.shape[:2]
    sx0, sy0, sx1, sy1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0 - y:sy1 - y, sx0 - x:sx1 - x] = a[sy0:sy1, sx0:sx1]
    return out


def render(a, crop, size):
    c = cut(a, crop)
    # leave a 1-px ring of room for the ink outline inside the frame: render the art at size-2 and pad
    inner = size - 2
    level = 0 if crop[2] <= inner * 2.4 else 1
    img = P.resize_premul(c, inner, inner, level=level)
    img = np.pad(img, ((1, 1), (1, 1), (0, 0)))
    # the art is cut by the crop's bottom/sides: extend the opaque edge rows into the pad so the ink ring never draws
    # a fake outline along the frame's cut edges (only the silhouette's own edges get ink)
    for sl_dst, sl_src in (((-1, slice(None)), (-2, slice(None))), ((slice(None), 0), (slice(None), 1)),
                           ((slice(None), -1), (slice(None), -2))):
        img[sl_dst] = img[sl_src]
    img = P.outline(img, px=1)
    return img


def build(name):
    a = load_idle(name)
    meta = sheet_meta(name)
    flip = bool((meta.get('rowFlip') or [False])[0])
    if meta.get('cond'):
        a = apply_cond(a, meta['cond'])
    crop, auto = crop_for(name, a)
    if flip:
        a = a[:, ::-1].copy()
        crop = [a.shape[1] - crop[0] - crop[2], crop[1], crop[2], crop[3]]
    os.makedirs(OUT, exist_ok=True)
    imgs = {}
    for s in SIZES:
        img = render(a, crop, s)
        imgs[s] = img
        fn = f'{name}.png' if s == 96 else f'{name}@{s}.png'
        Image.fromarray(img, 'RGBA').save(os.path.join(OUT, fn), optimize=True)
    return dict(crop=crop, src=f'/portraits/{name}.png', src48=f'/portraits/{name}@48.png', flip=flip, auto=auto), imgs, a


def contact_sheet(results, path):
    names = list(results)
    cols = 8
    cw, ch = 96 + 48 + 18, 96 + 22
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * cw + 8, rows * ch + 8), (24, 26, 34, 255))
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        x, y = 8 + (i % cols) * cw, 8 + (i // cols) * ch
        # slate-blue frame like the HUD card, khaki for the 48 (campaign parchment)
        for yy in range(96):
            t = yy / 95
            d.line([(x, y + yy), (x + 95, y + yy)], fill=(int(58 + 30 * t), int(72 + 26 * t), int(112 + 28 * t), 255))
        d.rectangle([x + 100, y, x + 147, y + 47], fill=(180, 160, 118, 255))
        img96 = Image.fromarray(results[n][1][96], 'RGBA')
        img48 = Image.fromarray(results[n][1][48], 'RGBA')
        sheet.alpha_composite(img96, (x, y))
        sheet.alpha_composite(img48, (x + 100, y))
        # eye-line guide (40 %) as two ticks on the frame edge
        d.line([(x - 3, y + 38), (x - 1, y + 38)], fill=(255, 80, 80, 255))
        d.text((x, y + 97), n[:22], fill=(220, 220, 220, 255))
    sheet.save(path)


def debug_sheet(results, path):
    names = list(results)
    cols = 11
    W, H = 160, 256
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * W, rows * (H + 12)), (40, 50, 70, 255))
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        info, _, a = results[n]
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA').resize((W, H))
        x, y = (i % cols) * W, (i // cols) * (H + 12)
        sheet.alpha_composite(im, (x, y))
        cx, cy, cw, chh = info['crop']
        d.rectangle([x + cx / 2, y + cy / 2, x + (cx + cw) / 2, y + (cy + chh) / 2],
                    outline=(80, 255, 120, 255) if info['auto'] else (255, 200, 60, 255))
        d.text((x + 2, y + H), n[:24], fill=(255, 255, 255, 255))
    sheet.save(path)


JS = os.path.join(ROOT, 'src', 'units', 'portraits.js')


def write_js_sheet_list(names):
    """Regenerate the SHEETS set between the @portraits-begin/end markers of src/units/portraits.js, so portraitUrl()
    can answer 'is there a portrait?' synchronously without fetching index.json."""
    try:
        src = open(JS).read()
    except OSError:
        return
    a, b = src.find('// @portraits-begin'), src.find('// @portraits-end')
    if a < 0 or b < 0:
        return
    items, line, lines = [f"'{n}'" for n in sorted(names)], '  ', []
    for it in items:
        if len(line) + len(it) + 2 > 118:
            lines.append(line.rstrip()); line = '  '
        line += it + ', '
    lines.append(line.rstrip())
    block = '// @portraits-begin\nconst SHEETS = new Set([\n' + '\n'.join(lines) + '\n]);\n'
    new = src[:a] + block + src[b:]
    if new != src:
        open(JS, 'w').write(new)


def main():
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    all_names = sorted(P.roster_sizes())
    names = args or all_names
    results = {}
    for n in names:
        info, imgs, a = build(n)
        results[n] = (info, imgs, a)
        print(f'{n}: crop {info["crop"]} {"auto" if info["auto"] else "override"}{" flip" if info["flip"] else ""}')
    # index.json always describes every portrait on disk (a partial run merges into the existing index)
    idx_path = os.path.join(OUT, 'index.json')
    try:
        index = json.load(open(idx_path))
    except (OSError, ValueError):
        index = {}
    for n, (info, _, _) in results.items():
        index[n] = info
    with open(idx_path, 'w') as f:   # one line per sheet
        f.write('{\n' + ',\n'.join(f' {json.dumps(k)}: {json.dumps(v)}' for k, v in sorted(index.items())) + '\n}\n')
    write_js_sheet_list([n for n in index if os.path.exists(os.path.join(OUT, n + '.png'))])
    os.makedirs(SHOTS, exist_ok=True)
    contact_sheet({n: results[n] for n in names}, os.path.join(SHOTS, 'sheet.png'))
    if '--debug' in sys.argv:
        debug_sheet(results, os.path.join(SHOTS, 'debug.png'))
    print(f'{len(results)} portraits -> {OUT}; contact sheet {os.path.join(SHOTS, "sheet.png")}')


if __name__ == '__main__':
    main()
