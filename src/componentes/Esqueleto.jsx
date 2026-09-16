// O que aparece enquanto a planilha responde.
//
// Uma roda girando no meio da tela diz "espere" e mais nada. O esqueleto diz
// "vem uma resposta grande, três números e uma lista", e quando o conteúdo
// chega ele ocupa o lugar que já estava reservado — sem o pulo que faz a
// pessoa perder o que estava lendo.

export default function Esqueleto({ modo = 'mes' }) {
  if (modo === 'lista') {
    return (
      <div className="esqueleto" aria-hidden="true">
        <div className="osso lista" />
      </div>
    );
  }

  return (
    <div className="esqueleto" aria-hidden="true">
      <div className="osso alto" />
      <div className="osso linha" />
      <div className="osso lista" />
    </div>
  );
}
