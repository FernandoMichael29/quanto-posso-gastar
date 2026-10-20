// O relatório da aventura: o resumo do mês que fechou, mostrado uma vez nos
// primeiros dias do mês seguinte (por celular). A conta mora aqui para os
// testes rodarem no node; o desenho é componentes/RelatorioAventura.jsx.

import { metaDoMes } from './ouro.js';
import { CONQUISTAS } from './missao.js';
import { guardadoEmDupla } from './personagem.js';

const CHAVE = 'qpg.relatorio.visto';
export const DIAS_PARA_MOSTRAR = 7;
const arred = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** "2026-10-03" → "2026-09" */
export function mesAnterior(hoje) {
  let [a, m] = hoje.split('-').map(Number);
  m -= 1;
  if (m < 1) { m = 12; a -= 1; }
  return `${a}-${String(m).padStart(2, '0')}`;
}

/** Mostra nos primeiros 7 dias do mês, se este celular ainda não viu o do mês passado. */
export function deveMostrarRelatorio(hoje, visto) {
  return Number(hoje.slice(8, 10)) <= DIAS_PARA_MOSTRAR && visto !== mesAnterior(hoje);
}

// --- O relatório do ano: na primeira semana de janeiro, o ano que passou ------
const CHAVE_ANO = 'qpg.relatorio.ano.visto';

/** "2027-01-03" → "2026" */
export function anoAnterior(hoje) {
  return String(Number(hoje.slice(0, 4)) - 1);
}

/** Nos 7 primeiros dias de janeiro, se este celular ainda não viu o do ano passado. */
export function deveMostrarRelatorioAno(hoje, visto) {
  return hoje.slice(5, 7) === '01' && Number(hoje.slice(8, 10)) <= DIAS_PARA_MOSTRAR && visto !== anoAnterior(hoje);
}

export function relatorioAnoVisto() {
  try { return localStorage.getItem(CHAVE_ANO) || ''; } catch { return ''; }
}
export function marcarRelatorioAnoVisto(ano) {
  try { localStorage.setItem(CHAVE_ANO, ano); } catch { /* aparece de novo, sem dano */ }
}

/** O nome do mês que mais sobrou/menos sobrou já vem da planilha; aqui só a frase da capa. */
export function fraseDoAno(r) {
  if (!r || !r.meses_com_movimento) return '';
  const azul = r.no_azul === r.meses_com_movimento
    ? `fechou todos os ${r.meses_com_movimento} meses no azul`
    : `fechou ${r.no_azul} de ${r.meses_com_movimento} meses no azul`;
  return azul;
}

export function relatorioVisto() {
  try { return localStorage.getItem(CHAVE) || ''; } catch { return ''; }
}
export function marcarRelatorioVisto(mes) {
  try { localStorage.setItem(CHAVE, mes); } catch { /* sem armazenamento: aparece de novo, sem dano */ }
}

/**
 * Os números do mês fechado, a partir do painel daquele mês.
 * Sem movimento nenhum devolve null (não há aventura para contar).
 */
export function relatorioDoMes(painel, mes) {
  if (!painel) return null;
  const receitas = arred(painel.receitas);
  const despesas = arred(painel.despesas);
  if (!receitas && !despesas && !Number(painel.guardado_mes)) return null;

  const sobrou = arred(painel.previsao?.sobra ?? receitas - despesas);
  const guardado = arred(painel.guardado_mes);
  const fixas = painel.fixas || [];
  const meta = metaDoMes(painel.metas, mes);
  const maior = [...(painel.por_categoria || [])]
    .filter((c) => Number(c.total) > 0)
    .sort((a, b) => b.total - a.total)[0] || null;
  const conquistas = CONQUISTAS.filter((c) => String((painel.conquistas || {})[c.id] || '').startsWith(mes));

  return {
    mes,
    receitas,
    despesas,
    sobrou,
    noAzul: sobrou > 0,
    guardado,
    dupla: guardadoEmDupla(painel.guardado_por_pessoa),
    chefes: { derrotados: fixas.filter((f) => f.lancado).length, total: fixas.length },
    missao: meta > 0 ? { meta, cumprida: sobrou >= meta } : null,
    // o "dragão" do mês: a categoria que mais levou ouro
    dragao: maior ? { nome: maior.nome, total: arred(maior.total) } : null,
    conquistas
  };
}
