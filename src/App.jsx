import { useCallback, useEffect, useState } from 'react';
import Falar from './telas/Falar.jsx';
import Mes from './telas/Mes.jsx';
import Perguntar from './telas/Perguntar.jsx';
import Pendentes from './telas/Pendentes.jsx';
import Ajustes from './telas/Ajustes.jsx';
import Cadastros from './telas/Cadastros.jsx';
import { CATEGORIAS_PADRAO } from './lib/categorias.js';
import { ESTADO, listar } from './lib/db.js';
import { api, configurado } from './lib/api.js';
import { aoMudar, ligarSincronizacaoAutomatica } from './lib/sync.js';

const CACHE = 'qpg.cadastros';

const VAZIO = {
  categorias: CATEGORIAS_PADRAO,
  contas: [{ nome: 'Dinheiro', ativo: true }],
  fontes: [],
  pessoas: []
};

export default function App() {
  const [aba, setAba] = useState(configurado() ? 'falar' : 'ajustes');
  const [fila, setFila] = useState([]);
  const [cadastros, setCadastros] = useState(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(CACHE) || 'null');
      return salvo?.categorias?.length ? salvo : VAZIO;
    } catch {
      return VAZIO;
    }
  });
  const [resumo, setResumo] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);

  const recarregarFila = useCallback(async () => setFila(await listar()), []);

  const recarregarDados = useCallback(async () => {
    if (!configurado() || !navigator.onLine) return;

    const c = await api.cadastros();
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

  useEffect(() => {
    recarregarFila();
    recarregarDados();
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
  }, [recarregarFila, recarregarDados]);

  const esperando = fila.filter((i) => i.estado !== ESTADO.SINCRONIZADO).length;
  const tudo = () => { recarregarFila(); recarregarDados(); };

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
        {aba === 'falar' && (
          <Falar cadastros={cadastros} resumo={resumo} aoMudarFila={tudo} />
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
