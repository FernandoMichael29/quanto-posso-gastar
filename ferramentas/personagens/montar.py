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
ANIMACOES = ['parado', 'ataque', 'vitoria', 'ferido', 'moeda']
QUEM = {'fernando': 'fer', 'mayara': 'may'}

for nome, prefixo in QUEM.items():
    folha = Image.new('RGBA', (LADO * QUADROS, LADO * len(ANIMACOES)), (0, 0, 0, 0))
    for linha, anim in enumerate(ANIMACOES):
        for q in range(QUADROS):
            im = Image.open(os.path.join(AQUI, 'quadros', f'{prefixo}_{anim}_{q:02d}.png')).convert('RGBA')
            folha.paste(im, (q * LADO, linha * LADO), im)
    saida = os.path.join(RAIZ, 'src', 'assets', 'personagens', f'{nome}.png')
    folha.save(saida, optimize=True)
    print(saida, folha.size, os.path.getsize(saida), 'bytes')
