"""
Motor de pixel art 32x32: formas -> sombreamento com luz de cima-esquerda ->
rampa de 5 tons com matiz deslocado -> contorno seletivo.

Nada aqui é pacote pronto: cada ícone é descrito como um punhado de formas
(elipses, retângulos, rotações) com um material, e o motor decide pixel a
pixel qual tom vai em cada lugar — do jeito que um pixel artist faria à mão.
"""
import numpy as np
from PIL import Image

N = 32
LUZ = np.array([-0.55, -0.65, 0.52]); LUZ = LUZ / np.linalg.norm(LUZ)

# Rampas: [linha interna, sombra, base, meia-luz, brilho].
# Sombra puxa para frio/roxo, brilho puxa para quente — nunca só "mais escuro".
RAMPAS = {
  'ouro':   ['#5a2a12', '#9a4e14', '#d8901e', '#f6c63c', '#fff4a8'],
  'pocao':  ['#3e0c2a', '#82162e', '#c8283a', '#f05a50', '#ffc0a0'],
  'vidro':  ['#22284a', '#3e5a8c', '#78a8d6', '#c0e4f4', '#ffffff'],
  'madeira':['#2c1210', '#5c2a18', '#8e5028', '#c0803c', '#ecb870'],
  'pano':   ['#2e1a14', '#5e3a22', '#8e6234', '#bc9050', '#e6c888'],
  'carne':  ['#3a0e10', '#7a2416', '#b44a22', '#e0803e', '#ffc07a'],
  'osso':   ['#4a3c3e', '#8c7e78', '#c8bfae', '#ece6d4', '#ffffff'],
  'fita':   ['#2a0c24', '#6a1630', '#b02a3a', '#e05a4a', '#ff9a7a'],
}
CONTORNO = '#140c1e'

def hexa(c):
    c = c.lstrip('#'); return tuple(int(c[i:i+2], 16) for i in (0, 2, 4)) + (255,)

yy, xx = np.mgrid[0:N, 0:N].astype(float)
xx += 0.5; yy += 0.5

def elipse(cx, cy, rx, ry, ang=0.0, so=None):
    a = np.radians(ang); c, s = np.cos(a), np.sin(a)
    dx, dy = xx - cx, yy - cy
    u = ( dx * c + dy * s) / rx
    v = (-dx * s + dy * c) / ry
    m = u * u + v * v <= 1.0
    if so: m &= so(xx, yy)
    z = np.sqrt(np.clip(1 - u * u - v * v, 0, 1))
    nx, ny = u * c - v * s, u * s + v * c          # volta para o espaço da tela
    return m, np.stack([nx, ny, z], -1)

def retangulo(x0, y0, x1, y1, modo='cil_v'):
    m = (xx >= x0) & (xx < x1 + 1) & (yy >= y0) & (yy < y1 + 1)
    cx, cy = (x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2
    hw, hh = (x1 + 1 - x0) / 2, (y1 + 1 - y0) / 2
    if modo == 'cil_v':   # cilindro em pé: a luz varia da esquerda para a direita
        u = np.clip((xx - cx) / hw, -1, 1); n = np.stack([u, np.zeros_like(u) - .25, np.sqrt(1 - u * u)], -1)
    elif modo == 'cil_h': # cilindro deitado: varia de cima para baixo
        v = np.clip((yy - cy) / hh, -1, 1); n = np.stack([np.zeros_like(v) - .25, v, np.sqrt(1 - v * v)], -1)
    else:                 # face plana virada para a frente, com um leve degradê
        v = np.clip((yy - cy) / hh, -1, 1)
        n = np.stack([np.zeros_like(v) - .15, v * .45, np.ones_like(v)], -1)
    n = n / np.linalg.norm(n, axis=-1, keepdims=True)
    return m, n

def desenhar(partes, cortes=(-0.05, 0.38, 0.74)):
    tom = np.full((N, N), -1); mat = np.full((N, N), '', dtype=object); pid = np.full((N, N), -1)
    for i, (forma, material) in enumerate(partes):
        m, n = forma
        luz = n @ LUZ
        t = np.digitize(luz, cortes) + 1                 # 1..4
        tom[m] = t[m]; mat[m] = material; pid[m] = i
    # Linha interna: onde uma parte encosta em outra que está na frente dela
    # (ou atrás), a borda vira o tom mais escuro do próprio material.
    borda = tom.copy()
    for y in range(N):
        for x in range(N):
            if pid[y, x] < 0: continue
            for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                X, Y = x + dx, y + dy
                if 0 <= X < N and 0 <= Y < N and pid[Y, X] >= 0 and pid[Y, X] != pid[y, x] and pid[Y, X] > pid[y, x]:
                    borda[y, x] = 0
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0)); p = img.load()
    for y in range(N):
        for x in range(N):
            if pid[y, x] >= 0: p[x, y] = hexa(RAMPAS[mat[y, x]][borda[y, x]])
    # Contorno de fora: escuro do lado da sombra; do lado da luz usa o tom
    # mais escuro do material vizinho (o "selout" que suaviza a silhueta).
    for y in range(N):
        for x in range(N):
            if pid[y, x] >= 0: continue
            viz = [(x+dx, y+dy) for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)) if 0 <= x+dx < N and 0 <= y+dy < N and pid[y+dy, x+dx] >= 0]
            if not viz: continue
            do_lado_da_luz = all(X > x or Y > y for X, Y in viz)
            if do_lado_da_luz and len(viz) == 1:
                X, Y = viz[0]; p[x, y] = hexa(RAMPAS[mat[Y, X]][0])
            else:
                p[x, y] = hexa(CONTORNO)
    return img, p

def pontos(p, lista, cor):
    for x, y in lista: p[x, y] = hexa(cor)

# --- facetas e formas compostas -------------------------------------------

RAMPAS.update({
  'metal':      ['#1e2236', '#3c4462', '#6c7898', '#a8b4cc', '#eef2ff'],
  'roxo':       ['#1c0c30', '#3e1a5e', '#6a2e8e', '#9a54c0', '#d49af0'],
  'cristal':    ['#0c1c3a', '#14508a', '#2a9ad0', '#7adcf0', '#e6ffff'],
  'verde':      ['#0c2418', '#1a4a2a', '#2e7a3a', '#5aae4a', '#b6e88a'],
  'pergaminho': ['#4a2e1e', '#8a6440', '#c8a46a', '#e8d09a', '#fff4d0'],
  'telhado':    ['#2a0c14', '#6a1c22', '#a83a2c', '#d86a40', '#f4a868'],
  'parede':     ['#3a3040', '#7a6e78', '#bcb0a8', '#e4dccc', '#fffaf0'],
  'couro':      ['#1e0e0a', '#4a2416', '#7a3e22', '#a8602e', '#d89050'],
  'gema':       ['#1e0a2a', '#4a1a7a', '#8a3ad0', '#c47af0', '#f6d8ff'],
  'pao':        ['#3a1a0a', '#7a3e14', '#b8722a', '#e0a850', '#fbe0a0'],
  'pedra':      ['#1c1e2a', '#3a3e50', '#62687e', '#9298ac', '#cdd2e0'],
})

def dentro(pts):
    """Teste de ponto-no-polígono (raio horizontal), no centro de cada pixel."""
    m = np.zeros((N, N), bool); n = len(pts)
    for i in range(n):
        (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % n]
        cruza = ((y1 > yy) != (y2 > yy)) & (xx < (x2 - x1) * (yy - y1) / ((y2 - y1) or 1e-9) + x1)
        m ^= cruza
    return m

def faceta(pts, normal):
    """Polígono plano com uma normal fixa: é o que dá cara de pedra lapidada."""
    n = np.array(normal, float); n = n / np.linalg.norm(n)
    return dentro(pts), np.broadcast_to(n, (N, N, 3)).copy()

def anel(cx, cy, rx, ry, espessura, so=None, ang=0.0):
    _, ni = None, None
    mi, _ = elipse(cx, cy, rx - espessura, ry - espessura, ang)
    m, n = elipse(cx, cy, rx, ry, ang, so=so)
    return m & ~mi, n

def concavo(forma):
    """Mesma forma, luz invertida: parece afundado (selo de cera, moeda cunhada)."""
    m, n = forma; n = n.copy(); n[..., 0] *= -1; n[..., 1] *= -1
    return m, n

def px(p, lista, material, tom):
    for x, y in lista: p[x, y] = hexa(RAMPAS[material][tom])

def brilho(p, x, y, cor='#ffffff'):
    """Estrelinha de 4 pontas: o 'tlim' de item de jogo."""
    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        if 0 <= x + dx < N and 0 <= y + dy < N: p[x + dx, y + dy] = hexa(cor)

L, R, T = (-0.62, -0.25, 0.75), (0.62, -0.1, 0.78), (-0.2, -0.75, 0.63)   # normais de faceta prontas


def grade(n):
    """Troca o tamanho da tela de desenho (32 para os itens, 24 para as abas)."""
    global N, xx, yy
    N = n
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    xx += 0.5; yy += 0.5
