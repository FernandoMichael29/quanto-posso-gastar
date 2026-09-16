// Escolha de tema.
//
// O padrão é seguir o sistema, que é o que a maioria quer e o que respeita o
// modo noturno do celular. Mas escuro não é uma coisa só: grafite não compete
// com as cores que carregam significado no app, e o preto real rende mais
// contraste e menos bateria numa tela OLED. A escolha é legítima, então ela
// existe — em vez de eu decidir por você.
//
// A preferência é deste aparelho (localStorage), não da planilha: é sobre a
// tela que você está olhando, não sobre o seu dinheiro.

const CHAVE = 'qpg.tema';

export const TEMAS = [
  { id: 'auto', rotulo: 'Automático', ajuda: 'segue o modo escuro do celular' },
  { id: 'claro', rotulo: 'Claro', ajuda: 'fundo branco, sempre' },
  { id: 'grafite', rotulo: 'Grafite', ajuda: 'escuro cinza, sem cor no fundo' },
  { id: 'oled', rotulo: 'Preto OLED', ajuda: 'preto real, poupa bateria na tela' }
];

export function lerTema() {
  try {
    const t = localStorage.getItem(CHAVE);
    return TEMAS.some((x) => x.id === t) ? t : 'auto';
  } catch {
    return 'auto';
  }
}

/** Aplica no <html>; o CSS faz o resto. */
export function aplicarTema(id) {
  const tema = TEMAS.some((x) => x.id === id) ? id : 'auto';
  document.documentElement.dataset.tema = tema;
  pintarBarraDoSistema(tema);
  return tema;
}

export function salvarTema(id) {
  const tema = aplicarTema(id);
  try { localStorage.setItem(CHAVE, tema); } catch { /* modo privado: vale só nesta sessão */ }
  return tema;
}

/**
 * A barra de status do Android pega a cor da meta theme-color. Sem isto, o
 * topo do sistema fica claro com o app preto — a emenda aparece.
 */
function pintarBarraDoSistema(tema) {
  const escuroDoSistema = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const cores = { claro: '#EEF2F0', grafite: '#0F1011', oled: '#000000' };
  const cor = cores[tema] || (escuroDoSistema ? '#0F1011' : '#EEF2F0');

  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = cor;
  document.head.appendChild(meta);
}
