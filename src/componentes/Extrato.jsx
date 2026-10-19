import { useEffect, useRef, useState } from 'react';
import Esqueleto from './Esqueleto.jsx';
import { api } from '../lib/api.js';
import { formatarBRL } from '../lib/parser.js';

// Tudo o que você já lançou, do mais novo para o mais antigo, agrupado pelo dia
// da compra. A planilha guarda para sempre; esta tela é a janela para ela.
// Busca e página vêm do script — o celular só recebe o pedaço que cabe na tela.

const POR_VEZ = 30;

// Um ícone por categoria é o que deixa a lista ser lida de relance, em vez de
// palavra por palavra. Categoria que não estiver aqui cai no genérico.
const ICONE = {
  'Mercado': '🛒', 'Alimentação': '🍽', 'Transporte': '⛽', 'Moradia': '🏠',
  'Saúde': '💊', 'Telefone': '📱', 'Assinaturas': '📺', 'Educação': '🎓',
  'Lazer': '🍺', 'Compras': '🛍', 'Casa': '🛠', 'Pet': '🐾',
  'Presentes': '🎁', 'Taxas': '🧾', 'Salário': '💰', 'Freela': '💼',
  'Reembolso': '↩️', 'Rendimento': '📈'
};

export default function Extrato() {
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState([]);
  const [total, setTotal] = useState(0);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [buscandoMais, setBuscandoMais] = useState(false);
  const [erro, setErro] = useState(null);

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

      {erro && (
        <div className="aviso ruim" role="alert">
          <strong>Não consegui carregar</strong>
          <span className="detalhe">{erro}</span>
        </div>
      )}

      {carregando && <Esqueleto modo="lista" />}

      {!carregando && !erro && itens.length === 0 && (
        <div className="lista">
          <p className="vazio">
            {busca
              ? `Nada encontrado para "${busca}".`
              : 'Nenhum lançamento na planilha ainda. Toque em Falar e registre o primeiro.'}
          </p>
        </div>
      )}

      {agruparPorDia(itens).map((grupo) => (
        <div className="grupo-dia" key={grupo.data}>
          <p className="secao-titulo" style={{ margin: 0 }}>{rotuloDia(grupo.data)}</p>
          <div className="lista">
            {grupo.itens.map((l) => <Linha key={l.uuid} l={l} />)}
          </div>
        </div>
      ))}

      {temMais && (
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
    </>
  );
}

function Linha({ l }) {
  const receita = l.tipo === 'receita';
  const parcela = l.parcela_atual && l.parcelas_total
    ? ` · ${l.parcela_atual}/${l.parcelas_total}`
    : '';

  return (
    <div className="item">
      <span className="icone-cat" aria-hidden="true">
        {ICONE[l.categoria] || (receita ? '💰' : '💳')}
      </span>
      <div className="corpo">
        <span className="meta">
          {l.categoria || (receita ? 'Entrada' : 'Sem categoria')}{parcela}
        </span>
        <span className="titulo">{l.descricao || l.texto_falado || l.categoria || '—'}</span>
      </div>
      <span className={`num ${receita ? 'receita' : ''}`}>{formatarBRL(l.valor)}</span>
    </div>
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

  const rotulo = `${d} de ${MESES[m - 1]}`;
  return a === hoje.getFullYear() ? rotulo : `${rotulo} de ${a}`;
}

function zerar(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
