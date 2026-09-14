/**
 * Finanças — Quanto Posso Gastar
 * Backend em Google Apps Script. Este script é o servidor do app:
 * ele grava na planilha, guarda as chaves e conversa com a API da Claude.
 *
 * Antes de publicar, rode a função `configurar()` uma vez (menu Executar).
 */

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

var VERSAO = '1.0.0';

var PROP = PropertiesService.getScriptProperties();

var MODELO_INTERPRETAR = 'claude-haiku-4-5-20251001';
var MODELO_ANALISAR = 'claude-sonnet-5';

var ABAS = {
  lancamentos: [
    'uuid', 'data', 'hora_registro', 'tipo', 'valor', 'categoria', 'descricao',
    'conta', 'metodo', 'parcela_atual', 'parcelas_total', 'texto_falado',
    'origem', 'confianca', 'status', 'revisar', 'erro'
  ],
  contas: ['nome', 'tipo', 'saldo_inicial', 'ativo'],
  categorias: ['categoria', 'grupo', 'tipo', 'palavras_chave', 'orcamento_mes'],
  recorrentes: ['nome', 'tipo', 'valor', 'dia', 'inicio', 'fim', 'parcelas_restantes', 'categoria', 'ativo'],
  resumo_mensal: ['mes', 'categoria', 'tipo', 'total', 'lancamentos'],
  memoria: ['fato', 'origem', 'data', 'ativo'],
  conversas: ['data', 'pergunta', 'resposta', 'modelo', 'custo_estimado']
};

// Status possíveis de um lançamento na planilha.
var STATUS = {
  OK: 'ok',                       // interpretado e confirmado
  AGUARDANDO_IA: 'aguardando_ia', // texto salvo, esperando a IA conseguir interpretar
  ERRO: 'erro'                    // a IA falhou de um jeito que precisa de você
};

// ---------------------------------------------------------------------------
// Instalação — rode uma vez
// ---------------------------------------------------------------------------

/**
 * Cria as abas, preenche categorias padrão, gera o token do app
 * e instala o gatilho que reprocessa lançamentos pendentes.
 */
function configurar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(ABAS).forEach(function (nome) {
    var aba = ss.getSheetByName(nome);
    if (!aba) aba = ss.insertSheet(nome);
    var cabecalho = ABAS[nome];
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho])
       .setFontWeight('bold').setBackground('#e8efed');
    aba.setFrozenRows(1);
  });

  var padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && ss.getSheets().length > 1) ss.deleteSheet(padrao);

  semearCategorias_();
  semearContas_();

  var token = PROP.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    PROP.setProperty('TOKEN', token);
  }

  // Gatilho horário que tenta interpretar de novo o que ficou pendente.
  var jaTem = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'reprocessarPendentes';
  });
  if (!jaTem) {
    ScriptApp.newTrigger('reprocessarPendentes').timeBased().everyHours(1).create();
  }

  Logger.log('Pronto.\n\nSeu TOKEN do app é:\n\n    ' + token +
             '\n\nGuarde: você vai colar isso nos Ajustes do app.');
  return token;
}

/** Mostra o token de novo, caso você tenha perdido. */
function verToken() {
  var t = PROP.getProperty('TOKEN');
  Logger.log(t ? ('TOKEN: ' + t) : 'Ainda não configurado — rode configurar() primeiro.');
  return t;
}

/** Cole aqui sua chave da Anthropic e rode esta função uma vez. */
function salvarChaveAnthropic() {
  var chave = 'COLE_SUA_CHAVE_AQUI'; // começa com sk-ant-
  if (chave.indexOf('sk-ant-') !== 0) {
    throw new Error('Cole a chave da Anthropic na variável acima antes de rodar. Ela começa com sk-ant-');
  }
  PROP.setProperty('ANTHROPIC_KEY', chave.trim());
  Logger.log('Chave salva. Pode apagar a chave da linha acima e salvar o arquivo.');
}

function semearCategorias_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('categorias');
  if (aba.getLastRow() > 1) return; // já tem conteúdo, não mexe

  var linhas = [
    ['Mercado', 'Essencial', 'despesa', 'mercado,supermercado,feira,hortifruti,açougue,padaria,compras do mes,atacadao,assai,carrefour', ''],
    ['Alimentação', 'Essencial', 'despesa', 'almoço,almocei,janta,jantar,lanche,ifood,rappi,restaurante,pizza,hamburguer,cafe,padoca,marmita', ''],
    ['Transporte', 'Essencial', 'despesa', 'uber,99,taxi,onibus,metro,passagem,gasolina,posto,combustivel,alcool,etanol,estacionamento,pedagio,ipva', ''],
    ['Moradia', 'Essencial', 'despesa', 'aluguel,condominio,luz,energia,agua,gas,iptu,internet,wifi,faxina', ''],
    ['Saúde', 'Essencial', 'despesa', 'farmacia,remedio,medico,consulta,exame,dentista,plano de saude,oculos,academia', ''],
    ['Telefone', 'Essencial', 'despesa', 'celular,recarga,plano,vivo,claro,tim,oi', ''],
    ['Assinaturas', 'Fixo', 'despesa', 'netflix,spotify,youtube premium,disney,prime,hbo,max,assinatura,mensalidade,icloud,google one', ''],
    ['Educação', 'Fixo', 'despesa', 'faculdade,curso,livro,apostila,material escolar,udemy,alura', ''],
    ['Lazer', 'Variável', 'despesa', 'cinema,bar,cerveja,balada,show,jogo,steam,viagem,passeio,role', ''],
    ['Compras', 'Variável', 'despesa', 'roupa,tenis,camisa,calca,eletronico,celular novo,fone,shopping,shopee,mercado livre,amazon', ''],
    ['Casa', 'Variável', 'despesa', 'movel,decoracao,utensilio,ferramenta,reforma,conserto', ''],
    ['Pet', 'Variável', 'despesa', 'racao,veterinario,petshop,pet', ''],
    ['Presentes', 'Variável', 'despesa', 'presente,aniversario,natal', ''],
    ['Taxas', 'Fixo', 'despesa', 'tarifa,juros,multa,anuidade,imposto', ''],
    ['Outros', 'Variável', 'despesa', '', ''],
    ['Salário', 'Renda', 'receita', 'salario,salário,pagamento,holerite,contracheque', ''],
    ['Freela', 'Renda', 'receita', 'freela,freelance,bico,servico,job', ''],
    ['Reembolso', 'Renda', 'receita', 'reembolso,devolucao,estorno,me pagou,pagou de volta', ''],
    ['Rendimento', 'Renda', 'receita', 'rendimento,juros recebidos,dividendo,investimento rendeu,cdb,tesouro', ''],
    ['Outras Entradas', 'Renda', 'receita', 'entrou,recebi,ganhei,vendi,presente recebido', '']
  ];
  aba.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
}

function semearContas_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('contas');
  if (aba.getLastRow() > 1) return;
  aba.getRange(2, 1, 3, 4).setValues([
    ['Principal', 'conta corrente', 0, 'sim'],
    ['Carteira', 'dinheiro', 0, 'sim'],
    ['Cartão', 'credito', 0, 'sim']
  ]);
}

// ---------------------------------------------------------------------------
// Entrada HTTP
// ---------------------------------------------------------------------------

function doGet(e) {
  return json_({ ok: true, versao: VERSAO, mensagem: 'Use POST.' });
}

function doPost(e) {
  var pedido;
  try {
    pedido = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, erro: 'json_invalido' });
  }

  if (pedido.token !== PROP.getProperty('TOKEN')) {
    return json_({ ok: false, erro: 'token_invalido' });
  }

  try {
    switch (pedido.acao) {
      case 'ping':        return json_({ ok: true, versao: VERSAO, ia: !!PROP.getProperty('ANTHROPIC_KEY') });
      case 'lancar':      return json_(lancar_(pedido));
      case 'interpretar': return json_(interpretar_(pedido));
      case 'capturar':    return json_(capturar_(pedido));
      case 'resumo':      return json_(resumo_(pedido));
      case 'pendencias':  return json_(pendencias_());
      case 'categorias':  return json_({ ok: true, categorias: lerCategorias_(), contas: lerContas_() });
      default:            return json_({ ok: false, erro: 'acao_desconhecida' });
    }
  } catch (err) {
    return json_({ ok: false, erro: 'falha_servidor', detalhe: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Gravar lançamentos
// ---------------------------------------------------------------------------

/**
 * Grava uma ou mais linhas. Ignora qualquer uuid que já esteja na planilha —
 * é isso que torna seguro o app tentar enviar de novo depois de uma falha.
 */
function lancar_(pedido) {
  var lista = pedido.lancamentos || [];
  if (!lista.length) return { ok: true, gravados: 0, duplicados: [] };

  var trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
    var existentes = uuidsExistentes_(aba);

    var novas = [], gravados = [], duplicados = [];
    lista.forEach(function (l) {
      if (!l.uuid) { l.uuid = Utilities.getUuid(); }
      if (existentes[l.uuid]) { duplicados.push(l.uuid); return; }
      existentes[l.uuid] = true;
      novas.push(linhaDe_(l));
      gravados.push(l.uuid);
    });

    if (novas.length) {
      aba.getRange(aba.getLastRow() + 1, 1, novas.length, ABAS.lancamentos.length).setValues(novas);
      atualizarResumo_();
    }
    return { ok: true, gravados: gravados, duplicados: duplicados };
  } finally {
    trava.releaseLock();
  }
}

function linhaDe_(l) {
  return [
    l.uuid,
    l.data || hojeISO_(),
    new Date(),
    l.tipo || 'despesa',
    Number(l.valor) || 0,
    l.categoria || '',
    l.descricao || '',
    l.conta || 'Principal',
    l.metodo || '',
    l.parcela_atual || '',
    l.parcelas_total || '',
    l.texto_falado || '',
    l.origem || 'voz',
    l.confianca || '',
    l.status || STATUS.OK,
    l.revisar ? 'sim' : '',
    l.erro || ''
  ];
}

function uuidsExistentes_(aba) {
  var mapa = {};
  var n = aba.getLastRow() - 1;
  if (n <= 0) return mapa;
  aba.getRange(2, 1, n, 1).getValues().forEach(function (r) {
    if (r[0]) mapa[String(r[0])] = true;
  });
  return mapa;
}

function hojeISO_() {
  return Utilities.formatDate(new Date(), fuso_(), 'yyyy-MM-dd');
}

function fuso_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'America/Sao_Paulo';
}

// ---------------------------------------------------------------------------
// Interpretar com IA
// ---------------------------------------------------------------------------

/**
 * Só interpreta e devolve — não grava nada.
 * É o que o app chama enquanto você espera na tela, para montar o cartão de
 * confirmação. Quem garante que nada se perde é `capturar_`, chamado pela fila.
 */
function interpretar_(pedido) {
  var texto = String(pedido.texto || '').trim();
  if (!texto) return { ok: false, erro: 'texto_vazio' };

  var r = chamarClaude_(texto);
  if (r.ok) return { ok: true, lancamentos: r.lancamentos };

  avisarSePreciso_(r.codigo, r.detalhe);
  return { ok: false, erro: r.codigo, detalhe: r.detalhe };
}

/**
 * Uma chamada só resolve o item inteiro da fila: interpreta se precisar e grava.
 * É o que o app e o service worker usam, para não depender de duas idas à rede.
 *
 * Entrada: { uuid, texto, lancamento? }
 */
function capturar_(pedido) {
  var uuid = pedido.uuid || Utilities.getUuid();

  // Já veio interpretado pelas regras locais: é só gravar.
  if (pedido.lancamento) {
    var l = pedido.lancamento;
    l.uuid = uuid;
    if (!l.texto_falado) l.texto_falado = pedido.texto || '';
    l.status = STATUS.OK;
    return lancar_({ lancamentos: [l] });
  }

  var texto = String(pedido.texto || '').trim();
  if (!texto) return { ok: false, erro: 'texto_vazio' };

  var r = chamarClaude_(texto);

  if (r.ok) {
    var lista = r.lancamentos.map(function (item, i) {
      item.uuid = i === 0 ? uuid : Utilities.getUuid();
      item.texto_falado = texto;
      item.confianca = 'ia';
      item.origem = pedido.origem || 'voz';
      item.status = STATUS.OK;
      item.revisar = r.lancamentos.length > 1;
      return item;
    });
    var gravou = lancar_({ lancamentos: lista });
    return { ok: true, gravados: gravou.gravados, lancamentos: lista };
  }

  // A IA não estava disponível. O texto não se perde: vai para a planilha
  // com status aguardando_ia e o gatilho horário tenta de novo sozinho.
  lancar_({
    lancamentos: [{
      uuid: uuid,
      data: pedido.data || hojeISO_(),
      tipo: '',
      valor: 0,
      categoria: '',
      descricao: '(aguardando interpretação)',
      texto_falado: texto,
      origem: pedido.origem || 'voz',
      status: STATUS.AGUARDANDO_IA,
      revisar: true,
      erro: r.codigo
    }]
  });

  avisarSePreciso_(r.codigo, r.detalhe);
  return { ok: false, erro: r.codigo, detalhe: r.detalhe, guardado: true, uuid: uuid };
}

function chamarClaude_(texto) {
  var chave = PROP.getProperty('ANTHROPIC_KEY');
  if (!chave) return { ok: false, codigo: 'sem_chave', detalhe: 'A chave da API ainda não foi salva no script.' };

  var categorias = lerCategorias_();
  var nomes = categorias.map(function (c) { return c.categoria; }).join(', ');
  var contas = lerContas_().join(', ');

  var instrucao =
    'Você converte frases faladas em português do Brasil sobre dinheiro em lançamentos financeiros.\n' +
    'Hoje é ' + hojeISO_() + ' (fuso ' + fuso_() + ').\n' +
    'Categorias permitidas: ' + nomes + '.\n' +
    'Contas permitidas: ' + contas + '.\n\n' +
    'Responda SOMENTE com um array JSON, sem texto em volta, sem markdown. Cada item:\n' +
    '{"tipo":"despesa|receita","valor":number,"categoria":string,"descricao":string,' +
    '"data":"YYYY-MM-DD","conta":string,"metodo":"pix|credito|debito|dinheiro|boleto|",' +
    '"parcela_atual":number|null,"parcelas_total":number|null}\n\n' +
    'Regras:\n' +
    '- Uma frase pode conter mais de um lançamento; devolva um item por lançamento.\n' +
    '- Em parcelamento, "valor" é o valor TOTAL da compra e parcelas_total o número de parcelas.\n' +
    '- Se a categoria não se encaixar em nenhuma da lista, use "Outros" (despesa) ou "Outras Entradas" (receita).\n' +
    '- Datas relativas ("ontem", "sexta passada") devem virar data absoluta.\n' +
    '- Se não houver valor em dinheiro identificável, devolva [].';

  var corpo = {
    model: MODELO_INTERPRETAR,
    max_tokens: 1024,
    system: instrucao,
    messages: [{ role: 'user', content: texto }]
  };

  var resposta;
  try {
    resposta = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(corpo),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { ok: false, codigo: 'sem_rede', detalhe: String(err && err.message || err) };
  }

  var status = resposta.getResponseCode();
  var texto_resposta = resposta.getContentText();

  if (status !== 200) {
    return classificarErro_(status, texto_resposta);
  }

  try {
    var dados = JSON.parse(texto_resposta);
    var saida = (dados.content || []).map(function (b) { return b.text || ''; }).join('').trim();
    saida = saida.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var lista = JSON.parse(saida);
    if (!Array.isArray(lista)) lista = [lista];
    if (!lista.length) return { ok: false, codigo: 'nada_entendido', detalhe: 'A IA não achou valor na frase.' };
    return { ok: true, lancamentos: lista };
  } catch (err) {
    return { ok: false, codigo: 'resposta_estranha', detalhe: String(err && err.message || err) };
  }
}

/** Traduz o erro da API para um motivo que dá pra mostrar na tela. */
function classificarErro_(status, corpo) {
  var msg = '';
  try { msg = (JSON.parse(corpo).error || {}).message || ''; } catch (e) { msg = corpo || ''; }
  var m = msg.toLowerCase();

  if (status === 400 && (m.indexOf('credit balance') >= 0 || m.indexOf('purchase credits') >= 0)) {
    return { ok: false, codigo: 'sem_creditos', detalhe: 'O saldo de créditos da API acabou.' };
  }
  if (status === 401 || status === 403) {
    return { ok: false, codigo: 'chave_invalida', detalhe: 'A chave da API foi recusada.' };
  }
  if (status === 429) {
    return { ok: false, codigo: 'limite_taxa', detalhe: 'Muitas chamadas seguidas. Tenta de novo daqui a pouco.' };
  }
  if (status >= 500) {
    return { ok: false, codigo: 'api_fora', detalhe: 'A API está instável agora.' };
  }
  return { ok: false, codigo: 'erro_api_' + status, detalhe: msg.slice(0, 300) };
}

// ---------------------------------------------------------------------------
// Reprocessar o que ficou pendente (gatilho horário)
// ---------------------------------------------------------------------------

/**
 * Varre a planilha atrás de lançamentos com status aguardando_ia e tenta
 * interpretar de novo. Quando dá certo, preenche a linha no lugar.
 */
function reprocessarPendentes() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return;

  var col = indiceColunas_();
  var dados = aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues();
  var resolvidos = 0, ultimoErro = null;

  for (var i = 0; i < dados.length; i++) {
    if (dados[i][col.status] !== STATUS.AGUARDANDO_IA) continue;

    var texto = String(dados[i][col.texto_falado] || '').trim();
    if (!texto) continue;

    var r = chamarClaude_(texto);

    if (!r.ok) {
      ultimoErro = r;
      // Erro que depende de você: para de tentar agora e avisa.
      if (r.codigo === 'sem_creditos' || r.codigo === 'chave_invalida' || r.codigo === 'sem_chave') break;
      // Erro passageiro: tenta o próximo, esse volta na próxima rodada.
      if (r.codigo === 'nada_entendido' || r.codigo === 'resposta_estranha') {
        aba.getRange(i + 2, col.status + 1).setValue(STATUS.ERRO);
        aba.getRange(i + 2, col.erro + 1).setValue(r.codigo);
      }
      continue;
    }

    var l = r.lancamentos[0];
    var linha = aba.getRange(i + 2, 1, 1, ABAS.lancamentos.length);
    var v = dados[i].slice();
    v[col.tipo] = l.tipo || 'despesa';
    v[col.valor] = Number(l.valor) || 0;
    v[col.categoria] = l.categoria || 'Outros';
    v[col.descricao] = l.descricao || '';
    v[col.data] = l.data || v[col.data];
    v[col.conta] = l.conta || 'Principal';
    v[col.metodo] = l.metodo || '';
    v[col.parcela_atual] = l.parcela_atual || '';
    v[col.parcelas_total] = l.parcelas_total || '';
    v[col.confianca] = 'ia';
    v[col.status] = STATUS.OK;
    v[col.revisar] = 'sim';
    v[col.erro] = '';
    linha.setValues([v]);
    resolvidos++;

    // Lançamentos extras da mesma frase entram como linhas novas.
    for (var k = 1; k < r.lancamentos.length; k++) {
      var extra = r.lancamentos[k];
      extra.uuid = Utilities.getUuid();
      extra.texto_falado = texto;
      extra.confianca = 'ia';
      extra.revisar = true;
      lancar_({ lancamentos: [extra] });
    }
  }

  if (resolvidos) atualizarResumo_();
  if (ultimoErro) avisarSePreciso_(ultimoErro.codigo, ultimoErro.detalhe);
}

function indiceColunas_() {
  var idx = {};
  ABAS.lancamentos.forEach(function (nome, i) { idx[nome] = i; });
  return idx;
}

// ---------------------------------------------------------------------------
// Avisos por e-mail
// ---------------------------------------------------------------------------

var AVISOS = {
  sem_creditos:  'Os créditos da API da Claude acabaram. O app continua registrando tudo normalmente — as frases que precisam de IA ficam guardadas e são interpretadas sozinhas assim que você recarregar em console.anthropic.com.',
  chave_invalida:'A chave da API da Claude foi recusada. Confira o valor de ANTHROPIC_KEY nas propriedades do script.',
  sem_chave:     'A chave da API da Claude ainda não foi salva no script. As frases que precisam de IA estão guardadas esperando.'
};

/** Manda no máximo um e-mail por motivo por dia, para não virar spam. */
function avisarSePreciso_(codigo, detalhe) {
  if (!AVISOS[codigo]) return;

  var hoje = hojeISO_();
  var chave = 'aviso_' + codigo;
  if (PROP.getProperty(chave) === hoje) return;
  PROP.setProperty(chave, hoje);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pend = pendencias_();

  try {
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: 'Quanto Posso Gastar — ' + codigo.replace(/_/g, ' '),
      body: AVISOS[codigo] + '\n\n' +
            (detalhe ? 'Detalhe técnico: ' + detalhe + '\n\n' : '') +
            'Lançamentos esperando interpretação: ' + pend.aguardando_ia + '\n\n' +
            'Planilha: ' + ss.getUrl()
    });
  } catch (err) {
    Logger.log('Não consegui enviar o aviso: ' + err);
  }
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

function pendencias_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  var conta = { ok: true, aguardando_ia: 0, erro: 0, revisar: 0, motivo: '' };
  if (n <= 0) return conta;

  var col = indiceColunas_();
  aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues().forEach(function (r) {
    if (r[col.status] === STATUS.AGUARDANDO_IA) {
      conta.aguardando_ia++;
      if (!conta.motivo) conta.motivo = String(r[col.erro] || '');
    }
    if (r[col.status] === STATUS.ERRO) conta.erro++;
    if (r[col.revisar] === 'sim') conta.revisar++;
  });
  return conta;
}

function resumo_(pedido) {
  var mes = pedido.mes || Utilities.formatDate(new Date(), fuso_(), 'yyyy-MM');
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  var saida = { ok: true, mes: mes, receitas: 0, despesas: 0, saldo: 0, por_categoria: [], ultimos: [] };
  if (n <= 0) return saida;

  var col = indiceColunas_();
  var linhas = aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues();
  var porCat = {};

  linhas.forEach(function (r) {
    if (r[col.status] !== STATUS.OK) return;
    var data = normalizarData_(r[col.data]);
    if (data.indexOf(mes) !== 0) return;
    var valor = Number(r[col.valor]) || 0;
    if (r[col.tipo] === 'receita') saida.receitas += valor;
    else {
      saida.despesas += valor;
      var c = r[col.categoria] || 'Outros';
      porCat[c] = (porCat[c] || 0) + valor;
    }
  });

  saida.saldo = saida.receitas - saida.despesas;
  saida.por_categoria = Object.keys(porCat)
    .map(function (c) { return { categoria: c, total: porCat[c] }; })
    .sort(function (a, b) { return b.total - a.total; });

  saida.ultimos = linhas.slice(-12).reverse().map(function (r) {
    return {
      uuid: r[col.uuid], data: normalizarData_(r[col.data]), tipo: r[col.tipo],
      valor: Number(r[col.valor]) || 0, categoria: r[col.categoria],
      descricao: r[col.descricao], status: r[col.status]
    };
  });

  return saida;
}

function normalizarData_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, fuso_(), 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

function lerCategorias_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('categorias');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return [];
  return aba.getRange(2, 1, n, 5).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return {
        categoria: r[0], grupo: r[1], tipo: r[2],
        palavras: String(r[3] || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean),
        orcamento: Number(r[4]) || 0
      };
    });
}

function lerContas_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('contas');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return ['Principal'];
  return aba.getRange(2, 1, n, 4).getValues()
    .filter(function (r) { return r[0] && r[3] !== 'não'; })
    .map(function (r) { return r[0]; });
}

/** Recalcula a aba resumo_mensal a partir dos lançamentos. */
function atualizarResumo_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var origem = ss.getSheetByName('lancamentos');
  var destino = ss.getSheetByName('resumo_mensal');
  var n = origem.getLastRow() - 1;

  destino.getRange(2, 1, Math.max(destino.getLastRow() - 1, 1), ABAS.resumo_mensal.length).clearContent();
  if (n <= 0) return;

  var col = indiceColunas_();
  var mapa = {};
  origem.getRange(2, 1, n, ABAS.lancamentos.length).getValues().forEach(function (r) {
    if (r[col.status] !== STATUS.OK) return;
    var mes = normalizarData_(r[col.data]).slice(0, 7);
    var cat = r[col.categoria] || 'Outros';
    var tipo = r[col.tipo] || 'despesa';
    var k = mes + '|' + cat + '|' + tipo;
    if (!mapa[k]) mapa[k] = { mes: mes, categoria: cat, tipo: tipo, total: 0, n: 0 };
    mapa[k].total += Number(r[col.valor]) || 0;
    mapa[k].n++;
  });

  var linhas = Object.keys(mapa).sort().map(function (k) {
    var v = mapa[k];
    return [v.mes, v.categoria, v.tipo, v.total, v.n];
  });
  if (linhas.length) {
    destino.getRange(2, 1, linhas.length, ABAS.resumo_mensal.length).setValues(linhas);
  }
}
