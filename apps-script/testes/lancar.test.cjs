// Roda o Codigo.gs fora do Google, contra uma planilha de mentira.
//
// Existe porque um erro de uma linha em lancar_ fez o app parar de gravar
// QUALQUER lançamento sem dar erro nenhum — a tela dizia "ok" e a planilha
// continuava igual. Um teste de 10 linhas teria pego isso na hora.
//
//   node apps-script/testes/lancar.test.cjs
//
const fs = require('fs');
const { Aba } = require('./planilha-falsa.cjs');

const abas = {
  lancamentos: new Aba(['uuid','data','hora_registro','tipo','valor','categoria','descricao','conta','metodo','fonte','pessoa','fatura_mes','parcela_atual','parcelas_total','texto_falado','origem','confianca','status','revisar','erro']),
  contas: new Aba(['nome','tipo','pessoa','dia_fechamento','dia_vencimento','saldo_inicial','ativo']),
  resumo_mensal: new Aba(['mes','categoria','tipo','total','lancamentos']),
  recorrentes: new Aba(['nome','tipo','categoria','valor','dia','conta','metodo','pessoa','vigencia_inicio','vigencia_fim','escopo','parcelas_total','parcelas_restantes','texto_falado','criado_em'])
};

abas.contas.dados.push(['Itaú cartão','credito','Fernando',3,10,0,'sim']);
abas.contas.dados.push(['Nubank Fernando','conta corrente','Fernando','','','', 'sim']);


const planilha = {
  getSheetByName: (n) => abas[n] || null,
  getSpreadsheetTimeZone: () => 'America/Sao_Paulo',
  getUrl: () => 'http://x',
  getSheets: () => Object.values(abas),
  insertSheet: (n) => (abas[n] = new Aba([]))
};

global.SpreadsheetApp = { getActiveSpreadsheet: () => planilha };
global.LockService = { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) };
let seq = 0;
global.Utilities = {
  getUuid: () => 'uuid-' + (++seq),
  formatDate: (d, tz, fmt) => {
    const z = (x) => String(x).padStart(2, '0');
    if (fmt === 'yyyy-MM') return d.getFullYear() + '-' + z(d.getMonth() + 1);
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) };
global.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {} }) };
global.Session = { getEffectiveUser: () => ({ getEmail: () => 'x@y.z' }) };
global.MailApp = { sendEmail: () => {} };
global.UrlFetchApp = { fetch: () => { throw new Error('sem rede no teste'); } };
global.ContentService = { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } };
global.ScriptApp = { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => {} }) }) }), deleteTrigger: () => {} };
global.Logger = { log: () => {} };

const src = fs.readFileSync(__dirname + '/../Codigo.gs', 'utf8');
eval(src);
atualizarResumo_ = function () {};   // o resumo não é o que está sob teste

const col = indiceColunas_();
const linhas = () => abas.lancamentos.dados.slice(1);

// 1. lançamento simples — o caso que estava sumindo
let r = lancar_({ lancamentos: [{ uuid: 'a1', data: '2026-09-10', valor: 814.38, categoria: 'Transporte', descricao: 'Consórcio do carro', conta: 'Nubank Fernando', pessoa: 'Fernando' }] });
console.log('simples: gravados', r.gravados.length, '| linhas', linhas().length, '| valor', linhas()[0][col.valor]);

// 2. reenviar o mesmo uuid não duplica
r = lancar_({ lancamentos: [{ uuid: 'a1', valor: 814.38, descricao: 'Consórcio do carro' }] });
console.log('reenvio: gravados', r.gravados.length, 'duplicados', r.duplicados.length, '| linhas', linhas().length);

// 3. parcelado
r = lancar_({ lancamentos: [{ uuid: 'b1', data: '2026-09-15', valor: 489.50, parcelas_total: 5, conta: 'Itaú cartão', categoria: 'Compras', descricao: 'filtro dagua' }] });
console.log('parcelado: gravados', r.gravados.length, '| faturas', linhas().filter(l => l[col.uuid].startsWith('b1')).map(l => l[col.fatura_mes] + '=' + l[col.valor]).join(' '));

// 4. reenviar a compra parcelada não duplica nenhuma parcela
r = lancar_({ lancamentos: [{ uuid: 'b1', data: '2026-09-15', valor: 489.50, parcelas_total: 5, conta: 'Itaú cartão' }] });
console.log('reenvio parcelado: gravados', r.gravados.length, 'duplicados', r.duplicados.length, '| total de linhas', linhas().length);

// 5. pagar uma conta fixa que não existe tem que dar erro visível
console.log('fixa inexistente:', JSON.stringify(pagarFixa_({ nome: 'Nada disso', mes: '2026-09' })));

// 6. excluir uma parcela derruba o grupo todo
r = excluirLancamento_({ uuid: 'b1-p3' });
console.log('excluir grupo:', r.excluidos, 'linhas do b1 ainda ok:', linhas().filter(l => String(l[col.uuid]).startsWith('b1') && l[col.status] === 'ok').length);

// 7. o caso do Fernando: pagar a conta fixa "Consórcio do carro"
abas.recorrentes.dados.push(['Consórcio do carro','despesa','Transporte',814.38,10,'','','','2026-09','','padrao','','','consórcio do carro 814 38 mensal','2026-09-15']);
const antes = linhas().length;
const pg = pagarFixa_({ nome: 'Consórcio do carro', mes: '2026-09', valor: 814.38, categoria: 'Transporte', descricao: 'Consórcio do carro', conta: 'Nubank Fernando', pessoa: 'Fernando', data: '2026-09-10', dia: 10, ajuste: 'excecao' });
console.log('pagar fixa:', pg.ok, '| linhas novas', linhas().length - antes, '| valor', pg.lancamento && pg.lancamento.valor);

// 8. e o painel passa a enxergar como lançada
const p = painel_({ mes: '2026-09' });
const f = p.fixas.filter(x => x.nome === 'Consórcio do carro')[0];
console.log('painel:', f && ('lancado=' + f.lancado + ' valor_lancado=' + f.valor_lancado));

// 9. ordem da lista do mês: dia, depois hora de registro, depois a planilha
abas.lancamentos.dados.push(['z1','2026-09-05',new Date('2026-09-15T20:00:00'),'despesa',10,'Outros','tarde no dia 5','Pix','','','Fernando','','','','','manual','','ok','','']);
abas.lancamentos.dados.push(['z2','2026-09-05',new Date('2026-09-15T08:00:00'),'despesa',20,'Outros','cedo no dia 5','Pix','','','Fernando','','','','','manual','','ok','','']);
abas.lancamentos.dados.push(['z3','2026-09-20',new Date('2026-09-14T08:00:00'),'despesa',30,'Outros','dia 20','Pix','','','Fernando','','','','','manual','','ok','','']);
const ordem = lancamentosDoMes_({ mes: '2026-09' }).lancamentos.map(l => l.data + ' ' + (l.descricao || l.categoria));
console.log('ordem do mês:\n  ' + ordem.join('\n  '));
console.log('sem chave interna:', lancamentosDoMes_({ mes: '2026-09' }).lancamentos.every(l => l._ordem === undefined));

// 10. renda mensal: aparece como "a receber" e vira receita quando confirmada
abas.recorrentes.dados.push(['Caju','receita','Outras Entradas',840,5,'Caju','','Fernando','2026-09','','padrao','','','recebo todo mês 840 de caju','2026-09-15']);
let pnl = painel_({ mes: '2026-09' });
console.log('rendas:', JSON.stringify(pnl.rendas.map(r => [r.nome, r.valor, r.lancado, r.tipo])), '| a receber', pnl.a_receber_total, '| recebi', pnl.receitas);
const rec = pagarFixa_({ nome: 'Caju', mes: '2026-09', valor: 840, categoria: 'Outras Entradas', descricao: 'Caju', conta: 'Caju', pessoa: 'Fernando', data: '2026-09-05', dia: 5, ajuste: 'excecao' });
console.log('registrar recebimento:', rec.ok, '| tipo', rec.lancamento && rec.lancamento.tipo, '| origem', rec.lancamento && rec.lancamento.origem);
pnl = painel_({ mes: '2026-09' });
console.log('depois: lancado', pnl.rendas[0].lancado, '| a receber', pnl.a_receber_total, '| recebi', pnl.receitas);
console.log('fixas não viraram renda:', pnl.fixas.every(f => f.tipo !== 'receita'));

// 11. o caso do "Adiantamento da Mayara": regra nasceu despesa, era entrada
abas.recorrentes.dados.push(['Adiantamento da Mayara','despesa','Outros',800,20,'','','Mayara','2026-09','','padrao','','','adiantamento da mayara 800','2026-09-16']);
let pa = painel_({ mes: '2026-09' });
console.log('antes: fixas', pa.fixas.map(f => f.nome).join(', '), '| rendas', pa.rendas.map(r => r.nome).join(', '));

let ed = salvarRecorrente_({ nome: 'Adiantamento da Mayara', mes: '2026-09', campos: {
  nome: 'Vale dia 20 da Mayara', tipo: 'receita', valor: 800, dia: 20,
  categoria: 'Outras Entradas', conta: 'Nubank Fernando', pessoa: 'Mayara'
}});
console.log('corrigida:', ed.ok, ed.nome);
pa = painel_({ mes: '2026-09' });
console.log('depois: fixas', pa.fixas.map(f => f.nome).join(', '), '| rendas', pa.rendas.map(r => r.nome + ' ' + r.valor + ' dia ' + r.dia).join(', '));

// apagar de vez
console.log('apagar:', JSON.stringify(excluirRecorrente_({ nome: 'Vale dia 20 da Mayara' })));
pa = painel_({ mes: '2026-09' });
console.log('sumiu das duas listas:', !pa.rendas.some(r => r.nome.indexOf('Vale dia 20') === 0) && !pa.fixas.some(f => f.nome.indexOf('Vale dia 20') === 0));
console.log('linhas continuam na planilha:', abas.recorrentes.dados.length - 1, '| listadas:', recorrentes_({ mes: '2026-09' }).recorrentes.length);

// encerrar preserva o mês corrente e some no seguinte
console.log('encerrar Caju:', encerrarRecorrente_({ nome: 'Caju', mes: '2026-09' }).acao);
console.log('  set:', recorrentes_({mes:'2026-09'}).recorrentes.some(r => r.nome === 'Caju'),
            '| out:', recorrentes_({mes:'2026-10'}).recorrentes.some(r => r.nome === 'Caju'));

// 12. renda com data futura nasce agendada e só conta quando confirmada
abas.recorrentes.dados.push(['Salário Mayara dia 20','receita','Salário',800,20,'Nubank May','','Mayara','2026-09','','padrao','','','salário Maiara dia 20 800','2026-09-16']);
let rr = lancar_({ lancamentos: [{ uuid: 'fut1', data: '2026-09-20', tipo: 'receita', valor: 800,
  categoria: 'Salário', descricao: 'Salário Mayara dia 20', conta: 'Nubank May', pessoa: 'Mayara' }] });
const colx = indiceColunas_();
const linhaFut = abas.lancamentos.dados.slice(1).find(l => l[colx.uuid] === 'fut1');
console.log('status ao nascer:', linhaFut[colx.status]);

let pv = painel_({ mes: '2026-09' });
const linha20 = pv.rendas.find(r => r.nome.indexOf('Salário Mayara') === 0);
console.log('na lista:', linha20.lancado ? 'JÁ RECEBIDO (errado)' : 'a receber', '| uuid agendado:', linha20.uuid_agendado);
console.log('recebi:', pv.receitas, '| ainda entra:', pv.previsao.ainda_entra, '| previsão de sobra:', pv.previsao.sobra);

// editar o nome não promove
editarLancamento_({ uuid: 'fut1', campos: { descricao: 'Salário da Mayara (dia 20)' } });
pv = painel_({ mes: '2026-09' });
console.log('depois de editar → status', abas.lancamentos.dados.slice(1).find(l => l[colx.uuid]==='fut1')[colx.status],
            '| nome na lista:', pv.rendas.find(r => r.uuid_agendado === 'fut1').nome_lancado);

// confirmar promove e passa a contar
console.log('confirmar:', JSON.stringify(confirmarRecebimento_({ uuid: 'fut1', data: '2026-09-20' })));
pv = painel_({ mes: '2026-09' });
console.log('depois de confirmar → recebi', pv.receitas, '| ainda entra', pv.previsao.ainda_entra,
            '| lancado', pv.rendas.find(r => r.nome.indexOf('Salário Mayara') === 0).lancado);

// despesa com data futura continua contando normalmente
lancar_({ lancamentos: [{ uuid: 'fut2', data: '2026-09-28', tipo: 'despesa', valor: 100, categoria: 'Compras', descricao: 'parcela futura', conta: 'Itaú cartão' }] });
console.log('despesa futura → status', abas.lancamentos.dados.slice(1).find(l => l[colx.uuid]==='fut2')[colx.status],
            '| entrou no gastei:', painel_({ mes: '2026-09' }).despesas > pv.despesas);

// 13. compra de hoje vem antes do que ainda vai acontecer
lancar_({ lancamentos: [{ uuid: 'hoje1', data: '2026-09-16', tipo: 'despesa', valor: 137.90,
  parcelas_total: 5, categoria: 'Compras', descricao: 'Compra parcelada', conta: 'Itaú cartão' }] });
const ordem2 = lancamentosDoMes_({ mes: '2026-09' }).lancamentos.map(l => `${l.data} ${l.descricao || l.categoria}`);
console.log('ordem:\n  ' + ordem2.slice(0, 6).join('\n  '));

// 14. a fatura que ainda está fechando aparece
const pf = painel_({ mes: '2026-09' });
console.log('faturas de setembro:', JSON.stringify(pf.faturas.map(f => [f.cartao, f.total])));
console.log('em formação:', JSON.stringify(pf.faturas_em_formacao.map(f => [f.cartao, f.mes, f.total, f.lancamentos])),
            '| total', pf.faturas_em_formacao_total);
console.log('fim da lista (futuro por último, mais próximo primeiro):\n  ' +
  lancamentosDoMes_({ mes: '2026-09' }).lancamentos.slice(-5).map(l => `${l.data} ${l.descricao || l.categoria}`).join('\n  '));

// 15. fatura que vence neste mês mas ainda não fechou é "ainda fechando"
abas.contas.dados.push(['Santander','credito','Fernando',24,30,0,'sim']);
lancar_({ lancamentos: [{ uuid: 'sant1', data: '2026-09-02', tipo: 'despesa', valor: 958.60,
  categoria: 'Transporte', descricao: 'compra santander', conta: 'Santander' }] });
const ps = painel_({ mes: '2026-09' });
ps.faturas.forEach(f => console.log('fatura de setembro:', f.cartao, '| fecha', f.fecha_em, '| aberta:', f.aberta, '| total', f.total));
console.log('a pagar agora (faturas_abertas):', ps.faturas_abertas);
console.log('em formação:', ps.faturas_em_formacao.map(f => `${f.cartao} ${f.mes} fecha ${f.fecha_em}`).join(' | '));

// 16. lançamento manual: parcelado pelo formulário, e renda futura pela captura
const man = capturar_({ uuid: 'man1', texto: '', lancamento: { data: '2026-09-16', tipo: 'despesa',
  valor: 900, parcelas_total: 3, categoria: 'Casa', descricao: 'Sofá', conta: 'Itaú cartão', origem: 'manual' } });
console.log('manual parcelado: gravados', man.gravados.length,
  '|', abas.lancamentos.dados.slice(1).filter(l => String(l[colx.uuid]).startsWith('man1'))
        .map(l => `${l[colx.parcela_atual]}/${l[colx.parcelas_total]} ${l[colx.valor]} fat ${l[colx.fatura_mes]}`).join(' · '));

capturar_({ uuid: 'man2', texto: '', lancamento: { data: '2026-09-30', tipo: 'receita', valor: 500,
  categoria: 'Freela', descricao: 'Freela fim do mês', conta: 'Itaú', origem: 'manual' } });
console.log('renda futura manual → status',
  abas.lancamentos.dados.slice(1).find(l => l[colx.uuid] === 'man2')[colx.status]);
const pm = painel_({ mes: '2026-09' });
console.log('não entrou no recebi, entrou na previsão: ainda entra', pm.previsao.ainda_entra);

// 17. renda marcada como mensal na hora de lançar, com data futura
capturar_({ uuid: 'emp2', texto: '', lancamento: { data: '2026-09-25', tipo: 'receita', valor: 2200,
  categoria: 'Salário', descricao: 'Salário empresa 2', conta: 'Nubank Fernando', pessoa: 'Fernando',
  origem: 'manual', repete: true } });
const regra = recorrentes_({ mes: '2026-09' }).recorrentes.find(r => r.nome === 'Salário empresa 2');
console.log('regra criada:', regra ? `${regra.tipo} ${regra.valor} dia ${regra.dia}` : 'NÃO CRIOU');
const pe = painel_({ mes: '2026-09' });
const linhaEmp = pe.rendas.find(r => r.nome === 'Salário empresa 2');
console.log('em setembro:', linhaEmp.lancado ? 'já recebido' : 'a receber', '| confirma o agendado:', Boolean(linhaEmp.uuid_agendado));
console.log('outubro herda a regra:', recorrentes_({ mes: '2026-10' }).recorrentes.some(r => r.nome === 'Salário empresa 2'),
            '| e aparece como a receber:', painel_({ mes: '2026-10' }).rendas.some(r => r.nome === 'Salário empresa 2' && !r.lancado));
