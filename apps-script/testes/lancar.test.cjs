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
