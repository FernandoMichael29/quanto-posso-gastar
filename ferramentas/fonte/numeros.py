"""
Redesenha números da Pixelify Sans que, em tamanho grande, se confundem com
letras:

  5  tinha o canto de cima arredondado e o braço curvo — lia como "S".
     Novo: barra de cima reta, com quina em cima à esquerda (o que separa do S),
     haste da esquerda até o meio e barriga como a do 3.
  2  era um "S" espelhado (barras retas ligadas por hastes). Novo: alto
     arredondado como o do 3, descida em degraus na diagonal e barra de baixo
     reta de ponta a ponta, com as duas quinas — o desenho clássico do 2.

Cada número é feito de retângulos sobrepostos nas coordenadas que o 3 e o E
já usam, no peso 400 e no 700, então o eixo de peso (400–700) continua
funcionando: as variações do 700 são calculadas ponto a ponto.

    PYTHONPATH=ferramentas/fonte/shim python3 ferramentas/fonte/numeros.py \\
        src/assets/fonts/pixelify-sans.woff2 src/assets/fonts/pixelify-sans.woff2

Precisa de fontTools (pip install fonttools). O shim/ faz o papel do pacote
brotli usando o Node, para quem não consegue instalar o brotli do Python.
Rodar de novo na fonte já corrigida não estraga nada: cada número é trocado inteiro.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables.TupleVariation import TupleVariation

# coordenada no peso 400 → a mesma no peso 700 (tiradas do 3, do E e do 5 original)
X = {60: 61, 151: 149, 161: 188, 241: 237, 251: 276, 333: 326, 343: 365, 423: 414, 433: 453, 525: 542}
Y = {-12: -11, 78: 74, 88: 125, 169: 160, 179: 211, 260: 246, 270: 297, 350: 331, 359: 381,
     440: 416, 530: 501, 540: 552, 631: 638}

NUMEROS = {            # glifo → retângulos (x0, y0, x1, y1) no peso 400
    'five': [
        (60, 530, 525, 631),   # barra de cima, reta de ponta a ponta
        (60, 260, 161, 631),   # haste da esquerda, do topo até o meio
        (60, 260, 433, 359),   # barra do meio
        (423, 78, 525, 270),   # descida da direita (canto de cima arredondado, como no 3)
        (151, -12, 433, 88),   # barra de baixo
        (60, 78, 161, 179),    # pontinha de baixo à esquerda
    ],
    'two': [
        (151, 530, 433, 631),  # alto arredondado, como o do 3
        (60, 440, 161, 540),   # pontinha de cima à esquerda
        (423, 350, 525, 540),  # descida da direita até o meio
        (333, 260, 433, 359),  # diagonal, degrau 1
        (241, 169, 343, 270),  # diagonal, degrau 2
        (151, 78, 251, 179),   # diagonal, degrau 3
        (60, -12, 525, 88),    # barra de baixo reta, com as duas quinas
    ],
}


def pontos(r, mx=lambda v: v, my=lambda v: v):
    x0, y0, x1, y1 = r
    # sentido horário (contorno de fora no TrueType)
    return [(mx(x0), my(y0)), (mx(x0), my(y1)), (mx(x1), my(y1)), (mx(x1), my(y0))]


def redesenhar(f, nome, retangulos):
    glyf, gvar = f['glyf'], f['gvar']
    fantasmas = gvar.variations[nome][0].coordinates[-4:]   # o avanço muda com o peso
    pen = TTGlyphPen(None)
    p400, p700 = [], []
    for r in retangulos:
        a = pontos(r); b = pontos(r, X.__getitem__, Y.__getitem__)
        pen.moveTo(a[0]); [pen.lineTo(p) for p in a[1:]]; pen.closePath()
        p400 += a; p700 += b
    g = pen.glyph()
    g.flags[0] |= 0x40          # OVERLAP_SIMPLE: contornos sobrepostos de propósito
    glyf[nome] = g
    g.recalcBounds(glyf)
    deltas = [(bx - ax, by - ay) for (ax, ay), (bx, by) in zip(p400, p700)] + list(fantasmas)
    gvar.variations[nome] = [TupleVariation({'wght': (0.0, 1.0, 1.0)}, deltas)]
    f['hmtx'][nome] = (f['hmtx'][nome][0], g.xMin)
    return len(p400)


if __name__ == '__main__':
    f = TTFont(sys.argv[1])
    for nome, rets in NUMEROS.items():
        print(nome, 'redesenhado:', len(rets), 'retângulos,', redesenhar(f, nome, rets), 'pontos')
    f.flavor = 'woff2'
    f.save(sys.argv[2])
