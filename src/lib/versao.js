// A versão que este app espera encontrar no Apps Script.
//
// São duas metades que você publica separado — o front no GitHub e o Codigo.gs
// no Apps Script — e é fácil subir uma e esquecer a outra. Quando isso acontece,
// o sintoma é o pior possível: nada quebra, a novidade simplesmente não aparece
// e não dá para saber se o bug é no código ou na publicação. Este número existe
// para responder isso na tela.
//
// Suba junto com VERSAO no Codigo.gs, sempre.
export const VERSAO_APP = '2.4.0';

/** Compara versões por número: '2.9.0' < '2.10.0'. Texto puro erraria isso. */
export function menorQue(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0;
  }
  return false;
}
