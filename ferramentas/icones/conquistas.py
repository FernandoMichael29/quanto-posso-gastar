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


# --- conquistas da fogueira, dos baús e do dinheiro trabalhando (2.15.0) -----

RAMPAS.update({
  'fogo':       ['#3a0a0a', '#a8281a', '#e8601e', '#f8b03a', '#fff2a0'],
  'chama_azul': ['#0a1440', '#1a3aa0', '#2e78e0', '#7ac8f8', '#eaffff'],
})


def bau_transbordando():
    # Baú cheio: a meta de um baú foi alcançada
    partes = [
        (retangulo(5, 16, 26, 27, 'cil_v'), 'madeira'),
        (retangulo(5, 16, 26, 18, 'cil_h'), 'ouro'),
        (elipse(10, 14, 4, 3.2), 'ouro'),
        (elipse(16, 12, 4.4, 3.4), 'ouro'),
        (elipse(22, 14, 4, 3.2), 'ouro'),
        (elipse(13, 9, 3.4, 2.8), 'ouro'),
        (elipse(19, 8, 3.4, 2.8), 'ouro'),
        (retangulo(14, 20, 17, 24, 'plano'), 'ouro'),
    ]
    img, p = desenhar(partes)
    px(p, [(15, 22), (16, 22)], 'ouro', 0)
    for x in (5, 26):
        px(p, [(x, y) for y in range(19, 27)], 'madeira', 0)
    brilho(p, 27, 6)
    brilho(p, 6, 9)
    return img


def labareda(pts, cx, cy, rx, ry):
    """Fogo com várias pontas: a forma é o polígono; a luz, a de uma gota."""
    _, n = elipse(cx, cy, rx, ry)
    return dentro(pts), n


FOGO_FORA = [(7, 26), (7.5, 20), (9.5, 15), (10.8, 18), (12, 12), (14, 7), (15.6, 10.5), (17.2, 3),
             (19.6, 9.5), (21.2, 7.5), (22.2, 13), (24.6, 16.5), (25, 26)]
FOGO_DENTRO = [(11, 26), (11.4, 21), (13.4, 17), (14.8, 19.5), (16.4, 13.5), (18.4, 18), (20, 16.5), (21, 26)]


def fogueira_medalha():
    # Fogo aceso: a fogueira da casa acesa 7 dias seguidos
    partes = [
        (labareda(FOGO_FORA, 16, 17, 9.5, 10), 'fogo'),
        (labareda(FOGO_DENTRO, 16, 22, 5.5, 6), 'ouro'),
        (elipse(16, 27, 11, 2.4, 16), 'madeira'),
        (elipse(16, 27, 11, 2.4, -16), 'madeira'),
    ]
    img, p = desenhar(partes, cortes=(0.05, 0.5, 0.9))
    pontos(p, [(26, 6), (5, 10), (27, 12)], '#f8b03a')
    return img


def chama_eterna():
    # Chama eterna: 30 dias seguidos — o fogo vira azul
    partes = [
        (labareda(FOGO_FORA, 16, 17, 9.5, 10), 'chama_azul'),
        (labareda(FOGO_DENTRO, 16, 22, 5.5, 6), 'cristal'),
        (elipse(16, 27, 11, 2.4, 16), 'pedra'),
        (elipse(16, 27, 11, 2.4, -16), 'pedra'),
    ]
    img, p = desenhar(partes, cortes=(0.05, 0.5, 0.9))
    brilho(p, 4, 5, '#eaffff')
    brilho(p, 27, 9, '#eaffff')
    return img


def dupla():
    # Dupla dinâmica: os dois guardaram dinheiro no mesmo mês
    partes = [
        (elipse(11, 17, 8.5, 8.5), 'ouro'),
        (concavo(elipse(11, 17, 5.2, 5.2)), 'verde'),
        (elipse(21, 17, 8.5, 8.5), 'ouro'),
        (concavo(elipse(21, 17, 5.2, 5.2)), 'cristal'),
    ]
    img, p = desenhar(partes)
    # o coraçãozinho no encontro das duas moedas
    pontos(p, [(15, 6), (17, 6), (14, 5), (18, 5), (16, 7), (15, 5), (17, 5)], '#f05a50')
    pontos(p, [(16, 8)], '#c8283a')
    brilho(p, 27, 26)
    return img


def juros():
    # Juros a favor: o dinheiro rendeu R$ 100 somados (baús + contas)
    partes = [
        (retangulo(4, 24, 19, 27, 'cil_h'), 'ouro'),
        (retangulo(5, 20, 20, 23, 'cil_h'), 'ouro'),
        (retangulo(4, 16, 19, 19, 'cil_h'), 'ouro'),
        (faceta([(24, 4), (30, 11), (26.5, 11), (26.5, 27), (21.5, 27), (21.5, 11), (18, 11)], (-0.35, -0.4, 0.85)), 'verde'),
    ]
    img, p = desenhar(partes)
    for y in (17, 21, 25):
        px(p, [(x, y) for x in range(7, 17, 3)], 'ouro', 4)
    brilho(p, 5, 9)
    return img


def ampulheta():
    # Caçador pontual: todas as contas fixas do mês pagas até o vencimento
    partes = [
        (faceta([(9, 7), (23, 7), (17.2, 16), (23, 25), (9, 25), (14.8, 16)], (-0.35, -0.3, 0.88)), 'vidro'),
        (faceta([(12, 18.5), (20, 18.5), (22, 24), (10, 24)], (-0.2, -0.5, 0.84)), 'ouro'),
        (faceta([(13, 10), (19, 10), (16, 14)], (-0.2, -0.5, 0.84)), 'ouro'),
        (retangulo(6, 3, 25, 6, 'cil_h'), 'madeira'),
        (retangulo(6, 26, 25, 29, 'cil_h'), 'madeira'),
    ]
    img, p = desenhar(partes)
    pontos(p, [(16, 15), (16, 16), (16, 17)], '#f6c63c')
    px(p, [(10, 9), (10, 10), (11, 11)], 'vidro', 4)
    return img


CONQUISTAS.update({
    'bau_cheio': bau_transbordando,
    'fogo_aceso': fogueira_medalha,
    'chama_eterna': chama_eterna,
    'dupla_dinamica': dupla,
    'juros_a_favor': juros,
    'cacador_pontual': ampulheta,
})
