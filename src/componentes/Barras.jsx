import { formatarBRL } from '../lib/parser.js';

/**
 * Barras horizontais para comparar magnitudes — gasto por categoria, por conta,
 * por pessoa. Horizontal porque os rótulos são palavras, e palavra deitada num
 * eixo vertical de celular vira ilegível.
 *
 * Uma série só, então uma cor só: a identidade está no rótulo, não no matiz.
 * Quando há orçamento definido, um traço marca o teto e a barra passa a avisar.
 */
export default function Barras({ dados, orcamentos = {}, vazio = 'Nada aqui ainda.', aoTocar }) {
  if (!dados?.length) return <div className="lista"><p className="vazio">{vazio}</p></div>;

  const maior = Math.max(...dados.map((d) => d.total), ...Object.values(orcamentos).map(Number).filter(Boolean), 1);
  const total = dados.reduce((a, d) => a + d.total, 0);

  return (
    <div className="barras">
      {dados.map((d) => {
        const teto = Number(orcamentos[d.nome]) || 0;
        const estourou = teto > 0 && d.total > teto;
        const largura = Math.max((d.total / maior) * 100, 1.5);
        const parte = total > 0 ? Math.round((d.total / total) * 100) : 0;

        const conteudo = (
          <>
            <div className="barra-topo">
              <span className="barra-nome">{d.nome}</span>
              <span className="barra-valor">{formatarBRL(d.total)}</span>
            </div>
            <div className="barra-trilho">
              <div
                className={`barra-preenche ${estourou ? 'estourou' : ''}`}
                style={{ width: `${largura}%` }}
              />
              {teto > 0 && (
                <span className="barra-teto" style={{ left: `${(teto / maior) * 100}%` }} />
              )}
            </div>
            <div className="barra-rodape">
              <span>{parte}% do mês</span>
              {teto > 0 && (
                <span className={estourou ? 'estourou' : ''}>
                  {estourou ? 'passou de ' : 'teto '}{formatarBRL(teto)}
                </span>
              )}
            </div>
          </>
        );

        return aoTocar ? (
          <button type="button" className="barra" key={d.nome} onClick={() => aoTocar(d)}>
            {conteudo}
          </button>
        ) : (
          <div className="barra" key={d.nome}>{conteudo}</div>
        );
      })}
    </div>
  );
}
