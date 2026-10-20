// Teste da importação de extrato. Rode com:  node testes/importar.test.mjs
// Os extratos aqui são de mentira, montados no formato que o pdf.js entrega
// (pedaços de texto com a posição x), igual aos PDFs reais do Nubank e do Itaú.
import assert from 'node:assert';
import { agruparLinhas } from '../src/lib/pdfLinhas.js';
import { classificar, lerCsv, lerExtrato, lerOfx, lerValor, nomeDaContraparte, palavraDoMovimento } from '../src/lib/importar.js';

assert.strictEqual(lerValor('2.989,28'), 2989.28);
assert.strictEqual(lerValor('- 2.893,89'), -2893.89);
assert.strictEqual(lerValor('0,01'), 0.01);
assert.strictEqual(lerValor('abc'), null);
assert.strictEqual(nomeDaContraparte('JOAO DA SILVA - •••.123.456-•• - ITAÚ UNIBANCO'), 'JOAO DA SILVA');
assert.strictEqual(nomeDaContraparte('58.025.342 MARIA SOUZA -'), 'MARIA SOUZA');
assert.strictEqual(nomeDaContraparte('ELEVAR TELECOM LTDA'), 'ELEVAR TELECOM LTDA');

// --- Nubank (PDF) ------------------------------------------------------------
const i = (x, t) => ({ x, t });
const pagina = (linhas) => linhas.flatMap(([y, itens]) => itens.map((it) => ({ ...it, y })));
const nubank = agruparLinhas([
  pagina([
    [775, [i(376, 'Ana Lima Souza')]],
    [762, [i(363, 'CPF'), i(386, '•••.111.222-••'), i(442, 'Agência'), i(484, '0001'), i(509, 'Conta')]],
    [699, [i(57, '01 DE OUTUBRO DE 2026'), i(171, 'a'), i(178, '19 DE OUTUBRO DE 2026'), i(469, 'VALORES EM R$')]],
    [630, [i(337, 'Total de entradas'), i(497, '+10.711,11')]],
    [561, [i(57, 'Movimentações')]],
    [539, [i(58, '06 OUT 2026'), i(120, 'Total de entradas'), i(492, '+ 1.000,00')]],
    [518, [i(120, 'Transferência recebida pelo Pix via'), i(261, 'ANA LIMA SOUZA - •••.111.222-'), i(500, '1.000,00')]],
    [498, [i(120, 'Open Banking'), i(261, '•• - ITAÚ UNIBANCO S.A. (0341)')]],
    [444, [i(120, 'Total de saídas'), i(493, '- 1.155,90')]],
    [423, [i(120, 'Pagamento de boleto efetuado'), i(260, 'ELEVAR TELECOM LTDA'), i(509, '119,90')]],
    [403, [i(120, 'Pagamento de boleto efetuado'), i(260, 'ELEVAR TELECOM LTDA'), i(509, '119,90')]],
    [383, [i(120, 'Aplicação RDB'), i(498, '500,00')]],
    [362, [i(120, 'Transferência enviada pelo Pix'), i(260, 'CARLOS SOUZA - •••.999.888-•• -'), i(505, '416,10')]],
    [123, [i(57, 'Tem alguma dúvida? Mande uma mensagem para nosso time')]],
    [67, [i(113, 'Extrato gerado dia 20 de outubro de 2026 às 15:59'), i(516, '1 de 2')]]
  ]),
  pagina([
    [781, [i(376, 'Ana Lima Souza')]],
    [674, [i(262, 'BCO BRADESCO S.A. (0237) Agência: 1')]],
    [609, [i(58, '08 OUT 2026'), i(120, 'Total de entradas'), i(503, '+ 100,00')]],
    [588, [i(120, 'Resgate RDB'), i(510, '100,00')]]
  ])
]);
const nu = lerExtrato({ linhas: nubank });
assert.strictEqual(nu.banco, 'nubank_conta');
assert.strictEqual(nu.titular, 'Ana Lima Souza');
assert.strictEqual(nu.cpfMeio, '111.222');
assert.deepStrictEqual([nu.inicio, nu.fim], ['2026-10-01', '2026-10-19']);
assert.deepStrictEqual(nu.movimentos.map((m) => [m.data, m.valor]), [
  ['2026-10-06', 1000], ['2026-10-06', -119.9], ['2026-10-06', -119.9], ['2026-10-06', -500], ['2026-10-06', -416.1], ['2026-10-08', 100]
], 'sinal pela seção (entradas/saídas); o resumo do topo não entra');
assert.strictEqual(nu.movimentos[0].operacao, 'Transferência recebida pelo Pix via Open Banking', 'linha de baixo completa a operação');
assert.ok(nu.movimentos[4].detalhe.includes('BRADESCO'), 'continuação na página seguinte vai para o movimento certo');
assert.notStrictEqual(nu.movimentos[1].id, nu.movimentos[2].id, 'dois boletos iguais no mesmo dia são dois movimentos');
assert.strictEqual(lerExtrato({ linhas: nubank }).movimentos[1].id, nu.movimentos[1].id, 'o id é estável: ler de novo dá o mesmo');

const ctx = { titular: nu.titular, cpfMeio: nu.cpfMeio, categorias: [{ categoria: 'Internet', tipo: 'despesa', palavras: ['elevar telecom'] }], pessoas: [{ nome: 'Carlos' }] };
const tipos = nu.movimentos.map((m) => classificar(m, ctx));
assert.strictEqual(tipos[0].tipo, 'fora', 'Pix da própria titular (mesmo CPF) é entre contas');
assert.strictEqual(tipos[1].tipo, 'despesa');
assert.strictEqual(tipos[1].categoria, 'Internet', 'palavra-chave aprendida sugere a categoria');
assert.strictEqual(tipos[1].palavra, 'elevar telecom', 'palavra sem o LTDA');
assert.strictEqual(tipos[3].tipo, 'guardar', 'Aplicação RDB = guardar no baú');
assert.strictEqual(tipos[4].tipo, 'fora', 'Pix para alguém da casa não é gasto');
assert.strictEqual(tipos[5].tipo, 'resgatar');

// --- Itaú (PDF) --------------------------------------------------------------
const itau = agruparLinhas([pagina([
  [770, [i(198, 'ANA LIMA SOUZA'), i(380, '000.111.222-33')]],
  [645, [i(28, 'extrato conta / lançamentos')]],
  [630, [i(28, 'período de visualização: 21/08/2026 até 20/10/2026')]],
  [597, [i(31, 'data'), i(96, 'lançamentos'), i(411, 'valor (R$)'), i(516, 'saldo (R$)')]],
  [572, [i(31, '20/10/2026'), i(96, 'SALDO DO DIA'), i(542, '0,00')]],
  [553, [i(31, '20/10/2026'), i(96, 'REMUNERACAO/SALARIO'), i(415, '2.045,98')]],
  [534, [i(31, '20/10/2026'), i(96, 'PIX TRANSF ANA LIM20/10'), i(411, '-2.045,99')]],
  [497, [i(31, '06/10/2026'), i(96, 'REND PAGO APLIC AUT MAIS'), i(438, '0,01')]]
])]);
const it = lerExtrato({ linhas: itau });
assert.strictEqual(it.banco, 'itau_conta');
assert.deepStrictEqual(it.movimentos.map((m) => m.valor), [0.01, -2045.99, 2045.98], 'saldo do dia fica de fora; do mais antigo para o mais novo');
const tItau = it.movimentos.map((m) => classificar(m, { titular: it.titular, categorias: [{ categoria: 'Salário', tipo: 'receita', palavras: [] }, { categoria: 'Rendimento', tipo: 'receita', palavras: [] }] }));
assert.deepStrictEqual(tItau.map((t) => t.tipo), ['receita', 'fora', 'receita'], 'PIX TRANSF com o nome cortado da titular é entre contas');
assert.deepStrictEqual(tItau.map((t) => t.categoria), ['Rendimento', '', 'Salário']);

// --- CSV do Nubank e OFX -----------------------------------------------------
const conta = lerCsv('Data,Valor,Identificador,Descrição\n06/10/2026,-45.99,abc-1,Transferência enviada pelo Pix - TIM S A - 02.421.421/0001-11\n07/10/2026,100.00,abc-2,Resgate RDB');
assert.strictEqual(conta.banco, 'nubank_conta');
assert.deepStrictEqual(conta.movimentos.map((m) => [m.data, m.valor, m.contraparte]), [['2026-10-06', -45.99, 'TIM S A'], ['2026-10-07', 100, '']]);
const cartao = lerCsv('date,title,amount\n2026-10-03,Padaria Pão Dourado,18.50\n2026-10-04,Pagamento recebido,-500.00');
assert.strictEqual(cartao.banco, 'nubank_cartao');
assert.deepStrictEqual(cartao.movimentos.map((m) => m.valor), [-18.5, 500], 'compra no cartão é saída');
assert.strictEqual(classificar(cartao.movimentos[1], {}).tipo, 'fora', 'pagamento da fatura fica fora');
const ofx = lerOfx('<OFX><ORG>ITAU<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006120000<TRNAMT>-45.99<FITID>X1<MEMO>PIX TIM<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261007<TRNAMT>10.00<FITID>X2<NAME>JOSE<MEMO>PIX RECEBIDO</OFX>');
assert.deepStrictEqual(ofx.movimentos.map((m) => [m.data, m.valor]), [['2026-10-06', -45.99], ['2026-10-07', 10]]);
assert.notStrictEqual(ofx.movimentos[0].id, ofx.movimentos[1].id);
assert.strictEqual(lerExtrato({ texto: 'qualquer coisa' }), null, 'arquivo desconhecido');
assert.strictEqual(palavraDoMovimento({ contraparte: 'UNASP VIRTUAL UNIDADE DE ENSINO' }), 'unasp virtual ensino');

console.log('importar extrato: ok');
