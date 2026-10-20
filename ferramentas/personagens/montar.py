"""Monta a folha de cada personagem a partir dos quadros do PixelLab.

Os quadros (80×80, fundo transparente) moram em quadros/<quem>_<animacao>_<nn>.png.
Saída: src/assets/personagens/<quem>.png — uma linha por animação, 9 quadros
lado a lado. A ordem das linhas é a de ANIMACOES aqui e em src/lib/personagem.js.

    python3 ferramentas/personagens/montar.py
"""
import os
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, '..', '..'))
LADO, QUADROS = 80, 9
ANIMACOES = ['parado', 'ataque', 'vitoria', 'ferido', 'moeda', 'triste', 'pergaminho', 'dormindo', 'contando', 'andando']
QUEM = {'fernando': 'fer', 'mayara': 'may'}
# Cada visual de equipamento é uma folha inteira: quadros/<fer|may>_<prata|ouro>_<anim>_<nn>.png
FOLHAS = {**QUEM, **{f'{n}_{v}': f'{p}_{v}' for n, p in QUEM.items() for v in ('prata', 'ouro')}}

for nome, prefixo in FOLHAS.items():
    if not os.path.exists(os.path.join(AQUI, 'quadros', f'{prefixo}_parado_00.png')):
        print('sem quadros para', nome); continue
    folha = Image.new('RGBA', (LADO * QUADROS, LADO * len(ANIMACOES)), (0, 0, 0, 0))
    for linha, anim in enumerate(ANIMACOES):
        for q in range(QUADROS):
            im = Image.open(os.path.join(AQUI, 'quadros', f'{prefixo}_{anim}_{q:02d}.png')).convert('RGBA')
            folha.paste(im, (q * LADO, linha * LADO), im)
    saida = os.path.join(RAIZ, 'src', 'assets', 'personagens', f'{nome}.png')
    folha.save(saida, optimize=True)
    print(saida, folha.size, os.path.getsize(saida), 'bytes')

# Os rostinhos (28×28) do extrato e da missão: a cabeça do primeiro quadro "parado".
ROSTO = 28
CABECA = {'fernando': (20, 14), 'mayara': (30, 14)}   # canto de cima à esquerda, no quadro de 80
rostos = Image.new('RGBA', (ROSTO * len(QUEM), ROSTO), (0, 0, 0, 0))
for i, (nome, prefixo) in enumerate(QUEM.items()):
    q = Image.open(os.path.join(AQUI, 'quadros', f'{prefixo}_parado_00.png')).convert('RGBA')
    x, y = CABECA[nome]
    rostos.paste(q.crop((x, y, x + ROSTO, y + ROSTO)), (i * ROSTO, 0))
saida = os.path.join(RAIZ, 'src', 'assets', 'personagens', 'rostos.png')
rostos.save(saida, optimize=True)
print(saida, rostos.size)
