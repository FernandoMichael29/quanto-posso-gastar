"""
Redesenha o "5" da Pixelify Sans, que nessa fonte tem o canto de cima
arredondado e o braço curvo — em número grande ele lê como "S".

O 5 novo: barra de cima reta (canto de cima à esquerda em quina, é o que o
separa do S), haste da esquerda descendo até o meio, barriga como a do 3.
Feito de retângulos sobrepostos nas mesmas coordenadas que o 3 e o E usam,
no peso 400 e no 700, para o eixo de peso continuar funcionando.

    PYTHONPATH=ferramentas/fonte/shim python3 ferramentas/fonte/cinco.py \
        src/assets/fonts/pixelify-sans.woff2 src/assets/fonts/pixelify-sans.woff2

Precisa de fontTools (pip install fonttools). O shim/ faz o papel do pacote
brotli usando o Node, para quem não consegue instalar o brotli do Python.
Rodar de novo na fonte já corrigida não estraga nada: o 5 é trocado inteiro.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables.TupleVariation import TupleVariation

X = {60: 61, 151: 149, 161: 188, 423: 414, 433: 453, 525: 542}
Y = {-12: -11, 78: 74, 88: 125, 179: 211, 260: 246, 270: 297, 350: 331, 359: 381, 530: 501, 540: 552, 631: 638}

RETANGULOS = [            # (x0, y0, x1, y1) no peso 400
    (60, 530, 525, 631),   # barra de cima, reta de ponta a ponta
    (60, 260, 161, 631),   # haste da esquerda, do topo até o meio
    (60, 260, 433, 359),   # barra do meio
    (423, 78, 525, 270),   # descida da direita (canto de cima arredondado, como no 3)
    (151, -12, 433, 88),   # barra de baixo
    (60, 78, 161, 179),    # pontinha de baixo à esquerda
]

def pontos(r, mx=lambda v: v, my=lambda v: v):
    x0, y0, x1, y1 = r
    # sentido horário (contorno de fora no TrueType)
    return [(mx(x0), my(y0)), (mx(x0), my(y1)), (mx(x1), my(y1)), (mx(x1), my(y0))]

f = TTFont(sys.argv[1])
glyf, gvar = f['glyf'], f['gvar']
fantasmas = gvar.variations['five'][0].coordinates[-4:]   # o avanço muda com o peso

pen = TTGlyphPen(None)
p400, p700 = [], []
for r in RETANGULOS:
    a = pontos(r); b = pontos(r, X.get, Y.get)
    pen.moveTo(a[0]); [pen.lineTo(p) for p in a[1:]]; pen.closePath()
    p400 += a; p700 += b
g = pen.glyph()
g.flags[0] |= 0x40          # OVERLAP_SIMPLE: contornos sobrepostos de propósito
glyf['five'] = g
g.recalcBounds(glyf)
deltas = [(bx - ax, by - ay) for (ax, ay), (bx, by) in zip(p400, p700)] + list(fantasmas)
gvar.variations['five'] = [TupleVariation({'wght': (0.0, 1.0, 1.0)}, deltas)]
f['hmtx']['five'] = (f['hmtx']['five'][0], g.xMin)
f.flavor = 'woff2'
f.save(sys.argv[2])
print('5 redesenhado:', len(RETANGULOS), 'retângulos,', len(p400), 'pontos')
