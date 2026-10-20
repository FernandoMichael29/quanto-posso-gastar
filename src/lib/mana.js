// A mana de cada categoria: o teto do mês menos o que já foi gasto nela.
//
// O teto vem da planilha (aba categorias, coluna orcamento_mes, preenchida em
// Ajustes → Categorias). Só categoria com teto tem mana; as outras não aparecem.
//
//   mana    = teto − gasto
//   fração  = mana ÷ teto           (1 = cheia, 0 = acabou)
//   ritmo   = o quanto deveria sobrar hoje se o teto fosse gasto por igual
//             no mês (dia 15 de 30 → 0,5). Só no mês que está correndo.
//
// Como no ouro de hoje, o que ainda está só no aparelho já conta: registrar
// um gasto gasta a mana na hora, sem esperar a planilha.

import { diasRestantes, pendentesDoMes } from './ouro.js';

const z = (n) => String(n).padStart(2, '0');
const isoDia = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const arred = (v) => Math.round((Number(v) || 0) * 100) / 100;
const chave = (c) => String(c || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Abaixo disso a barra fica vermelha: está perto de estourar. */
export const MANA_BAIXA = 0.25;

/** Em que pé está uma fração de mana. */
export function estadoDaMana(fracao) {
  if (fracao <= 0) return 'vazia';
  if (fracao <= MANA_BAIXA) return 'baixa';
  return 'cheia';
}

/**
 * @param painel  resposta de api.painel() (qualquer mês)
 * @param fila    itens do aparelho; só contam no mês que está correndo
 * @param opcoes  { agora: Date, desde: quando o painel foi pedido (ms) }
 * @returns lista ordenada da mais apertada para a mais folgada, ou [] sem tetos
 */
export function calcularMana(painel, fila = [], opcoes = {}) {
  const tetos = painel?.orcamentos || {};
  const nomes = Object.keys(tetos).filter((c) => Number(tetos[c]) > 0);
  if (!nomes.length) return [];

  const agora = opcoes.agora || new Date();
  const hoje = isoDia(agora);
  const mesCorrendo = !painel.mes || painel.mes === hoje.slice(0, 7);

  const gastos = {};
  for (const c of painel.por_categoria || []) {
    const k = chave(c.nome ?? c.categoria);
    gastos[k] = (gastos[k] || 0) + (Number(c.total) || 0);
  }
  if (mesCorrendo) {
    const p = pendentesDoMes(fila, { mes: hoje.slice(0, 7), hoje, desde: opcoes.desde || 0 });
    for (const [k, v] of Object.entries(p.porCategoria)) gastos[chave(k)] = (gastos[chave(k)] || 0) + v;
  }

  let ritmo = null;
  let dias = null;
  if (mesCorrendo) {
    dias = diasRestantes(agora);
    const doMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
    ritmo = 1 - (agora.getDate() - 1) / doMes;   // começo do dia de hoje
  }

  return nomes.map((categoria) => {
    const teto = Number(tetos[categoria]);
    const gasto = arred(gastos[chave(categoria)] || 0);
    const mana = arred(teto - gasto);
    const fracao = Math.max(0, Math.min(1, mana / teto));
    return {
      categoria,
      teto,
      gasto,
      mana,
      fracao,
      estado: estadoDaMana(mana / teto),
      ritmo,
      // quanto dá para gastar nela por dia daqui até o fim do mês
      dias,
      porDia: dias ? arred(Math.max(0, mana) / dias) : null,
      // gastando mais rápido do que o mês anda (só avisa com folga de 5 pontos)
      apressada: ritmo !== null && mana > 0 && fracao < ritmo - 0.05
    };
  }).sort((a, b) => a.fracao - b.fracao || b.gasto - a.gasto);
}

/** A mana de uma categoria (ou null se ela não tem teto). */
export function manaDe(lista, categoria) {
  const k = chave(categoria);
  return (lista || []).find((m) => chave(m.categoria) === k) || null;
}

/** Quanto sobra da mana depois de um gasto de `valor` (pode ficar negativo). */
export function depoisDoGasto(m, valor) {
  return arred(m.mana - (Number(valor) || 0));
}
