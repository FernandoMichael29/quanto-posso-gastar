"""
Refaz a folha de sprites e o índice que o app lê.

    python3 ferramentas/icones/gerar.py

Precisa de Python 3 com Pillow e numpy (pip install pillow numpy).
"""
import os, sys
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from PIL import Image
from desenhos import ICONES

RAIZ = os.path.abspath(os.path.join(AQUI, '..', '..'))
nomes = list(ICONES)
folha = Image.new('RGBA', (32 * len(nomes), 32), (0, 0, 0, 0))
for i, nome in enumerate(nomes):
    folha.alpha_composite(ICONES[nome](), (32 * i, 0))
os.makedirs(os.path.join(RAIZ, 'src', 'assets'), exist_ok=True)
folha.save(os.path.join(RAIZ, 'src', 'assets', 'icones.png'), optimize=True)

sem_acento = str.maketrans('áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
chave = lambda n: n.lower().translate(sem_acento)
js = ['// Gerado por ferramentas/icones/gerar.py — não edite à mão.',
      "import folha from '../assets/icones.png';",
      '',
      'export const FOLHA = folha;',
      '',
      '// Categoria (minúscula, sem acento) → coluna na folha de sprites.',
      'export const COLUNA = {']
js += [f"  '{chave(n)}': {i}," for i, n in enumerate(nomes)]
js += ['};', '']
with open(os.path.join(RAIZ, 'src', 'lib', 'icones.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(js))
print(f'{len(nomes)} ícones → src/assets/icones.png ({folha.width}x{folha.height}) e src/lib/icones.js')
