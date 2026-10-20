"""
Monta a folha da fogueira (src/assets/fogueira.png) a partir dos quadros.

    python3 ferramentas/fogueira/montar.py

Os quadros vieram do PixelLab (generate-image-v2 → a fogueira; edit-image-pixen
→ a chama azul; animate-pixminimax → 8 quadros de fogo tremulando). O quadro 00
é a imagem de partida; 01–08, a animação. Linhas da folha: pequena, grande,
azul — 9 quadros de 64 px cada. A ordem tem que bater com src/lib/fogueira.js.
"""
import os
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, '..', '..'))
LINHAS = ['pequena', 'grande', 'azul']
QUADROS, LADO = 9, 64

folha = Image.new('RGBA', (QUADROS * LADO, len(LINHAS) * LADO), (0, 0, 0, 0))
for y, nome in enumerate(LINHAS):
    for x in range(QUADROS):
        q = Image.open(os.path.join(AQUI, 'quadros', f'{nome}_{x:02d}.png')).convert('RGBA')
        if q.size != (LADO, LADO):
            q = q.resize((LADO, LADO), Image.NEAREST)
        folha.alpha_composite(q, (x * LADO, y * LADO))
folha.save(os.path.join(RAIZ, 'src', 'assets', 'fogueira.png'), optimize=True)
print('fogueira.png', folha.size)
