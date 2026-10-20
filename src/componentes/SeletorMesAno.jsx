import { useEffect, useRef, useState } from 'react';
import { mesDeHoje } from '../lib/datas.js';

// Escolher um mês sem passar por dia: primeiro o ano (‹ 2026 ›), depois um dos
// 12 meses. Mês com lançamento ganha um pontinho; o mês escolhido fica dourado.
// Com `todos`, há também "Todos os meses" (valor vazio).

const CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function rotuloMes(mes) {
  if (!mes) return 'Todos os meses';
  const [a, m] = mes.split('-').map(Number);
  const nome = LONGOS[m - 1];
  return `${nome[0].toUpperCase()}${nome.slice(1)} de ${a}`;
}

export default function SeletorMesAno({ valor, aoMudar, meses = [], todos = false, rotulo = 'Escolher o mês' }) {
  const [aberto, setAberto] = useState(false);
  const [ano, setAno] = useState(() => Number((valor || mesDeHoje()).slice(0, 4)));
  const caixa = useRef(null);
  const comDados = new Set(meses);
  const hoje = mesDeHoje();

  // Abriu de novo: começa no ano do mês escolhido.
  useEffect(() => { if (aberto) setAno(Number((valor || mesDeHoje()).slice(0, 4))); }, [aberto, valor]);

  // Toque fora ou Esc fecha.
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (caixa.current && !caixa.current.contains(e.target)) setAberto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  function escolher(m) {
    setAberto(false);
    if (m !== valor) aoMudar(m);
  }

  return (
    <div className="seletor-mes-ano" ref={caixa}>
      <button type="button" className={`sma-botao ${valor ? 'escolhido' : ''}`} aria-haspopup="dialog" aria-expanded={aberto}
        aria-label={`${rotulo}: ${rotuloMes(valor)}`} onClick={() => setAberto((x) => !x)}>
        <span className="sma-cal" aria-hidden="true" />
        {rotuloMes(valor)}
        <span className="sma-seta" aria-hidden="true">▾</span>
      </button>

      {aberto && (
        <div className="sma-painel" role="dialog" aria-label={rotulo}>
          <div className="sma-ano">
            <button type="button" onClick={() => setAno(ano - 1)} aria-label="Ano anterior">‹</button>
            <strong className="px">{ano}</strong>
            <button type="button" onClick={() => setAno(ano + 1)} aria-label="Próximo ano">›</button>
          </div>
          <div className="sma-meses">
            {CURTOS.map((nome, i) => {
              const m = `${ano}-${String(i + 1).padStart(2, '0')}`;
              return (
                <button key={m} type="button"
                  className={`px ${m === valor ? 'on' : ''} ${comDados.has(m) ? 'tem' : ''} ${m === hoje ? 'hoje' : ''}`}
                  aria-pressed={m === valor} aria-label={`${LONGOS[i]} de ${ano}${comDados.has(m) ? ', com lançamentos' : ''}`}
                  onClick={() => escolher(m)}>
                  {nome.toUpperCase()}
                </button>
              );
            })}
          </div>
          <div className="sma-rodape">
            {todos && <button type="button" className="btn discreto pequeno" onClick={() => escolher('')}>Todos os meses</button>}
            <button type="button" className="btn discreto pequeno" onClick={() => escolher(hoje)}>Este mês</button>
          </div>
        </div>
      )}
    </div>
  );
}
