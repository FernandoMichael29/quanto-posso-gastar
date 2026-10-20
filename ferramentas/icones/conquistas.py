"""
As medalhas das conquistas: 32x32, mesmo motor, mesma luz dos itens.

A ordem do dicionário CONQUISTAS é a ordem na folha conquistas.png, e os
nomes batem com os ids de src/lib/missao.js.
"""
import math
import motor
from motor import *


def pergaminho_selo():
    # Missão aceita: o contrato assinado
    partes = [
        (retangulo(8, 6, 23, 25, 'plano'), 'pergaminho'),
        (retangulo(6, 4, 25, 7, 'cil_h'), 'pergaminho'),
        (retangulo(6, 24, 25, 27, 'cil_h'), 'pergaminho'),
        (elipse(21, 22, 4.6, 4.6), 'fita'),
        (concavo(elipse(21, 22, 2.4, 2.4)), 'fita'),
    ]
    img, p = desenhar(partes)
    for y in (10, 13, 16):
        px(p, [(x, y) for x in range(11, 21) if (x * 3 + y) % 7], 'pergaminho', 1)
    px(p, [(11, 19), (12, 19), (13, 19), (14, 19)], 'pergaminho', 0)     # a assinatura
    return img


def espada():
    # Fase limpa: todas as contas fixas derrotadas
    a = 45
    partes = [
        (faceta([(6, 6), (8.5, 4.5), (22, 18), (18, 22), (4.5, 8.5)], (-0.5, -0.5, 0.7)), 'metal'),
        (faceta([(6, 6), (22, 18), (20, 20)], (0.45, 0.45, 0.77)), 'metal'),
        (elipse(21.5, 21.5, 7.2, 1.9, -45), 'ouro'),                 # guarda
        (elipse(25.2, 25.2, 3.6, 1.5, 45), 'couro'),                 # cabo
        (elipse(28, 28, 2.2, 2.2), 'ouro'),                          # pomo
    ]
    img, p = desenhar(partes)
    px(p, [(8, 8), (10, 10), (12, 12)], 'metal', 4)
    brilho(p, 5, 13)
    return img


def cadeado():
    # Bolso trancado: um dia inteiro sem gastar
    partes = [
        (anel(16, 13, 7.5, 8.5, 2.6, so=lambda x, y: y < 14), 'metal'),
        (retangulo(7, 14, 24, 27, 'cil_v'), 'ouro'),
        (retangulo(7, 14, 24, 15, 'cil_h'), 'ouro'),
    ]
    img, p = desenhar(partes)
    px(p, [(15, 18), (16, 18), (15, 19), (16, 19), (16, 20), (16, 21), (16, 22)], 'ouro', 0)
    px(p, [(9, 17), (9, 18), (9, 19)], 'ouro', 4)
    return img


def cristal():
    # Mana intacta: nenhum teto estourado
    partes = [
        (faceta([(16, 3), (9, 11), (16, 13)], (-0.55, -0.55, 0.62)), 'cristal'),
        (faceta([(16, 3), (23, 11), (16, 13)], (0.35, -0.6, 0.72)), 'cristal'),
        (faceta([(9, 11), (16, 13), (16, 29)], (-0.6, 0.1, 0.78)), 'cristal'),
        (faceta([(23, 11), (16, 13), (16, 29)], (0.6, 0.25, 0.75)), 'cristal'),
    ]
    img, p = desenhar(partes)
    px(p, [(13, 9), (12, 10), (14, 8)], 'cristal', 4)
    brilho(p, 25, 6, '#e6ffff')
    brilho(p, 7, 22, '#e6ffff')
    return img


def escudo():
    # No azul: fechou um mês sobrando
    corpo = [(5, 5), (27, 5), (27, 15), (16, 29), (5, 15)]
    partes = [
        (faceta(corpo, (-0.3, -0.45, 0.84)), 'ouro'),
        (faceta([(8, 8), (16, 8), (16, 25), (8, 15)], (-0.2, 0.1, 0.97)), 'cristal'),
        (faceta([(16, 8), (24, 8), (24, 15), (16, 25)], (0.55, 0.35, 0.76)), 'cristal'),
    ]
    img, p = desenhar(partes)
    # o "v" de certo, em ouro
    certo = [(11, 14), (12, 15), (13, 16), (14, 17), (15, 16), (16, 15), (17, 14), (18, 13), (19, 12), (20, 11)]
    px(p, [(x, y + 1) for x, y in certo], 'ouro', 0)
    px(p, certo, 'ouro', 4)
    px(p, [(x, y - 1) for x, y in certo[3:]], 'ouro', 3)
    return img


def estrela(cx, cy, r):
    pts = []
    for k in range(10):
        a = math.radians(-90 + k * 36)
        rr = r if k % 2 == 0 else r * 0.45
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return dentro(pts)


def tres_estrelas():
    # Trinca: três meses seguidos no azul
    import numpy as np
    def forma(cx, cy, r):
        m = estrela(cx, cy, r)
        _, n = elipse(cx, cy, r, r)
        return m, n
    partes = [
        (forma(8, 20, 7.5), 'ouro'),
        (forma(24, 20, 7.5), 'ouro'),
        (forma(16, 11, 9.5), 'ouro'),
    ]
    img, p = desenhar(partes, cortes=(-0.2, 0.3, 0.7))
    brilho(p, 27, 5)
    return img


def formiga():
    # Formiguinha: cumpriu a missão de guardar
    partes = [
        (elipse(7.5, 22.5, 5.6, 4.6), 'couro'),        # abdômen
        (elipse(14.5, 20.5, 3.2, 2.6), 'couro'),       # tórax
        (elipse(20.5, 17.5, 4, 3.6), 'couro'),         # cabeça
        (elipse(23.5, 8, 6, 6), 'ouro'),               # a moeda que ela carrega
        (concavo(elipse(23.5, 8, 3.4, 3.4)), 'ouro'),
    ]
    img, p = desenhar(partes)
    escuro = '#140c1e'
    pernas = [(12, 23), (11, 24), (10, 25), (10, 26), (9, 27),
              (14, 23), (14, 24), (14, 25), (14, 26), (14, 27),
              (16, 23), (17, 24), (18, 25), (19, 26), (19, 27)]
    pontos(p, pernas, escuro)
    pontos(p, [(x + 1, y) for x, y in pernas if y > 24], escuro)
    pontos(p, [(21, 14), (21, 13), (22, 13)], escuro)            # antena segurando a moeda
    pontos(p, [(22, 16), (22, 17)], '#ffffff')                    # olho
    px(p, [(5, 20), (6, 19), (7, 19), (13, 19)], 'couro', 4)
    return img


def coroa():
    # Guardião do cofre: três meses seguidos cumprindo a missão
    partes = [
        (faceta([(4, 24), (4, 9), (10, 16), (16, 6), (22, 16), (28, 9), (28, 24)], (-0.3, -0.4, 0.86)), 'ouro'),
        (retangulo(4, 22, 28, 26, 'cil_h'), 'ouro'),
        (elipse(16, 18.5, 2.6, 2.6), 'pocao'),
        (elipse(9, 20, 1.8, 1.8), 'cristal'),
        (elipse(23, 20, 1.8, 1.8), 'cristal'),
    ]
    img, p = desenhar(partes)
    for x, y in ((4, 8), (16, 5), (28, 8)):
        px(p, [(x, y)], 'ouro', 4)
    brilho(p, 26, 4)
    return img


CONQUISTAS = {
    'primeira_missao': pergaminho_selo,
    'fase_limpa': espada,
    'bolso_trancado': cadeado,
    'mana_intacta': cristal,
    'no_azul': escudo,
    'trinca': tres_estrelas,
    'formiguinha': formiga,
    'guardiao': coroa,
}
