"""
Os 21 ícones de categoria, em pixel art 32x32, tema RPG.

Cada função descreve um item como formas + material; quem decide a cor de
cada pixel é o motor. Para mudar um ícone, mexa aqui e rode:

    python3 ferramentas/icones/gerar.py

Isso refaz src/assets/icones.png e src/lib/icones.js.
"""
import math
from motor import *


def bolsa():
    partes = [
        (elipse(16, 21.5, 10.5, 8.5), 'pano'),            # corpo do saco
        (elipse(16, 9, 6.5, 3.2), 'pano'),                # boca franzida
        (retangulo(12, 9, 19, 12), 'pano'),               # pescoço
        (retangulo(11, 12, 20, 13, 'cil_h'), 'fita'),     # amarração
        (elipse(16, 22, 4.6, 4.6), 'ouro'),               # moeda bordada
        (elipse(25.5, 27.5, 3.6, 2.6), 'ouro'),           # moedas soltas
        (elipse(6.5, 28, 3.2, 2.3), 'ouro'),
    ]
    img, p = desenhar(partes)
    pontos(p, [(16, 20), (16, 21), (16, 22), (16, 23)], RAMPAS['ouro'][1])   # marca da moeda
    pontos(p, [(9, 18), (10, 17)], RAMPAS['pano'][4])                         # brilho do tecido
    return img


def pocao():
    corpo = lambda x, y: y >= 0
    partes = [
        (elipse(16, 21, 9.5, 8.5), 'vidro'),
        (elipse(16, 22, 8.5, 7.5, so=lambda x, y: y >= 18), 'pocao'),
        (retangulo(13, 8, 18, 14), 'vidro'),
        (retangulo(12, 7, 19, 8, 'cil_h'), 'vidro'),
        (retangulo(13, 3, 18, 6), 'madeira'),
    ]
    img, p = desenhar(partes)
    pontos(p, [(10, 16), (10, 17), (11, 15), (12, 14)], RAMPAS['vidro'][4])  # reflexo do vidro
    pontos(p, [(19, 22), (21, 25), (14, 26)], RAMPAS['pocao'][4])           # bolhas
    pontos(p, [(16, 18), (17, 18), (18, 18), (15, 18), (14, 18), (13, 18), (19, 18)], RAMPAS['pocao'][3])  # superfície do líquido
    return img


def coxa():
    partes = [
        (elipse(23.5, 23.5, 5.5, 1.9, 45), 'osso'),
        (elipse(27, 24.5, 2.3, 2.3), 'osso'),
        (elipse(24.5, 27, 2.3, 2.3), 'osso'),
        (elipse(13, 13, 10.5, 8, 45), 'carne'),
    ]
    img, p = desenhar(partes)
    pontos(p, [(8, 10), (9, 9), (10, 8), (7, 12)], RAMPAS['carne'][4])        # gordura brilhando
    pontos(p, [(14, 17), (17, 14), (12, 15)], RAMPAS['carne'][1])             # marcas de grelha
    return img


def bau():
    partes = [
        (retangulo(4, 15, 27, 27, 'plano'), 'madeira'),
        (elipse(16, 15, 12.5, 7.5, so=lambda x, y: y < 15), 'madeira'),
        (retangulo(7, 8, 8, 27, 'cil_v'), 'ouro'),
        (retangulo(23, 8, 24, 27, 'cil_v'), 'ouro'),
        (retangulo(4, 14, 27, 15, 'cil_h'), 'ouro'),
        (retangulo(14, 15, 17, 20, 'plano'), 'ouro'),
    ]
    img, p = desenhar(partes)
    pontos(p, [(15, 17), (16, 17), (15, 18)], CONTORNO)                       # fechadura
    pontos(p, [(11, 21), (12, 21), (19, 23), (20, 23), (11, 25)], RAMPAS['madeira'][1])  # veio da madeira
    return img


def cesta():
    alca = anel(16, 17, 10.5, 12, 2, so=lambda x, y: y < 17)
    partes = [
        (alca, 'madeira'),
        (elipse(12, 13.5, 6.5, 3.2, -18), 'pao'),
        (elipse(21.5, 12.5, 4.2, 4.2), 'pocao'),
        (retangulo(4, 16, 27, 18, 'cil_h'), 'madeira'),
        (faceta([(5, 19), (27, 19), (24, 29), (8, 29)], (-.1, .15, 1)), 'madeira'),
    ]
    img, p = desenhar(partes)
    for y in (22, 25):                                       # trançado
        px(p, [(x, y) for x in range(7, 26) if (x + y) % 3], 'madeira', 1)
    px(p, [(x, 27) for x in range(9, 24) if x % 3 == 0], 'madeira', 1)
    px(p, [(9, 12), (12, 11), (15, 12)], 'pao', 1)            # cortes do pão
    px(p, [(21, 8), (21, 7)], 'madeira', 0)                   # cabo da maçã
    px(p, [(22, 7), (23, 7), (23, 6)], 'verde', 3)            # folha
    px(p, [(19, 10)], 'pocao', 4)
    return img


def bota():
    # pé primeiro e cano na frente: a linha interna entre os dois é o que
    # faz a bota parecer uma peça só, dobrando no tornozelo
    partes = [
        (elipse(18, 22.5, 9.5, 5.8), 'couro'),
        (retangulo(10, 6, 18, 22), 'couro'),
        (retangulo(8, 27, 27, 28, 'cil_h'), 'madeira'),
        (retangulo(9, 4, 19, 6, 'cil_h'), 'ouro'),
        (elipse(6.5, 9, 6, 1.9, -28), 'osso'),
        (elipse(5.5, 12.5, 6.2, 1.9, -8), 'osso'),
        (elipse(6.5, 16, 5.2, 1.8, 12), 'osso'),
    ]
    img, p = desenhar(partes)
    px(p, [(14, 11), (14, 14), (14, 17)], 'ouro', 3)
    px(p, [(23, 20), (24, 21)], 'couro', 4)
    return img


def casinha():
    partes = [
        (retangulo(21, 5, 23, 12, 'cil_v'), 'pedra'),
        (retangulo(7, 15, 24, 27, 'plano'), 'parede'),
        (faceta([(2, 16), (16, 3), (16, 16)], L), 'telhado'),
        (faceta([(16, 3), (30, 16), (16, 16)], R), 'telhado'),
        (retangulo(13, 20, 18, 27, 'plano'), 'madeira'),
        (retangulo(9, 18, 11, 20, 'plano'), 'ouro'),
        (retangulo(20, 18, 22, 20, 'plano'), 'ouro'),
    ]
    img, p = desenhar(partes)
    px(p, [(17, 24)], 'ouro', 4)                              # maçaneta
    for y in (8, 11, 14):                                     # telhas
        px(p, [(x, y) for x in range(4, 29) if x % 3 == 1 and abs(x - 16) < (y - 2)], 'telhado', 1)
    px(p, [(22, 3), (21, 2), (23, 1)], 'pedra', 4)            # fumaça
    return img


def orbe():
    partes = [
        (faceta([(9, 28), (23, 28), (21, 23), (11, 23)], (-.1, -.2, 1)), 'madeira'),
        (retangulo(10, 22, 21, 23, 'cil_h'), 'ouro'),
        (elipse(16, 13.5, 8.8, 8.8), 'cristal'),
    ]
    img, p = desenhar(partes)
    for a in range(0, 360, 24):                               # redemoinho dentro
        r = 4 + a / 120
        x, y = 16 + r * math.cos(math.radians(a)), 14 + r * math.sin(math.radians(a))
        px(p, [(int(x), int(y))], 'cristal', 1 if a % 48 else 4)
    brilho(p, 26, 5); brilho(p, 5, 6, '#7adcf0')
    return img


def ampulheta():
    partes = [
        (retangulo(8, 5, 9, 26, 'cil_v'), 'madeira'),
        (retangulo(22, 5, 23, 26, 'cil_v'), 'madeira'),
        (elipse(16, 10, 6, 5.5, so=lambda x, y: y >= 5.5), 'vidro'),
        (elipse(16, 21, 6, 5.5, so=lambda x, y: y <= 26.5), 'vidro'),
        (retangulo(15, 14, 16, 17, 'cil_v'), 'vidro'),
        (elipse(16, 11.5, 4.5, 2.5, so=lambda x, y: y >= 10), 'ouro'),
        (elipse(16, 24, 5, 3, so=lambda x, y: y >= 21.5), 'ouro'),
        (retangulo(6, 3, 25, 5, 'cil_h'), 'madeira'),
        (retangulo(6, 26, 25, 28, 'cil_h'), 'madeira'),
    ]
    img, p = desenhar(partes)
    px(p, [(16, y) for y in range(14, 22)], 'ouro', 3)        # areia caindo
    px(p, [(12, 8), (12, 9), (12, 19), (12, 20)], 'vidro', 4)
    return img


def grimorio():
    partes = [
        (retangulo(23, 7, 26, 27, 'cil_v'), 'pergaminho'),
        (retangulo(6, 5, 24, 26, 'plano'), 'roxo'),
        (retangulo(5, 5, 7, 26, 'cil_v'), 'roxo'),
        (elipse(15.5, 15.5, 4.2, 4.2), 'cristal'),
    ]
    img, p = desenhar(partes)
    for cx, cy in ((9, 7), (22, 7), (9, 24), (22, 24)):       # cantoneiras
        px(p, [(cx, cy), (cx + 1, cy), (cx, cy + 1)], 'ouro', 3)
    anelz = [(int(15.5 + 6.2 * math.cos(math.radians(a))), int(15.5 + 6.2 * math.sin(math.radians(a)))) for a in range(0, 360, 15)]
    px(p, anelz, 'ouro', 2)
    px(p, [(15, 8), (15, 23), (8, 15), (22, 15)], 'ouro', 4)  # pontas da runa
    return img


def caneca():
    partes = [
        (anel(22, 18, 5.5, 6, 2.2, so=lambda x, y: x >= 20), 'madeira'),
        (retangulo(7, 10, 21, 27), 'madeira'),
        (retangulo(7, 12, 21, 13, 'cil_h'), 'metal'),
        (retangulo(7, 23, 21, 24, 'cil_h'), 'metal'),
        (elipse(14, 9.5, 8.5, 3.4), 'osso'),
        (elipse(9.5, 7.5, 3, 2.6), 'osso'),
        (elipse(14.5, 6.5, 3.6, 2.9), 'osso'),
        (elipse(19, 8, 3, 2.5), 'osso'),
        (retangulo(9, 10, 10, 14), 'osso'),
    ]
    img, p = desenhar(partes)
    px(p, [(11, 17), (11, 18), (11, 19), (11, 20)], 'madeira', 3)  # veio
    px(p, [(17, 16), (17, 17), (18, 20)], 'madeira', 1)
    return img


def martelo():
    # cabeça curta e grossa, com as duas faces de bater mais escuras: é o
    # que separa "martelo" de "rodo"
    d = (math.cos(math.radians(-45)), math.sin(math.radians(-45)))
    q = (-d[1], d[0]); c = (11.5, 11.5)
    pt = lambda a, b: (c[0] + a * d[0] + b * q[0], c[1] + a * d[1] + b * q[1])
    partes = [
        (elipse(19.5, 19.5, 11, 2, 45), 'madeira'),
        (faceta([pt(-6, -4.2), pt(6, -4.2), pt(6, 0), pt(-6, 0)], (-.35, -.55, .76)), 'metal'),
        (faceta([pt(-6, 0), pt(6, 0), pt(6, 4.2), pt(-6, 4.2)], (.45, .2, .87)), 'metal'),
        (faceta([pt(6, -4.2), pt(8, -3.4), pt(8, 3.4), pt(6, 4.2)], (.7, -.3, .65)), 'pedra'),
        (faceta([pt(-8, -3.4), pt(-6, -4.2), pt(-6, 4.2), pt(-8, 3.4)], (-.7, -.2, .68)), 'pedra'),
    ]
    img, p = desenhar(partes)
    px(p, [(27, 27), (28, 28), (26, 28)], 'madeira', 0)
    brilho(p, 6, 6)
    return img


def ovo():
    partes = [
        (elipse(16, 28, 11, 3.4), 'madeira'),
        (elipse(16, 16.5, 9, 11.2), 'verde'),
        (elipse(12, 11, 2.2, 1.6, -20), 'ouro'),
        (elipse(21, 15.5, 1.8, 1.5, 15), 'ouro'),
        (elipse(17, 23.5, 2, 1.5, -10), 'ouro'),
        (elipse(11, 19.5, 1.4, 1.2), 'ouro'),
    ]
    img, p = desenhar(partes)
    # rachadura curta no topo — no meio ela virava uma boca
    px(p, [(18, 6), (19, 7), (18, 8), (19, 9), (20, 10)], 'verde', 0)
    px(p, [(11, 8), (10, 9), (10, 10)], 'verde', 4)
    px(p, [(x, 28) for x in range(7, 26) if x % 2], 'madeira', 1)
    return img


def presente():
    partes = [
        (retangulo(6, 15, 25, 27, 'plano'), 'cristal'),
        (retangulo(5, 12, 26, 15, 'cil_h'), 'cristal'),
        (retangulo(15, 12, 16, 27, 'cil_v'), 'ouro'),
        (elipse(11.5, 9, 4.6, 2.6, 25), 'ouro'),
        (elipse(20.5, 9, 4.6, 2.6, -25), 'ouro'),
        (elipse(16, 10.5, 1.9, 1.9), 'ouro'),
    ]
    img, p = desenhar(partes)
    px(p, [(11, 10), (20, 10)], 'ouro', 1)
    brilho(p, 27, 5)
    return img


def lacre():
    partes = [
        (elipse(16, 16.5, 10.5, 10), 'fita'),
        (elipse(6.5, 23, 2.5, 2.2), 'fita'),
        (elipse(25.5, 9, 2.2, 2), 'fita'),
        (elipse(24, 25.5, 2.4, 2.1), 'fita'),
        (concavo(elipse(16, 16.5, 7, 6.6)), 'fita'),
    ]
    img, p = desenhar(partes)
    # coroa em ouro: vermelho claro sobre vermelho escuro virava boca
    coroa = {13: [12, 16, 20], 14: [12, 13, 15, 16, 17, 19, 20], 15: list(range(12, 21)), 16: list(range(12, 21)), 17: list(range(12, 21))}
    for y, xs in coroa.items():
        for x in xs:
            px(p, [(x, y)], 'ouro', 4 if (y <= 14 or x < 14) else 3)
    px(p, [(x, 18) for x in range(12, 21)], 'ouro', 1)
    px(p, [(14, 16), (18, 16)], 'fita', 2)
    return img


def balanca():
    partes = [
        (faceta([(9, 28), (23, 28), (20, 25), (12, 25)], (-.1, -.3, 1)), 'ouro'),
        (retangulo(15, 6, 16, 25, 'cil_v'), 'ouro'),
        (retangulo(3, 7, 28, 8, 'cil_h'), 'ouro'),
        (elipse(16, 4.5, 2.2, 2.2), 'ouro'),
        (elipse(6, 17, 5, 2.6, so=lambda x, y: y >= 16.5), 'metal'),
        (elipse(26, 17, 5, 2.6, so=lambda x, y: y >= 16.5), 'metal'),
    ]
    img, p = desenhar(partes)
    for cx in (6, 26):
        for t in range(0, 9):
            px(p, [(cx - 1 - t // 3, 9 + t), (cx + 1 + t // 3, 9 + t)], 'metal', 2)
    return img


def espada():
    d = (math.sqrt(.5), math.sqrt(.5)); q = (math.sqrt(.5), -math.sqrt(.5))
    tip = (4.5, 4.5)
    at = lambda t, s: (tip[0] + t * d[0] + s * q[0], tip[1] + t * d[1] + s * q[1])
    partes = [
        (faceta([at(0, 0), at(3, 2.3), at(18, 2.3), at(18, 0)], (.15, -.75, .65)), 'metal'),
        (faceta([at(0, 0), at(18, 0), at(18, -2.3), at(3, -2.3)], (-.7, .1, .7)), 'metal'),
        (elipse(*at(22.5, 0), 3.6, 1.7, 45), 'couro'),
        (faceta([at(17.6, -6.5), at(17.6, 6.5), at(19.6, 6.5), at(19.6, -6.5)], (-.3, -.5, .8)), 'ouro'),
        (elipse(*at(27, 0), 2.2, 2.2), 'ouro'),
    ]
    img, p = desenhar(partes)
    px(p, [(int(at(t, .5)[0]), int(at(t, .5)[1])) for t in range(4, 17, 2)], 'metal', 4)
    brilho(p, 8, 4)
    return img


def moeda_volta():
    cx, cy, R = 16, 16, 12.5
    arco = anel(cx, cy, R, R, 2.2, so=lambda x, y: (np.degrees(np.arctan2(y - cy, x - cx)) <= 5) & (np.degrees(np.arctan2(y - cy, x - cx)) >= -150))
    a = math.radians(-150); P = (cx + (R - 1.1) * math.cos(a), cy + (R - 1.1) * math.sin(a))
    dirc = (math.sin(a), -math.cos(a)); per = (dirc[1], -dirc[0])
    ponta = [(P[0] + 4 * dirc[0], P[1] + 4 * dirc[1]), (P[0] + 3.2 * per[0], P[1] + 3.2 * per[1]), (P[0] - 3.2 * per[0], P[1] - 3.2 * per[1])]
    partes = [
        (arco, 'verde'),
        (faceta(ponta, (-.3, -.3, .9)), 'verde'),
        (elipse(15, 18, 8, 8), 'ouro'),
        (concavo(elipse(15, 18, 5.2, 5.2)), 'ouro'),
    ]
    img, p = desenhar(partes)
    px(p, [(15, 16), (15, 17), (15, 18), (15, 19), (15, 20)], 'ouro', 4)
    return img


def cristais():
    def lasca(xl, xr, yo, ytop, yb=28):
        xc = (xl + xr) / 2
        return [
            (faceta([(xl, yo), (xc, ytop), (xc, yo)], (-.45, -.6, .66)), 'cristal'),
            (faceta([(xc, ytop), (xr, yo), (xc, yo)], (.3, -.55, .78)), 'cristal'),
            (faceta([(xl, yo), (xc, yo), (xc, yb), (xl, yb)], (-.6, -.1, .8)), 'cristal'),
            (faceta([(xc, yo), (xr, yo), (xr, yb), (xc, yb)], (.65, 0, .76)), 'cristal'),
        ]
    partes = [(elipse(16, 29, 13.5, 3), 'pedra')] + lasca(16, 25, 10, 2) + lasca(10, 17.5, 15, 9) + lasca(4.5, 10.5, 20, 15)
    img, p = desenhar(partes)
    brilho(p, 27, 6); brilho(p, 6, 10, '#7adcf0')
    return img


def gema():
    partes = [
        (faceta([(6, 13), (10, 8), (13, 8), (12, 13)], (-.6, -.55, .58)), 'gema'),
        (faceta([(12, 13), (13, 8), (19, 8), (20, 13)], (-.1, -.7, .7)), 'gema'),
        (faceta([(20, 13), (19, 8), (22, 8), (26, 13)], (.55, -.45, .7)), 'gema'),
        (faceta([(6, 13), (12, 13), (16, 28)], (-.6, .2, .77)), 'gema'),
        (faceta([(12, 13), (20, 13), (16, 28)], (0, .35, .94)), 'gema'),
        (faceta([(20, 13), (26, 13), (16, 28)], (.7, .35, .62)), 'gema'),
    ]
    img, p = desenhar(partes, cortes=(-0.15, 0.3, 0.7))
    brilho(p, 11, 10); brilho(p, 27, 20, '#c47af0')
    return img


def saquinho():
    partes = [
        (elipse(16, 21.5, 9.5, 8), 'roxo'),
        (elipse(16, 10.5, 5.5, 2.8), 'roxo'),
        (retangulo(13, 10, 18, 12), 'roxo'),
        (retangulo(12, 12, 19, 13, 'cil_h'), 'ouro'),
    ]
    img, p = desenhar(partes)
    q = [(15, 16), (16, 16), (17, 16), (14, 17), (18, 17), (18, 18), (17, 19), (16, 20), (16, 21), (16, 23)]
    px(p, [(x + 1, y + 1) for x, y in q], 'roxo', 0)           # sombra do ponto de interrogação
    px(p, q, 'ouro', 4)
    return img

# A ordem aqui é a ordem na folha de sprites: não reordene sem regerar.
ICONES = {
    'Salário': bolsa,
    'Saúde': pocao,
    'Alimentação': coxa,
    'Compras': bau,
    'Mercado': cesta,
    'Transporte': bota,
    'Moradia': casinha,
    'Telefone': orbe,
    'Assinaturas': ampulheta,
    'Educação': grimorio,
    'Lazer': caneca,
    'Casa': martelo,
    'Pet': ovo,
    'Presentes': presente,
    'Taxas': lacre,
    'Imposto': balanca,
    'Freela': espada,
    'Reembolso': moeda_volta,
    'Rendimento': cristais,
    'Outras Entradas': gema,
    'Outros': saquinho,
}
