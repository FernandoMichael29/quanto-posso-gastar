import { useCallback, useEffect, useRef, useState } from 'react';
import fernando from '../assets/personagens/fernando.png';
import mayara from '../assets/personagens/mayara.png';
import fernandoPrata from '../assets/personagens/fernando_prata.png';
import fernandoOuro from '../assets/personagens/fernando_ouro.png';
import mayaraPrata from '../assets/personagens/mayara_prata.png';
import mayaraOuro from '../assets/personagens/mayara_ouro.png';
import rostos from '../assets/personagens/rostos.png';
import { ANIMACOES, EM_LOOP, LADO, QUADROS, aoMudarEquipamento, equipamentoAtual } from '../lib/personagem.js';

// Uma folha por visual (equipamento). Sem `visual`, veste o deste celular.
const FOLHAS = {
  fernando: { base: fernando, prata: fernandoPrata, ouro: fernandoOuro },
  mayara: { base: mayara, prata: mayaraPrata, ouro: mayaraOuro }
};
const ROSTO = 28;                                   // ferramentas/personagens/montar.py
const ORDEM_ROSTOS = ['fernando', 'mayara'];

/** O rostinho de quem lançou (extrato, últimos itens, missão em dupla). */
export function Rosto({ id, tamanho = 20, className = '', rotulo }) {
  const i = ORDEM_ROSTOS.indexOf(id);
  if (i < 0) return null;
  const k = tamanho / ROSTO;
  return (
    <span
      className={`rosto ${className}`}
      role={rotulo ? 'img' : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : 'true'}
      style={{
        width: tamanho, height: tamanho,
        backgroundImage: `url(${rostos})`,
        backgroundSize: `${ROSTO * ORDEM_ROSTOS.length * k}px ${tamanho}px`,
        backgroundPosition: `${-i * tamanho}px 0`
      }}
    />
  );
}
const MS = 120;   // ~8 quadros por segundo: o ritmo em que o PixelLab desenhou

/**
 * Reações em fila curta: reagir('ataque', 'vitoria') toca o ataque e, quando
 * ele acaba, a vitória. Devolve as props para espalhar no <Personagem>.
 */
export function useReacao() {
  const [r, setR] = useState({ anim: undefined, vez: 0, depois: null });
  const reagir = useCallback((anim, depois = null) => setR((x) => ({ anim, vez: x.vez + 1, depois })), []);
  const aoTerminar = useCallback(() => setR((x) => (x.depois
    ? { anim: x.depois, vez: x.vez + 1, depois: null }
    : { ...x, anim: undefined, depois: null })), []);
  return [{ anim: r.anim, vez: r.vez, aoTerminar }, reagir];
}

function semMovimento() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * O personagem animado. `base` é o estado em loop (parado, triste, dormindo…);
 * `anim` é uma reação que toca uma vez e volta para a base, avisando em
 * `aoTerminar`. Trocar `vez` repete a reação. Com "reduzir movimento" ligado
 * no celular, fica só o primeiro quadro.
 */
export default function Personagem({ id, anim, base = 'parado', vez = 0, tamanho = LADO * 2, aoTerminar, className = '', rotulo, visual }) {
  const [quadro, setQuadro] = useState(0);
  const [, refazer] = useState(0);
  useEffect(() => aoMudarEquipamento(() => refazer((x) => x + 1)), []);
  const folhas = FOLHAS[id] || {};
  const folha = folhas[visual || equipamentoAtual().visual] || folhas.base;
  const [tocando, setTocando] = useState(anim || base);
  const fim = useRef(aoTerminar);
  fim.current = aoTerminar;

  useEffect(() => { setTocando(anim || base); setQuadro(0); }, [anim, base, vez]);

  useEffect(() => {
    if (semMovimento()) { setQuadro(0); return undefined; }
    const loop = tocando === base && EM_LOOP.includes(base);
    // Estado em loop respira devagar; reação corre no ritmo normal.
    const passo = loop ? MS * 1.6 : MS;
    let q = 0;
    setQuadro(0);
    const t = setInterval(() => {
      q += 1;
      if (q >= QUADROS) {
        if (!loop) {
          clearInterval(t);
          setQuadro(0);
          setTocando(base);
          fim.current?.();
          return;
        }
        q = 0;
      }
      setQuadro(q);
    }, passo);
    return () => clearInterval(t);
  }, [tocando, vez, base]);

  const linha = Math.max(0, ANIMACOES.indexOf(tocando));
  const escala = tamanho / LADO;
  return (
    <span
      className={`personagem ${className}`}
      role={rotulo ? 'img' : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : 'true'}
      style={{
        width: tamanho, height: tamanho,
        backgroundImage: `url(${folha})`,
        backgroundSize: `${LADO * QUADROS * escala}px ${LADO * ANIMACOES.length * escala}px`,
        backgroundPosition: `${-quadro * tamanho}px ${-linha * tamanho}px`
      }}
    />
  );
}
