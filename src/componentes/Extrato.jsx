import { useEffect, useRef, useState } from 'react';
import Capa from './Capa.jsx';
import Esqueleto from './Esqueleto.jsx';
import Item from './Item.jsx';
import { EditarLancamento } from '../telas/mes/Modais.jsx';
import { api } from '../lib/api.js';
import { formatarBRL } from '../lib/parser.js';

// Tudo o que você já lançou, do mais novo para o mais antigo, agrupado pelo dia
// da compra. A planilha guarda para sempre; esta tela é a janela para ela.
// Busca e página vêm do script — o celular só recebe o pedaço que cabe na tela.
// Tocar numa linha abre o mesmo editor da tela do Mês.

const POR_VEZ = 30;

export default function Extrato({ cadastros, aoMudarDados }) {
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState([]);
  const [total, setTotal] = useState(0);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [buscandoMais, setBuscandoMais] = useState(false);
  const [erro, setErro] = useState(null);

  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  // A linha que está esperando a planilha: a janela fecha na hora, mas o
  // valor novo só chega depois — sem a capa parece que não salvou.
  const [ocupado, setOcupado] = useState(null);
  const [aprendido, setAprendido] = useState(null);

  // Cada busca cancela a anterior: digitar rápido não pode fazer um resultado
  // velho chegar depois e sobrescrever o novo.
  const pedido = useRef(0);

  useEffect(() => {
    const atraso = setTimeout(() => {
      const meu = ++pedido.current;
      setCarregando(true);
      setErro(null);
      api.extrato(busca, 0, POR_VEZ).then((r) => {
        if (meu !== pedido.current) return;
        setCarregando(false);
        if (!r.ok) { setErro(r.detalhe || 'Não consegui ler a planilha agora.'); return; }
        setItens(r.lancamentos || []);
        setTotal(r.total || 0);
        setTemMais(!!r.tem_mais);
      });
    }, busca ? 400 : 0);
    return () => clearTimeout(atraso);
  }, [busca]);

  async function carregarMais() {
    const meu = pedido.current;
    setBuscandoMais(true);
    const r = await api.extrato(busca, itens.length, POR_VEZ);
    setBuscandoMais(false);
    if (meu !== pedido.current || !r.ok) return;
    setItens((atual) => atual.concat(r.lancamentos || []));
    setTemMais(!!r.tem_mais);
  }

  /** Relê de uma vez tudo o que já está na tela — sem perder o "carregar mais". */
  async function releitura() {
    const meu = ++pedido.current;
    const r = await api.extrato(busca, 0, Math.max(itens.length, POR_VEZ));
    if (meu !== pedido.current || !r.ok) return;
    setItens(r.lancamentos || []);
    setTotal(r.total || 0);
    setTemMais(!!r.tem_mais);
  }

  async function salvar(uuid, chamada, aoDarCerto) {
    setSalvando(true);
    setOcupado(uuid);
    const r = await chamada;
    setSalvando(false);
    if (!r.ok) { setErro(r.detalhe || 'Não consegui salvar na planilha.'); setOcupado(null); return; }
    aoDarCerto?.(r);
    setEditando(null);
    await releitura();
    setOcupado(null);
    aoMudarDados?.();
  }

  return (
    <>
      <p className="secao-titulo">Tudo o que você já lançou</p>

      <div className="busca">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar por descrição, categoria ou valor…"
          aria-label="Procurar nos lançamentos"
          autoComplete="off"
        />
        {busca && (
          <button type="button" className="busca-limpar" onClick={() => setBusca('')} aria-label="Limpar a busca">
            ×
          </button>
        )}
      </div>

      {aprendido && (
        <div className="aviso bom" role="status">
          <strong>Aprendi: “{aprendido.palavra}” agora é {aprendido.categoria}</strong>
          <span className="detalhe">Da próxima vez que você falar isso, já vem na categoria certa.</span>
        </div>
      )}

      {erro && (
        <div className="aviso ruim" role="alert">
          <strong>Não consegui</strong>
          <span className="detalhe">{erro}</span>
        </div>
      )}

      {carregando && <Esqueleto modo="lista" />}

      {!carregando && !erro && itens.length === 0 && (
        <div className="lista">
          <p className="vazio">
            {busca
              ? `Nada encontrado para "${busca}".`
              : 'Nenhum lançamento na planilha ainda. Toque na moeda lá embaixo e registre o primeiro.'}
          </p>
        </div>
      )}

      {!carregando && agruparPorDia(itens).map((grupo) => (
        <div className="grupo-dia" key={grupo.data}>
          <p className="secao-titulo" style={{ margin: 0 }}>{rotuloDia(grupo.data)}</p>
          <div className="lista">
            {grupo.itens.map((l) => (
              <Linha
                key={l.uuid}
                l={l}
                ocupado={ocupado === l.uuid}
                aoAbrir={() => { setAprendido(null); setEditando({ ...l }); }}
              />
            ))}
          </div>
        </div>
      ))}

      {temMais && !carregando && (
        <button className="btn" onClick={carregarMais} disabled={buscandoMais}>
          {buscandoMais ? 'Carregando…' : `Carregar mais ${POR_VEZ}`}
        </button>
      )}

      {!carregando && !erro && itens.length > 0 && (
        <p className="ajuda" style={{ textAlign: 'center' }}>
          {temMais
            ? `${itens.length} de ${total} lançamentos`
            : `${total} ${total === 1 ? 'lançamento' : 'lançamentos'}${busca ? ' encontrados' : ' no total'}.`}
        </p>
      )}

      {editando && (
        <EditarLancamento
          lancamento={editando}
          cadastros={cadastros}
          ocupado={salvando}
          aoMudar={setEditando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            const { uuid, ...campos } = editando;
            salvar(uuid, api.editarLancamento(uuid, campos), (r) => setAprendido(r.aprendido || null));
          }}
          aoExcluir={() => salvar(editando.uuid, api.excluirLancamento(editando.uuid))}
        />
      )}
    </>
  );
}

function Linha({ l, ocupado, aoAbrir }) {
  const receita = l.tipo === 'receita';
  const agendado = l.status === 'agendado';
  const parcela = Number(l.parcelas_total) > 1 ? ` · ${l.parcela_atual}/${l.parcelas_total}` : '';

  return (
    <button
      type="button"
      className={`item clicavel extrato ${agendado ? 'agendado' : ''} ${ocupado ? 'ocupado' : ''}`}
      onClick={aoAbrir}
      disabled={ocupado}
    >
      <Item categoria={l.categoria} receita={receita} />
      <span className="corpo">
        <span className="meta">{l.categoria || (receita ? 'Entrada' : 'Sem categoria')}{parcela}</span>
        <span className="titulo">{l.descricao || l.texto_falado || l.categoria || '—'}</span>
        {agendado && <span className="marca-agendado">agendado · ainda não conta</span>}
      </span>
      <span className={`num ${receita ? 'receita' : ''}`}>{formatarBRL(l.valor)}</span>
      <Capa quando={ocupado} />
    </button>
  );
}

/** A lista já vem ordenada; aqui só se junta o que é do mesmo dia. */
function agruparPorDia(itens) {
  const grupos = [];
  itens.forEach((l) => {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.data === l.data) ultimo.itens.push(l);
    else grupos.push({ data: l.data, itens: [l] });
  });
  return grupos;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "hoje", "ontem", "17 de outubro" — e o ano só quando não é este. */
function rotuloDia(iso) {
  const [a, m, d] = String(iso || '').split('-').map(Number);
  if (!a || !m || !d) return 'sem data';

  const hoje = new Date();
  const dia = new Date(a, m - 1, d);
  const diferenca = Math.round((zerar(hoje) - zerar(dia)) / 86400000);
  if (diferenca === 0) return 'hoje';
  if (diferenca === 1) return 'ontem';
  if (diferenca === -1) return 'amanhã';

  const rotulo = `${d} de ${MESES[m - 1]}`;
  return a === hoje.getFullYear() ? rotulo : `${rotulo} de ${a}`;
}

function zerar(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
