"""
Os baús (caixinhas de guardar dinheiro) em 4 estados de enchimento, 32x32.
A ordem de BAUS é a ordem na folha baus.png; os nomes batem com
estadoDoBau() de src/lib/baus.js.
"""
import motor
from motor import *

def _corpo(partes_extra=(), tampa='fechada'):
    partes = []
    if tampa == 'aberta':
        # tampa caída para trás: aparece por dentro, em cima
        partes.append((faceta([(5, 13), (7, 4), (25, 4), (27, 13)], (0, 0.5, 0.86)), 'madeira'))
        partes.append((retangulo(6, 4, 26, 5, 'cil_h'), 'metal'))
    partes += list(partes_extra)
    partes += [
        (retangulo(4, 15, 27, 27, 'plano'), 'madeira'),
        (retangulo(4, 15, 27, 16, 'cil_h'), 'metal'),
        (retangulo(7, 15, 8, 27, 'cil_v'), 'metal'),
        (retangulo(23, 15, 24, 27, 'cil_v'), 'metal'),
        (retangulo(14, 16, 17, 21, 'plano'), 'ouro'),
    ]
    if tampa == 'fechada':
        partes.insert(0, (elipse(15.5, 15, 12, 7, so=lambda x, y: y < 15), 'madeira'))
        partes.insert(1, (retangulo(7, 8, 8, 15, 'cil_v'), 'metal'))
        partes.insert(2, (retangulo(23, 8, 24, 15, 'cil_v'), 'metal'))
    if tampa == 'fresta':
        partes.insert(0, (elipse(15.5, 13, 12, 6.5, so=lambda x, y: y < 13), 'madeira'))
        partes.insert(1, (retangulo(4, 12, 27, 13, 'cil_h'), 'madeira'))
    return partes

def _fim(img, p):
    pontos(p, [(15, 18), (16, 18), (15, 19)], CONTORNO)                       # fechadura
    pontos(p, [(11, 21), (12, 21), (19, 23), (20, 23), (11, 25)], RAMPAS['madeira'][1])
    return img

def vazio():
    img, p = desenhar(_corpo())
    return _fim(img, p)

def comecando():
    img, p = desenhar(_corpo(tampa='fresta'))
    # brilho dourado saindo pela fresta
    pontos(p, [(x, 14) for x in range(8, 24)], RAMPAS['ouro'][3])
    pontos(p, [(x, 14) for x in range(12, 19)], RAMPAS['ouro'][4])
    return _fim(img, p)

def metade():
    moedas = [(elipse(15.5, 14.5, 10.5, 3.6), 'ouro')]
    img, p = desenhar(_corpo(moedas, tampa='aberta'))
    px(p, [(10, 13), (14, 12), (18, 13), (21, 14)], 'ouro', 4)
    return _fim(img, p)

def cheio():
    moedas = [
        (elipse(15.5, 13, 11, 5.5), 'ouro'),
        (elipse(4.5, 27.5, 3, 2.2), 'ouro'),
        (elipse(28, 26.5, 2.8, 2.1), 'ouro'),
        (elipse(11, 8.5, 2.8, 2.8), 'pocao'),     # gema vermelha no topo da pilha
        (elipse(20, 9.5, 2.4, 2.4), 'cristal'),
    ]
    img, p = desenhar(_corpo(moedas, tampa='aberta'))
    px(p, [(9, 11), (15, 9), (21, 12), (13, 13), (18, 11)], 'ouro', 4)
    brilho(p, 3, 6); brilho(p, 28, 3); brilho(p, 26, 12)
    return _fim(img, p)

BAUS = {'vazio': vazio, 'comecando': comecando, 'metade': metade, 'cheio': cheio}
