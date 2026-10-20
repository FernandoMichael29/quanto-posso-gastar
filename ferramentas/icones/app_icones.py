"""
O ícone do app — o do atalho na tela inicial do celular.

Cada desenho é 24x24 (mesmo motor e mesma luz dos itens), centrado num fundo
de 32x32 e ampliado sem borrar: 16x → 512, 6x → 192, 1x → favicon de 32.
O "maskable" (Android) encolhe o desenho para caber no círculo seguro.

As 5 opções que foram para a escolha continuam aqui; ESCOLHIDO diz qual vai
para public/. O gerar.py chama gerar_publicos().
"""
import math
import numpy as np
from PIL import Image
import motor
from motor import elipse, retangulo, faceta, anel, concavo, px, brilho, desenhar, pontos, RAMPAS, hexa

motor.RAMPAS.update({
    'rosa': ['#3a0c22', '#7a2448', '#c24a74', '#ec84a0', '#ffc8d4'],
})

def moeda_mais():
    from abas import moeda_mais as m
    return m()

def saco():
    partes = [
        (elipse(12, 16, 8.5, 6.8), 'pano'),
        (elipse(12, 6.5, 4.6, 2.4), 'pano'),
        (retangulo(9, 6, 14, 9), 'pano'),
        (retangulo(8, 9, 15, 10, 'cil_h'), 'fita'),
        (elipse(12, 16.5, 3.8, 3.8), 'ouro'),
        (elipse(20.5, 20.5, 2.8, 2.1), 'ouro'),
        (elipse(3.8, 21, 2.6, 1.9), 'ouro'),
    ]
    img, p = desenhar(partes)
    pontos(p, [(12, 15), (12, 16), (12, 17), (12, 18)], RAMPAS['ouro'][1])
    pontos(p, [(6, 13), (7, 12)], RAMPAS['pano'][4])
    brilho(p, 20, 4)
    return img

def bau():
    partes = [
        (retangulo(2, 12, 21, 21, 'plano'), 'madeira'),
        (faceta([(3, 11), (5, 4), (19, 4), (21, 11)], (0, 0.35, 0.94)), 'madeira'),   # tampa aberta, vista de dentro
        (elipse(12, 12, 8.5, 3.2), 'ouro'),                                        # pilha de moedas
        (retangulo(2, 12, 21, 13, 'cil_h'), 'ouro'),
        (retangulo(5, 12, 6, 21, 'cil_v'), 'ouro'),
        (retangulo(17, 12, 18, 21, 'cil_v'), 'ouro'),
        (retangulo(10, 14, 13, 17, 'plano'), 'ouro'),
    ]
    img, p = desenhar(partes)
    pontos(p, [(11, 15), (12, 15)], '#140c1e')
    px(p, [(8, 10), (12, 9), (15, 10)], 'ouro', 4)
    brilho(p, 19, 2); brilho(p, 4, 7)
    return img

def porquinho():
    partes = [
        (elipse(12, 14, 9, 6.6), 'rosa'),
        (elipse(19.8, 14.5, 2.4, 2.1), 'rosa'),        # focinho
        (retangulo(6, 18, 8, 21, 'cil_v'), 'rosa'),
        (retangulo(15, 18, 17, 21, 'cil_v'), 'rosa'),
        (faceta([(15, 9), (17, 5), (18.5, 9.5)], (0.2, -0.6, 0.77)), 'rosa'),   # orelha
        (elipse(12, 3.8, 3.2, 3.2), 'ouro'),          # moeda caindo no cofre
    ]
    img, p = desenhar(partes)
    pontos(p, [(10, 8), (11, 8), (12, 8), (13, 8)], '#140c1e')           # fenda
    pontos(p, [(17, 12)], '#140c1e')                                      # olho
    pontos(p, [(20, 14), (20, 15)], RAMPAS['rosa'][1])                   # narinas
    px(p, [(7, 11), (8, 10), (9, 10)], 'rosa', 4)
    px(p, [(12, 2), (12, 3), (12, 4), (12, 5)], 'ouro', 1)
    return img

def hud():
    partes = [
        (elipse(12, 9.5, 7.5, 7.5), 'ouro'),
        (concavo(elipse(12, 9.5, 4.6, 4.6)), 'ouro'),
    ]
    img, p = desenhar(partes, cortes=(0.1, 0.55, 0.9))
    px(p, [(12, 7), (12, 8), (12, 9), (12, 10), (12, 11), (11, 7), (13, 11)], 'ouro', 1)
    # barra de vida embaixo: moldura clara, segmentos verdes até 70%
    for x in range(3, 21):
        p[x, 19] = hexa('#c9cedd'); p[x, 23 - 1] = hexa('#c9cedd')
    for y in range(19, 23):
        p[2, y] = hexa('#c9cedd'); p[21, y] = hexa('#c9cedd')
    for x in range(3, 21):
        for y in (20, 21):
            if x <= 15:
                p[x, y] = hexa('#b6f5a0' if y == 20 else '#4cc65a')
                if x % 3 == 2: p[x, y] = hexa('#237a3a')
            else:
                p[x, y] = hexa('#0c0e17')
    brilho(p, 20, 3)
    return img

OPCOES = {
    'A': ('Moeda +', moeda_mais, 'escuro'),
    'B': ('Saco de ouro', saco, 'verde'),
    'C': ('Baú do tesouro', bau, 'escuro'),
    'D': ('Cofrinho', porquinho, 'verde'),
    'E': ('Ouro + vida', hud, 'escuro'),
}

FUNDOS = {
    # duas faixas de luz em degrau, como as barras do app
    'escuro': ['#1e2238', '#181b2e', '#141626', '#101220'],
    'verde':  ['#16917f', '#118473', '#0f7b6c', '#0b6658'],
}

def fundo(tipo, n=32):
    img = Image.new('RGBA', (n, n)); p = img.load(); cores = FUNDOS[tipo]
    for y in range(n):
        c = cores[min(3, y * 4 // n)]
        for x in range(n): p[x, y] = hexa(c)
    return img

ESCOLHIDO = 'E'   # Ouro + vida, fundo escuro (escolha do Fernando, 20/10/2026)


def gerar_publicos(pasta):
    import os
    saidas = {
        'icone-512.png': montar(ESCOLHIDO, 512),
        'icone-192.png': montar(ESCOLHIDO, 192),
        'icone-32.png': montar(ESCOLHIDO, 32),
        'icone-maskable.png': montar(ESCOLHIDO, 512, maskable=True),
    }
    for nome, img in saidas.items():
        img.convert('RGB').save(os.path.join(pasta, nome), optimize=True)
    return list(saidas)


def montar(letra, tamanho=512, maskable=False):
    nome, f, tipo = OPCOES[letra]
    motor.grade(24)
    item = f()
    base = fundo(tipo)
    base.alpha_composite(item, (4, 4))
    if not maskable:
        return base.resize((tamanho, tamanho), Image.NEAREST)
    # maskable: só o desenho encolhe (12x em vez de 16x), para caber no
    # círculo seguro do Android; o fundo continua o mesmo até a borda.
    out = fundo(tipo).resize((512, 512), Image.NEAREST)
    out.alpha_composite(item.resize((288, 288), Image.NEAREST), (112, 112))
    return out.resize((tamanho, tamanho), Image.NEAREST) if tamanho != 512 else out
