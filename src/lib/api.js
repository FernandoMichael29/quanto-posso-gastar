// Conversa com o Apps Script.
//
// Detalhe importante: o corpo vai como text/plain de propósito. Um POST com
// Content-Type application/json faz o navegador mandar um preflight OPTIONS,
// e o Apps Script não responde preflight — a chamada falharia por CORS.

const CHAVE_CONFIG = 'qpg.config';

export function lerConfig() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_CONFIG) || '{}');
  } catch {
    return {};
  }
}

export function salvarConfig(config) {
  const antiga = lerConfig();
  localStorage.setItem(CHAVE_CONFIG, JSON.stringify(config));
  // Trocou de endereço ou de token? A validação anterior não vale mais.
  if (antiga.url !== config.url || antiga.token !== config.token) invalidarAcesso();
  // Espelha no IndexedDB para o service worker conseguir sincronizar sozinho.
  import('./db.js').then((db) => db.espelharConfig(config)).catch(() => {});
}

// ---------------------------------------------------------------------------
// Acesso
// ---------------------------------------------------------------------------
//
// O app não mostra nenhum dado antes de ter falado com a SUA planilha ao menos
// uma vez neste aparelho. Sem isso, o que apareceria na tela seria cache velho
// ou lista de exemplo — dado que parece seu e não é. Depois de validado, o app
// pode trabalhar offline à vontade: aí o que está em cache veio mesmo da sua
// planilha.

const CHAVE_ACESSO = 'qpg.acesso';

export function marcarAcessoValido() {
  const { url, token } = lerConfig();
  localStorage.setItem(CHAVE_ACESSO, JSON.stringify({ url, token, em: Date.now() }));
}

export function invalidarAcesso() {
  localStorage.removeItem(CHAVE_ACESSO);
}

/** Este aparelho já conversou com a planilha configurada agora? */
export function acessoValidado() {
  try {
    const a = JSON.parse(localStorage.getItem(CHAVE_ACESSO) || 'null');
    const c = lerConfig();
    return Boolean(a && c.url && c.token && a.url === c.url && a.token === c.token);
  } catch {
    return false;
  }
}

/** O endereço tem cara de app da Web do Apps Script? */
export function enderecoPlausivel(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\/?$/.test(String(url || '').trim());
}

export function configurado() {
  const c = lerConfig();
  return Boolean(c.url && c.token);
}

async function chamar(acao, dados = {}, opcoes = {}) {
  const { url, token } = lerConfig();
  if (!url || !token) {
    return { ok: false, erro: 'sem_configuracao' };
  }

  const controlador = new AbortController();
  const prazo = setTimeout(() => controlador.abort(), opcoes.prazo || 25000);

  try {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ acao, token, ...dados }),
      signal: controlador.signal,
      redirect: 'follow'
    });
    if (!resposta.ok) return { ok: false, erro: 'api_fora', detalhe: `HTTP ${resposta.status}` };

    // O Apps Script às vezes devolve 200 com corpo vazio: é o que acontece
    // quando a execução estoura o tempo dele (a análise é a chamada mais
    // demorada). Sem este cuidado, o erro que chegava na tela era o
    // "Unexpected end of JSON input" do JSON.parse, que não diz nada.
    const texto = await resposta.text();
    if (!texto.trim()) return { ok: false, erro: 'resposta_vazia' };
    try {
      return JSON.parse(texto);
    } catch {
      return { ok: false, erro: 'resposta_estranha', detalhe: texto.slice(0, 200) };
    }
  } catch (err) {
    return { ok: false, erro: 'sem_rede', detalhe: String(err && err.message || err) };
  } finally {
    clearTimeout(prazo);
  }
}

export const api = {
  ping: () => chamar('ping', {}, { prazo: 12000 }),
  lancar: (lancamentos) => chamar('lancar', { lancamentos }),
  interpretar: (texto, uuid) => chamar('interpretar', { texto, uuid }),
  // Resolve um item da fila inteiro numa ida só: interpreta se precisar e grava.
  capturar: (item) => chamar('capturar', {
    uuid: item.uuid, texto: item.texto, lancamento: item.lancamento
  }),
  resumo: (mes) => chamar('resumo', { mes }),

  // Cadastros: contas, categorias, fontes e pessoas
  cadastros: () => chamar('cadastros'),
  salvarCadastro: (tipo, item, nomeAntigo) =>
    chamar('salvar_cadastro', { tipo, item, nome_antigo: nomeAntigo }),
  excluirCadastro: (tipo, nome) => chamar('excluir_cadastro', { tipo, nome }),

  // Lançamentos de um mês, edição e exclusão
  lancamentos: (mes) => chamar('lancamentos', { mes }),
  editarLancamento: (uuid, campos) => chamar('editar_lancamento', { uuid, campos }),
  excluirLancamento: (uuid) => chamar('excluir_lancamento', { uuid }),
  tornarMensal: (uuid, opcoes = {}) => chamar('tornar_mensal', { uuid, ...opcoes }),

  confirmarRecebimento: (uuid, opcoes = {}) => chamar('confirmar_recebimento', { uuid, ...opcoes }),

  // Regras mensais: contas fixas e rendas que se repetem
  recorrentes: (mes) => chamar('recorrentes', { mes }),
  salvarRecorrente: (nome, mes, campos) => chamar('salvar_recorrente', { nome, mes, campos }),
  excluirRecorrente: (nome) => chamar('excluir_recorrente', { nome }),
  encerrarRecorrente: (nome, mes) => chamar('encerrar_recorrente', { nome, mes }),

  pagarFixa: (nome, mes, opcoes = {}) => chamar('pagar_fixa', { nome, mes, ...opcoes }),
  pagarFatura: (cartao, mes, opcoes = {}) => chamar('pagar_fatura', { cartao, mes, ...opcoes }),
  painel: (mes) => chamar('painel', { mes }, { prazo: 40000 }),
  // A análise lê vários meses e chama o modelo grande: precisa de mais fôlego.
  perguntar: (pergunta) => chamar('perguntar', { pergunta }, { prazo: 90000 }),
  // Perguntas já respondidas, com a análise inteira: não custa IA nenhuma.
  conversas: (limite = 10) => chamar('conversas', { limite }),
  panorama: () => chamar('panorama'),
  pendencias: () => chamar('pendencias'),
  categorias: () => chamar('categorias')
};
