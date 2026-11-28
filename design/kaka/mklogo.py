import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
f = TTFont('fonts/IBMPlexMono-Medium.ttf'); gs = f.getGlyphSet(); cmap = f.getBestCmap()
def glyph(ch):
    n = cmap[ord(ch)]; p = SVGPathPen(gs); gs[n].draw(p)
    b = BoundsPen(gs); gs[n].draw(b); return p.getCommands(), b.bounds
ADV = 600
def place(ch, x):  # 폰트 좌표(위가 +)를 SVG(아래가 +)로 뒤집는다
    d, _ = glyph(ch); return f'<path transform="translate({x} 0) scale(1 -1)" d="{d}"/>'
_, kb = glyph('k'); top = kb[3]
GT = 0          # > 위치
K0 = 780        # kaká 시작
CUR_X = K0 + 4*ADV + 50; CUR_W = 500; CUR_TOP = -top; CUR_BOT = 110
pad = 40
x0 = GT + 40 - pad; x1 = CUR_X + CUR_W + pad; y0 = -top - pad; y1 = CUR_BOT + pad
def logo(ink, gray, acc, blink=True):
    anim = '''<style>.c{animation:b 1.1s steps(1) 3}@keyframes b{50%{opacity:0}}@media (prefers-reduced-motion:reduce){.c{animation:none}}</style>''' if blink else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0:.0f} {x1-x0} {y1-y0:.0f}" role="img" aria-label="kaká">{anim}'
      f'<g fill="{gray}">{place(">", GT)}</g>'
      f'<g fill="{ink}">{place("k", K0)}{place("a", K0+ADV)}{place("k", K0+2*ADV)}</g>'
      f'<g fill="{acc}">{place("á", K0+3*ADV)}</g>'
      f'<rect class="c" fill="{acc}" x="{CUR_X}" y="{CUR_TOP:.0f}" width="{CUR_W}" height="{CUR_BOT-CUR_TOP:.0f}"/></svg>')
open('final/logo-light.svg','w').write(logo('#1d1f22','#9a9a9c','#2f6a4f'))
open('final/logo-dark.svg','w').write(logo('#ecebe6','#74757a','#6fb08d'))
# 파비콘: 어두운 상자 + 회색 > + 초록 커서 (32 기준을 1000 단위로)
d,_ = glyph('>')
fav = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1d1f22"/>'
  f'<path transform="translate(2.6 22.6) scale(.026 -.026)" fill="#8a8b8f" d="{d}"/>'
  f'<rect x="17.5" y="7.5" width="7.5" height="17" fill="#6fb08d"/></svg>')
open('final/favicon.svg','w').write(fav)
print('ok', top)
