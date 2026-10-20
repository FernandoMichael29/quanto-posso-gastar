// A fogueira da casa: dias seguidos em que alguém cuidou das finanças. Quem
// decide quais dias ficaram acesos é a planilha (painel.fogueira, ver
// fogueira_ no Codigo.gs); aqui entra também o que está na fila deste celular,
// para o fogo acender na hora, mesmo sem internet. O desenho é
// componentes/Fogueira.jsx.

export const ARTES = ['pequena', 'grande', 'azul'];   // linhas de src/assets/fogueira.png
export const QUADROS_FOGO = 9;
export const LADO_FOGO = 64;
const DIAS_DE_ATRASO = 2;

/** Os níveis: a fogueira cresce com a sequência. */
export const NIVEIS = [
  { min: 0, id: 'apagada', nome: 'apagada', arte: 'pequena', escala: 0.7 },
  { min: 1, id: 'faisca', nome: 'faísca', arte: 'pequena', escala: 0.55 },
  { min: 3, id: 'brasa', nome: 'brasa', arte: 'pequena', escala: 0.75 },
  { min: 7, id: 'fogueira', nome: 'fogueira', arte: 'pequena', escala: 1 },
  { min: 14, id: 'grande', nome: 'fogueira grande', arte: 'grande', escala: 1 },
  { min: 30, id: 'enorme', nome: 'fogueira enorme', arte: 'grande', escala: 1, brilho: true },
  { min: 60, id: 'azul', nome: 'chama azul', arte: 'azul', escala: 1, brilho: true }
];
/** Os marcos mostrados na tela da fogueira (a faísca não conta como marco). */
export const MARCOS = NIVEIS.filter((n) => n.min >= 3);

const z = (n) => String(n).padStart(2, '0');
const isoDe = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
export function diaMais(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  return isoDe(new Date(a, m - 1, d + n, 12));
}
function diasEntre(de, ate) {
  const [a1, m1, d1] = de.split('-').map(Number);
  const [a2, m2, d2] = ate.split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}

export function nivelDaFogueira(dias) {
  let atual = NIVEIS[0];
  for (const n of NIVEIS) if (dias >= n.min) atual = n;
  return atual;
}
export function proximoNivel(dias) {
  return MARCOS.find((n) => n.min > dias) || null;
}

/** Os dias acesos só pelo que está na fila deste celular (ainda não subiu). */
export function acesosDaFila(fila = [], hoje) {
  const dias = new Map();
  for (const item of fila) {
    if (!item?.criado_em) continue;
    const reg = isoDe(new Date(item.criado_em));
    if (reg > hoje) continue;
    const quem = item.lancamento?.pessoa || '';
    const marcar = (d) => { if (!dias.has(d)) dias.set(d, new Set()); if (quem) dias.get(d).add(quem); };
    marcar(reg);
    const data = String(item.lancamento?.data || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(data) && data < reg && diasEntre(data, reg) <= DIAS_DE_ATRASO) marcar(data);
  }
  return dias;
}

const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/**
 * Como a fogueira está agora, juntando a planilha e a fila.
 * Sem nada da planilha ainda (primeira abertura, script antigo) devolve null.
 */
export function estadoDaFogueira(servidor, fila = [], hoje) {
  if (!servidor || !Array.isArray(servidor.acesos)) return null;
  const acesos = new Set(servidor.acesos);
  const daFila = acesosDaFila(fila, hoje);
  for (const d of daFila.keys()) acesos.add(d);
  const acesoHoje = acesos.has(hoje);

  let dias;
  if (servidor.hoje === hoje) {
    // a planilha já contou a sequência inteira (até ontem, se hoje ainda não acendeu)
    dias = servidor.dias + (acesoHoje && !servidor.aceso_hoje ? 1 : 0);
    // a fila pode ter religado ontem (lançado offline): recontar pelos dias conhecidos
    if (!servidor.aceso_hoje) {
      let n = 0, d = acesoHoje ? hoje : diaMais(hoje, -1);
      while (acesos.has(d)) { n++; d = diaMais(d, -1); }
      dias = Math.max(dias, n);
    }
  } else {
    // dado de outro dia (cache): conta pelo que se sabe dos últimos 70 dias
    let n = 0, d = acesoHoje ? hoje : diaMais(hoje, -1);
    while (acesos.has(d)) { n++; d = diaMais(d, -1); }
    dias = n;
  }

  const quem = new Set(servidor.hoje === hoje ? servidor.quem_hoje || [] : []);
  for (const p of daFila.get(hoje) || []) quem.add(p);

  const semana = [];
  for (let i = 6; i >= 0; i--) {
    const d = diaMais(hoje, -i);
    const [a, m, dd] = d.split('-').map(Number);
    semana.push({ dia: d, letra: LETRAS[new Date(a, m - 1, dd, 12).getDay()], aceso: acesos.has(d), hoje: i === 0 });
  }
  const nivel = nivelDaFogueira(dias);
  return {
    dias,
    acesoHoje,
    // o fogo de hoje só apaga à meia-noite: até lá, é brasa esperando lenha
    emRisco: !acesoHoje && dias > 0,
    quemHoje: [...quem],
    recorde: Math.max(Number(servidor.recorde) || 0, dias),
    nivel,
    proximo: proximoNivel(dias),
    semana,
    acesos,
    naoGastei: new Set(servidor.nao_gastei || [])
  };
}

/** O calendário de um mês ('aaaa-mm'), semana começando no domingo. */
export function calendarioDoMes(mes, acesos, hoje) {
  const [a, m] = mes.split('-').map(Number);
  const primeiro = new Date(a, m - 1, 1, 12).getDay();
  const ultimo = new Date(a, m, 0).getDate();
  const casas = Array.from({ length: primeiro }, () => null);
  for (let d = 1; d <= ultimo; d++) {
    const dia = `${mes}-${z(d)}`;
    casas.push({ dia, numero: d, aceso: acesos.has(dia), hoje: dia === hoje, futuro: dia > hoje });
  }
  return casas;
}
