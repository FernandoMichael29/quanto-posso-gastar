import { useState } from 'react';
import { formatarBRL } from '../lib/parser.js';

/**
 * Entrou e saiu, lado a lado, nos últimos seis meses.
 * Duas séries, então duas cores — as mesmas do resto do app, validadas para
 * daltonismo e contraste em ambos os temas. A legenda está sempre presente e
 * o toque abre os números do mês, para a cor nunca ser a única pista.
 */

const L = 560, A = 230;
const MARGEM = { topo: 20, dir: 8, baixo: 40, esq: 46 };
const NOMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export default function GraficoEvolucao({ evolucao, mesAtual }) {
  const [tocado, setTocado] = useState(null);
  if (!evolucao?.length) return null;

  const temDado = evolucao.some((e) => e.receitas > 0 || e.despesas > 0);
  if (!temDado) {
    return (
      <div className="gr">
        <p className="gr-titulo">Entrou e saiu</p>
        <p className="vazio">Ainda não há meses com movimento para comparar.</p>
      </div>
    );
  }

  const maior = Math.max(...evolucao.flatMap((e) => [e.receitas, e.despesas]), 1);
  const alto = maior * 1.12;

  const larguraPlot = L - MARGEM.esq - MARGEM.dir;
  const alturaPlot = A - MARGEM.topo - MARGEM.baixo;
  const y = (v) => MARGEM.topo + (1 - v / alto) * alturaPlot;
  const base = y(0);
  const passo = larguraPlot / evolucao.length;
  const larguraBarra = Math.min(16, passo * 0.32);
  const gap = 2;
  const xGrupo = (i) => MARGEM.esq + passo * i + passo / 2;

  const detalhe = tocado != null ? evolucao[tocado] : null;

  return (
    <div className="gr">
      <div className="gr-topo">
        <div>
          <p className="gr-titulo">Entrou e saiu</p>
          <p className="gr-sub">Últimos seis meses.</p>
        </div>
      </div>

      <div className="gr-caixa">
        <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-label="Entradas e saídas dos últimos seis meses">
          <line x1={MARGEM.esq - 6} x2={L - MARGEM.dir} y1={base} y2={base} className="gr-zero" />
          <text x={MARGEM.esq - 10} y={base + 4} className="gr-eixo" textAnchor="end">0</text>
          <text x={MARGEM.esq - 10} y={y(alto) + 10} className="gr-eixo" textAnchor="end">
            {curto(alto)}
          </text>

          {evolucao.map((e, i) => {
            const ativo = tocado === i;
            const ehAtual = e.mes === mesAtual;
            const xEsq = xGrupo(i) - larguraBarra - gap / 2;
            const xDir = xGrupo(i) + gap / 2;
            const r = Math.min(4, larguraBarra / 2);

            return (
              <g key={e.mes} className={`gr-grupo ${ativo ? 'ativo' : ''}`}
                 onClick={() => setTocado(ativo ? null : i)}>
                <rect x={xGrupo(i) - passo / 2} y={MARGEM.topo - 6}
                      width={passo} height={alturaPlot + 12} fill="transparent" />

                <rect x={xEsq} y={y(e.receitas)} width={larguraBarra}
                      height={Math.max(base - y(e.receitas), 2)} rx={r} className="gr-barra pos" />
                <rect x={xEsq} y={base - Math.min(r, base - y(e.receitas))} width={larguraBarra}
                      height={Math.min(r, base - y(e.receitas))} className="gr-barra pos" />

                <rect x={xDir} y={y(e.despesas)} width={larguraBarra}
                      height={Math.max(base - y(e.despesas), 2)} rx={r} className="gr-barra neg" />
                <rect x={xDir} y={base - Math.min(r, base - y(e.despesas))} width={larguraBarra}
                      height={Math.min(r, base - y(e.despesas))} className="gr-barra neg" />

                <text x={xGrupo(i)} y={A - 20}
                      className={`gr-mes ${ehAtual || ativo ? 'ativo' : ''}`} textAnchor="middle">
                  {NOMES[Number(String(e.mes).slice(5, 7)) - 1]}
                </text>
                {(i === 0 || String(e.mes).slice(5) === '01') && (
                  <text x={xGrupo(i)} y={A - 7} className="gr-ano" textAnchor="middle">
                    {String(e.mes).slice(0, 4)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="gr-legenda">
        <span><i className="am pos" /> entrou</span>
        <span><i className="am neg" /> saiu</span>
      </div>

      <div className="gr-detalhe" aria-live="polite">
        {detalhe ? (
          <>
            <strong>{mesPorExtenso(detalhe.mes)}</strong>
            <span>Entrou {formatarBRL(detalhe.receitas)}</span>
            <span>Saiu {formatarBRL(detalhe.despesas)}</span>
            <span className={detalhe.saldo < 0 ? 'ruim' : 'bom'}>
              Sobrou {formatarBRL(detalhe.saldo)}
            </span>
          </>
        ) : (
          <span className="gr-dica">Toque num mês para ver os números.</span>
        )}
      </div>
    </div>
  );
}

function curto(v) {
  const a = Math.abs(Number(v) || 0);
  if (a >= 1000) return `${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace('.', ',')}k`;
  return String(Math.round(a));
}

const COMPLETOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function mesPorExtenso(mes) {
  const m = COMPLETOS[Number(String(mes).slice(5, 7)) - 1];
  return m ? `${m} de ${String(mes).slice(0, 4)}` : String(mes);
}
