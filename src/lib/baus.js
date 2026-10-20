// Baús: caixinhas para guardar dinheiro. A planilha manda o saldo e o
// histórico de cada um; aqui se somam os movimentos que ainda estão só no
// aparelho (para guardar ser instantâneo, como o ouro de hoje) e se fazem as
// contas de "quando enche" e "quanto por mês".

import { somarMes } from './datas.js';

export const GUARDAR = 'guardar';
export const RESGATAR = 'resgatar';

const z = (n) => String(n).padStart(2, '0');
const isoDia = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const arred = (v) => Math.round((Number(v) || 0) * 100) / 100;
const chave = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export const ehBau = (tipo) => tipo === GUARDAR || tipo === RESGATAR;
const sinal = (tipo) => (tipo === GUARDAR ? 1 : tipo === RESGATAR ? -1 : 0);

/** O desenho do baú: fechado, entreaberto, aberto ou transbordando. */
export function estadoDoBau(saldo, meta) {
  if (!(saldo > 0)) return 'vazio';
  if (!(meta > 0)) return 'metade';
  const f = saldo / meta;
  if (f >= 1) return 'cheio';
  if (f >= 0.5) return 'metade';
  return 'comecando';
}

/** Mesma regra do ouro de hoje: o que a planilha ainda não tinha quando respondeu. */
function aindaNaoVisto(item, desde) {
  return !(item.estado === 'sincronizado' && !(Number(item.ultima_tentativa) > desde));
}

/**
 * Os baús com os movimentos que ainda estão só no aparelho (ou subiram depois
 * da resposta da planilha). O movimento pendente entra no topo do histórico,
 * marcado como `pendente`.
 */
export function comPendentes(resposta, fila = [], opcoes = {}) {
  const desde = opcoes.desde || 0;
  const mes = (opcoes.hoje || isoDia(new Date())).slice(0, 7);
  const baus = (resposta?.baus || []).map((b) => ({ ...b, movimentos: [...(b.movimentos || [])] }));
  const porChave = new Map(baus.map((b) => [chave(b.nome), b]));

  for (const item of fila) {
    const l = item.lancamento;
    if (!l || !ehBau(l.tipo) || !aindaNaoVisto(item, desde)) continue;
    let b = porChave.get(chave(l.categoria));
    if (!b) {
      b = { nome: l.categoria, meta: 0, objetivo: '', prazo: '', saldo: 0, guardado_mes: 0, por_mes: {}, movimentos: [] };
      porChave.set(chave(l.categoria), b);
      baus.push(b);
    }
    const s = sinal(l.tipo) * (Number(l.valor) || 0);
    b.saldo = arred(b.saldo + s);
    if (String(l.data || '').startsWith(mes)) b.guardado_mes = arred((b.guardado_mes || 0) + s);
    b.por_mes = { ...(b.por_mes || {}), [String(l.data).slice(0, 7)]: arred(((b.por_mes || {})[String(l.data).slice(0, 7)] || 0) + s) };
    b.movimentos.unshift({ ...l, uuid: item.uuid, pendente: true });
  }

  const total = arred(baus.reduce((a, b) => a + (Number(b.saldo) || 0), 0));
  const guardadoMes = arred(baus.reduce((a, b) => a + (Number(b.guardado_mes) || 0), 0));
  return { total, guardadoMes, baus };
}

/** O total para a pílula do topo: o do painel mais o que está na fila. */
export function totalNosBaus(painel, fila = [], opcoes = {}) {
  let total = Number(painel?.baus_total) || 0;
  const desde = opcoes.desde || 0;
  for (const item of fila) {
    const l = item.lancamento;
    if (l && ehBau(l.tipo) && aindaNaoVisto(item, desde)) total += sinal(l.tipo) * (Number(l.valor) || 0);
  }
  return arred(total);
}

/**
 * Quanto entra por mês, em média, nos últimos 3 meses (contando o atual) —
 * só a partir do primeiro mês em que o baú recebeu dinheiro.
 */
export function ritmoMensal(bau, mesHoje) {
  const meses = Object.keys(bau?.por_mes || {}).sort();
  if (!meses.length) return 0;
  const janela = [];
  for (let i = 2; i >= 0; i--) {
    const m = somarMes(mesHoje, -i);
    if (m >= meses[0]) janela.push(m);
  }
  if (!janela.length) return 0;
  const soma = janela.reduce((a, m) => a + (Number(bau.por_mes[m]) || 0), 0);
  return arred(soma / janela.length);
}

/** Meses entre dois "aaaa-mm", contando os dois (out/26 → jul/27 = 10). */
export function mesesAte(de, ate) {
  const [a1, m1] = de.split('-').map(Number);
  const [a2, m2] = ate.split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1) + 1;
}

/**
 * As frases de baixo da barra: quanto falta, quando enche no ritmo de agora e,
 * com prazo, quanto guardar por mês para chegar a tempo.
 */
export function previsao(bau, opcoes = {}) {
  const hoje = opcoes.hoje || isoDia(new Date());
  const mesHoje = hoje.slice(0, 7);
  const meta = Number(bau?.meta) || 0;
  const saldo = Number(bau?.saldo) || 0;
  const falta = arred(Math.max(0, meta - saldo));
  const ritmo = ritmoMensal(bau, mesHoje);
  const saida = { falta, ritmo, cheio: meta > 0 && saldo >= meta, enche: null, porMes: null, mesesPrazo: null, atrasado: false };
  if (meta > 0 && falta > 0 && ritmo > 0) {
    // o mês corrente já conta como um dos meses de guardar
    saida.enche = somarMes(mesHoje, Math.ceil(falta / ritmo) - 1);
  }
  if (meta > 0 && falta > 0 && bau.prazo) {
    const n = mesesAte(mesHoje, bau.prazo);
    saida.mesesPrazo = n;
    saida.atrasado = n <= 0;
    saida.porMes = n > 0 ? arred(falta / n) : falta;
  }
  return saida;
}
