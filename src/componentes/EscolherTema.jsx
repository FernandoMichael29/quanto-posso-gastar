import { useState } from 'react';
import { lerTema, salvarTema, TEMAS } from '../lib/tema.js';

// A escolha do tema.
//
// Cada opção mostra uma amostra das cores reais do tema, não só o nome: dá
// para decidir olhando, sem ter que aplicar e voltar. A troca é imediata —
// o app inteiro muda enquanto você toca, que é a única forma honesta de
// escolher uma cor.

const AMOSTRAS = {
  auto: null,
  claro: ['#EEF2F0', '#FFFFFF', '#0E7566'],
  grafite: ['#0F1011', '#17191A', '#4FC9B1'],
  oled: ['#000000', '#0D0F0F', '#4FC9B1']
};

export default function EscolherTema() {
  const [tema, setTema] = useState(lerTema);

  function escolher(id) {
    setTema(salvarTema(id));
  }

  return (
    <div className="cartao">
      <p className="secao-titulo" style={{ margin: 0 }}>Tema</p>

      <div className="temas">
        {TEMAS.map((t) => (
          <button
            type="button"
            key={t.id}
            className={`tema ${tema === t.id ? 'ativo' : ''}`}
            onClick={() => escolher(t.id)}
            aria-pressed={tema === t.id}
          >
            <span className="tema-amostra" aria-hidden="true">
              {(AMOSTRAS[t.id] || []).map((cor) => (
                <i key={cor} style={{ background: cor }} />
              ))}
              {!AMOSTRAS[t.id] && <i className="tema-auto" />}
            </span>
            <span className="tema-nome">{t.rotulo}</span>
            <span className="tema-ajuda">{t.ajuda}</span>
          </button>
        ))}
      </div>

      <p className="ajuda">
        Vale só neste aparelho — não vai para a planilha.
      </p>
    </div>
  );
}
