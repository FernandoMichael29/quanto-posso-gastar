import { useEffect, useRef, useState } from 'react';
import fernando from '../assets/personagens/fernando.png';
import mayara from '../assets/personagens/mayara.png';
import { ANIMACOES, LADO, QUADROS } from '../lib/personagem.js';

const FOLHAS = { fernando, mayara };
const MS = 120;   // ~8 quadros por segundo: o ritmo em que o PixelLab desenhou

function semMovimento() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * O personagem animado. `anim` toca uma vez e volta para "parado" (que fica
 * em loop), avisando em `aoTerminar`. Trocar `vez` repete a mesma animação.
 * Com "reduzir movimento" ligado no celular, fica só o primeiro quadro.
 */
export default function Personagem({ id, anim = 'parado', vez = 0, tamanho = LADO * 2, aoTerminar, className = '' }) {
  const [quadro, setQuadro] = useState(0);
  const [tocando, setTocando] = useState(anim);
  const fim = useRef(aoTerminar);
  fim.current = aoTerminar;

  useEffect(() => { setTocando(anim); setQuadro(0); }, [anim, vez]);

  useEffect(() => {
    if (semMovimento()) { setQuadro(0); return undefined; }
    const loop = tocando === 'parado';
    // O "parado" respira devagar; ação corre no ritmo normal.
    const passo = loop ? MS * 1.6 : MS;
    let q = 0;
    setQuadro(0);
    const t = setInterval(() => {
      q += 1;
      if (q >= QUADROS) {
        if (!loop) {
          clearInterval(t);
          setQuadro(0);
          setTocando('parado');
          fim.current?.();
          return;
        }
        q = 0;
      }
      setQuadro(q);
    }, passo);
    return () => clearInterval(t);
  }, [tocando, vez]);

  const linha = Math.max(0, ANIMACOES.indexOf(tocando));
  const escala = tamanho / LADO;
  return (
    <span
      className={`personagem ${className}`}
      aria-hidden="true"
      style={{
        width: tamanho, height: tamanho,
        backgroundImage: `url(${FOLHAS[id]})`,
        backgroundSize: `${LADO * QUADROS * escala}px ${LADO * ANIMACOES.length * escala}px`,
        backgroundPosition: `${-quadro * tamanho}px ${-linha * tamanho}px`
      }}
    />
  );
}
