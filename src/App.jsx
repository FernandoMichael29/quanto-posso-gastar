import { useCallback, useEffect, useState } from 'react';
import Falar from './telas/Falar.jsx';
import Mes from './telas/Mes.jsx';
import Perguntar from './telas/Perguntar.jsx';
import Pendentes from './telas/Pendentes.jsx';
import Ajustes from './telas/Ajustes.jsx';
import Cadastros from './telas/Cadastros.jsx';
import Mensais from './telas/Mensais.jsx';
import { ESTADO, listar } from './lib/db.js';
import { acessoValidado, api, configurado, marcarAcessoValido } from './lib/api.js';
import { aoMudar, ligarSincronizacaoAutomatica } from './lib/sync.js';
import { VERSAO_APP, menorQue } from './lib/versao.js';

const CACHE = 'qpg.cadastros';
const VAZIO = { categorias: [], contas: [], fontes: [], pessoas: [] };

/** O cache só é seu depois que o app falou com a sua planilha neste aparelho. */
function cadastrosSalvos() {
  if (!acessoValidado()) return VAZIO;
  try {
    const salvo = JSON.parse(localStorage.getItem(CACHE) || 'null');
    return salvo?.categorias ? salvo : VAZIO;
  } catch {
    return VAZIO;
  }
}

export default function App() {
  // 'verificando' enquanto o app checa a planilha; 'bloqueado' significa que
  // nunca houve conversa bem-sucedida com ela, e aí nada é mostrado.
  const [acesso, setAcesso] = useState(() => (acessoValidado() ? 'liberado' : 'verificando'));
  const [aba, setAba] = useState('falar');
  const [fila, setFila] = useState([]);
  const [cadastros, setCadastros] = useState(cadastrosSalvos);
  const [resumo, setResumo] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [versaoScript, setVersaoScript] = useState(null);

  const recarregarFila = useCallback(async () => setFila(await listar()), []);

  const recarregarDados = useCallback(async () => {
    if (!configurado() || !navigator.onLine) return;

    // Pergunta ao script em que versão ele está. É o que permite dizer na tela
    // "isto aqui ainda é o código velho" em vez de você ficar procurando um bug
    // que não existe.
    api.ping().then((p) => { if (p.ok) setVersaoScript(p.versao || '?'); });

    const c = await api.cadastros();
    if (c.ok) marcarAcessoValido();
    if (c.ok && c.categorias?.length) {
      const novo = {
        categorias: c.categorias,
        contas: c.contas || [],
        fontes: c.fontes || [],
        pessoas: c.pessoas || []
      };
      setCadastros(novo);
      localStorage.setItem(CACHE, JSON.stringify(novo));
    }

    const r = await api.resumo();
    if (r.ok) setResumo(r);
  }, []);

  // A porta de entrada: sem um "alô" da planilha, o app não mostra nada.
  const verificarAcesso = useCallback(async () => {
    if (acessoValidado()) { setAcesso('liberado'); return true; }
    if (!configurado()) { setAcesso('bloqueado'); return false; }

    const r = await api.ping();
    if (r.ok) {
      marcarAcessoValido();
      setAcesso('liberado');
      return true;
    }
    setAcesso('bloqueado');
    setCadastros(VAZIO);
    setResumo(null);
    return false;
  }, []);

  useEffect(() => {
    let vivo = true;
    verificarAcesso().then((ok) => {
      if (!vivo || !ok) return;
      recarregarFila();
      recarregarDados();
    });
    return () => { vivo = false; };
  }, [verificarAcesso, recarregarFila, recarregarDados]);

  useEffect(() => {
    if (acesso !== 'liberado') return;
    const desligar = ligarSincronizacaoAutomatica();
    const parar = aoMudar(recarregarFila);

    const mudouRede = () => setOnline(navigator.onLine);
    window.addEventListener('online', mudouRede);
    window.addEventListener('offline', mudouRede);

    return () => {
      desligar();
      parar();
      window.removeEventListener('online', mudouRede);
      window.removeEventListener('offline', mudouRede);
    };
  }, [acesso, recarregarFila]);

  const esperando = fila.filter((i) => i.estado !== ESTADO.SINCRONIZADO).length;
  const tudo = () => { recarregarFila(); recarregarDados(); };

  if (acesso === 'verificando') {
    return (
      <div className="app">
        <main className="conteudo porta">
          <div className="cartao pensando">
            <span className="girando" aria-hidden="true" />
            <span>Falando com a sua planilha…</span>
          </div>
        </main>
      </div>
    );
  }

  if (acesso === 'bloqueado') {
    return (
      <div className="app">
        <header className="topo">
          <h1>
            Quanto Posso Gastar
            <span className="sub">conectar à planilha</span>
          </h1>
        </header>
        <main className="conteudo porta">
          <div className="aviso atencao">
            <strong>Endereço ou token não encontrado</strong>
          </div>
          <Ajustes aoSalvar={() => { verificarAcesso().then((ok) => { if (ok) { recarregarDados(); recarregarFila(); setAba('falar'); } }); }} />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topo">
        <h1>
          Quanto Posso Gastar
          <span className="sub">{resumo ? mesPorExtenso(resumo.mes) : 'finanças por voz'}</span>
        </h1>

        {/* A fila mora aqui em cima: quando há algo esperando, ela se anuncia
            e abre com um toque; quando não há, só informa se está online. */}
        <button
          type="button"
          className={`pastilha ${esperando ? 'alerta' : ''}`}
          onClick={() => setAba('fila')}
          aria-label={esperando ? `${esperando} lançamentos na fila` : 'Ver a fila'}
        >
          <span className={`ponto ${esperando ? 'pendente' : (online ? 'on' : 'off')}`} aria-hidden="true" />
          {esperando ? `${esperando} na fila` : (online ? 'online' : 'offline')}
        </button>
      </header>

      <main className="conteudo">
        {versaoScript && versaoScript !== VERSAO_APP && (
          <div className="aviso atencao" role="status">
            <strong>As duas metades estão em versões diferentes</strong>
            <span className="detalhe">
              O app é a {VERSAO_APP} e o script da planilha é a {versaoScript}.
              {menorQue(versaoScript, VERSAO_APP)
                ? ' Cole o Codigo.gs novo no Apps Script e implante com "Nova versão" — até lá, o que é novo não aparece.'
                : ' O site ainda está com a versão antiga: espere o deploy do GitHub terminar e recarregue.'}
            </span>
          </div>
        )}

        {aba === 'falar' && (
          <Falar cadastros={cadastros} resumo={resumo} aoMudarFila={tudo} aoIrParaFila={() => setAba('fila')} />
        )}
        {aba === 'mes' && <Mes cadastros={cadastros} aoMudarDados={tudo} />}
        {aba === 'perguntar' && <Perguntar />}
        {aba === 'fila' && (
          <>
            <button className="btn discreto voltar" onClick={() => setAba('falar')}>
              ‹ Voltar
            </button>
            <Pendentes fila={fila} aoMudarFila={recarregarFila} />
          </>
        )}
        {aba === 'ajustes' && (
          <>
            <p className="secao-titulo">Contas fixas e rendas mensais</p>
            <Mensais cadastros={cadastros} mes={resumo?.mes} aoMudar={tudo} />
            <hr className="divisor" />
            <Cadastros cadastros={cadastros} aoMudar={recarregarDados} />
            <hr className="divisor" />
            <p className="secao-titulo">Conexão com a planilha</p>
            <Ajustes aoSalvar={() => { recarregarDados(); setAba('falar'); }} />
          </>
        )}
      </main>

      <footer className="rodape">
        <nav>
          <Botao atual={aba} id="falar" rotulo="Falar" aoClicar={setAba}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <rect x="9" y="2.5" width="6" height="11" rx="3" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
            </svg>
          </Botao>
          <Botao atual={aba} id="mes" rotulo="Mês" aoClicar={setAba}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.2" y="4.5" width="17.6" height="16" rx="2.5" />
              <path d="M3.2 9.5h17.6M8 2.8v3.4M16 2.8v3.4" />
            </svg>
          </Botao>
          <Botao atual={aba} id="perguntar" rotulo="Perguntar" aoClicar={setAba}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19V9M9.5 19V5M15 19v-7M20.5 19v-4" />
            </svg>
          </Botao>
          <Botao atual={aba} id="ajustes" rotulo="Ajustes" aoClicar={setAba}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" />
            </svg>
          </Botao>
        </nav>
      </footer>
    </div>
  );
}

function Botao({ atual, id, rotulo, aoClicar, children }) {
  return (
    <button onClick={() => aoClicar(id)} aria-current={atual === id ? 'page' : undefined}>
      {children}
      {rotulo}
    </button>
  );
}

function mesPorExtenso(mes) {
  if (!mes) return '';
  const [ano, m] = mes.split('-');
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${nomes[Number(m) - 1]} de ${ano}`;
}
