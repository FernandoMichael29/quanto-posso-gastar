// Teste do relatório da aventura. Rode com:  node testes/relatorio.test.mjs
import assert from 'node:assert';
import { anoAnterior, deveMostrarRelatorio, deveMostrarRelatorioAno, fraseDoAno, mesAnterior, relatorioDoMes } from '../src/lib/relatorio.js';

assert.strictEqual(mesAnterior('2026-11-02'), '2026-10');
assert.strictEqual(mesAnterior('2027-01-01'), '2026-12', 'virada do ano');
assert.strictEqual(deveMostrarRelatorio('2026-11-02', ''), true, 'começo do mês, nunca viu');
assert.strictEqual(deveMostrarRelatorio('2026-11-02', '2026-10'), false, 'já viu o de outubro');
assert.strictEqual(deveMostrarRelatorio('2026-11-08', ''), false, 'passou da primeira semana');
assert.strictEqual(deveMostrarRelatorio('2026-11-07', '2026-09'), true, 'o visto é do mês retrasado');

// relatório do ano
assert.strictEqual(anoAnterior('2027-01-03'), '2026');
assert.strictEqual(deveMostrarRelatorioAno('2027-01-03', ''), true);
assert.strictEqual(deveMostrarRelatorioAno('2027-01-03', '2026'), false, 'já viu');
assert.strictEqual(deveMostrarRelatorioAno('2027-01-08', ''), false, 'passou da semana');
assert.strictEqual(deveMostrarRelatorioAno('2026-11-02', ''), false, 'só em janeiro');
assert.strictEqual(fraseDoAno({ meses_com_movimento: 4, no_azul: 3 }), 'fechou 3 de 4 meses no azul');
assert.strictEqual(fraseDoAno({ meses_com_movimento: 4, no_azul: 4 }), 'fechou todos os 4 meses no azul');
assert.strictEqual(fraseDoAno({ meses_com_movimento: 0 }), '');

const painel = {
  receitas: 6800, despesas: 5400, previsao: { sobra: 1400 }, guardado_mes: 900,
  guardado_por_pessoa: { Fernando: 600, Mayara: 300 },
  fixas: [{ lancado: true }, { lancado: true }, { lancado: false }],
  metas: [{ desde: '2026-08', valor: 1000 }],
  por_categoria: [{ nome: 'Mercado', total: 900 }, { nome: 'Moradia', total: 1800 }],
  conquistas: { no_azul: '2026-10-31', fase_limpa: '2026-09-30' }
};
const r = relatorioDoMes(painel, '2026-10');
assert.strictEqual(r.sobrou, 1400);
assert.strictEqual(r.noAzul, true);
assert.deepStrictEqual(r.chefes, { derrotados: 2, total: 3 });
assert.deepStrictEqual(r.missao, { meta: 1000, cumprida: true });
assert.deepStrictEqual(r.dragao, { nome: 'Moradia', total: 1800 });
assert.deepStrictEqual(r.conquistas.map((c) => c.id), ['no_azul'], 'só as ganhas naquele mês');
assert.deepStrictEqual(r.dupla.map((d) => d.id), ['fernando', 'mayara']);

const vermelho = relatorioDoMes({ ...painel, previsao: { sobra: -300 } }, '2026-10');
assert.strictEqual(vermelho.noAzul, false);
assert.strictEqual(vermelho.missao.cumprida, false);
assert.strictEqual(relatorioDoMes({ receitas: 0, despesas: 0 }, '2026-10'), null, 'mês vazio: nada para contar');
assert.strictEqual(relatorioDoMes(null, '2026-10'), null);
assert.strictEqual(relatorioDoMes({ ...painel, metas: [] }, '2026-10').missao, null, 'sem missão');

console.log('relatório da aventura: ok');
