// Teste dos baús. Rode com:  node testes/baus.test.mjs
import assert from 'node:assert';
import { comPendentes, estadoDoBau, historicoComRendimento, mesesAte, previsao, rendeNoMes, rendePorMil, ritmoMensal, totalNosBaus } from '../src/lib/baus.js';
import { calcularOuro } from '../src/lib/ouro.js';
import { calcularMissao } from '../src/lib/missao.js';
import { calcularMana } from '../src/lib/mana.js';

const arred2 = (v) => Math.round(v * 100) / 100;

// o desenho
assert.strictEqual(estadoDoBau(0, 1000), 'vazio');
assert.strictEqual(estadoDoBau(100, 1000), 'comecando');
assert.strictEqual(estadoDoBau(500, 1000), 'metade');
assert.strictEqual(estadoDoBau(1000, 1000), 'cheio');
assert.strictEqual(estadoDoBau(300, 0), 'metade', 'sem meta, com dinheiro: aberto');

// ritmo e previsão (hoje: 20/10/2026)
const hoje = '2026-10-20';
const chile = { nome: 'Viagem Chile', meta: 6000, saldo: 1800, prazo: '2027-07', por_mes: { '2026-08': 600, '2026-09': 600, '2026-10': 600 } };
assert.strictEqual(ritmoMensal(chile, '2026-10'), 600);
assert.strictEqual(ritmoMensal({ por_mes: { '2026-10': 300 } }, '2026-10'), 300, 'baú novo: só os meses desde o primeiro depósito');
assert.strictEqual(ritmoMensal({ por_mes: {} }, '2026-10'), 0);
assert.strictEqual(mesesAte('2026-10', '2027-07'), 10);
let p = previsao(chile, { hoje });
assert.strictEqual(p.falta, 4200);
assert.strictEqual(p.enche, '2027-04', '4200 ÷ 600 = 7 meses, contando outubro');
assert.strictEqual(p.porMes, 420, '4200 em 10 meses até julho');
assert.strictEqual(previsao({ ...chile, saldo: 6100 }, { hoje }).cheio, true);
assert.strictEqual(previsao({ ...chile, prazo: '2026-09' }, { hoje }).atrasado, true, 'prazo que já passou');

// fila: guardar aparece na hora
const resposta = { total: 1800, baus: [{ ...chile, guardado_mes: 600, movimentos: [{ uuid: 'a', tipo: 'guardar', valor: 600, data: '2026-10-05' }] }] };
const fila = [
  { uuid: 'p1', estado: 'pendente', lancamento: { tipo: 'guardar', valor: 300, categoria: 'viagem chile', data: '2026-10-20' } },
  { uuid: 'p2', estado: 'pendente', lancamento: { tipo: 'resgatar', valor: 50, categoria: 'Viagem Chile', data: '2026-10-20' } },
  { uuid: 'p3', estado: 'sincronizado', ultima_tentativa: 10, lancamento: { tipo: 'guardar', valor: 999, categoria: 'Viagem Chile', data: '2026-10-01' } },
  { uuid: 'p4', estado: 'pendente', lancamento: { tipo: 'despesa', valor: 70, categoria: 'Lazer', data: '2026-10-20' } }
];
const c = comPendentes(resposta, fila, { desde: 100, hoje });
assert.strictEqual(c.baus[0].saldo, 2050, '1800 + 300 − 50; o já sincronizado antes da resposta não conta de novo');
assert.strictEqual(c.baus[0].guardado_mes, 850);
assert.strictEqual(c.baus[0].movimentos[0].pendente, true);
assert.strictEqual(c.baus[0].movimentos.length, 3);
assert.strictEqual(c.total, 2050);
assert.strictEqual(resposta.baus[0].saldo, 1800, 'não mexe na resposta original');
assert.strictEqual(totalNosBaus({ baus_total: 1800 }, fila, { desde: 100 }), 2050);

// o ouro: guardar sai do livre; em direção à missão, não derruba de novo
const agora = new Date(2026, 9, 20, 12);   // faltam 12 dias
const painel = { mes: '2026-10', receitas: 6800, previsao: { sobra: 2400, ainda_entra: 0 }, guardado_mes: 0 };
assert.strictEqual(calcularOuro(painel, [], { agora }).ouro, 200, 'sem baú: 2400 ÷ 12');
const guardou = [{ estado: 'pendente', lancamento: { tipo: 'guardar', valor: 600, categoria: 'Chile', data: '2026-10-20' } }];
let o = calcularOuro(painel, guardou, { agora });
assert.strictEqual(o.livre, 1800, 'guardar 600 tira 600 do livre');
assert.strictEqual(o.ouro, 150);
assert.strictEqual(o.gastoHoje, 0, 'guardar não é gasto de hoje');
const comMissao = { ...painel, metas: [{ desde: '2026-01', valor: 1200 }] };
assert.strictEqual(calcularOuro(comMissao, [], { agora }).livre, 1200, 'missão de 1200 separada');
assert.strictEqual(calcularOuro(comMissao, guardou, { agora }).livre, 1200, 'guardar 600 da missão não derruba o ouro de novo');
assert.strictEqual(calcularOuro({ ...comMissao, guardado_mes: 1000 }, guardou, { agora }).livre, 800, 'guardar além da missão derruba');
const resgatou = [{ estado: 'pendente', lancamento: { tipo: 'resgatar', valor: 300, categoria: 'Chile', data: '2026-10-20' } }];
assert.strictEqual(calcularOuro(painel, resgatou, { agora }).livre, 2700, 'resgatar devolve ao mês');

// missão: XP é a sobra; o guardado é a parte garantida
const m = calcularMissao({ ...comMissao, guardado_mes: 400 }, guardou, { agora });
assert.strictEqual(m.guardado, 2400, 'XP não muda por guardar');
assert.strictEqual(m.garantido, 1000, '400 + 600 já trancados em baú');

// mana: guardar não gasta mana de categoria nenhuma
const mana = calcularMana({ mes: '2026-10', orcamentos: { Chile: 500 }, por_categoria: [] }, guardou, { agora });
assert.strictEqual(mana[0].mana, 500);

// rendimento: a planilha manda as taxas do mês; aqui só se projeta
const turbo = { ...chile, rende: { tipo: 'cdi', pct: 115, limite: 5000, acima: 100, taxa_mes_ate: 0.0123, taxa_mes_acima: 0.0107,
  por_mes_rendimento: { '2026-09': 18.4, '2026-10': 16.42, '2026-08': 0 } }, movimentos: [{ uuid: 'm1', tipo: 'guardar', valor: 600, data: '2026-10-05' }, { uuid: 'm0', tipo: 'guardar', valor: 600, data: '2026-09-30' }] };
assert.strictEqual(arred2(rendeNoMes(1000, turbo.rende)), 12.3);
assert.strictEqual(arred2(rendeNoMes(6000, turbo.rende)), arred2(5000 * 0.0123 + 1000 * 0.0107), 'acima do limite rende menos');
assert.strictEqual(rendeNoMes(1000, { tipo: '' }), 0);
const pr = previsao(turbo, { hoje });
assert.ok(pr.enche <= '2027-04', 'com rendimento enche no máximo quando enchia sem: ' + pr.enche);
assert.ok(pr.mesesAntes >= 0);
assert.ok(pr.porMes < 420 && pr.porMes > 350, 'até o prazo, o rendimento ajuda: ' + pr.porMes);
const soRendendo = previsao({ ...turbo, por_mes: {}, meta: 1900 }, { hoje });
assert.ok(soRendendo.enche, 'sem guardar nada, só o rendimento ainda enche');
const hist = historicoComRendimento(turbo, { hoje });
assert.deepStrictEqual(hist.map((h) => h.uuid), ['rendeu-2026-10', 'm1', 'rendeu-2026-09', 'm0'], 'uma linha por mês, mês zerado some, no último dia (ou hoje)');
assert.strictEqual(hist[0].data, hoje);
assert.strictEqual(hist[0].ate_agora, true);
assert.strictEqual(hist[2].data, '2026-09-30');
assert.ok(Math.abs(rendePorMil('cdi', '115', 13.65) - 12.3) < 0.3, 'uns R$ 12 a cada mil');
assert.ok(Math.abs(rendePorMil('fixo', '12', 0) - 9.49) < 0.01);
// acerto com o banco: muda o saldo, não o guardado do mês
const comAcerto = comPendentes(resposta, [{ uuid: 'q1', estado: 'pendente', lancamento: { tipo: 'rendimento', valor: -2.5, categoria: 'Viagem Chile', data: '2026-10-20' } }], { hoje });
assert.strictEqual(comAcerto.baus[0].saldo, 1797.5);
assert.strictEqual(comAcerto.baus[0].guardado_mes, 600);
assert.strictEqual(totalNosBaus({ baus_total: 1800 }, [{ estado: 'pendente', lancamento: { tipo: 'rendimento', valor: 0.7 } }]), 1800.7);
const acertoNaFila = [{ estado: 'pendente', lancamento: { tipo: 'rendimento', valor: 5, categoria: 'Chile', data: '2026-10-20' } }];
assert.strictEqual(calcularOuro(painel, acertoNaFila, { agora }).ouro, 200, 'acerto não mexe no ouro de hoje');

console.log('baús: ok');
