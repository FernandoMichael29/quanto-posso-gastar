import { useState } from 'react';
import { formatarBRL } from '../lib/parser.js';

/**
 * Renda e gastos, mês a mês: seis para trás e seis para a frente.
 *
 * O passado é o que aconteceu. O futuro é o que já está comprometido — as
 * parcelas que vão cair, as contas que se repetem, os salários que costumam
 * entrar. São coisas diferentes e por isso têm desenho diferente: a parte
 * cheia é fato, a parte apagada é previsão, e uma linha marca onde estamos.
 *
 * Preferi mostrar tudo de uma vez a fazer rolagem lateral: no celular, um
 * gráfico que rola dentro de uma página que também rola briga com o dedo, e
 * doze meses cabem na largura sem apertar. Para ver mais longe, o seletor de
 * mês lá em cima move a janela inteira.
 *
 * Duas séries, então duas cores — as mesmas do resto do app, validadas para
 * daltonismo e contraste nos dois temas. A legenda está sempre presente e o
 * toque abre os números do mês, para a cor nunca ser a única pista.
 */

const L = 620, A = 240;
const MARGEM = { topo: 20, dir: 8, baixo: 40, esq: 46 };
const NOMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export default function GraficoEvolucao({ evolucao, mesAtual }) {
  const [tocado, setTocado] = useState(null);
  if (!evolucao?.length) return null;

  const total = (e) => ({
    entra: (e.receitas || 0) + (e.receitas_previstas || 0),
    sai: (e.despesas || 0) + (e.despesas_previstas || 0)
  });

  const temDado = evolucao.some((e) => total(e).entra > 0 || total(e).sai > 0);
  if (!temDado) {
    return (
      <div className="gr">
        <p className="gr-titulo">Renda e gastos</p>
        <p className="vazio">Ainda não há meses com movimento para comparar.</p>
      </div>
    );
  }

  const maior = Math.max(...evolucao.flatMap((e) => [total(e).entra, total(e).sai]), 1);
  const alto = maior * 1.12;

  const larguraPlot = L - MARGEM.esq - MARGEM.dir;
  const alturaPlot = A - MARGEM.topo - MARGEM.baixo;
  const y = (v) => MARGEM.topo + (1 - v / alto) * alturaPlot;
  const base = y(0);
  const passo = larguraPlot / evolucao.length;
  const larguraBarra = Math.min(14, passo * 0.34);
  const gap = 2;
  const xGrupo = (i) => MARGEM.esq + passo * i + passo / 2;
  const r = Math.min(4, larguraBarra / 2);

  // Onde o fato vira previsão.
  const primeiroFuturo = evolucao.findIndex((e) => e.futuro);
  const xCorte = primeiroFuturo > 0 ? MARGEM.esq + passo * primeiroFuturo : null;

  const detalhe = tocado != null ? evolucao[tocado] : null;

  /** Uma barra: a parte cheia é o que aconteceu, a apagada é o que é previsto. */
  const Barra = ({ x, real, previsto, tom }) => {
    const soma = real + previsto;
    if (soma <= 0) return null;
    return (
      <>
        {previsto > 0 && (
          <rect x={x} y={y(soma)} width={larguraBarra}
                height={Math.max(base - y(soma), 2)} rx={r}
                className={`gr-barra ${tom} previsto`} />
        )}
        {real > 0 && (
          <>
            <rect x={x} y={y(real)} width={larguraBarra}
                  height={Math.max(base - y(real), 2)} rx={r} className={`gr-barra ${tom}`} />
            <rect x={x} y={base - Math.min(r, base - y(real))} width={larguraBarra}
                  height={Math.min(r, base - y(real))} className={`gr-barra ${tom}`} />
          </>
        )}
      </>
    );
  };

  return (
    <div className="gr">
      <div className="gr-topo">
        <div>
          <p className="gr-titulo">Renda e gastos</p>
          <p className="gr-sub">Seis meses para trás, seis para a frente.</p>
        </div>
      </div>

      <div className="gr-caixa">
        <svg viewBox={`0 0 ${L} ${A}`} role="img"
             aria-label="Renda e gastos dos últimos seis meses e dos seis próximos">
          <line x1={MARGEM.esq - 6} x2={L - MARGEM.dir} y1={base} y2={base} className="gr-zero" />
          <text x={MARGEM.esq - 10} y={base + 4} className="gr-eixo" textAnchor="end">0</text>
          <text x={MARGEM.esq - 10} y={y(alto) + 10} className="gr-eixo" textAnchor="end">
            {curto(alto)}
          </text>

          {xCorte && (
            <>
              <line x1={xCorte} x2={xCorte} y1={MARGEM.topo - 8} y2={base}
                    className="gr-corte" />
              <text x={xCorte - 4} y={MARGEM.topo - 10} className="gr-eixo" textAnchor="end">
                hoje
              </text>
            </>
          )}

          {evolucao.map((e, i) => {
            const ativo = tocado === i;
            const ehAtual = e.mes === mesAtual;

            return (
              <g key={e.mes} className={`gr-grupo ${ativo ? 'ativo' : ''}`}
                 onClick={() => setTocado(ativo ? null : i)}>
                <rect x={xGrupo(i) - passo / 2} y={MARGEM.topo - 6}
                      width={passo} height={alturaPlot + 12} fill="transparent" />

                <Barra x={xGrupo(i) - larguraBarra - gap / 2} tom="pos"
                       real={e.receitas || 0} previsto={e.receitas_previstas || 0} />
                <Barra x={xGrupo(i) + gap / 2} tom="neg"
                       real={e.despesas || 0} previsto={e.despesas_previstas || 0} />

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
        <span><i className="am pos" /> renda</span>
        <span><i className="am neg" /> gastos</span>
        <span><i className="am previsto" /> previsto</span>
      </div>

      <div className="gr-detalhe" aria-live="polite">
        {detalhe ? (
          <>
            <strong>{mesPorExtenso(detalhe.mes)}</strong>
            <span>
              {detalhe.futuro ? 'Deve entrar' : 'Entrou'} {formatarBRL(total(detalhe).entra)}
            </span>
            <span>
              {detalhe.futuro ? 'Já comprometido' : 'Saiu'} {formatarBRL(total(detalhe).sai)}
            </span>
            <span className={detalhe.saldo < 0 ? 'ruim' : 'bom'}>
              {detalhe.futuro ? 'Deve sobrar' : 'Sobrou'} {formatarBRL(detalhe.saldo)}
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
