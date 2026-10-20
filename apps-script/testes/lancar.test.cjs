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
  categorias: new Aba(['categoria','grupo','tipo','palavras_chave','orcamento_mes','ativo']),
  resumo_mensal: new Aba(['mes','categoria','tipo','total','lancamentos']),
  recorrentes: new Aba(['nome','tipo','categoria','valor','dia','conta','metodo','pessoa','vigencia_inicio','vigencia_fim','escopo','parcelas_total','parcelas_restantes','texto_falado','criado_em'])
};

abas.categorias.dados.push(['Salário','Renda','receita','salario, acme',0,'sim']);
abas.categorias.dados.push(['Freela','Renda','receita','freela',0,'sim']);
abas.categorias.dados.push(['Compras','Variável','despesa','roupa',0,'sim']);
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
// O teste vive num dia fixo. Metade dele depende do que é "futuro" e do que é
// "passado" — renda agendada, ordem da lista, vigência. Com o relógio de
// verdade, virar o mês quebrava testes que ninguém tinha tocado.
const HOJE = new Date(2026, 8, 16, 12, 0, 0);   // 16 de setembro de 2026
const DataReal = Date;
global.Date = class extends DataReal {
  constructor(...args) { super(...(args.length ? args : [HOJE.getTime()])); }
  static now() { return HOJE.getTime(); }
};

global.Utilities = {
  getUuid: () => 'uuid-' + (++seq),
  formatDate: (d, tz, fmt) => {
    const z = (x) => String(x).padStart(2, '0');
    if (fmt === 'yyyy-MM') return d.getFullYear() + '-' + z(d.getMonth() + 1);
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
};
// Propriedades de verdade (em memória): a missão e as conquistas moram nelas.
const props = {};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) };
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

// 18. contas parceladas do mês, agrupadas por compra
const pp = painel_({ mes: '2026-09' });
console.log('parceladas de setembro:');
pp.parceladas.forEach(p => console.log(`  ${p.nome} — parcela ${p.parcela_atual}/${p.parcelas_total} de ${p.valor} | faltam ${p.parcelas_restantes} (${p.falta_pagar}) até ${p.ultima}`));

// 19. o gráfico enxerga o futuro
console.log('\nevolução:');
pp.evolucao.forEach(e => {
  if (e.receitas || e.despesas || e.receitas_previstas || e.despesas_previstas)
    console.log(`  ${e.mes}${e.futuro ? ' (futuro)' : ''}: entrou ${e.receitas} + previsto ${e.receitas_previstas} | saiu ${e.despesas} + previsto ${e.despesas_previstas}`);
});

// 20. parcelas importadas (imp-...) agrupam como uma compra só
['04','05','06'].forEach((n, i) => {
  abas.lancamentos.dados.push(['imp-teste-' + n, `2026-${String(9+i).padStart(2,'0')}-28`, new Date('2026-09-16T10:00:00'),
    'despesa', 173.69, 'Compras', 'Monitor de teste', 'Itaú cartão', 'credito', '', 'Fernando',
    `2026-${String(10+i).padStart(2,'0')}`, 3+i+1, 18, '', 'importado', 'manual', 'ok', '', '']);
});
const imp = painel_({ mes: '2026-09' }).parceladas.find(p => p.nome === 'Monitor de teste');
console.log('importada agrupada:', imp
  ? `parcela ${imp.parcela_atual}/${imp.parcelas_total} | faltam ${imp.parcelas_restantes} (${imp.falta_pagar}) até ${imp.ultima}`
  : 'NÃO ACHOU');
console.log('grupo do uuid importado:', grupoDoUuid_('imp-monitor-04'), '| do uuid do app:', grupoDoUuid_('abc-def-p12'));
console.log('irmãs reconhecidas:', ehDoGrupo_('imp-teste-06', 'imp-teste'), ehDoGrupo_('abc-p2', 'abc'), '| falso positivo:', ehDoGrupo_('abcd', 'abc'));

// 21. aprender categoria com a correção — este falha de verdade
const assert = require('assert');
const pal = (nome) => abas.categorias.dados.find(r => r[0] === nome)[3];
let ap = lancar_({ lancamentos: [{ uuid: 'apr1', data: '2026-09-10', tipo: 'receita', valor: 500, categoria: 'Freela', descricao: 'Acme', aprender_categoria: true }] });
assert.deepStrictEqual(ap.aprendidos, [{ palavra: 'acme', categoria: 'Freela' }], 'aprendeu acme');
assert.ok(pal('Freela').split(', ').includes('acme'), 'acme em Freela');
assert.ok(!pal('Salário').includes('acme'), 'acme saiu de Salário');
ap = lancar_({ lancamentos: [{ uuid: 'apr2', data: '2026-09-10', valor: 50, categoria: 'Compras', descricao: 'Compra parcelada', aprender_categoria: true }] });
assert.deepStrictEqual(ap.aprendidos, [], 'genérica não aprende');
ap = lancar_({ lancamentos: [{ uuid: 'apr3', data: '2026-09-10', valor: 50, categoria: 'Compras', descricao: 'Tênis Nike', aprender_categoria: false }] });
assert.deepStrictEqual(ap.aprendidos, [], 'sem correção não aprende');
const edApr = editarLancamento_({ uuid: 'apr3', campos: { categoria: 'Freela' } });
assert.deepStrictEqual(edApr.aprendido, { palavra: 'tenis nike', categoria: 'Freela' }, 'edição aprende');
console.log('\naprender categoria: ok');

// 22. os 12 meses à frente enxergam vigências, parcelas e agendados
abas.recorrentes.dados.push(['Salário empresa 2','receita','Salário',8000,5,'Nubank Fernando','','Fernando','2026-10','','padrao','','','', new Date()]);
abas.recorrentes.dados.push(['Aluguel teste','despesa','Moradia',1800,10,'Nubank Fernando','','Fernando','2026-01','','padrao','','','', new Date()]);
const prev = previsao12_();
const mes = (k) => prev.find((x) => x.mes === k);
assert.strictEqual(prev.length, 12, '12 meses');
assert.ok(mes('2026-10').fixas_a_receber >= 8000, 'renda que começa em outubro entra na previsão');
assert.ok(mes('2026-09').fixas_a_receber < 8000, 'e não aparece antes da vigência');
assert.ok(mes('2026-11').sai >= 1800, 'aluguel continua nos meses seguintes');
console.log('\nprevisão de 12 meses: ok');

// 23. a resposta do modelo, nas três formas que já apareceram na prática
assert.strictEqual(JSON.parse(recomporJson_('"veredito":"apertado"}')).veredito, 'apertado', 'continuação do prefill');
assert.strictEqual(JSON.parse(recomporJson_('{"veredito":"cabe"}')).veredito, 'cabe', 'objeto inteiro');
assert.strictEqual(
  JSON.parse(recomporJson_('Direto ao ponto: {"projecao":[{"mes":"2026-10"}],"veredito":"arriscado"} pronto')).veredito,
  'arriscado', 'objeto com texto em volta, sem se perder na chave de dentro');
console.log('\nJSON do modelo: ok');

// 24. concatenação partida: uma linha que acaba em aspas e a seguinte que
// começa em aspas, sem o '+' no meio. O JavaScript não reclama — fecha a
// expressão ali e joga fora todo o resto em silêncio. Foi assim que metade
// da instrução da análise (inclusive o contrato do JSON) deixou de chegar
// no modelo por dois dias.
const fonte = require('fs').readFileSync(__dirname + '/../Codigo.gs', 'utf8').split('\n');
const partidas = [];
for (let i = 0; i < fonte.length - 1; i++) {
  const atual = fonte[i].replace(/\s+$/, '');
  if (!/['"]$/.test(atual)) continue;
  let j = i + 1;
  while (j < fonte.length && !fonte[j].trim()) j++;
  if (j < fonte.length && /^['"]/.test(fonte[j].trim())) partidas.push(i + 1);
}
assert.deepStrictEqual(partidas, [], 'concatenação partida nas linhas: ' + partidas.join(', '));
console.log('\nconcatenação de textos: ok');

// 25. o extrato: tudo, do mais novo para o mais antigo, com busca e página
lancar_({ lancamentos: [
  { uuid: 'ex1', data: '2026-09-02', valor: 50, categoria: 'Compras', descricao: 'Tenis Ipiranga velho' },
  { uuid: 'ex2', data: '2026-09-14', valor: 57, categoria: 'Transporte', descricao: 'Posto Ipiranga' },
  { uuid: 'ex3', data: '2026-09-14', valor: 6.99, categoria: 'Mercado', descricao: 'H2o redbeef' }
] });

const uuids = (r) => r.lancamentos.map((l) => l.uuid);

const pag1 = extrato_({ limite: 2 });
assert.strictEqual(pag1.lancamentos.length, 2, 'a página respeita o limite');
assert.ok(pag1.tem_mais, 'avisa que ainda há mais');
assert.ok(pag1.total > 2, 'o total conta tudo, não só a página');

const tudo = extrato_({ limite: 100 }).lancamentos;
const pos = (u) => tudo.findIndex((l) => l.uuid === u);
assert.ok(pos('ex2') < pos('ex1'), 'o mais novo vem antes do mais antigo');

const pag2 = extrato_({ limite: 2, inicio: 2 });
assert.ok(!uuids(pag2).some((u) => uuids(pag1).includes(u)), 'a segunda página não repete a primeira');

assert.ok(uuids(extrato_({ busca: 'REDBEEF' })).includes('ex3'), 'busca ignora a caixa');
assert.ok(uuids(extrato_({ busca: 'h2o redbeef' })).includes('ex3'), 'busca por descrição inteira');
assert.deepStrictEqual(uuids(extrato_({ busca: 'ipiranga' })).sort(), ['ex1', 'ex2'], 'acha os dois do Ipiranga');
assert.ok(uuids(extrato_({ busca: '6.99' })).includes('ex3'), 'busca pelo valor');
assert.strictEqual(extrato_({ busca: 'nao existe isso aqui' }).total, 0, 'busca sem resultado devolve vazio');

excluirLancamento_({ uuid: 'ex1' });
assert.ok(!uuids(extrato_({ busca: 'tenis ipiranga' })).includes('ex1'), 'o que foi excluído some do extrato');
console.log('\nextrato: ok');

// 26. gasto livre de hoje: só o que não estava previsto conta contra o "ouro de hoje"
const livreAntes = painel_({ mes: '2026-09' }).gasto_livre_hoje || 0;
lancar_({ lancamentos: [
  { uuid: 'ouro1', data: '2026-09-16', valor: 50, categoria: 'Compras', descricao: 'tenis', origem: 'manual' },
  { uuid: 'ouro2', data: '2026-09-16', valor: 900, categoria: 'Moradia', descricao: 'aluguel', origem: 'conta fixa' },
  { uuid: 'ouro3', data: '2026-09-15', valor: 30, categoria: 'Compras', descricao: 'ontem', origem: 'manual' }
] });
const pv26 = painel_({ mes: '2026-09' });
assert.strictEqual(arred_(pv26.gasto_livre_hoje - livreAntes), 50, 'só o gasto manual de hoje conta (sem conta fixa, sem ontem)');
assert.ok(typeof pv26.previsao.sobra === 'number', 'a previsão continua vindo junto');
console.log('\ngasto livre de hoje: ok');

// 27. missão do mês e conquistas: guardadas nas propriedades do script
assert.deepStrictEqual(painel_({ mes: '2026-09' }).metas, [], 'sem missão, lista vazia');
assert.deepStrictEqual(painel_({ mes: '2026-09' }).conquistas, {}, 'sem conquistas ainda');
salvarMeta_({ valor: 1500 });
salvarMeta_({ valor: 1000, desde: '2026-07' });
salvarMeta_({ valor: 1800 });                                   // mesmo mês: troca, não duplica
assert.deepStrictEqual(painel_({ mes: '2026-09' }).metas, [{ desde: '2026-07', valor: 1000 }, { desde: '2026-09', valor: 1800 }], 'metas por vigência, em ordem');
assert.strictEqual(salvarMeta_({ valor: 1e9 }).ok, false, 'valor absurdo é recusado');
const c1 = conquistar_({ ids: ['fase_limpa', 'nao_existe', 'primeira_missao'] });
assert.deepStrictEqual(c1.novas, ['fase_limpa', 'primeira_missao'], 'id desconhecido é ignorado');
assert.strictEqual(c1.conquistas.fase_limpa, '2026-09-16', 'guarda o dia em que ganhou');
assert.deepStrictEqual(conquistar_({ ids: ['fase_limpa'] }).novas, [], 'a mesma conquista não é ganha duas vezes');
assert.deepStrictEqual(Object.keys(painel_({ mes: '2026-09' }).conquistas).sort(), ['fase_limpa', 'primeira_missao'], 'o painel traz as conquistas');
assert.strictEqual(conquistar_({ ids: 'fase_limpa' }).ok, true, 'ids que não são lista não quebram');
console.log('\nmissão e conquistas: ok');

// 28. baús: guardar sai do mês sem virar gasto, e o histórico acompanha o nome
const pAntes = painel_({ mes: '2026-09' });
assert.deepStrictEqual(baus_().baus, [], 'sem baús ainda (a aba nasce sozinha)');
assert.strictEqual(salvarBau_({ nome: '  Viagem   Chile ', meta: 6000, objetivo: 'Santiago', prazo: '2027-07' }).ok, true);
assert.strictEqual(salvarBau_({ nome: 'viagem chile', meta: 1 }).erro, 'nome_repetido', 'nome repetido (sem acento/caixa) é recusado');
assert.strictEqual(salvarBau_({ nome: '' }).erro, 'nome_vazio');
capturar_({ uuid: 'bau1', lancamento: { tipo: 'guardar', valor: 300, categoria: 'Viagem Chile', data: '2026-09-16', conta: 'Nubank Fernando', origem: 'bau' } });
capturar_({ uuid: 'bau2', lancamento: { tipo: 'guardar', valor: 200, categoria: 'Viagem Chile', data: '2026-08-10', conta: 'Nubank Fernando', origem: 'bau' } });
capturar_({ uuid: 'bau3', lancamento: { tipo: 'resgatar', valor: 50, categoria: 'Viagem Chile', data: '2026-09-16', conta: 'Nubank Fernando', origem: 'bau' } });

let bs = baus_();
let chile = bs.baus.find((b) => b.nome === 'Viagem Chile');
assert.strictEqual(chile.saldo, 450, '300 + 200 − 50');
assert.strictEqual(chile.guardado_mes, 250, 'só setembro: 300 − 50');
assert.strictEqual(chile.meta, 6000);
assert.strictEqual(chile.prazo, '2027-07');
assert.deepStrictEqual(chile.movimentos.map((m) => m.data), ['2026-09-16', '2026-09-16', '2026-08-10'], 'histórico do mais novo para o mais antigo');
assert.strictEqual(bs.total, 450);

const pDepois = painel_({ mes: '2026-09' });
assert.strictEqual(pDepois.guardado_mes, 250, 'o painel conta o guardado do mês');
assert.strictEqual(pDepois.previsao.guardado, 250);
assert.strictEqual(pDepois.baus_total, 450);
assert.strictEqual(arred_(pDepois.despesas - pAntes.despesas), 0, 'guardar não é gasto');
assert.strictEqual(arred_(pDepois.receitas - pAntes.receitas), 0, 'resgatar não é renda');
assert.strictEqual(arred_(pDepois.previsao.sobra - pAntes.previsao.sobra), 0, 'a sobra do mês continua a mesma (o guardado faz parte dela)');
assert.ok(!pDepois.por_categoria.some((c) => c.nome === 'Viagem Chile'), 'baú não aparece como categoria');
assert.strictEqual(arred_(pDepois.saiu_caixa - pAntes.saiu_caixa), 250, 'mas o dinheiro saiu da conta');
assert.strictEqual(pDepois.evolucao.find((e) => e.mes === '2026-08').guardado, 200, 'evolução guarda o guardado de cada mês');
const resumo28 = resumo_({ mes: '2026-09' });
assert.ok(!resumo28.por_categoria.some((c) => c.categoria === 'Viagem Chile'), 'o resumo também não conta como gasto');

// renomear leva o histórico junto, e renomear categoria não mexe em baú
abas.categorias.dados.push(['Viagem Chile', 'Variável', 'despesa', '', 0, 'sim']);
renomearNosLancamentos_('categorias', 'Viagem Chile', 'Viagens');
assert.strictEqual(baus_().baus.find((b) => b.nome === 'Viagem Chile').saldo, 450, 'renomear a CATEGORIA não mexe no baú de mesmo nome');
assert.strictEqual(salvarBau_({ nome_antigo: 'Viagem Chile', nome: 'Chile 2027', meta: 6000 }).ok, true);
bs = baus_();
assert.strictEqual(bs.baus.length, 1, 'renomear não cria baú novo');
assert.strictEqual(bs.baus[0].nome, 'Chile 2027');
assert.strictEqual(bs.baus[0].saldo, 450, 'o dinheiro foi junto');

// arquivar: só vazio
assert.strictEqual(excluirBau_({ nome: 'Chile 2027' }).erro, 'bau_com_dinheiro');
salvarBau_({ nome: 'Vazio', meta: 100 });
assert.strictEqual(excluirBau_({ nome: 'vazio' }).ok, true);
assert.ok(!baus_().baus.some((b) => b.nome === 'Vazio'), 'arquivado some da lista');

// editar um movimento de baú não ensina palavra-chave para categoria nenhuma
const antesPal = JSON.stringify(abas.categorias.dados);
editarLancamento_({ uuid: 'bau1', campos: { descricao: 'mercado', categoria: 'Chile 2027' } });
assert.strictEqual(JSON.stringify(abas.categorias.dados), antesPal, 'nada aprendido');

// o que a IA recebe
if (!abas.memoria) abas.memoria = new Aba(['fato', 'origem', 'data', 'ativo']);
assert.ok(panorama_({}).baus.some((b) => b.nome === 'Chile 2027' && b.saldo === 450), 'a análise sabe dos baús');
console.log('\nbaús: ok');

// 29. extrato por mês: só o mês pedido, e a lista dos meses que têm lançamento
const ago = extrato_({ mes: '2026-08', limite: 100 });
assert.ok(ago.lancamentos.length > 0 && ago.lancamentos.every((l) => l.data.slice(0, 7) === '2026-08'), 'só agosto');
assert.strictEqual(ago.mes, '2026-08');
assert.ok(ago.meses.includes('2026-08') && ago.meses.includes('2026-09'), 'meses com lançamento, para marcar no seletor');
assert.deepStrictEqual([...ago.meses].sort(), ago.meses, 'em ordem');
assert.strictEqual(extrato_({ mes: '1999-01' }).total, 0, 'mês vazio');
assert.ok(extrato_({ mes: 'lixo' }).total > ago.total, 'mês inválido é ignorado (tudo)');
const busca29 = extrato_({ mes: '2026-09', busca: 'ipiranga' });
assert.ok(busca29.lancamentos.every((l) => l.data.slice(0, 7) === '2026-09'), 'busca dentro do mês');
console.log('\nextrato por mês: ok');

// 30. rendimento dos baús: CDI do Banco Central, dia útil a dia útil, com IR e IOF
{
  // aba velha (sem as colunas de rendimento) ganha as colunas e não perde nada
  const velha = new Aba(['nome', 'meta', 'objetivo', 'prazo', 'criado_em', 'ativo']);
  abas.baus.dados.slice(1).forEach((l) => velha.dados.push(l.slice(0, 6)));
  const antes = velha.dados.length;
  abas.baus = velha;
  assert.ok(baus_().baus.some((b) => b.nome === 'Chile 2027' && b.saldo === 450), 'baú antigo continua lá');
  assert.deepStrictEqual(abas.baus.dados[0], ABAS.baus, 'cabeçalho novo');
  assert.strictEqual(abas.baus.dados.length, antes, 'nenhuma linha perdida');
  assert.strictEqual(baus_().baus.find((b) => b.nome === 'Chile 2027').rende.tipo, '', 'baú antigo não rende');

  // Banco Central de mentira: 0,050788% ao dia em todo dia útil de agosto e
  // setembro, menos o feriado de 7 de setembro. Conta quantas vezes foi chamado.
  const TAXA = 0.050788;
  let chamadas = 0, foraDoAr = false;
  const br = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  const uteis = [];
  for (let d = new DataReal(Date.UTC(2026, 7, 1, 12)); d < new DataReal(Date.UTC(2026, 8, 16, 12)); d = new DataReal(d.getTime() + 86400000)) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || iso === '2026-09-07') continue;
    uteis.push(iso);
  }
  UrlFetchApp = { fetch: (url) => {
    chamadas++;
    if (foraDoAr) throw new Error('fora do ar');
    assert.ok(/bcdata\.sgs\.12\/dados\?formato=json&dataInicial=\d\d\/\d\d\/\d{4}&dataFinal=16\/09\/2026/.test(url), 'pede a série 12 até hoje: ' + url);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(uteis.map((d) => ({ data: br(d), valor: String(TAXA) }))) };
  } };
  const memCache = {};
  CacheService = { getScriptCache: () => ({ get: (k) => (k in memCache ? memCache[k] : null), put: (k, v) => { memCache[k] = v; } }) };

  // um baú que não rende não chama o Banco Central
  baus_();
  assert.strictEqual(chamadas, 0, 'sem baú rendendo, nada de internet');

  // 1.000 guardados em 17/08 rendendo 115% do CDI
  assert.strictEqual(salvarBau_({ nome: 'Turbo', meta: 5000, rende_tipo: 'cdi', rende_pct: 115 }).ok, true);
  capturar_({ uuid: 'r1', lancamento: { tipo: 'guardar', valor: 1000, categoria: 'Turbo', data: '2026-08-17', conta: 'Nubank Fernando', origem: 'bau' } });
  let turbo = baus_().baus.find((b) => b.nome === 'Turbo');
  const dias = uteis.filter((d) => d >= '2026-08-17' && d < '2026-09-16').length;
  const esperado = 1000 * Math.pow(1 + TAXA / 100 * 1.15, dias);
  assert.strictEqual(turbo.saldo, arred_(esperado), 'juros sobre juros nos dias úteis (' + dias + ' dias)');
  assert.strictEqual(turbo.rende.principal, 1000);
  assert.strictEqual(turbo.rende.rendimento, arred_(esperado - 1000));
  assert.strictEqual(turbo.rende.iof, 0, '30 dias: sem IOF');
  assert.strictEqual(turbo.rende.ir, arred_((esperado - 1000) * 0.225), 'IR de 22,5% até 180 dias');
  assert.strictEqual(turbo.rende.liquido, arred_(esperado - (esperado - 1000) * 0.225));
  assert.strictEqual(turbo.rende.cdi_data, '2026-09-15');
  assert.strictEqual(turbo.rende.estimado, false);
  assert.ok(Math.abs(turbo.rende.cdi_anual - 13.65) < 0.1, 'CDI anual por volta de 13,65%: ' + turbo.rende.cdi_anual);
  assert.ok(turbo.rende.rende_por_mes > 11 && turbo.rende.rende_por_mes < 14, 'uns R$ 12 por mês a cada mil: ' + turbo.rende.rende_por_mes);
  assert.ok(Math.abs(turbo.rende.por_mes_rendimento['2026-08'] + turbo.rende.por_mes_rendimento['2026-09'] - turbo.rende.rendimento) <= 0.011, 'o rendimento mês a mês fecha com o total (até o centavo)');
  assert.strictEqual(turbo.guardado_mes, 0, 'rendimento não é dinheiro guardado no mês');
  assert.strictEqual(chamadas, 1);
  baus_(); painel_({ mes: '2026-09' });
  assert.strictEqual(chamadas, 1, 'o CDI do dia fica no cache: uma ida por dia');

  // o feriado não rende
  const comFeriado = uteis.filter((d) => d >= '2026-08-17' && d < '2026-09-16').includes('2026-09-07');
  assert.strictEqual(comFeriado, false);

  // o painel conta o rendimento no total dos baús, mas não no mês
  const p30 = painel_({ mes: '2026-09' });
  assert.strictEqual(p30.baus_total, arred_(450 + turbo.saldo), 'total dos baús com rendimento');
  assert.strictEqual(p30.guardado_mes, 250, 'guardado do mês não muda com rendimento');

  // acerto com o banco: o banco diz 1.013,00 → entra a diferença, que também rende dali para frente
  const diferenca = arred_(1013 - turbo.saldo);
  capturar_({ uuid: 'r2', lancamento: { tipo: 'rendimento', valor: diferenca, categoria: 'Turbo', data: '2026-09-16', origem: 'acerto' } });
  turbo = baus_().baus.find((b) => b.nome === 'Turbo');
  assert.strictEqual(turbo.saldo, 1013, 'depois do acerto, o saldo é o do banco');
  assert.strictEqual(turbo.guardado_mes, 0, 'acerto não é guardar');
  assert.strictEqual(painel_({ mes: '2026-09' }).guardado_mes, 250, 'nem no painel');
  assert.strictEqual(painel_({ mes: '2026-09' }).baus_total, 450 + 1013);
  const pan = panorama_({}).baus.find((b) => b.nome === 'Turbo');
  assert.strictEqual(pan.rende, '115% do CDI', 'a análise sabe quanto rende');

  // acerto para baixo também vale
  capturar_({ uuid: 'r3', lancamento: { tipo: 'rendimento', valor: -3, categoria: 'Turbo', data: '2026-09-16', origem: 'acerto' } });
  assert.strictEqual(baus_().baus.find((b) => b.nome === 'Turbo').saldo, 1010);
  excluirLancamento_({ uuid: 'r3' });

  // depósito novo paga IOF; resgate sai do mais antigo primeiro
  capturar_({ uuid: 'r4', lancamento: { tipo: 'guardar', valor: 500, categoria: 'Turbo', data: '2026-09-10', origem: 'bau' } });
  turbo = baus_().baus.find((b) => b.nome === 'Turbo');
  assert.ok(turbo.rende.iof > 0, 'depósito de 6 dias tem IOF: ' + turbo.rende.iof);
  capturar_({ uuid: 'r5', lancamento: { tipo: 'resgatar', valor: 1013, categoria: 'Turbo', data: '2026-09-16', origem: 'bau' } });
  turbo = baus_().baus.find((b) => b.nome === 'Turbo');
  assert.ok(turbo.rende.iof > 0, 'sobrou o depósito novo, que ainda paga IOF');
  assert.ok(turbo.rende.principal > 499 && turbo.rende.principal <= 500, 'o que sobrou é o depósito de 10/09: ' + turbo.rende.principal);

  // limite: até 500 rende 115%, acima rende 100%
  salvarBau_({ nome: 'Limite', rende_tipo: 'cdi', rende_pct: 115, rende_limite: 500, rende_acima: 100 });
  capturar_({ uuid: 'r6', lancamento: { tipo: 'guardar', valor: 2000, categoria: 'Limite', data: '2026-09-14', origem: 'bau' } });
  const lim = baus_().baus.find((b) => b.nome === 'Limite');
  const d1 = 500 * TAXA / 100 * 1.15 + 1500 * TAXA / 100;
  const s1 = 2000 + d1;
  const ate2 = 500, d2 = ate2 * TAXA / 100 * 1.15 + (s1 - ate2) * TAXA / 100;
  assert.strictEqual(lim.saldo, arred_(s1 + d2), 'o que passa do limite rende menos');
  assert.strictEqual(lim.rende.limite, 500);
  assert.strictEqual(lim.rende.acima, 100);

  // taxa fixa ao ano, sem Banco Central
  salvarBau_({ nome: 'Fixo', rende_tipo: 'fixo', rende_pct: 12 });
  capturar_({ uuid: 'r7', lancamento: { tipo: 'guardar', valor: 1000, categoria: 'Fixo', data: '2026-09-14', origem: 'bau' } });
  const fixo = baus_().baus.find((b) => b.nome === 'Fixo');
  assert.strictEqual(fixo.saldo, arred_(1000 * Math.pow(Math.pow(1.12, 1 / 252), 2)), '12% ao ano em 2 dias úteis');
  assert.ok(Math.abs(fixo.rende.taxa_mes_ate - (Math.pow(1.12, 1 / 12) - 1)) < 1e-6);

  // valores tortos são consertados
  assert.strictEqual(salvarBau_({ nome: 'Torto', rende_tipo: 'poupanca', rende_pct: 115 }).bau.rende.tipo, '', 'tipo desconhecido vira não rende');
  assert.strictEqual(salvarBau_({ nome: 'Torto', nome_antigo: 'Torto', rende_tipo: 'cdi', rende_pct: 9999 }).bau.rende.pct, 300, 'teto de 300% do CDI');
  assert.strictEqual(salvarBau_({ nome: 'Torto', nome_antigo: 'Torto', rende_tipo: 'cdi', rende_pct: 0 }).bau.rende.tipo, '', '0% é não rende');

  // Banco Central fora do ar e sem cache: usa a última taxa conhecida e avisa
  Object.keys(memCache).forEach((k) => delete memCache[k]);
  foraDoAr = true;
  const semRede = baus_().baus.find((b) => b.nome === 'Limite');
  assert.strictEqual(semRede.rende.estimado, true, 'avisa que é estimativa');
  assert.strictEqual(semRede.saldo, lim.saldo, 'com a mesma taxa, dá o mesmo número');
  const antesDeFalhar = chamadas;
  baus_();
  assert.strictEqual(chamadas, antesDeFalhar, 'depois de falhar, espera um pouco antes de tentar de novo');

  UrlFetchApp = { fetch: () => { throw new Error('sem rede no teste'); } };
  CacheService = { getScriptCache: () => ({ get: () => null, put: () => {} }) };
}
console.log('\nrendimento dos baús: ok');

// 31. missão em dupla: quem guardou quanto no mês, e quem lançou nos últimos
{
  const antes = painel_({ mes: '2026-09' }).guardado_por_pessoa || {};
  capturar_({ uuid: 'dupla1', lancamento: { tipo: 'guardar', valor: 120, categoria: 'Chile 2027', data: '2026-09-16', pessoa: 'Fernando', origem: 'bau' } });
  capturar_({ uuid: 'dupla2', lancamento: { tipo: 'guardar', valor: 80, categoria: 'Chile 2027', data: '2026-09-15', pessoa: 'Mayara', origem: 'bau' } });
  capturar_({ uuid: 'dupla3', lancamento: { tipo: 'resgatar', valor: 30, categoria: 'Chile 2027', data: '2026-09-16', pessoa: 'Mayara', origem: 'bau' } });
  capturar_({ uuid: 'dupla4', lancamento: { tipo: 'guardar', valor: 999, categoria: 'Chile 2027', data: '2026-08-20', pessoa: 'Mayara', origem: 'bau' } });
  capturar_({ uuid: 'dupla5', lancamento: { tipo: 'rendimento', valor: 5, categoria: 'Chile 2027', data: '2026-09-16', pessoa: 'Mayara', origem: 'acerto' } });
  const pp = painel_({ mes: '2026-09' }).guardado_por_pessoa;
  assert.strictEqual(arred_((pp.Fernando || 0) - (antes.Fernando || 0)), 120, 'Fernando guardou 120');
  assert.strictEqual(arred_((pp.Mayara || 0) - (antes.Mayara || 0)), 50, 'Mayara: 80 − 30; agosto e acerto não contam');
  const ult = resumo_({ mes: '2026-09' }).ultimos;
  assert.ok(ult.some((u) => u.uuid === 'dupla1' && u.pessoa === 'Fernando'), 'os últimos trazem quem lançou');
}
console.log('\nmissão em dupla: ok');

// 32. importar extrato: o que já foi importado e o que já foi lançado à mão
{
  lancar_({ lancamentos: [
    { uuid: 'manual-a', data: '2026-09-10', valor: 119.93, categoria: 'Compras', descricao: 'internet' },
    { uuid: 'manual-b', data: '2026-09-11', valor: 50.37, categoria: 'Compras', descricao: 'mercado' },
    { uuid: 'imp-ja', data: '2026-09-12', valor: 33, categoria: 'Compras', descricao: 'Padaria' }
  ] });
  const r = conferirImportacao_({ movimentos: [
    { id: 'imp-ja', data: '2026-09-12', valor: 33, tipo: 'despesa' },
    { id: 'imp-1', data: '2026-09-12', valor: 119.93, tipo: 'despesa' },   // 2 dias depois: é o "internet"
    { id: 'imp-2', data: '2026-09-11', valor: 50.37, tipo: 'despesa' },
    { id: 'imp-3', data: '2026-09-11', valor: 50.37, tipo: 'despesa' },      // o segundo 50 não tem par
    { id: 'imp-4', data: '2026-09-11', valor: 50.37, tipo: 'receita' },      // tipo diferente não combina
    { id: 'imp-5', data: '2026-09-20', valor: 119.93, tipo: 'despesa' }    // longe demais
  ] });
  assert.deepStrictEqual(r.importados, ['imp-ja'], 'importado antes: o id virou uuid');
  assert.strictEqual(r.parecidos['imp-1'].uuid, 'manual-a');
  assert.strictEqual(r.parecidos['imp-2'].uuid, 'manual-b');
  assert.ok(!r.parecidos['imp-3'], 'cada lançamento explica um movimento só');
  assert.ok(!r.parecidos['imp-4'] && !r.parecidos['imp-5']);
  // palavra-chave do extrato
  abas.categorias.dados.push(['Internet', 'Casa', 'despesa', '', 0, 'sim']);
  lancar_({ lancamentos: [{ uuid: 'imp-6', data: '2026-09-13', valor: 119.93, categoria: 'Internet', descricao: 'Elevar Telecom Ltda', palavra_chave: 'elevar telecom', aprender_categoria: true, origem: 'importado' }] });
  const internet = abas.categorias.dados.find((c) => c[0] === 'Internet');
  assert.ok(String(internet[3]).includes('elevar telecom'), 'aprendeu a palavra do extrato: ' + internet[3]);
}
console.log('\nimportar extrato: ok');

// 33. avisos no celular: chaves VAPID, assinatura ES256 que o node confere, inscrições e o texto do aviso
{
  const crypto = require('crypto');
  const sinal = (b) => Array.from(b).map((x) => (x > 127 ? x - 256 : x));
  const semSinal = (b) => Buffer.from(b.map((x) => (x < 0 ? x + 256 : x)));
  Utilities.DigestAlgorithm = { SHA_256: 'sha256' };
  Utilities.computeDigest = (alg, bytes) => sinal(crypto.createHash('sha256').update(semSinal(bytes)).digest());
  Utilities.computeHmacSha256Signature = (valor, chave) => sinal(crypto.createHmac('sha256', semSinal(chave)).update(semSinal(valor)).digest());
  Utilities.base64EncodeWebSafe = (bytes) => semSinal(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  Utilities.newBlob = (t) => ({ getBytes: () => sinal(Buffer.from(t, 'utf8')) });
  const gatilhos = [];
  const horas = [];
  ScriptApp = { getProjectTriggers: () => gatilhos.map((h, i) => ({ getHandlerFunction: () => h, i })),
    deleteTrigger: (t) => { gatilhos.splice(gatilhos.indexOf(t.getHandlerFunction()), 1); },
    newTrigger: (h) => ({ timeBased: () => ({ atHour: (x) => ({ everyDays: () => ({ create: () => { gatilhos.push(h); horas.push(x); } }) }), everyHours: () => ({ create: () => gatilhos.push(h) }) }) }) };

  const pub = vapidPublica_().chave;
  assert.strictEqual(pub, vapidPublica_().chave, 'a chave é criada uma vez só');
  const raw = Buffer.from(pub.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  assert.strictEqual(raw.length, 65); assert.strictEqual(raw[0], 4);
  const chaveNode = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });

  const aut = autorizacaoVapid_('https://fcm.googleapis.com/fcm/send/abc');
  const jwt = /^vapid t=([^,]+), k=(.+)$/.exec(aut);
  assert.ok(jwt, 'formato vapid t=…, k=…');
  assert.strictEqual(jwt[2], pub);
  const [cab, corpo, ass] = jwt[1].split('.');
  const ok = crypto.verify('sha256', Buffer.from(`${cab}.${corpo}`), { key: chaveNode, dsaEncoding: 'ieee-p1363' }, Buffer.from(ass, 'base64url'));
  assert.ok(ok, 'o node confere a assinatura ES256');
  const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString());
  assert.strictEqual(dados.aud, 'https://fcm.googleapis.com');
  assert.ok(dados.exp > Date.now() / 1000 && dados.sub.startsWith('mailto:'));
  // várias mensagens: todas conferem (k determinístico, mas diferente por mensagem)
  for (const m of ['a', 'outra coisa', 'x'.repeat(300)]) {
    const s = semSinal(assinarEs256_(Array.from(Buffer.from(m)), chavesVapid_().d));
    assert.ok(crypto.verify('sha256', Buffer.from(m), { key: chaveNode, dsaEncoding: 'ieee-p1363' }, s), 'confere: ' + m.slice(0, 10));
  }

  assert.strictEqual(inscrever_({ inscricao: { endpoint: 'https://malicioso.com/x' } }).erro, 'servico_desconhecido', 'só serviços de push conhecidos');
  assert.strictEqual(inscrever_({ inscricao: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }, pessoa: 'Fernando' }).inscritos, 1);
  assert.strictEqual(inscrever_({ inscricao: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }, pessoa: 'Fernando' }).inscritos, 1, 'o mesmo celular não duplica');
  inscrever_({ inscricao: { endpoint: 'https://web.push.apple.com/QQ' }, pessoa: 'Mayara' });
  assert.deepStrictEqual(gatilhos.filter((g) => g === 'avisarContasDoDia').length, 1, 'gatilho diário criado uma vez');
  assert.strictEqual(horas[horas.length - 1], 12, 'avisa ao meio-dia');

  // o texto do aviso (16/09): vence hoje, amanhã, já venceu; lançada não avisa
  const painelReal = painel_;
  painel_ = () => ({ fixas: [
    { nome: 'Energia', valor: 212.4, dia: 16, lancado: false },
    { nome: 'Internet', valor: 119.9, dia: 17, lancado: false },
    { nome: 'Academia', valor: 99.9, dia: 17, lancado: false },
    { nome: 'Aluguel', valor: 1800, dia: 5, lancado: false },
    { nome: 'Celular', valor: 64.99, dia: 16, lancado: true }
  ] });
  const av = avisosDeHoje_().avisos;
  assert.deepStrictEqual(av.map((a) => a.tag), ['hoje', 'amanha', 'atacando']);
  assert.strictEqual(av[0].titulo, '⚔️ O chefe Energia ataca hoje');
  assert.strictEqual(av[1].titulo, '🛡️ 2 contas vencem amanhã');
  assert.ok(av[2].corpo.includes('Aluguel R$ 1800,00'));

  // o gatilho cutuca os inscritos; 410 tira o celular da lista
  const chamados = [];
  UrlFetchApp = { fetch: (url, op) => { chamados.push([url, op.headers.Authorization.slice(0, 8), op.headers.TTL]); return { getResponseCode: () => (url.includes('apple') ? 410 : 201) }; } };
  // Quem implantou com o gatilho das 8h: a primeira rodada troca pelo do meio-dia e não avisa.
  PROP.setProperty('AVISOS_HORA', '8');
  const troca = avisarContasDoDia();
  assert.strictEqual(troca.gatilho, 'trocado'); assert.strictEqual(troca.enviados, 0);
  assert.strictEqual(gatilhos.filter((g) => g === 'avisarContasDoDia').length, 1, 'continua um gatilho só');
  assert.strictEqual(horas[horas.length - 1], 12);
  const r33 = avisarContasDoDia();
  assert.strictEqual(r33.enviados, 1);
  assert.strictEqual(chamados.length, 2);
  assert.strictEqual(chamados[0][1], 'vapid t=');
  assert.deepStrictEqual(lerInscricoes_().map((i) => i.pessoa), ['Fernando'], 'o celular que saiu (410) some');
  painel_ = () => ({ fixas: [{ nome: 'Energia', valor: 1, dia: 1, lancado: true }] });
  chamados.length = 0;
  assert.strictEqual(avisarContasDoDia().enviados, 0, 'nada a avisar: não cutuca');
  assert.strictEqual(chamados.length, 0);

  // teste pelos Ajustes: cutuca e o próximo "avisos" é a mensagem de teste
  assert.strictEqual(testarAviso_({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }).ok, true);
  assert.strictEqual(avisosDeHoje_().avisos[0].tag, 'teste');
  assert.strictEqual(avisosDeHoje_().avisos.length, 0, 'o teste aparece uma vez só');
  assert.strictEqual(testarAviso_({ endpoint: 'https://fcm.googleapis.com/fcm/send/outro' }).erro, 'nao_inscrito');
  assert.strictEqual(desinscrever_({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }).inscritos, 0);
  painel_ = painelReal;
  UrlFetchApp = { fetch: () => { throw new Error('sem rede no teste'); } };
}
console.log('\navisos no celular: ok');

// 34. dinheiro nas contas: saldo conferido com o banco + o que veio depois, e o
// rendimento do CDI entrando como renda um pouco por dia
{
  // a aba velha de contas (7 colunas) ganha rende_tipo/rende_pct sem perder nada
  const linhasAntes = abas.contas.dados.length;
  CONTAS_CONFERIDA_ = false;
  lerCadastro_('contas');
  assert.deepStrictEqual(abas.contas.dados[0], ABAS.contas, 'cabeçalho novo das contas');
  assert.strictEqual(abas.contas.dados.length, linhasAntes, 'nenhuma conta perdida');

  // Banco Central de mentira: 0,05% ao dia útil em setembro, menos o feriado de 7/9
  const TAXA = 0.05;
  const br = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  const uteis = [];
  for (let d = new DataReal(Date.UTC(2026, 7, 20, 12)); d < new DataReal(Date.UTC(2026, 8, 16, 12)); d = new DataReal(d.getTime() + 86400000)) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || iso === '2026-09-07') continue;
    uteis.push(iso);
  }
  UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(uteis.map((d) => ({ data: br(d), valor: String(TAXA) }))) }) };
  const memCache = {};
  CacheService = { getScriptCache: () => ({ get: (k) => (k in memCache ? memCache[k] : null), put: (k, v) => { memCache[k] = v; } }) };

  assert.ok(salvarCadastro_({ tipo: 'contas', item: { nome: 'Conta Teste', tipo: 'conta corrente', pessoa: 'Mayara', rende_tipo: 'cdi', rende_pct: '' } }).ok);
  const cad = lerCadastro_('contas').find((c) => c.nome === 'Conta Teste');
  assert.strictEqual(cad.rende_tipo, 'cdi'); assert.strictEqual(cad.rende_pct, 100, 'CDI sem % vira 100%');
  salvarCadastro_({ tipo: 'contas', item: { nome: 'Itaú cartão', rende_tipo: 'cdi', rende_pct: 100 } });
  assert.strictEqual(lerCadastro_('contas').find((c) => c.nome === 'Itaú cartão').rende_tipo, '', 'cartão de crédito não rende');
  assert.ok(!contasSaldo_().contas.some((c) => c.nome === 'Itaú cartão'), 'cartão de crédito fica fora');

  // sem saldo conferido: sem saldo e sem renda inventada
  let cs = contasSaldo_();
  assert.strictEqual(cs.contas.find((c) => c.nome === 'Conta Teste').saldo, null);
  assert.ok(!linhas().some((r) => r[col.origem] === 'rendimento_conta'), 'nada de rendimento sem saldo conferido');

  // erros
  assert.strictEqual(acertarConta_({ conta: 'Não existe', saldo: 10 }).erro, 'conta_desconhecida');
  assert.strictEqual(acertarConta_({ conta: 'Itaú cartão', saldo: 10 }).erro, 'conta_desconhecida');
  assert.strictEqual(acertarConta_({ conta: 'Conta Teste', saldo: 'abc' }).erro, 'saldo_invalido');
  assert.strictEqual(acertarConta_({ conta: 'Conta Teste', saldo: '' }).erro, 'saldo_invalido');
  assert.strictEqual(acertarConta_({ conta: 'Conta Teste', saldo: 10, origem: 'extrato', data: '2026-09-20' }).erro, 'data_invalida');

  // o saldo final do extrato de 1º/9 é o ponto de partida (vale no fim daquele dia)
  lancar_({ lancamentos: [
    { uuid: 'ct-antes', data: '2026-08-30', tipo: 'receita', valor: 999, conta: 'Conta Teste', descricao: 'antes do extrato' },
    { uuid: 'ct-mesmo-dia', data: '2026-09-01', tipo: 'despesa', valor: 77, conta: 'Conta Teste', descricao: 'já está no saldo do extrato' },
    { uuid: 'ct-1', data: '2026-09-05', tipo: 'receita', valor: 500, conta: 'Conta Teste', descricao: 'pix recebido' },
    { uuid: 'ct-2', data: '2026-09-10', tipo: 'despesa', valor: 200, conta: 'Conta Teste', categoria: 'Compras', descricao: 'mercado' },
    { uuid: 'ct-3', data: '2026-09-11', tipo: 'guardar', valor: 100, conta: 'Conta Teste', categoria: 'Chile 2027' },
    { uuid: 'ct-cartao', data: '2026-09-12', tipo: 'despesa', valor: 300, conta: 'Itaú cartão', descricao: 'no crédito' }
  ] });
  let a = acertarConta_({ conta: 'Conta Teste', saldo: '1000', origem: 'extrato', data: '2026-09-01' });
  assert.ok(a.ok, JSON.stringify(a));
  assert.strictEqual(a.acertado.diferenca, null, 'primeira conferência não tem diferença');

  // a conta feita à mão: fim de cada dia, rendimento líquido de IR nos dias úteis
  let saldo = 1000, rendeu = 0;
  const movs = { '2026-09-05': 500, '2026-09-10': -200, '2026-09-11': -100 };
  for (let d = new DataReal(Date.UTC(2026, 8, 1, 12)); d < new DataReal(Date.UTC(2026, 8, 16, 12)); d = new DataReal(d.getTime() + 86400000)) {
    const iso = d.toISOString().slice(0, 10);
    saldo += movs[iso] || 0;
    if (uteis.includes(iso)) { const y = saldo * TAXA / 100 * (1 - 0.225); saldo += y; rendeu += y; }
  }
  const ct = a.contas.find((c) => c.nome === 'Conta Teste');
  assert.ok(Math.abs(ct.saldo - saldo) < 0.011, `saldo ${ct.saldo} ≈ ${saldo}`);
  assert.ok(Math.abs(ct.rendeu - rendeu) < 0.011, `rendeu ${ct.rendeu} ≈ ${rendeu}`);
  assert.strictEqual(ct.entrou, 500); assert.strictEqual(ct.saiu, 300);
  assert.deepStrictEqual(ct.conferido, { data: '2026-09-01', saldo: 1000, origem: 'extrato' });
  assert.ok(ct.rende_por_mes > 0 && ct.rende_por_mes < 20);

  // virou renda de setembro: uma linha só, atualizada, sem duplicar
  const rend = () => linhas().filter((r) => r[col.origem] === 'rendimento_conta');
  assert.strictEqual(rend().length, 1, 'uma linha de rendimento');
  const lr = rend()[0];
  assert.strictEqual(lr[col.uuid], 'rend-conta-teste-2026-09');
  assert.strictEqual(lr[col.tipo], 'receita'); assert.strictEqual(lr[col.categoria], 'Rendimento');
  assert.strictEqual(lr[col.pessoa], 'Mayara'); assert.strictEqual(lr[col.data], '2026-09-16');
  assert.ok(Math.abs(lr[col.valor] - rendeu) < 0.011);
  assert.strictEqual(atualizarRendimentosContas_(false).mudou, 0, 'uma vez por dia');
  assert.strictEqual(atualizarRendimentosContas_(true).mudou, 0, 'nada mudou, nada reescrito');
  assert.strictEqual(rend().length, 1);
  assert.ok(Math.abs(contasSaldo_().contas.find((c) => c.nome === 'Conta Teste').saldo - saldo) < 0.011, 'a linha de rendimento não conta duas vezes no saldo');
  const p = painel_({ mes: '2026-09' });
  const semRend = linhas().filter((r) => r[col.status] === 'ok' && r[col.tipo] === 'receita' && String(r[col.data]).slice(0, 7) === '2026-09' && r[col.origem] !== 'rendimento_conta')
    .reduce((t, r) => t + r[col.valor], 0);
  assert.ok(Math.abs(p.receitas - (semRend + lr[col.valor])) < 0.011, 'o rendimento entra como renda do mês');

  // acerto manual: o app achava X, o banco diz 1250 — a diferença aparece e o cálculo recomeça
  const antes = contasSaldo_().contas.find((c) => c.nome === 'Conta Teste').saldo;
  a = acertarConta_({ conta: 'Conta Teste', saldo: 1250 });
  assert.ok(Math.abs(a.acertado.diferenca - (1250 - antes)) < 0.011);
  let c2 = a.contas.find((c) => c.nome === 'Conta Teste');
  assert.strictEqual(c2.saldo, 1250); assert.strictEqual(c2.rendeu, 0, 'hoje ainda não rendeu');
  assert.ok(Math.abs(c2.rendeu_mes - rendeu) < 0.011, 'o que rendeu no mês continua');
  assert.strictEqual(c2.acertos[0].origem, 'manual');
  assert.ok(Math.abs(c2.acertos[0].diferenca - (1250 - antes)) < 0.011);
  assert.strictEqual(c2.rendimentos[0].mes, '2026-09');

  // lançado depois do acerto, no mesmo dia: mexe no saldo; fatura paga pela conta também
  lancar_({ lancamentos: [{ uuid: 'ct-4', data: '2026-09-16', tipo: 'despesa', valor: 50, conta: 'Conta Teste', descricao: 'lanche' }] });
  pagarFatura_({ cartao: 'Itaú cartão', mes: '2026-09', valor: 30, conta: 'Conta Teste', data: '2026-09-16' });
  c2 = contasSaldo_().contas.find((c) => c.nome === 'Conta Teste');
  assert.strictEqual(c2.saldo, 1170); assert.strictEqual(c2.saiu, 80);

  // para a IA
  assert.ok(contasResumo_().some((c) => c.conta === 'Conta Teste' && c.saldo === 1170 && c.rende === '100% do CDI'));

  // deixou de render: a renda do mês volta a zero (a linha fica, para o histórico)
  salvarCadastro_({ tipo: 'contas', item: { nome: 'Conta Teste', rende_tipo: '' } });
  atualizarRendimentosContas_(false);
  assert.strictEqual(rend()[0][col.valor], 0);
  assert.strictEqual(contasSaldo_().contas.find((c) => c.nome === 'Conta Teste').rende.tipo, '');
}
console.log('\ndinheiro nas contas: ok');

// 35. fogueira da casa, marcos das conquistas novas e relatório do ano
{
  let k = 0;
  const L = (data, reg, pessoa = 'Fernando', extra = {}) => {
    const r = new Array(ABAS.lancamentos.length).fill('');
    r[col.uuid] = 'fg' + (++k); r[col.data] = data; r[col.hora_registro] = new Date(reg + 'T10:00:00');
    r[col.tipo] = extra.tipo || 'despesa'; r[col.valor] = extra.valor || 10; r[col.pessoa] = pessoa;
    r[col.status] = extra.status || 'ok'; r[col.origem] = extra.origem || 'voz';
    return r;
  };
  const dia = (d) => '2026-09-' + String(d).padStart(2, '0');
  const base = [];
  for (let d = 10; d <= 15; d++) base.push(L(dia(d), dia(d), d % 2 ? 'Mayara' : 'Fernando'));
  base.push(L(dia(9), dia(11)));                               // lançado 2 dias depois: acende o dia 9
  base.push(L(dia(8), dia(11)));                               // 3 dias depois: não acende o dia 8
  base.push(L(dia(8), dia(8), 'Fernando', { status: 'excluido' }));   // apagado não conta
  base.push(L(dia(8), dia(8), 'Fernando', { tipo: 'receita', origem: 'rendimento_conta' }));   // automático não conta
  base.push(L('2026-12-01', dia(8)));                          // parcela futura lançada no dia 8: acende o 8? sim, pelo registro
  for (let d = 1; d <= 20; d++) base.push(L('2026-08-' + String(d).padStart(2, '0'), '2026-08-' + String(d).padStart(2, '0')));
  const comHoje = base.concat([L(dia(16), dia(16), 'Mayara')]);

  let f = fogueira_(comHoje, col);
  assert.strictEqual(f.hoje, '2026-09-16');
  assert.strictEqual(f.aceso_hoje, true);
  assert.deepStrictEqual(f.quem_hoje, ['Mayara']);
  assert.strictEqual(f.dias, 9, 'do dia 8 (registro) ao 16: ' + f.dias);
  assert.strictEqual(f.recorde, 20); assert.strictEqual(f.recorde_fim, '2026-08-20');
  assert.ok(f.acesos.includes('2026-09-09') && f.acesos.includes('2026-09-08'));

  // sem a parcela registrada no dia 8, o dia 8 fica apagado
  const semOito = base.filter((r) => !(r[col.data] === '2026-12-01')).concat([L(dia(16), dia(16), 'Mayara')]);
  f = fogueira_(semOito, col);
  assert.strictEqual(f.dias, 8, 'do 9 ao 16');
  assert.ok(!f.acesos.includes('2026-09-08'), 'excluído, automático e atraso de 3 dias não acendem');

  // hoje sem nada: a sequência conta até ontem e o fogo de hoje ainda não apagou
  f = fogueira_(semOito.slice(0, -1), col);
  assert.strictEqual(f.aceso_hoje, false); assert.strictEqual(f.dias, 7);

  // "hoje não gastei nada" acende o dia
  delete props.NAO_GASTEI;
  const r1 = naoGastei_({ pessoa: 'Fernando' });
  assert.ok(r1.ok && r1.fogueira.aceso_hoje);
  naoGastei_({ pessoa: 'Fernando' }); naoGastei_({ pessoa: 'Mayara' });
  assert.deepStrictEqual(JSON.parse(props.NAO_GASTEI), { '2026-09-16': ['Fernando', 'Mayara'] }, 'sem repetir');
  f = fogueira_(semOito.slice(0, -1), col);
  assert.strictEqual(f.aceso_hoje, true); assert.strictEqual(f.dias, 8); assert.deepStrictEqual(f.nao_gastei, ['2026-09-16']);
  delete props.NAO_GASTEI;

  // marcos: baú cheio (só com cadastro) e o que rendeu (baús + contas)
  const m = marcosDasConquistas_({ baus: [{ nome: 'A', meta: 100, saldo: 120, rende: { rendeu_total: 30.5 } }, { nome: 'B', sem_cadastro: true, meta: 0, saldo: 5, rende: {} }] },
    [L(dia(5), dia(5), 'Fernando', { tipo: 'receita', origem: 'rendimento_conta', valor: 80 })], col);
  assert.deepStrictEqual(m, { bau_cheio: true, rendeu_total: 110.5 });
  assert.strictEqual(marcosDasConquistas_({ baus: [{ meta: 100, saldo: 99.99, rende: {} }] }, [], col).bau_cheio, false);
  const p = painel_({ mes: '2026-09' });
  assert.ok(p.fogueira && typeof p.fogueira.dias === 'number' && p.marcos && 'bau_cheio' in p.marcos, 'o painel traz fogueira e marcos');
  assert.ok(p.fixas.every((x) => 'data_lancado' in x), 'as fixas dizem quando foram pagas');

  // conquistas novas são aceitas
  const c = conquistar_({ ids: ['fogo_aceso', 'cacador_pontual', 'inventada'] });
  assert.deepStrictEqual(c.novas, ['fogo_aceso', 'cacador_pontual']);

  // relatório do ano: só até o mês de hoje, sem fatura, com baús e rendimento
  const ra = relatorioAno_({ ano: '2026' });
  assert.ok(ra.ok); assert.strictEqual(ra.meses.length, 12); assert.strictEqual(ra.ate_agora, true);
  assert.ok(ra.meses.filter((x) => x.futuro).every((x) => x.receitas === 0 && x.despesas === 0), 'mês futuro fica de fora');
  const somar = (cond) => Math.round(linhas().filter((r) => r[col.status] === 'ok' && String(r[col.data]).slice(0, 4) === '2026' && String(r[col.data]).slice(0, 7) <= '2026-09' && cond(r))
    .reduce((t, r) => t + Number(r[col.valor]), 0) * 100) / 100;
  assert.ok(Math.abs(ra.entrou - somar((r) => r[col.tipo] === 'receita')) < 0.011, 'entrou ' + ra.entrou);
  assert.ok(Math.abs(ra.saiu - somar((r) => r[col.tipo] === 'despesa')) < 0.011, 'saiu ' + ra.saiu);
  assert.ok(Math.abs(ra.sobrou - (ra.entrou - ra.saiu)) < 0.011);
  assert.ok(ra.categorias.length > 0 && ra.categorias[0].total >= ra.categorias[ra.categorias.length - 1].total);
  assert.ok(ra.no_azul <= ra.meses_com_movimento);
  assert.ok(ra.chefes.derrotados <= ra.chefes.total);
  assert.ok(ra.conquistas.some((x) => x.id === 'fogo_aceso'), 'conquistas ganhas no ano');
  assert.ok(ra.rendeu >= ra.rendeu_contas);
  assert.strictEqual(relatorioAno_({ ano: '2027' }).erro, 'ano_futuro');
  assert.strictEqual(relatorioAno_({ ano: '2025' }).entrou, 0);
}
console.log('\nfogueira, marcos e relatório do ano: ok');
