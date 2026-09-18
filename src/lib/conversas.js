// As análises já pagas, guardadas neste aparelho.
//
// Cada pergunta custa dinheiro, então nenhuma resposta deveria se perder. O
// script grava todas na planilha; aqui fica uma cópia local para o histórico
// abrir na hora, inclusive sem internet, e só atualizar quando der.

import { api } from './api.js';

const CHAVE = 'qpg.conversas';
const MAXIMO = 30;

export function lerCache() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE) || '[]');
    return Array.isArray(salvo) ? salvo : [];
  } catch {
    return [];
  }
}

function salvarCache(lista) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(lista.slice(0, MAXIMO)));
  } catch {
    // Sem espaço ou em modo privado: o histórico continua vindo da planilha.
  }
}

/**
 * Busca as últimas conversas na planilha e atualiza a cópia local.
 * Sem internet, devolve o que já está guardado aqui.
 */
export async function sincronizar(limite = MAXIMO) {
  const r = await api.conversas(limite);
  if (!r.ok || !Array.isArray(r.conversas)) return { lista: lerCache(), ok: false, erro: r.erro };
  salvarCache(r.conversas);
  return { lista: r.conversas, ok: true };
}

/** Apaga na planilha e aqui. */
export async function excluir(data) {
  const r = await api.excluirConversa(data);
  // 'nao_encontrado' também limpa: a linha já não existe lá.
  if (r.ok || r.erro === 'nao_encontrado') {
    salvarCache(lerCache().filter((c) => c.data !== data));
    return true;
  }
  return false;
}

/** Guarda uma análise recém-feita sem esperar a próxima sincronização. */
export function guardar(pergunta, analise) {
  const nova = {
    data: new Date().toISOString(),
    pergunta,
    resposta: String(analise.resposta || ''),
    custo_estimado: Number(analise.custo_estimado) || 0,
    analise
  };
  salvarCache([nova, ...lerCache().filter((c) => c.data !== nova.data)]);
  return nova;
}

/** Quantas análises e quanto custaram no mês corrente. */
export function gastoDoMes(lista) {
  const mes = new Date().toISOString().slice(0, 7);
  const doMes = lista.filter((c) => String(c.data || '').slice(0, 7) === mes);
  return {
    quantas: doMes.length,
    total: doMes.reduce((a, c) => a + (Number(c.custo_estimado) || 0), 0)
  };
}
