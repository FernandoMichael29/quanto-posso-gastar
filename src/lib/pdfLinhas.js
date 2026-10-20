// Abre um PDF no próprio celular (nada sai do aparelho) e devolve as linhas de
// texto com a posição de cada pedaço — é o que lib/importar.js lê.
// O pdf.js é grande: só é baixado quando alguém escolhe um PDF.

/** Agrupa os pedaços de texto em linhas (mesma altura), da esquerda para a direita. */
export function agruparLinhas(paginas) {
  const linhas = [];
  paginas.forEach((itens, p) => {
    const porY = [];
    for (const it of itens) {
      if (!it.t.trim()) continue;
      let l = porY.find((x) => Math.abs(x.y - it.y) <= 2);
      if (!l) { l = { pagina: p + 1, y: it.y, itens: [] }; porY.push(l); }
      l.itens.push({ x: it.x, t: it.t });
    }
    porY.sort((a, b) => b.y - a.y).forEach((l) => { l.itens.sort((a, b) => a.x - b.x); linhas.push(l); });
  });
  return linhas;
}

export async function linhasDoPdf(arrayBuffer) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    const tc = await pg.getTextContent();
    paginas.push(tc.items.map((i) => ({ x: Math.round(i.transform[4]), y: Math.round(i.transform[5]), t: i.str })));
  }
  return agruparLinhas(paginas);
}
