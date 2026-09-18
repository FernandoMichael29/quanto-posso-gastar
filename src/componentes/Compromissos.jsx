import Sanfona from './Sanfona.jsx';
import Capa from './Capa.jsx';
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
  ocupado,         // 'fixa:<nome>' da linha que está salvando, se houver
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

      {pendentes.length > 0 && <Linhas itens={pendentes} ocupado={ocupado} aoAbrir={aoAbrir} />}

      {feitos.length > 0 && (
        <Sanfona
          titulo={`${feitos.length} ${feitos.length === 1 ? rotuloFeitos.um : rotuloFeitos.varios}`}
          resumo={formatarBRL(totalFeitos)}
        >
          <Linhas itens={feitos} ocupado={ocupado} aoAbrir={aoAbrir} />
        </Sanfona>
      )}
    </>
  );
}

/**
 * Qual número aparece na linha. O valor da regra mensal é só o combinado: se
 * já existe lançamento — feito ou marcado para cair — o valor dele é o que
 * vale, senão editar o lançamento mudava a janela e a linha ficava no valor
 * antigo.
 */
function valorQueVale(i) {
  if (i.lancado && i.valor_lancado != null) return i.valor_lancado;
  if (i.valor_agendado != null) return i.valor_agendado;
  return i.valor;
}

function Linhas({ itens, ocupado, aoAbrir }) {
  return (
    <div className="lista">
      {itens.map((i) => (
        <button
          type="button"
          className={`item fixa clicavel ${i.lancado ? 'paga' : ''} ${ocupado === `fixa:${i.nome}` ? 'ocupado' : ''}`}
          key={i.nome}
          onClick={() => aoAbrir(i)}
          disabled={ocupado === `fixa:${i.nome}`}
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
            {formatarBRL(valorQueVale(i))}
          </span>
          <span className="seta" aria-hidden="true">›</span>
          <Capa quando={ocupado === `fixa:${i.nome}`} />
        </button>
      ))}
    </div>
  );
}
