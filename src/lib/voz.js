// Captura de voz.
//
// O reconhecimento do Chrome manda o áudio para os servidores do Google, então
// ele não funciona sem internet. Quando você está offline, o app cai para o
// ditado do próprio teclado do Android, que roda dentro do aparelho.

const Reconhecimento =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export function temReconhecimento() {
  return Boolean(Reconhecimento);
}

export function vozDisponivel() {
  return temReconhecimento() && navigator.onLine;
}

/**
 * Começa a escutar. Devolve um objeto com parar() e cancelar().
 *
 * @param {{
 *   aoTexto:(texto:string, final:boolean)=>void,
 *   aoFim:(texto:string)=>void,
 *   aoErro:(codigo:string)=>void
 * }} eventos
 */
export function escutar({ aoTexto, aoFim, aoErro }) {
  if (!Reconhecimento) {
    aoErro?.('sem_suporte');
    return { parar() {}, cancelar() {} };
  }

  const r = new Reconhecimento();
  r.lang = 'pt-BR';
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;

  let acumulado = '';
  let cancelado = false;

  r.onresult = (evento) => {
    let parcial = '';
    for (let i = evento.resultIndex; i < evento.results.length; i++) {
      const t = evento.results[i][0].transcript;
      if (evento.results[i].isFinal) acumulado += t;
      else parcial += t;
    }
    aoTexto?.((acumulado + parcial).trim(), Boolean(acumulado && !parcial));
  };

  r.onerror = (evento) => {
    if (cancelado) return;
    const mapa = {
      'no-speech': 'nao_ouvi',
      'audio-capture': 'sem_microfone',
      'not-allowed': 'sem_permissao',
      'service-not-allowed': 'sem_permissao',
      network: 'sem_rede'
    };
    aoErro?.(mapa[evento.error] || evento.error || 'erro_desconhecido');
  };

  r.onend = () => {
    if (cancelado) return;
    aoFim?.(acumulado.trim());
  };

  try {
    r.start();
  } catch {
    aoErro?.('ja_escutando');
  }

  return {
    parar() { try { r.stop(); } catch {} },
    cancelar() { cancelado = true; try { r.abort(); } catch {} }
  };
}

export const ERRO_VOZ = {
  sem_suporte: 'Este navegador não reconhece voz. Use o microfone do teclado no campo de texto.',
  nao_ouvi: 'Não ouvi nada. Tenta de novo.',
  sem_microfone: 'Não achei o microfone.',
  sem_permissao: 'Você precisa permitir o microfone para este site.',
  sem_rede: 'Sem internet — use o microfone do teclado no campo de texto, ele funciona offline.',
  ja_escutando: 'Já estou escutando.',
  erro_desconhecido: 'Deu algo errado no microfone.'
};
