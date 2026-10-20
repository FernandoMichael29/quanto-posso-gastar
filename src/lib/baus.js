// Baús: caixinhas para guardar dinheiro. A planilha manda o saldo e o
// histórico de cada um; aqui se somam os movimentos que ainda estão só no
// aparelho (para guardar ser instantâneo, como o ouro de hoje) e se fazem as
// contas de "quando enche" e "quanto por mês".
//
// Rendimento: a planilha calcula (CDI do Banco Central, dia útil a dia útil)
// e manda o saldo já BRUTO, com `rende` (líquido, quanto rende por mês...).
// O acerto com o banco é uma linha tipo `rendimento`: muda o saldo, mas não é
// dinheiro guardado no mês.

import { somarMes } from './datas.js';

export const GUARDAR = 'guardar';
export const RESGATAR = 'resgatar';
export const RENDIMENTO = 'rendimento';

const z = (n) => String(n).padStart(2, '0');
const isoDia = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const arred = (v) => Math.round((Number(v) || 0) * 100) / 100;
const chave = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export const ehBau = (tipo) => tipo === GUARDAR || tipo === RESGATAR || tipo === RENDIMENTO;
/** O que o movimento faz com o saldo do baú (o acerto entra com o próprio sinal). */
const noSaldo = (l) => (l.tipo === RENDIMENTO ? Number(l.valor) || 0 : sinal(l.tipo) * (Number(l.valor) || 0));
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
    b.saldo = arred(b.saldo + noSaldo(l));
    b.movimentos.unshift({ ...l, uuid: item.uuid, pendente: true });
    if (l.tipo === RENDIMENTO) continue;   // acerto não é guardar: fica fora do mês e do ritmo
    const s = sinal(l.tipo) * (Number(l.valor) || 0);
    if (String(l.data || '').startsWith(mes)) b.guardado_mes = arred((b.guardado_mes || 0) + s);
    b.por_mes = { ...(b.por_mes || {}), [String(l.data).slice(0, 7)]: arred(((b.por_mes || {})[String(l.data).slice(0, 7)] || 0) + s) };
  }

  const total = arred(baus.reduce((a, b) => a + (Number(b.saldo) || 0), 0));
  const guardadoMes = arred(baus.reduce((a, b) => a + (Number(b.guardado_mes) || 0), 0));
  const rendeuMes = arred(baus.reduce((a, b) => a + (Number(b.rende?.por_mes_rendimento?.[mes]) || 0), 0));
  const algumRende = baus.some((b) => b.rende?.tipo);
  return { total, guardadoMes, rendeuMes, algumRende, baus };
}

/** O total para a pílula do topo: o do painel mais o que está na fila. */
export function totalNosBaus(painel, fila = [], opcoes = {}) {
  let total = Number(painel?.baus_total) || 0;
  const desde = opcoes.desde || 0;
  for (const item of fila) {
    const l = item.lancamento;
    if (l && ehBau(l.tipo) && aindaNaoVisto(item, desde)) total += noSaldo(l);
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

/** Quanto o saldo rende num mês, com o limite (até X rende uma taxa, acima rende outra). */
export function rendeNoMes(saldo, rende) {
  if (!rende?.tipo || !(saldo > 0)) return 0;
  const m1 = Number(rende.taxa_mes_ate) || 0;
  const m2 = rende.limite > 0 ? Number(rende.taxa_mes_acima) || 0 : m1;
  const ate = rende.limite > 0 ? Math.min(saldo, rende.limite) : saldo;
  return ate * m1 + (saldo - ate) * m2;
}

/** Meses até encher guardando `ritmo` por mês, com ou sem rendimento (null = não enche em 50 anos). */
function mesesParaEncher(saldo, meta, ritmo, rende) {
  let s = saldo;
  for (let n = 1; n <= 600; n++) {
    s += rendeNoMes(s, rende) + ritmo;
    if (s >= meta - 0.005) return n;
  }
  return null;
}

/**
 * As frases de baixo da barra: quanto falta, quando enche no ritmo de agora e,
 * com prazo, quanto guardar por mês para chegar a tempo. Baú que rende conta
 * o rendimento nas duas, e diz quantos meses ele adianta.
 */
export function previsao(bau, opcoes = {}) {
  const hoje = opcoes.hoje || isoDia(new Date());
  const mesHoje = hoje.slice(0, 7);
  const meta = Number(bau?.meta) || 0;
  const saldo = Number(bau?.saldo) || 0;
  const falta = arred(Math.max(0, meta - saldo));
  const ritmo = ritmoMensal(bau, mesHoje);
  const rende = bau?.rende?.tipo ? bau.rende : null;
  const saida = {
    falta, ritmo, cheio: meta > 0 && saldo >= meta, enche: null, porMes: null, mesesPrazo: null, atrasado: false,
    rende: !!rende, mesesAntes: 0
  };
  if (meta > 0 && falta > 0 && (ritmo > 0 || rende)) {
    // o mês corrente já conta como um dos meses de guardar
    const n = mesesParaEncher(saldo, meta, Math.max(0, ritmo), rende);
    if (n) saida.enche = somarMes(mesHoje, n - 1);
    if (rende && ritmo > 0 && n) saida.mesesAntes = Math.max(0, Math.ceil(falta / ritmo) - n);
  }
  if (meta > 0 && falta > 0 && bau.prazo) {
    const n = mesesAte(mesHoje, bau.prazo);
    saida.mesesPrazo = n;
    saida.atrasado = n <= 0;
    if (n <= 0) saida.porMes = falta;
    else if (!rende) saida.porMes = arred(falta / n);
    else {
      // o menor valor por mês que, com o rendimento, chega na meta em n meses
      let baixo = 0, alto = falta / n;
      for (let i = 0; i < 40; i++) {
        const meio = (baixo + alto) / 2;
        let s = saldo;
        for (let k = 0; k < n; k++) s += rendeNoMes(s, rende) + meio;
        if (s >= meta) alto = meio; else baixo = meio;
      }
      saida.porMes = arred(Math.ceil(alto * 100) / 100);
    }
  }
  return saida;
}

const ULTIMO_DIA = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${z(new Date(a, m, 0).getDate())}`;
};

/**
 * O histórico do baú com uma linha de rendimento por mês ("Rendeu em
 * setembro"), no último dia do mês — ou hoje, no mês corrente. Linhas virtuais:
 * não existem na planilha, não se editam.
 */
export function historicoComRendimento(bau, opcoes = {}) {
  const hoje = opcoes.hoje || isoDia(new Date());
  const porMes = bau?.rende?.por_mes_rendimento || {};
  const virtuais = Object.keys(porMes)
    .filter((m) => Math.abs(Number(porMes[m]) || 0) >= 0.01)
    .map((m) => ({
      uuid: `rendeu-${m}`, tipo: 'rendeu', virtual: true, valor: arred(porMes[m]),
      mes: m, ate_agora: m === hoje.slice(0, 7),
      data: m === hoje.slice(0, 7) ? hoje : ULTIMO_DIA(m)
    }));
  // do mais novo para o mais antigo; no mesmo dia, o rendimento vem primeiro
  const todos = [...virtuais, ...(bau?.movimentos || [])];
  return todos
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (a.x.data < b.x.data ? 1 : a.x.data > b.x.data ? -1 : a.i - b.i))
    .map(({ x }) => x);
}

/** "R$ 12 por mês a cada R$ 1.000": o quanto a taxa rende, para o formulário. */
export function rendePorMil(tipo, pct, cdiAnual) {
  const p = Number(String(pct).replace(',', '.')) || 0;
  if (!(p > 0)) return 0;
  if (tipo === 'cdi') {
    const dia = Math.pow(1 + (Number(cdiAnual) || 13.65) / 100, 1 / 252) - 1;
    return 1000 * (Math.pow(1 + dia * p / 100, 21) - 1);
  }
  if (tipo === 'fixo') return 1000 * (Math.pow(1 + p / 100, 1 / 12) - 1);
  return 0;
}
