// Interpretação local de frases faladas em português do Brasil.
// Roda inteiro dentro do celular: sem rede, sem custo, instantâneo.
// O que ele não consegue resolver com segurança, ele marca para a IA.

// --------------------------------------------------------------------------
// Números por extenso
// --------------------------------------------------------------------------

const UNIDADES = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19
};

const DEZENAS = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  sessenta: 60, setenta: 70, oitenta: 80, noventa: 90
};

const CENTENAS = {
  cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400,
  quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800,
  novecentos: 900
};

const MULTIPLICADORES = { mil: 1000, milhao: 1000000, milhoes: 1000000 };

export function semAcento(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function valorDaPalavra(p) {
  if (p in UNIDADES) return { v: UNIDADES[p], tipo: 'simples' };
  if (p in DEZENAS) return { v: DEZENAS[p], tipo: 'simples' };
  if (p in CENTENAS) return { v: CENTENAS[p], tipo: 'simples' };
  if (p in MULTIPLICADORES) return { v: MULTIPLICADORES[p], tipo: 'mult' };
  return null;
}

/**
 * Troca sequências de números por extenso pelos dígitos correspondentes.
 * "cento e vinte reais" -> "120 reais"
 */
export function extensoParaDigitos(texto) {
  const palavras = semAcento(texto).split(/\s+/);
  const saida = [];
  let total = 0, atual = 0, dentro = false;

  // "um" e "uma" quase sempre são artigo, não número ("uma coisa", "um lanche").
  // Só valem como número quando fazem parte de uma sequência maior ("um mil e
  // duzentos"), então uma sequência que resolveu para 1 volta como estava.
  let bruto = [];

  const fechar = () => {
    if (dentro) {
      const n = total + atual;
      const soArtigo = n === 1 && bruto.length === 1 && /^(um|uma)$/.test(bruto[0]);
      saida.push(soArtigo ? bruto[0] : String(n));
      total = 0; atual = 0; dentro = false; bruto = [];
    }
  };

  for (let i = 0; i < palavras.length; i++) {
    const p = palavras[i].replace(/[^a-z0-9]/g, '');
    const info = valorDaPalavra(p);

    if (info) {
      dentro = true;
      bruto.push(p);
      if (info.tipo === 'mult') {
        atual = (atual === 0 ? 1 : atual) * info.v;
        total += atual;
        atual = 0;
      } else {
        atual += info.v;
      }
      continue;
    }

    // "e" entre números por extenso não quebra a sequência.
    if (p === 'e' && dentro) {
      const prox = palavras[i + 1] ? palavras[i + 1].replace(/[^a-z0-9]/g, '') : '';
      if (valorDaPalavra(prox)) continue;
    }

    fechar();
    saida.push(palavras[i]);
  }
  fechar();
  return saida.join(' ');
}

// --------------------------------------------------------------------------
// Valores em dinheiro
// --------------------------------------------------------------------------

const RE_VALOR = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:[,](\d{1,2}))?\b/g;

function acharValores(texto) {
  const achados = [];
  let m;
  RE_VALOR.lastIndex = 0;
  while ((m = RE_VALOR.exec(texto)) !== null) {
    const inteiro = m[1].replace(/\./g, '');
    const centavos = m[2] ? m[2].padEnd(2, '0') : '00';
    achados.push({
      valor: Number(inteiro) + Number(centavos) / 100,
      indice: m.index,
      trecho: m[0]
    });
  }
  return achados;
}

// --------------------------------------------------------------------------
// Tipo, método, data
// --------------------------------------------------------------------------

const PALAVRAS_RECEITA = [
  'recebi', 'receber', 'recebido', 'salario', 'entrou', 'ganhei', 'caiu',
  'depositaram', 'deposito', 'me pagou', 'me pagaram', 'vendi', 'venda',
  'reembolso', 'estorno', 'rendimento', 'rendeu', 'dividendo', 'pix recebido',
  'contracheque', 'holerite', 'adiantamento', 'decimo terceiro', 'ferias'
];

const PALAVRAS_DESPESA = [
  'gastei', 'paguei', 'comprei', 'custou', 'foi', 'torrei', 'saiu', 'debitou',
  'parcelei', 'assinei', 'mandei pix', 'pix pra', 'pix para'
];

const METODOS = [
  { nome: 'pix', chaves: ['pix'] },
  { nome: 'credito', chaves: ['credito', 'cartao de credito', 'no cartao', 'parcelado', 'parcelei'] },
  { nome: 'debito', chaves: ['debito', 'cartao de debito'] },
  { nome: 'dinheiro', chaves: ['dinheiro', 'especie', 'em cash'] },
  { nome: 'boleto', chaves: ['boleto', 'fatura'] }
];

const DIAS_SEMANA = [
  'domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'
];

// Marcas de que a frase declara uma REGRA, não registra um FATO.
//
// "mercado 120"          -> saiu dinheiro hoje                 (fato)
// "meu aluguel é 1800"   -> passa a valer 1800 por mês         (regra)
// "esse mês foi 1850"    -> vale só neste mês                  (regra pontual)
//
// Registrar uma regra como gasto é o erro mais caro que este app pode cometer:
// vira uma despesa que nunca aconteceu. Na dúvida, mando para a IA decidir —
// custa menos de um centavo e ela tem o contexto dos compromissos já cadastrados.
const MARCAS_DE_REGRA = [
  'mensal', 'mensalmente', 'por mes', 'ao mes', 'todo mes', 'todos os meses',
  'cada mes', 'todo dia', 'sempre',
  'agora e', 'agora sao', 'passou a ser', 'passou a custar', 'passa a ser',
  'reajuste', 'reajustou', 'reajustado', 'aumentou para', 'subiu para',
  'mudou para', 'fica em', 'sera de', 'vai ser',
  'esse mes', 'este mes', 'nesse mes', 'neste mes',
  'assinei', 'cancelei', 'nao pago mais', 'terminei de pagar', 'quitei'
];

/** A frase declara uma regra sobre um gasto fixo? */
export function pareceRegra(texto) {
  return MARCAS_DE_REGRA.find((m) => contemPalavra(texto, m)) || null;
}

/**
 * Procura a palavra inteira, não pedaço de outra.
 * Sem isso, "gas" (de Moradia) casaria com "gastei" e "oi" com "coisa".
 */
export function contemPalavra(texto, palavra) {
  const p = semAcento(palavra).trim();
  if (!p) return false;
  const escapada = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escapada}($|[^a-z0-9])`).test(texto);
}

function contem(texto, lista) {
  return lista.find((p) => contemPalavra(texto, p));
}

function isoDe(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function somarDias(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Devolve { data, certeza, trecho }. `trecho` é o pedaço de texto que falava da
 * data — quem chama remove ele antes de procurar valores, senão o "5" de
 * "dia 5" seria confundido com dinheiro. `certeza: false` significa que o texto
 * fala de uma data que eu não sei resolver sozinho, e aí vale chamar a IA.
 */
function acharData(texto, hoje) {
  if (/\bhoje\b/.test(texto)) return { data: isoDe(hoje), certeza: true, trecho: '' };
  if (/\bontem\b/.test(texto)) return { data: isoDe(somarDias(hoje, -1)), certeza: true, trecho: '' };
  if (/\banteontem\b/.test(texto)) return { data: isoDe(somarDias(hoje, -2)), certeza: true, trecho: '' };

  const diaMes = texto.match(/\bdia\s+(\d{1,2})(?:\s+de\s+(\d{1,2}))?\b/);
  if (diaMes) {
    const dia = Number(diaMes[1]);
    if (dia >= 1 && dia <= 31) {
      const d = new Date(hoje);
      if (diaMes[2]) d.setMonth(Number(diaMes[2]) - 1);
      d.setDate(dia);
      if (!diaMes[2] && d > hoje) d.setMonth(d.getMonth() - 1);
      return { data: isoDe(d), certeza: true, trecho: diaMes[0] };
    }
  }

  const semana = DIAS_SEMANA.find((d) => texto.includes(d));
  if (semana || /semana passada|mes passado|retrasad/.test(texto)) {
    return { data: isoDe(hoje), certeza: false, trecho: '' };
  }

  return { data: isoDe(hoje), certeza: true, trecho: '' };
}

// --------------------------------------------------------------------------
// Categoria
// --------------------------------------------------------------------------

function acharCategoria(texto, categorias, tipo) {
  let melhor = null;
  for (const c of categorias) {
    if (c.tipo && c.tipo !== tipo) continue;
    for (const palavra of c.palavras || []) {
      const p = semAcento(palavra).trim();
      if (!p) continue;
      if (contemPalavra(texto, p) && (!melhor || p.length > melhor.tamanho)) {
        melhor = { categoria: c.categoria, tamanho: p.length, gatilho: p };
      }
    }
  }
  return melhor;
}

// --------------------------------------------------------------------------
// Interpretação
// --------------------------------------------------------------------------

/**
 * @param {string} fala        o que o usuário falou ou digitou
 * @param {object} opcoes      { categorias, contas, hoje }
 * @returns {{
 *   confianca: 'alta'|'media'|'ia',
 *   motivo: string,
 *   lancamento: object|null
 * }}
 */
export function interpretar(fala, opcoes = {}) {
  const categorias = opcoes.categorias || [];
  const hoje = opcoes.hoje || new Date();
  const original = String(fala || '').trim();

  if (!original) {
    return { confianca: 'ia', motivo: 'frase vazia', lancamento: null };
  }

  const texto = extensoParaDigitos(original);

  // --- regra ou fato? Uma regra mal classificada vira um gasto inventado,
  //     então qualquer sinal de recorrência vai para a IA decidir.
  const marca = pareceRegra(texto);
  if (marca) {
    return {
      confianca: 'ia',
      motivo: `"${marca}" parece falar de um gasto fixo, não de um gasto de hoje`,
      lancamento: null
    };
  }

  // --- data primeiro, para o "5" de "dia 5" não passar por dinheiro
  const { data, certeza, trecho } = acharData(texto, hoje);
  if (!certeza) {
    return { confianca: 'ia', motivo: 'a data falada é relativa demais', lancamento: null };
  }
  const semData = trecho ? texto.replace(trecho, ' ') : texto;

  // --- parcelamento: "10x de 89,90", "em 10 vezes de 89,90"
  const parc = semData.match(/(\d{1,2})\s*(?:x|vezes)\s*(?:de\s*)?(?:r\$\s*)?(\d+(?:[,.]\d{1,2})?)/);
  let valor = null, parcelas = null, valorParcela = null;

  if (parc) {
    parcelas = Number(parc[1]);
    valorParcela = Number(parc[2].replace(/\./g, '').replace(',', '.'));
    valor = Math.round(parcelas * valorParcela * 100) / 100;
  } else {
    const valores = acharValores(semData);
    if (valores.length === 0) {
      return { confianca: 'ia', motivo: 'não achei nenhum valor', lancamento: null };
    }
    if (valores.length > 1) {
      return { confianca: 'ia', motivo: 'a frase tem mais de um valor', lancamento: null };
    }
    valor = valores[0].valor;
  }

  if (!valor || valor <= 0) {
    return { confianca: 'ia', motivo: 'valor não faz sentido', lancamento: null };
  }

  // --- tipo
  const gatilhoReceita = contem(texto, PALAVRAS_RECEITA);
  const gatilhoDespesa = contem(texto, PALAVRAS_DESPESA);
  const tipo = gatilhoReceita && !gatilhoDespesa ? 'receita' : 'despesa';

  // --- método
  const metodo = METODOS.find((m) => m.chaves.some((k) => contemPalavra(texto, k)));

  // --- categoria
  const cat = acharCategoria(texto, categorias, tipo);
  const padrao = tipo === 'receita' ? 'Outras Entradas' : 'Outros';

  const lancamento = {
    tipo,
    valor,
    categoria: cat ? cat.categoria : padrao,
    descricao: descricaoDe(original),
    data,
    conta: tipo === 'receita' ? 'Principal' : (metodo?.nome === 'credito' ? 'Cartão' : 'Principal'),
    metodo: metodo ? metodo.nome : '',
    parcela_atual: parcelas ? 1 : null,
    parcelas_total: parcelas || null,
    valor_parcela: valorParcela || null,
    texto_falado: original,
    origem: 'voz'
  };

  return {
    confianca: cat ? 'alta' : 'media',
    motivo: cat ? `reconheci "${cat.gatilho}"` : 'não reconheci a categoria',
    lancamento
  };
}

/** Uma descrição curta e legível a partir da fala. */
function descricaoDe(original) {
  const limpo = original
    .replace(/\br\$\s*/gi, '')
    .replace(/\breais?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

export function formatarBRL(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL'
  });
}
