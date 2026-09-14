// A fila local. Tudo que você fala entra aqui ANTES de qualquer tentativa de
// rede — é isso que garante que nenhuma solicitação se perde, com ou sem sinal.

const BANCO = 'qpg';
const LOJA = 'fila';
const VERSAO = 1;

export const ESTADO = {
  PENDENTE: 'pendente',           // esperando internet
  AGUARDANDO_IA: 'aguardando_ia', // a IA não estava disponível (sem crédito, fora do ar…)
  ENVIANDO: 'enviando',
  SINCRONIZADO: 'sincronizado',
  ERRO: 'erro'
};

export const ROTULO_ESTADO = {
  pendente: 'Esperando internet',
  aguardando_ia: 'Esperando a IA',
  enviando: 'Enviando',
  sincronizado: 'Na planilha',
  erro: 'Deu erro'
};

export const MOTIVO = {
  sem_creditos: 'Os créditos da API acabaram',
  chave_invalida: 'A chave da API foi recusada',
  sem_chave: 'A chave da API ainda não foi configurada',
  sem_rede: 'Sem internet',
  limite_taxa: 'Muitas chamadas seguidas',
  api_fora: 'A IA está fora do ar',
  nada_entendido: 'A IA não achou valor na frase',
  resposta_estranha: 'A IA respondeu fora do formato',
  token_invalido: 'O token do app não confere',
  sem_configuracao: 'O app ainda não foi configurado nos Ajustes'
};

let promessa = null;

function abrir() {
  if (promessa) return promessa;
  promessa = new Promise((ok, falha) => {
    const req = indexedDB.open(BANCO, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOJA)) {
        const loja = db.createObjectStore(LOJA, { keyPath: 'uuid' });
        loja.createIndex('estado', 'estado');
        loja.createIndex('criado_em', 'criado_em');
      }
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
  return promessa;
}

async function transacao(modo, fn) {
  const db = await abrir();
  return new Promise((ok, falha) => {
    const tx = db.transaction(LOJA, modo);
    const loja = tx.objectStore(LOJA);
    let resultado;
    try {
      resultado = fn(loja);
    } catch (e) {
      falha(e);
      return;
    }
    tx.oncomplete = () => ok(resultado && resultado.result !== undefined ? resultado.result : resultado);
    tx.onerror = () => falha(tx.error);
  });
}

export function novoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

/** Coloca um item na fila. Nunca falha por falta de rede. */
export async function enfileirar(item) {
  const registro = {
    uuid: item.uuid || novoId(),
    estado: item.estado || ESTADO.PENDENTE,
    motivo: item.motivo || '',
    texto: item.texto || '',
    lancamento: item.lancamento || null,
    tentativas: 0,
    ultima_tentativa: null,
    criado_em: Date.now()
  };
  await transacao('readwrite', (loja) => loja.put(registro));
  return registro;
}

export async function atualizar(uuid, mudancas) {
  const db = await abrir();
  return new Promise((ok, falha) => {
    const tx = db.transaction(LOJA, 'readwrite');
    const loja = tx.objectStore(LOJA);
    const req = loja.get(uuid);
    req.onsuccess = () => {
      const atual = req.result;
      if (!atual) { ok(null); return; }
      loja.put({ ...atual, ...mudancas });
    };
    tx.oncomplete = () => ok(true);
    tx.onerror = () => falha(tx.error);
  });
}

// O service worker não enxerga o localStorage, então a configuração fica
// espelhada aqui dentro para ele conseguir sincronizar com o app fechado.
export const ID_CONFIG = '__config__';

export async function espelharConfig(config) {
  await transacao('readwrite', (loja) => loja.put({ uuid: ID_CONFIG, ...config }));
}

export async function listar() {
  const db = await abrir();
  return new Promise((ok, falha) => {
    const tx = db.transaction(LOJA, 'readonly');
    const req = tx.objectStore(LOJA).getAll();
    req.onsuccess = () => ok(
      (req.result || [])
        .filter((i) => i.uuid !== ID_CONFIG)
        .sort((a, b) => b.criado_em - a.criado_em)
    );
    req.onerror = () => falha(req.error);
  });
}

/** O que ainda precisa ir para a planilha. */
export async function aFazer() {
  const todos = await listar();
  return todos
    .filter((i) => i.estado !== ESTADO.SINCRONIZADO)
    .sort((a, b) => a.criado_em - b.criado_em);
}

export async function remover(uuid) {
  await transacao('readwrite', (loja) => loja.delete(uuid));
}

/** Apaga o que já está na planilha há mais de uma semana. */
export async function limparAntigos() {
  const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const todos = await listar();
  for (const i of todos) {
    if (i.estado === ESTADO.SINCRONIZADO && i.criado_em < limite) await remover(i.uuid);
  }
}
