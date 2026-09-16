// Teste rápido do parser local. Rode com:  node testes/parser.test.mjs
import { interpretar, extensoParaDigitos, formatarBRL } from '../src/lib/parser.js';
import { CATEGORIAS_PADRAO } from '../src/lib/categorias.js';
import { menorQue } from '../src/lib/versao.js';
import assert from 'node:assert';

assert.ok(menorQue('2.9.0', '2.10.0') && !menorQue('2.10.0', '2.9.0') && !menorQue('2.1.0', '2.1.0'), 'menorQue');

const hoje = new Date('2026-09-14T12:00:00');
const op = { categorias: CATEGORIAS_PADRAO, hoje };

const casos = [
  // [frase, confiança esperada, valor, tipo, categoria]
  ['mercado 120 reais', 'alta', 120, 'despesa', 'Mercado'],
  ['MERCADO 120 reais', 'alta', 120, 'despesa', 'Mercado'],
  ['mercado cento e vinte reais', 'alta', 120, 'despesa', 'Mercado'],
  ['recebi meu salario de 3000', 'alta', 3000, 'receita', 'Salário'],
  ['recebi meu salário de três mil reais', 'alta', 3000, 'receita', 'Salário'],
  ['gastei 45,90 no ifood', 'alta', 45.9, 'despesa', 'Alimentação'],
  ['uber 23 reais', 'alta', 23, 'despesa', 'Transporte'],
  ['posto 150', 'alta', 150, 'despesa', 'Transporte'],
  ['paguei o aluguel de 1500 ontem', 'alta', 1500, 'despesa', 'Moradia'],
  ['netflix 39,90 no credito', 'alta', 39.9, 'despesa', 'Assinaturas'],
  ['fone em 10x de 89,90', 'alta', 899, 'despesa', 'Compras'],
  ['farmacia 87 reais no pix', 'alta', 87, 'despesa', 'Saúde'],
  ['gastei 60 com uma coisa aleatoria', 'media', 60, 'despesa', 'Outros'],
  ['dia 5 recebi 250 de freela', 'alta', 250, 'receita', 'Freela'],
  ['r$ 1.250,00 de faculdade', 'alta', 1250, 'despesa', 'Educação'],

  // estes devem cair para a IA
  ['ontem gastei uns 60 no posto e 35 no almoço', 'ia'],
  ['comprei umas coisas no mercado', 'ia'],
  ['sexta passada paguei 80 no bar', 'ia'],
  ['', 'ia'],

  // regras sobre gastos fixos: NUNCA podem virar lançamento do dia
  ['meu gasto mensal no aluguel é de 1800', 'ia'],
  ['esse mês meu aluguel foi 1850', 'ia'],
  ['meu aluguel agora é 1900', 'ia'],
  ['pago 89,90 de internet todo mês', 'ia'],
  ['o condomínio reajustou para 520', 'ia'],
  ['assinei o spotify por 21,90', 'ia'],
  ['cancelei a netflix', 'ia'],
  ['minha faculdade é 430 todo dia 10', 'ia'],
  ['este mês a luz veio 310', 'ia']
];

let ok = 0, falhas = [];

for (const [frase, esperado, valor, tipo, categoria] of casos) {
  const r = interpretar(frase, op);
  const problemas = [];

  if (r.confianca !== esperado) problemas.push(`confiança ${r.confianca} ≠ ${esperado}`);
  if (valor !== undefined && r.lancamento && Math.abs(r.lancamento.valor - valor) > 0.001) {
    problemas.push(`valor ${r.lancamento.valor} ≠ ${valor}`);
  }
  if (tipo && r.lancamento && r.lancamento.tipo !== tipo) problemas.push(`tipo ${r.lancamento.tipo} ≠ ${tipo}`);
  if (categoria && r.lancamento && r.lancamento.categoria !== categoria) {
    problemas.push(`categoria ${r.lancamento.categoria} ≠ ${categoria}`);
  }

  if (problemas.length) {
    falhas.push(`  ✗ "${frase}"\n      ${problemas.join('\n      ')}`);
  } else {
    ok++;
    const l = r.lancamento;
    const detalhe = l ? `${l.tipo} ${formatarBRL(l.valor)} · ${l.categoria} · ${l.data}${l.parcelas_total ? ` · ${l.parcelas_total}x` : ''}` : '→ IA';
    console.log(`  ✓ "${frase}"  →  ${detalhe}`);
  }
}

console.log(`\nextenso: "${extensoParaDigitos('mercado cento e vinte e cinco reais e mil coisas')}"`);
console.log(`\n${ok}/${casos.length} passaram`);
if (falhas.length) {
  console.log('\nFalhas:\n' + falhas.join('\n'));
  process.exit(1);
}
