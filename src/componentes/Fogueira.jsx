import { useEffect, useState } from 'react';
import folhaFogo from '../assets/fogueira.png';
import Personagem from './Personagem.jsx';
import { api } from '../lib/api.js';
import { ARTES, LADO_FOGO, MARCOS, QUADROS_FOGO, calendarioDoMes, estadoDaFogueira } from '../lib/fogueira.js';
import { PERSONAGENS } from '../lib/personagem.js';
import { mesDeHoje, nomeDoMes } from '../lib/datas.js';

// A fogueira da casa: a tira debaixo do ouro de hoje (tela Novo) e a janela
// que abre ao tocar nela. A conta mora em lib/fogueira.js.

function semMovimento() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** O fogo animado (PixelLab, 9 quadros por linha). `apagada`: só lenha e cinza. */
export function Fogo({ arte = 'pequena', tamanho = 48, apagada = false, parado = false, className = '' }) {
  const [quadro, setQuadro] = useState(0);
  useEffect(() => {
    if (apagada || parado || semMovimento()) { setQuadro(0); return undefined; }
    let q = 0;
    const t = setInterval(() => { q = (q + 1) % QUADROS_FOGO; setQuadro(q); }, 130);
    return () => clearInterval(t);
  }, [apagada, parado, arte]);
  const linha = Math.max(0, ARTES.indexOf(arte));
  const k = tamanho / LADO_FOGO;
  return (
    <span
      className={`fogo ${apagada ? 'apagada' : ''} ${className}`}
      aria-hidden="true"
      style={{
        width: tamanho, height: tamanho,
        backgroundImage: `url(${folhaFogo})`,
        backgroundSize: `${LADO_FOGO * QUADROS_FOGO * k}px ${LADO_FOGO * ARTES.length * k}px`,
        backgroundPosition: `${-quadro * tamanho}px ${-linha * tamanho}px`
      }}
    />
  );
}

/** O fogo do tamanho do nível: a faísca é pequena, a enorme brilha. */
export function FogoDoNivel({ nivel, tamanho, apagada }) {
  const t = Math.round(tamanho * (apagada ? 0.8 : nivel.escala));
  return (
    <span className={`fogo-nivel ${nivel.brilho && !apagada ? 'brilha' : ''}`} style={{ width: tamanho, height: tamanho }}>
      <Fogo arte={apagada ? 'pequena' : nivel.arte} tamanho={t} apagada={apagada} />
    </span>
  );
}

const ERROS = { sem_rede: 'Sem internet agora — tente de novo quando voltar.' };

/** A tira da fogueira, debaixo do ouro de hoje. */
export default function TiraFogueira({ servidor, fila, hoje, pessoa, heroi, aoAtualizar }) {
  const [aberta, setAberta] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);
  const e = estadoDaFogueira(servidor, fila, hoje);
  if (!e) return null;

  async function naoGastei() {
    setOcupado(true); setErro(null);
    const r = await api.naoGastei(pessoa);
    setOcupado(false);
    if (r?.ok && r.fogueira) aoAtualizar?.(r.fogueira);
    else setErro(ERROS[r?.erro] || 'Não consegui falar com a planilha. Tente de novo.');
  }

  let frase;
  if (e.acesoHoje) {
    frase = e.quemHoje.length
      ? `Aceso hoje por ${e.quemHoje.join(' e ')}.`
      : 'Aceso hoje.';
    const falta = e.proximo ? e.proximo.min - e.dias : 0;
    if (e.proximo) frase += falta === 1 ? ` Falta 1 dia para virar ${e.proximo.nome}.` : ` Faltam ${falta} dias para virar ${e.proximo.nome}.`;
  } else if (e.dias > 0) {
    frase = 'Ninguém lançou nada hoje ainda — a brasa apaga à meia-noite.';
  } else {
    frase = 'Lance algo hoje (ou diga que não gastou) para acender o fogo.';
  }
  const apagada = e.dias === 0 && !e.acesoHoje;

  return (
    <>
      <div className={`tira-fogo ${e.emRisco ? 'risco' : ''}`}>
        <button type="button" className="tira-fogo-abrir" onClick={() => setAberta(true)} aria-label={`Fogueira: ${e.dias} dias seguidos. Abrir.`}>
          <FogoDoNivel nivel={e.nivel} tamanho={56} apagada={apagada} />
          <span className="t">
            <span className="rot px">FOGUEIRA{e.recorde > e.dias ? ` · RECORDE ${e.recorde}` : e.dias > 1 ? ' · RECORDE!' : ''}</span>
            <span className="n px">{e.dias} {e.dias === 1 ? 'DIA' : 'DIAS'}</span>
            <span className="s">{frase}</span>
          </span>
        </button>
        <div className="semana-fogo" aria-label="Últimos 7 dias">
          {e.semana.map((d) => (
            <span key={d.dia} className={`${d.hoje ? 'hoje' : ''} ${d.aceso ? 'aceso' : ''}`} title={d.dia}>
              <Fogo tamanho={20} apagada={!d.aceso} parado />
              {d.letra}
            </span>
          ))}
        </div>
        {!e.acesoHoje && (
          <button type="button" className="btn-px claro" onClick={naoGastei} disabled={ocupado}>
            {ocupado ? 'ACENDENDO…' : 'HOJE NÃO GASTEI NADA'}
          </button>
        )}
        {erro && <p className="ajuda ruim" style={{ margin: 0 }}>{erro}</p>}
      </div>
      {aberta && <FogueiraAberta e={e} hoje={hoje} heroi={heroi} aoFechar={() => setAberta(false)} />}
    </>
  );
}

function FogueiraAberta({ e, hoje, heroi, aoFechar }) {
  const [saindo, setSaindo] = useState(false);
  const fechar = () => { if (saindo) return; setSaindo(true); setTimeout(aoFechar, 120); };
  const mes = mesDeHoje();
  const casas = calendarioDoMes(mes, e.acesos, hoje);
  const herois = [...PERSONAGENS].sort((a, b) => (a.id === heroi?.id ? -1 : b.id === heroi?.id ? 1 : 0));
  const apagada = e.dias === 0 && !e.acesoHoje;
  return (
    <div className={`modal relatorio ${saindo ? 'saindo' : ''}`} role="dialog" aria-modal="true" aria-label="Fogueira da casa">
      <div className="modal-fundo" onClick={fechar} />
      <div className="modal-corpo">
        <div className="relatorio-janela fogueira-janela">
          <p className="rotulo-px">FOGUEIRA DA CASA</p>
          <h2 className="px">{e.dias} {e.dias === 1 ? 'DIA SEGUIDO' : 'DIAS SEGUIDOS'}</h2>
          <div className={`acampamento ${e.nivel.brilho ? 'brilho' : ''}`} aria-hidden="true">
            <span className="estrelas" />
            {herois.map((p, i) => (
              <Personagem key={p.id} id={p.id} tamanho={88} base={apagada ? 'dormindo' : 'parado'} className={i === 0 ? 'primeiro' : ''} />
            ))}
            <span className="fogo-acampamento"><FogoDoNivel nivel={e.nivel} tamanho={84} apagada={apagada} /></span>
          </div>
          <p className="relatorio-frase">
            O fogo fica aceso enquanto alguém da casa lançar algo todo dia — ou tocar em <b>“hoje não gastei nada”</b>.
            {' '}Recorde: <b>{e.recorde} {e.recorde === 1 ? 'dia' : 'dias'}</b>.
          </p>
          <div className="niveis-fogo">
            {MARCOS.map((n) => (
              <div key={n.id} className={e.dias >= n.min ? 'on' : ''}>
                <Fogo arte={n.arte} tamanho={30} apagada={e.dias < n.min} parado />
                <b className="px">{n.min}</b>
                <span>{n.nome.replace('fogueira ', '')}</span>
              </div>
            ))}
          </div>
          <p className="rotulo-px" style={{ textAlign: 'left' }}>{nomeDoMes(mes).toUpperCase()}</p>
          <div className="cal-fogo" role="list">
            {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((l, i) => <span key={`l${i}`} className="letra">{l}</span>)}
            {casas.map((c, i) => (c
              ? (
                <span key={c.dia} role="listitem" className={`${c.hoje ? 'hoje' : ''} ${c.futuro ? 'futuro' : ''} ${e.naoGastei.has(c.dia) ? 'sem-gasto' : ''}`}
                  aria-label={`${c.numero}${c.aceso ? ', aceso' : ''}`}>
                  {c.numero}
                  {c.aceso && <Fogo tamanho={16} parado />}
                </span>
              )
              : <span key={`v${i}`} className="vazia" />))}
          </div>
          <button type="button" className="btn-px" onClick={fechar}>VOLTAR AO ACAMPAMENTO</button>
        </div>
      </div>
    </div>
  );
}
