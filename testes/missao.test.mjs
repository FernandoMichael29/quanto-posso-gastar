// Teste da missão do mês e das conquistas. Rode com:  node testes/missao.test.mjs
import assert from 'node:assert';
import { calcularMissao, conquistasMerecidas, mesesFechados, metaDoMes, nivel, seguidos } from '../src/lib/missao.js';
import { calcularOuro } from '../src/lib/ouro.js';

const agora = new Date(2026, 9, 19, 12);   // 19/10/2026

// meta com vigência
const metas = [{ desde: '2026-07', valor: 1000 }, { desde: '2026-09', valor: 1500 }];
assert.strictEqual(metaDoMes(metas, '2026-06'), 0, 'antes da primeira meta: sem missão');
assert.strictEqual(metaDoMes(metas, '2026-08'), 1000);
assert.strictEqual(metaDoMes(metas, '2026-10'), 1500, 'vale a última que começou até o mês');
assert.strictEqual(metaDoMes([...metas, { desde: '2026-10', valor: 0 }], '2026-10'), 0, 'zero desliga');

const ev = (mes, receitas, despesas) => ({ mes, futuro: false, receitas, despesas, saldo: receitas - despesas });
const painel = {
  mes: '2026-10',
  receitas: 6800,
  previsao: { sobra: 900, ainda_entra: 0 },
  metas,
  evolucao: [
    ev('2026-05', 0, 0),          // antes de usar o app: não conta
    ev('2026-06', 5000, 4800),    // azul, sem meta
    ev('2026-07', 5000, 3900),    // azul, cumpriu 1000
    ev('2026-08', 5000, 3800),    // azul, cumpriu 1000
    ev('2026-09', 5000, 3400),    // azul, cumpriu 1500
    { ...ev('2026-10', 6800, 4000), futuro: false },   // o mês corrente não é fechado
    { ...ev('2026-11', 0, 0), futuro: true }
  ]
};

// missão do mês
let m = calcularMissao(painel, [], { agora });
assert.strictEqual(m.meta, 1500);
assert.strictEqual(m.guardado, 900, 'o que sobra no fim do mês, se terminar assim');
assert.strictEqual(m.falta, 600);
assert.strictEqual(m.cumprida, false);
assert.ok(Math.abs(m.fracao - 0.6) < 1e-9, 'XP 900 / 1500');
assert.strictEqual(m.cumpridasSeguidas, 3, 'jul, ago e set cumpridos');

// um gasto ainda só no aparelho já tira XP
const pendente = { estado: 'pendente', lancamento: { tipo: 'despesa', valor: 100, data: '2026-10-19', categoria: 'Lazer' } };
assert.strictEqual(calcularMissao(painel, [pendente], { agora }).guardado, 800);
assert.strictEqual(calcularMissao({ ...painel, mes: '2026-09' }, [], { agora }), null, 'mês que não é o corrente não tem missão');

// meses fechados
const f = mesesFechados(painel, '2026-10');
assert.deepStrictEqual(f.map((x) => x.mes), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
assert.deepStrictEqual(f.map((x) => x.azul), [false, true, true, true, true]);
assert.deepStrictEqual(f.map((x) => x.cumprida), [false, false, true, true, true], 'compara com a meta que valia em cada mês');
assert.strictEqual(seguidos(f, (x) => x.azul), 4);

// conquistas
let c = conquistasMerecidas(painel, [], { agora });
for (const id of ['primeira_missao', 'no_azul', 'trinca', 'formiguinha', 'guardiao']) assert.ok(c.has(id), id);
assert.ok(!c.has('fase_limpa'), 'sem contas fixas, não há fase limpa');

c = conquistasMerecidas({ mes: '2026-10', fixas: [{ nome: 'Aluguel', lancado: true }, { nome: 'Luz', lancado: true }] }, [], { agora });
assert.ok(c.has('fase_limpa'), 'todas as contas fixas lançadas');
c = conquistasMerecidas({ mes: '2026-10', fixas: [{ nome: 'Aluguel', lancado: true }, { nome: 'Luz', lancado: false }] }, [], { agora });
assert.ok(!c.has('fase_limpa'), 'falta uma');

const dias = (lista) => lista.map((dia) => ({ dia, total: 10 }));
assert.ok(conquistasMerecidas({ mes: '2026-10', por_dia: dias(['2026-10-01', '2026-10-02', '2026-10-04']) }, [], { agora }).has('bolso_trancado'), 'dia 3 sem gasto, entre dois dias com gasto');
assert.ok(!conquistasMerecidas({ mes: '2026-10', por_dia: dias(['2026-10-10', '2026-10-11']) }, [], { agora }).has('bolso_trancado'), 'antes do primeiro registro não conta');
assert.ok(conquistasMerecidas({ mes: '2026-10', por_dia: dias(['2026-09-30', '2026-10-02']) }, [], { agora }).has('bolso_trancado'), 'atravessa a virada do mês');

const comTeto = { mes: '2026-10', orcamentos: { Lazer: 200 }, por_categoria: [{ nome: 'Lazer', total: 150 }] };
assert.ok(!conquistasMerecidas(comTeto, [], { agora }).has('mana_intacta'), 'dia 19 ainda não vale');
const dia20 = new Date(2026, 9, 20, 9);
assert.ok(conquistasMerecidas(comTeto, [], { agora: dia20 }).has('mana_intacta'), 'dia 20 sem estourar');
assert.ok(!conquistasMerecidas({ ...comTeto, por_categoria: [{ nome: 'Lazer', total: 250 }] }, [], { agora: dia20 }).has('mana_intacta'), 'estourou');
assert.ok(conquistasMerecidas({ ...comTeto, mes: '2026-08' }, [], { agora }).has('mana_intacta'), 'mês fechado sem estourar também vale');

assert.strictEqual(nivel(0), 1);
assert.strictEqual(nivel(3), 4);

// o ouro de hoje separa a missão antes de dividir pelos dias
const o = calcularOuro({ mes: '2026-10', receitas: 6800, previsao: { sobra: 2800, ainda_entra: 0 }, metas }, [], { agora });
assert.strictEqual(o.reserva, 1500);
assert.strictEqual(o.livre, 1300, '2800 − 1500 da missão');
assert.strictEqual(o.ouro, 100, '1300 ÷ 13 dias');

console.log('missão e conquistas: ok');
