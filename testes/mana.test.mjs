// Teste da mana por categoria. Rode com:  node testes/mana.test.mjs
import assert from 'node:assert';
import { calcularMana, depoisDoGasto, estadoDaMana, manaDe } from '../src/lib/mana.js';

const agora = new Date(2026, 9, 16, 12);   // 16/10: começo do dia 16 de 31 → ritmo 16/31
const painel = {
  mes: '2026-10',
  orcamentos: { Mercado: 800, 'Alimentação': 400, Lazer: 200, Transporte: 0 },
  por_categoria: [
    { nome: 'Mercado', total: 300 },
    { nome: 'Alimentacao', total: 340 },   // sem acento na planilha: casa igual
    { nome: 'Lazer', total: 260 },
    { nome: 'Transporte', total: 500 }     // teto 0 = sem mana
  ]
};

let m = calcularMana(painel, [], { agora });
assert.deepStrictEqual(m.map((x) => x.categoria), ['Lazer', 'Alimentação', 'Mercado'], 'só quem tem teto, da mais apertada para a mais folgada');

const lazer = manaDe(m, 'lazer');
assert.strictEqual(lazer.mana, -60, 'estourou: mana negativa');
assert.strictEqual(lazer.fracao, 0);
assert.strictEqual(lazer.estado, 'vazia');

const alim = manaDe(m, 'Alimentação');
assert.strictEqual(alim.mana, 60);
assert.strictEqual(alim.estado, 'baixa', '15% sobrando é perto de estourar');
assert.strictEqual(alim.apressada, true, 'no meio do mês com 15% sobrando: rápido demais');

const mercado = manaDe(m, 'Mercado');
assert.strictEqual(mercado.mana, 500);
assert.strictEqual(mercado.estado, 'cheia');
assert.strictEqual(mercado.apressada, false);
assert.strictEqual(mercado.dias, 16, 'faltam 16 dias contando hoje');
assert.strictEqual(mercado.porDia, 31.25, '500 ÷ 16');
assert.strictEqual(lazer.porDia, 0, 'estourada não tem cota');
assert.ok(Math.abs(mercado.ritmo - 16 / 31) < 1e-9, 'ritmo: o que deveria sobrar no começo de hoje');

assert.strictEqual(manaDe(m, 'Transporte'), null, 'categoria sem teto não tem mana');

// registrou agora, ainda no aparelho: gasta a mana na hora
const pendente = { estado: 'pendente', lancamento: { tipo: 'despesa', valor: 120, categoria: 'Mercado', data: '2026-10-16' } };
m = calcularMana(painel, [pendente], { agora });
assert.strictEqual(manaDe(m, 'Mercado').mana, 380, 'pendente conta na hora');

// parcelado: neste mês só a primeira parcela
const parcelado = { estado: 'pendente', lancamento: { tipo: 'despesa', valor: 600, parcelas_total: 6, categoria: 'Mercado', data: '2026-10-16' } };
assert.strictEqual(manaDe(calcularMana(painel, [parcelado], { agora }), 'Mercado').mana, 400);

// entrada não mexe em mana
const entrada = { estado: 'pendente', lancamento: { tipo: 'receita', valor: 999, categoria: 'Mercado', data: '2026-10-16' } };
assert.strictEqual(manaDe(calcularMana(painel, [entrada], { agora }), 'Mercado').mana, 500);

// mês fechado: sem ritmo e sem fila
const setembro = { ...painel, mes: '2026-09' };
m = calcularMana(setembro, [pendente], { agora });
assert.strictEqual(manaDe(m, 'Mercado').mana, 500, 'a fila é deste mês, não do mês fechado');
assert.strictEqual(manaDe(m, 'Mercado').ritmo, null);
assert.strictEqual(manaDe(m, 'Mercado').porDia, null, 'mês fechado não tem por dia');

// sem teto nenhum: lista vazia
assert.deepStrictEqual(calcularMana({ mes: '2026-10', orcamentos: {} }, [], { agora }), []);
assert.deepStrictEqual(calcularMana(null), []);

// prévia do gasto e faixas
assert.strictEqual(depoisDoGasto(mercado, 42.5), 457.5);
assert.strictEqual(estadoDaMana(0.26), 'cheia');
assert.strictEqual(estadoDaMana(0.25), 'baixa');
assert.strictEqual(estadoDaMana(0), 'vazia');

console.log('mana por categoria: ok');
