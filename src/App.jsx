import { useCallback, useEffect, useState } from 'react';
import Falar from './telas/Falar.jsx';
import Pendentes from './telas/Pendentes.jsx';
import Ajustes from './telas/Ajustes.jsx';
import { CATEGORIAS_PADRAO } from './lib/categorias.js';
import { ESTADO, listar } from './lib/db.js';
import { api, configurado } from './lib/api.js';
import { aoMudar, ligarSincronizacaoAutomatica } from './lib/sync.js';

const CACHE_CATEGORIAS = 'qpg.categorias';

export default function App() {
  const [aba, setAba] = useState(configurado() ? 'falar' : 'ajustes');
  const [fila, setFila] = useState([]);
  const [categorias, setCategorias] = useState(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(CACHE_CATEGORIAS) || 'null');
      return salvo?.length ? salvo : CATEGORIAS_PADRAO;
    } catch {
      return CATEGORIAS_PADRAO;
    }
  });
  const [contas, setContas] = useState(['Principal', 'Carteira', 'Cartão']);
  const [resumo, setResumo] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);

  const recarregarFila = useCallback(async () => {
    setFila(await listar());
  }, []);

  const recarregarDados = useCallback(async () => {
    if (!configurado() || !navigator.onLine) return;

    const cats = await api.categorias();
    if (cats.ok && cats.categorias?.length) {
      setCategorias(cats.categorias);
      localStorage.setItem(CACHE_CATEGORIAS, JSON.stringify(cats.categorias));
    }
    if (cats.ok && cats.contas?.length) setContas(cats.contas);

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

  return (
    <div className="app">
      <header className="topo">
        <h1>
          Quanto Posso Gastar
          <span className="sub">
            {resumo ? mesPorExtenso(resumo.mes) : 'finanças por voz'}
          </span>
        </h1>
        <span className="pastilha">
          <span className={`ponto ${online ? 'on' : 'off'}`} aria-hidden="true" />
          {online ? 'online' : 'offline'}
        </span>
      </header>

      <main className="conteudo">
        {aba === 'falar' && (
          <Falar
            categorias={categorias}
            contas={contas}
            resumo={resumo}
            aoMudarFila={() => { recarregarFila(); recarregarDados(); }}
          />
        )}
        {aba === 'fila' && <Pendentes fila={fila} aoMudarFila={recarregarFila} />}
        {aba === 'ajustes' && (
          <Ajustes aoSalvar={() => { recarregarDados(); setAba('falar'); }} />
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
          <Botao atual={aba} id="fila" rotulo="Fila" aoClicar={setAba} selo={esperando}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h10" />
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

function Botao({ atual, id, rotulo, aoClicar, selo, children }) {
  return (
    <button
      onClick={() => aoClicar(id)}
      aria-current={atual === id ? 'page' : undefined}
    >
      {children}
      {rotulo}
      {selo > 0 && <span className="selo">{selo > 9 ? '9+' : selo}</span>}
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
