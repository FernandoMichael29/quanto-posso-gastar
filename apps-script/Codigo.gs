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

var VERSAO = '1.2.0';

var PROP = PropertiesService.getScriptProperties();

var MODELO_INTERPRETAR = 'claude-haiku-4-5-20251001';
var MODELO_ANALISAR = 'claude-sonnet-5';

// --- Limites de segurança -------------------------------------------------
// O endereço do app da Web é público: qualquer um que o descubra pode bater
// nele. O token barra quem não o tem; estes limites contêm o estrago de quem
// tiver (token vazado, um print de tela, um bug no app).

var MAX_CORPO_BYTES = 100000;  // um lançamento cabe em ~1 KB; acima disso é abuso
var MAX_REQ_MINUTO = 60;       // requisições autenticadas por minuto
var MAX_IA_DIA = 200;          // interpretações de frase por dia (teto de gasto)
var MAX_ANALISE_DIA = 30;      // perguntas de análise por dia — cada uma custa ~20x uma interpretação

var ABAS = {
  lancamentos: [
    'uuid', 'data', 'hora_registro', 'tipo', 'valor', 'categoria', 'descricao',
    'conta', 'metodo', 'fonte', 'pessoa', 'parcela_atual', 'parcelas_total',
    'texto_falado', 'origem', 'confianca', 'status', 'revisar', 'erro'
  ],
  // As carteiras de onde o dinheiro sai: bancos, cartões, benefícios, espécie.
  contas: ['nome', 'tipo', 'pessoa', 'saldo_inicial', 'ativo'],
  // De onde a renda vem. Só se aplica a receitas.
  fontes: ['nome', 'pessoa', 'tipo', 'ativo'],
  pessoas: ['nome', 'ativo'],
  categorias: ['categoria', 'grupo', 'tipo', 'palavras_chave', 'orcamento_mes', 'ativo'],
  // Uma linha por VIGÊNCIA, não por conta. "Meu aluguel é 1800" cria uma linha
  // válida de agora em diante; "agora é 1900" fecha essa e abre outra. O
  // histórico fica inteiro, então o mês passado continua contando 1800.
  // escopo 'excecao' vale só no mês de vigencia_inicio e ganha da vigência normal.
  recorrentes: [
    'nome', 'tipo', 'categoria', 'valor', 'dia',
    'vigencia_inicio', 'vigencia_fim', 'escopo',
    'parcelas_total', 'parcelas_restantes', 'texto_falado', 'criado_em'
  ],
  resumo_mensal: ['mes', 'categoria', 'tipo', 'total', 'lancamentos'],
  memoria: ['fato', 'origem', 'data', 'ativo'],
  conversas: ['data', 'pergunta', 'resposta', 'modelo', 'custo_estimado']
};

// Status possíveis de um lançamento na planilha.
var STATUS = {
  OK: 'ok',                       // interpretado e confirmado
  AGUARDANDO_IA: 'aguardando_ia', // texto salvo, esperando a IA conseguir interpretar
  ERRO: 'erro',                   // a IA falhou de um jeito que precisa de você
  EXCLUIDO: 'excluido'            // você apagou pelo app: sai de tudo, mas a linha fica
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

  migrarRecorrentes_(ss);

  Object.keys(ABAS).forEach(function (nome) { prepararAba_(ss, nome); });

  var padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && ss.getSheets().length > 1) ss.deleteSheet(padrao);

  semearCategorias_();
  semearContas_();
  semearPessoas_();
  semearFontes_();

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

/**
 * Cria a aba se não existir e ajusta o cabeçalho ao formato atual.
 *
 * Quando colunas novas entram no meio (como `fonte` e `pessoa` entraram em
 * lancamentos), reescrever só a primeira linha desalinharia tudo que já está
 * lá. Então aqui os dados são remapeados COLUNA POR NOME: cada valor vai para
 * onde a coluna dele está agora, e as novas nascem vazias.
 */
function prepararAba_(ss, nome) {
  var alvo = ABAS[nome];
  var aba = ss.getSheetByName(nome);

  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.getRange(1, 1, 1, alvo.length).setValues([alvo])
       .setFontWeight('bold').setBackground('#e8efed');
    aba.setFrozenRows(1);
    return;
  }

  var largura = Math.max(aba.getLastColumn(), 1);
  var atual = aba.getRange(1, 1, 1, largura).getValues()[0]
                 .map(function (c) { return String(c || '').trim(); });

  var igual = atual.length === alvo.length && alvo.every(function (c, i) { return atual[i] === c; });
  if (igual) { aba.setFrozenRows(1); return; }

  var linhas = aba.getLastRow() - 1;
  var dados = linhas > 0 ? aba.getRange(2, 1, linhas, largura).getValues() : [];

  var deOnde = alvo.map(function (coluna) { return atual.indexOf(coluna); });
  var remapeadas = dados.map(function (linha) {
    return deOnde.map(function (i) { return i >= 0 ? linha[i] : ''; });
  });

  aba.clear();
  aba.getRange(1, 1, 1, alvo.length).setValues([alvo])
     .setFontWeight('bold').setBackground('#e8efed');
  if (remapeadas.length) {
    aba.getRange(2, 1, remapeadas.length, alvo.length).setValues(remapeadas);
  }
  aba.setFrozenRows(1);
}

/**
 * A aba `recorrentes` mudou de formato na v1.2 para guardar histórico de
 * valores. Se a sua já tiver dados no formato antigo, ela é preservada com
 * outro nome em vez de ser sobrescrita — nada seu se perde.
 */
function migrarRecorrentes_(ss) {
  var aba = ss.getSheetByName('recorrentes');
  if (!aba) return;

  var largura = aba.getLastColumn();
  if (!largura) return;

  var cabecalho = aba.getRange(1, 1, 1, largura).getValues()[0];
  if (cabecalho.indexOf('vigencia_inicio') >= 0) return; // já está no formato novo

  if (aba.getLastRow() > 1) {
    var novoNome = 'recorrentes_antiga_' + Utilities.formatDate(new Date(), fuso_(), 'yyyyMMdd_HHmm');
    aba.setName(novoNome);
    Logger.log('A aba recorrentes tinha dados no formato antigo. Preservei como "' +
               novoNome + '" e criei uma nova. Passe os dados à mão, ou apenas fale ' +
               'com o app: "meu aluguel é 1800 todo dia 10".');
  } else {
    ss.deleteSheet(aba);
  }
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
  var linhas = [
    ['Mercado', 'Essencial', 'despesa', 'mercado,supermercado,feira,hortifruti,açougue,padaria,compras do mes,atacadao,assai,carrefour', '', 'sim'],
    ['Alimentação', 'Essencial', 'despesa', 'almoço,almocei,janta,jantar,lanche,ifood,rappi,restaurante,pizza,hamburguer,cafe,padoca,marmita', '', 'sim'],
    ['Transporte', 'Essencial', 'despesa', 'uber,99,taxi,onibus,metro,passagem,gasolina,posto,combustivel,alcool,etanol,estacionamento,pedagio,ipva', '', 'sim'],
    ['Moradia', 'Essencial', 'despesa', 'aluguel,condominio,luz,energia,agua,gas,iptu,internet,wifi,faxina', '', 'sim'],
    ['Saúde', 'Essencial', 'despesa', 'farmacia,remedio,medico,consulta,exame,dentista,plano de saude,oculos,academia', '', 'sim'],
    ['Telefone', 'Essencial', 'despesa', 'celular,recarga,plano,vivo,claro,tim,oi', '', 'sim'],
    ['Assinaturas', 'Fixo', 'despesa', 'netflix,spotify,youtube premium,disney,prime,hbo,max,assinatura,mensalidade,icloud,google one', '', 'sim'],
    ['Educação', 'Fixo', 'despesa', 'faculdade,curso,livro,apostila,material escolar,udemy,alura', '', 'sim'],
    ['Lazer', 'Variável', 'despesa', 'cinema,bar,cerveja,balada,show,jogo,steam,viagem,passeio,role', '', 'sim'],
    ['Compras', 'Variável', 'despesa', 'roupa,tenis,camisa,calca,eletronico,celular novo,fone,shopping,shopee,mercado livre,amazon', '', 'sim'],
    ['Casa', 'Variável', 'despesa', 'movel,decoracao,utensilio,ferramenta,reforma,conserto', '', 'sim'],
    ['Pet', 'Variável', 'despesa', 'racao,veterinario,petshop,pet', '', 'sim'],
    ['Presentes', 'Variável', 'despesa', 'presente,aniversario,natal', '', 'sim'],
    ['Taxas', 'Fixo', 'despesa', 'tarifa,juros,multa,anuidade,imposto', '', 'sim'],
    ['Outros', 'Variável', 'despesa', '', '', 'sim'],
    ['Salário', 'Renda', 'receita', 'salario,salário,pagamento,holerite,contracheque', '', 'sim'],
    ['Freela', 'Renda', 'receita', 'freela,freelance,bico,servico,job', '', 'sim'],
    ['Reembolso', 'Renda', 'receita', 'reembolso,devolucao,estorno,me pagou,pagou de volta', '', 'sim'],
    ['Rendimento', 'Renda', 'receita', 'rendimento,juros recebidos,dividendo,investimento rendeu,cdb,tesouro', '', 'sim'],
    ['Outras Entradas', 'Renda', 'receita', 'entrou,recebi,ganhei,vendi,presente recebido', '', 'sim']
  ];
  acrescentarSeFaltar_('categorias', linhas);
}

/**
 * As contas que você me passou. São adicionadas às que já existirem — nenhuma
 * conta antiga é apagada, porque lançamentos antigos podem apontar para elas.
 * As que não usa mais, desative pelo app (Ajustes → Cadastros).
 */
function semearContas_() {
  var padrao = [
    ['Dinheiro', 'dinheiro', 'Fernando', 0, 'sim'],
    ['Itaú', 'conta corrente', 'Fernando', 0, 'sim'],
    ['Santander', 'conta corrente', 'Fernando', 0, 'sim'],
    ['Nubank May', 'credito', 'Mayara', 0, 'sim'],
    ['Caju', 'beneficio', 'Fernando', 0, 'sim'],
    ['Alimentação', 'beneficio', 'Fernando', 0, 'sim'],
    ['Amazon', 'credito', 'Fernando', 0, 'sim']
  ];
  acrescentarSeFaltar_('contas', padrao);
}

function semearPessoas_() {
  acrescentarSeFaltar_('pessoas', [['Fernando', 'sim'], ['Mayara', 'sim']]);
}

function semearFontes_() {
  acrescentarSeFaltar_('fontes', [
    ['Fernando Empresa 1', 'Fernando', 'salario', 'sim'],
    ['Fernando Empresa 2', 'Fernando', 'salario', 'sim'],
    ['Emprego Mayara', 'Mayara', 'salario', 'sim']
  ]);
}

/** Acrescenta só as linhas cujo nome ainda não está na aba. */
function acrescentarSeFaltar_(nomeAba, linhas) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nomeAba);
  if (!aba) return;

  var existentes = {};
  var n = aba.getLastRow() - 1;
  if (n > 0) {
    aba.getRange(2, 1, n, 1).getValues().forEach(function (r) {
      if (r[0]) existentes[chaveNome_(r[0])] = true;
    });
  }

  var novas = linhas.filter(function (l) { return !existentes[chaveNome_(l[0])]; });
  if (novas.length) {
    aba.getRange(aba.getLastRow() + 1, 1, novas.length, novas[0].length).setValues(novas);
  }
}

// ---------------------------------------------------------------------------
// Entrada HTTP
// ---------------------------------------------------------------------------

function doGet(e) {
  return json_({ ok: true, versao: VERSAO, mensagem: 'Use POST.' });
}

function doPost(e) {
  // Recusa o que for grande demais antes de gastar tempo lendo — um corpo
  // gigante custaria cota de execução mesmo vindo sem token.
  if (!e || !e.postData || e.postData.length > MAX_CORPO_BYTES) {
    return json_({ ok: false, erro: 'pedido_invalido' });
  }

  var pedido;
  try {
    pedido = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, erro: 'json_invalido' });
  }

  if (pedido.token !== PROP.getProperty('TOKEN')) {
    return json_({ ok: false, erro: 'token_invalido' });
  }

  // A partir daqui o pedido está autenticado. O limite por minuto existe para
  // o caso do token vazar: contém a rajada sem atrapalhar o uso normal.
  if (!dentroDoLimite_()) {
    return json_({ ok: false, erro: 'limite_taxa', detalhe: 'Muitas requisições por minuto.' });
  }

  try {
    switch (pedido.acao) {
      case 'ping':        return json_({ ok: true, versao: VERSAO, ia: !!PROP.getProperty('ANTHROPIC_KEY') });
      case 'lancar':      return json_(lancar_(pedido));
      case 'interpretar': return json_(interpretar_(pedido));
      case 'capturar':    return json_(capturar_(pedido));
      case 'resumo':      return json_(resumo_(pedido));
      case 'pendencias':  return json_(pendencias_());
      case 'perguntar':   return json_(perguntar_(pedido));
      case 'panorama':    return json_(panorama_(pedido));
      case 'categorias':  return json_(cadastros_());
      case 'cadastros':   return json_(cadastros_());
      case 'salvar_cadastro':  return json_(salvarCadastro_(pedido));
      case 'excluir_cadastro': return json_(excluirCadastro_(pedido));
      case 'lancamentos':      return json_(lancamentosDoMes_(pedido));
      case 'editar_lancamento':  return json_(editarLancamento_(pedido));
      case 'excluir_lancamento': return json_(excluirLancamento_(pedido));
      case 'painel':      return json_(painel_(pedido));
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
// Limites de uso
// ---------------------------------------------------------------------------

/** Conta requisições autenticadas numa janela de um minuto. */
function dentroDoLimite_() {
  try {
    var cache = CacheService.getScriptCache();
    var chave = 'req_' + Math.floor(Date.now() / 60000);
    var n = Number(cache.get(chave) || 0) + 1;
    cache.put(chave, String(n), 120);
    return n <= MAX_REQ_MINUTO;
  } catch (err) {
    return true; // cache indisponível não pode derrubar o app
  }
}

/**
 * Teto diário de chamadas à API da Claude. É a proteção do bolso: mesmo no
 * pior caso (token vazado), o gasto do dia tem um limite conhecido.
 */
function dentroDoTetoIA_() {
  return contarUso_('ia_', MAX_IA_DIA);
}

function dentroDoTetoAnalise_() {
  return contarUso_('analise_', MAX_ANALISE_DIA);
}

function contarUso_(prefixo, teto) {
  var chave = prefixo + hojeISO_();
  var n = Number(PROP.getProperty(chave) || 0);
  if (n >= teto) return false;
  PROP.setProperty(chave, String(n + 1));
  return true;
}

/**
 * Gera um token novo e invalida o antigo. Rode isto se desconfiar que o token
 * vazou (um print de tela, um aparelho perdido). Depois é só colar o novo nos
 * Ajustes do app, em cada aparelho que você usa.
 */
function girarToken() {
  var novo = Utilities.getUuid().replace(/-/g, '');
  PROP.setProperty('TOKEN', novo);
  Logger.log('Token trocado. O antigo não funciona mais.\n\nNovo TOKEN:\n\n    ' + novo);
  return novo;
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
    l.conta || contaPadrao_(),
    l.metodo || '',
    l.fonte || '',
    l.pessoa || pessoaDaConta_(l.conta),
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

function contaPadrao_() {
  var contas = lerContas_();
  return contas[0] || 'Dinheiro';
}

/** Se a conta pertence a alguém, o lançamento herda essa pessoa. */
function pessoaDaConta_(nomeConta) {
  if (!nomeConta) return '';
  var alvo = chaveNome_(nomeConta);
  var conta = lerCadastro_('contas').filter(function (c) {
    return chaveNome_(c.nome) === alvo;
  })[0];
  return conta ? (conta.pessoa || '') : '';
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
    var efeitos = [];

    // Regras sobre compromissos fixos: não movimentam dinheiro, mudam o que
    // vale daqui pra frente (ou só no mês citado).
    (r.recorrentes || []).forEach(function (d) {
      d.texto_falado = texto;
      try {
        efeitos.push(aplicarRecorrente_(d));
      } catch (err) {
        efeitos.push({ ok: false, nome: d.nome, erro: String(err && err.message || err) });
      }
    });

    // Mudanças de cadastro ditas por voz: nova conta, categoria, fonte, pessoa.
    (r.cadastros || []).forEach(function (c) {
      try {
        if (c.acao === 'excluir') {
          efeitos.push(excluirCadastro_({ tipo: c.tipo, nome: c.nome }));
        } else {
          var item = { ativo: true };
          var chave = (CADASTROS[c.tipo] || {}).campos;
          if (chave) item[chave[0]] = c.nome;
          if (c.pessoa) item.pessoa = c.pessoa;
          if (c.tipo_item) item.tipo = c.tipo_item;
          if (c.grupo) item.grupo = c.grupo;
          efeitos.push(salvarCadastro_({ tipo: c.tipo, item: item, nome_antigo: c.nome_antigo }));
        }
      } catch (err) {
        efeitos.push({ ok: false, nome: c.nome, erro: String(err && err.message || err) });
      }
    });

    // Fatos que você contou e que a IA deve lembrar nas análises.
    (r.memoria || []).forEach(function (fato) {
      try { gravarMemoria_(fato, texto); } catch (err) {}
    });

    var lista = (r.lancamentos || []).map(function (item, i) {
      item.uuid = i === 0 ? uuid : Utilities.getUuid();
      item.texto_falado = texto;
      item.confianca = 'ia';
      item.origem = pedido.origem || 'voz';
      item.status = STATUS.OK;
      item.revisar = r.lancamentos.length > 1;
      return item;
    });

    var gravou = lista.length ? lancar_({ lancamentos: lista }) : { gravados: [] };

    return {
      ok: true,
      intencao: r.intencao,
      resumo: r.resumo,
      gravados: gravou.gravados,
      lancamentos: lista,
      recorrentes: efeitos,
      memoria: r.memoria || []
    };
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

  if (!dentroDoTetoIA_()) {
    return {
      ok: false,
      codigo: 'teto_diario',
      detalhe: 'Bateu o limite de ' + MAX_IA_DIA + ' interpretações por dia. Nada se perde: o gatilho horário retoma amanhã.'
    };
  }

  var categorias = lerCategorias_();
  var nomes = categorias.map(function (c) { return c.categoria; }).join(', ');
  var contas = lerContas_().join(', ');

  var mes = mesAtual_();
  var vigentes = recorrentesDoMes_(mes).map(function (r) {
    return r.nome + ' ' + r.valor.toFixed(2) + (r.dia ? ' (dia ' + r.dia + ')' : '');
  }).join('; ') || 'nenhum ainda';

  var fontes = lerCadastro_('fontes').filter(function (f) { return f.ativo; })
    .map(function (f) { return f.nome + (f.pessoa ? ' [' + f.pessoa + ']' : ''); }).join(', ') || 'nenhuma';
  var pessoas = lerCadastro_('pessoas').filter(function (p) { return p.ativo; })
    .map(function (p) { return p.nome; }).join(', ') || 'nenhuma';

  var instrucao =
    'Você interpreta frases faladas em português do Brasil sobre as finanças pessoais de uma pessoa.\n' +
    'Hoje é ' + hojeISO_() + ', mês ' + mes + ' (fuso ' + fuso_() + ').\n' +
    'Categorias permitidas: ' + nomes + '.\n' +
    'Contas permitidas: ' + contas + '.\n' +
    'Fontes de renda permitidas: ' + fontes + '.\n' +
    'Pessoas: ' + pessoas + '.\n' +
    'Compromissos fixos já cadastrados: ' + vigentes + '.\n\n' +

    'Primeiro CLASSIFIQUE a frase. A distinção mais importante é entre um FATO\n' +
    '(dinheiro que já entrou ou saiu) e uma REGRA (quanto algo passa a custar).\n\n' +

    'lancamento — dinheiro que se moveu. "mercado 120", "recebi 3000", "paguei o aluguel"\n' +
    'recorrente — uma regra sobre algo que se repete todo mês\n' +
    'memoria    — um fato sobre a pessoa, sem valor a movimentar. "recebo sempre dia 5"\n' +
    'cadastro   — criar, renomear ou desativar uma conta, categoria, fonte de renda\n' +
    '             ou pessoa. "adiciona o cartão Inter", "cria a categoria Viagem",\n' +
    '             "não uso mais o Santander", "renomeia Caju para Caju Alimentação"\n' +
    'nenhuma    — não dá para extrair nada\n\n' +

    'Dentro de "recorrente", a ação muda tudo:\n' +
    '  definir  — passa a valer deste mês em diante, até nova ordem.\n' +
    '             Sinais: "meu X é", "meu gasto mensal com X é", "todo mês pago",\n' +
    '             "mensalmente", "por mês", "X agora é", "reajustou para", "passou a ser",\n' +
    '             "aumentou para", "assinei X por".\n' +
    '  excecao  — vale SÓ no mês indicado e não muda o futuro.\n' +
    '             Sinais: "esse mês", "este mês", "em <mês>", "só agora", "dessa vez",\n' +
    '             "veio", "foi" referindo-se à cobrança de um mês específico.\n' +
    '  encerrar — acabou. "cancelei", "não pago mais", "terminei de pagar".\n\n' +

    'Exemplos decisivos:\n' +
    '  "meu gasto mensal no aluguel é de 1800"  -> recorrente, definir, 1800\n' +
    '  "esse mês meu aluguel foi 1850"          -> recorrente, excecao, 1850, mes atual\n' +
    '  "meu aluguel agora é 1900"               -> recorrente, definir, 1900\n' +
    '  "paguei o aluguel hoje"                  -> lancamento (o dinheiro saiu de fato)\n' +
    '  "em março o condomínio vai ser 400"      -> recorrente, excecao, mes 03 daquele ano\n\n' +

    'Responda SOMENTE com um objeto JSON, sem texto em volta, sem markdown:\n' +
    '{"intencao":"lancamento|recorrente|memoria|nenhuma",\n' +
    ' "lancamentos":[{"tipo":"despesa|receita","valor":number,"categoria":string,' +
    '"descricao":string,"data":"YYYY-MM-DD","conta":string,' +
    '"metodo":"pix|credito|debito|dinheiro|boleto|","fonte":string,"pessoa":string,' +
    '"parcela_atual":number|null,"parcelas_total":number|null}],\n' +
    ' "recorrentes":[{"nome":string,"acao":"definir|excecao|encerrar","valor":number,' +
    '"tipo":"despesa|receita","categoria":string,"dia":number|null,"mes":"YYYY-MM"}],\n' +
    ' "memoria":[string],\n' +
    ' "cadastros":[{"tipo":"contas|categorias|fontes|pessoas","acao":"salvar|excluir",' +
    '"nome":string,"nome_antigo":string|null,"pessoa":string|null,' +
    '"tipo_item":string|null,"grupo":string|null}],\n' +
    ' "resumo":string}\n\n' +

    'Regras:\n' +
    '- "resumo" é uma frase curta em português dizendo o que você entendeu, para a pessoa confirmar.\n' +
    '- Use o mesmo "nome" de um compromisso já cadastrado quando a frase se referir a ele.\n' +
    '- Em "excecao", "mes" é o mês a que a frase se refere; se ela disser "esse mês", use ' + mes + '.\n' +
    '- Uma frase pode conter mais de um lançamento; devolva um item por lançamento.\n' +
    '- Em parcelamento, "valor" é o valor TOTAL da compra e parcelas_total o número de parcelas.\n' +
    '- Se a categoria não se encaixar em nenhuma da lista, use "Outros" (despesa) ou "Outras Entradas" (receita).\n' +
    '- Datas relativas ("ontem", "sexta passada") devem virar data absoluta.\n' +
    '- "conta" é de onde o dinheiro saiu ou entrou. Case pelo nome falado, mesmo abreviado\n' +
    '  ("nubank da May" -> "Nubank May", "vale" ou "alimentação" -> o cartão de benefício).\n' +
    '- "fonte" só vale em receitas, e é de onde a renda vem. Deixe "" em despesas.\n' +
    '- "pessoa" é de quem é o gasto ou a renda. Se a frase não disser, deixe "" que eu\n' +
    '  deduzo pela conta.\n' +
    '- Em "cadastros", "tipo_item" é o subtipo (credito, conta corrente, beneficio,\n' +
    '  dinheiro para contas; salario, freela para fontes).\n' +
    '- Listas sem conteúdo vão como [].';

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
    var obj = JSON.parse(saida);

    // Tolera a IA devolver só o array de lançamentos, como na versão anterior.
    if (Array.isArray(obj)) obj = { intencao: 'lancamento', lancamentos: obj };

    var lancamentos = obj.lancamentos || [];
    var recorrentes = obj.recorrentes || [];
    var memoria = obj.memoria || [];
    var cadastros = obj.cadastros || [];

    if (!lancamentos.length && !recorrentes.length && !memoria.length && !cadastros.length) {
      return { ok: false, codigo: 'nada_entendido', detalhe: 'A IA não achou nada acionável na frase.' };
    }

    return {
      ok: true,
      intencao: obj.intencao || (recorrentes.length ? 'recorrente' : (cadastros.length ? 'cadastro' : 'lancamento')),
      lancamentos: lancamentos,
      recorrentes: recorrentes,
      memoria: memoria,
      cadastros: cadastros,
      resumo: obj.resumo || ''
    };
  } catch (err) {
    return { ok: false, codigo: 'resposta_estranha', detalhe: String(err && err.message || err) };
  }
}

// ---------------------------------------------------------------------------
// Perguntar e simular
// ---------------------------------------------------------------------------

/**
 * O retrato financeiro que a IA recebe antes de responder.
 * Os números são calculados aqui, em código, para a IA não ter que fazer conta
 * — ela raciocina sobre o cenário, mas a aritmética é minha.
 */
function panorama_(pedido) {
  var mes = mesAtual_();
  var meses = [];
  var m = mes;
  for (var i = 0; i < 6; i++) { meses.unshift(m); m = mesAnterior_(m); }

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  var col = indiceColunas_();
  var porMes = {};
  var porCategoria = {};

  meses.forEach(function (k) { porMes[k] = { mes: k, receitas: 0, despesas: 0, lancamentos: 0 }; });

  if (n > 0) {
    aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues().forEach(function (r) {
      if (r[col.status] !== STATUS.OK) return;
      var k = normalizarData_(r[col.data]).slice(0, 7);
      if (!porMes[k]) return;
      var v = Number(r[col.valor]) || 0;
      porMes[k].lancamentos++;
      if (r[col.tipo] === 'receita') porMes[k].receitas += v;
      else {
        porMes[k].despesas += v;
        var c = r[col.categoria] || 'Outros';
        porCategoria[c] = (porCategoria[c] || 0) + v;
      }
    });
  }

  var serie = meses.map(function (k) { return porMes[k]; });
  var comDados = serie.filter(function (s) { return s.lancamentos > 0; });
  var ultimos3 = comDados.slice(-3);

  var media = function (lista, campo) {
    if (!lista.length) return 0;
    var soma = lista.reduce(function (a, s) { return a + s[campo]; }, 0);
    return Math.round((soma / lista.length) * 100) / 100;
  };

  var fixos = recorrentesDoMes_(mes);
  var fixasDespesa = fixos.filter(function (r) { return r.tipo !== 'receita'; });
  var fixasReceita = fixos.filter(function (r) { return r.tipo === 'receita'; });
  var somar = function (lista) {
    return Math.round(lista.reduce(function (a, r) { return a + r.valor; }, 0) * 100) / 100;
  };

  var contas = lerContasCompletas_();
  var saldoInicial = contas.reduce(function (a, c) { return a + c.saldo_inicial; }, 0);
  var movimento = serie.reduce(function (a, s) { return a + s.receitas - s.despesas; }, 0);

  return {
    ok: true,
    mes: mes,
    serie: serie,
    meses_com_dados: comDados.length,
    receita_media: media(ultimos3, 'receitas'),
    despesa_media: media(ultimos3, 'despesas'),
    despesas_fixas: somar(fixasDespesa),
    receitas_fixas: somar(fixasReceita),
    compromissos: fixos,
    parcelas_em_aberto: fixos.filter(function (r) { return r.parcelas_restantes > 0; }),
    por_categoria: Object.keys(porCategoria)
      .map(function (c) { return { categoria: c, total: Math.round(porCategoria[c] * 100) / 100 }; })
      .sort(function (a, b) { return b.total - a.total; })
      .slice(0, 12),
    contas: contas,
    saldo_estimado: Math.round((saldoInicial + movimento) * 100) / 100,
    memoria: lerMemoria_()
  };
}

function lerContasCompletas_() {
  return lerCadastro_('contas')
    .filter(function (c) { return c.ativo; })
    .map(function (c) {
      return {
        nome: c.nome, tipo: c.tipo, pessoa: c.pessoa,
        saldo_inicial: Number(c.saldo_inicial) || 0
      };
    });
}

/**
 * Responde uma pergunta sua sobre as próprias finanças, com projeção.
 * "Estou pensando num carro de 950 por mês, quanto isso me afeta?"
 */
function perguntar_(pedido) {
  var pergunta = String(pedido.pergunta || '').trim();
  if (!pergunta) return { ok: false, erro: 'pergunta_vazia' };

  var chave = PROP.getProperty('ANTHROPIC_KEY');
  if (!chave) return { ok: false, erro: 'sem_chave', detalhe: 'A chave da API ainda não foi salva no script.' };

  if (!dentroDoTetoAnalise_()) {
    return {
      ok: false, erro: 'teto_diario',
      detalhe: 'Bateu o limite de ' + MAX_ANALISE_DIA + ' análises por dia.'
    };
  }

  var p = panorama_({});
  var historico = lerConversas_(3);

  if (!p.meses_com_dados) {
    return {
      ok: false, erro: 'sem_dados',
      detalhe: 'Ainda não há lançamentos suficientes para eu projetar alguma coisa. Registre alguns gastos e sua renda primeiro.'
    };
  }

  var instrucao =
    'Você é o analista financeiro pessoal do dono destes dados. Fale com ele em português do Brasil,\n' +
    'na segunda pessoa, direto e sem jargão. Hoje é ' + hojeISO_() + '.\n\n' +

    'A aritmética já foi feita: use os números do panorama como verdade e não os recalcule.\n' +
    'Quando faltar um dado, assuma algo razoável e DIGA que assumiu, em "premissas".\n\n' +

    'Se a pergunta for sobre assumir um novo compromisso (uma parcela, uma assinatura,\n' +
    'um financiamento), projete 12 meses com e sem ele, e deixe claro o que sobra nos dois casos.\n\n' +

    'Sobre o veredito, seja honesto e não otimista: "confortavel" só se a sobra projetada\n' +
    'aguentar o compromisso e ainda deixar folga; "apertado" se couber mas sem margem;\n' +
    '"arriscado" se comprometer mais do que sobra, ou se os dados forem poucos demais\n' +
    'para afirmar qualquer coisa (nesse caso diga isso na resposta).\n\n' +

    'Responda SOMENTE com um objeto JSON, sem markdown em volta:\n' +
    '{"resposta": string (2 a 5 parágrafos curtos, texto puro, sem títulos),\n' +
    ' "veredito": "confortavel|apertado|arriscado",\n' +
    ' "compromisso_mensal": number|null (a parcela perguntada, se houver),\n' +
    ' "premissas": [string],\n' +
    ' "sugestoes": [string] (2 a 4, concretas e ligadas aos números dele),\n' +
    ' "projecao": [{"mes":"YYYY-MM","receitas":number,"fixas":number,' +
    '"variaveis":number,"novo":number,"sobra":number}] (12 meses a partir do mês atual;\n' +
    '   "novo" é o novo compromisso, 0 se a pergunta não envolver nenhum;\n' +
    '   "sobra" = receitas - fixas - variaveis - novo),\n' +
    ' "lembrar": [string] (fatos novos que ele contou nesta pergunta e valem guardar; [] se nenhum)}';

  var contexto =
    'PANORAMA (valores em reais):\n' + JSON.stringify({
      mes_atual: p.mes,
      ultimos_meses: p.serie,
      receita_media_3m: p.receita_media,
      despesa_media_3m: p.despesa_media,
      despesas_fixas_mes: p.despesas_fixas,
      receitas_fixas_mes: p.receitas_fixas,
      compromissos: p.compromissos,
      parcelas_em_aberto: p.parcelas_em_aberto,
      gastos_por_categoria: p.por_categoria,
      contas: p.contas,
      saldo_estimado: p.saldo_estimado
    }) + '\n\n' +
    'O QUE ELE JÁ ME CONTOU:\n' + (p.memoria.length ? p.memoria.join('\n') : '(nada ainda)') + '\n\n' +
    (historico.length
      ? 'CONVERSAS ANTERIORES:\n' + historico.map(function (h) {
          return 'P: ' + h.pergunta + '\nR: ' + String(h.resposta).slice(0, 600);
        }).join('\n\n') + '\n\n'
      : '') +
    'PERGUNTA:\n' + pergunta;

  var resposta;
  try {
    resposta = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: MODELO_ANALISAR,
        max_tokens: 3000,
        system: instrucao,
        messages: [{ role: 'user', content: contexto }]
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { ok: false, erro: 'sem_rede', detalhe: String(err && err.message || err) };
  }

  var status = resposta.getResponseCode();
  if (status !== 200) {
    var e = classificarErro_(status, resposta.getContentText());
    avisarSePreciso_(e.codigo, e.detalhe);
    return { ok: false, erro: e.codigo, detalhe: e.detalhe };
  }

  try {
    var dados = JSON.parse(resposta.getContentText());
    var saida = (dados.content || []).map(function (b) { return b.text || ''; }).join('').trim();
    saida = saida.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var analise = JSON.parse(saida);

    (analise.lembrar || []).forEach(function (f) {
      try { gravarMemoria_(f, 'pergunta'); } catch (err) {}
    });

    var custo = estimarCusto_(dados.usage);
    registrarConversa_(pergunta, analise, custo);

    analise.ok = true;
    analise.panorama = { mes: p.mes, saldo_estimado: p.saldo_estimado, meses_com_dados: p.meses_com_dados };
    analise.custo_estimado = custo;
    return analise;
  } catch (err) {
    return { ok: false, erro: 'resposta_estranha', detalhe: String(err && err.message || err) };
  }
}

/** Custo em reais, aproximado, dos preços do Sonnet 5. */
function estimarCusto_(uso) {
  if (!uso) return 0;
  var dolar = 5.4; // aproximação; serve só para você acompanhar a ordem de grandeza
  var usd = (Number(uso.input_tokens || 0) / 1e6) * 2 + (Number(uso.output_tokens || 0) / 1e6) * 10;
  return Math.round(usd * dolar * 10000) / 10000;
}

function registrarConversa_(pergunta, analise, custo) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('conversas');
  aba.appendRow([
    new Date(), pergunta,
    String(analise.resposta || '').slice(0, 20000),
    MODELO_ANALISAR, custo
  ]);
}

function lerConversas_(quantas) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('conversas');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return [];
  var inicio = Math.max(2, n + 2 - quantas);
  var qtd = Math.min(quantas, n);
  return aba.getRange(inicio, 1, qtd, 5).getValues().map(function (r) {
    return { data: r[0], pergunta: r[1], resposta: r[2] };
  });
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
      // Erro que depende de você (ou do relógio): para de tentar agora e avisa.
      if (r.codigo === 'sem_creditos' || r.codigo === 'chave_invalida' ||
          r.codigo === 'sem_chave' || r.codigo === 'teto_diario') break;
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
  sem_chave:     'A chave da API da Claude ainda não foi salva no script. As frases que precisam de IA estão guardadas esperando.',
  teto_diario:   'Foi atingido o teto diário de interpretações por IA. Se você não fez esse volume de lançamentos hoje, alguém pode estar usando seu token — rode girarToken() no Apps Script e cole o novo nos Ajustes do app.'
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
  return aba.getRange(2, 1, n, 6).getValues()
    .filter(function (r) { return r[0] && r[5] !== 'não'; })
    .map(function (r) {
      return {
        categoria: r[0], grupo: r[1], tipo: r[2],
        palavras: String(r[3] || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean),
        orcamento: Number(r[4]) || 0,
        ativo: true
      };
    });
}

// ---------------------------------------------------------------------------
// Painel do mês
// ---------------------------------------------------------------------------

/**
 * Tudo que a tela do mês precisa, numa chamada só: os totais, os cortes por
 * categoria, conta, pessoa e fonte, a evolução dos últimos seis meses e o que
 * ainda está previsto para cair até o fim do mês.
 */
function painel_(pedido) {
  var mes = (pedido.mes || mesAtual_()).slice(0, 7);

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  var col = indiceColunas_();

  // Seis meses terminando no mês pedido, para a evolução.
  var meses = [];
  var m = mes;
  for (var i = 0; i < 6; i++) { meses.unshift(m); m = mesAnterior_(m); }
  var serie = {};
  meses.forEach(function (k) { serie[k] = { mes: k, receitas: 0, despesas: 0 }; });

  var totais = { receitas: 0, despesas: 0, lancamentos: 0 };
  var porCategoria = {}, porConta = {}, porPessoa = {}, porFonte = {}, porGrupo = {};
  var porDia = {};

  var grupoDe = {};
  lerCategorias_().forEach(function (c) { grupoDe[chaveNome_(c.categoria)] = c.grupo || 'Outros'; });

  if (n > 0) {
    aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues().forEach(function (r) {
      if (r[col.status] !== STATUS.OK) return;

      var data = normalizarData_(r[col.data]);
      var mesLinha = data.slice(0, 7);
      var valor = Number(r[col.valor]) || 0;
      var receita = r[col.tipo] === 'receita';

      if (serie[mesLinha]) {
        if (receita) serie[mesLinha].receitas += valor;
        else serie[mesLinha].despesas += valor;
      }

      if (mesLinha !== mes) return;

      totais.lancamentos++;
      var pessoa = r[col.pessoa] || 'Sem dono';

      if (receita) {
        totais.receitas += valor;
        somar_(porFonte, r[col.fonte] || 'Sem fonte', valor);
      } else {
        totais.despesas += valor;
        var cat = r[col.categoria] || 'Outros';
        somar_(porCategoria, cat, valor);
        somar_(porGrupo, grupoDe[chaveNome_(cat)] || 'Outros', valor);
        somar_(porConta, r[col.conta] || 'Sem conta', valor);
        somar_(porDia, data, valor);
      }
      somar_(porPessoa, pessoa, receita ? 0 : valor);
    });
  }

  // O que ainda está previsto e não apareceu como lançamento neste mês.
  var compromissos = recorrentesDoMes_(mes);
  var jaLancado = {};
  Object.keys(porCategoria).forEach(function (c) { jaLancado[chaveNome_(c)] = true; });
  var previsto = compromissos.filter(function (c) {
    return c.tipo !== 'receita' && !jaLancado[chaveNome_(c.nome)];
  });

  var orcamentos = {};
  lerCategorias_().forEach(function (c) {
    if (c.orcamento > 0) orcamentos[c.categoria] = c.orcamento;
  });

  return {
    ok: true,
    mes: mes,
    receitas: arred_(totais.receitas),
    despesas: arred_(totais.despesas),
    saldo: arred_(totais.receitas - totais.despesas),
    lancamentos: totais.lancamentos,
    por_categoria: emLista_(porCategoria),
    por_grupo: emLista_(porGrupo),
    por_conta: emLista_(porConta),
    por_pessoa: emLista_(porPessoa),
    por_fonte: emLista_(porFonte),
    por_dia: Object.keys(porDia).sort().map(function (d) {
      return { dia: d, total: arred_(porDia[d]) };
    }),
    evolucao: meses.map(function (k) {
      return {
        mes: k,
        receitas: arred_(serie[k].receitas),
        despesas: arred_(serie[k].despesas),
        saldo: arred_(serie[k].receitas - serie[k].despesas)
      };
    }),
    previsto: previsto.map(function (c) {
      return { nome: c.nome, valor: arred_(c.valor), dia: c.dia, categoria: c.categoria };
    }),
    previsto_total: arred_(previsto.reduce(function (a, c) { return a + c.valor; }, 0)),
    orcamentos: orcamentos
  };
}

function somar_(mapa, chave, valor) {
  if (!chave) return;
  mapa[chave] = (mapa[chave] || 0) + valor;
}

function emLista_(mapa) {
  return Object.keys(mapa)
    .map(function (k) { return { nome: k, total: arred_(mapa[k]) }; })
    .filter(function (i) { return i.total > 0; })
    .sort(function (a, b) { return b.total - a.total; });
}

function arred_(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Editar e excluir lançamentos
// ---------------------------------------------------------------------------

var CAMPOS_EDITAVEIS = [
  'data', 'tipo', 'valor', 'categoria', 'descricao',
  'conta', 'metodo', 'fonte', 'pessoa', 'parcela_atual', 'parcelas_total'
];

/** Todos os lançamentos de um mês, do mais recente para o mais antigo. */
function lancamentosDoMes_(pedido) {
  var mes = (pedido.mes || mesAtual_()).slice(0, 7);
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return { ok: true, mes: mes, lancamentos: [] };

  var col = indiceColunas_();
  var lista = [];

  aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues().forEach(function (r) {
    if (r[col.status] === STATUS.EXCLUIDO) return;
    var data = normalizarData_(r[col.data]);
    if (data.indexOf(mes) !== 0) return;
    lista.push(lancamentoDe_(r, col, data));
  });

  lista.sort(function (a, b) { return a.data < b.data ? 1 : (a.data > b.data ? -1 : 0); });
  return { ok: true, mes: mes, lancamentos: lista };
}

function lancamentoDe_(r, col, data) {
  return {
    uuid: r[col.uuid],
    data: data || normalizarData_(r[col.data]),
    tipo: r[col.tipo] || 'despesa',
    valor: Number(r[col.valor]) || 0,
    categoria: r[col.categoria] || '',
    descricao: r[col.descricao] || '',
    conta: r[col.conta] || '',
    metodo: r[col.metodo] || '',
    fonte: r[col.fonte] || '',
    pessoa: r[col.pessoa] || '',
    parcela_atual: r[col.parcela_atual] || '',
    parcelas_total: r[col.parcelas_total] || '',
    texto_falado: r[col.texto_falado] || '',
    status: r[col.status] || STATUS.OK,
    revisar: r[col.revisar] === 'sim'
  };
}

function acharLinhaPorUuid_(aba, uuid) {
  var n = aba.getLastRow() - 1;
  if (n <= 0) return 0;
  var uuids = aba.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < uuids.length; i++) {
    if (String(uuids[i][0]) === String(uuid)) return i + 2;
  }
  return 0;
}

/** Altera só os campos enviados. O que não vier fica como está. */
function editarLancamento_(pedido) {
  if (!pedido.uuid) return { ok: false, erro: 'uuid_faltando' };

  var trava = LockService.getScriptLock();
  trava.waitLock(15000);
  try {
    var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
    var linha = acharLinhaPorUuid_(aba, pedido.uuid);
    if (!linha) return { ok: false, erro: 'nao_encontrado' };

    var col = indiceColunas_();
    var faixa = aba.getRange(linha, 1, 1, ABAS.lancamentos.length);
    var valores = faixa.getValues()[0];
    var mudou = [];

    CAMPOS_EDITAVEIS.forEach(function (campo) {
      if (pedido.campos && pedido.campos[campo] !== undefined) {
        var novo = pedido.campos[campo];
        if (campo === 'valor') novo = Number(novo) || 0;
        if (String(valores[col[campo]]) !== String(novo)) mudou.push(campo);
        valores[col[campo]] = novo;
      }
    });

    // Corrigir uma linha à mão resolve a dúvida que marcou ela para revisão.
    valores[col.revisar] = '';
    if (valores[col.status] !== STATUS.OK) valores[col.status] = STATUS.OK;

    faixa.setValues([valores]);
    atualizarResumo_();

    return { ok: true, uuid: pedido.uuid, alterados: mudou };
  } finally {
    trava.releaseLock();
  }
}

/**
 * Marca como excluído em vez de apagar a linha: sai de todas as contas e
 * gráficos, mas continua na planilha caso você tenha errado o toque.
 */
function excluirLancamento_(pedido) {
  if (!pedido.uuid) return { ok: false, erro: 'uuid_faltando' };

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var linha = acharLinhaPorUuid_(aba, pedido.uuid);
  if (!linha) return { ok: false, erro: 'nao_encontrado' };

  var col = indiceColunas_();
  aba.getRange(linha, col.status + 1).setValue(STATUS.EXCLUIDO);
  atualizarResumo_();
  return { ok: true, uuid: pedido.uuid };
}

// ---------------------------------------------------------------------------
// Cadastros: contas, categorias, fontes e pessoas
// ---------------------------------------------------------------------------
//
// Os quatro se comportam igual: uma aba, a primeira coluna é o nome, a última
// diz se está ativo. Desativar em vez de apagar preserva os lançamentos antigos
// que apontam para aquele nome — eles continuam fazendo sentido no histórico.

var CADASTROS = {
  contas:     { aba: 'contas',     campos: ['nome', 'tipo', 'pessoa', 'saldo_inicial', 'ativo'] },
  categorias: { aba: 'categorias', campos: ['categoria', 'grupo', 'tipo', 'palavras_chave', 'orcamento_mes', 'ativo'] },
  fontes:     { aba: 'fontes',     campos: ['nome', 'pessoa', 'tipo', 'ativo'] },
  pessoas:    { aba: 'pessoas',    campos: ['nome', 'ativo'] }
};

/** Tudo que o app precisa para preencher os seletores, numa chamada só. */
function cadastros_() {
  return {
    ok: true,
    categorias: lerCategorias_(),
    contas: lerCadastro_('contas'),
    fontes: lerCadastro_('fontes'),
    pessoas: lerCadastro_('pessoas'),
    // compatibilidade com versões anteriores do app, que esperavam nomes soltos
    contas_nomes: lerContas_()
  };
}

function lerCadastro_(tipo) {
  var def = CADASTROS[tipo];
  if (!def) return [];
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.aba);
  if (!aba) return [];
  var n = aba.getLastRow() - 1;
  if (n <= 0) return [];

  return aba.getRange(2, 1, n, def.campos.length).getValues()
    .map(function (linha, i) {
      var item = { linha: i + 2 };
      def.campos.forEach(function (campo, c) { item[campo] = linha[c]; });
      item.ativo = item.ativo !== 'não' && item.ativo !== false;
      return item;
    })
    .filter(function (item) { return item[def.campos[0]]; });
}

/** Cria, ou atualiza pelo nome. Renomeia se vier `nome_antigo`. */
function salvarCadastro_(pedido) {
  var tipo = pedido.tipo;
  var def = CADASTROS[tipo];
  if (!def) return { ok: false, erro: 'cadastro_desconhecido' };

  var item = pedido.item || {};
  var chaveCampo = def.campos[0];
  var nome = String(item[chaveCampo] || pedido.nome || '').trim();
  if (!nome) return { ok: false, erro: 'nome_vazio' };

  var trava = LockService.getScriptLock();
  trava.waitLock(15000);
  try {
    var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.aba);
    var existentes = lerCadastro_(tipo);
    var procurado = chaveNome_(pedido.nome_antigo || nome);
    var achado = existentes.filter(function (e) {
      return chaveNome_(e[chaveCampo]) === procurado;
    })[0];

    var valores = def.campos.map(function (campo) {
      if (campo === chaveCampo) return nome;
      if (campo === 'ativo') return item.ativo === false || item.ativo === 'não' ? 'não' : 'sim';
      if (item[campo] !== undefined && item[campo] !== null) return item[campo];
      return achado ? achado[campo] : '';
    });

    if (achado) {
      aba.getRange(achado.linha, 1, 1, def.campos.length).setValues([valores]);
      // Renomear precisa arrastar os lançamentos junto, senão eles ficam órfãos.
      if (pedido.nome_antigo && chaveNome_(pedido.nome_antigo) !== chaveNome_(nome)) {
        renomearNosLancamentos_(tipo, pedido.nome_antigo, nome);
      }
      return { ok: true, acao: 'atualizado', nome: nome };
    }

    aba.appendRow(valores);
    return { ok: true, acao: 'criado', nome: nome };
  } finally {
    trava.releaseLock();
  }
}

/** Desativa. Não apaga, para não quebrar o histórico. */
function excluirCadastro_(pedido) {
  var def = CADASTROS[pedido.tipo];
  if (!def) return { ok: false, erro: 'cadastro_desconhecido' };

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.aba);
  var alvo = chaveNome_(pedido.nome);
  var achado = lerCadastro_(pedido.tipo).filter(function (e) {
    return chaveNome_(e[def.campos[0]]) === alvo;
  })[0];

  if (!achado) return { ok: false, erro: 'nao_encontrado' };

  var colunaAtivo = def.campos.indexOf('ativo') + 1;
  aba.getRange(achado.linha, colunaAtivo).setValue('não');
  return { ok: true, acao: 'desativado', nome: pedido.nome };
}

/** Quando um cadastro muda de nome, os lançamentos acompanham. */
function renomearNosLancamentos_(tipo, de, para) {
  var coluna = { contas: 'conta', categorias: 'categoria', fontes: 'fonte', pessoas: 'pessoa' }[tipo];
  if (!coluna) return;

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return;

  var col = indiceColunas_();
  var indice = col[coluna];
  var faixa = aba.getRange(2, indice + 1, n, 1);
  var valores = faixa.getValues();
  var alvo = chaveNome_(de);
  var mudou = false;

  for (var i = 0; i < valores.length; i++) {
    if (chaveNome_(valores[i][0]) === alvo) { valores[i][0] = para; mudou = true; }
  }
  if (mudou) faixa.setValues(valores);
}

function lerContas_() {
  var contas = lerCadastro_('contas').filter(function (c) { return c.ativo; });
  return contas.length ? contas.map(function (c) { return c.nome; }) : ['Dinheiro'];
}

// ---------------------------------------------------------------------------
// Recorrentes: gastos e rendas que se repetem, com histórico de valores
// ---------------------------------------------------------------------------
//
// O problema que isto resolve, nas suas palavras:
//
//   "meu gasto mensal com aluguel é 1800"  -> vale de agora até segunda ordem
//   "esse mês o aluguel foi 1850"          -> só este mês; não muda o futuro
//   "meu aluguel agora é 1900"             -> daqui pra frente é 1900
//
// E o mês passado continua valendo 1800, porque nada é sobrescrito: cada
// mudança fecha a vigência anterior e abre uma nova linha.

/** Guarda um fato sobre você para a IA usar nas análises. Não duplica. */
function gravarMemoria_(fato, origem) {
  var texto = String(fato || '').trim();
  if (!texto) return;

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('memoria');
  var n = aba.getLastRow() - 1;
  if (n > 0) {
    var existentes = aba.getRange(2, 1, n, 1).getValues();
    var alvo = semAcentoGS_(texto);
    for (var i = 0; i < existentes.length; i++) {
      if (semAcentoGS_(String(existentes[i][0] || '')) === alvo) return;
    }
  }
  aba.appendRow([texto, origem || 'voz', hojeISO_(), 'sim']);
}

function lerMemoria_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('memoria');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return [];
  return aba.getRange(2, 1, n, 4).getValues()
    .filter(function (r) { return r[0] && r[3] !== 'não'; })
    .map(function (r) { return String(r[0]); });
}

function colunasRecorrentes_() {
  var idx = {};
  ABAS.recorrentes.forEach(function (nome, i) { idx[nome] = i; });
  return idx;
}

function mesAtual_() {
  return Utilities.formatDate(new Date(), fuso_(), 'yyyy-MM');
}

/** Mês anterior a "2026-02" é "2026-01". */
function mesAnterior_(mes) {
  var ano = Number(mes.slice(0, 4));
  var m = Number(mes.slice(5, 7)) - 1;
  if (m === 0) { m = 12; ano--; }
  return ano + '-' + (m < 10 ? '0' + m : String(m));
}

function mesSeguinte_(mes) {
  var ano = Number(mes.slice(0, 4));
  var m = Number(mes.slice(5, 7)) + 1;
  if (m === 13) { m = 1; ano++; }
  return ano + '-' + (m < 10 ? '0' + m : String(m));
}

function lerRecorrentes_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('recorrentes');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return [];
  var c = colunasRecorrentes_();
  var linhas = aba.getRange(2, 1, n, ABAS.recorrentes.length).getValues();
  return linhas.map(function (r, i) {
    return {
      linha: i + 2,
      nome: String(r[c.nome] || '').trim(),
      tipo: r[c.tipo] || 'despesa',
      categoria: r[c.categoria] || '',
      valor: Number(r[c.valor]) || 0,
      dia: Number(r[c.dia]) || 0,
      inicio: String(r[c.vigencia_inicio] || '').slice(0, 7),
      fim: String(r[c.vigencia_fim] || '').slice(0, 7),
      escopo: r[c.escopo] || 'padrao',
      parcelas_total: Number(r[c.parcelas_total]) || 0,
      parcelas_restantes: Number(r[c.parcelas_restantes]) || 0
    };
  }).filter(function (r) { return r.nome; });
}

function chaveNome_(nome) {
  return semAcentoGS_(String(nome || '')).replace(/[^a-z0-9]/g, '');
}

function semAcentoGS_(s) {
  return String(s || '').toLowerCase()
    .replace(/[áàâãä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
    .replace(/[óòôõö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ç/g, 'c');
}

/**
 * Quanto vale este compromisso no mês dado.
 * A exceção do mês ganha da vigência normal; se não houver nenhuma das duas,
 * o compromisso não existia naquele mês.
 */
function valorNoMes_(recorrentes, nome, mes) {
  var alvo = chaveNome_(nome);
  var candidatas = recorrentes.filter(function (r) { return chaveNome_(r.nome) === alvo; });

  var excecao = candidatas.filter(function (r) {
    return r.escopo === 'excecao' && r.inicio === mes;
  })[0];
  if (excecao) return { valor: excecao.valor, origem: 'excecao', registro: excecao };

  var vigentes = candidatas.filter(function (r) {
    return r.escopo !== 'excecao' && r.inicio && r.inicio <= mes && (!r.fim || r.fim >= mes);
  });
  if (!vigentes.length) return null;

  // Se houver sobreposição por algum engano, a vigência mais recente manda.
  vigentes.sort(function (a, b) { return a.inicio < b.inicio ? 1 : -1; });
  return { valor: vigentes[0].valor, origem: 'vigencia', registro: vigentes[0] };
}

/** Todos os compromissos ativos num mês, já resolvidos. */
function recorrentesDoMes_(mes) {
  var todos = lerRecorrentes_();
  var nomes = {};
  todos.forEach(function (r) { nomes[chaveNome_(r.nome)] = r.nome; });

  var saida = [];
  Object.keys(nomes).forEach(function (k) {
    var r = valorNoMes_(todos, nomes[k], mes);
    if (!r || !r.valor) return;
    saida.push({
      nome: nomes[k],
      valor: r.valor,
      tipo: r.registro.tipo,
      categoria: r.registro.categoria,
      dia: r.registro.dia,
      excecao: r.origem === 'excecao',
      parcelas_restantes: r.registro.parcelas_restantes
    });
  });
  return saida;
}

/**
 * Aplica uma declaração sua sobre um compromisso.
 *
 * acao:
 *   definir  — passa a valer deste mês em diante (fecha a vigência anterior)
 *   excecao  — vale só no mês indicado, sem mexer no futuro
 *   encerrar — acaba neste mês ("cancelei a academia")
 */
function aplicarRecorrente_(d) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('recorrentes');
  var c = colunasRecorrentes_();
  var todos = lerRecorrentes_();
  var alvo = chaveNome_(d.nome);
  var mes = (d.mes || mesAtual_()).slice(0, 7);
  var acao = d.acao || 'definir';

  if (acao === 'excecao') {
    // Se já existe exceção para este mês, substitui em vez de duplicar.
    var jaTem = todos.filter(function (r) {
      return chaveNome_(r.nome) === alvo && r.escopo === 'excecao' && r.inicio === mes;
    })[0];
    if (jaTem) {
      aba.getRange(jaTem.linha, c.valor + 1).setValue(d.valor);
      return { ok: true, acao: 'excecao_atualizada', nome: d.nome, mes: mes, valor: d.valor };
    }
    var base = valorNoMes_(todos, d.nome, mes);
    aba.appendRow(linhaRecorrente_({
      nome: d.nome,
      tipo: d.tipo || (base && base.registro.tipo) || 'despesa',
      categoria: d.categoria || (base && base.registro.categoria) || 'Outros',
      valor: d.valor,
      dia: d.dia || (base && base.registro.dia) || '',
      inicio: mes, fim: mes, escopo: 'excecao',
      texto: d.texto_falado || ''
    }));
    return { ok: true, acao: 'excecao_criada', nome: d.nome, mes: mes, valor: d.valor };
  }

  // definir / encerrar: fecha a vigência aberta que existir.
  var abertas = todos.filter(function (r) {
    return chaveNome_(r.nome) === alvo && r.escopo !== 'excecao' && !r.fim && r.inicio <= mes;
  });

  abertas.forEach(function (r) {
    // Se a vigência começou neste mesmo mês, não faz sentido criar duas linhas
    // para o mesmo mês — corrige o valor da própria linha.
    if (r.inicio === mes && acao === 'definir') {
      aba.getRange(r.linha, c.valor + 1).setValue(d.valor);
      if (d.dia) aba.getRange(r.linha, c.dia + 1).setValue(d.dia);
      r.corrigida = true;
    } else {
      aba.getRange(r.linha, c.vigencia_fim + 1)
         .setValue(acao === 'encerrar' ? mes : mesAnterior_(mes));
    }
  });

  if (acao === 'encerrar') {
    return { ok: true, acao: 'encerrado', nome: d.nome, mes: mes };
  }

  if (abertas.some(function (r) { return r.corrigida; })) {
    return { ok: true, acao: 'valor_corrigido', nome: d.nome, mes: mes, valor: d.valor };
  }

  var anterior = abertas[0];
  aba.appendRow(linhaRecorrente_({
    nome: d.nome,
    tipo: d.tipo || (anterior && anterior.tipo) || 'despesa',
    categoria: d.categoria || (anterior && anterior.categoria) || 'Outros',
    valor: d.valor,
    dia: d.dia || (anterior && anterior.dia) || '',
    inicio: mes, fim: '', escopo: 'padrao',
    parcelas_total: d.parcelas_total || '',
    parcelas_restantes: d.parcelas_restantes || d.parcelas_total || '',
    texto: d.texto_falado || ''
  }));

  return {
    ok: true,
    acao: anterior ? 'valor_alterado' : 'criado',
    nome: d.nome, mes: mes, valor: d.valor,
    valor_anterior: anterior ? anterior.valor : null
  };
}

function linhaRecorrente_(r) {
  return [
    r.nome, r.tipo, r.categoria, r.valor, r.dia,
    r.inicio, r.fim, r.escopo,
    r.parcelas_total || '', r.parcelas_restantes || '',
    r.texto || '', new Date()
  ];
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
