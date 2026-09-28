#!/usr/bin/python3
"""Build the game's bitmap-style UI face ("Cinder Pixel") from a free bold serif.
A source TTF is rasterised WITHOUT anti-aliasing at a small pixel size, optionally
dilated 1px for classic-like weight, and every ink pixel becomes a square contour in a
TrueType font (1 bitmap px = upem/size units, so the face is pixel-crisp at integer
multiples of its base size). Sources: DejaVu (Bitstream Vera licence) / Liberation (OFL).
usage: build_pixelfont.py <src.ttf> <px> <out.ttf> [--dilate] [--name NAME]
"""
import sys
from PIL import Image, ImageDraw, ImageFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

src, px, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
dilate = '--dilate' in sys.argv
name = sys.argv[sys.argv.index('--name') + 1] if '--name' in sys.argv else 'Cinder Pixel'
PX = 64; UPEM = px * PX
font = ImageFont.truetype(src, px); asc, desc = font.getmetrics()
chars = [chr(c) for c in range(32, 127)] + list('×·–—→°…‘’“”«»é')

def raster(ch):
    W = px * 3; H = asc + desc + 2
    im = Image.new('1', (W, H), 0); d = ImageDraw.Draw(im); d.fontmode = '1'
    d.text((px, 0), ch, font=font, fill=1)
    p = im.load(); pix = set()
    for y in range(H):
        for x in range(W):
            if p[x, y]: pix.add((x - px, y))
    if dilate: pix |= {(x + 1, y) for (x, y) in pix}
    return pix

glyphs, metrics, cmap, order = {}, {}, {}, ['.notdef']
pen = TTGlyphPen(None); glyphs['.notdef'] = pen.glyph(); metrics['.notdef'] = (px * PX // 2, 0)
for ch in chars:
    gname = 'space' if ch == ' ' else 'uni%04X' % ord(ch)
    pix = raster(ch); pen = TTGlyphPen(None)
    xs = [x for x, _ in pix]; x0 = min(xs) if xs else 0
    for (x, y) in sorted(pix):
        X = (x - x0) * PX; Y = (asc - y) * PX  # top edge of the pixel row, baseline at asc
        pen.moveTo((X, Y)); pen.lineTo((X + PX, Y)); pen.lineTo((X + PX, Y - PX)); pen.lineTo((X, Y - PX)); pen.closePath()
    g = pen.glyph(); glyphs[gname] = g; order.append(gname); cmap[ord(ch)] = gname
    ink = (max(xs) - x0 + 1) if xs else 0
    adv = max(int(round(font.getlength(ch))), ink + 1) if ch != ' ' else max(2, int(round(font.getlength(ch))))
    metrics[gname] = (adv * PX, 0)

fb = FontBuilder(UPEM, isTTF=True)
fb.setupGlyphOrder(order); fb.setupCharacterMap(cmap); fb.setupGlyf(glyphs); fb.setupHorizontalMetrics(metrics)
fb.setupHorizontalHeader(ascent=asc * PX, descent=-desc * PX)
fb.setupNameTable({'familyName': name, 'styleName': 'Bold', 'fullName': name + ' Bold', 'psName': name.replace(' ', '') + '-Bold', 'copyright': 'Bitmap derivative of a free bold serif; same licence as the source.'})
fb.setupOS2(sTypoAscender=asc * PX, sTypoDescender=-desc * PX, usWinAscent=asc * PX, usWinDescent=desc * PX, usWeightClass=700)
fb.setupPost(); fb.save(out); print('wrote', out, 'upem', UPEM, 'asc', asc, 'desc', desc, 'glyphs', len(order))
