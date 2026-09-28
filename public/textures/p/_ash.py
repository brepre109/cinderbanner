#!/usr/bin/env python3
# Ashfall skin (map-art owner, Ashfall Barrow). Derives the *_ash painted set from the shared painted set in this
# directory: every texel keeps its luminance structure (the brushwork), the hue is re-pointed at a dead ash/peat palette,
# and the turf/earth/rock tops get a tileable dusting of pale ash. Run: python3 public/textures/p/_ash.py
# Only terrain.js SKINS.ashfall references these files, so no other map can see them.
import zlib
import numpy as np
from PIL import Image
from pathlib import Path
HERE = Path(__file__).parent
LUMA = np.array([0.2126, 0.7152, 0.0722])

def tile_noise(shape, scale, seed):
    """Periodic low-pass noise in [0,1] (FFT filtering is circular, so the result tiles exactly)."""
    rng = np.random.default_rng(seed)
    n = rng.standard_normal(shape)
    fy = np.fft.fftfreq(shape[0])[:, None] * shape[0]; fx = np.fft.fftfreq(shape[1])[None, :] * shape[1]
    f = np.exp(-(fx ** 2 + fy ** 2) / (2 * scale ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(n) * f))
    out = (out - out.min()) / (out.max() - out.min() + 1e-9)
    return out

# name: (source, target mean sRGB, keep-chroma, ash dusting amount)
JOBS = {
    'grass_ash':        ('grass',        (124, 120, 96), 0.16, 0.34),
    'grass2_ash':       ('grass2',       (130, 121, 96), 0.16, 0.30),
    'grass_dark_ash':   ('grass_dark',   (92, 80, 74),   0.10, 0.22),
    'dirt_ash':         ('dirt',         (80, 66, 55),   0.10, 0.14),
    'dirt2_ash':        ('dirt2',        (88, 73, 60),   0.10, 0.16),
    'rock_top_ash':     ('rock_top',     (132, 128, 120), 0.08, 0.24),
    'flag_ash':         ('flag',         (122, 118, 110), 0.10, 0.16),
    'earth_side_ash':   ('earth_side',   (96, 80, 66),   0.12, 0.0),
    'rock_side_ash':    ('rock_side',    (128, 122, 114), 0.08, 0.0),
    'stone_side_ash':   ('stone_side',   (104, 100, 94), 0.10, 0.0),
    'fringe_grass_ash': ('fringe_grass', (96, 92, 70),   0.14, 0.0),
    'fringe_earth_ash': ('fringe_earth', (78, 65, 52),   0.12, 0.0),
    'spill_grass_ash':  ('spill_grass',  (108, 104, 82), 0.14, 0.0),
    'spill_dirt_ash':   ('spill_dirt',   (80, 66, 55),   0.10, 0.0),
    'sc_tufts_ash':     ('sc_tufts',     (138, 124, 88), 0.18, 0.0),   # dead straw
    'sc_moss_ash':      ('sc_moss',      (168, 166, 160), 0.06, 0.0),  # moss becomes drifted ash
    'sc_weeds_ash':     ('sc_weeds',     (120, 108, 80), 0.14, 0.0),
    'sc_bare_ash':      ('sc_bare',      (64, 55, 48),   0.10, 0.0),   # scorched / peat-black scars
    'wetband_ash':      ('wetband',      (46, 40, 34),   0.10, 0.0),
    'bed_ash':          ('bed',          (44, 38, 30),   0.10, 0.0),
}

def srgb2lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lin2srgb(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)

for name, (src, target, keep, ash) in JOBS.items():
    im = np.array(Image.open(HERE / f'{src}.png').convert('RGBA')).astype(np.float64) / 255
    rgb, a = im[..., :3], im[..., 3]
    lin = srgb2lin(rgb)
    L = lin @ LUMA
    w = a > 0.5 if (a < 0.99).any() else np.ones_like(L, bool)
    Lm = L[w].mean()
    tl = srgb2lin(np.array(target) / 255.0)
    tL = tl @ LUMA
    # luminance structure of the source, re-hued to the target, with a trace of the source chroma kept
    rel = (L / max(Lm, 1e-6))[..., None]
    base = tl[None, None, :] * rel
    chroma = lin - L[..., None]
    out = base + chroma * keep * (tL / max(Lm, 1e-6))
    if ash > 0:
        h, wd = L.shape
        blot = tile_noise((h, wd), max(2.0, h / 20), zlib.crc32(name.encode()) & 0xffff)
        grain = tile_noise((h, wd), max(4.0, h / 5), (zlib.crc32(name.encode()) >> 8) & 0xffff)
        # soft drifts where the blot field is high, and inside/around them CRISP single-texel flecks (a hashed
        # threshold, so the dusting reads as painted pixels at 64 texels/tile rather than as a blur)
        drift = np.clip((blot - 0.56) / 0.22, 0, 1) * np.clip((grain - 0.30) / 0.4, 0, 1)
        rnd = np.random.default_rng(zlib.crc32(name.encode()) ^ 0x5a5a).random((h, wd))
        fleck = (rnd < 0.03 + 0.30 * np.clip((blot - 0.40) / 0.4, 0, 1)).astype(float)
        m = np.round(drift * 2) / 2 * 0.45 + fleck * 0.8
        m = np.clip(m, 0, 1)
        pale = srgb2lin(np.array([176, 174, 168]) / 255.0) * (0.85 + 0.3 * rel)
        out = out * (1 - m[..., None] * ash) + pale * (m[..., None] * ash)
    res = np.concatenate([lin2srgb(out), a[..., None]], -1)
    Image.fromarray((np.clip(res, 0, 1) * 255 + 0.5).astype(np.uint8)).save(HERE / f'{name}.png')
    print(name, (lin2srgb(out)[w].mean(0) * 255).round(1))
