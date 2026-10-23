/**
 * Finanças — Quanto Posso Gastar
 * Backend em Google Apps Script. Este script é o servidor do app:
 * ele grava na planilha, guarda as chaves e conversa com a API da Claude.
 *
 * Antes de publicar, rode a função `configurar()` uma vez (menu Executar).
 *
 * Seções, na ordem do arquivo (procure pelo nome):
 *   - Configuração
 *   - Instalação — rode uma vez
 *   - Entrada HTTP
 *   - Limites de uso
 *   - Gravar lançamentos
 *   - Interpretar com IA
 *   - Perguntar e simular
 *   - Reprocessar o que ficou pendente (gatilho horário)
 *   - Avisos por e-mail
 *   - Consultas
 *   - Faturas de cartão
 *   - Painel do mês
 *   - Editar e excluir lançamentos
 *   - Aprender categoria com a sua correção
 *   - Cadastros: contas, categorias, fontes e pessoas
 *   - Recorrentes: gastos e rendas que se repetem, com histórico de valores
 *   - Consertos manuais — rode uma vez no editor, se precisar
 */

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

// Suba junto com VERSAO_APP em src/lib/versao.js — o app compara as duas e
// avisa na tela quando só uma das metades foi publicada.
var VERSAO = '2.17.0';

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
    'conta', 'metodo', 'fonte', 'pessoa', 'fatura_mes', 'parcela_atual', 'parcelas_total',
    'texto_falado', 'origem', 'confianca', 'status', 'revisar', 'erro'
  ],
  // As carteiras de onde o dinheiro sai: bancos, cartões, benefícios, espécie.
  // Cartão de crédito tem ciclo: fecha num dia, vence noutro.
  // rende_tipo: '' (não rende), 'cdi' (rende_pct % do CDI, estimado todo dia)
  // ou 'extrato' (o banco mostra o rendimento; ele chega importando o extrato).
  contas: ['nome', 'tipo', 'pessoa', 'dia_fechamento', 'dia_vencimento', 'saldo_inicial', 'ativo',
           'rende_tipo', 'rende_pct'],
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
    'conta', 'metodo', 'pessoa',
    'vigencia_inicio', 'vigencia_fim', 'escopo',
    'parcelas_total', 'parcelas_restantes', 'texto_falado', 'criado_em'
  ],
  resumo_mensal: ['mes', 'categoria', 'tipo', 'total', 'lancamentos'],
  memoria: ['fato', 'origem', 'data', 'ativo'],
  // `analise_json` guarda a análise inteira (projeção, premissas, sugestões).
  // É o que permite reabrir uma resposta sem pagar outra chamada de IA — e
  // recuperar a última quando a resposta não chega no celular.
  conversas: ['data', 'pergunta', 'resposta', 'modelo', 'custo_estimado', 'analise_json'],
  // Caixinhas para guardar dinheiro. O que entra e sai de cada uma mora em
  // `lancamentos` (tipo guardar/resgatar, nome do baú na categoria).
  // rende_*: quanto o baú rende. tipo '' (não rende), 'cdi' (pct = % do CDI)
  // ou 'fixo' (pct = % ao ano). Com limite, o que passa dele rende `acima`.
  baus: ['nome', 'meta', 'objetivo', 'prazo', 'criado_em', 'ativo',
         'rende_tipo', 'rende_pct', 'rende_limite', 'rende_acima'],
  // Saldos conferidos com o banco: o ponto de partida do saldo de cada conta.
  // origem 'manual' (vale no momento em que foi digitado) ou 'extrato' (fim do
  // dia). `calculado` é o que o app achava naquela hora — dá a diferença.
  saldos: ['conta', 'data', 'saldo', 'origem', 'registrado_em', 'calculado']
};

// Status possíveis de um lançamento na planilha.
// Um lançamento é uma de três coisas. A terceira existe porque comprar no
// crédito não tira dinheiro da conta: cria dívida. Quem tira é o pagamento da
// fatura — e ele não pode contar como gasto de novo, senão dobra tudo.
var TIPO = {
  DESPESA: 'despesa',
  RECEITA: 'receita',
  FATURA: 'fatura',  // pagamento de fatura de cartão: sai do caixa, não é gasto novo
  GUARDAR: 'guardar',   // dinheiro que vai para um baú: sai do mês, mas não é gasto
  RESGATAR: 'resgatar',  // dinheiro que volta de um baú para o mês
  RENDIMENTO: 'rendimento'  // acerto com o banco: corrige o saldo do baú (+ ou −); não sai nem entra no mês
};

var STATUS = {
  OK: 'ok',                       // interpretado e confirmado
  AGUARDANDO_IA: 'aguardando_ia', // texto salvo, esperando a IA conseguir interpretar
  ERRO: 'erro',                   // a IA falhou de um jeito que precisa de você
  EXCLUIDO: 'excluido',           // você apagou pelo app: sai de tudo, mas a linha fica
  AGENDADO: 'agendado'            // renda marcada para uma data futura: não conta até você confirmar
};

// Gasto com data à frente conta no mês em que foi feito — a parcela de
// dezembro é gasto de dezembro, e isso não depende de nada acontecer.
// Dinheiro que entra é outra história: salário prometido não é salário
// recebido. Então receita com data futura nasce agendada e só vira dinheiro
// quando você diz que caiu.
function nasceAgendado_(l) {
  return (l.tipo || TIPO.DESPESA) === TIPO.RECEITA &&
         normalizarData_(l.data || hojeISO_()) > hojeISO_();
}

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
    ['Dinheiro', 'dinheiro', 'Fernando', '', '', 0, 'sim'],
    ['Itaú', 'credito', 'Fernando', '', '', 0, 'sim'],
    ['Santander', 'credito', 'Fernando', '', '', 0, 'sim'],
    ['Nubank May', 'credito', 'Mayara', '', '', 0, 'sim'],
    ['Caju', 'beneficio', 'Fernando', '', '', 0, 'sim'],
    ['Alimentação', 'beneficio', 'Fernando', '', '', 0, 'sim'],
    ['Amazon', 'credito', 'Fernando', '', '', 0, 'sim']
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
      case 'conversas':   return json_(conversas_(pedido));
      case 'excluir_conversa': return json_(excluirConversa_(pedido));
      case 'panorama':    return json_(panorama_(pedido));
      case 'categorias':  return json_(cadastros_());
      case 'cadastros':   return json_(cadastros_());
      case 'salvar_cadastro':  return json_(salvarCadastro_(pedido));
      case 'excluir_cadastro': return json_(excluirCadastro_(pedido));
      case 'lancamentos':      return json_(lancamentosDoMes_(pedido));
      case 'extrato':          return json_(extrato_(pedido));
      case 'conferir_importacao': return json_(conferirImportacao_(pedido));
      case 'vapid':            return json_(vapidPublica_());
      case 'inscrever':        return json_(inscrever_(pedido));
      case 'desinscrever':     return json_(desinscrever_(pedido));
      case 'avisos':           return json_(avisosDeHoje_());
      case 'testar_aviso':     return json_(testarAviso_(pedido));
      case 'editar_lancamento':  return json_(editarLancamento_(pedido));
      case 'excluir_lancamento': return json_(excluirLancamento_(pedido));
      case 'confirmar_recebimento': return json_(confirmarRecebimento_(pedido));
      case 'recorrentes':        return json_(recorrentes_(pedido));
      case 'salvar_recorrente':  return json_(salvarRecorrente_(pedido));
      case 'excluir_recorrente': return json_(excluirRecorrente_(pedido));
      case 'encerrar_recorrente':return json_(encerrarRecorrente_(pedido));
      case 'tornar_mensal':      return json_(tornarMensal_(pedido));
      case 'pagar_fixa':         return json_(pagarFixa_(pedido));
      case 'pagar_fatura':       return json_(pagarFatura_(pedido));
      case 'painel':      return json_(painel_(pedido));
      case 'salvar_meta': return json_(salvarMeta_(pedido));
      case 'conquistar':  return json_(conquistar_(pedido));
      case 'baus':        return json_(baus_());
      case 'contas_saldo':  return json_(contasSaldo_());
      case 'acertar_conta': return json_(acertarConta_(pedido));
      case 'nao_gastei':    return json_(naoGastei_(pedido));
      case 'relatorio_ano': return json_(relatorioAno_(pedido));
      case 'exportar':      return json_(exportar_());
      case 'resumo_ia':     return json_(resumoIA_(pedido));
      case 'salvar_bau':  return json_(salvarBau_(pedido));
      case 'excluir_bau': return json_(excluirBau_(pedido));
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

    var contas = indiceContas_();
    var novas = [], gravados = [], duplicados = [], aprendidos = [];
    lista.forEach(function (l) {
      if (!l.uuid) { l.uuid = Utilities.getUuid(); }
      if (existentes[l.uuid]) { duplicados.push(l.uuid); return; }
      if (ehBau_(l.tipo)) {
        l.categoria = String(l.categoria || 'Baú').trim() || 'Baú';
        l.repete = false;
        l.parcelas_total = '';
        l.aprender_categoria = false;
      }
      // Quem marca o uuid como visto é o laço das parcelas, logo abaixo — a
      // primeira parcela reusa o uuid da compra, e marcar aqui faria ela ser
      // confundida com uma duplicata e nada seria gravado.

      // Compra no crédito já nasce sabendo em qual fatura vai cair. Guardar o
      // carimbo na linha faz o histórico continuar certo mesmo que você mude o
      // ciclo do cartão depois.
      if (!l.fatura_mes && (l.tipo || 'despesa') === TIPO.DESPESA) {
        var conta = contas[chaveNome_(String(l.conta || ''))];
        if (ehCartao_(conta)) l.fatura_mes = mesDaFatura_(conta, l.data || hojeISO_());
      }

      // Você trocou a categoria que o app sugeriu: a descrição vira palavra-chave
      // da categoria certa, e a próxima frase igual já chega classificada.
      if (l.aprender_categoria) {
        // Do extrato do banco vem a palavra pronta ("elevar telecom"); à mão, a descrição.
        var a = aprenderCategoria_(l.palavra_chave || l.descricao, l.categoria);
        if (a) aprendidos.push(a);
      }

      // Compra parcelada vira uma linha por parcela.
      expandirParcelas_(l).forEach(function (p) {
        if (existentes[p.uuid]) { duplicados.push(p.uuid); return; }
        existentes[p.uuid] = true;
        novas.push(linhaDe_(p));
        gravados.push(p.uuid);
      });

      // Marcado como "repete todo mês" na hora de confirmar: além do gasto,
      // nasce a regra. Evita ter que voltar depois para transformá-lo em fixo.
      // Parcelamento não entra aqui: as parcelas já ocupam os meses seguintes,
      // e uma regra mensal por cima delas cobraria o mesmo gasto duas vezes.
      if (l.repete && !(Number(l.parcelas_total) > 1)) {
        try {
          aplicarRecorrente_({
            nome: l.descricao || l.categoria ||
                  ((l.tipo === TIPO.RECEITA) ? 'Renda mensal' : 'Conta fixa'),
            acao: 'definir',
            valor: Number(l.valor) || 0,
            tipo: l.tipo || TIPO.DESPESA,
            categoria: l.categoria ||
                       ((l.tipo === TIPO.RECEITA) ? 'Outras Entradas' : 'Outros'),
            dia: Number(String(l.data || hojeISO_()).slice(8, 10)) || '',
            conta: l.conta || '',
            pessoa: l.pessoa || '',
            mes: String(l.data || hojeISO_()).slice(0, 7),
            texto_falado: l.texto_falado || ''
          });
        } catch (err) { /* o gasto já está gravado; a regra pode ser criada à mão */ }
      }
    });

    if (novas.length) {
      aba.getRange(aba.getLastRow() + 1, 1, novas.length, ABAS.lancamentos.length).setValues(novas);
      atualizarResumo_();
    }
    return { ok: true, gravados: gravados, duplicados: duplicados, aprendidos: aprendidos };
  } finally {
    trava.releaseLock();
  }
}

/**
 * Uma compra em 5x não é um gasto de 200 em setembro: são cinco de 40, um por
 * mês — é assim que ela chega na fatura e é assim que ela pesa no seu mês. Por
 * isso a compra parcelada vira cinco linhas, uma por parcela, cada uma na data
 * e na fatura em que realmente cai. Somar o total no mês da compra faria
 * setembro parecer 160 reais pior do que foi, e os outros quatro meses
 * parecerem tranquilos.
 *
 * Os uuids das parcelas seguintes derivam do primeiro ("<uuid>-p2"), então
 * reenviar a mesma compra continua sem duplicar nada, e dá para achar as irmãs
 * de uma parcela sem inventar coluna nova na planilha.
 */
function expandirParcelas_(l) {
  var n = Math.round(Number(l.parcelas_total) || 0);
  var total = arred_(l.valor);
  if (n < 2 || !total) return [l];

  var parcela = arred_(total / n);
  // Os centavos que não dividem certo ficam na primeira, como o cartão faz.
  var primeira = arred_(total - parcela * (n - 1));

  var dataCompra = normalizarData_(l.data || hojeISO_());
  var faturaBase = l.fatura_mes ? normalizarMes_(l.fatura_mes) : '';
  var partes = [];

  for (var k = 0; k < n; k++) {
    var p = {};
    for (var campo in l) { if (l.hasOwnProperty(campo)) p[campo] = l[campo]; }
    p.uuid = k === 0 ? l.uuid : l.uuid + '-p' + (k + 1);
    p.valor = k === 0 ? primeira : parcela;
    p.data = somarMesesData_(dataCompra, k);
    p.parcela_atual = k + 1;
    p.parcelas_total = n;
    p.fatura_mes = faturaBase ? mesSomado_(faturaBase, k) : '';
    p.repete = false;
    partes.push(p);
  }
  return partes;
}

/** Todas as parcelas de uma compra compartilham este prefixo. */
function grupoDoUuid_(uuid) {
  var u = String(uuid || '');
  // A importação de compras antigas numera as parcelas de outro jeito
  // ("imp-monitor-04" em vez de "<uuid>-p4"). Sem reconhecer os dois formatos,
  // cada parcela importada virava uma compra sozinha: o monitor em 18x
  // aparecia como dezoito compras de uma parcela, todas dizendo "falta 1".
  if (u.indexOf('imp-') === 0) return u.replace(/-\d+$/, '');
  return u.replace(/-p\d+$/, '');
}

function ehDoGrupo_(uuid, base) {
  return grupoDoUuid_(uuid) === base;
}

/** "2026-11" três meses depois de "2026-08"; aceita n negativo. */
function mesSomado_(mes, n) {
  var ano = Number(String(mes).slice(0, 4));
  var m = Number(String(mes).slice(5, 7)) - 1 + Number(n || 0);
  ano += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12 + 1;
  return ano + '-' + (m < 10 ? '0' + m : String(m));
}

/** Mesmo dia n meses depois; dia 31 em mês curto encosta no último dia. */
function somarMesesData_(dataISO, n) {
  var alvo = mesSomado_(String(dataISO).slice(0, 7), n);
  var dia = Number(String(dataISO).slice(8, 10)) || 1;
  var ultimo = new Date(Number(alvo.slice(0, 4)), Number(alvo.slice(5, 7)), 0).getDate();
  var d = Math.min(dia, ultimo);
  return alvo + '-' + (d < 10 ? '0' + d : String(d));
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
    l.fatura_mes || '',
    l.parcela_atual || '',
    l.parcelas_total || '',
    l.texto_falado || '',
    l.origem || 'voz',
    l.confianca || '',
    l.status || (nasceAgendado_(l) ? STATUS.AGENDADO : STATUS.OK),
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

// ---------------------------------------------------------------------------
// Importar extrato: o que do arquivo do banco já está na planilha
// ---------------------------------------------------------------------------

var MAX_IMPORTAR = 600;
var DIAS_PARECIDO = 3;

/**
 * Recebe os movimentos lidos do extrato ({ id, data, valor (sem sinal), tipo })
 * e diz: quais já foram importados antes (o id vira uuid) e quais parecem já
 * ter sido lançados à mão — mesmo tipo, mesmo valor, até 3 dias de diferença.
 * Cada lançamento da planilha só "explica" um movimento (o mais perto na data).
 * O tipo "fora" (fatura, transferência) é comparado com pagamentos de fatura.
 */
function conferirImportacao_(pedido) {
  var lista = (pedido.movimentos || []).slice(0, MAX_IMPORTAR);
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var existentes = uuidsExistentes_(aba);
  var importados = [];
  var pendentes = [];
  lista.forEach(function (m) {
    if (existentes[String(m.id)]) importados.push(m.id);
    else pendentes.push(m);
  });
  if (!pendentes.length) return { ok: true, importados: importados, parecidos: {} };

  var datas = pendentes.map(function (m) { return String(m.data || ''); }).filter(Boolean).sort();
  var de = diaISOMais_(datas[0], -DIAS_PARECIDO), ate = diaISOMais_(datas[datas.length - 1], DIAS_PARECIDO);
  var col = indiceColunas_();
  var n = aba.getLastRow() - 1;
  var candidatos = [];
  if (n > 0) {
    aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues().forEach(function (r) {
      if (r[col.status] === STATUS.EXCLUIDO) return;
      var data = normalizarData_(r[col.data]);
      if (!data || data < de || data > ate) return;
      candidatos.push({ uuid: r[col.uuid], data: data, tipo: r[col.tipo] || TIPO.DESPESA,
        valor: Math.abs(Number(r[col.valor]) || 0), descricao: r[col.descricao] || '', categoria: r[col.categoria] || '',
        usado: false });
    });
  }
  var tipoQueCombina = function (t) { return t === 'fora' ? TIPO.FATURA : t; };
  var parecidos = {};
  pendentes.forEach(function (m) {
    var alvo = tipoQueCombina(m.tipo || TIPO.DESPESA);
    var valor = Math.abs(Number(m.valor) || 0);
    var melhor = null, dist = 99;
    candidatos.forEach(function (c) {
      if (c.usado || c.tipo !== alvo || Math.abs(c.valor - valor) > 0.009) return;
      var d = Math.abs(diasEntre_(c.data, m.data));
      if (d <= DIAS_PARECIDO && d < dist) { melhor = c; dist = d; }
    });
    if (melhor) {
      melhor.usado = true;
      parecidos[m.id] = { uuid: melhor.uuid, data: melhor.data, descricao: melhor.descricao, categoria: melhor.categoria };
    }
  });
  return { ok: true, importados: importados, parecidos: parecidos };
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
    // Confirmado por você, então não fica esperando IA — mas renda marcada para
    // uma data à frente continua agendada, porque confirmar o lançamento não é
    // o mesmo que o dinheiro ter caído.
    l.status = nasceAgendado_(l) ? STATUS.AGENDADO : STATUS.OK;
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
    '"tipo":"despesa|receita","categoria":string,"dia":number|null,"mes":"YYYY-MM",' +
    '"mes_fim":"YYYY-MM"|null,"conta":string,"metodo":"pix|credito|debito|dinheiro|boleto|",' +
    '"pessoa":string}],\n' +
    ' "memoria":[string],\n' +
    ' "cadastros":[{"tipo":"contas|categorias|fontes|pessoas","acao":"salvar|excluir",' +
    '"nome":string,"nome_antigo":string|null,"pessoa":string|null,' +
    '"tipo_item":string|null,"grupo":string|null}],\n' +
    ' "resumo":string}\n\n' +

    'Regras:\n' +
    '- "resumo" é uma frase curta em português dizendo o que você entendeu, para a pessoa confirmar.\n' +
    '- Em "recorrentes", "nome" é o nome que a PESSOA usou na frase: "Caju" vira "Caju",\n' +
    '  não "Vale Alimentação"; "consórcio" vira "Consórcio", não "Financiamento". Nunca\n' +
    '  troque por sinônimo, categoria ou marca equivalente. Reusar o nome de um compromisso\n' +
    '  já cadastrado SOBRESCREVE o valor dele, então só faça isso quando a frase falar\n' +
    '  claramente do mesmo compromisso da lista. Na dúvida, nome novo.\n' +
    '- Em "excecao", "mes" é o mês a que a frase se refere; se ela disser "esse mês", use ' + mes + '.\n' +
    '- "mes" é SEMPRE quando a regra começa a valer — para "definir", use ' + mes + ' salvo\n' +
    '  se a frase disser outra data de início. Prazo final vai em "mes_fim", nunca em "mes":\n' +
    '  "todo mês até 10/03/2029" -> acao definir, mes ' + mes + ', dia 10, mes_fim "2029-03".\n' +
    '- Uma frase pode conter mais de um lançamento; devolva um item por lançamento.\n' +
    '- Em parcelamento, "valor" é o valor TOTAL da compra e parcelas_total o número de parcelas.\n' +
    '- Se a categoria não se encaixar em nenhuma da lista, use "Outros" (despesa) ou "Outras Entradas" (receita).\n' +
    '- Datas relativas ("ontem", "sexta passada") devem virar data absoluta.\n' +
    '- "conta" é de onde o dinheiro saiu ou entrou, e SÓ pode ser um nome da lista acima.\n' +
    '  Case pelo nome falado, mesmo abreviado ("nubank da May" -> "Nubank May",\n' +
    '  "vale" ou "alimentação" -> o cartão de benefício). Se a frase não identificar a conta,\n' +
    '  deixe "" — nunca invente uma conta nova e nunca cadastre uma.\n' +
    '- pix, crédito, débito, dinheiro e boleto são MÉTODO, jamais conta. "paguei no pix"\n' +
    '  significa metodo "pix" e conta "".\n' +
    '- Quando os dois aparecem juntos, separe: "no cartão de crédito Santander" é\n' +
    '  conta "Santander" e metodo "credito". Isso vale também em "recorrentes" —\n' +
    '  um compromisso fixo guarda de qual conta ele sai e por qual método.\n' +
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

  meses.forEach(function (k) { porMes[k] = { mes: k, receitas: 0, despesas: 0, guardado: 0, lancamentos: 0 }; });

  if (n > 0) {
    aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues().forEach(function (r) {
      if (r[col.status] !== STATUS.OK) return;
      var k = normalizarData_(r[col.data]).slice(0, 7);
      if (!porMes[k]) return;
      var v = Number(r[col.valor]) || 0;
      // Pagamento de fatura não é gasto novo (as compras já contaram) e baú
      // não é gasto nem renda: sem isso a análise via gasto em dobro.
      if (r[col.tipo] === TIPO.FATURA) return;
      if (ehBau_(r[col.tipo])) { porMes[k].guardado += sinalBau_(r[col.tipo]) * v; return; }
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
    // Doze meses de calendário real: é o que a IA deve usar para projetar.
    previsao_12m: previsao12_(),
    baus: bausResumo_(),
    // O saldo de verdade de cada conta (conferido com o banco + o que veio depois).
    saldos_contas: contasResumo_(),
    memoria: lerMemoria_()
  };
}

/**
 * Doze meses à frente, mês a mês, com tudo que já está marcado no calendário.
 *
 * A projeção da IA era "repete o mês atual", e isso ignorava justamente o que
 * dá previsibilidade: uma renda que começa em outubro, uma conta fixa que
 * termina em dezembro, as parcelas que ainda vão cair e os recebimentos já
 * agendados. Aqui a aritmética é feita em código, com as mesmas regras da tela
 * Mês — vigências dos recorrentes, cruzamento com o que já foi lançado (para
 * não contar duas vezes) e os lançamentos futuros que já existem na planilha.
 */
function previsao12_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  var col = indiceColunas_();
  var todos = lerRecorrentes_();
  var hoje = mesAtual_();

  var saida = [];
  for (var i = 0; i < 12; i++) {
    var mes = mesSomado_(hoje, i);

    // O que já está gravado para este mês: parcelas que vão cair, compras
    // futuras, rendas agendadas. 'ok' é fato ou parcela marcada; 'agendado' é
    // dinheiro previsto que ainda não caiu.
    var despesasLancadas = lancamentosDoMesCru_(mes, col, aba, n, TIPO.DESPESA)
      .concat(lancamentosDoMesCru_(mes, col, aba, n, TIPO.DESPESA, STATUS.AGENDADO));
    var receitasLancadas = lancamentosDoMesCru_(mes, col, aba, n, TIPO.RECEITA)
      .concat(lancamentosDoMesCru_(mes, col, aba, n, TIPO.RECEITA, STATUS.AGENDADO));

    // As regras mensais que valem NESTE mês (cada uma no valor da vigência dele).
    var fixos = compromissosDoMes_(todos, mes);
    var fixasDespesa = cruzarCompromissos_(
      fixos.filter(function (r) { return r.tipo !== TIPO.RECEITA; }), despesasLancadas);
    var fixasReceita = cruzarCompromissos_(
      fixos.filter(function (r) { return r.tipo === TIPO.RECEITA; }), receitasLancadas);

    // Só entra o que ainda não virou lançamento — senão a conta fixa já paga
    // seria somada duas vezes.
    var somar = function (lista) {
      return lista.reduce(function (a, c) { return a + (Number(c.valor) || 0); }, 0);
    };
    var faltaPagar = somar(fixasDespesa.filter(function (f) { return !f.lancado; }));
    var faltaReceber = somar(fixasReceita.filter(function (f) { return !f.lancado; }));

    var entra = arred_(somar(receitasLancadas) + faltaReceber);
    var sai = arred_(somar(despesasLancadas) + faltaPagar);

    saida.push({
      mes: mes,
      entra: entra,
      sai: sai,
      sobra: arred_(entra - sai),
      ja_lancado_entra: arred_(somar(receitasLancadas)),
      ja_lancado_sai: arred_(somar(despesasLancadas)),
      fixas_a_receber: arred_(faltaReceber),
      fixas_a_pagar: arred_(faltaPagar)
    });
  }
  return saida;
}

function lerContasCompletas_() {
  return lerCadastro_('contas')
    .filter(function (c) { return c.ativo; })
    .map(function (c) {
      return {
        nome: c.nome, tipo: c.tipo, pessoa: c.pessoa,
        dia_fechamento: Number(c.dia_fechamento) || 0,
        dia_vencimento: Number(c.dia_vencimento) || 0,
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
    'PREVISAO_12M é o calendário real dele, mês a mês: já inclui as rendas e as contas\n' +
    'fixas que valem em cada mês (com começo e fim de vigência), as parcelas que ainda\n' +
    'vão cair e os recebimentos agendados. Use "entra" e "sai" de cada mês como base da\n' +
    'sua projeção — não repita o mês atual doze vezes. Se uma renda só começa em algum\n' +
    'mês, ou uma parcela acaba, isso já está lá e você deve comentar quando for relevante.\n' +
    'Os gastos variáveis NÃO estão em PREVISAO_12M: some sua estimativa deles por fora e\n' +
    'diga em "premissas" quanto assumiu.\n\n' +
    'Quando faltar um dado, assuma algo razoável e DIGA que assumiu, em "premissas".\n\n' +

    'Se a pergunta for sobre assumir um novo compromisso (uma parcela, uma assinatura,\n' +
    'um financiamento), projete 12 meses com e sem ele, e deixe claro o que sobra nos dois casos.\n\n' +

    'Sobre o veredito, seja honesto e não otimista: "confortavel" só se a sobra projetada\n' +
    'aguentar o compromisso e ainda deixar folga; "apertado" se couber mas sem margem;\n' +
    '"arriscado" se comprometer mais do que sobra, ou se os dados forem poucos demais\n' +
    'para afirmar qualquer coisa (nesse caso diga isso na resposta).\n\n' +

    'Responda SOMENTE com um objeto JSON, sem markdown e sem nenhuma palavra antes ou depois.\n' +
    'Comece a resposta no "{" e termine no "}".\n' +
    'Seja econômico: o texto todo cabe em poucos parágrafos e as listas são curtas.\n' +
    '{"resposta": string (2 a 4 parágrafos curtos, texto puro, sem títulos),\n' +
    ' "veredito": "confortavel|apertado|arriscado",\n' +
    ' "compromisso_mensal": number|null (a parcela perguntada, se houver),\n' +
    ' "premissas": [string],\n' +
    ' "sugestoes": [string] (2 a 3, concretas e ligadas aos números dele, uma linha cada),\n' +
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
    'PREVISAO_12M (calendário já marcado, sem os gastos variáveis):\n' +
    JSON.stringify(p.previsao_12m) + '\n\n' +
    'O QUE ELE JÁ ME CONTOU:\n' + (p.memoria.length ? p.memoria.join('\n') : '(nada ainda)') + '\n\n' +
    (historico.length
      ? 'CONVERSAS ANTERIORES:\n' + historico.map(function (h) {
          return 'P: ' + h.pergunta + '\nR: ' + String(h.resposta).slice(0, 600);
        }).join('\n\n') + '\n\n'
      : '') +
    (pedido.analise_anterior
      ? 'ESTA PERGUNTA CONTINUA A ANÁLISE ABAIXO. Use os mesmos números e premissas dela;\n' +
        'só recalcule o que a nova pergunta mudar, e diga o que mudou.\n' +
        JSON.stringify(pedido.analise_anterior).slice(0, 12000) + '\n\n'
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
        // A análise devolve texto + 12 meses de projeção + sugestões + premissas.
        // Com 3000 o modelo batia no teto e o JSON vinha cortado no meio de uma
        // string — era isso, e não a rede, que dava "Unexpected end of JSON input".
        max_tokens: 8000,
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

    // O modelo parou porque bateu o teto de tokens? Então o JSON está cortado
    // e não adianta tentar interpretar: é melhor dizer isso com todas as letras.
    if (dados.stop_reason === 'max_tokens') {
      return {
        ok: false, erro: 'resposta_cortada',
        detalhe: 'A análise passou do tamanho máximo. Faça uma pergunta mais específica.'
      };
    }

    var saida = (dados.content || []).map(function (b) { return b.text || ''; }).join('').trim();
    saida = saida.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    saida = recomporJson_(saida);
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
    return { ok: false, erro: 'analise_ilegivel', detalhe: String(err && err.message || err) };
  }
}

/**
 * Devolve só o objeto JSON da resposta do modelo.
 *
 * Rede de segurança: o normal é vir o objeto limpo, mas se escapar uma frase
 * em volta dá para aproveitar o JSON mesmo assim. A ordem dos testes importa:
 * procurar '{' primeiro pegaria a chave de dentro da projeção.
 */
function recomporJson_(texto) {
  var t = String(texto || '').trim();
  if (t.charAt(0) === '{') return t.slice(0, t.lastIndexOf('}') + 1);
  if (t.charAt(0) === '"') return '{' + t.slice(0, t.lastIndexOf('}') + 1);
  var abre = t.indexOf('{');
  return abre >= 0 ? t.slice(abre, t.lastIndexOf('}') + 1) : t;
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
  var inteira = '';
  // Uma célula do Sheets guarda até 50 mil caracteres. Se a análise passar
  // disso, a linha continua valendo pelo texto — só não dá para reabrir o
  // gráfico dela.
  try {
    inteira = JSON.stringify(analise);
    if (inteira.length > 45000) inteira = '';
  } catch (err) { inteira = ''; }

  aba.appendRow([
    new Date(), pergunta,
    String(analise.resposta || '').slice(0, 20000),
    MODELO_ANALISAR, custo, inteira
  ]);
}

/**
 * As últimas conversas, com a análise inteira quando ela coube na célula.
 * Serve para dois casos: reabrir uma resposta antiga e recuperar a última
 * quando o celular perdeu a resposta no meio do caminho.
 */
function conversas_(pedido) {
  var limite = Math.min(Math.max(Number(pedido && pedido.limite) || 1, 1), 30);
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('conversas');
  if (!aba) return { ok: true, conversas: [] };
  var n = aba.getLastRow() - 1;
  if (n <= 0) return { ok: true, conversas: [] };

  var qtd = Math.min(limite, n);
  var inicio = n + 2 - qtd;
  var linhas = aba.getRange(inicio, 1, qtd, ABAS.conversas.length).getValues();

  var saida = linhas.map(function (r) {
    var analise = null;
    try { analise = r[5] ? JSON.parse(r[5]) : null; } catch (err) { analise = null; }
    return {
      data: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || ''),
      pergunta: String(r[1] || ''),
      resposta: String(r[2] || ''),
      custo_estimado: Number(r[4]) || 0,
      analise: analise
    };
  });

  saida.reverse();   // a mais recente primeiro, que é como a tela mostra
  return { ok: true, conversas: saida };
}

function lerConversas_(quantas) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('conversas');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return [];
  var inicio = Math.max(2, n + 2 - quantas);
  var qtd = Math.min(quantas, n);
  return aba.getRange(inicio, 1, qtd, ABAS.conversas.length).getValues().map(function (r) {
    return { data: r[0], pergunta: r[1], resposta: r[2] };
  });
}

/**
 * Apaga uma conversa pela data exata (é o que a tela tem em mãos). Some da
 * planilha e some do contexto das próximas perguntas — é como você limpa um
 * teste que não quer mais ver.
 */
function excluirConversa_(pedido) {
  var alvo = String(pedido && pedido.data || '');
  if (!alvo) return { ok: false, erro: 'data_faltando' };

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('conversas');
  var n = aba ? aba.getLastRow() - 1 : 0;
  if (n <= 0) return { ok: false, erro: 'nao_encontrado' };

  var datas = aba.getRange(2, 1, n, 1).getValues();
  for (var i = n - 1; i >= 0; i--) {
    var d = datas[i][0];
    var iso = d instanceof Date ? d.toISOString() : String(d || '');
    if (iso === alvo) {
      aba.deleteRow(i + 2);
      return { ok: true, data: alvo };
    }
  }
  return { ok: false, erro: 'nao_encontrado' };
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
  rendimentoDoDia_();
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
    if (r[col.tipo] === TIPO.FATURA) return; // já contado nas compras
    if (ehBau_(r[col.tipo])) return;          // guardar não é gasto, resgatar não é renda
    var data = normalizarData_(r[col.data]);
    if (data.indexOf(mes) !== 0) return;
    var valor = Number(r[col.valor]) || 0;
    if (r[col.tipo] === TIPO.RECEITA) saida.receitas += valor;
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

  // "Últimos lançamentos" é o que aconteceu por último, não o que está no fim da
  // planilha. Desde que compra parcelada virou uma linha por mês, o fim da
  // planilha guarda parcelas de 2027 — ordenar pela data é o que faz sentido.
  var recentes = [];
  linhas.forEach(function (r, i) {
    if (r[col.status] === STATUS.EXCLUIDO) return;
    var data = normalizarData_(r[col.data]);
    if (data > hojeISO_()) return;                     // parcela futura não é "último"
    recentes.push({
      uuid: r[col.uuid], data: data, tipo: r[col.tipo],
      valor: Number(r[col.valor]) || 0, categoria: r[col.categoria],
      descricao: r[col.descricao], status: r[col.status], pessoa: r[col.pessoa] || '',
      _ordem: ordemDe_(data, r[col.hora_registro], i)
    });
  });
  saida.ultimos = ordenarDoMaisNovo_(recentes).slice(0, 12);

  return saida;
}

function normalizarData_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, fuso_(), 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

/**
 * Todas as categorias, ativas e desativadas, com os campos crus (para a tela de
 * cadastros poder editar e reativar) e os derivados (para quem interpreta fala).
 */
function categoriasTodas_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('categorias');
  if (!aba) return [];
  var n = aba.getLastRow() - 1;
  if (n <= 0) return [];
  return aba.getRange(2, 1, n, 6).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return {
        categoria: r[0], grupo: r[1], tipo: r[2],
        palavras_chave: r[3],
        orcamento_mes: r[4],
        palavras: String(r[3] || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean),
        orcamento: Number(r[4]) || 0,
        ativo: r[5] !== 'não' && r[5] !== false
      };
    });
}

/** Só as que estão valendo — é o que o parser e a IA podem sugerir. */
function lerCategorias_() {
  return categoriasTodas_().filter(function (c) { return c.ativo; });
}

// ---------------------------------------------------------------------------
// Faturas de cartão
// ---------------------------------------------------------------------------
//
// Comprar no crédito não tira dinheiro da conta — cria dívida. O dinheiro sai
// quando a fatura é paga. Misturar as duas coisas é o erro que faz um app de
// finanças dizer que você tem menos do que tem, e depois não avisar da fatura.
//
// Então cada compra no crédito é carimbada com o mês em que a fatura dela vence,
// e o painel passa a ter dois números: o que você GASTOU e o que SAIU do bolso.

/** Índice das contas por nome, para não reler a aba a cada lançamento. */
function indiceContas_() {
  var mapa = {};
  lerCadastro_('contas').forEach(function (c) {
    mapa[chaveNome_(c.nome)] = {
      nome: c.nome,
      tipo: String(c.tipo || '').toLowerCase(),
      pessoa: c.pessoa,
      fechamento: Number(c.dia_fechamento) || 0,
      vencimento: Number(c.dia_vencimento) || 0
    };
  });
  return mapa;
}

function ehCartao_(conta) {
  return Boolean(conta && conta.tipo === 'credito');
}

/**
 * Em que mês vence a fatura que engole uma compra feita nesta data.
 *
 * Comprou até o dia do fechamento, entra na fatura que fecha neste mês; depois
 * dele, na do mês seguinte. E a fatura que fecha num mês vence nele mesmo
 * quando o vencimento cai depois do fechamento — senão, no mês seguinte.
 */
function mesDaFatura_(cartao, dataISO) {
  if (!cartao || !cartao.vencimento) return '';
  var mes = String(dataISO).slice(0, 7);
  var dia = Number(String(dataISO).slice(8, 10)) || 1;

  var F = cartao.fechamento;
  var mesFecha = (F && dia > F) ? mesSeguinte_(mes) : mes;

  // Sem dia de fechamento, assumo que fecha no fim do mês e vence no seguinte.
  if (!F) return mesSeguinte_(mesFecha);
  return cartao.vencimento > F ? mesFecha : mesSeguinte_(mesFecha);
}

/**
 * As faturas que vencem num mês: quanto cada cartão acumulou e se já foi paga.
 * Precisa varrer todos os lançamentos, não só os do mês, porque a fatura de
 * outubro é feita de compras de setembro.
 */
function faturasDoMes_(mes, contas, linhas, col) {
  var porCartao = {};

  linhas.forEach(function (r) {
    if (r[col.status] !== STATUS.OK) return;

    var nomeConta = String(r[col.conta] || '');
    var conta = contas[chaveNome_(nomeConta)];

    // Pagamento de fatura: marca aquela fatura como quitada.
    if (r[col.tipo] === TIPO.FATURA) {
      var alvoMes = normalizarMes_(r[col.fatura_mes]);
      var alvoCartao = String(r[col.categoria] || '');
      if (alvoMes !== mes || !alvoCartao) return;
      var kp = chaveNome_(alvoCartao);
      if (!porCartao[kp]) porCartao[kp] = novaFatura_(alvoCartao);
      porCartao[kp].pago = true;
      porCartao[kp].valor_pago = arred_((porCartao[kp].valor_pago || 0) + (Number(r[col.valor]) || 0));
      porCartao[kp].uuid_pagamento = r[col.uuid];
      porCartao[kp].pago_em = normalizarData_(r[col.data]);
      return;
    }

    if (r[col.tipo] !== TIPO.DESPESA) return;
    if (!ehCartao_(conta)) return;

    // O carimbo gravado na linha manda; se não houver, calcula pela data.
    var mesFatura = normalizarMes_(r[col.fatura_mes]) ||
                    mesDaFatura_(conta, normalizarData_(r[col.data]));
    if (mesFatura !== mes) return;

    var k = chaveNome_(conta.nome);
    if (!porCartao[k]) porCartao[k] = novaFatura_(conta.nome);
    porCartao[k].total += Number(r[col.valor]) || 0;
    porCartao[k].lancamentos++;
    porCartao[k].dia = conta.vencimento;
    porCartao[k].pessoa = conta.pessoa;
  });

  return Object.keys(porCartao)
    .map(function (k) {
      var f = porCartao[k];
      f.total = arred_(f.total);
      f.mes = mes;
      f.fecha_em = fechamentoDaFatura_(contas[chaveNome_(f.cartao)], mes);
      // Fatura paga é fatura fechada, não importa o calendário.
      f.aberta = !f.pago && Boolean(f.fecha_em) && f.fecha_em > hojeISO_();
      return f;
    })
    .filter(function (f) { return f.total > 0 || f.pago; })
    .sort(function (a, b) { return (a.dia || 99) - (b.dia || 99); });
}

/**
 * A próxima fatura de cada cartão — a que está sendo formada agora.
 *
 * Você compra no Itaú hoje e não vê nada: a fatura dessa compra só vence mês
 * que vem, e a seção de faturas do mês só mostra as que vencem agora. O
 * dinheiro está comprometido e a tela não dizia. Isto resolve, sem misturar
 * com o que você tem que pagar neste mês.
 */
function faturasEmFormacao_(mes, contas, linhas, col) {
  var porChave = {};

  linhas.forEach(function (r) {
    if (r[col.status] !== STATUS.OK) return;
    if (r[col.tipo] !== TIPO.DESPESA) return;

    var conta = contas[chaveNome_(String(r[col.conta] || ''))];
    if (!ehCartao_(conta)) return;

    var mesFatura = normalizarMes_(r[col.fatura_mes]) ||
                    mesDaFatura_(conta, normalizarData_(r[col.data]));
    if (!mesFatura || mesFatura <= mes) return;

    var k = chaveNome_(conta.nome) + '|' + mesFatura;
    if (!porChave[k]) {
      porChave[k] = {
        cartao: conta.nome, mes: mesFatura, dia: conta.vencimento,
        pessoa: conta.pessoa, total: 0, lancamentos: 0,
        aberta: true, pago: false,
        fecha_em: fechamentoDaFatura_(conta, mesFatura)
      };
    }
    porChave[k].total += Number(r[col.valor]) || 0;
    porChave[k].lancamentos++;
  });

  // Só a próxima de cada cartão: as de 2027 do parcelamento longo são história
  // para outro dia, e encheriam a tela sem ajudar a decidir nada hoje.
  var proxima = {};
  Object.keys(porChave).forEach(function (k) {
    var f = porChave[k];
    var atual = proxima[chaveNome_(f.cartao)];
    if (!atual || f.mes < atual.mes) proxima[chaveNome_(f.cartao)] = f;
  });

  return Object.keys(proxima)
    .map(function (k) { proxima[k].total = arred_(proxima[k].total); return proxima[k]; })
    .filter(function (f) { return f.total > 0; })
    .sort(function (a, b) { return a.mes < b.mes ? -1 : (a.mes > b.mes ? 1 : (a.dia || 99) - (b.dia || 99)); });
}

function novaFatura_(cartao) {
  return {
    cartao: cartao, total: 0, lancamentos: 0, dia: 0, pessoa: '',
    pago: false, valor_pago: 0, uuid_pagamento: '', pago_em: '',
    aberta: false, fecha_em: ''
  };
}

/**
 * O dia em que a fatura de um mês fecha.
 *
 * Enquanto não fecha, ela ainda aceita compras — não é uma conta a pagar, é uma
 * conta crescendo. A do Santander vence dia 30 mas fecha dia 24: no dia 16 ela
 * está no mesmo estado das faturas de outubro, e mostrá-la como "a pagar" só
 * porque vence neste mês diz que existe uma dívida fechada que ainda não existe.
 */
function fechamentoDaFatura_(cartao, mesFatura) {
  if (!cartao || !mesFatura) return '';
  var F = cartao.fechamento;

  // Sem dia de fechamento, a regra do app é: fecha no fim do mês anterior.
  if (!F) {
    var anterior = mesAnterior_(mesFatura);
    var ultimo = new Date(Number(anterior.slice(0, 4)), Number(anterior.slice(5, 7)), 0).getDate();
    return anterior + '-' + ultimo;
  }

  // Vencimento depois do fechamento: fecha no próprio mês da fatura.
  var mes = cartao.vencimento > F ? mesFatura : mesAnterior_(mesFatura);
  var ultimoDia = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
  var dia = Math.min(F, ultimoDia);
  return mes + '-' + (dia < 10 ? '0' + dia : String(dia));
}

/**
 * Registra o pagamento de uma fatura: aqui sim o dinheiro sai da conta.
 * O lançamento entra com tipo `fatura`, que é somado ao caixa e ignorado
 * nos gastos por categoria — as compras que formaram a fatura já foram contadas.
 */
function pagarFatura_(pedido) {
  var cartao = String(pedido.cartao || '').trim();
  var mes = normalizarMes_(pedido.mes);
  if (!cartao || !mes) return { ok: false, erro: 'fatura_incompleta' };

  var lancamento = {
    uuid: pedido.uuid || Utilities.getUuid(),
    data: pedido.data || hojeISO_(),
    tipo: TIPO.FATURA,
    valor: Number(pedido.valor) || 0,
    categoria: cartao,
    descricao: pedido.descricao || ('Fatura ' + cartao + ' ' + mes),
    conta: pedido.conta || '',
    metodo: pedido.metodo || '',
    pessoa: pedido.pessoa || '',
    fatura_mes: mes,
    origem: 'fatura',
    confianca: 'fatura',
    status: STATUS.OK
  };

  if (!lancamento.valor) return { ok: false, erro: 'valor_zerado' };

  var r = lancar_({ lancamentos: [lancamento] });
  if (!r.gravados || !r.gravados.length) return { ok: false, erro: 'nao_gravou' };
  return { ok: true, gravados: r.gravados, lancamento: lancamento };
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
  rendimentoDoDia_();   // o que as contas renderam até ontem já entra como renda

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  var col = indiceColunas_();

  // A linha do tempo: seis meses para trás e seis para a frente. O passado é o
  // que aconteceu; o futuro é o que já está comprometido — parcelas que vão
  // cair, contas que se repetem, salários que costumam entrar. São duas coisas
  // diferentes e por isso viajam em campos separados, para a tela poder
  // desenhar cada uma do seu jeito.
  // A janela vai muito além do que cabe na tela de propósito: o gráfico mostra
  // doze meses por vez e o usuário caminha com as setas, sem esperar a planilha
  // de novo a cada passo. Dezoito meses à frente cobrem o parcelamento mais
  // longo que existe hoje.
  var meses = [];
  var m = mes;
  for (var i = 0; i < 12; i++) { meses.unshift(m); m = mesAnterior_(m); }
  m = mes;
  for (var f = 0; f < 18; f++) { m = mesSeguinte_(m); meses.push(m); }

  var serie = {};
  meses.forEach(function (k) {
    serie[k] = { mes: k, receitas: 0, despesas: 0, receitas_previstas: 0, despesas_previstas: 0, guardado: 0 };
  });

  var mesHoje = mesAtual_();

  var totais = { receitas: 0, despesas: 0, lancamentos: 0, credito: 0, caixa: 0, guardado: 0 };
  var porCategoria = {}, porConta = {}, porPessoa = {}, porFonte = {}, porGrupo = {};
  var porDia = {};
  var saldoBaus = 0;
  // Quem guardou quanto neste mês (a missão em dupla). '' = lançamento sem dono.
  var guardadoPorPessoa = {};
  // Gasto livre de hoje: o que saiu hoje e NÃO estava previsto. Conta fixa paga
  // e parcela de compra antiga já estavam reservadas na previsão — pagar o
  // aluguel hoje não pode zerar o "ouro de hoje".
  var hoje = hojeISO_();
  var gastoLivreHoje = 0;

  var grupoDe = {};
  // Inclui as desativadas: lançamento antigo continua no grupo em que nasceu.
  categoriasTodas_().forEach(function (c) { grupoDe[chaveNome_(c.categoria)] = c.grupo || 'Outros'; });

  var contas = indiceContas_();
  var linhas = n > 0 ? aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues() : [];

  var agendadosPorMes = {};

  linhas.forEach(function (r) {
    var data = normalizarData_(r[col.data]);
    var mesLinha = data.slice(0, 7);
    var valor = Number(r[col.valor]) || 0;
    var tipo = r[col.tipo];

    // Baú: guardar não é gasto e resgatar não é renda. O dinheiro sai (ou
    // volta) do mês e é contado à parte: total dos baús e guardado do mês.
    if (ehBau_(tipo)) {
      if (r[col.status] !== STATUS.OK) return;
      // Acerto com o banco: muda o saldo do baú, não o dinheiro do mês.
      if (tipo === TIPO.RENDIMENTO) { saldoBaus += valor; return; }
      var s = sinalBau_(tipo) * valor;
      saldoBaus += s;
      if (serie[mesLinha]) serie[mesLinha].guardado += s;
      if (mesLinha === mes) {
        totais.guardado += s; totais.caixa += s;
        somar_(guardadoPorPessoa, String(r[col.pessoa] || '').trim(), s);
      }
      return;
    }

    // Renda agendada é previsão, não caixa: entra na linha pontilhada do gráfico.
    if (r[col.status] === STATUS.AGENDADO) {
      if (tipo === TIPO.RECEITA) {
        if (serie[mesLinha]) serie[mesLinha].receitas_previstas += valor;
        if (!agendadosPorMes[mesLinha]) agendadosPorMes[mesLinha] = [];
        agendadosPorMes[mesLinha].push(chaveNome_(r[col.descricao]));
      }
      return;
    }

    if (r[col.status] !== STATUS.OK) return;
    var conta = contas[chaveNome_(String(r[col.conta] || ''))];
    var noCredito = tipo === TIPO.DESPESA && ehCartao_(conta);

    // No passado a evolução compara meses pelo que saiu do bolso: é o fluxo de
    // caixa, o número que responde "sobrou dinheiro naquele mês". No futuro não
    // existe fatura paga ainda, então a parcela do cartão já conta como
    // compromisso — senão um mês inteiro de parcelas apareceria vazio.
    if (serie[mesLinha]) {
      var futuro = mesLinha > mesHoje;
      if (tipo === TIPO.RECEITA) serie[mesLinha].receitas += valor;
      else if (tipo === TIPO.FATURA) serie[mesLinha].despesas += valor;
      else if (!noCredito || futuro) serie[mesLinha].despesas += valor;
    }

    if (mesLinha !== mes) return;
    totais.lancamentos++;

    if (tipo === TIPO.RECEITA) {
      totais.receitas += valor;
      somar_(porFonte, r[col.fonte] || 'Sem fonte', valor);
      return;
    }

    // Pagar fatura tira dinheiro da conta, mas não é gasto novo: as compras
    // que formaram essa fatura já entraram nos gastos quando aconteceram.
    if (tipo === TIPO.FATURA) {
      totais.caixa += valor;
      return;
    }

    totais.despesas += valor;
    if (noCredito) totais.credito += valor;
    else totais.caixa += valor;

    var cat = r[col.categoria] || 'Outros';
    somar_(porCategoria, cat, valor);
    somar_(porGrupo, grupoDe[chaveNome_(cat)] || 'Outros', valor);
    somar_(porConta, r[col.conta] || 'Sem conta', valor);
    somar_(porDia, data, valor);
    if (data === hoje && r[col.origem] !== 'conta fixa' && !(Number(r[col.parcela_atual]) > 1)) {
      gastoLivreHoje += valor;
    }
    somar_(porPessoa, r[col.pessoa] || 'Sem dono', valor);
  });

  // Os baús uma vez só: o total (com rendimento) e os marcos das conquistas.
  var infoBaus = null;
  if (SpreadsheetApp.getActiveSpreadsheet().getSheetByName('baus')) {
    try { infoBaus = baus_(linhas); } catch (e) { infoBaus = null; }   // rendimento nunca derruba o painel
  }

  var faturas = faturasDoMes_(mes, contas, linhas, col);
  var emFormacao = faturasEmFormacao_(mes, contas, linhas, col);
  // "Em aberto" é o que você pode pagar hoje: fatura fechada e não paga.
  // A que ainda está fechando não é dívida a pagar, é conta crescendo.
  var faturasAbertas = faturas.filter(function (f) { return !f.pago && !f.aberta; });

  // Um cartão sem dia de vencimento não consegue formar fatura: as compras dele
  // aparecem em "vai sair na fatura" e depois não achavam fatura nenhuma.
  // Em vez de sumir com o dinheiro, o painel denuncia o cadastro incompleto.
  var semCiclo = {};
  linhas.forEach(function (r) {
    if (r[col.status] !== STATUS.OK || r[col.tipo] !== TIPO.DESPESA) return;
    if (normalizarData_(r[col.data]).slice(0, 7) !== mes) return;
    var c = contas[chaveNome_(String(r[col.conta] || ''))];
    if (!ehCartao_(c) || c.vencimento) return;
    somar_(semCiclo, c.nome, Number(r[col.valor]) || 0);
  });

  // Os compromissos fixos do mês, e quais deles já apareceram como lançamento.
  //
  // A versão anterior comparava o nome do compromisso com o nome da CATEGORIA
  // já lançada. "Internet" casava por acaso e sumia; "Boleto mensal" não casava
  // com nada e sumia junto, porque a lista só mostrava o que sobrasse do filtro.
  // Agora nada some: a lista mostra tudo e marca o que já foi pago.
  // O que se repete, nos meses à frente: é isso que transforma "gastos que já
  // caíram" em "quanto ainda vai entrar e sair". Sem isso, um mês futuro
  // aparece só com as parcelas e parece que você vai passar fome.
  var regras = lerRecorrentes_();
  meses.forEach(function (k) {
    if (k <= mesHoje) return;
    var jaAgendados = agendadosPorMes[k] || [];
    compromissosDoMes_(regras, k).forEach(function (c) {
      if (c.tipo === TIPO.RECEITA) {
        // Se já existe um lançamento agendado dessa renda no mês, ele já contou.
        var alvo = chaveNome_(c.nome);
        var repetido = jaAgendados.some(function (d) { return d.indexOf(alvo) >= 0; });
        if (!repetido) serie[k].receitas_previstas += c.valor;
      } else {
        serie[k].despesas_previstas += c.valor;
      }
    });
  });

  var todosCompromissos = compromissosDoMes_(regras, mes);

  var fixas = cruzarCompromissos_(
    todosCompromissos.filter(function (c) { return c.tipo !== 'receita'; }),
    lancamentosDoMesCru_(mes, col, aba, n, TIPO.DESPESA)
  );

  // Renda que entra todo mês é compromisso igual — só que a favor. Sem isto ela
  // ficava guardada na aba `recorrentes` e não aparecia em lugar nenhum: o mês
  // dizia "Recebi R$ 0,00" com o vale-alimentação cadastrado do lado.
  var receitasAgendadas = lancamentosDoMesCru_(mes, col, aba, n, TIPO.RECEITA, STATUS.AGENDADO);

  var rendas = cruzarCompromissos_(
    todosCompromissos.filter(function (c) { return c.tipo === 'receita'; }),
    lancamentosDoMesCru_(mes, col, aba, n, TIPO.RECEITA),
    receitasAgendadas
  );

  var previsto = fixas.filter(function (f) { return !f.lancado; });
  var aReceber = rendas.filter(function (r) { return !r.lancado; });

  // Renda agendada que não pertence a nenhuma regra mensal entra na previsão
  // por conta própria — senão um salário avulso marcado para o dia 25 sumiria
  // da conta de "quanto ainda entra".
  var presos = {};
  rendas.forEach(function (r) { if (r.uuid_agendado) presos[r.uuid_agendado] = true; });
  var agendadosSoltos = receitasAgendadas.filter(function (a) { return !presos[a.uuid]; });

  var aReceberTotal = arred_(
    aReceber.reduce(function (s, r) {
      return s + (r.valor_agendado != null ? r.valor_agendado : r.valor);
    }, 0) +
    agendadosSoltos.reduce(function (s, a) { return s + a.valor; }, 0)
  );
  var previstoTotal = arred_(previsto.reduce(function (a, c) { return a + c.valor; }, 0));

  // O mês aberto já tem uma conta de previsão bem mais fina que a dos meses
  // futuros — ela sabe o que já foi pago e o que ainda falta. O gráfico usa a
  // mesma, senão a barra deste mês contaria história diferente do quadro acima.
  if (serie[mes]) {
    serie[mes].receitas_previstas = aReceberTotal;
    serie[mes].despesas_previstas = previstoTotal;
  }

  var orcamentos = {};
  lerCategorias_().forEach(function (c) {
    if (c.orcamento > 0) orcamentos[c.categoria] = c.orcamento;
  });

  return {
    ok: true,
    mes: mes,
    receitas: arred_(totais.receitas),
    despesas: arred_(totais.despesas),          // tudo que você gastou (competência)
    saiu_caixa: arred_(totais.caixa),           // o que de fato deixou as contas
    no_credito: arred_(totais.credito),         // virou fatura, ainda não saiu
    saldo: arred_(totais.receitas - totais.despesas),
    saldo_caixa: arred_(totais.receitas - totais.caixa),
    faturas: faturas,
    faturas_em_formacao: emFormacao,
    faturas_em_formacao_total: arred_(emFormacao.reduce(function (a, f) { return a + f.total; }, 0)),
    faturas_abertas: arred_(faturasAbertas.reduce(function (a, f) { return a + f.total; }, 0)),
    cartoes_sem_ciclo: emLista_(semCiclo),
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
      var s = serie[k];
      return {
        mes: k,
        futuro: k > mesHoje,
        receitas: arred_(s.receitas),
        despesas: arred_(s.despesas),
        receitas_previstas: arred_(s.receitas_previstas),
        despesas_previstas: arred_(s.despesas_previstas),
        guardado: arred_(s.guardado),
        saldo: arred_(s.receitas + s.receitas_previstas - s.despesas - s.despesas_previstas)
      };
    }),
    parceladas: parceladasDoMes_(mes, linhas, col),
    fixas: fixas,
    fixas_total: arred_(fixas.reduce(function (a, c) { return a + c.valor; }, 0)),
    previsto: previsto,
    previsto_total: previstoTotal,
    rendas: rendas,
    rendas_total: arred_(rendas.reduce(function (a, c) { return a + c.valor; }, 0)),
    a_receber: aReceber,
    a_receber_total: aReceberTotal,
    agendados_soltos: agendadosSoltos.map(function (a) {
      return { uuid: a.uuid, nome: a.nome, valor: arred_(a.valor) };
    }),

    // A pergunta que o app existe para responder: com o que ainda entra e o que
    // ainda sai, sobra quanto no fim do mês? Fatos e previsão ficam separados
    // de propósito — "Recebi" é dinheiro que caiu, isto aqui é aposta.
    previsao: {
      ja_sobrou: arred_(totais.receitas - totais.despesas),
      ainda_entra: aReceberTotal,
      ainda_sai: previstoTotal,
      sobra: arred_(totais.receitas - totais.despesas + aReceberTotal - previstoTotal),
      // o que já foi para os baús neste mês: faz parte da sobra, mas não está livre
      guardado: arred_(totais.guardado)
    },
    guardado_mes: arred_(totais.guardado),
    guardado_por_pessoa: Object.keys(guardadoPorPessoa).reduce(function (o, k) {
      var v = arred_(guardadoPorPessoa[k]);
      if (Math.abs(v) >= 0.01) o[k] = v;
      return o;
    }, {}),
    // com o que os baús renderam até hoje (só calcula se algum rende)
    baus_total: arred_(algumBauRende_() && infoBaus ? infoBaus.total : saldoBaus),
    // a fogueira da casa e o que as conquistas novas precisam saber
    fogueira: fogueira_(linhas, col),
    marcos: marcosDasConquistas_(infoBaus, linhas, col),
    gasto_livre_hoje: arred_(gastoLivreHoje),
    orcamentos: orcamentos,
    // a missão do mês (com vigência) e as conquistas já ganhas
    metas: lerMetas_(),
    conquistas: lerConquistas_()
  };
}

// --- Missão do mês e conquistas ----------------------------------------------
// Moram nas propriedades do script, não numa aba: são poucos dados, e assim o
// celular e o computador veem a mesma missão e as mesmas conquistas.
//
// A meta de guardar tem vigência, como as contas fixas: mudar a meta em
// novembro não reescreve se outubro foi cumprido.

var CONQUISTAS_VALIDAS = [
  'primeira_missao', 'fase_limpa', 'bolso_trancado', 'mana_intacta',
  'no_azul', 'trinca', 'formiguinha', 'guardiao',
  'bau_cheio', 'fogo_aceso', 'chama_eterna', 'dupla_dinamica', 'juros_a_favor', 'cacador_pontual'
];

function lerJsonProp_(chave, padrao) {
  try {
    var texto = PROP.getProperty(chave);
    return texto ? JSON.parse(texto) : padrao;
  } catch (e) {
    return padrao;
  }
}

/** [{ desde: 'aaaa-mm', valor }], do mais antigo para o mais novo. */
function lerMetas_() {
  var metas = lerJsonProp_('METAS_GUARDAR', []);
  return Array.isArray(metas) ? metas : [];
}

/** Valor 0 desliga a missão a partir do mês informado (ou do atual). */
function salvarMeta_(pedido) {
  var valor = Math.round(Math.max(0, Number(pedido.valor) || 0) * 100) / 100;
  if (valor > 10000000) return { ok: false, erro: 'valor_invalido' };
  var desde = /^\d{4}-\d{2}$/.test(String(pedido.desde || '')) ? String(pedido.desde) : mesAtual_();

  var trava = LockService.getScriptLock();
  trava.waitLock(15000);
  try {
    var metas = lerMetas_().filter(function (m) { return m.desde !== desde; });
    metas.push({ desde: desde, valor: valor });
    metas.sort(function (a, b) { return a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0; });
    PROP.setProperty('METAS_GUARDAR', JSON.stringify(metas));
    return { ok: true, metas: metas };
  } finally {
    trava.releaseLock();
  }
}

/** { id: 'aaaa-mm-dd' } — o dia em que cada conquista foi ganha. */
function lerConquistas_() {
  var ganhas = lerJsonProp_('CONQUISTAS', {});
  return ganhas && typeof ganhas === 'object' && !Array.isArray(ganhas) ? ganhas : {};
}

/**
 * O app calcula quais conquistas você já merece e manda os ids; aqui elas
 * ficam guardadas para sempre (uma conquista do mês não some quando o mês
 * vira). Id desconhecido é ignorado.
 */
function conquistar_(pedido) {
  var ids = Array.isArray(pedido.ids) ? pedido.ids : [];
  var trava = LockService.getScriptLock();
  trava.waitLock(15000);
  try {
    var ganhas = lerConquistas_();
    var hoje = hojeISO_();
    var novas = [];
    ids.forEach(function (id) {
      if (CONQUISTAS_VALIDAS.indexOf(id) < 0 || ganhas[id]) return;
      ganhas[id] = hoje;
      novas.push(id);
    });
    if (novas.length) PROP.setProperty('CONQUISTAS', JSON.stringify(ganhas));
    return { ok: true, conquistas: ganhas, novas: novas };
  } finally {
    trava.releaseLock();
  }
}

// --- Baús: caixinhas para guardar dinheiro -----------------------------------
// Cada baú é uma linha na aba `baus` (nome, meta, pra que é, até quando). O
// dinheiro que entra e sai dele são linhas normais em `lancamentos`, com tipo
// `guardar` ou `resgatar` e o nome do baú na coluna categoria — assim passam
// pela mesma fila do app, funcionam sem internet e aparecem no extrato.
//
// Guardar não é gasto: não entra em categoria, orçamento nem "para onde foi".
// Mas o dinheiro sai do mês, e por isso o painel conta o guardado à parte.

var MAX_NOME_BAU = 40;
var MAX_OBJETIVO_BAU = 300;

function ehBau_(tipo) {
  return tipo === TIPO.GUARDAR || tipo === TIPO.RESGATAR || tipo === TIPO.RENDIMENTO;
}

/**
 * Guardar soma no baú, resgatar tira. O acerto com o banco (rendimento) não
 * é dinheiro saindo nem voltando para o mês: o sinal dele aqui é zero, e
 * quem quer o saldo soma o valor do acerto à parte.
 */
function sinalBau_(tipo) {
  if (tipo === TIPO.GUARDAR) return 1;
  if (tipo === TIPO.RESGATAR) return -1;
  return 0;
}

/**
 * A aba nasce na primeira vez que alguém mexe em baú — sem rodar configurar()
 * de novo. Quando ganha colunas novas (o rendimento entrou depois), o
 * cabeçalho é refeito por nome e o que já estava lá vai junto.
 */
function abaBaus_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('baus');
  if (!aba) { prepararAba_(ss, 'baus'); return ss.getSheetByName('baus'); }
  var largura = Math.max(aba.getLastColumn(), 1);
  var cab = aba.getRange(1, 1, 1, largura).getValues()[0]
    .map(function (c) { return String(c || '').trim(); });
  var igual = cab.length >= ABAS.baus.length &&
    ABAS.baus.every(function (c, i) { return cab[i] === c; });
  if (!igual) prepararAba_(ss, 'baus');
  return ss.getSheetByName('baus');
}

var TIPOS_RENDE = ['', 'cdi', 'fixo'];

/** O jeito que o baú rende, já conferido: o que vier torto vira "não rende". */
function rendeDe_(tipo, pct, limite, acima) {
  tipo = String(tipo || '').trim().toLowerCase();
  if (TIPOS_RENDE.indexOf(tipo) < 0) tipo = '';
  var teto = tipo === 'fixo' ? 100 : 300;
  var p = Math.min(teto, Math.max(0, Number(pct) || 0));
  if (!tipo || p <= 0) return { tipo: '', pct: 0, limite: 0, acima: 0 };
  var lim = Math.min(100000000, Math.max(0, Math.round((Number(limite) || 0) * 100) / 100));
  var ac = (acima === '' || acima === null || acima === undefined || isNaN(Number(acima)))
    ? (tipo === 'cdi' ? 100 : p)
    : Math.min(teto, Math.max(0, Number(acima)));
  return { tipo: tipo, pct: p, limite: lim, acima: lim > 0 ? ac : 0 };
}

function lerBaus_() {
  var aba = abaBaus_();
  var n = aba.getLastRow() - 1;
  if (n <= 0) return [];
  var c = function (nome) { return ABAS.baus.indexOf(nome); };
  return aba.getRange(2, 1, n, ABAS.baus.length).getValues()
    .map(function (r, i) {
      return {
        linha: i + 2,
        nome: String(r[0] || '').trim(),
        meta: arred_(r[1]),
        objetivo: String(r[2] || ''),
        prazo: normalizarMes_(r[3]),
        criado_em: normalizarData_(r[4]),
        ativo: r[5] !== 'não' && r[5] !== false,
        rende: rendeDe_(r[c('rende_tipo')], r[c('rende_pct')], r[c('rende_limite')], r[c('rende_acima')])
      };
    })
    .filter(function (b) { return b.nome; });
}

/**
 * Os baús ativos com saldo, o guardado neste mês, o total por mês (para o app
 * calcular o ritmo) e o histórico de cada um, do mais novo para o mais antigo.
 * Baú que tem dinheiro mas sumiu da aba (apagado à mão) aparece mesmo assim:
 * dinheiro guardado não pode desaparecer da tela.
 *
 * Baú que rende: o saldo é o BRUTO de hoje (guardado + o que rendeu), e
 * `rende` traz o resto — líquido se resgatar hoje, quanto rende por mês, o
 * rendimento de cada mês. `linhasProntas` é para o painel, que já leu tudo.
 */
function baus_(linhasProntas) {
  var cadastro = lerBaus_();
  var mesHoje = mesAtual_();
  var hoje = hojeISO_();
  var porChave = {};
  var arquivados = {};
  var lista = [];

  cadastro.forEach(function (b) {
    var k = chaveNome_(b.nome);
    if (!b.ativo) { arquivados[k] = true; return; }
    var item = {
      nome: b.nome, meta: b.meta, objetivo: b.objetivo, prazo: b.prazo, criado_em: b.criado_em,
      rende: b.rende,
      saldo: 0, guardado_mes: 0, por_mes: {}, movimentos: [], _eventos: []
    };
    porChave[k] = item;
    lista.push(item);
  });

  var col = indiceColunas_();
  var linhas = linhasProntas;
  if (!linhas) {
    var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
    var n = aba.getLastRow() - 1;
    linhas = n > 0 ? aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues() : [];
  }
  linhas.forEach(function (r, i) {
    var tipo = r[col.tipo];
    if (!ehBau_(tipo) || r[col.status] !== STATUS.OK) return;
    var nome = String(r[col.categoria] || 'Baú');
    var k = chaveNome_(nome);
    if (arquivados[k] && !porChave[k]) return;
    var b = porChave[k];
    if (!b) {
      b = porChave[k] = {
        nome: nome, meta: 0, objetivo: '', prazo: '', criado_em: '', sem_cadastro: true,
        rende: rendeDe_(''),
        saldo: 0, guardado_mes: 0, por_mes: {}, movimentos: [], _eventos: []
      };
      lista.push(b);
    }
    var data = normalizarData_(r[col.data]);
    var valor = Number(r[col.valor]) || 0;
    var s = sinalBau_(tipo) * valor;
    // O acerto com o banco muda o saldo, mas não é dinheiro que saiu do mês.
    b.saldo += tipo === TIPO.RENDIMENTO ? valor : s;
    if (s) somar_(b.por_mes, data.slice(0, 7), s);
    if (data.slice(0, 7) === mesHoje) b.guardado_mes += s;
    b._eventos.push({ data: data, tipo: tipo, valor: valor, ordem: i });
    var item = lancamentoDe_(r, col, data);
    item._ordem = ordemDe_(data, r[col.hora_registro], i);
    b.movimentos.push(item);
  });

  // O CDI só é buscado se algum baú rende pelo CDI e tem dinheiro.
  var serie = null;
  var desde = '';
  lista.forEach(function (b) {
    if (b.rende.tipo !== 'cdi' || !b._eventos.length) return;
    b._eventos.forEach(function (e) { if (e.data && (!desde || e.data < desde)) desde = e.data; });
  });
  if (desde) serie = serieCdi_(desde);

  var total = 0, doMes = 0;
  lista.forEach(function (b) {
    if (b.rende.tipo || b._eventos.some(function (e) { return e.tipo === TIPO.RENDIMENTO; })) {
      var calc = rendimentoDoBau_(b.rende, b._eventos, serie, hoje);
      b.saldo = calc.bruto;
      b.rende = calc.rende;
    }
    delete b._eventos;
    b.saldo = arred_(b.saldo);
    b.guardado_mes = arred_(b.guardado_mes);
    Object.keys(b.por_mes).forEach(function (m) { b.por_mes[m] = arred_(b.por_mes[m]); });
    b.movimentos = ordenarDoMaisNovo_(b.movimentos).slice(0, 300);
    total += b.saldo;
    doMes += b.guardado_mes;
  });

  return { ok: true, mes: mesHoje, total: arred_(total), guardado_mes: arred_(doMes), baus: lista };
}

/** Algum baú ativo rende? Sem a aba, não — e o painel não cria aba nenhuma. */
function algumBauRende_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName('baus')) return false;
  return lerBaus_().some(function (b) { return b.ativo && b.rende.tipo; });
}

/** O total dos baús para o painel: o mesmo número da tela dos baús. */
function totalDosBaus_(semRendimento, linhas) {
  try {
    return algumBauRende_() ? baus_(linhas).total : semRendimento;
  } catch (e) {
    return semRendimento;   // rendimento nunca derruba o painel
  }
}

// --- Rendimento -------------------------------------------------------------
// O Banco Central publica o CDI de cada dia útil (série 12, em % ao dia).
// O baú rende todo dia útil sobre o saldo do fim do dia, juros sobre juros,
// como a caixinha do banco. O dia de hoje ainda não rendeu.
//
// Imposto: o IR é regressivo pelo tempo de cada depósito (22,5% até 180 dias,
// 20% até 360, 17,5% até 720, 15% depois) e o IOF come parte do rendimento
// nos primeiros 30 dias. Resgate tira dos depósitos mais antigos primeiro.

var CDI_PADRAO_ANUAL = 0.1365;   // só se o Banco Central nunca respondeu
var IOF_REGRESSIVO = [96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50,
                      46, 43, 40, 36, 33, 30, 26, 23, 20, 16, 13, 10, 6, 3, 0];
var DIAS_UTEIS_MES = 21;

function diaISOMais_(iso, n) {
  var d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n, 12));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function diasEntre_(de, ate) {
  var a = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  var b = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

function diaDeSemana_(iso) {
  var d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 12)).getUTCDay();
  return d >= 1 && d <= 5;
}

/**
 * A série do CDI desde `desde`, de um jeito que nunca derruba a tela: busca no
 * Banco Central uma vez por dia (fica no cache), e se ele não responder usa o
 * que já tinha — ou a última taxa conhecida — e avisa com `estimado`.
 */
function serieCdi_(desde) {
  var hoje = hojeISO_();
  var cache = null, guardada = null;
  try {
    cache = CacheService.getScriptCache();
    guardada = JSON.parse(cache.get('CDI_SERIE') || 'null');
  } catch (e) { guardada = null; }
  if (guardada && guardada.desde <= desde && guardada.buscado_em === hoje) return guardada;

  var falhouAgora = false;
  try { falhouAgora = !!(cache && cache.get('CDI_FALHA')); } catch (e) {}
  if (!falhouAgora) {
    // Pede sempre um pouco antes (o Banco Central responde erro para período sem dia útil).
    var inicio = desde < diaISOMais_(hoje, -10) ? desde : diaISOMais_(hoje, -10);
    var dezAnos = diaISOMais_(hoje, -3650);
    if (inicio < dezAnos) inicio = dezAnos;   // limite da API para série diária
    var nova = buscarCdi_(inicio, hoje);
    if (nova) {
      try { cache.put('CDI_SERIE', JSON.stringify(nova), 21600); } catch (e) {}
      try { PROP.setProperty('CDI_ULTIMA', JSON.stringify({ data: nova.ultima_data, taxa: nova.ultima })); } catch (e) {}
      return nova;
    }
    try { cache.put('CDI_FALHA', '1', 1800); } catch (e) {}
  }

  if (guardada) { guardada.estimado = true; return guardada; }
  var ult = null;
  try { ult = JSON.parse(PROP.getProperty('CDI_ULTIMA') || 'null'); } catch (e) {}
  return {
    desde: hoje, ate: '', buscado_em: '', taxas: {},
    ultima: ult ? Number(ult.taxa) : Math.pow(1 + CDI_PADRAO_ANUAL, 1 / 252) - 1,
    ultima_data: ult ? String(ult.data || '') : '',
    estimado: true
  };
}

/** Uma ida ao Banco Central. Devolve null se não deu (sem rede, fora do ar, formato estranho). */
function buscarCdi_(inicio, fim) {
  var br = function (iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); };
  try {
    var url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json' +
      '&dataInicial=' + br(inicio) + '&dataFinal=' + br(fim);
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Accept: 'application/json' } });
    if (resp.getResponseCode() !== 200) return null;
    var lista = JSON.parse(resp.getContentText());
    if (!Array.isArray(lista) || !lista.length) return null;
    var taxas = {}, ultimaData = '';
    lista.forEach(function (x) {
      var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(x.data || ''));
      var v = Number(String(x.valor || '').replace(',', '.'));
      if (!m || !(v >= 0) || v > 1) return;   // % ao dia; acima de 1% é lixo
      var iso = m[3] + '-' + m[2] + '-' + m[1];
      taxas[iso] = v / 100;
      if (iso > ultimaData) ultimaData = iso;
    });
    if (!ultimaData) return null;
    return {
      desde: inicio, ate: ultimaData, buscado_em: hojeISO_(), taxas: taxas,
      ultima: taxas[ultimaData], ultima_data: ultimaData, estimado: false
    };
  } catch (e) {
    return null;
  }
}

/** A taxa do dia `d` para o baú (fração, não %), ou 0 se o dia não rende. */
function taxaDoDia_(cfg, serie, d, aviso) {
  var util;
  var cdi = 0;
  if (serie && serie.taxas[d] !== undefined) {
    util = true; cdi = serie.taxas[d];
  } else if (serie && d >= serie.desde && d <= serie.ate) {
    util = false;                                 // feriado ou fim de semana dentro da série
  } else {
    // Fora da série: dia de semana, com a última taxa. O Banco Central publica
    // o CDI de ontem só hoje — os poucos dias depois do último publicado são
    // normais; antes da série, ou com a série velha, é estimativa.
    util = diaDeSemana_(d);
    if (util && cfg.tipo === 'cdi') {
      cdi = serie ? serie.ultima : Math.pow(1 + CDI_PADRAO_ANUAL, 1 / 252) - 1;
      if (!serie || !serie.ate || d < serie.desde || diasEntre_(serie.ate, d) > 4) aviso.estimado = true;
    }
  }
  if (!util) return null;
  if (cfg.tipo === 'cdi') return { ate: cdi * cfg.pct / 100, acima: cdi * cfg.acima / 100 };
  return {
    ate: Math.pow(1 + cfg.pct / 100, 1 / 252) - 1,
    acima: Math.pow(1 + cfg.acima / 100, 1 / 252) - 1
  };
}

function aliquotaIR_(dias) {
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.20;
  if (dias <= 720) return 0.175;
  return 0.15;
}

/**
 * Refaz a vida do baú dia a dia. Cada depósito é um "lote" (para saber a
 * idade do dinheiro no IR); o rendimento de cada dia vai para os lotes na
 * proporção do tamanho; resgate sai dos mais antigos; acerto com o banco
 * entra (ou sai) como rendimento.
 */
function rendimentoDoBau_(cfg, eventos, serie, hoje) {
  var ev = eventos.slice().sort(function (a, b) {
    return a.data < b.data ? -1 : a.data > b.data ? 1 : a.ordem - b.ordem;
  });
  var lotes = [];
  var porMes = {};
  var aviso = { estimado: !!(serie && serie.estimado) };
  var rendeuTotal = 0;   // tudo o que já rendeu (calculado + acertos), mesmo o que já foi resgatado

  var valorDe = function (l) { return l.p + l.r; };
  var somaLotes = function () { return lotes.reduce(function (t, l) { return t + valorDe(l); }, 0); };
  var espalhar = function (y, data) {
    var base = lotes.filter(function (l) { return valorDe(l) > 0; });
    var tot = base.reduce(function (t, l) { return t + valorDe(l); }, 0);
    if (tot <= 0) { lotes.push({ data: data, p: 0, r: y }); return; }
    base.forEach(function (l) { l.r += y * valorDe(l) / tot; });
  };
  var aplicar = function (e) {
    var v = Number(e.valor) || 0;
    if (e.tipo === TIPO.GUARDAR) { lotes.push({ data: e.data, p: v, r: 0 }); return; }
    if (e.tipo === TIPO.RENDIMENTO) { espalhar(v, e.data); rendeuTotal += v; return; }
    // resgatar: dos mais antigos primeiro
    var falta = v;
    for (var i = 0; i < lotes.length && falta > 1e-9; i++) {
      var l = lotes[i], val = valorDe(l);
      if (val <= 0) continue;
      var tira = Math.min(val, falta), f = tira / val;
      l.p -= l.p * f; l.r -= l.r * f; falta -= tira;
    }
    if (falta > 1e-9) lotes.push({ data: e.data, p: -falta, r: 0 });
    lotes = lotes.filter(function (l) { return Math.abs(valorDe(l)) > 1e-9; });
  };

  var i = 0;
  if (cfg.tipo && ev.length) {
    var d = ev[0].data;
    while (d && d < hoje) {
      while (i < ev.length && ev[i].data <= d) aplicar(ev[i++]);
      var saldo = somaLotes();
      if (saldo > 0) {
        var tx = taxaDoDia_(cfg, serie, d, aviso);
        if (tx) {
          var ate = cfg.limite > 0 ? Math.min(saldo, cfg.limite) : saldo;
          var y = ate * tx.ate + (saldo - ate) * tx.acima;
          if (y > 0) { espalhar(y, d); somar_(porMes, d.slice(0, 7), y); rendeuTotal += y; }
        }
      }
      d = diaISOMais_(d, 1);
    }
  }
  while (i < ev.length) aplicar(ev[i++]);

  var bruto = somaLotes();
  var principal = 0, rendimento = 0, iof = 0, ir = 0;
  lotes.forEach(function (l) {
    principal += l.p;
    rendimento += l.r;
    if (l.r <= 0) return;
    var dias = Math.max(0, diasEntre_(l.data, hoje));
    var oIof = dias < 30 ? l.r * IOF_REGRESSIVO[Math.max(dias, 1) - 1] / 100 : 0;
    iof += oIof;
    ir += (l.r - oIof) * aliquotaIR_(dias);
  });

  // Quanto rende por mês daqui para frente, com a taxa de hoje.
  var mensal = function (pctOuAno) {
    if (cfg.tipo === 'cdi') {
      var cdiDia = serie ? serie.ultima : Math.pow(1 + CDI_PADRAO_ANUAL, 1 / 252) - 1;
      return Math.pow(1 + cdiDia * pctOuAno / 100, DIAS_UTEIS_MES) - 1;
    }
    if (cfg.tipo === 'fixo') return Math.pow(1 + pctOuAno / 100, 1 / 12) - 1;
    return 0;
  };
  var m1 = mensal(cfg.pct), m2 = cfg.limite > 0 ? mensal(cfg.acima) : m1;
  var base = Math.max(0, bruto);
  var ateLim = cfg.limite > 0 ? Math.min(base, cfg.limite) : base;
  var porMesFuturo = ateLim * m1 + (base - ateLim) * m2;

  Object.keys(porMes).forEach(function (m) { porMes[m] = arred_(porMes[m]); });
  var cdiDia = serie ? serie.ultima : null;
  return {
    bruto: arred_(bruto),
    rende: {
      tipo: cfg.tipo, pct: cfg.pct, limite: cfg.limite, acima: cfg.acima,
      principal: arred_(principal),
      rendimento: arred_(rendimento),
      rendeu_total: arred_(rendeuTotal),
      iof: arred_(iof),
      ir: arred_(ir),
      liquido: arred_(bruto - iof - ir),
      por_mes_rendimento: porMes,
      rende_por_mes: arred_(porMesFuturo),
      taxa_mes_ate: Math.round(m1 * 1e6) / 1e6,
      taxa_mes_acima: Math.round(m2 * 1e6) / 1e6,
      cdi_data: cfg.tipo === 'cdi' && serie ? serie.ultima_data : '',
      cdi_anual: cfg.tipo === 'cdi' && cdiDia !== null ? Math.round((Math.pow(1 + cdiDia, 252) - 1) * 10000) / 100 : null,
      estimado: cfg.tipo === 'cdi' ? !!aviso.estimado : false
    }
  };
}

/**
 * Cria ou edita um baú. Com `nome_antigo` diferente do nome, é renomear: o
 * histórico inteiro passa para o nome novo, senão o dinheiro ficaria no baú
 * velho. Nome repetido entre baús ativos é recusado.
 */
function salvarBau_(pedido) {
  var nome = String(pedido.nome || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOME_BAU);
  if (!nome) return { ok: false, erro: 'nome_vazio' };
  var meta = Math.round(Math.max(0, Number(pedido.meta) || 0) * 100) / 100;
  if (meta > 100000000) return { ok: false, erro: 'valor_invalido' };
  var prazo = /^\d{4}-\d{2}$/.test(String(pedido.prazo || '')) ? String(pedido.prazo) : '';
  var objetivo = String(pedido.objetivo || '').trim().slice(0, MAX_OBJETIVO_BAU);
  var antigo = String(pedido.nome_antigo || '').trim();
  var rende = rendeDe_(pedido.rende_tipo, pedido.rende_pct, pedido.rende_limite, pedido.rende_acima);

  var trava = LockService.getScriptLock();
  trava.waitLock(15000);
  try {
    var aba = abaBaus_();
    var cadastro = lerBaus_();
    var chave = chaveNome_(nome);
    var chaveAntiga = antigo ? chaveNome_(antigo) : chave;
    var existente = cadastro.filter(function (b) { return chaveNome_(b.nome) === chaveAntiga; })[0];
    var conflito = cadastro.filter(function (b) {
      return b.ativo && chaveNome_(b.nome) === chave && b !== existente;
    })[0];
    if (conflito) return { ok: false, erro: 'nome_repetido' };
    // Criar (sem nome antigo) com o nome de um baú ativo é repetir; com o de um
    // arquivado, é trazer ele de volta.
    if (!antigo && existente && existente.ativo) return { ok: false, erro: 'nome_repetido' };

    var linha = [nome, meta, objetivo, prazo, existente ? existente.criado_em : hojeISO_(), 'sim',
                 rende.tipo, rende.tipo ? rende.pct : '', rende.limite || '', rende.limite ? rende.acima : ''];
    if (existente) {
      aba.getRange(existente.linha, 1, 1, ABAS.baus.length).setValues([linha]);
    } else {
      aba.getRange(aba.getLastRow() + 1, 1, 1, ABAS.baus.length).setValues([linha]);
    }
    if (antigo && antigo !== nome) renomearBau_(antigo, nome);

    return { ok: true, bau: { nome: nome, meta: meta, objetivo: objetivo, prazo: prazo, criado_em: linha[4], rende: rende } };
  } finally {
    trava.releaseLock();
  }
}

/** Arquiva o baú. Só vazio: dinheiro guardado não some com um toque. */
function excluirBau_(pedido) {
  var alvo = chaveNome_(pedido.nome);
  if (!alvo) return { ok: false, erro: 'nome_vazio' };
  var atual = baus_().baus.filter(function (b) { return chaveNome_(b.nome) === alvo; })[0];
  if (!atual) return { ok: false, erro: 'nao_encontrado' };
  if (Math.abs(atual.saldo) >= 0.01) return { ok: false, erro: 'bau_com_dinheiro', saldo: atual.saldo };

  var trava = LockService.getScriptLock();
  trava.waitLock(15000);
  try {
    var aba = abaBaus_();
    var b = lerBaus_().filter(function (x) { return chaveNome_(x.nome) === alvo; })[0];
    if (b) aba.getRange(b.linha, ABAS.baus.indexOf('ativo') + 1).setValue('não');
    return { ok: true };
  } finally {
    trava.releaseLock();
  }
}

/** O histórico do baú acompanha o nome novo (só linhas de baú, nunca gastos). */
function renomearBau_(de, para) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return;
  var col = indiceColunas_();
  var tipos = aba.getRange(2, col.tipo + 1, n, 1).getValues();
  var faixa = aba.getRange(2, col.categoria + 1, n, 1);
  var cats = faixa.getValues();
  var alvo = chaveNome_(de);
  var mudou = false;
  for (var i = 0; i < n; i++) {
    if (ehBau_(tipos[i][0]) && chaveNome_(cats[i][0]) === alvo) { cats[i][0] = para; mudou = true; }
  }
  if (mudou) faixa.setValues(cats);
}

/** O total guardado em cada baú, para a IA saber que esse dinheiro existe. */
function bausResumo_() {
  try {
    return baus_().baus.map(function (b) {
      var x = { nome: b.nome, saldo: b.saldo, meta: b.meta, objetivo: b.objetivo, prazo: b.prazo };
      if (b.rende && b.rende.tipo) {
        x.rende = b.rende.tipo === 'cdi' ? b.rende.pct + '% do CDI' : b.rende.pct + '% ao ano';
        x.liquido_se_resgatar_hoje = b.rende.liquido;
        x.rende_por_mes = b.rende.rende_por_mes;
      }
      return x;
    });
  } catch (e) {
    return [];
  }
}

/**
 * Cruza os compromissos do mês com o que já foi lançado, e marca cada um como
 * lançado ou não. Serve para conta fixa e para renda mensal — a pergunta é a
 * mesma ("isso já aconteceu este mês?"), só muda o sinal do dinheiro.
 */
function cruzarCompromissos_(compromissos, lancamentos, agendados) {
  var preparar = function (lista) {
    return (lista || []).map(function (l) {
      return {
        uuid: l.uuid,
        nome: l.nome || l.descricao,
        descricao: chaveNome_(l.descricao),
        categoria: chaveNome_(l.categoria),
        valor: l.valor,
        data: l.data || ''
      };
    });
  };

  var feitos = preparar(lancamentos);
  var marcados = preparar(agendados);

  var procurar = function (lista, c, alvo) {
    for (var i = 0; i < lista.length && alvo; i++) {
      var a = lista[i];
      if (a.descricao.indexOf(alvo) >= 0 ||
          (a.categoria && a.categoria === alvo) ||
          (a.categoria === chaveNome_(c.categoria) && Math.abs(a.valor - c.valor) < 0.01)) {
        return a;
      }
    }
    return null;
  };

  return compromissos.map(function (c) {
    var alvo = chaveNome_(c.nome);
    var feito = procurar(feitos, c, alvo);
    // Não achou nada que aconteceu? Talvez exista um lançamento já marcado
    // para uma data à frente — ele não é dinheiro ainda, mas é a previsão.
    var marcado = feito ? null : procurar(marcados, c, alvo);

    return {
      nome: c.nome, valor: arred_(c.valor), dia: c.dia,
      tipo: c.tipo || TIPO.DESPESA,
      categoria: c.categoria,
      conta: c.conta, metodo: c.metodo, pessoa: c.pessoa,
      lancado: !!feito,
      // o uuid fecha o ciclo: tocar num item já lançado abre o lançamento dele
      uuid_lancamento: feito ? feito.uuid : '',
      valor_lancado: feito ? arred_(feito.valor) : null,
      // o dia em que foi pago (o Caçador pontual compara com o vencimento)
      data_lancado: feito ? feito.data : '',
      // e num item agendado, confirma aquele lançamento em vez de criar outro
      uuid_agendado: marcado ? marcado.uuid : '',
      valor_agendado: marcado ? arred_(marcado.valor) : null,
      // o nome que está escrito no lançamento manda, porque é o que você edita
      nome_lancado: (feito && feito.nome) || (marcado && marcado.nome) || ''
    };
  });
}

/**
 * As compras parceladas que pesam neste mês, uma linha por compra — não por
 * parcela. Cartão e boleto juntos: o que define é o parcelamento, não onde
 * você paga. Serve para responder "de quanto eu já devo todo mês e por quanto
 * tempo ainda", que a lista de lançamentos solta não responde.
 */
function parceladasDoMes_(mes, linhas, col) {
  var grupos = {};

  linhas.forEach(function (r) {
    if (r[col.status] !== STATUS.OK) return;
    if (r[col.tipo] !== TIPO.DESPESA) return;
    if (Math.round(Number(r[col.parcelas_total]) || 0) < 2) return;

    var chave = grupoDoUuid_(r[col.uuid]);
    if (!grupos[chave]) {
      grupos[chave] = {
        nome: '', categoria: '', conta: '', pessoa: '',
        parcelas_total: Math.round(Number(r[col.parcelas_total]) || 0),
        parcela_atual: 0, valor: 0, uuid: '',
        falta_pagar: 0, parcelas_restantes: 0, ultima: ''
      };
    }

    var g = grupos[chave];
    var data = normalizarData_(r[col.data]);
    var valor = Number(r[col.valor]) || 0;
    var numero = Math.round(Number(r[col.parcela_atual]) || 0);

    // Da parcela deste mês vêm os dados que a linha mostra.
    if (data.slice(0, 7) === mes) {
      g.nome = r[col.descricao];
      g.categoria = r[col.categoria];
      g.conta = r[col.conta];
      g.pessoa = r[col.pessoa];
      g.parcela_atual = numero;
      g.valor = arred_(valor);
      g.uuid = r[col.uuid];
    }

    // Do mês em diante é o que ainda falta pagar.
    if (data.slice(0, 7) >= mes) {
      g.falta_pagar = arred_(g.falta_pagar + valor);
      g.parcelas_restantes++;
      if (data > g.ultima) g.ultima = data;
    }
  });

  return Object.keys(grupos)
    .map(function (k) { return grupos[k]; })
    .filter(function (g) { return g.uuid; })   // só as que têm parcela neste mês
    .sort(function (a, b) { return b.valor - a.valor; });
}

/** Lançamentos de um tipo e status no mês, para cruzar com os compromissos. */
function lancamentosDoMesCru_(mes, col, aba, n, tipo, status) {
  if (n <= 0) return [];
  var saida = [];
  aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues().forEach(function (r) {
    if (r[col.status] !== (status || STATUS.OK)) return;
    if (r[col.tipo] !== (tipo || TIPO.DESPESA)) return;
    if (normalizarData_(r[col.data]).slice(0, 7) !== mes) return;
    saida.push({
      uuid: r[col.uuid],
      // `nome` é o que aparece na tela; `descricao` inclui o texto falado só
      // para o cruzamento achar o compromisso pelo que você disse.
      nome: String(r[col.descricao] || ''),
      descricao: String(r[col.descricao] || '') + ' ' + String(r[col.texto_falado] || ''),
      categoria: String(r[col.categoria] || ''),
      valor: Number(r[col.valor]) || 0,
      data: normalizarData_(r[col.data])
    });
  });
  return saida;
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

  aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues().forEach(function (r, i) {
    if (r[col.status] === STATUS.EXCLUIDO) return;
    var data = normalizarData_(r[col.data]);
    if (data.indexOf(mes) !== 0) return;
    var item = lancamentoDe_(r, col, data);
    item._ordem = ordemDe_(data, r[col.hora_registro], i);
    lista.push(item);
  });

  return { ok: true, mes: mes, lancamentos: ordenarDoMaisNovo_(lista) };
}

/**
 * A ordem da lista: dia do gasto primeiro; empatou no dia, vale a hora em que
 * foi registrado; empatou nos dois, a ordem em que entrou na planilha.
 *
 * Sem o desempate, tudo que cai no mesmo dia — as contas fixas que você marca
 * como pagas, os lançamentos de uma frase só — ficava na ordem em que a planilha
 * cresceu, que para quem olha a tela é ordem nenhuma.
 */
/**
 * Todos os lançamentos, do mais novo para o mais antigo, com busca e página.
 *
 * A lista "já sincronizados" do aparelho só guardava uma semana e no máximo 15
 * linhas — servia para conferir o que subiu, não para procurar coisa. Aqui vem
 * a planilha inteira. A busca e o corte acontecem no script de propósito:
 * mandar tudo para o celular a cada letra digitada seria absurdo.
 */
function extrato_(pedido) {
  var limite = Math.min(Math.max(Number(pedido && pedido.limite) || 30, 1), 100);
  var inicio = Math.max(Number(pedido && pedido.inicio) || 0, 0);
  var busca = semAcentoGS_(String((pedido && pedido.busca) || '')).trim();
  // Um mês só ("aaaa-mm"), escolhido no seletor de ano → mês. Vazio = tudo.
  var mesFiltro = /^\d{4}-\d{2}$/.test(String((pedido && pedido.mes) || '')) ? String(pedido.mes) : '';

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return { ok: true, lancamentos: [], total: 0, tem_mais: false, mes: mesFiltro, meses: [] };

  var col = indiceColunas_();
  var lista = [];
  var comDados = {};   // meses que têm algum lançamento: o seletor marca com um ponto

  aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues().forEach(function (r, i) {
    if (r[col.status] === STATUS.EXCLUIDO) return;
    var data = normalizarData_(r[col.data]);
    if (data) comDados[data.slice(0, 7)] = true;
    if (mesFiltro && data.slice(0, 7) !== mesFiltro) return;
    var item = lancamentoDe_(r, col, data);
    if (busca && !combinaComBusca_(item, busca)) return;
    item._ordem = ordemDe_(data, r[col.hora_registro], i);
    lista.push(item);
  });

  ordenarDoMaisNovo_(lista);

  return {
    ok: true,
    total: lista.length,
    tem_mais: inicio + limite < lista.length,
    lancamentos: lista.slice(inicio, inicio + limite),
    mes: mesFiltro,
    meses: Object.keys(comDados).sort()
  };
}

/** A busca olha o que você leria na tela — e também o valor, que é como a
 *  gente costuma lembrar de um gasto ("aquele de 57"). */
function combinaComBusca_(item, busca) {
  var alvo = semAcentoGS_([
    item.descricao, item.categoria, item.conta, item.fonte, item.pessoa, item.texto_falado
  ].join(' '));
  if (alvo.indexOf(busca) >= 0) return true;
  return String(item.valor).indexOf(busca.replace(',', '.')) >= 0;
}

function ordemDe_(data, horaRegistro, indiceLinha) {
  var h = 0;
  if (horaRegistro instanceof Date) h = horaRegistro.getTime();
  else if (horaRegistro) {
    var d = new Date(horaRegistro);
    h = isNaN(d.getTime()) ? 0 : d.getTime();
  }
  // O que ainda não aconteceu vai para o fim da lista, por mais alta que seja
  // a data: a parcela do dia 28 não pode passar na frente da compra que você
  // acabou de fazer hoje. Dentro do futuro, o mais próximo vem primeiro.
  var futuro = data > hojeISO_();
  return [futuro ? 0 : 1, futuro ? inverso_(data) : data, h, indiceLinha];
}

/** Inverte a ordem de uma data ISO, para o futuro sair do mais próximo ao mais longe. */
function inverso_(data) {
  return String(9999 - Number(String(data).slice(0, 4))) + '-' +
         String(99 - Number(String(data).slice(5, 7))) + '-' +
         String(99 - Number(String(data).slice(8, 10)));
}

/** Do mais novo para o mais antigo, e tira a chave de ordenação do resultado. */
function ordenarDoMaisNovo_(lista) {
  lista.sort(function (a, b) {
    for (var k = 0; k < 3; k++) {
      if (a._ordem[k] < b._ordem[k]) return 1;
      if (a._ordem[k] > b._ordem[k]) return -1;
    }
    return 0;
  });
  lista.forEach(function (item) { delete item._ordem; });
  return lista;
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
    fatura_mes: normalizarMes_(r[col.fatura_mes]),
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
    // Agendado não vira ok por ter sido editado: mexer no nome de um salário
    // que ainda não caiu não faz ele cair. Quem confirma é você, no botão.
    if (valores[col.status] !== STATUS.OK && valores[col.status] !== STATUS.AGENDADO) {
      valores[col.status] = STATUS.OK;
    }

    // Trocar a conta troca a fatura em que a compra cai. Sem recalcular aqui, a
    // linha continuaria carimbada com a fatura do cartão antigo.
    if (mudou.indexOf('conta') >= 0 || mudou.indexOf('data') >= 0) {
      valores[col.fatura_mes] = '';
      if (String(valores[col.tipo]) === TIPO.DESPESA) {
        var cartao = indiceContas_()[chaveNome_(String(valores[col.conta] || ''))];
        if (ehCartao_(cartao)) {
          valores[col.fatura_mes] = mesDaFatura_(cartao, normalizarData_(valores[col.data]));
        }
      }
    }

    faixa.setValues([valores]);

    // Se é uma parcela, o que descreve a compra vale para todas as irmãs —
    // categoria, descrição e conta são da compra, não da parcela. Valor e data
    // continuam sendo de cada uma.
    var irmas = propagarNoGrupo_(aba, col, pedido.uuid, valores, mudou);

    var aprendido = mudou.indexOf('categoria') >= 0 && !ehBau_(String(valores[col.tipo]))
      ? aprenderCategoria_(valores[col.descricao], valores[col.categoria])
      : null;

    atualizarResumo_();

    return { ok: true, uuid: pedido.uuid, alterados: mudou, parcelas_ajustadas: irmas, aprendido: aprendido };
  } finally {
    trava.releaseLock();
  }
}

/** Campos que descrevem a compra toda, não uma parcela dela. */
var CAMPOS_DA_COMPRA = ['tipo', 'categoria', 'descricao', 'conta', 'metodo', 'fonte', 'pessoa'];

function propagarNoGrupo_(aba, col, uuid, valores, mudou) {
  var campos = CAMPOS_DA_COMPRA.filter(function (c) { return mudou.indexOf(c) >= 0; });
  if (!campos.length) return 0;

  var base = grupoDoUuid_(uuid);
  var n = aba.getLastRow() - 1;
  if (n <= 0) return 0;

  var largura = ABAS.lancamentos.length;
  var dados = aba.getRange(2, 1, n, largura).getValues();
  var cartao = null, olhouCartao = false;
  var ajustadas = 0;

  for (var i = 0; i < dados.length; i++) {
    var u = String(dados[i][col.uuid]);
    if (u === String(uuid) || !ehDoGrupo_(u, base)) continue;
    if (dados[i][col.status] === STATUS.EXCLUIDO) continue;

    campos.forEach(function (c) { dados[i][col[c]] = valores[col[c]]; });

    if (campos.indexOf('conta') >= 0) {
      if (!olhouCartao) {
        cartao = indiceContas_()[chaveNome_(String(valores[col.conta] || ''))];
        olhouCartao = true;
      }
      dados[i][col.fatura_mes] = ehCartao_(cartao)
        ? mesDaFatura_(cartao, normalizarData_(dados[i][col.data]))
        : '';
    }

    aba.getRange(i + 2, 1, 1, largura).setValues([dados[i]]);
    ajustadas++;
  }
  return ajustadas;
}

/**
 * Registra o pagamento de uma conta fixa: vira um lançamento de verdade.
 *
 * O app nunca cria isto sozinho. Uma conta fixa é previsão até você dizer que
 * pagou — assim a planilha só guarda dinheiro que se moveu, e o saldo do mês
 * nunca afirma algo que não aconteceu.
 */
function pagarFixa_(pedido) {
  var nome = String(pedido.nome || '').trim();
  if (!nome) return { ok: false, erro: 'nome_vazio' };

  var mes = normalizarMes_(pedido.mes) || mesAtual_();
  var compromisso = recorrentesDoMes_(mes).filter(function (c) {
    return chaveNome_(c.nome) === chaveNome_(nome);
  })[0];

  if (!compromisso) return { ok: false, erro: 'compromisso_nao_encontrado' };

  // A data do pagamento: o dia do vencimento daquele mês, sem passar de hoje.
  var dia = Number(pedido.dia) || compromisso.dia || 1;
  var ultimoDia = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
  if (dia > ultimoDia) dia = ultimoDia;
  var data = pedido.data || (mes + '-' + (dia < 10 ? '0' + dia : String(dia)));
  if (data > hojeISO_()) data = hojeISO_();

  var valor = Number(pedido.valor) || compromisso.valor;

  var lancamento = {
    uuid: pedido.uuid || Utilities.getUuid(),
    data: data,
    tipo: compromisso.tipo || 'despesa',
    valor: valor,
    categoria: pedido.categoria || compromisso.categoria || 'Outros',
    descricao: pedido.descricao || nome,
    conta: pedido.conta || compromisso.conta || '',
    metodo: pedido.metodo || compromisso.metodo || '',
    fonte: pedido.fonte || '',
    pessoa: pedido.pessoa || compromisso.pessoa || '',
    texto_falado: '',
    origem: compromisso.tipo === TIPO.RECEITA ? 'renda mensal' : 'conta fixa',
    confianca: 'fixa',
    status: STATUS.OK
  };

  var r = lancar_({ lancamentos: [lancamento] });
  // Se nada foi gravado, é erro — e erro tem que aparecer na tela, não sumir
  // atrás de um "ok" que fecha o modal sem mudar nada.
  if (!r.gravados || !r.gravados.length) return { ok: false, erro: 'nao_gravou' };

  // Pagou um valor diferente do combinado? Você decide o que isso significa:
  // foi só desta vez (exceção) ou a conta mudou de preço (nova vigência).
  var ajuste = null;
  if (Math.abs(valor - compromisso.valor) >= 0.01 && pedido.ajuste && pedido.ajuste !== 'nenhum') {
    ajuste = aplicarRecorrente_({
      nome: nome,
      acao: pedido.ajuste === 'definir' ? 'definir' : 'excecao',
      valor: valor,
      tipo: compromisso.tipo,
      categoria: compromisso.categoria,
      dia: compromisso.dia,
      mes: mes
    });
  }

  return { ok: true, gravados: r.gravados, lancamento: lancamento, ajuste: ajuste };
}

/**
 * Transforma um lançamento avulso num compromisso fixo.
 *
 * O gasto que já aconteceu continua lançado — ele é um fato. O que nasce daqui
 * é a REGRA de que ele se repete, valendo deste mês em diante.
 */
function tornarMensal_(pedido) {
  if (!pedido.uuid) return { ok: false, erro: 'uuid_faltando' };

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var linha = acharLinhaPorUuid_(aba, pedido.uuid);
  if (!linha) return { ok: false, erro: 'nao_encontrado' };

  var col = indiceColunas_();
  var r = aba.getRange(linha, 1, 1, ABAS.lancamentos.length).getValues()[0];
  var data = normalizarData_(r[col.data]);

  var nome = String(pedido.nome || r[col.descricao] || r[col.categoria] || '').trim();
  if (!nome) return { ok: false, erro: 'nome_vazio' };

  var efeito = aplicarRecorrente_({
    nome: nome,
    acao: 'definir',
    valor: Number(pedido.valor) || Number(r[col.valor]) || 0,
    tipo: r[col.tipo] || 'despesa',
    categoria: r[col.categoria] || 'Outros',
    dia: Number(pedido.dia) || Number(data.slice(8, 10)) || '',
    conta: r[col.conta] || '',
    metodo: r[col.metodo] || '',
    pessoa: r[col.pessoa] || '',
    mes: pedido.mes || data.slice(0, 7),
    mes_fim: pedido.mes_fim || '',
    texto_falado: r[col.texto_falado] || ''
  });

  return { ok: true, recorrente: efeito, nome: nome };
}

/**
 * Marca como excluído em vez de apagar a linha: sai de todas as contas e
 * gráficos, mas continua na planilha caso você tenha errado o toque.
 */
/**
 * Excluir uma parcela exclui a compra inteira — ninguém devolve só a terceira
 * de cinco. Compra à vista tem grupo de uma linha só, então o caminho é o mesmo.
 */
function excluirLancamento_(pedido) {
  if (!pedido.uuid) return { ok: false, erro: 'uuid_faltando' };

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return { ok: false, erro: 'nao_encontrado' };

  var col = indiceColunas_();
  var base = grupoDoUuid_(pedido.uuid);
  var uuids = aba.getRange(2, col.uuid + 1, n, 1).getValues();
  var status = aba.getRange(2, col.status + 1, n, 1).getValues();
  var excluidos = 0;

  for (var i = 0; i < uuids.length; i++) {
    if (!ehDoGrupo_(uuids[i][0], base)) continue;
    if (status[i][0] === STATUS.EXCLUIDO) continue;
    status[i][0] = STATUS.EXCLUIDO;
    excluidos++;
  }
  if (!excluidos) return { ok: false, erro: 'nao_encontrado' };

  aba.getRange(2, col.status + 1, n, 1).setValues(status);
  atualizarResumo_();
  return { ok: true, uuid: pedido.uuid, excluidos: excluidos };
}

// ---------------------------------------------------------------------------
// Aprender categoria com a sua correção
// ---------------------------------------------------------------------------
//
// Corrigir a categoria uma vez tem que bastar. A descrição corrigida entra em
// palavras_chave da categoria certa — é a mesma coluna que o parser do app já
// lê, então não existe "memória" nova para manter: você vê e apaga na planilha.

// Descrições que dizem nada sobre o gasto. Aprender "compra" como Lazer faria
// toda compra futura virar Lazer. Mesma lista em src/lib/parser.js.
var DESCRICOES_GENERICAS = ['compra', 'compras', 'compra parcelada', 'outros', 'outro', 'pix',
  'gasto', 'gastos', 'pagamento', 'despesa', 'receita', 'lancamento', 'transferencia',
  'debito', 'credito', 'cartao', 'boleto', 'dinheiro', 'sem descricao'];

/** A descrição serve de palavra-chave? Curta, com letra, e não genérica. */
function chaveAprendivel_(descricao) {
  var t = semAcentoGS_(descricao).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < 3 || !/[a-z]/.test(t) || t.split(' ').length > 3) return '';
  return DESCRICOES_GENERICAS.indexOf(t) >= 0 ? '' : t;
}

/** Devolve { palavra, categoria } quando aprendeu algo novo; senão null. */
function aprenderCategoria_(descricao, categoria) {
  var chave = chaveAprendivel_(descricao);
  if (!chave || !categoria) return null;
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('categorias');
  if (!aba || aba.getLastRow() < 2) return null;

  var n = aba.getLastRow() - 1;
  var linhas = aba.getRange(2, 1, n, 4).getValues();
  var alvo = -1;
  linhas.forEach(function (r, i) { if (chaveNome_(r[0]) === chaveNome_(categoria)) alvo = i; });
  if (alvo < 0) return null;   // categoria que não está cadastrada: não inventa linha

  var novo = false;
  var colunas = linhas.map(function (r, i) {
    var lista = String(r[3] || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    var tem = lista.some(function (p) { return semAcentoGS_(p) === chave; });
    if (i === alvo && !tem) { lista.push(chave); novo = true; }
    // Numa categoria só: se estava em outra, sai de lá.
    if (i !== alvo && tem) lista = lista.filter(function (p) { return semAcentoGS_(p) !== chave; });
    return [lista.join(', ')];
  });

  aba.getRange(2, 4, n, 1).setValues(colunas);
  return novo ? { palavra: chave, categoria: linhas[alvo][0] } : null;
}

// ---------------------------------------------------------------------------
// Cadastros: contas, categorias, fontes e pessoas
// ---------------------------------------------------------------------------
//
// Os quatro se comportam igual: uma aba, a primeira coluna é o nome, a última
// diz se está ativo. Desativar em vez de apagar preserva os lançamentos antigos
// que apontam para aquele nome — eles continuam fazendo sentido no histórico.

var CADASTROS = {
  contas:     { aba: 'contas',     campos: ['nome', 'tipo', 'pessoa', 'dia_fechamento', 'dia_vencimento', 'saldo_inicial', 'ativo', 'rende_tipo', 'rende_pct'] },
  categorias: { aba: 'categorias', campos: ['categoria', 'grupo', 'tipo', 'palavras_chave', 'orcamento_mes', 'ativo'] },
  fontes:     { aba: 'fontes',     campos: ['nome', 'pessoa', 'tipo', 'ativo'] },
  pessoas:    { aba: 'pessoas',    campos: ['nome', 'ativo'] }
};

/** Tudo que o app precisa para preencher os seletores, numa chamada só. */
function cadastros_() {
  return {
    ok: true,
    // Vai tudo, ativo e desativado, com a marca `ativo`: a tela de cadastros
    // precisa listar o que está desativado para poder reativar; quem monta
    // seletor filtra por `ativo` na hora de mostrar.
    categorias: categoriasTodas_(),
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
  if (tipo === 'contas') garantirAbaContas_();
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

    if (tipo === 'contas' && (item.rende_tipo !== undefined || item.rende_pct !== undefined)) {
      var rc = rendeContaDe_(item.rende_tipo, item.rende_pct);
      // Cartão de crédito não tem saldo para render.
      if (String(item.tipo || (achado && achado.tipo) || '') === 'credito') rc = { tipo: '', pct: 0 };
      item.rende_tipo = rc.tipo;
      item.rende_pct = rc.pct || '';
      PROP.deleteProperty('RENDE_CONTAS_DIA');   // a renda do rendimento se refaz na próxima abertura
    }
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
  // Baú usa a coluna categoria para o próprio nome: renomear uma categoria
  // não pode arrastar o dinheiro guardado num baú que se chame igual.
  var tipos = coluna === 'categoria' ? aba.getRange(2, col.tipo + 1, n, 1).getValues() : null;
  var alvo = chaveNome_(de);
  var mudou = false;

  for (var i = 0; i < valores.length; i++) {
    if (tipos && ehBau_(tipos[i][0])) continue;
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
  if (!aba) return [];
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
      conta: r[c.conta] || '',
      metodo: r[c.metodo] || '',
      pessoa: r[c.pessoa] || '',
      inicio: normalizarMes_(r[c.vigencia_inicio]),
      fim: normalizarMes_(r[c.vigencia_fim]),
      escopo: r[c.escopo] || 'padrao',
      parcelas_total: Number(r[c.parcelas_total]) || 0,
      parcelas_restantes: Number(r[c.parcelas_restantes]) || 0
    };
  }).filter(function (r) {
    // Apagado não é apagado de verdade: a linha fica na planilha para o
    // histórico não mentir, mas some de tudo que calcula o mês.
    return r.nome && r.escopo !== ESCOPO_APAGADO;
  });
}

var ESCOPO_APAGADO = 'apagado';

/** As regras mensais de um mês, com o que a tela precisa para editar. */
function recorrentes_(pedido) {
  var mes = normalizarMes_(pedido && pedido.mes) || mesAtual_();
  return {
    ok: true,
    mes: mes,
    recorrentes: recorrentesDoMes_(mes).map(function (r) {
      return {
        nome: r.nome, tipo: r.tipo, valor: r.valor, dia: r.dia,
        categoria: r.categoria, conta: r.conta, metodo: r.metodo,
        pessoa: r.pessoa, excecao: r.excecao
      };
    })
  };
}

/**
 * Corrige uma regra mensal: o que ela é (nome, entrada ou saída) vale para
 * todas as vigências dela; o que ela custa neste momento (valor, dia, conta)
 * vale para a vigência deste mês.
 *
 * Existe porque uma regra nascida de uma frase mal-entendida — "adiantamento da
 * Mayara" virando despesa quando era o salário dela — não tinha conserto
 * nenhum: não dava para editar, nem apagar, e ela voltava todo mês.
 */
function salvarRecorrente_(pedido) {
  var nome = String(pedido.nome || '').trim();
  if (!nome) return { ok: false, erro: 'nome_vazio' };

  var mes = normalizarMes_(pedido.mes) || mesAtual_();
  var campos = pedido.campos || {};
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('recorrentes');
  var c = colunasRecorrentes_();
  var todos = lerRecorrentes_();
  var alvo = chaveNome_(nome);

  var daRegra = todos.filter(function (r) { return chaveNome_(r.nome) === alvo; });
  if (!daRegra.length) return { ok: false, erro: 'compromisso_nao_encontrado' };

  // Nome e tipo são a identidade da regra: mudam em todas as linhas dela.
  var novoNome = campos.nome !== undefined ? String(campos.nome).trim() : '';
  if (novoNome && chaveNome_(novoNome) !== alvo) {
    daRegra.forEach(function (r) { aba.getRange(r.linha, c.nome + 1).setValue(novoNome); });
  }
  if (campos.tipo === TIPO.RECEITA || campos.tipo === TIPO.DESPESA) {
    daRegra.forEach(function (r) { aba.getRange(r.linha, c.tipo + 1).setValue(campos.tipo); });
  }

  // O resto vale para a vigência que manda neste mês.
  var atual = valorNoMes_(todos, nome, mes);
  var linha = atual ? atual.registro.linha : daRegra[daRegra.length - 1].linha;

  if (campos.valor !== undefined) aba.getRange(linha, c.valor + 1).setValue(Number(campos.valor) || 0);
  if (campos.dia !== undefined) aba.getRange(linha, c.dia + 1).setValue(Number(campos.dia) || '');
  if (campos.categoria !== undefined) aba.getRange(linha, c.categoria + 1).setValue(campos.categoria);
  if (campos.conta !== undefined) aba.getRange(linha, c.conta + 1).setValue(campos.conta);
  if (campos.pessoa !== undefined) aba.getRange(linha, c.pessoa + 1).setValue(campos.pessoa);
  if (campos.mes_fim !== undefined) {
    aba.getRange(linha, c.vigencia_fim + 1).setValue(campos.mes_fim ? normalizarMes_(campos.mes_fim) : '');
  }

  return { ok: true, nome: novoNome || nome, mes: mes };
}

/**
 * "Caiu": promove um lançamento agendado a dinheiro de verdade. É o único
 * caminho — nem editar, nem esperar a data chegar fazem isso sozinhos, porque
 * a data prometida chegar não significa que o dinheiro entrou.
 */
function confirmarRecebimento_(pedido) {
  if (!pedido.uuid) return { ok: false, erro: 'uuid_faltando' };

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var linha = acharLinhaPorUuid_(aba, pedido.uuid);
  if (!linha) return { ok: false, erro: 'nao_encontrado' };

  var col = indiceColunas_();
  var faixa = aba.getRange(linha, 1, 1, ABAS.lancamentos.length);
  var v = faixa.getValues()[0];

  if (v[col.status] !== STATUS.AGENDADO) return { ok: false, erro: 'nao_agendado' };

  if (pedido.valor !== undefined && Number(pedido.valor)) v[col.valor] = Number(pedido.valor);
  // Caiu hoje, e não no dia que estava previsto? A data real é a que vale.
  if (pedido.data) v[col.data] = pedido.data;
  v[col.status] = STATUS.OK;
  faixa.setValues([v]);

  atualizarResumo_();
  return { ok: true, uuid: pedido.uuid, valor: Number(v[col.valor]) || 0 };
}

/**
 * Apaga uma regra mensal inteira — todas as vigências e exceções dela.
 * Para "não tenho mais isso a partir de agora", o certo é encerrar (aplicar
 * com acao 'encerrar'), que preserva os meses em que a conta existiu.
 */
function excluirRecorrente_(pedido) {
  var nome = String(pedido.nome || '').trim();
  if (!nome) return { ok: false, erro: 'nome_vazio' };

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('recorrentes');
  var c = colunasRecorrentes_();
  var alvo = chaveNome_(nome);
  var apagadas = 0;

  lerRecorrentes_().forEach(function (r) {
    if (chaveNome_(r.nome) !== alvo) return;
    aba.getRange(r.linha, c.escopo + 1).setValue(ESCOPO_APAGADO);
    apagadas++;
  });

  if (!apagadas) return { ok: false, erro: 'compromisso_nao_encontrado' };
  return { ok: true, nome: nome, apagadas: apagadas };
}

/** Encerra a regra: ela vale até o mês informado e não volta depois. */
function encerrarRecorrente_(pedido) {
  var nome = String(pedido.nome || '').trim();
  if (!nome) return { ok: false, erro: 'nome_vazio' };
  var mes = normalizarMes_(pedido.mes) || mesAtual_();
  return aplicarRecorrente_({ nome: nome, acao: 'encerrar', mes: mes, valor: 0 });
}

/**
 * "2026-09" de qualquer coisa que o Sheets tenha guardado na célula.
 *
 * O Google Sheets converte "2026-09" em data sozinho dependendo do formato da
 * coluna. Aí String(célula) vira "Tue Sep 01 2026..." e toda comparação de
 * vigência quebra em silêncio — o compromisso existe mas some das contas.
 */
function normalizarMes_(v) {
  if (!v && v !== 0) return '';
  if (v instanceof Date) return Utilities.formatDate(v, fuso_(), 'yyyy-MM');
  var t = String(v).trim();
  var iso = t.match(/^(\d{4})-(\d{1,2})/);
  if (iso) return iso[1] + '-' + (iso[2].length === 1 ? '0' + iso[2] : iso[2]);
  var br = t.match(/^(\d{1,2})\/(\d{4})$/);           // 09/2026
  if (br) return br[2] + '-' + (br[1].length === 1 ? '0' + br[1] : br[1]);
  var brData = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // 10/03/2029
  if (brData) return brData[3] + '-' + (brData[2].length === 1 ? '0' + brData[2] : brData[2]);
  var d = new Date(t);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, fuso_(), 'yyyy-MM');
  return t.slice(0, 7);
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
  return compromissosDoMes_(lerRecorrentes_(), mes);
}

/** A mesma coisa, com as regras já lidas — para não reler a aba 12 vezes. */
function compromissosDoMes_(todos, mes) {
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
      conta: r.registro.conta,
      metodo: r.registro.metodo,
      pessoa: r.registro.pessoa,
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
      conta: d.conta || (base && base.registro.conta) || '',
      metodo: d.metodo || (base && base.registro.metodo) || '',
      pessoa: d.pessoa || (base && base.registro.pessoa) || '',
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
      if (d.mes_fim) aba.getRange(r.linha, c.vigencia_fim + 1).setValue(normalizarMes_(d.mes_fim));
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
  // "todo mês até 10/03/2029" tem prazo: a vigência já nasce com fim.
  var fim = d.mes_fim ? normalizarMes_(d.mes_fim) : '';
  aba.appendRow(linhaRecorrente_({
    nome: d.nome,
    tipo: d.tipo || (anterior && anterior.tipo) || 'despesa',
    categoria: d.categoria || (anterior && anterior.categoria) || 'Outros',
    valor: d.valor,
    dia: d.dia || (anterior && anterior.dia) || '',
    conta: d.conta || (anterior && anterior.conta) || '',
    metodo: d.metodo || (anterior && anterior.metodo) || '',
    pessoa: d.pessoa || (anterior && anterior.pessoa) || '',
    inicio: mes, fim: fim, escopo: 'padrao',
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
    r.conta || '', r.metodo || '', r.pessoa || '',
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
    if (r[col.tipo] === TIPO.FATURA) return; // pagamento de fatura não é gasto novo
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

// ---------------------------------------------------------------------------
// Consertos manuais — rode uma vez no editor, se precisar
// ---------------------------------------------------------------------------
//
// Nada no app chama estas funções. Elas arrumam dados gravados antes de uma
// regra existir. Rodar de novo não faz mal.

/**
 * Conserta as compras parceladas que já estão na planilha lançadas pelo valor
 * cheio num mês só. Rode uma vez, à mão, no editor do Apps Script — depois
 * disso toda compra parcelada já nasce dividida. Rodar de novo não faz mal:
 * quem já tem parcelas é ignorado.
 */
function corrigirParcelasAntigas() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return 'Nada para corrigir.';

  var col = indiceColunas_();
  var largura = ABAS.lancamentos.length;
  var dados = aba.getRange(2, 1, n, largura).getValues();

  var existe = {};
  dados.forEach(function (r) { existe[String(r[col.uuid])] = true; });

  var novas = [], relato = [];

  for (var i = 0; i < dados.length; i++) {
    var r = dados[i];
    if (r[col.status] !== STATUS.OK) continue;
    if (Math.round(Number(r[col.parcelas_total]) || 0) < 2) continue;

    var uuid = String(r[col.uuid]);
    if (grupoDoUuid_(uuid) !== uuid) continue;   // já é parcela derivada
    if (existe[uuid + '-p2']) continue;          // já foi dividida antes

    var l = {};
    ABAS.lancamentos.forEach(function (nome, c) { l[nome] = r[c]; });
    l.data = normalizarData_(l.data);
    l.fatura_mes = l.fatura_mes ? normalizarMes_(l.fatura_mes) : '';

    var partes = expandirParcelas_(l);
    if (partes.length < 2) continue;

    var primeira = linhaDe_(partes[0]);
    primeira[col.hora_registro] = r[col.hora_registro];   // preserva o registro original
    aba.getRange(i + 2, 1, 1, largura).setValues([primeira]);

    for (var k = 1; k < partes.length; k++) {
      var linha = linhaDe_(partes[k]);
      linha[col.hora_registro] = r[col.hora_registro];
      novas.push(linha);
      existe[partes[k].uuid] = true;
    }

    relato.push((l.descricao || l.categoria || uuid) + ': ' +
      arred_(l.valor).toFixed(2) + ' em ' + partes.length + 'x de ' +
      partes[1].valor.toFixed(2));
  }

  if (novas.length) {
    aba.getRange(aba.getLastRow() + 1, 1, novas.length, largura).setValues(novas);
    atualizarResumo_();
  }
  return relato.length ? relato.join('\n') : 'Nenhuma compra parcelada precisava de conserto.';
}

/**
 * Conserta as receitas com data futura que foram gravadas antes de existir o
 * estado "agendado" — elas estão contando como recebidas sem ter caído.
 * Rode uma vez, à mão, no editor. Rodar de novo não faz mal.
 */
function marcarReceitasFuturasComoAgendadas() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  if (n <= 0) return 'Planilha vazia.';

  var col = indiceColunas_();
  var dados = aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues();
  var hoje = hojeISO_();
  var mexidas = [];

  for (var i = 0; i < dados.length; i++) {
    if (dados[i][col.status] !== STATUS.OK) continue;
    if (dados[i][col.tipo] !== TIPO.RECEITA) continue;
    if (normalizarData_(dados[i][col.data]) <= hoje) continue;
    aba.getRange(i + 2, col.status + 1).setValue(STATUS.AGENDADO);
    mexidas.push(dados[i][col.descricao] + ' (' + normalizarData_(dados[i][col.data]) + ')');
  }

  if (mexidas.length) atualizarResumo_();
  var texto = mexidas.length
    ? mexidas.length + ' receitas futuras viraram agendadas:\n' + mexidas.join('\n')
    : 'Nenhuma receita futura para ajustar.';
  Logger.log(texto);
  return texto;
}

// ---------------------------------------------------------------------------
// Avisos no celular (notificação do próprio app, Web Push)
// ---------------------------------------------------------------------------
// Todo dia ao meio-dia o script vê as contas fixas que vencem hoje, amanhã ou já
// venceram sem lançamento e "cutuca" cada celular inscrito. O aviso vai VAZIO
// (sem conteúdo): quem monta o texto é o service worker do app, que pergunta
// ao script (ação `avisos`) o que mostrar. Assim não é preciso criptografar o
// conteúdo — só assinar o pedido (VAPID, ECDSA P-256), feito aqui em JS puro.
//
// As chaves VAPID nascem sozinhas na primeira vez e moram nas propriedades do
// script. Os celulares inscritos também (`INSCRICOES`).

var SERVICOS_PUSH = [
  /^https:\/\/fcm\.googleapis\.com\//,
  /^https:\/\/[a-z0-9.-]*push\.services\.mozilla\.com\//,
  /^https:\/\/web\.push\.apple\.com\//,
  /^https:\/\/[a-z0-9.-]*\.notify\.windows\.com\//
];
var MAX_INSCRICOES = 10;
var HORA_DOS_AVISOS = 12;   // meio-dia (entre 12h e 13h, no fuso da planilha)

// --- Matemática da curva P-256 (BigInt) ---------------------------------------

// Criada na primeira vez que é usada: se o script rodasse num motor sem BigInt,
// só os avisos falhariam — o resto do app continua de pé.
var EC_ = null;
function ec_() {
  if (EC_) return EC_;
  var B = function (h) { return BigInt('0x' + h); };
  EC_ = {
    p: B('ffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
    n: B('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
    b: B('5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'),
    gx: B('6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
    gy: B('4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'),
    zero: BigInt(0), um: BigInt(1), dois: BigInt(2), tres: BigInt(3), oito: BigInt(8)
  };
  return EC_;
}

function modEc_(a, m) { var r = a % m; return r < ec_().zero ? r + m : r; }

function invEc_(a, m) {
  ec_();
  var t = EC_.zero, novoT = EC_.um, r = m, novoR = modEc_(a, m);
  while (novoR !== EC_.zero) {
    var q = r / novoR, tmp;
    tmp = t - q * novoT; t = novoT; novoT = tmp;
    tmp = r - q * novoR; r = novoR; novoR = tmp;
  }
  return modEc_(t, m);
}

// Pontos em coordenadas jacobianas [X, Y, Z]; Z = 0 é o infinito.
function dobrarEc_(P) {
  ec_();
  var p = EC_.p, X = P[0], Y = P[1], Z = P[2];
  if (Z === EC_.zero || Y === EC_.zero) return [EC_.zero, EC_.um, EC_.zero];
  var ZZ = modEc_(Z * Z, p);
  var M = modEc_(EC_.tres * (X - ZZ) * (X + ZZ), p);          // a = −3
  var YY = modEc_(Y * Y, p);
  var S = modEc_(BigInt(4) * X * YY, p);
  var X3 = modEc_(M * M - EC_.dois * S, p);
  var Y3 = modEc_(M * (S - X3) - EC_.oito * YY * YY, p);
  var Z3 = modEc_(EC_.dois * Y * Z, p);
  return [X3, Y3, Z3];
}

function somarEc_(P, Q) {
  ec_();
  if (P[2] === EC_.zero) return Q;
  if (Q[2] === EC_.zero) return P;
  var p = EC_.p;
  var Z1Z1 = modEc_(P[2] * P[2], p), Z2Z2 = modEc_(Q[2] * Q[2], p);
  var U1 = modEc_(P[0] * Z2Z2, p), U2 = modEc_(Q[0] * Z1Z1, p);
  var S1 = modEc_(P[1] * Q[2] * Z2Z2, p), S2 = modEc_(Q[1] * P[2] * Z1Z1, p);
  if (U1 === U2) return S1 === S2 ? dobrarEc_(P) : [EC_.zero, EC_.um, EC_.zero];
  var H = modEc_(U2 - U1, p), R = modEc_(S2 - S1, p);
  var HH = modEc_(H * H, p), HHH = modEc_(H * HH, p), V = modEc_(U1 * HH, p);
  var X3 = modEc_(R * R - HHH - EC_.dois * V, p);
  var Y3 = modEc_(R * (V - X3) - S1 * HHH, p);
  var Z3 = modEc_(H * P[2] * Q[2], p);
  return [X3, Y3, Z3];
}

/** k·G em coordenadas comuns [x, y]. */
function multiplicarEc_(k) {
  ec_();
  var R = [EC_.zero, EC_.um, EC_.zero], P = [EC_.gx, EC_.gy, EC_.um];
  while (k > EC_.zero) {
    if (k & EC_.um) R = somarEc_(R, P);
    P = dobrarEc_(P);
    k = k >> EC_.um;
  }
  var zi = invEc_(R[2], EC_.p), zi2 = modEc_(zi * zi, EC_.p);
  return [modEc_(R[0] * zi2, EC_.p), modEc_(R[1] * zi2 * zi, EC_.p)];
}

// --- Bytes ---------------------------------------------------------------------

function bytesSemSinal_(b) { return b.map(function (x) { return x < 0 ? x + 256 : x; }); }
function bytesComSinal_(b) { return b.map(function (x) { return x > 127 ? x - 256 : x; }); }
function bigDeBytes_(b) {
  ec_();
  return BigInt('0x' + (bytesSemSinal_(b).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('') || '0'));
}
function bytesDeBig_(n, tamanho) {
  var h = n.toString(16);
  while (h.length < tamanho * 2) h = '0' + h;
  var saida = [];
  for (var i = 0; i < tamanho * 2; i += 2) saida.push(parseInt(h.substr(i, 2), 16));
  return saida;
}
function b64url_(bytesSemSinal) {
  return Utilities.base64EncodeWebSafe(bytesComSinal_(bytesSemSinal)).replace(/=+$/, '');
}
function sha256_(bytesSemSinal) {
  return bytesSemSinal_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytesComSinal_(bytesSemSinal)));
}
function hmac_(chave, dados) {
  return bytesSemSinal_(Utilities.computeHmacSha256Signature(bytesComSinal_(dados), bytesComSinal_(chave)));
}
function utf8_(texto) { return bytesSemSinal_(Utilities.newBlob(texto).getBytes()); }

/** ECDSA P-256 com SHA-256 e k determinístico (RFC 6979). Devolve r‖s (64 bytes). */
function assinarEs256_(mensagem, d) {
  ec_();
  var n = EC_.n;
  var h = sha256_(mensagem);
  var x = bytesDeBig_(d, 32);
  var h1 = bytesDeBig_(modEc_(bigDeBytes_(h), n), 32);
  var V = [], K = [];
  for (var i = 0; i < 32; i++) { V.push(1); K.push(0); }
  K = hmac_(K, V.concat([0], x, h1)); V = hmac_(K, V);
  K = hmac_(K, V.concat([1], x, h1)); V = hmac_(K, V);
  var e = bigDeBytes_(h);
  for (var tentativa = 0; tentativa < 100; tentativa++) {
    V = hmac_(K, V);
    var k = bigDeBytes_(V);
    if (k > EC_.zero && k < n) {
      var r = modEc_(multiplicarEc_(k)[0], n);
      var s = modEc_(invEc_(k, n) * (e + r * d), n);
      if (r !== EC_.zero && s !== EC_.zero) return bytesDeBig_(r, 32).concat(bytesDeBig_(s, 32));
    }
    K = hmac_(K, V.concat([0])); V = hmac_(K, V);
  }
  throw new Error('assinatura');
}

/** As chaves VAPID deste script: criadas na primeira vez, guardadas nas propriedades. */
function chavesVapid_() {
  ec_();
  var salva = PROP.getProperty('VAPID_PRIVADA');
  if (!salva) {
    var semente = utf8_(Utilities.getUuid() + Utilities.getUuid() + Date.now() + Utilities.getUuid());
    var d = modEc_(bigDeBytes_(sha256_(semente)), EC_.n - EC_.um) + EC_.um;
    salva = d.toString(16);
    PROP.setProperty('VAPID_PRIVADA', salva);
    PROP.deleteProperty('VAPID_PUBLICA');
  }
  var dd = BigInt('0x' + salva);
  var publica = PROP.getProperty('VAPID_PUBLICA');
  if (!publica) {
    var Q = multiplicarEc_(dd);
    publica = b64url_([4].concat(bytesDeBig_(Q[0], 32), bytesDeBig_(Q[1], 32)));
    PROP.setProperty('VAPID_PUBLICA', publica);
  }
  return { d: dd, publica: publica };
}

/** O cabeçalho Authorization do pedido de aviso (JWT ES256 do VAPID). */
function autorizacaoVapid_(endpoint) {
  var chaves = chavesVapid_();
  var origem = endpoint.match(/^https:\/\/[^/]+/)[0];
  var email = '';
  try { email = Session.getEffectiveUser().getEmail(); } catch (e) {}
  var cab = b64url_(utf8_(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  var corpo = b64url_(utf8_(JSON.stringify({
    aud: origem, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:' + (email || 'avisos@quanto-posso-gastar.app')
  })));
  var assinatura = b64url_(assinarEs256_(utf8_(cab + '.' + corpo), chaves.d));
  return 'vapid t=' + cab + '.' + corpo + '.' + assinatura + ', k=' + chaves.publica;
}

// --- Inscrições --------------------------------------------------------------

function lerInscricoes_() {
  try { return JSON.parse(PROP.getProperty('INSCRICOES') || '[]'); } catch (e) { return []; }
}
function gravarInscricoes_(lista) { PROP.setProperty('INSCRICOES', JSON.stringify(lista.slice(-MAX_INSCRICOES))); }

function vapidPublica_() { return { ok: true, chave: chavesVapid_().publica }; }

function inscrever_(pedido) {
  var endpoint = String((pedido.inscricao && pedido.inscricao.endpoint) || '');
  if (!SERVICOS_PUSH.some(function (r) { return r.test(endpoint); })) return { ok: false, erro: 'servico_desconhecido' };
  var lista = lerInscricoes_().filter(function (i) { return i.endpoint !== endpoint; });
  lista.push({
    endpoint: endpoint,
    pessoa: String(pedido.pessoa || '').slice(0, 60),
    aparelho: String(pedido.aparelho || '').slice(0, 60),
    desde: hojeISO_()
  });
  gravarInscricoes_(lista);
  ligarGatilhoAvisos_();
  return { ok: true, inscritos: lista.length };
}

function desinscrever_(pedido) {
  var endpoint = String(pedido.endpoint || '');
  var lista = lerInscricoes_().filter(function (i) { return i.endpoint !== endpoint; });
  gravarInscricoes_(lista);
  return { ok: true, inscritos: lista.length };
}

/**
 * Garante UM gatilho diário na hora de HORA_DOS_AVISOS. Se a hora mudou desde
 * que o gatilho foi criado (era 8h), apaga o antigo e cria o novo. Devolve
 * true quando precisou trocar.
 */
function ligarGatilhoAvisos_() {
  var meus = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'avisarContasDoDia';
  });
  var horaCerta = String(PROP.getProperty('AVISOS_HORA') || '') === String(HORA_DOS_AVISOS);
  if (meus.length === 1 && horaCerta) return false;
  meus.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('avisarContasDoDia').timeBased().atHour(HORA_DOS_AVISOS).everyDays(1).create();
  PROP.setProperty('AVISOS_HORA', String(HORA_DOS_AVISOS));
  return meus.length > 0;
}

// --- O que avisar -------------------------------------------------------------

/**
 * As contas fixas do mês que pedem atenção hoje: vencem hoje, amanhã, ou já
 * venceram e não foram lançadas. Devolve o texto pronto do aviso (ou nada).
 */
function avisosDeHoje_() {
  var hoje = hojeISO_();
  var dia = Number(hoje.slice(8, 10));
  var teste = Number(PROP.getProperty('AVISO_TESTE') || 0);
  if (teste && Date.now() - teste < 10 * 60 * 1000) {
    PROP.deleteProperty('AVISO_TESTE');
    return { ok: true, avisos: [{ titulo: '⚔️ Os avisos estão ligados', corpo: 'É assim que os chefes do mês vão te avisar: no dia, na véspera e quando atacarem.', tag: 'teste' }] };
  }
  var fixas = (painel_({ mes: hoje.slice(0, 7) }).fixas || []).filter(function (f) { return !f.lancado && f.dia; });
  var atacando = fixas.filter(function (f) { return Number(f.dia) < dia; });
  var hojeVence = fixas.filter(function (f) { return Number(f.dia) === dia; });
  var amanha = fixas.filter(function (f) { return Number(f.dia) === dia + 1; });
  var lista = [];
  var reais = function (v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','); };
  var nomes = function (l) { return l.map(function (f) { return f.nome + ' ' + reais(f.valor); }).join(' · '); };
  if (hojeVence.length) {
    lista.push({ titulo: hojeVence.length === 1 ? '⚔️ O chefe ' + hojeVence[0].nome + ' ataca hoje' : '⚔️ ' + hojeVence.length + ' chefes atacam hoje',
      corpo: nomes(hojeVence), tag: 'hoje' });
  }
  if (amanha.length) {
    lista.push({ titulo: amanha.length === 1 ? '🛡️ ' + amanha[0].nome + ' vence amanhã' : '🛡️ ' + amanha.length + ' contas vencem amanhã',
      corpo: nomes(amanha), tag: 'amanha' });
  }
  if (atacando.length) {
    lista.push({ titulo: '🔥 ' + (atacando.length === 1 ? atacando[0].nome + ' está atacando' : atacando.length + ' chefes atacando'),
      corpo: 'Venceu e não foi lançado: ' + nomes(atacando), tag: 'atacando' });
  }
  return { ok: true, avisos: lista };
}

/** Manda o "cutucão" para um celular. 404/410 = o celular saiu: some da lista. */
function cutucar_(endpoint) {
  var r = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    headers: { Authorization: autorizacaoVapid_(endpoint), TTL: '43200', Urgency: 'high' },
    payload: '',
    muteHttpExceptions: true
  });
  return r.getResponseCode();
}

/** O gatilho diário (meio-dia). Só cutuca se houver o que avisar. */
function avisarContasDoDia() {
  // Gatilho da hora antiga (8h)? Troca pelo do meio-dia e não avisa agora.
  if (ligarGatilhoAvisos_()) return { ok: true, enviados: 0, gatilho: 'trocado' };
  var inscritos = lerInscricoes_();
  if (!inscritos.length) return { ok: true, enviados: 0 };
  if (!avisosDeHoje_().avisos.length) return { ok: true, enviados: 0 };
  var ficam = [], enviados = 0;
  inscritos.forEach(function (i) {
    var codigo = 0;
    try { codigo = cutucar_(i.endpoint); } catch (e) { codigo = 0; }
    if (codigo === 404 || codigo === 410) return;
    if (codigo >= 200 && codigo < 300) enviados++;
    ficam.push(i);
  });
  gravarInscricoes_(ficam);
  return { ok: true, enviados: enviados };
}

/** "Mandar um aviso de teste" nos Ajustes: cutuca só este celular, já. */
function testarAviso_(pedido) {
  var endpoint = String(pedido.endpoint || '');
  if (!lerInscricoes_().some(function (i) { return i.endpoint === endpoint; })) return { ok: false, erro: 'nao_inscrito' };
  PROP.setProperty('AVISO_TESTE', String(Date.now()));
  var codigo = cutucar_(endpoint);
  if (codigo === 404 || codigo === 410) { desinscrever_({ endpoint: endpoint }); return { ok: false, erro: 'inscricao_expirou' }; }
  return codigo >= 200 && codigo < 300 ? { ok: true } : { ok: false, erro: 'push_' + codigo };
}

// ---------------------------------------------------------------------------
// Dinheiro nas contas e rendimento automático do saldo
// ---------------------------------------------------------------------------
//
// O saldo de uma conta não é a soma de tudo desde sempre: o app só conhece o
// que foi lançado, e quase nunca é tudo. Então o saldo parte de um valor
// CONFERIDO com o banco (aba `saldos`: você digita, ou o extrato importado traz
// o saldo final) e anda com o que foi lançado depois dele — entradas, gastos no
// débito/Pix, faturas pagas, o que foi para os baús ou voltou deles.
//
// Conta que rende "% do CDI" (Nubank, Mercado Pago…) ganha o rendimento dia
// útil a dia útil sobre o saldo do fim do dia, já líquido de IR. Esse
// rendimento entra como RENDA, um pouco por dia: uma linha por conta e por mês
// em `lancamentos` (origem `rendimento_conta`) que o script atualiza uma vez
// por dia — o livre para gastar e o ouro de hoje sobem junto.
// Conta "vem do extrato" (Itaú REND PAGO) não é estimada: o rendimento chega
// pela importação do extrato, como qualquer entrada.

var TIPOS_RENDE_CONTA = ['', 'cdi', 'extrato'];
var IR_CONTA = 0.225;          // dinheiro de conta gira rápido: quase sempre menos de 180 dias
var ORIGEM_RENDE_CONTA = 'rendimento_conta';
var ORIGENS_SALDO = ['manual', 'extrato'];
var MAX_SALDO_CONTA = 100000000;

/** O jeito que o saldo da conta rende, já conferido. */
function rendeContaDe_(tipo, pct) {
  tipo = String(tipo || '').trim().toLowerCase();
  if (TIPOS_RENDE_CONTA.indexOf(tipo) < 0) tipo = '';
  if (tipo !== 'cdi') return { tipo: tipo, pct: 0 };
  var p = Number(String(pct === undefined || pct === null ? '' : pct).replace(',', '.'));
  if (!(p > 0)) p = 100;
  return { tipo: 'cdi', pct: Math.min(300, p) };
}

/** Planilha antiga: a aba `contas` ganha as colunas de rendimento sem perder nada. */
var CONTAS_CONFERIDA_ = false;
function garantirAbaContas_() {
  if (CONTAS_CONFERIDA_) return;
  CONTAS_CONFERIDA_ = true;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('contas');
  if (!aba) return;
  var largura = Math.max(aba.getLastColumn(), 1);
  var cab = aba.getRange(1, 1, 1, largura).getValues()[0]
    .map(function (c) { return String(c || '').trim(); });
  var igual = ABAS.contas.every(function (c, i) { return cab[i] === c; });
  if (!igual) prepararAba_(ss, 'contas');
}

function abaSaldos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('saldos');
  if (!aba) { prepararAba_(ss, 'saldos'); aba = ss.getSheetByName('saldos'); }
  return aba;
}

/** Contas que guardam dinheiro (cartão de crédito não: lá mora dívida). */
function contasComSaldo_() {
  return lerCadastro_('contas')
    .filter(function (c) { return c.ativo && c.tipo !== 'credito'; })
    .map(function (c) {
      return { nome: c.nome, chave: chaveNome_(c.nome), tipo: c.tipo || '', pessoa: c.pessoa || '',
               rende: rendeContaDe_(c.rende_tipo, c.rende_pct) };
    });
}

function msDe_(v) {
  if (v instanceof Date) return v.getTime();
  var t = Date.parse(String(v || ''));
  return isNaN(t) ? 0 : t;
}

/** Os saldos conferidos, do mais antigo para o mais novo. */
function lerSaldosConferidos_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('saldos');
  if (!aba) return [];
  var n = aba.getLastRow() - 1;
  if (n <= 0) return [];
  return aba.getRange(2, 1, n, ABAS.saldos.length).getValues()
    .filter(function (r) { return r[0] && normalizarData_(r[1]); })
    .map(function (r, i) {
      return {
        conta: String(r[0]), chave: chaveNome_(r[0]), data: normalizarData_(r[1]),
        saldo: Number(r[2]) || 0, origem: String(r[3] || 'manual'),
        registrado_em: msDe_(r[4]), calculado: r[5] === '' || r[5] === null || r[5] === undefined ? null : Number(r[5]),
        ordem: i
      };
    })
    .sort(function (a, b) {
      return a.data < b.data ? -1 : a.data > b.data ? 1 : a.registrado_em - b.registrado_em || a.ordem - b.ordem;
    });
}

/**
 * Quanto um lançamento mexe no saldo da conta dele (+ entra, − sai), ou null
 * quando não mexe: compra no crédito vira fatura, acerto de baú não é dinheiro
 * da conta, e o rendimento automático é contado pelo próprio cálculo.
 */
function efeitoNaConta_(r, col, contasIdx) {
  if (r[col.status] !== STATUS.OK) return null;
  if (String(r[col.origem] || '') === ORIGEM_RENDE_CONTA) return null;
  var v = Number(r[col.valor]) || 0;
  switch (r[col.tipo]) {
    case TIPO.RECEITA: return v;
    case TIPO.DESPESA: return ehCartao_(contasIdx[chaveNome_(String(r[col.conta] || ''))]) ? null : -v;
    case TIPO.FATURA: return -v;
    case TIPO.GUARDAR: return -v;
    case TIPO.RESGATAR: return v;
    default: return null;
  }
}

/**
 * Refaz a vida de cada conta a partir do primeiro saldo conferido: dia a dia,
 * conferências e lançamentos na ordem em que aconteceram, e o rendimento de
 * cada dia útil sobre o saldo do fim do dia (hoje ainda não rendeu).
 *
 * Conferência manual vale no momento em que foi feita: lançamento do mesmo dia
 * registrado depois dela ainda mexe no saldo. A do extrato vale no fim do dia.
 */
function estadoDasContas_(linhas, serie, hoje) {
  var col = indiceColunas_();
  var contasIdx = indiceContas_();
  var contas = contasComSaldo_();
  var conferidos = lerSaldosConferidos_();
  var porChave = {};
  contas.forEach(function (c) { porChave[c.chave] = { cfg: c, cps: [], movs: [] }; });
  conferidos.forEach(function (cp) { if (porChave[cp.chave]) porChave[cp.chave].cps.push(cp); });

  (linhas || []).forEach(function (r, i) {
    var k = chaveNome_(String(r[col.conta] || ''));
    var alvo = porChave[k];
    if (!alvo || !alvo.cps.length) return;
    var e = efeitoNaConta_(r, col, contasIdx);
    if (e === null || !e) return;
    var data = normalizarData_(r[col.data]);
    if (!data || data > hoje || data < alvo.cps[0].data) return;   // antes da 1ª conferência não importa
    alvo.movs.push({ data: data, valor: e, ms: msDe_(r[col.hora_registro]), ordem: i });
  });

  var aviso = { estimado: !!(serie && serie.estimado) };
  var cdiDia = serie ? serie.ultima : Math.pow(1 + CDI_PADRAO_ANUAL, 1 / 252) - 1;

  return contas.map(function (c) {
    var a = porChave[c.chave];
    var item = { nome: c.nome, tipo: c.tipo, pessoa: c.pessoa, rende: c.rende,
                 saldo: null, conferido: null, entrou: 0, saiu: 0, rendeu: 0,
                 por_mes: {}, rende_por_mes: 0, acertos: [], fim_do_dia: {} };
    if (!a.cps.length) return item;

    // Linha do tempo: cada coisa com o seu dia e o seu momento no dia.
    var eventos = [];
    a.cps.forEach(function (cp) {
      eventos.push({ data: cp.data, ms: cp.origem === 'extrato' ? Infinity : cp.registrado_em, cp: cp, ordem: cp.ordem });
    });
    a.movs.forEach(function (m) {
      // Do dia de uma conferência do extrato para trás, o extrato já contou tudo.
      eventos.push({ data: m.data, ms: m.ms, mov: m.valor, ordem: 1e6 + m.ordem });
    });
    eventos.sort(function (x, y) {
      return x.data < y.data ? -1 : x.data > y.data ? 1 : (x.ms - y.ms) || (x.ordem - y.ordem);
    });

    var cfgTaxa = { tipo: 'cdi', pct: c.rende.pct, acima: c.rende.pct, limite: 0 };
    var saldo = null, ultimo = null, i = 0;
    var d = eventos[0].data;
    while (d <= hoje) {
      while (i < eventos.length && eventos[i].data === d) {
        var e = eventos[i++];
        if (e.cp) {
          var dif = saldo === null ? null : arred_(e.cp.saldo - saldo);
          saldo = e.cp.saldo;
          ultimo = e.cp;
          item.entrou = 0; item.saiu = 0; item.rendeu = 0;
          item.acertos.push({ data: e.cp.data, saldo: arred_(e.cp.saldo), origem: e.cp.origem,
                              diferenca: e.cp.calculado !== null ? arred_(e.cp.saldo - e.cp.calculado) : dif });
        } else if (saldo !== null) {
          saldo += e.mov;
          if (e.mov > 0) item.entrou += e.mov; else item.saiu -= e.mov;
        }
      }
      if (saldo !== null) {
        if (d < hoje && c.rende.tipo === 'cdi' && saldo > 0) {
          var tx = taxaDoDia_(cfgTaxa, serie, d, aviso);
          if (tx) {
            var y = saldo * tx.ate * (1 - IR_CONTA);
            saldo += y; item.rendeu += y;
            somar_(item.por_mes, d.slice(0, 7), y);
          }
        }
        item.fim_do_dia[d] = saldo;
      }
      d = diaISOMais_(d, 1);
    }
    while (i < eventos.length) { var resto = eventos[i++]; if (resto.mov && saldo !== null) saldo += resto.mov; }

    item.saldo = arred_(saldo);
    item.conferido = { data: ultimo.data, saldo: arred_(ultimo.saldo), origem: ultimo.origem };
    item.entrou = arred_(item.entrou); item.saiu = arred_(item.saiu); item.rendeu = arred_(item.rendeu);
    Object.keys(item.por_mes).forEach(function (m) { item.por_mes[m] = arred_(item.por_mes[m]); });
    item.acertos = item.acertos.slice(-12).reverse();
    if (c.rende.tipo === 'cdi') {
      var mensal = Math.pow(1 + cdiDia * c.rende.pct / 100, DIAS_UTEIS_MES) - 1;
      item.rende_por_mes = arred_(Math.max(0, saldo) * mensal * (1 - IR_CONTA));
    }
    return item;
  }).map(function (item) {
    item._estimado = !!aviso.estimado;
    return item;
  });
}

function algumaContaRende_() {
  return contasComSaldo_().some(function (c) { return c.rende.tipo === 'cdi'; });
}

function uuidRendeConta_(conta, mes) {
  return 'rend-' + semAcentoGS_(String(conta)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + mes;
}

function ultimoDiaDoMes_(mes) {
  var d = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
  return mes + '-' + (d < 10 ? '0' + d : d);
}

/**
 * O rendimento vira renda, um pouco por dia: atualiza (ou cria) a linha do mês
 * de cada conta que rende pelo CDI. Roda uma vez por dia — na primeira vez que
 * o app abre o mês — ou na hora, depois de um acerto ou de mudar a conta.
 * Só mexe no mês atual e no anterior: mês fechado há tempo não muda sozinho.
 */
function atualizarRendimentosContas_(forcar) {
  var hoje = hojeISO_();
  if (!forcar && PROP.getProperty('RENDE_CONTAS_DIA') === hoje) return { ok: true, mudou: 0 };
  if (!lerSaldosConferidos_().length) {
    PROP.setProperty('RENDE_CONTAS_DIA', hoje);
    return { ok: true, mudou: 0 };
  }
  var trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
    var n = aba.getLastRow() - 1;
    var col = indiceColunas_();
    var linhas = n > 0 ? aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues() : [];
    var primeiro = lerSaldosConferidos_()[0].data;
    var estados = estadoDasContas_(linhas, algumaContaRende_() ? serieCdi_(primeiro) : null, hoje);

    var linhaDoUuid = {};
    linhas.forEach(function (r, i) { linhaDoUuid[String(r[col.uuid])] = i; });
    var mesHoje = hoje.slice(0, 7);
    var meses = [mesAnterior_(mesHoje), mesHoje];
    var novas = [], mudou = 0;

    estados.forEach(function (c) {
      if (c.saldo === null) return;
      meses.forEach(function (mes) {
        // Deixou de render pelo CDI: a linha do mês (se houver) volta a zero.
        var valor = c.rende.tipo === 'cdi' ? arred_(c.por_mes[mes] || 0) : 0;
        var uuid = uuidRendeConta_(c.nome, mes);
        var data = mes === mesHoje ? hoje : ultimoDiaDoMes_(mes);
        var i = linhaDoUuid[uuid];
        if (i !== undefined) {
          var r = linhas[i];
          if (Math.abs((Number(r[col.valor]) || 0) - valor) < 0.005 && normalizarData_(r[col.data]) === data) return;
          aba.getRange(i + 2, col.valor + 1).setValue(valor);
          aba.getRange(i + 2, col.data + 1).setValue(data);
          mudou++;
          return;
        }
        if (valor < 0.01) return;
        novas.push(linhaDe_({
          uuid: uuid, data: data, tipo: TIPO.RECEITA, valor: valor, categoria: 'Rendimento',
          descricao: 'Rendimento ' + c.nome, conta: c.nome, pessoa: c.pessoa,
          origem: ORIGEM_RENDE_CONTA, confianca: 'automatico', status: STATUS.OK
        }));
      });
    });
    if (novas.length) {
      aba.getRange(aba.getLastRow() + 1, 1, novas.length, ABAS.lancamentos.length).setValues(novas);
      mudou += novas.length;
    }
    if (mudou) atualizarResumo_();
    PROP.setProperty('RENDE_CONTAS_DIA', hoje);
    return { ok: true, mudou: mudou };
  } finally {
    trava.releaseLock();
  }
}

/** Antes de mostrar o mês: o rendimento de ontem já tem que estar lá. Nunca derruba a tela. */
function rendimentoDoDia_() {
  try { atualizarRendimentosContas_(false); } catch (e) { /* amanhã tenta de novo */ }
}

/** Mês → Resumo, "Dinheiro nas contas". */
function contasSaldo_() {
  rendimentoDoDia_();
  var hoje = hojeISO_();
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  var linhas = n > 0 ? aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues() : [];
  var conferidos = lerSaldosConferidos_();
  var precisaCdi = conferidos.length && algumaContaRende_();
  var serie = precisaCdi ? serieCdi_(conferidos[0].data) : null;
  var estados = estadoDasContas_(linhas, serie, hoje);
  var mes = hoje.slice(0, 7);

  // O que já entrou como renda em cada mês (as linhas automáticas, como estão na planilha).
  var col = indiceColunas_();
  var entrou = {};
  linhas.forEach(function (r) {
    if (String(r[col.origem] || '') !== ORIGEM_RENDE_CONTA || r[col.status] !== STATUS.OK) return;
    var k = chaveNome_(String(r[col.conta] || ''));
    if (!entrou[k]) entrou[k] = [];
    entrou[k].push({ mes: normalizarData_(r[col.data]).slice(0, 7), valor: arred_(Number(r[col.valor]) || 0) });
  });

  var total = 0, rendeuMes = 0;
  var lista = estados.map(function (c) {
    if (c.saldo !== null) total += c.saldo;
    rendeuMes += c.por_mes[mes] || 0;
    var hist = (entrou[chaveNome_(c.nome)] || []).sort(function (a, b) { return a.mes < b.mes ? 1 : -1; }).slice(0, 12);
    return {
      nome: c.nome, tipo: c.tipo, pessoa: c.pessoa, rende: c.rende,
      saldo: c.saldo, conferido: c.conferido,
      entrou: c.entrou, saiu: c.saiu, rendeu: c.rendeu,
      rendeu_mes: arred_(c.por_mes[mes] || 0), rende_por_mes: c.rende_por_mes,
      rendimentos: hist, acertos: c.acertos
    };
  });
  return {
    ok: true,
    contas: lista,
    total: arred_(total),
    rendeu_mes: arred_(rendeuMes),
    cdi_data: serie ? serie.ultima_data : '',
    cdi_anual: serie && serie.ultima ? Math.round((Math.pow(1 + serie.ultima, 252) - 1) * 10000) / 100 : null,
    estimado: estados.some(function (c) { return c._estimado && c.rende.tipo === 'cdi' && c.saldo !== null; }),
    ir: IR_CONTA
  };
}

/**
 * "Acertar com o banco": o saldo que o banco mostra vira o ponto de partida.
 * Do app vem `data` vazia (agora, manual); do extrato importado vem o dia do
 * saldo final (vale no fim daquele dia). Guarda também o que o app calculava,
 * para mostrar a diferença.
 */
function acertarConta_(pedido) {
  var nome = String(pedido.conta || '').trim();
  var conta = contasComSaldo_().filter(function (c) { return c.chave === chaveNome_(nome); })[0];
  if (!conta) return { ok: false, erro: 'conta_desconhecida' };
  var saldo = Number(String(pedido.saldo === undefined ? '' : pedido.saldo).replace(',', '.'));
  if (!isFinite(saldo) || Math.abs(saldo) > MAX_SALDO_CONTA || String(pedido.saldo).trim() === '') {
    return { ok: false, erro: 'saldo_invalido' };
  }
  saldo = arred_(saldo);
  var hoje = hojeISO_();
  var origem = ORIGENS_SALDO.indexOf(pedido.origem) >= 0 ? pedido.origem : 'manual';
  var data = pedido.data ? normalizarData_(pedido.data) : hoje;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data > hoje) return { ok: false, erro: 'data_invalida' };
  if (origem === 'manual') data = hoje;

  var trava = LockService.getScriptLock();
  trava.waitLock(20000);
  var calculado = null;
  try {
    var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
    var n = aba.getLastRow() - 1;
    var linhas = n > 0 ? aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues() : [];
    var conferidos = lerSaldosConferidos_();
    var serie = conferidos.length && conta.rende.tipo === 'cdi' ? serieCdi_(conferidos[0].data) : null;
    var antes = estadoDasContas_(linhas, serie, hoje).filter(function (c) { return chaveNome_(c.nome) === conta.chave; })[0];
    if (antes && antes.saldo !== null) {
      // Manual: o que o app mostrava agora. Extrato: como o app via o fim daquele dia.
      if (origem === 'manual') calculado = antes.saldo;
      else if (antes.fim_do_dia[data] !== undefined) calculado = arred_(antes.fim_do_dia[data]);
    }
    abaSaldos_().appendRow([conta.nome, data, saldo, origem, new Date(), calculado === null ? '' : calculado]);
  } finally {
    trava.releaseLock();
  }
  try { atualizarRendimentosContas_(true); } catch (e) { /* o saldo já foi guardado */ }
  var r = contasSaldo_();
  r.acertado = { conta: conta.nome, saldo: saldo, data: data, diferenca: calculado === null ? null : arred_(saldo - calculado) };
  return r;
}

/** Para a IA: quanto tem em cada conta e quanto rende. */
function contasResumo_() {
  if (!lerSaldosConferidos_().length) return [];
  try {
    return contasSaldo_().contas.filter(function (c) { return c.saldo !== null; }).map(function (c) {
      return { conta: c.nome, saldo: c.saldo, conferido_em: c.conferido.data,
               rende: c.rende.tipo === 'cdi' ? c.rende.pct + '% do CDI' : (c.rende.tipo === 'extrato' ? 'rendimento vem do extrato' : 'não rende'),
               rende_por_mes_liquido: c.rende_por_mes };
    });
  } catch (e) { return []; }
}

// ---------------------------------------------------------------------------
// Fogueira da casa, marcos das conquistas e relatório do ano
// ---------------------------------------------------------------------------
//
// A fogueira é a sequência de dias em que ALGUÉM da casa cuidou das finanças:
// lançou alguma coisa naquele dia, lançou depois um gasto daquele dia (até 2
// dias de atraso — o celular sem internet, o extrato importado), ou tocou em
// "hoje não gastei nada". O fogo de hoje só apaga à meia-noite: enquanto o dia
// não acaba, a sequência conta até ontem.

var ORIGENS_AUTOMATICAS = [ORIGEM_RENDE_CONTA];   // o que o script lança sozinho não acende fogo
var DIAS_DE_ATRASO_FOGO = 2;
var MAX_DIAS_NAO_GASTEI = 400;

/** { 'aaaa-mm-dd': ['Fernando', …] } — os dias marcados como "não gastei nada". */
function lerNaoGastei_() {
  var m = lerJsonProp_('NAO_GASTEI', {});
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}

/** Os dias com a fogueira acesa e quem acendeu: { dia: [pessoas] }. */
function diasAcesos_(linhas, col) {
  var acesos = {};
  var hoje = hojeISO_();
  var marcar = function (dia, pessoa) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia > hoje) return;
    if (!acesos[dia]) acesos[dia] = [];
    var p = String(pessoa || '').trim();
    if (p && acesos[dia].indexOf(p) < 0) acesos[dia].push(p);
  };
  (linhas || []).forEach(function (r) {
    if (r[col.status] === STATUS.EXCLUIDO) return;
    if (ORIGENS_AUTOMATICAS.indexOf(String(r[col.origem] || '')) >= 0) return;
    var reg = r[col.hora_registro] ? normalizarData_(r[col.hora_registro]) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reg)) return;
    marcar(reg, r[col.pessoa]);
    var data = normalizarData_(r[col.data]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(data) && data < reg && diasEntre_(data, reg) <= DIAS_DE_ATRASO_FOGO) marcar(data, r[col.pessoa]);
  });
  var ng = lerNaoGastei_();
  Object.keys(ng).forEach(function (d) {
    var quem = Array.isArray(ng[d]) ? ng[d] : [];
    if (!quem.length) marcar(d, '');
    quem.forEach(function (p) { marcar(d, p); });
  });
  return acesos;
}

/** A maior sequência (e onde terminou) entre os dias acesos, opcionalmente só dentro de [de, ate]. */
function maiorSequencia_(acesos, de, ate) {
  var melhor = 0, fim = '', atual = 0, anterior = '';
  Object.keys(acesos).sort().forEach(function (d) {
    if ((de && d < de) || (ate && d > ate)) return;
    atual = anterior && diasEntre_(anterior, d) === 1 ? atual + 1 : 1;
    anterior = d;
    if (atual > melhor) { melhor = atual; fim = d; }
  });
  return { dias: melhor, fim: fim };
}

/** Como está a fogueira hoje: sequência, recorde e os últimos 70 dias para o calendário. */
function fogueira_(linhas, col) {
  var hoje = hojeISO_();
  var acesos = diasAcesos_(linhas, col);
  var acesoHoje = !!acesos[hoje];
  var n = 0;
  var d = acesoHoje ? hoje : diaISOMais_(hoje, -1);
  while (acesos[d]) { n++; d = diaISOMais_(d, -1); }
  var rec = maiorSequencia_(acesos);
  var desde = diaISOMais_(hoje, -70);
  return {
    hoje: hoje,
    dias: n,
    aceso_hoje: acesoHoje,
    quem_hoje: acesos[hoje] || [],
    recorde: Math.max(rec.dias, n),
    recorde_fim: rec.fim,
    acesos: Object.keys(acesos).filter(function (x) { return x >= desde; }).sort(),
    nao_gastei: Object.keys(lerNaoGastei_()).filter(function (x) { return x >= desde; }).sort()
  };
}

/** "Hoje não gastei nada": mantém o fogo aceso sem precisar inventar lançamento. */
function naoGastei_(pedido) {
  var hoje = hojeISO_();
  var pessoa = String(pedido.pessoa || '').trim().slice(0, 40);
  var trava = LockService.getScriptLock();
  trava.waitLock(15000);
  try {
    var ng = lerNaoGastei_();
    var quem = Array.isArray(ng[hoje]) ? ng[hoje] : [];
    if (pessoa && quem.indexOf(pessoa) < 0) quem.push(pessoa);
    ng[hoje] = quem;
    var dias = Object.keys(ng).sort();
    while (dias.length > MAX_DIAS_NAO_GASTEI) delete ng[dias.shift()];
    PROP.setProperty('NAO_GASTEI', JSON.stringify(ng));
  } finally {
    trava.releaseLock();
  }
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  var linhas = n > 0 ? aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues() : [];
  return { ok: true, fogueira: fogueira_(linhas, indiceColunas_()) };
}

/**
 * Fatos que só a planilha sabe e que as conquistas novas usam: algum baú já
 * encheu a meta, e quanto o dinheiro já rendeu (baús + contas).
 */
function marcosDasConquistas_(infoBaus, linhas, col) {
  var bauCheio = false, rendeuBaus = 0, rendeuContas = 0;
  ((infoBaus && infoBaus.baus) || []).forEach(function (b) {
    if (!b.sem_cadastro && b.meta > 0 && b.saldo >= b.meta) bauCheio = true;
    if (b.rende && b.rende.rendeu_total > 0) rendeuBaus += b.rende.rendeu_total;
  });
  (linhas || []).forEach(function (r) {
    if (r[col.status] !== STATUS.OK || r[col.tipo] !== TIPO.RECEITA) return;
    if (String(r[col.origem] || '') === ORIGEM_RENDE_CONTA) rendeuContas += Number(r[col.valor]) || 0;
  });
  return { bau_cheio: bauCheio, rendeu_total: arred_(rendeuBaus + rendeuContas) };
}

/**
 * O relatório do ano: o ano inteiro em números, para os slides de janeiro.
 * Mês futuro não entra (parcela de dezembro em março não é o ano que passou).
 */
function relatorioAno_(pedido) {
  var hoje = hojeISO_();
  var ano = /^\d{4}$/.test(String(pedido.ano || '')) ? String(pedido.ano) : hoje.slice(0, 4);
  if (ano > hoje.slice(0, 4)) return { ok: false, erro: 'ano_futuro' };
  var mesHoje = hoje.slice(0, 7);

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  var col = indiceColunas_();
  var linhas = n > 0 ? aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues() : [];

  var meses = [];
  var porMes = {};
  for (var m = 1; m <= 12; m++) {
    var k = ano + '-' + (m < 10 ? '0' + m : m);
    porMes[k] = { mes: k, receitas: 0, despesas: 0, guardado: 0, lancamentos: 0, futuro: k > mesHoje, despesasDoMes: [] };
    meses.push(porMes[k]);
  }
  var porCategoria = {}, guardadoPorPessoa = {};
  var rendeuContas = 0, acertosBaus = 0;

  linhas.forEach(function (r) {
    if (r[col.status] !== STATUS.OK) return;
    var data = normalizarData_(r[col.data]);
    var pm = porMes[data.slice(0, 7)];
    if (!pm || pm.futuro) return;
    var tipo = r[col.tipo];
    var valor = Number(r[col.valor]) || 0;
    if (ehBau_(tipo)) {
      if (tipo === TIPO.RENDIMENTO) { acertosBaus += valor; return; }
      var s = sinalBau_(tipo) * valor;
      pm.guardado += s;
      somar_(guardadoPorPessoa, String(r[col.pessoa] || '').trim(), s);
      return;
    }
    if (tipo === TIPO.FATURA) return;    // as compras da fatura já contaram
    pm.lancamentos++;
    if (tipo === TIPO.RECEITA) {
      pm.receitas += valor;
      if (String(r[col.origem] || '') === ORIGEM_RENDE_CONTA) rendeuContas += valor;
      return;
    }
    pm.despesas += valor;
    somar_(porCategoria, r[col.categoria] || 'Outros', valor);
    pm.despesasDoMes.push({
      uuid: r[col.uuid], nome: String(r[col.descricao] || ''),
      descricao: String(r[col.descricao] || '') + ' ' + String(r[col.texto_falado] || ''),
      categoria: String(r[col.categoria] || ''), valor: valor
    });
  });

  // Chefes: as contas fixas de cada mês que foram lançadas (o mesmo cruzamento da tela Mês).
  var regras = lerRecorrentes_();
  var chefes = { derrotados: 0, total: 0 };
  meses.forEach(function (pm) {
    if (pm.futuro) return;
    var fixas = cruzarCompromissos_(
      compromissosDoMes_(regras, pm.mes).filter(function (c) { return c.tipo !== TIPO.RECEITA; }),
      pm.despesasDoMes);
    chefes.total += fixas.length;
    chefes.derrotados += fixas.filter(function (f) { return f.lancado; }).length;
  });

  // O que os baús renderam no ano (o cálculo dia a dia, mês a mês) + os acertos com o banco.
  var rendeuBaus = acertosBaus;
  if (SpreadsheetApp.getActiveSpreadsheet().getSheetByName('baus')) {
    try {
      baus_(linhas).baus.forEach(function (b) {
        var pmr = (b.rende && b.rende.por_mes_rendimento) || {};
        Object.keys(pmr).forEach(function (k) { if (k.slice(0, 4) === ano && k <= mesHoje) rendeuBaus += pmr[k]; });
      });
    } catch (e) { /* sem rendimento: o relatório sai sem essa linha */ }
  }

  var acesos = diasAcesos_(linhas, col);
  var fogo = maiorSequencia_(acesos, ano + '-01-01', ano + '-12-31');
  var diasAcesos = Object.keys(acesos).filter(function (d) { return d.slice(0, 4) === ano; }).length;

  var saida = meses.map(function (pm) {
    return {
      mes: pm.mes, futuro: pm.futuro,
      receitas: arred_(pm.receitas), despesas: arred_(pm.despesas),
      sobra: arred_(pm.receitas - pm.despesas), guardado: arred_(pm.guardado),
      teve: pm.lancamentos > 0
    };
  });
  var comMovimento = saida.filter(function (x) { return x.teve; });
  var melhor = null, pior = null;
  comMovimento.forEach(function (x) {
    if (!melhor || x.sobra > melhor.sobra) melhor = x;
    if (!pior || x.sobra < pior.sobra) pior = x;
  });
  var somaDe = function (campo) { return arred_(saida.reduce(function (a, x) { return a + x[campo]; }, 0)); };
  var categorias = emLista_(porCategoria).slice(0, 6);
  var conquistas = lerConquistas_();

  return {
    ok: true,
    ano: ano,
    ate_agora: ano === hoje.slice(0, 4),
    meses: saida,
    entrou: somaDe('receitas'),
    saiu: somaDe('despesas'),
    sobrou: somaDe('sobra'),
    guardado: somaDe('guardado'),
    guardado_por_pessoa: Object.keys(guardadoPorPessoa).reduce(function (o, k) {
      var v = arred_(guardadoPorPessoa[k]);
      if (Math.abs(v) >= 0.01) o[k] = v;
      return o;
    }, {}),
    rendeu: arred_(rendeuBaus + rendeuContas),
    rendeu_baus: arred_(rendeuBaus),
    rendeu_contas: arred_(rendeuContas),
    meses_com_movimento: comMovimento.length,
    no_azul: comMovimento.filter(function (x) { return x.sobra > 0; }).length,
    melhor_mes: melhor ? { mes: melhor.mes, sobra: melhor.sobra } : null,
    pior_mes: pior ? { mes: pior.mes, sobra: pior.sobra } : null,
    categorias: categorias,
    chefes: chefes,
    fogueira: { maior: fogo.dias, fim: fogo.fim, dias_acesos: diasAcesos },
    conquistas: Object.keys(conquistas)
      .filter(function (id) { return String(conquistas[id]).slice(0, 4) === ano; })
      .map(function (id) { return { id: id, dia: conquistas[id] }; })
      .sort(function (a, b) { return a.dia < b.dia ? -1 : 1; })
  };
}

// ---------------------------------------------------------------------------
// Exportar tudo em CSV (para perguntar a qualquer IA)
// ---------------------------------------------------------------------------
//
// Um arquivo só, em seções, feito para ser lido por gente (abre bonito no
// Excel/Planilhas do Brasil: separador ";", decimal com vírgula, datas
// dd/mm/aaaa) e por IA (cada seção diz o que é e como contar). Tudo o que o
// app sabe: o mês de hoje e a previsão, os meses passados, as contas fixas,
// parcelas, faturas, saldos, baús, o que você contou ao app e todos os
// lançamentos. O app acrescenta o BOM do UTF-8 na hora de baixar.

var NOMES_TIPO_EXPORT = {
  despesa: 'Gasto', receita: 'Entrada', fatura: 'Pagamento de fatura',
  guardar: 'Guardou no baú', resgatar: 'Tirou do baú', rendimento: 'Acerto de baú com o banco'
};

function numeroBR_(v) {
  var n = Math.round((Number(v) || 0) * 100) / 100;
  return (n < 0 ? '-' : '') + Math.abs(n).toFixed(2).replace('.', ',');
}
function dataBR_(iso) {
  iso = String(iso || '');
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
}
function mesBR_(mes) {
  var nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  mes = String(mes || '');
  return /^\d{4}-\d{2}/.test(mes) ? nomes[Number(mes.slice(5, 7)) - 1] + '/' + mes.slice(0, 4) : mes;
}
/** Número vira "1234,56"; texto ganha aspas quando precisa. */
function celulaCsv_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return numeroBR_(v);
  var s = String(v).replace(/\r?\n/g, ' ').trim();
  return /[;"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Tudo o que vai para a IA, em seções prontas (título, explicação, cabeçalho,
 * linhas). O CSV (`exportar_`) e o documento do Drive (`atualizarResumoIA_`)
 * desenham a mesma coisa cada um do seu jeito. `diasLancamentos` corta a lista
 * de lançamentos nos últimos N dias (o documento não pode ficar gigante).
 */
function dadosDaExportacao_(opcoes) {
  opcoes = opcoes || {};
  var hoje = hojeISO_();
  var mes = hoje.slice(0, 7);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  var col = indiceColunas_();
  var linhas = n > 0 ? aba.getRange(2, 1, n, ABAS.lancamentos.length).getValues() : [];
  var tentar = function (f, padrao) { try { return f(); } catch (e) { return padrao; } };

  var p = painel_({ mes: mes });
  var contasIdx = indiceContas_();
  var grupoDe = {}, tetoDe = {};
  categoriasTodas_().forEach(function (c) {
    grupoDe[chaveNome_(c.categoria)] = c.grupo || '';
    if (c.orcamento > 0) tetoDe[chaveNome_(c.categoria)] = c.orcamento;
  });
  var pessoas = lerCadastro_('pessoas').filter(function (x) { return x.ativo; }).map(function (x) { return x.nome; });

  var topo = [];
  var secoes = [];
  var linha = function (celulas) { topo.push(celulas); };
  var secao = function (titulo, explicacao, cabecalho, dados) {
    secoes.push({ titulo: titulo, explicacao: explicacao, cabecalho: cabecalho, linhas: dados });
  };

  // --- lançamentos válidos, do mais novo para o mais antigo ---
  var validos = [];
  linhas.forEach(function (r, i) {
    if (!r[col.uuid] || r[col.status] === STATUS.EXCLUIDO) return;
    if (r[col.status] !== STATUS.OK && r[col.status] !== STATUS.AGENDADO) return;
    if (!(Number(r[col.valor]) || 0)) return;   // linha zerada (rendimento que deixou de contar) não diz nada
    var data = normalizarData_(r[col.data]);
    validos.push({ r: r, data: data, ordem: ordemDe_(data, r[col.hora_registro], i) });
  });
  // A mesma ordem do extrato: do mais novo para o mais antigo, e o futuro no fim (o mais próximo primeiro).
  validos.sort(function (a, b) {
    for (var k = 0; k < 4; k++) {
      if (a.ordem[k] < b.ordem[k]) return 1;
      if (a.ordem[k] > b.ordem[k]) return -1;
    }
    return 0;
  });
  var datas = validos.map(function (x) { return x.data; }).filter(Boolean).sort();
  var primeiro = datas[0] || hoje;
  var ultimoFeito = validos.filter(function (x) { return x.data <= hoje; }).map(function (x) { return x.data; }).sort().pop() || hoje;

  // --- cabeçalho ---
  var pergunta = 'Este arquivo tem todas as minhas finanças, exportadas do meu app "Quanto Posso Gastar". ' +
    'Leia as seções (o mês de hoje, a previsão, as contas fixas, parcelas, faturas, saldos, baús e todos os lançamentos) e me diga: ' +
    'quanto eu posso gastar por dia até o fim do mês sem atrasar nenhuma conta e sem desistir da meta de guardar? ' +
    'Depois: [escreva aqui o que você quer saber, por exemplo "dá para comprar algo de R$ 950 por mês?"].';
  linha(['QUANTO POSSO GASTAR — meus dados financeiros']);
  linha(['Gerado em', dataBR_(hoje) + ' ' + Utilities.formatDate(new Date(), fuso_(), 'HH:mm')]);
  linha(['Pessoas da casa', pessoas.join(', ') || '—']);
  linha(['Período dos lançamentos', dataBR_(primeiro) + ' a ' + dataBR_(datas[datas.length - 1] || hoje) + ' (' + validos.length + ' lançamentos; os com data futura são parcelas e rendas já marcadas)']);
  linha(['Como ler', opcoes.doc
    ? 'valores em reais (R$); datas dd/mm/aaaa; cada seção tem um título e uma tabela'
    : 'valores em reais (R$) com vírgula decimal; datas dd/mm/aaaa; separador ponto e vírgula; cada seção começa com ###']);
  linha(['Regras do app', 'Compra no cartão de crédito conta como gasto no mês da compra; o "Pagamento de fatura" só tira o dinheiro da conta e NÃO é gasto novo. "Guardou no baú" sai do dinheiro livre mas não é gasto. Entrada "prevista" ainda não caiu.']);
  linha(['Pergunta sugerida para a IA', pergunta]);

  // --- 1. o mês de hoje ---
  var prev = p.previsao || {};
  var guardado = Number(prev.guardado) || 0;
  var meta = 0;
  (p.metas || []).forEach(function (m) { if (m.desde <= mes) meta = Number(m.valor) || 0; });
  var livre = (Number(prev.sobra) || 0) - guardado - Math.max(0, meta - Math.max(0, guardado));
  var ultimoDia = Number(ultimoDiaDoMes_(mes).slice(8, 10));
  var diasFaltam = ultimoDia - Number(hoje.slice(8, 10)) + 1;
  secao('O MÊS DE HOJE (' + mesBR_(mes) + ')', 'A conta que o app faz para dizer quanto dá para gastar.', ['item', 'valor', 'o que é'], [
    ['Recebi até agora', p.receitas, 'entradas que já caíram neste mês'],
    ['Gastei até agora', p.despesas, 'todos os gastos do mês (inclui compras no crédito)'],
    ['Já saiu das contas', p.saiu_caixa, 'o que de fato deixou as contas (débito, Pix, faturas pagas, baús)'],
    ['Vai sair na fatura', p.no_credito, 'compras no crédito deste mês que ainda vão ser cobradas'],
    ['Sobrou até agora', prev.ja_sobrou, 'recebi − gastei'],
    ['Ainda entra', prev.ainda_entra, 'rendas fixas e entradas marcadas que ainda não caíram'],
    ['Ainda sai', prev.ainda_sai, 'contas fixas e parcelas que ainda vão vencer neste mês'],
    ['Sobra prevista no fim do mês', prev.sobra, 'sobrou até agora + ainda entra − ainda sai'],
    ['Já guardado nos baús este mês', guardado, 'faz parte da sobra, mas não está livre'],
    ['Meta de guardar do mês (missão)', meta, meta ? 'o app separa esse valor antes de dizer quanto dá para gastar' : 'sem meta definida'],
    ['LIVRE PARA GASTAR até o fim do mês', livre, 'sobra prevista − baús − o que falta para a meta'],
    ['Dias que faltam (contando hoje)', String(diasFaltam), ''],
    ['Média livre por dia', diasFaltam > 0 ? livre / diasFaltam : 0, 'livre ÷ dias que faltam'],
    ['Total guardado em todos os baús', p.baus_total, 'com rendimento'],
    ['Fogueira (dias seguidos registrando)', String((p.fogueira && p.fogueira.dias) || 0), 'recorde: ' + ((p.fogueira && p.fogueira.recorde) || 0)]
  ]);

  // --- 2. previsão ---
  var p12 = tentar(function () { return previsao12_(); }, []);
  secao('PREVISÃO DOS PRÓXIMOS 12 MESES', 'O que já está marcado no calendário: rendas e contas fixas (com as vigências), parcelas e lançamentos futuros. Gastos do dia a dia NÃO entram — use a média dos meses anteriores.',
    ['mês', 'entra', 'sai', 'sobra', 'já lançado (entra)', 'já lançado (sai)', 'fixas a receber', 'fixas a pagar'],
    p12.map(function (x) {
      return [mesBR_(x.mes), x.entra, x.sai, x.sobra, x.ja_lancado_entra, x.ja_lancado_sai, x.fixas_a_receber, x.fixas_a_pagar];
    }));

  // --- 3. meses anteriores ---
  var passados = (p.evolucao || []).filter(function (e) { return !e.futuro && e.mes <= mes && (e.receitas || e.despesas || e.guardado); });
  secao('MESES ANTERIORES (até 12)', 'Quanto entrou e saiu em cada mês. "Saiu" aqui é o que saiu do bolso (fatura no mês em que foi paga).',
    ['mês', 'entrou', 'saiu', 'sobrou', 'guardado nos baús'],
    passados.map(function (e) { return [mesBR_(e.mes) + (e.mes === mes ? ' (até hoje)' : ''), e.receitas, e.despesas, Number(e.receitas) - Number(e.despesas), e.guardado]; }));

  // --- 4. gastos por categoria ---
  var mesesCat = [mesSomado_(mes, -3), mesSomado_(mes, -2), mesSomado_(mes, -1), mes];
  var porCat = {};
  validos.forEach(function (x) {
    var r = x.r;
    if (r[col.status] !== STATUS.OK || r[col.tipo] !== TIPO.DESPESA) return;
    var i = mesesCat.indexOf(x.data.slice(0, 7));
    if (i < 0) return;
    var c = String(r[col.categoria] || 'Outros');
    if (!porCat[c]) porCat[c] = [0, 0, 0, 0];
    porCat[c][i] += Number(r[col.valor]) || 0;
  });
  var cats = Object.keys(porCat).map(function (c) {
    var v = porCat[c];
    return { c: c, v: v, media: (v[0] + v[1] + v[2]) / 3 };
  }).sort(function (a, b) { return (b.media + b.v[3]) - (a.media + a.v[3]); });
  secao('GASTOS POR CATEGORIA', 'Os 3 meses fechados mais recentes e o mês de hoje (até agora). Teto = limite por mês que eu defini para a categoria.',
    ['categoria', 'grupo', mesBR_(mesesCat[0]), mesBR_(mesesCat[1]), mesBR_(mesesCat[2]), 'média dos 3 meses', mesBR_(mes) + ' (até hoje)', 'teto por mês'],
    cats.map(function (x) {
      var teto = tetoDe[chaveNome_(x.c)];
      return [x.c, grupoDe[chaveNome_(x.c)] || '', x.v[0], x.v[1], x.v[2], x.media, x.v[3], teto ? teto : ''];
    }));

  // --- 5. contas fixas e rendas ---
  var situacaoFixa = function (f) {
    if (f.lancado) return 'paga' + (f.data_lancado ? ' em ' + dataBR_(f.data_lancado) : '');
    if (Number(f.dia) > 0 && Number(f.dia) < Number(hoje.slice(8, 10))) return 'VENCEU e não foi lançada';
    return Number(f.dia) > 0 ? 'vence dia ' + f.dia : 'a pagar';
  };
  var fixas = (p.fixas || []).map(function (f) {
    return [f.nome, 'conta fixa', f.categoria, f.valor, f.dia ? String(f.dia) : '', f.conta || '', f.pessoa || '', situacaoFixa(f)];
  }).concat((p.rendas || []).map(function (f) {
    return [f.nome, 'renda fixa', f.categoria, f.valor, f.dia ? String(f.dia) : '', f.conta || '', f.pessoa || '',
      f.lancado ? 'recebida' : (f.uuid_agendado ? 'marcada, ainda não caiu' : 'a receber')];
  }));
  secao('CONTAS FIXAS E RENDAS DE ' + mesBR_(mes).toUpperCase(), 'O que se repete todo mês (no valor que vale neste mês) e se já foi pago/recebido.',
    ['nome', 'tipo', 'categoria', 'valor', 'dia', 'conta', 'pessoa', 'situação neste mês'], fixas);

  // --- 6. parcelamentos ---
  secao('PARCELAMENTOS EM ANDAMENTO', 'Compras parceladas com parcela neste mês.',
    ['compra', 'categoria', 'conta', 'pessoa', 'valor da parcela', 'parcela', 'parcelas que faltam', 'falta pagar', 'última parcela'],
    (p.parceladas || []).map(function (x) {
      return [x.nome, x.categoria, x.conta, x.pessoa, x.valor, x.parcela_atual + ' de ' + x.parcelas_total,
        String(x.parcelas_restantes), x.falta_pagar, mesBR_(String(x.ultima || '').slice(0, 7))];
    }));

  // --- 7. faturas ---
  var faturas = (p.faturas || []).map(function (f) {
    return [f.cartao, mesBR_(f.mes), f.total, f.dia ? String(f.dia) : '', f.pago ? 'paga' : f.aberta ? 'aberta (ainda recebe compras)' : 'fechada, a pagar'];
  }).concat((p.faturas_em_formacao || []).map(function (f) {
    return [f.cartao, mesBR_(f.mes), f.total, f.dia ? String(f.dia) : '', 'em formação (vence mês que vem)'];
  }));
  secao('FATURAS DE CARTÃO', 'O total de cada fatura já é a soma das compras no crédito (que já contam como gasto).',
    ['cartão', 'fatura de', 'total', 'vence dia', 'situação'], faturas);

  // --- 8. saldos das contas ---
  var cs = tentar(function () { return contasSaldo_(); }, { contas: [] });
  secao('DINHEIRO NAS CONTAS', 'Saldo = o último valor conferido com o banco + o que foi lançado depois (+ rendimento estimado). Conta sem saldo conferido aparece vazia.',
    ['conta', 'tipo', 'pessoa', 'saldo', 'conferido em', 'rende', 'rende por mês (aprox., sem IR)'],
    (cs.contas || []).map(function (c) {
      return [c.nome, c.tipo, c.pessoa, c.saldo === null ? '' : c.saldo, c.conferido ? dataBR_(c.conferido.data) : 'nunca',
        c.rende && c.rende.tipo === 'cdi' ? c.rende.pct + '% do CDI' : (c.rende && c.rende.tipo === 'extrato' ? 'pelo extrato' : 'não rende'),
        c.rende && c.rende.tipo === 'cdi' ? c.rende_por_mes : ''];
    }));

  // --- 9. baús ---
  var bs = ss.getSheetByName('baus') ? tentar(function () { return baus_(linhas); }, { baus: [] }) : { baus: [] };
  secao('BAÚS (dinheiro guardado)', 'Caixinhas com meta. Guardar tira do dinheiro livre do mês, mas não é gasto.',
    ['baú', 'saldo', 'meta', 'falta para a meta', 'até quando', 'pra que é', 'rende', 'rendeu até hoje'],
    (bs.baus || []).filter(function (b) { return !b.sem_cadastro || b.saldo; }).map(function (b) {
      var r = b.rende || {};
      return [b.nome, b.saldo, b.meta || '', b.meta ? Math.max(0, b.meta - b.saldo) : '', b.prazo ? mesBR_(String(b.prazo).slice(0, 7)) : '',
        b.objetivo || '', r.tipo === 'cdi' ? r.pct + '% do CDI' : r.tipo === 'fixo' ? r.pct + '% ao ano' : 'não rende',
        r.tipo ? r.rendimento : ''];
    }));

  // --- 10. o que eu contei ao app ---
  var memoria = tentar(function () { return lerMemoria_(); }, []);
  secao('O QUE EU CONTEI PARA O APP', 'Fatos que a IA do app guarda sobre mim (planos, contexto).', ['fato'],
    memoria.map(function (f) { return [f]; }));

  // --- 11. lançamentos ---
  var desdeLanc = opcoes.diasLancamentos ? diaISOMais_(hoje, -opcoes.diasLancamentos) : '';
  var listaLanc = desdeLanc ? validos.filter(function (x) { return x.data >= desdeLanc; }) : validos;
  secao(desdeLanc ? 'LANÇAMENTOS DOS ÚLTIMOS ' + opcoes.diasLancamentos + ' DIAS (e os futuros já marcados)' : 'TODOS OS LANÇAMENTOS',
    'Do mais novo para o mais antigo; no fim, os de data futura (parcelas e contas já agendadas), do mais próximo ao mais distante. "previsto" = renda marcada que ainda não caiu.' +
    (desdeLanc ? ' O histórico mais antigo está nas seções de meses e categorias acima (e no CSV completo do app).' : ''),
    ['data', 'tipo', 'valor', 'categoria', 'grupo', 'descrição', 'conta', 'forma', 'pessoa', 'fonte da renda', 'parcela', 'fatura de', 'situação', 'origem'],
    listaLanc.map(function (x) {
      var r = x.r, tipo = String(r[col.tipo] || 'despesa');
      var conta = contasIdx[chaveNome_(String(r[col.conta] || ''))];
      var credito = tipo === TIPO.DESPESA && ehCartao_(conta);
      var pa = Number(r[col.parcela_atual]) || 0, pt = Number(r[col.parcelas_total]) || 0;
      return [
        dataBR_(x.data), NOMES_TIPO_EXPORT[tipo] || tipo, Number(r[col.valor]) || 0,
        String(r[col.categoria] || ''), ehBau_(tipo) ? '' : (grupoDe[chaveNome_(r[col.categoria])] || ''),
        String(r[col.descricao] || ''), String(r[col.conta] || ''),
        credito ? 'crédito' : (String(r[col.metodo] || '') || ''),
        String(r[col.pessoa] || ''), String(r[col.fonte] || ''),
        pt > 1 ? pa + ' de ' + pt : '', normalizarMes_(r[col.fatura_mes]) ? mesBR_(normalizarMes_(r[col.fatura_mes])) : '',
        r[col.status] === STATUS.AGENDADO ? 'previsto' : (x.data > hoje ? 'agendado' : 'feito'),
        String(r[col.origem] || '')
      ];
    }));

  return {
    ok: true,
    hoje: hoje,
    topo: topo,
    secoes: secoes,
    lancamentos: validos.length,
    ultimo: ultimoFeito,
    pergunta: pergunta
  };
}

/** O CSV para baixar no app (botão em Perguntar). */
function exportar_() {
  var d = dadosDaExportacao_();
  var saida = [];
  var linha = function (celulas) { saida.push((celulas || []).map(celulaCsv_).join(';')); };
  d.topo.forEach(linha);
  d.secoes.forEach(function (sec, i) {
    linha([]);
    linha(['### ' + (i + 1) + '. ' + sec.titulo]);
    if (sec.explicacao) linha([sec.explicacao]);
    linha(sec.cabecalho);
    if (!sec.linhas.length) linha(['(nada aqui)']);
    sec.linhas.forEach(linha);
  });
  return {
    ok: true,
    nome: 'quanto-posso-gastar-' + d.hoje + '.csv',
    csv: saida.join('\r\n') + '\r\n',
    lancamentos: d.lancamentos,
    ultimo: d.ultimo,
    pergunta: d.pergunta
  };
}

// ---------------------------------------------------------------------------
// Resumo para IA no Google Drive
// ---------------------------------------------------------------------------
//
// Um Google Doc com o mesmo conteúdo do CSV (o mês de hoje, a previsão, contas
// fixas, faturas, saldos, baús e os lançamentos recentes), reescrito de hora em
// hora por um gatilho. Assim, em qualquer conversa com o Claude (ou outra IA
// com acesso ao Drive), basta pedir para ler este documento — sem exportar
// nada. A planilha crua não serve para isso: o conector do Drive só entrega
// uma amostra de cada aba, e ela não tem as contas que o app faz.
//
// É opcional: só existe depois que você liga no app (Perguntar → Resumo no
// Drive). Usa DocumentApp e DriveApp — por isso pede uma autorização a mais.

var TITULO_DOC_IA = 'Quanto Posso Gastar — resumo para IA';
var DIAS_LANC_DOC_IA = 120;

/** 1234.5 → "1.234,50" */
function numeroMilhar_(v) {
  var n = Math.round((Number(v) || 0) * 100) / 100;
  var partes = Math.abs(n).toFixed(2).split('.');
  return (n < 0 ? '-' : '') + partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + partes[1];
}
function celulaDoc_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return 'R$ ' + numeroMilhar_(v);
  return String(v);
}

/** O documento (o mesmo de sempre); se foi apagado ou nunca existiu, nasce outro na pasta da planilha. */
function docIA_(criarSeFaltar) {
  var id = PROP.getProperty('DOC_IA_ID');
  if (id) {
    try {
      if (!DriveApp.getFileById(id).isTrashed()) return DocumentApp.openById(id);
    } catch (e) { /* apagado de vez ou sem acesso: cria outro */ }
  }
  if (!criarSeFaltar) return null;
  var doc = DocumentApp.create(TITULO_DOC_IA);
  PROP.setProperty('DOC_IA_ID', doc.getId());
  try {
    var pastas = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
    if (pastas.hasNext()) DriveApp.getFileById(doc.getId()).moveTo(pastas.next());
  } catch (e) { /* fica na raiz do Drive: tudo bem */ }
  return doc;
}

/** Reescreve o documento inteiro com os números de agora. */
function atualizarResumoIA_() {
  var doc = docIA_(true);
  var d = dadosDaExportacao_({ doc: true, diasLancamentos: DIAS_LANC_DOC_IA });
  var corpo = doc.getBody();
  corpo.clear();
  corpo.appendParagraph(TITULO_DOC_IA).setHeading(DocumentApp.ParagraphHeading.TITLE);
  corpo.appendParagraph(
    'Este documento é reescrito sozinho pelo app "Quanto Posso Gastar" de hora em hora. ' +
    'Para a IA que estiver lendo: estes números são a verdade sobre as minhas finanças e já seguem as regras abaixo — ' +
    'não some nada em dobro. Para saber quanto posso gastar, comece pela seção 1.');
  d.topo.slice(1).forEach(function (l) {
    if (/^Pergunta sugerida/.test(String(l[0]))) return;
    var p = corpo.appendParagraph('');
    p.appendText(String(l[0]) + ': ').setBold(true);
    p.appendText(String(l[1] === undefined ? '' : l[1])).setBold(false);
  });
  d.secoes.forEach(function (sec, i) {
    corpo.appendParagraph((i + 1) + '. ' + sec.titulo).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    if (sec.explicacao) corpo.appendParagraph(sec.explicacao).editAsText().setItalic(true);
    var largura = sec.cabecalho.length;
    var linhas = (sec.linhas.length ? sec.linhas : [['(nada aqui)']]).map(function (l) {
      var cel = l.map(celulaDoc_);
      while (cel.length < largura) cel.push('');
      return cel.slice(0, largura);
    });
    var tabela = corpo.appendTable([sec.cabecalho.map(String)].concat(linhas));
    tabela.editAsText().setItalic(false);   // a tabela herdava o itálico da explicação logo acima
    var cab = tabela.getRow(0);
    for (var c = 0; c < cab.getNumCells(); c++) cab.getCell(c).editAsText().setBold(true);
  });
  doc.saveAndClose();
  var agora = new Date().toISOString();
  PROP.setProperty('DOC_IA_EM', agora);
  return { url: doc.getUrl(), atualizado_em: agora };
}

/** O gatilho de hora em hora. Nunca deixa erro escapar (o Google manda e-mail a cada falha). */
function atualizarResumoIA() {
  try { atualizarResumoIA_(); } catch (e) { /* tenta de novo na próxima hora */ }
}

function gatilhoResumoIA_() {
  return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'atualizarResumoIA'; });
}

/** Rode uma vez no editor do Apps Script depois de colar o código: é o que libera o Docs e o Drive. */
function autorizar() {
  Logger.log('Docs e Drive autorizados. Pasta raiz: ' + DriveApp.getRootFolder().getName() + ' · ' + typeof DocumentApp.create);
}

/** App → Perguntar → Resumo no Drive: estado, ligar, atualizar agora, desligar. */
function resumoIA_(pedido) {
  var o = String(pedido.operacao || 'estado');
  if (['estado', 'ligar', 'atualizar', 'desligar'].indexOf(o) < 0) return { ok: false, erro: 'operacao_invalida' };
  try {
    if (o === 'ligar' || o === 'atualizar') {
      atualizarResumoIA_();
      if (o === 'ligar' && !gatilhoResumoIA_().length) {
        ScriptApp.newTrigger('atualizarResumoIA').timeBased().everyHours(1).create();
      }
    }
    if (o === 'desligar') gatilhoResumoIA_().forEach(function (t) { ScriptApp.deleteTrigger(t); });
    var doc = docIA_(false);
    return {
      ok: true,
      ligado: gatilhoResumoIA_().length > 0,
      url: doc ? doc.getUrl() : '',
      titulo: TITULO_DOC_IA,
      atualizado_em: PROP.getProperty('DOC_IA_EM') || ''
    };
  } catch (e) {
    var msg = String(e && e.message || e);
    if (/permiss|authoriz|autoriza|scope/i.test(msg)) return { ok: false, erro: 'precisa_autorizar', detalhe: msg };
    throw e;
  }
}
