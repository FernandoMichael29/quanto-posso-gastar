// Teste do "ouro de hoje". Rode com:  node testes/ouro.test.mjs
import assert from 'node:assert';
import { calcularOuro, diasRestantes } from '../src/lib/ouro.js';

const agora = new Date(2026, 9, 19, 12);   // 19/10/2026: faltam 13 dias contando hoje
assert.strictEqual(diasRestantes(agora), 13, 'dias que faltam, contando hoje');
assert.strictEqual(diasRestantes(new Date(2026, 9, 31)), 1, 'último dia do mês');

const painel = { mes: '2026-10', receitas: 6800, previsao: { sobra: 1300, ainda_entra: 0 }, gasto_livre_hoje: 0 };
let o = calcularOuro(painel, [], { agora });
assert.strictEqual(o.ouro, 100, 'sem gastar hoje: livre ÷ dias');
assert.strictEqual(o.porDia, 100);

// gastou 40 hoje (o painel já contou: o livre caiu para 1260)
o = calcularOuro({ ...painel, previsao: { sobra: 1260, ainda_entra: 0 }, gasto_livre_hoje: 40 }, [], { agora });
assert.strictEqual(o.porDia, 100, 'a cota do dia não muda por ter gastado');
assert.strictEqual(o.ouro, 60, 'o gasto sai inteiro do ouro de hoje');

// acabou de registrar 42 e ainda está só no aparelho
const pendente = { estado: 'pendente', lancamento: { tipo: 'despesa', valor: 42, data: '2026-10-19' } };
o = calcularOuro(painel, [pendente], { agora });
assert.strictEqual(o.ouro, 58, 'pendente conta na hora');
assert.strictEqual(o.livre, 1258);

// parcelado em 10x: este mês pesa só a primeira
o = calcularOuro(painel, [{ estado: 'pendente', lancamento: { tipo: 'despesa', valor: 1000, parcelas_total: 10, data: '2026-10-19' } }], { agora });
assert.strictEqual(o.ouro, 0, 'parcela de 100 come o ouro de 100');

// já sincronizado: conta só se subiu DEPOIS que o painel foi pedido
const subiu = (quando) => ({ estado: 'sincronizado', ultima_tentativa: quando, lancamento: { tipo: 'despesa', valor: 42, data: '2026-10-19' } });
assert.strictEqual(calcularOuro(painel, [subiu(1000)], { agora, desde: 2000 }).ouro, 100, 'o painel já viu: não conta duas vezes');
assert.strictEqual(calcularOuro(painel, [subiu(3000)], { agora, desde: 2000 }).ouro, 58, 'o painel ainda não viu: conta');

// entrada pendente: aumenta o livre e a vida do mês
o = calcularOuro(painel, [{ estado: 'pendente', lancamento: { tipo: 'receita', valor: 1300, data: '2026-10-19' } }], { agora });
assert.strictEqual(o.ouro, 200, 'entrada aumenta o ouro');
assert.ok(o.vida > calcularOuro(painel, [], { agora }).vida, 'e enche a vida do mês');

// passou do ouro de hoje
o = calcularOuro({ ...painel, previsao: { sobra: 1150, ainda_entra: 0 }, gasto_livre_hoje: 150 }, [], { agora });
assert.strictEqual(o.ouro, -50, 'gastou 150 com cota de 100: passou 50');
assert.ok(o.amanha < 100, 'e amanhã a cota diminui');

// mês no vermelho
o = calcularOuro({ ...painel, previsao: { sobra: -200, ainda_entra: 0 } }, [], { agora });
assert.strictEqual(o.ouro, 0, 'no vermelho, não há ouro');
assert.strictEqual(o.vida, 0);

// painel de outro mês não vale
assert.strictEqual(calcularOuro({ ...painel, mes: '2026-09' }, [], { agora }), null, 'virou o mês: ignora o painel velho');
assert.strictEqual(calcularOuro(null, [], { agora }), null);

console.log('ouro de hoje: ok');
