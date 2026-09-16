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

// Suba junto com VERSAO_APP em src/lib/versao.js — o app compara as duas e
// avisa na tela quando só uma das metades foi publicada.
var VERSAO = '1.12.0';

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
  contas: ['nome', 'tipo', 'pessoa', 'dia_fechamento', 'dia_vencimento', 'saldo_inicial', 'ativo'],
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
  conversas: ['data', 'pergunta', 'resposta', 'modelo', 'custo_estimado']
};

// Status possíveis de um lançamento na planilha.
// Um lançamento é uma de três coisas. A terceira existe porque comprar no
// crédito não tira dinheiro da conta: cria dívida. Quem tira é o pagamento da
// fatura — e ele não pode contar como gasto de novo, senão dobra tudo.
var TIPO = {
  DESPESA: 'despesa',
  RECEITA: 'receita',
  FATURA: 'fatura'   // pagamento de fatura de cartão: sai do caixa, não é gasto novo
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
      case 'panorama':    return json_(panorama_(pedido));
      case 'categorias':  return json_(cadastros_());
      case 'cadastros':   return json_(cadastros_());
      case 'salvar_cadastro':  return json_(salvarCadastro_(pedido));
      case 'excluir_cadastro': return json_(excluirCadastro_(pedido));
      case 'lancamentos':      return json_(lancamentosDoMes_(pedido));
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
      case 'recorrentes':        return json_({ ok: true, recorrentes: recorrentesDoMes_(pedido.mes || mesAtual_()) });
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

    var contas = indiceContas_();
    var novas = [], gravados = [], duplicados = [];
    lista.forEach(function (l) {
      if (!l.uuid) { l.uuid = Utilities.getUuid(); }
      if (existentes[l.uuid]) { duplicados.push(l.uuid); return; }
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
    return { ok: true, gravados: gravados, duplicados: duplicados };
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
  return String(uuid || '').replace(/-p\d+$/, '');
}

function ehDoGrupo_(uuid, base) {
  var u = String(uuid || '');
  return u === base || u.indexOf(base + '-p') === 0;
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
    if (r[col.tipo] === TIPO.FATURA) return; // já contado nas compras
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
      descricao: r[col.descricao], status: r[col.status],
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

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('lancamentos');
  var n = aba.getLastRow() - 1;
  var col = indiceColunas_();

  // A linha do tempo: seis meses para trás e seis para a frente. O passado é o
  // que aconteceu; o futuro é o que já está comprometido — parcelas que vão
  // cair, contas que se repetem, salários que costumam entrar. São duas coisas
  // diferentes e por isso viajam em campos separados, para a tela poder
  // desenhar cada uma do seu jeito.
  var meses = [];
  var m = mes;
  for (var i = 0; i < 6; i++) { meses.unshift(m); m = mesAnterior_(m); }
  m = mes;
  for (var f = 0; f < 6; f++) { m = mesSeguinte_(m); meses.push(m); }

  var serie = {};
  meses.forEach(function (k) {
    serie[k] = { mes: k, receitas: 0, despesas: 0, receitas_previstas: 0, despesas_previstas: 0 };
  });

  var mesHoje = mesAtual_();

  var totais = { receitas: 0, despesas: 0, lancamentos: 0, credito: 0, caixa: 0 };
  var porCategoria = {}, porConta = {}, porPessoa = {}, porFonte = {}, porGrupo = {};
  var porDia = {};

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
    somar_(porPessoa, r[col.pessoa] || 'Sem dono', valor);
  });

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
      sobra: arred_(totais.receitas - totais.despesas + aReceberTotal - previstoTotal)
    },
    orcamentos: orcamentos
  };
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
        valor: l.valor
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
      valor: Number(r[col.valor]) || 0
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

    atualizarResumo_();

    return { ok: true, uuid: pedido.uuid, alterados: mudou, parcelas_ajustadas: irmas };
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
// Cadastros: contas, categorias, fontes e pessoas
// ---------------------------------------------------------------------------
//
// Os quatro se comportam igual: uma aba, a primeira coluna é o nome, a última
// diz se está ativo. Desativar em vez de apagar preserva os lançamentos antigos
// que apontam para aquele nome — eles continuam fazendo sentido no histórico.

var CADASTROS = {
  contas:     { aba: 'contas',     campos: ['nome', 'tipo', 'pessoa', 'dia_fechamento', 'dia_vencimento', 'saldo_inicial', 'ativo'] },
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
