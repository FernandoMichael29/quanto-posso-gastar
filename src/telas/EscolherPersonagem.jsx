import { useState } from 'react';
import Personagem from '../componentes/Personagem.jsx';
import { PERSONAGENS, pessoaDoPersonagem } from '../lib/personagem.js';

// "Quem está jogando?": aparece depois que a planilha conecta pela primeira
// vez neste celular, e de novo quando você troca em Ajustes. Tocar num herói
// escolhe (ele comemora); o botão entra.

export default function EscolherPersonagem({ atual, pessoas, aoEscolher, aoVoltar }) {
  const [escolhido, setEscolhido] = useState(atual?.id || PERSONAGENS[0].id);
  const [festa, setFesta] = useState({ id: null, vez: 0 });
  const heroi = PERSONAGENS.find((p) => p.id === escolhido);

  function tocar(p) {
    setEscolhido(p.id);
    setFesta((f) => ({ id: p.id, vez: f.vez + 1 }));
  }

  return (
    <div className="escolha">
      {aoVoltar && <button type="button" className="btn discreto voltar" onClick={aoVoltar}>‹ Voltar</button>}
      <div className="escolha-topo">
        {!aoVoltar && <span className="selo-ok px">✓ PLANILHA CONECTADA</span>}
        <h1 className="px">QUEM ESTÁ JOGANDO?</h1>
        <p>O personagem escolhido assina os lançamentos deste celular.</p>
      </div>

      <div className="cartas" role="radiogroup" aria-label="Personagem">
        {PERSONAGENS.map((p, i) => (
          <button key={p.id} type="button" role="radio" aria-checked={escolhido === p.id}
            className={`carta ${escolhido === p.id ? 'on' : ''}`} style={{ '--cor': p.cor }} onClick={() => tocar(p)}>
            <span className="selo-p px">P{i + 1}</span>
            <span className="palco">
              <Personagem id={p.id} tamanho={160} anim={festa.id === p.id ? 'vitoria' : 'parado'} vez={festa.id === p.id ? festa.vez : 0} />
            </span>
            <span className="classe px">{p.classe.toUpperCase()}</span>
            <span className="nome px">{p.nome}</span>
            <span className="atrib">
              <span><span>Arma</span><b className="px">{p.arma.toUpperCase()}</b></span>
              <span><span>Especial</span><b className="px">{p.especial.toUpperCase()}</b></span>
            </span>
          </button>
        ))}
      </div>

      <button type="button" className="btn-px" onClick={() => aoEscolher(heroi)}>
        {aoVoltar && atual?.id === heroi.id ? 'CONTINUAR' : `ENTRAR COMO ${heroi.nome.toUpperCase()}`}
      </button>
      <p className="escolha-nota">
        Os lançamentos daqui saem como <strong>{pessoaDoPersonagem(heroi, pessoas)}</strong>. Dá para trocar depois em Ajustes.
      </p>
    </div>
  );
}
