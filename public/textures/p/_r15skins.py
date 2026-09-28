#!/usr/bin/env python3
# R15 story skins (maps owner). Derives three mood-keyed painted sets from the shared painted set in this directory,
# the same way _ash.py derives the ashfall skin: every texel keeps its luminance structure (the brushwork), the hue is
# re-pointed at the skin's palette, and `con` scales the contrast around the mean (snow is a soft, low-contrast
# surface -- a grass stroke pattern at full contrast reads as white grass, not snow).
#   *_snow   Greyspine / the Northreach: snowfield, trodden slush road, frosted flags, snow-capped rock, cornices
#   *_crypt  The Undercroft: grimed crypt flagstone, grave earth, black silt, soot ashlar
#   *_nave   Aurelmont cathedral: a painted marble checker floor, a crimson carpet runner (from the dark turf), pale
#            limestone walls
# plus the three wall paintings props.js cryptwall uses: crypt_wall, nave_wall, nave_trim.
# Run: python3 public/textures/p/_r15skins.py   Only terrain.js SKINS (snow / crypt / cathedral) and cryptwall read these.
import zlib
import numpy as np
from PIL import Image
from pathlib import Path
HERE = Path(__file__).parent
LUMA = np.array([0.2126, 0.7152, 0.0722])

def srgb2lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lin2srgb(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)

def tile_noise(shape, scale, seed):
    rng = np.random.default_rng(seed)
    n = rng.standard_normal(shape)
    fy = np.fft.fftfreq(shape[0])[:, None] * shape[0]; fx = np.fft.fftfreq(shape[1])[None, :] * shape[1]
    f = np.exp(-(fx ** 2 + fy ** 2) / (2 * scale ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(n) * f))
    return (out - out.min()) / (out.max() - out.min() + 1e-9)

def recolor(src, target, keep=0.1, con=1.0, name='x', frost=0.0, frost_col=(236, 240, 248), grime=0.0, grime_col=(30, 28, 26)):
    im = np.array(Image.open(HERE / f'{src}.png').convert('RGBA')).astype(np.float64) / 255
    rgb, a = im[..., :3], im[..., 3]
    lin = srgb2lin(rgb); L = lin @ LUMA
    w = a > 0.5 if (a < 0.99).any() else np.ones_like(L, bool)
    Lm = L[w].mean()
    tl = srgb2lin(np.array(target) / 255.0); tL = tl @ LUMA
    rel = (L / max(Lm, 1e-6))
    rel = 1 + (rel - 1) * con
    out = tl[None, None, :] * rel[..., None] + (lin - L[..., None]) * keep * (tL / max(Lm, 1e-6))
    h, wd = L.shape
    seed = zlib.crc32(name.encode()) & 0xffff
    if frost > 0:   # crisp single-texel sparkle + soft drifts, the _ash.py recipe in white
        blot = tile_noise((h, wd), max(2.0, h / 16), seed)
        rnd = np.random.default_rng(seed ^ 0x77).random((h, wd))
        m = np.clip((blot - 0.5) / 0.3, 0, 1) * 0.5 + (rnd < 0.025) * 0.7
        pale = srgb2lin(np.array(frost_col) / 255.0)
        out = out * (1 - m[..., None] * frost) + pale * (m[..., None] * frost)
    if grime > 0:
        blot = tile_noise((h, wd), max(2.0, h / 10), seed ^ 0x3131)
        m = np.clip((blot - 0.55) / 0.3, 0, 1)
        dark = srgb2lin(np.array(grime_col) / 255.0)
        out = out * (1 - m[..., None] * grime) + dark * (m[..., None] * grime)
    res = np.concatenate([lin2srgb(out), a[..., None]], -1)
    return (np.clip(res, 0, 1) * 255 + 0.5).astype(np.uint8)

def save(arr, name):
    Image.fromarray(arr).save(HERE / f'{name}.png'); print(name, arr[..., :3].reshape(-1, 3).mean(0).round(1))

# ---------------------------------------------------------------- snow
SNOW = {
    'grass_snow':        ('grass',        (226, 232, 242), 0.00, 0.32, 0.45),
    'grass2_snow':       ('grass2',       (220, 227, 238), 0.00, 0.34, 0.40),
    'grass_dark_snow':   ('grass_dark',   (150, 160, 150), 0.12, 0.70, 0.55),   # turf showing through a thin crust
    'dirt_snow':         ('dirt',         (132, 120, 112), 0.10, 0.80, 0.25),   # the trodden road: slush over mud
    'dirt2_snow':        ('dirt2',        (140, 128, 118), 0.10, 0.80, 0.25),
    'flag_snow':         ('flag',         (176, 182, 194), 0.05, 0.85, 0.35),
    'rock_top_snow':     ('rock_top',     (206, 212, 224), 0.04, 0.50, 0.40),
    'bed_snow':          ('bed',          (120, 132, 146), 0.05, 0.60, 0.20),   # a frozen stream bed
    'earth_side_snow':   ('earth_side',   (108, 96, 86),   0.10, 1.00, 0.00),
    'rock_side_snow':    ('rock_side',    (126, 122, 118), 0.06, 1.00, 0.10),
    'stone_side_snow':   ('stone_side',   (132, 128, 124), 0.06, 1.00, 0.08),
    'fringe_grass_snow': ('fringe_grass', (236, 240, 248), 0.00, 0.40, 0.00),   # the cliff-lip moss becomes a snow cornice
    'fringe_earth_snow': ('fringe_earth', (200, 206, 216), 0.00, 0.50, 0.00),
    'spill_grass_snow':  ('spill_grass',  (226, 232, 242), 0.00, 0.40, 0.00),
    'spill_dirt_snow':   ('spill_dirt',   (140, 128, 120), 0.08, 0.80, 0.00),
    'sc_tufts_snow':     ('sc_tufts',     (150, 136, 104), 0.20, 1.00, 0.00),   # dead straw poking through
    'sc_moss_snow':      ('sc_moss',      (244, 246, 252), 0.00, 0.50, 0.00),   # moss patches become drifts
    'sc_weeds_snow':     ('sc_weeds',     (118, 110, 92),  0.12, 1.00, 0.00),
    'sc_bare_snow':      ('sc_bare',      (110, 100, 96),  0.10, 1.00, 0.00),   # bare frozen earth
    'wetband_snow':      ('wetband',      (170, 196, 214), 0.00, 0.70, 0.00),   # shore ice
}
for name, (src, target, keep, con, frost) in SNOW.items():
    save(recolor(src, target, keep, con, name, frost=frost), name)

# ---------------------------------------------------------------- crypt
CRYPT = {
    'flag_crypt':        ('flag',        (92, 88, 84),  0.06, 1.10, 0.30),
    'dirt_crypt':        ('dirt',        (74, 62, 52),  0.10, 1.00, 0.20),
    'dirt2_crypt':       ('dirt2',       (80, 66, 56),  0.10, 1.00, 0.20),
    'grass_crypt':       ('flag',        (74, 86, 62),  0.06, 1.00, 0.30),     # moss-slick stone where 'g' is painted
    'grass2_crypt':      ('flag',        (78, 88, 66),  0.06, 1.00, 0.30),
    'grass_dark_crypt':  ('flag',        (62, 70, 54),  0.06, 1.00, 0.30),
    'rock_top_crypt':    ('rock_top',    (96, 92, 88),  0.05, 1.00, 0.25),
    'bed_crypt':         ('bed',         (34, 36, 30),  0.05, 1.00, 0.00),
    'stone_side_crypt':  ('stone_side',  (98, 92, 88),  0.06, 1.05, 0.25),
    'rock_side_crypt':   ('rock_side',   (92, 88, 84),  0.05, 1.00, 0.20),
    'earth_side_crypt':  ('earth_side',  (78, 66, 56),  0.08, 1.00, 0.10),
    'fringe_grass_crypt': ('fringe_grass', (58, 70, 46), 0.10, 1.00, 0.00),
    'fringe_earth_crypt': ('fringe_earth', (70, 60, 50), 0.08, 1.00, 0.00),
    'spill_grass_crypt': ('spill_grass', (70, 80, 60),  0.08, 1.00, 0.00),
    'spill_dirt_crypt':  ('spill_dirt',  (74, 62, 52),  0.08, 1.00, 0.00),
    'sc_tufts_crypt':    ('sc_tufts',    (120, 112, 96), 0.10, 1.00, 0.00),    # bone-pale rubble
    'sc_moss_crypt':     ('sc_moss',     (56, 72, 44),  0.12, 1.00, 0.00),
    'sc_weeds_crypt':    ('sc_weeds',    (60, 66, 50),  0.10, 1.00, 0.00),
    'sc_bare_crypt':     ('sc_bare',     (40, 36, 34),  0.08, 1.00, 0.00),
    'wetband_crypt':     ('wetband',     (30, 34, 30),  0.05, 1.00, 0.00),
}
for name, (src, target, keep, con, grime) in CRYPT.items():
    save(recolor(src, target, keep, con, name, grime=grime), name)

# ---------------------------------------------------------------- cathedral nave
NAVE = {
    'grass_dark_nave':   ('grass_dark',  (128, 26, 30),  0.00, 0.45, 0.0),    # the crimson carpet runner
    'grass_nave':        ('grass',       (128, 26, 30),  0.00, 0.45, 0.0),
    'grass2_nave':       ('grass2',      (128, 26, 30),  0.00, 0.45, 0.0),
    'dirt_nave':         ('flag',        (156, 146, 130), 0.05, 0.80, 0.0),   # worn limestone flags
    'dirt2_nave':        ('flag',        (150, 140, 124), 0.05, 0.80, 0.0),
    'rock_top_nave':     ('rock_top',    (176, 170, 156), 0.05, 0.70, 0.0),
    'stone_side_nave':   ('stone_side',  (170, 162, 146), 0.08, 0.85, 0.0),
    'rock_side_nave':    ('rock_side',   (150, 142, 128), 0.06, 0.90, 0.0),
    'earth_side_nave':   ('stone_side',  (150, 142, 128), 0.06, 0.90, 0.0),
    'bed_nave':          ('bed',         (60, 70, 76),   0.05, 1.00, 0.0),
    'fringe_grass_nave': ('fringe_earth', (150, 142, 128), 0.00, 0.60, 0.0),
    'fringe_earth_nave': ('fringe_earth', (150, 142, 128), 0.00, 0.60, 0.0),
    'spill_grass_nave':  ('spill_dirt',  (150, 142, 128), 0.00, 0.60, 0.0),
    'spill_dirt_nave':   ('spill_dirt',  (150, 142, 128), 0.00, 0.60, 0.0),
    'sc_tufts_nave':     ('sc_pebbles',  (150, 142, 128), 0.00, 0.60, 0.0),
    'sc_moss_nave':      ('sc_pebbles',  (150, 142, 128), 0.00, 0.60, 0.0),
    'sc_weeds_nave':     ('sc_pebbles',  (150, 142, 128), 0.00, 0.60, 0.0),
    'sc_bare_nave':      ('sc_pebbles',  (140, 132, 118), 0.00, 0.60, 0.0),
    'wetband_nave':      ('wetband',     (60, 70, 76),   0.05, 1.00, 0.0),
}
for name, (src, target, keep, con, _) in NAVE.items():
    save(recolor(src, target, keep, con, name), name)

# the marble checker floor: 128 px = 2 tiles, each tile four 32 px squares, cream and verd-antique, veined, with a
# 1 px grout line and a lit top-left bevel so the squares read as laid stone at 1x
def marble():
    # one square per TILE (64 px), cream and a warm rose-grey: a checker at half-tile pitch read as a chessboard and
    # fought the move-field overlay; at tile pitch with a soft value step it reads as laid marble.
    S = 128; P = 64
    cream, rose = np.array([204, 194, 174]) / 255.0, np.array([156, 140, 128]) / 255.0
    vein = tile_noise((S, S), 7, 11); vein2 = tile_noise((S, S), 20, 12); mott = tile_noise((S, S), 3, 13)
    yy, xx = np.mgrid[0:S, 0:S]
    sq = ((xx // P) + (yy // P)) % 2
    base = np.where(sq[..., None] == 0, cream, rose)
    v = np.abs(np.sin((vein * 9 + vein2 * 5 + xx * 0.02) * np.pi))
    veins = np.clip(1 - v / 0.10, 0, 1)
    col = base * (0.93 + 0.12 * mott)[..., None] * (1 - 0.16 * veins[..., None])
    gx, gy = xx % P, yy % P
    inner = (gx % 32 == 0) | (gy % 32 == 0)            # a faint quarter joint inside each tile
    col[inner] *= 0.9
    col[(gx == 0) | (gy == 0)] *= 0.62
    col[((gx == 1) | (gy == 1)) & (gx != 0) & (gy != 0)] *= 1.08
    col[(gx == P - 1) | (gy == P - 1)] *= 0.84
    return (np.clip(col, 0, 1) * 255 + 0.5).astype(np.uint8)
save(marble(), 'flag_nave')

# the interior wall paintings (props.js cryptwall): 64x64 ashlar, 1 world unit per repeat at unit 0.75
save(recolor('stone_side', (88, 82, 78), 0.06, 1.10, 'crypt_wall', grime=0.45)[..., :3], 'crypt_wall')
save(recolor('stone_side', (156, 146, 132), 0.08, 0.80, 'nave_wall')[..., :3], 'nave_wall')
save(recolor('rock_side', (132, 124, 110), 0.06, 0.85, 'nave_trim')[..., :3], 'nave_trim')
