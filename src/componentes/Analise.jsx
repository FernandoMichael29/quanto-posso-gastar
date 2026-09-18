import GraficoProjecao from './GraficoProjecao.jsx';
import { formatarBRL } from '../lib/parser.js';

// O desenho de uma análise: veredito, texto, projeção, sugestões e premissas.
// Vive fora da tela Perguntar porque o Histórico mostra exatamente a mesma
// coisa — uma resposta antiga reaberta não é um resumo, é a resposta inteira.

const VEREDITOS = {
  confortavel: { rotulo: 'Cabe no seu orçamento', classe: 'bom' },
  apertado: { rotulo: 'Cabe, mas sem margem', classe: 'atencao' },
  arriscado: { rotulo: 'Compromete mais do que sobra', classe: 'ruim' }
};

export default function Analise({ analise }) {
  if (!analise) return null;
  const veredito = VEREDITOS[analise.veredito];

  return (
    <>
      {veredito && (
        <div className={`aviso ${veredito.classe}`}>
          <strong>{veredito.rotulo}</strong>
          {analise.compromisso_mensal > 0 && (
            <span className="detalhe">
              Simulando {formatarBRL(analise.compromisso_mensal)} por mês.
            </span>
          )}
        </div>
      )}

      <div className="cartao">
        {String(analise.resposta || '')
          .split(/\n{2,}/)
          .filter(Boolean)
          .map((p, i) => <p key={i}>{p}</p>)}
      </div>

      <GraficoProjecao projecao={analise.projecao} compromisso={analise.compromisso_mensal} />

      {analise.sugestoes?.length > 0 && (
        <>
          <p className="secao-titulo">O que dá pra fazer</p>
          <div className="lista">
            {analise.sugestoes.map((s, i) => (
              <div className="item" key={i}>
                <span className="marcador" aria-hidden="true">{i + 1}</span>
                <span className="corpo"><span className="titulo">{s}</span></span>
              </div>
            ))}
          </div>
        </>
      )}

      {analise.premissas?.length > 0 && (
        <>
          <p className="secao-titulo">No que eu me baseei</p>
          <div className="cartao">
            <ul className="premissas">
              {analise.premissas.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
            <p className="ajuda">
              Se alguma dessas premissas estiver errada, me corrija falando —
              tipo &ldquo;meu aluguel agora é 1900&rdquo; — e pergunte de novo.
            </p>
          </div>
        </>
      )}
    </>
  );
}
