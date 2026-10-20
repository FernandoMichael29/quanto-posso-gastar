// A missão do mês (guardar um valor) e as conquistas.
//
//   guardado   = o que sobra no fim do mês se ele terminar assim (a mesma
//                previsão do Resumo), já contando o que está só no aparelho
//   XP         = guardado ÷ meta
//
// A meta vem da planilha com vigência ([{ desde: 'aaaa-mm', valor }]): a de
// cada mês é a última que começou até ele. Os meses fechados vêm da
// evolução do painel (os últimos 12), comparados com a meta que valia neles.
//
// Conquistas são calculadas aqui a partir dos dados; o script só guarda quais
// já foram ganhas (e quando), para nenhuma sumir quando o mês vira.

import { metaDoMes, pendentesDoMes } from './ouro.js';
import { calcularMana } from './mana.js';

export { metaDoMes };

const z = (n) => String(n).padStart(2, '0');
const isoDia = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const arred = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** A ordem aqui é a ordem na tela (e na folha de medalhas). */
export const CONQUISTAS = [
  { id: 'primeira_missao', nome: 'Missão aceita', como: 'Defina quanto quer guardar por mês.' },
  { id: 'fase_limpa', nome: 'Fase limpa', como: 'Lance todas as contas fixas de um mês.' },
  { id: 'bolso_trancado', nome: 'Bolso trancado', como: 'Passe um dia inteiro sem gastar nada, entre dois dias com registro.' },
  { id: 'mana_intacta', nome: 'Mana intacta', como: 'Chegue ao dia 20 sem estourar o teto de nenhuma categoria.' },
  { id: 'no_azul', nome: 'No azul', como: 'Feche um mês com dinheiro sobrando.' },
  { id: 'trinca', nome: 'Trinca', como: 'Feche três meses seguidos no azul.' },
  { id: 'formiguinha', nome: 'Formiguinha', como: 'Cumpra a missão de guardar num mês fechado.' },
  { id: 'guardiao', nome: 'Guardião do cofre', como: 'Cumpra a missão de guardar três meses seguidos.' },
  { id: 'bau_cheio', nome: 'Baú cheio', como: 'Encha a meta de um baú.' },
  { id: 'fogo_aceso', nome: 'Fogo aceso', como: 'Mantenha a fogueira da casa acesa 7 dias seguidos.' },
  { id: 'chama_eterna', nome: 'Chama eterna', como: 'Mantenha a fogueira da casa acesa 30 dias seguidos.' },
  { id: 'dupla_dinamica', nome: 'Dupla dinâmica', como: 'Os dois guardam dinheiro num baú no mesmo mês.' },
  { id: 'juros_a_favor', nome: 'Juros a favor', como: 'Baús e contas rendem R$ 100, somando tudo.' },
  { id: 'cacador_pontual', nome: 'Caçador pontual', como: 'Pague todas as contas fixas do mês até o dia do vencimento.' }
];

/** As contas fixas do mês, todas pagas até o dia de vencer (fixa sem dia não atrapalha). */
export function todasNoPrazo(fixas) {
  const lista = (fixas || []).filter((f) => f.tipo !== 'receita');
  return lista.length > 0 && lista.every((f) => f.lancado && (!(Number(f.dia) > 0) ||
    (/^\d{4}-\d{2}-\d{2}/.test(f.data_lancado || '') && Number(f.data_lancado.slice(8, 10)) <= Number(f.dia))));
}

/** Meses fechados da evolução, com a meta que valia em cada um. */
export function mesesFechados(painel, mesHoje) {
  return (painel?.evolucao || [])
    .filter((e) => !e.futuro && e.mes < mesHoje)
    .map((e) => {
      const saldo = Number(e.saldo ?? (e.receitas - e.despesas)) || 0;
      const teveMovimento = (Number(e.receitas) || 0) > 0 || (Number(e.despesas) || 0) > 0;
      const meta = metaDoMes(painel.metas, e.mes);
      return {
        mes: e.mes,
        saldo: arred(saldo),
        meta,
        azul: teveMovimento && saldo > 0,
        cumprida: teveMovimento && meta > 0 && saldo >= meta
      };
    });
}

/** A maior sequência de meses seguidos que atendem `cond`. */
export function seguidos(meses, cond) {
  let melhor = 0;
  let atual = 0;
  for (const m of meses) {
    atual = cond(m) ? atual + 1 : 0;
    melhor = Math.max(melhor, atual);
  }
  return melhor;
}

/**
 * A missão do mês que está correndo.
 * @returns null se o painel não é deste mês; senão { meta, guardado, fracao, ... }
 */
export function calcularMissao(painel, fila = [], opcoes = {}) {
  if (!painel?.previsao) return null;
  const agora = opcoes.agora || new Date();
  const hoje = isoDia(agora);
  const mes = hoje.slice(0, 7);
  if (painel.mes && painel.mes !== mes) return null;

  const meta = metaDoMes(painel.metas, mes);
  const p = pendentesDoMes(fila, { mes, hoje, desde: opcoes.desde || 0 });
  const guardado = arred((Number(painel.previsao.sobra) || 0) + p.livre);
  // A parte da missão que já está trancada em baú (não volta a ser gasta sem
  // um resgate de propósito).
  const garantido = arred(Math.max(0, (Number(painel.guardado_mes) || 0) + p.guardado));
  const fechados = mesesFechados(painel, mes);

  return {
    meta,
    guardado,
    garantido,
    fracao: meta > 0 ? Math.max(0, Math.min(1, guardado / meta)) : null,
    cumprida: meta > 0 && guardado >= meta,
    falta: meta > 0 ? arred(Math.max(0, meta - guardado)) : 0,
    cumpridasSeguidas: seguidos(fechados, (m) => m.cumprida),
    fechados
  };
}

/** Dias do mês sem nenhum gasto, entre o primeiro e o último dia com gasto. */
function diasSemGasto(painel) {
  const dias = (painel?.por_dia || []).filter((d) => Number(d.total) > 0).map((d) => d.dia).sort();
  if (dias.length < 2) return [];
  const comGasto = new Set(dias);
  const vazios = [];
  const [a, m, d0] = dias[0].split('-').map(Number);
  const fim = dias[dias.length - 1];
  for (let d = d0 + 1; ; d++) {
    const iso = isoDia(new Date(a, m - 1, d));
    if (iso >= fim) break;
    if (!comGasto.has(iso)) vazios.push(iso);
  }
  return vazios;
}

/**
 * Quais conquistas os dados de agora já dão. Serve para qualquer mês aberto no
 * Mês: uma fase limpa em agosto também conta.
 */
export function conquistasMerecidas(painel, fila = [], opcoes = {}) {
  const ganhas = new Set();
  if (!painel) return ganhas;
  const agora = opcoes.agora || new Date();
  const mesHoje = isoDia(agora).slice(0, 7);
  const mesPainel = painel.mes || mesHoje;

  if ((painel.metas || []).some((m) => Number(m.valor) > 0)) ganhas.add('primeira_missao');

  const fixas = (painel.fixas || []).filter((f) => f.tipo !== 'receita');
  if (fixas.length > 0 && fixas.every((f) => f.lancado)) ganhas.add('fase_limpa');

  if (diasSemGasto(painel).length > 0) ganhas.add('bolso_trancado');

  const mana = calcularMana(painel, mesPainel === mesHoje ? fila : [], opcoes);
  const chegouNoDia20 = mesPainel < mesHoje || (mesPainel === mesHoje && agora.getDate() >= 20);
  if (mana.length > 0 && chegouNoDia20 && mana.every((m) => m.mana >= 0)) ganhas.add('mana_intacta');

  const fechados = mesesFechados(painel, mesHoje);
  if (fechados.some((m) => m.azul)) ganhas.add('no_azul');
  if (seguidos(fechados, (m) => m.azul) >= 3) ganhas.add('trinca');
  if (fechados.some((m) => m.cumprida)) ganhas.add('formiguinha');
  if (seguidos(fechados, (m) => m.cumprida) >= 3) ganhas.add('guardiao');

  // As que dependem do que só a planilha sabe (baús, fogueira, rendimento).
  if (painel.marcos?.bau_cheio) ganhas.add('bau_cheio');
  if ((Number(painel.marcos?.rendeu_total) || 0) >= 100) ganhas.add('juros_a_favor');
  const recorde = Math.max(Number(painel.fogueira?.recorde) || 0, Number(opcoes.fogueira) || 0);
  if (recorde >= 7) ganhas.add('fogo_aceso');
  if (recorde >= 30) ganhas.add('chama_eterna');
  const guardaram = Object.entries(painel.guardado_por_pessoa || {}).filter(([quem, v]) => quem && Number(v) > 0);
  if (guardaram.length >= 2) ganhas.add('dupla_dinamica');
  if (todasNoPrazo(painel.fixas)) ganhas.add('cacador_pontual');

  return ganhas;
}

/** O nível: começa no 1 e sobe um por conquista. */
export function nivel(quantas) {
  return 1 + (Number(quantas) || 0);
}
