// O sincronizador. Percorre a fila e tenta resolver cada item.
//
// Dois tipos de item esperam aqui:
//   pendente       — já está interpretado, só falta chegar na planilha
//   aguardando_ia  — o texto está salvo, mas a IA não conseguiu interpretar
//                    (sem crédito, chave faltando, API fora). Não se perde.

import { api, configurado } from './api.js';
import { ESTADO, aFazer, atualizar, limparAntigos } from './db.js';

let rodando = false;
const ouvintes = new Set();

export function aoMudar(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function avisar() {
  ouvintes.forEach((f) => { try { f(); } catch {} });
}

// Motivos que não adianta tentar de novo agora: dependem de você.
const PRECISA_DE_VOCE = ['sem_creditos', 'chave_invalida', 'sem_chave', 'token_invalido'];

/** Espera crescente entre tentativas: 0s, 30s, 2min, 8min, 30min (teto). */
function esperaDe(tentativas) {
  const escala = [0, 30e3, 120e3, 480e3, 1800e3];
  return escala[Math.min(tentativas, escala.length - 1)];
}

function podeTentar(item) {
  if (!item.ultima_tentativa) return true;
  return Date.now() - item.ultima_tentativa >= esperaDe(item.tentativas);
}

/**
 * Roda uma passada na fila.
 * @returns {Promise<{enviados:number, aguardando:number, bloqueio:string|null}>}
 */
export async function sincronizar() {
  if (rodando) return { enviados: 0, aguardando: 0, bloqueio: null };
  if (!configurado()) return { enviados: 0, aguardando: 0, bloqueio: 'sem_configuracao' };
  if (!navigator.onLine) return { enviados: 0, aguardando: 0, bloqueio: 'sem_rede' };

  rodando = true;
  let enviados = 0, aguardando = 0, bloqueio = null;

  try {
    const fila = await aFazer();

    for (const item of fila) {
      if (!podeTentar(item)) { aguardando++; continue; }
      if (bloqueio && PRECISA_DE_VOCE.includes(bloqueio)) { aguardando++; continue; }

      await atualizar(item.uuid, { estado: ESTADO.ENVIANDO });
      avisar();

      // Uma chamada só resolve o item: o servidor interpreta se precisar e grava.
      const r = await api.capturar(item);

      if (r.ok) {
        await atualizar(item.uuid, {
          estado: ESTADO.SINCRONIZADO,
          motivo: '',
          lancamento: item.lancamento || r.lancamentos?.[0] || null,
          ultima_tentativa: Date.now()
        });
        enviados++;
      } else {
        if (PRECISA_DE_VOCE.includes(r.erro)) bloqueio = r.erro;
        await atualizar(item.uuid, {
          // Se o servidor já guardou o texto na planilha, o item local vira só
          // um espelho do que está esperando lá.
          estado: item.lancamento ? ESTADO.PENDENTE : ESTADO.AGUARDANDO_IA,
          motivo: r.erro,
          tentativas: item.tentativas + 1,
          ultima_tentativa: Date.now()
        });
        aguardando++;
      }
      avisar();
    }

    await limparAntigos();
  } finally {
    rodando = false;
    avisar();
  }

  return { enviados, aguardando, bloqueio };
}

/**
 * Pede ao navegador para sincronizar sozinho quando a internet voltar —
 * funciona mesmo com o app fechado.
 */
export async function pedirSyncEmSegundoPlano() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && 'sync' in reg) await reg.sync.register('qpg-sincronizar');
  } catch {
    // Navegador sem Background Sync: o app sincroniza ao abrir e ao voltar a rede.
  }
}

/** Liga os gatilhos automáticos de sincronização. */
export function ligarSincronizacaoAutomatica() {
  const tentar = () => { sincronizar(); pedirSyncEmSegundoPlano(); };

  window.addEventListener('online', tentar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tentar();
  });
  navigator.serviceWorker?.addEventListener?.('message', (e) => {
    if (e.data === 'qpg-sincronizar') sincronizar();
  });

  tentar();
  const relogio = setInterval(tentar, 60000);
  return () => { window.removeEventListener('online', tentar); clearInterval(relogio); };
}
