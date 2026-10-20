import { useCallback, useEffect, useMemo, useState } from 'react';
import Novo from './telas/Novo.jsx';
import Mes from './telas/mes/Mes.jsx';
import Perguntar from './telas/Perguntar.jsx';
import Historico from './telas/Historico.jsx';
import Pendentes from './telas/Pendentes.jsx';
import Ajustes from './telas/Ajustes.jsx';
import Cadastros from './telas/Cadastros.jsx';
import Mensais from './telas/Mensais.jsx';
import { ESTADO, listar } from './lib/db.js';
import { acessoValidado, api, configurado, marcarAcessoValido } from './lib/api.js';
import { aoMudar, ligarSincronizacaoAutomatica } from './lib/sync.js';
import { VERSAO_APP, menorQue } from './lib/versao.js';
import { mesDeHoje, mesPorExtenso } from './lib/datas.js';
import { ABA, FOLHA_ABAS } from './lib/icones.js';
import { calcularOuro } from './lib/ouro.js';
import { calcularMana } from './lib/mana.js';

const CACHE = 'qpg.cadastros';
// O painel do mês fica guardado para o ouro de hoje aparecer na hora em que o
// app abre, antes da planilha responder. `.em` é quando ele foi pedido.
const CACHE_PAINEL = 'qpg.painel';
const VAZIO = { categorias: [], contas: [], fontes: [], pessoas: [] };

/** O cache só é seu depois que o app falou com a sua planilha neste aparelho. */
function painelSalvo() {
  if (!acessoValidado()) return { painel: null, em: 0 };
  try {
    return {
      painel: JSON.parse(localStorage.getItem(CACHE_PAINEL) || 'null'),
      em: Number(localStorage.getItem(`${CACHE_PAINEL}.em`)) || 0
    };
  } catch {
    return { painel: null, em: 0 };
  }
}

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
  const [aba, setAba] = useState('novo');
  const [fila, setFila] = useState([]);
  const [cadastros, setCadastros] = useState(cadastrosSalvos);
  const [resumo, setResumo] = useState(null);
  const [painel, setPainel] = useState(painelSalvo);
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

    // O ouro de hoje precisa da previsão do mês (contas fixas e rendas que
    // ainda vêm). Anota quando pediu: o que subir depois disso ainda não está
    // nele, e lib/ouro.js soma por conta própria.
    const pedidoEm = Date.now();
    const pn = await api.painel();
    if (pn.ok) {
      setPainel({ painel: pn, em: pedidoEm });
      try {
        localStorage.setItem(CACHE_PAINEL, JSON.stringify(pn));
        localStorage.setItem(`${CACHE_PAINEL}.em`, String(pedidoEm));
      } catch { /* sem espaço: só não abre na hora da próxima vez */ }
    }
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
    setPainel({ painel: null, em: 0 });
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
  const ouro = useMemo(() => calcularOuro(painel.painel, fila, { desde: painel.em }), [painel, fila]);
  // Na tela Novo só vale a mana do mês que está correndo (o cache pode ser do mês passado).
  const mana = useMemo(
    () => calcularMana(painel.painel?.mes === mesDeHoje() ? painel.painel : null, fila, { desde: painel.em }),
    [painel, fila]
  );
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
          <Ajustes aoSalvar={() => { verificarAcesso().then((ok) => { if (ok) { recarregarDados(); recarregarFila(); setAba('novo'); } }); }} />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topo">
        <h1>
          Quanto Posso Gastar
          <span className="sub">{resumo ? mesPorExtenso(resumo.mes) : 'seu livro-caixa'}</span>
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
        {versaoScript && menorQue(versaoScript, VERSAO_APP) && (
          <div className="aviso atencao" role="status">
            <strong>O script da planilha está atrasado</strong>
            <span className="detalhe">
              O app é a {VERSAO_APP} e o script é a {versaoScript}. Cole o Codigo.gs novo no
              Apps Script e implante em <strong>Nova versão</strong> — até lá, o que é novo
              não funciona.
            </span>
          </div>
        )}

        {/* A chave por aba faz o conteúdo entrar de novo a cada troca: é o
            fade que separa uma tela da outra em vez do corte seco. */}
        <div className="vista" key={aba}>
        {aba === 'novo' && <Novo cadastros={cadastros} resumo={resumo} ouro={ouro} mana={mana} aoMudarFila={tudo} />}
        {aba === 'mes' && <Mes cadastros={cadastros} aoMudarDados={tudo} />}
        {aba === 'perguntar' && <Perguntar aoVerHistorico={() => setAba('historico')} />}
        {aba === 'historico' && <Historico />}
        {aba === 'fila' && (
          <>
            <button className="btn discreto voltar" onClick={() => setAba('novo')}>
              ‹ Voltar
            </button>
            <Pendentes fila={fila} aoMudarFila={recarregarFila} cadastros={cadastros} aoMudarDados={recarregarDados} />
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
            <Ajustes aoSalvar={() => { recarregarDados(); setAba('novo'); }} />
          </>
        )}
        </div>
      </main>

      {/* Registrar é o que mais se faz: por isso a moeda mora no meio, maior. */}
      <footer className="rodape">
        <nav>
          <Botao atual={aba} id="mes" rotulo="Mês" aoClicar={setAba} />
          <Botao atual={aba} id="perguntar" rotulo="Perguntar" aoClicar={setAba} />
          <Botao atual={aba} id="novo" rotulo="Novo" aoClicar={setAba} central />
          <Botao atual={aba} id="historico" rotulo="Histórico" aoClicar={setAba} />
          <Botao atual={aba} id="ajustes" rotulo="Ajustes" aoClicar={setAba} />
        </nav>
      </footer>
    </div>
  );
}

function Botao({ atual, id, rotulo, aoClicar, central = false }) {
  const icone = (
    <span
      className="aba-icone"
      aria-hidden="true"
      style={{ backgroundImage: `url(${FOLHA_ABAS})`, backgroundPositionX: `${-(central ? 48 : 24) * ABA[id]}px` }}
    />
  );
  return (
    <button
      className={central ? 'central' : undefined}
      onClick={() => aoClicar(id)}
      aria-current={atual === id ? 'page' : undefined}
    >
      {central ? <span className="botao-mais">{icone}</span> : icone}
      {rotulo}
    </button>
  );
}
