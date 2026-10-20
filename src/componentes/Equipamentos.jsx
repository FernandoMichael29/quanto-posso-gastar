import { useEffect, useState } from 'react';
import Personagem from './Personagem.jsx';
import { VISUAIS, aoMudarEquipamento, equipamentoAtual, nomeDoVisual, vestir } from '../lib/personagem.js';

// Equipamentos: a recompensa da missão. Em Ajustes, escolher qual vestir; e o
// aviso de "equipamento novo" quando uma conquista libera um visual.

function useEquipamento() {
  const [e, setE] = useState(equipamentoAtual);
  useEffect(() => aoMudarEquipamento(() => setE(equipamentoAtual())), []);
  return e;
}

/** O armário em Ajustes: os 3 visuais, os trancados com o caminho para liberar. */
export function Armario({ heroi }) {
  const { liberados, visual } = useEquipamento();
  return (
    <div className="armario" role="radiogroup" aria-label="Equipamento">
      {VISUAIS.map((v) => {
        const livre = liberados.includes(v.id);
        const nome = nomeDoVisual(heroi, v.id);
        return (
          <button key={v.id} type="button" role="radio" aria-checked={visual === v.id} disabled={!livre}
            className={`armario-item ${visual === v.id ? 'on' : ''} ${livre ? '' : 'trancado'}`}
            onClick={() => vestir(v.id)} title={livre ? nome : v.como}>
            <span className="armario-palco"><Personagem id={heroi.id} visual={v.id} tamanho={64} /></span>
            <span className="armario-nome">{livre ? nome : '???'}</span>
            {!livre && <span className="armario-como">{v.como}</span>}
            {visual === v.id && <span className="selo-vestido px">VESTIDO</span>}
          </button>
        );
      })}
    </div>
  );
}

/** O aviso de equipamento novo: o herói aparece vestido, comemorando. */
export function EquipamentoNovo({ heroi, visual, aoFechar }) {
  const [saindo, setSaindo] = useState(false);
  const fechar = () => { if (saindo) return; setSaindo(true); setTimeout(aoFechar, 120); };
  const v = VISUAIS.find((x) => x.id === visual);
  return (
    <div className={`modal relatorio ${saindo ? 'saindo' : ''}`} role="dialog" aria-modal="true" aria-label="Equipamento novo">
      <div className="modal-fundo" onClick={fechar} />
      <div className="modal-corpo">
        <div className="relatorio-janela equip-novo">
          <p className="rotulo-px">EQUIPAMENTO NOVO</p>
          <h2 className="px">{nomeDoVisual(heroi, visual).toUpperCase()}</h2>
          <div className="acampamento brilho" aria-hidden="true">
            <span className="estrelas" />
            <Personagem id={heroi.id} visual={visual} tamanho={112} anim="vitoria" />
          </div>
          <p className="relatorio-frase">
            Recompensa de {v?.conquista === 'guardiao' ? 'três missões seguidas' : 'uma missão cumprida'}.
            {' '}{heroi.nome} já está {heroi.id === 'mayara' ? 'vestida' : 'vestido'} — dá para trocar em Ajustes.
          </p>
          <button type="button" className="btn-px" onClick={fechar}>QUE VENHA O PRÓXIMO MÊS</button>
        </div>
      </div>
    </div>
  );
}
