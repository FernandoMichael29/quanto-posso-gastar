"""
Refaz as folhas de sprites e o índice que o app lê.

    python3 ferramentas/icones/gerar.py

Precisa de Python 3 com Pillow e numpy (pip install pillow numpy).
"""
import os, sys
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from PIL import Image
import motor

RAIZ = os.path.abspath(os.path.join(AQUI, '..', '..'))
ASSETS = os.path.join(RAIZ, 'src', 'assets')
os.makedirs(ASSETS, exist_ok=True)


def folha(desenhos, n, arquivo):
    motor.grade(n)
    nomes = list(desenhos)
    img = Image.new('RGBA', (n * len(nomes), n), (0, 0, 0, 0))
    for i, nome in enumerate(nomes):
        img.alpha_composite(desenhos[nome](), (n * i, 0))
    img.save(os.path.join(ASSETS, arquivo), optimize=True)
    return nomes, img.size


# os itens primeiro (32), as abas depois (24): o motor desenha numa grade de cada vez
from desenhos import ICONES
itens, t1 = folha(ICONES, 32, 'icones.png')
from abas import ABAS
abas, t2 = folha(ABAS, 24, 'abas.png')

sem_acento = str.maketrans('áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
chave = lambda n: n.lower().translate(sem_acento)
js = ['// Gerado por ferramentas/icones/gerar.py — não edite à mão.',
      "import folha from '../assets/icones.png';",
      "import folhaAbas from '../assets/abas.png';",
      '',
      'export const FOLHA = folha;',
      'export const FOLHA_ABAS = folhaAbas;',
      '',
      '// Categoria (minúscula, sem acento) → coluna na folha de 32 px.',
      'export const COLUNA = {']
js += [f"  '{chave(n)}': {i}," for i, n in enumerate(itens)]
js += ['};', '', '// Aba → coluna na folha de 24 px.', 'export const ABA = {']
js += [f"  {n}: {i}," for i, n in enumerate(abas)]
js += ['};', '']
with open(os.path.join(RAIZ, 'src', 'lib', 'icones.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(js))
print(f'{len(itens)} itens → icones.png {t1}; {len(abas)} abas → abas.png {t2}; índice em src/lib/icones.js')
