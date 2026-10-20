// Teste dos baús. Rode com:  node testes/baus.test.mjs
import assert from 'node:assert';
import { comPendentes, estadoDoBau, mesesAte, previsao, ritmoMensal, totalNosBaus } from '../src/lib/baus.js';
import { calcularOuro } from '../src/lib/ouro.js';
import { calcularMissao } from '../src/lib/missao.js';
import { calcularMana } from '../src/lib/mana.js';

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

console.log('baús: ok');
