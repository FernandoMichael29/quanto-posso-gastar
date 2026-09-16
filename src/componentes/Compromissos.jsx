import Sanfona from './Sanfona.jsx';
import { formatarBRL } from '../lib/parser.js';

// Contas fixas e rendas do mês.
//
// A lista inteira fica enorme e, pior, fica enorme com o que já está resolvido:
// no dia 20 quase tudo está "já lançado" e o que precisa de você some no meio.
// Então o que aparece é o que ainda pede ação; o resto vira uma linha só, que
// abre se você quiser conferir.

export default function Compromissos({
  titulo,
  resumo,          // texto à direita do título da seção
  itens,
  aoAbrir,
  rotuloFeitos     // { um: 'já lançada', varios: 'já lançadas' }
}) {
  if (!itens.length) return null;

  const pendentes = itens.filter((i) => !i.lancado);
  const feitos = itens.filter((i) => i.lancado);
  const totalFeitos = feitos.reduce(
    (a, i) => a + (i.valor_lancado != null ? i.valor_lancado : i.valor), 0
  );

  return (
    <>
      <div className="secao-cabecalho">
        <p className="secao-titulo" style={{ margin: 0 }}>{titulo}</p>
        {resumo && <span className="ajuda" style={{ margin: 0 }}>{resumo}</span>}
      </div>

      {pendentes.length > 0 && <Linhas itens={pendentes} aoAbrir={aoAbrir} />}

      {feitos.length > 0 && (
        <Sanfona
          titulo={`${feitos.length} ${feitos.length === 1 ? rotuloFeitos.um : rotuloFeitos.varios}`}
          resumo={formatarBRL(totalFeitos)}
        >
          <Linhas itens={feitos} aoAbrir={aoAbrir} />
        </Sanfona>
      )}
    </>
  );
}

function Linhas({ itens, aoAbrir }) {
  return (
    <div className="lista">
      {itens.map((i) => (
        <button
          type="button"
          className={`item fixa clicavel ${i.lancado ? 'paga' : ''}`}
          key={i.nome}
          onClick={() => aoAbrir(i)}
        >
          <span className={`ponto ${i.situacao}`} aria-hidden="true" />
          <span className="corpo">
            <span className="titulo">{i.nome_visivel || i.nome}</span>
            <span className={`meta ${i.situacao === 'erro' ? 'atrasada' : ''}`}>
              {i.rotulo}
              {i.tipo === 'receita'
                ? (i.conta ? ` · ${i.conta}` : '')
                : (i.categoria ? ` · ${i.categoria}` : '')}
            </span>
          </span>
          <span className={`num ${i.tipo === 'receita' ? 'receita' : ''}`}>
            {formatarBRL(i.lancado && i.valor_lancado != null ? i.valor_lancado : i.valor)}
          </span>
          <span className="seta" aria-hidden="true">›</span>
        </button>
      ))}
    </div>
  );
}
