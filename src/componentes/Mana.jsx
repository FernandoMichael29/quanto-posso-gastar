import Item from './Item.jsx';
import { depoisDoGasto, estadoDaMana } from '../lib/mana.js';
import { formatarBRL } from '../lib/parser.js';

// A mana por categoria: o teto do mês que ainda não foi gasto. Azul enquanto
// tem folga, vermelha perto de acabar, vazia quando estourou. O tracinho
// claro é o ritmo: onde a barra deveria estar hoje se o teto fosse gasto por
// igual no mês — barra à esquerda dele é gasto mais rápido que o mês.

const pct = (f) => `${Math.round(Math.max(0, Math.min(1, f)) * 1000) / 10}%`;
const cor = (estado) => (estado === 'cheia' ? 'mana' : 'perigo');

function BarraDeMana({ m, custo = 0, fina = false }) {
  const depois = custo > 0 ? Math.max(0, depoisDoGasto(m, custo) / m.teto) : m.fracao;
  return (
    <span
      className={`hp ${cor(custo > 0 ? estadoDaMana(depoisDoGasto(m, custo) / m.teto) : m.estado)} ${fina ? 'fina' : ''}`}
      style={{ '--p': pct(m.fracao) }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(m.fracao * 100)}
      aria-label={`mana de ${m.categoria}`}
    >
      <i />
      {/* O pedaço que este gasto vai consumir, piscando. */}
      {custo > 0 && m.fracao > 0 && (
        <b className="custo" style={{ left: pct(depois), width: pct(m.fracao - depois) }} />
      )}
      {m.ritmo !== null && <em className="ritmo" style={{ left: pct(m.ritmo) }} />}
    </span>
  );
}

/** A frase de baixo de cada barra. */
function nota(m) {
  if (m.mana < 0) return <span className="ruim">passou {formatarBRL(-m.mana)} do teto</span>;
  if (m.mana === 0) return <span className="ruim">acabou bem no teto</span>;
  if (m.apressada) return <span className="ruim">gastando mais rápido que o mês{m.porDia != null ? ` · ${formatarBRL(m.porDia)} por dia` : ''}</span>;
  if (m.porDia != null) return <>{formatarBRL(m.porDia)} por dia até o fim do mês</>;
  return <>de {formatarBRL(m.teto)}</>;
}

/** A seção da aba Resumo: uma linha por categoria com teto. */
export default function Mana({ lista, aberto }) {
  if (!lista?.length) {
    if (!aberto) return null;
    return (
      <div className="mana-vazia">
        <p className="px">SEM MANA AINDA</p>
        <p>Dê um teto por mês às categorias em <strong>Ajustes → Categorias</strong> e cada uma ganha uma barra de mana aqui e na tela Novo.</p>
      </div>
    );
  }

  const apertadas = lista.filter((m) => m.estado !== 'cheia').length;
  return (
    <>
      <div className="secao-cabecalho">
        <p className="secao-titulo" style={{ margin: 0 }}>Mana por categoria</p>
        <span className="ajuda" style={{ margin: 0 }}>
          {apertadas ? `${apertadas} perto do fim` : 'tudo com folga'}
        </span>
      </div>
      <div className="lista">
        {lista.map((m) => (
          <div className={`item mana-linha ${m.estado}`} key={m.categoria}>
            <Item categoria={m.categoria} />
            <span className="corpo">
              <span className="mana-topo">
                <span className="titulo">{m.categoria}</span>
                <span className="mana-valor px">
                  {formatarBRL(Math.max(0, m.mana))}<small> / {formatarBRL(m.teto)}</small>
                </span>
              </span>
              <BarraDeMana m={m} fina />
              <span className="meta">{nota(m)}</span>
            </span>
          </div>
        ))}
      </div>
      {lista[0].ritmo !== null && (
        <p className="ajuda legenda-ritmo">
          <span className="tracinho" aria-hidden="true" /> onde a barra deveria estar hoje, se o teto fosse gasto por igual no mês
        </p>
      )}
    </>
  );
}

/**
 * Na tela Novo, embaixo do inventário: quanto da mana da categoria escolhida
 * este gasto vai consumir, antes de registrar.
 */
export function CustoDeMana({ m, custo }) {
  if (!m) return null;
  const depois = depoisDoGasto(m, custo);
  return (
    <div className={`custo-mana ${depois < 0 ? 'estoura' : ''}`}>
      <div className="legenda">
        <span>MANA · {m.categoria.toUpperCase()}</span>
        <span>
          {formatarBRL(Math.max(0, m.mana))}
          {custo > 0 && <> → <strong>{formatarBRL(Math.max(0, depois))}</strong></>}
        </span>
      </div>
      <BarraDeMana m={m} custo={custo} />
      {custo > 0 && depois < 0 && (
        <p className="sub">Este gasto passa {formatarBRL(-depois)} do teto de {formatarBRL(m.teto)}.</p>
      )}
      {custo > 0 && depois >= 0 && m.porDia != null && (
        <p className="sub">Depois dele: {formatarBRL(depois / m.dias)} por dia até o fim do mês.</p>
      )}
    </div>
  );
}
