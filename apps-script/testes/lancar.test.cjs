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
