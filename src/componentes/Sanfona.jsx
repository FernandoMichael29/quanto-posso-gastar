import { useState } from 'react';

// Uma seção que abre e fecha. Existe porque a tela do mês vira uma tripa: cada
// lista útil empurra a próxima para baixo, e no celular você rola meio minuto
// para chegar no que queria. Fechada, a seção continua dizendo o essencial no
// cabeçalho — o resumo à direita é o que evita ter que abrir para saber.
//
// O conteúdo só existe no DOM quando está aberta: além de ser mais rápido,
// garante que nada invisível esteja capturando toque ou leitor de tela.

export default function Sanfona({
  titulo,
  resumo,          // texto curto à direita, visível mesmo fechada
  inicial = false,
  children
}) {
  const [aberta, setAberta] = useState(inicial);

  return (
    <div className={`sanfona ${aberta ? 'aberta' : ''}`}>
      <button
        type="button"
        className="sanfona-topo"
        onClick={() => setAberta(!aberta)}
        aria-expanded={aberta}
      >
        <span className="sanfona-seta" aria-hidden="true">›</span>
        <span className="sanfona-titulo">{titulo}</span>
        {resumo && <span className="sanfona-resumo">{resumo}</span>}
      </button>

      {/* O grid de uma linha só é o que permite animar a altura sem saber o
          tamanho do conteúdo: 0fr para 1fr. */}
      {aberta && (
        <div className="sanfona-corpo">
          <div className="sanfona-conteudo">{children}</div>
        </div>
      )}
    </div>
  );
}
