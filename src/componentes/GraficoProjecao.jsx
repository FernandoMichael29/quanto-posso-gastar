import { useState } from 'react';
import { formatarBRL } from '../lib/parser.js';

// Cores do gráfico. Validadas para daltonismo e contraste contra a superfície
// de cada tema — não troque sem revalidar. O sinal do número e o sentido da
// barra também carregam a informação, então a cor nunca está sozinha.
const CORES = {
  claro: { sobra: '#00A08C', negativa: '#A2382C' },
  escuro: { sobra: '#1AA890', negativa: '#CC6554' }
};

const L = 560, A = 300;           // caixa de desenho
const MARGEM = { topo: 22, dir: 8, baixo: 42, esq: 48 };

export default function GraficoProjecao({ projecao, compromisso }) {
  const [tocado, setTocado] = useState(null);
  const [verNumeros, setVerNumeros] = useState(false);

  if (!projecao?.length) return null;

  const temNovo = projecao.some((p) => Number(p.novo) > 0);
  const dados = projecao.map((p) => ({
    mes: p.mes,
    receitas: Number(p.receitas) || 0,
    fixas: Number(p.fixas) || 0,
    variaveis: Number(p.variaveis) || 0,
    novo: Number(p.novo) || 0,
    sobra: Number(p.sobra) || 0,
    sobraSem: (Number(p.sobra) || 0) + (Number(p.novo) || 0)
  }));

  const valores = dados.flatMap((d) => [d.sobra, temNovo ? d.sobraSem : d.sobra, 0]);
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const span = (max - min) || 1;
  const folga = span * 0.12;
  const alto = max + folga;
  const baixo = min - folga;

  const larguraPlot = L - MARGEM.esq - MARGEM.dir;
  const alturaPlot = A - MARGEM.topo - MARGEM.baixo;
  const y = (v) => MARGEM.topo + ((alto - v) / (alto - baixo)) * alturaPlot;
  const passo = larguraPlot / dados.length;
  const larguraBarra = Math.min(26, passo * 0.62);
  const xCentro = (i) => MARGEM.esq + passo * i + passo / 2;

  const yZero = y(0);
  const raio = 4;

  // Rótulos diretos só onde carregam informação: o primeiro mês, o último,
  // e o pior — nunca um número em cima de cada barra.
  const piorIdx = dados.reduce((pior, d, i) => (d.sobra < dados[pior].sobra ? i : pior), 0);
  const rotulados = new Set([0, dados.length - 1, piorIdx]);

  const detalhe = tocado != null ? dados[tocado] : null;

  return (
    <div className="gr">
      <div className="gr-topo">
        <div>
          <p className="gr-titulo">Sua sobra mês a mês</p>
          <p className="gr-sub">
            {temNovo
              ? 'A parte colorida é o que ainda sobra. A parte apagada em cima é o que o novo compromisso come.'
              : 'Projeção dos próximos 12 meses.'}
          </p>
        </div>
        <button className="btn discreto pequeno" onClick={() => setVerNumeros((v) => !v)}>
          {verNumeros ? 'Ver gráfico' : 'Ver números'}
        </button>
      </div>

      {!verNumeros && (
        <>
          <div className="gr-caixa">
            <svg viewBox={`0 0 ${L} ${A}`} role="img"
                 aria-label={`Projeção de sobra mensal de ${rotuloMes(dados[0].mes)} a ${rotuloMes(dados[dados.length - 1].mes)}`}>
              {/* linha do zero: a única referência que importa aqui */}
              <line x1={MARGEM.esq - 6} x2={L - MARGEM.dir} y1={yZero} y2={yZero}
                    className="gr-zero" />
              <text x={MARGEM.esq - 10} y={yZero + 4} className="gr-eixo" textAnchor="end">0</text>

              {/* topo e base da escala, para dar noção de grandeza.
                  O piso só aparece se não colidir com o rótulo do zero. */}
              <text x={MARGEM.esq - 10} y={y(alto) + 10} className="gr-eixo" textAnchor="end">
                {curto(alto)}
              </text>
              {baixo < 0 && y(baixo) - yZero > 18 && (
                <text x={MARGEM.esq - 10} y={y(baixo) - 2} className="gr-eixo" textAnchor="end">
                  {curto(baixo)}
                </text>
              )}

              {dados.map((d, i) => {
                const negativa = d.sobra < 0;
                const x = xCentro(i) - larguraBarra / 2;
                const ativo = tocado === i;
                const r = Math.min(raio, larguraBarra / 2);

                // O que sobra, do zero até o valor.
                const topoSobra = negativa ? yZero : y(d.sobra);
                const altSobra = Math.max(Math.abs(y(d.sobra) - yZero), 2);

                // O que o novo compromisso come, empilhado em cima do que sobra.
                // Quando a sobra fica negativa, ele parte do zero: a leitura é
                // "comeu tudo o que havia, e ainda faltou o pedaço vermelho".
                const baseNovo = negativa ? yZero : y(d.sobra);
                const altNovo = temNovo ? Math.max(baseNovo - y(d.sobraSem) - 2, 0) : 0;

                return (
                  <g key={d.mes}
                     onClick={() => setTocado(ativo ? null : i)}
                     className={`gr-grupo ${ativo ? 'ativo' : ''}`}>
                    {/* alvo de toque maior que a barra */}
                    <rect x={xCentro(i) - passo / 2} y={MARGEM.topo - 6}
                          width={passo} height={alturaPlot + 12}
                          fill="transparent" />

                    {altNovo > 0 && (
                      <rect
                        x={x} y={y(d.sobraSem)} width={larguraBarra} height={altNovo}
                        rx={r} className="gr-comido"
                      />
                    )}

                    <rect
                      x={x} y={topoSobra} width={larguraBarra} height={altSobra}
                      rx={r}
                      className={`gr-barra ${negativa ? 'neg' : 'pos'}`}
                    />
                    {/* canto reto encostado na linha do zero */}
                    <rect
                      x={x} y={negativa ? yZero : yZero - Math.min(r, altSobra)}
                      width={larguraBarra} height={Math.min(r, altSobra)}
                      className={`gr-barra ${negativa ? 'neg' : 'pos'}`}
                    />

                    {(rotulados.has(i) || ativo) && (
                      <text
                        x={xCentro(i)}
                        y={negativa ? y(d.sobra) + 15 : y(d.sobra) - 6}
                        className={`gr-valor ${negativa ? 'neg' : ''}`}
                        textAnchor="middle"
                      >
                        {curto(d.sobra)}
                      </text>
                    )}

                    <text x={xCentro(i)} y={A - 22}
                          className={`gr-mes ${ativo ? 'ativo' : ''}`} textAnchor="middle">
                      {rotuloMes(d.mes)}
                    </text>
                    {(i === 0 || d.mes.slice(5) === '01') && (
                      <text x={xCentro(i)} y={A - 9} className="gr-ano" textAnchor="middle">
                        {d.mes.slice(0, 4)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {temNovo && (
            <div className="gr-legenda">
              <span><i className="am pos" /> o que sobra</span>
              <span><i className="am comido" /> o que o compromisso come</span>
            </div>
          )}

          <div className="gr-detalhe" aria-live="polite">
            {detalhe ? (
              <>
                <strong>{rotuloMesCompleto(detalhe.mes)}</strong>
                <span>Entra {formatarBRL(detalhe.receitas)}</span>
                <span>Fixas {formatarBRL(detalhe.fixas)}</span>
                <span>Variáveis {formatarBRL(detalhe.variaveis)}</span>
                {detalhe.novo > 0 && <span>Novo {formatarBRL(detalhe.novo)}</span>}
                <span className={detalhe.sobra < 0 ? 'ruim' : 'bom'}>
                  Sobra {formatarBRL(detalhe.sobra)}
                </span>
              </>
            ) : (
              <span className="gr-dica">Toque numa barra para ver o mês por dentro.</span>
            )}
          </div>
        </>
      )}

      {verNumeros && (
        <div className="scroller">
          <table className="gr-tabela">
            <thead>
              <tr>
                <th>Mês</th><th className="num">Entra</th><th className="num">Fixas</th>
                <th className="num">Variáveis</th>
                {temNovo && <th className="num">Novo</th>}
                <th className="num">Sobra</th>
              </tr>
            </thead>
            <tbody>
              {dados.map((d) => (
                <tr key={d.mes}>
                  <td>{rotuloMesCompleto(d.mes)}</td>
                  <td className="num">{formatarBRL(d.receitas)}</td>
                  <td className="num">{formatarBRL(d.fixas)}</td>
                  <td className="num">{formatarBRL(d.variaveis)}</td>
                  {temNovo && <td className="num">{formatarBRL(d.novo)}</td>}
                  <td className={`num ${d.sobra < 0 ? 'ruim' : ''}`}>{formatarBRL(d.sobra)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {compromisso > 0 && (
        <p className="gr-nota">
          Compromisso simulado: <strong>{formatarBRL(compromisso)}</strong> por mês.
        </p>
      )}
    </div>
  );
}

const NOMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const COMPLETOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function rotuloMes(mes) {
  return NOMES[Number(String(mes).slice(5, 7)) - 1] || String(mes);
}

function rotuloMesCompleto(mes) {
  const m = COMPLETOS[Number(String(mes).slice(5, 7)) - 1];
  return m ? `${m} de ${String(mes).slice(0, 4)}` : String(mes);
}

/** 1.250 vira "1,2k" — o eixo não precisa de centavos. */
function curto(v) {
  const n = Number(v) || 0;
  const s = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1000) return `${s}${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace('.', ',')}k`;
  return `${s}${Math.round(a)}`;
}
