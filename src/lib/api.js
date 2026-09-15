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
  localStorage.setItem(CHAVE_CONFIG, JSON.stringify(config));
  // Espelha no IndexedDB para o service worker conseguir sincronizar sozinho.
  import('./db.js').then((db) => db.espelharConfig(config)).catch(() => {});
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
    return await resposta.json();
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
  pagarFixa: (nome, mes, opcoes = {}) => chamar('pagar_fixa', { nome, mes, ...opcoes }),
  painel: (mes) => chamar('painel', { mes }, { prazo: 40000 }),
  // A análise lê vários meses e chama o modelo grande: precisa de mais fôlego.
  perguntar: (pergunta) => chamar('perguntar', { pergunta }, { prazo: 90000 }),
  panorama: () => chamar('panorama'),
  pendencias: () => chamar('pendencias'),
  categorias: () => chamar('categorias')
};
