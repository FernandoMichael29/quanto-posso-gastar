// Service worker: deixa o app abrir sem internet e sincroniza a fila sozinho
// quando o sinal volta — mesmo com o app fechado.

// Mudou o nome: o cache antigo (com o ícone do microfone) é apagado na ativação.
const CACHE = 'qpg-v3';
const ESSENCIAIS = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ESSENCIAIS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro para navegação, cache primeiro para o resto.
self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    evento.respondWith(
      fetch(req)
        .then((r) => { guardar(req, r.clone()); return r; })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  evento.respondWith(
    caches.match(req).then((cacheado) =>
      cacheado || fetch(req).then((r) => { guardar(req, r.clone()); return r; })
    )
  );
});

function guardar(req, resposta) {
  if (!resposta || resposta.status !== 200) return;
  caches.open(CACHE).then((c) => c.put(req, resposta)).catch(() => {});
}

// --------------------------------------------------------------------------
// Sincronização em segundo plano
// --------------------------------------------------------------------------

self.addEventListener('sync', (evento) => {
  if (evento.tag === 'qpg-sincronizar') evento.waitUntil(sincronizarFila());
});

self.addEventListener('periodicsync', (evento) => {
  if (evento.tag === 'qpg-sincronizar') evento.waitUntil(sincronizarFila());
});

/**
 * Se o app estiver aberto, ele mesmo sincroniza (tem toda a lógica).
 * Se não estiver, o service worker faz a versão essencial aqui.
 */
async function sincronizarFila() {
  const clientes = await self.clients.matchAll({ type: 'window' });
  if (clientes.length) {
    clientes.forEach((c) => c.postMessage('qpg-sincronizar'));
    return;
  }
  await enviarPendentes();
}

const BANCO = 'qpg';
const LOJA = 'fila';

function abrirBanco() {
  return new Promise((ok, falha) => {
    const req = indexedDB.open(BANCO, 1);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
}

function lerTudo(db) {
  return new Promise((ok, falha) => {
    const req = db.transaction(LOJA, 'readonly').objectStore(LOJA).getAll();
    req.onsuccess = () => ok(req.result || []);
    req.onerror = () => falha(req.error);
  });
}

function gravar(db, registro) {
  return new Promise((ok, falha) => {
    const tx = db.transaction(LOJA, 'readwrite');
    tx.objectStore(LOJA).put(registro);
    tx.oncomplete = () => ok();
    tx.onerror = () => falha(tx.error);
  });
}

// Motivos que dependem de uma ação do usuário — não adianta insistir agora.
const PRECISA_DE_VOCE = ['sem_creditos', 'chave_invalida', 'sem_chave', 'token_invalido'];

async function enviarPendentes() {
  let config;
  try {
    // O service worker não enxerga localStorage, então o app espelha a config
    // dentro do próprio IndexedDB ao salvar.
    const db = await abrirBanco();
    const todos = await lerTudo(db);
    config = todos.find((i) => i.uuid === '__config__');
    if (!config?.url || !config?.token) return;

    const fila = todos
      .filter((i) => i.uuid !== '__config__' && i.estado !== 'sincronizado')
      .sort((a, b) => a.criado_em - b.criado_em);

    for (const item of fila) {
      const resposta = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          acao: 'capturar',
          token: config.token,
          uuid: item.uuid,
          texto: item.texto,
          lancamento: item.lancamento
        })
      }).then((r) => r.json()).catch(() => ({ ok: false, erro: 'sem_rede' }));

      if (resposta.ok) {
        await gravar(db, { ...item, estado: 'sincronizado', motivo: '', ultima_tentativa: Date.now() });
      } else {
        await gravar(db, {
          ...item,
          estado: item.lancamento ? 'pendente' : 'aguardando_ia',
          motivo: resposta.erro,
          tentativas: (item.tentativas || 0) + 1,
          ultima_tentativa: Date.now()
        });
        if (PRECISA_DE_VOCE.includes(resposta.erro)) break;
        if (resposta.erro === 'sem_rede') break;
      }
    }
  } catch {
    // Sem drama: o app sincroniza na próxima vez que for aberto.
  }
}


// --------------------------------------------------------------------------
// Avisos de conta fixa (Web Push)
// --------------------------------------------------------------------------
// O script da planilha manda um "cutucão" vazio; o texto vem daqui: o service
// worker pergunta ao script (ação `avisos`) o que mostrar, com a config que o
// app espelhou no IndexedDB. Todo cutucão precisa virar uma notificação.

self.addEventListener('push', (evento) => {
  evento.waitUntil(mostrarAvisos());
});

async function mostrarAvisos() {
  let avisos = null;
  try {
    const db = await abrirBanco();
    const config = (await lerTudo(db)).find((i) => i.uuid === '__config__');
    if (config?.url && config?.token) {
      const r = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ acao: 'avisos', token: config.token })
      }).then((x) => x.json());
      if (r.ok) avisos = r.avisos || [];
    }
  } catch {
    avisos = null;
  }
  if (avisos === null) avisos = [{ titulo: '⚔️ Chefes do mês', corpo: 'Tem conta para olhar hoje. Toque para abrir.', tag: 'geral' }];
  if (!avisos.length) avisos = [{ titulo: '✅ Tudo em dia', corpo: 'Nenhuma conta fixa pedindo atenção agora.', tag: 'em-dia' }];
  await Promise.all(avisos.map((a) => self.registration.showNotification(a.titulo, {
    body: a.corpo,
    tag: `qpg-${a.tag || 'aviso'}`,
    renotify: true,
    icon: './icone-192.png',
    data: { url: './?aba=mes' }
  })));
}

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const alvo = new URL(evento.notification.data?.url || './', self.registration.scope).href;
  evento.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const aberta = janelas.find((j) => j.url.startsWith(self.registration.scope));
    if (aberta) { await aberta.focus(); return aberta.navigate(alvo).catch(() => {}); }
    return self.clients.openWindow(alvo);
  })());
});
