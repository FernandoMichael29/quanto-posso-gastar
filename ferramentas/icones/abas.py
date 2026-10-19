"""
Os ícones da barra de abas: 24x24, mesmo motor e mesma luz dos itens.

Quem desenha estes chama motor.grade(24) antes (o gerar.py faz isso).
"""
import math
import motor
from motor import elipse, retangulo, faceta, anel, concavo, px, brilho, desenhar, L, R


def moeda_mais():
    # Novo: moeda com "+" — entrou ou saiu dinheiro
    partes = [
        (elipse(10.5, 10.5, 8, 8), 'ouro'),
        (concavo(elipse(10.5, 10.5, 5, 5)), 'ouro'),
        (elipse(17.5, 17.5, 5.6, 5.6), 'verde'),
    ]
    img, p = desenhar(partes, cortes=(0.1, 0.55, 0.9))
    # "+" branco grosso: claro sobre verde médio lia como borrão
    mais = [(x, y) for x in (17, 18) for y in range(14, 22)] + [(x, y) for y in (17, 18) for x in range(14, 22)]
    px(p, [(x + 1, y + 1) for x, y in mais], 'verde', 0)
    for x, y in mais:
        p[x, y] = motor.hexa('#ffffff')
    px(p, [(10, 8), (10, 9), (10, 10), (10, 11), (10, 12)], 'ouro', 4)
    return img


def calendario():
    partes = [
        (retangulo(3, 6, 20, 21, 'plano'), 'parede'),
        (retangulo(3, 6, 20, 9, 'cil_h'), 'pocao'),
        (retangulo(7, 3, 8, 7, 'cil_v'), 'metal'),
        (retangulo(15, 3, 16, 7, 'cil_v'), 'metal'),
    ]
    img, p = desenhar(partes)
    for y in (12, 15, 18):
        px(p, [(x, y) for x in (6, 9, 12, 15, 18)], 'parede', 1)
    px(p, [(15, 15), (16, 15), (15, 16), (16, 16)], 'verde', 3)       # hoje
    return img


def chapeu():
    # Perguntar: o chapéu do mago que responde
    partes = [
        (elipse(12, 19.5, 10.5, 2.8), 'roxo'),
        (faceta([(5, 19.5), (14, 1.5), (12.5, 19.5)], L), 'roxo'),
        (faceta([(12.5, 19.5), (14, 1.5), (19, 19.5)], R), 'roxo'),
        (retangulo(6, 16, 18, 17, 'cil_h'), 'ouro'),
    ]
    img, p = desenhar(partes)
    for x, y in ((11, 10), (14, 7), (13, 13)):
        px(p, [(x, y)], 'ouro', 4)
    brilho(p, 20, 5)
    return img


def pergaminho():
    # Histórico: as respostas antigas, enroladas
    partes = [
        (retangulo(6, 4, 17, 19, 'plano'), 'pergaminho'),
        (retangulo(4, 3, 19, 5, 'cil_h'), 'pergaminho'),
        (retangulo(4, 18, 19, 20, 'cil_h'), 'pergaminho'),
        (elipse(16, 16.5, 2.4, 2.4), 'fita'),
    ]
    img, p = desenhar(partes)
    for y in (8, 11, 14):
        px(p, [(x, y) for x in range(8, 16) if (x + y) % 5], 'pergaminho', 1)
    return img


def engrenagem():
    partes = []
    for k in range(8):
        a = math.radians(k * 45 + 22.5)
        c, s = math.cos(a), math.sin(a)
        pt = lambda r, w, c=c, s=s: (12 + r * c - w * s, 12 + r * s + w * c)
        partes.append((faceta([pt(6, -2.8), pt(11.3, -2.3), pt(11.3, 2.3), pt(6, 2.8)], (c * .6 - .25, s * .6 - .35, .72)), 'metal'))
    partes.append((anel(12, 12, 8.2, 8.2, 3.6), 'metal'))
    img, p = desenhar(partes)
    return img


# A ordem aqui é a ordem na folha de sprites das abas.
ABAS = {
    'novo': moeda_mais,
    'mes': calendario,
    'perguntar': chapeu,
    'historico': pergaminho,
    'ajustes': engrenagem,
}
