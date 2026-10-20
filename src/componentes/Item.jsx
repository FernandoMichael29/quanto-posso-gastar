import { BAU, COLUNA, FOLHA, FOLHA_BAUS } from '../lib/icones.js';

// O item de inventário de cada categoria (os desenhos de ferramentas/icones/).
// Mora aqui porque três telas mostram o mesmo item: o extrato, o inventário
// de escolher categoria e a lista de últimos lançamentos.

const chave = (c) => String(c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * O desenho 32x32. Categoria sem desenho próprio cai no saquinho "?" (gasto)
 * ou na gema (entrada) — ou nas iniciais, quando o nome dela não aparece ao
 * lado e dois saquinhos iguais deixariam você sem saber qual é qual.
 */
export function Sprite({ categoria, receita, iniciais = false }) {
  const coluna = COLUNA[chave(categoria)];
  if (coluna === undefined && iniciais && categoria) {
    return <span className="sprite iniciais px">{String(categoria).slice(0, 2)}</span>;
  }
  const c = coluna ?? COLUNA[receita ? 'outras entradas' : 'outros'];
  return <span className="sprite" style={{ backgroundImage: `url(${FOLHA})`, backgroundPositionX: `${-32 * c}px` }} />;
}

/** O baú num dos 4 estados (vazio → cheio), ampliado sem borrar. */
export function SpriteBau({ estado = 'metade', tamanho = 32 }) {
  const n = Object.keys(BAU).length;
  return (
    <span
      className="sprite bau"
      style={{
        backgroundImage: `url(${FOLHA_BAUS})`,
        width: tamanho,
        height: tamanho,
        backgroundSize: `${n * tamanho}px ${tamanho}px`,
        backgroundPositionX: `${-tamanho * (BAU[estado] ?? BAU.metade)}px`
      }}
    />
  );
}

/** O quadradinho de inventário com o item dentro. Movimento de baú mostra o baú. */
export default function Item({ categoria, receita, tipo }) {
  if (tipo === 'guardar' || tipo === 'resgatar') {
    return (
      <span className="slot" aria-hidden="true">
        <SpriteBau estado={tipo === 'guardar' ? 'cheio' : 'vazio'} />
      </span>
    );
  }
  return (
    <span className="slot" aria-hidden="true">
      <Sprite categoria={categoria} receita={receita} />
    </span>
  );
}
