// Datas e meses, num lugar só. Tudo trabalha com texto ISO ("2026-09-16",
// "2026-09") no fuso do aparelho — é o formato que a planilha grava.

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const z = (n) => String(n).padStart(2, '0');

/** "2026-09-16" */
export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

/** "2026-09" */
export function mesDeHoje() {
  return hojeISO().slice(0, 7);
}

/** somarMes("2026-12", 1) → "2027-01" */
export function somarMes(mes, n) {
  let ano = Number(mes.slice(0, 4));
  let m = Number(mes.slice(5, 7)) + n;
  while (m > 12) { m -= 12; ano++; }
  while (m < 1) { m += 12; ano--; }
  return `${ano}-${z(m)}`;
}

/** "2026-09" → "setembro de 2026" */
export function mesPorExtenso(mes) {
  const nome = MESES[Number(String(mes || '').slice(5, 7)) - 1];
  return nome ? `${nome} de ${String(mes).slice(0, 4)}` : String(mes || '');
}

/** "2026-10" → "outubro"; em outro ano, "outubro de 2027". */
export function nomeDoMes(mes) {
  const [ano, m] = String(mes || '').split('-');
  const nome = MESES[Number(m) - 1];
  if (!nome) return mes;
  return ano === String(new Date().getFullYear()) ? nome : `${nome} de ${ano}`;
}

/** "2026-09" → "set/26" — para eixo de gráfico, onde cabe pouco. */
export function mesAbreviado(mes) {
  const nome = MESES[Number(String(mes).slice(5, 7)) - 1];
  return nome ? `${nome.slice(0, 3)}/${String(mes).slice(2, 4)}` : String(mes);
}

/** "2026-09-16" → "16/09" */
export function diaDe(iso) {
  const [, m, d] = String(iso).split('-');
  return `${d}/${m}`;
}

/** Como diaDe, mas "hoje" quando é hoje. */
export function diaOuHoje(iso) {
  if (!iso) return '';
  return iso === hojeISO() ? 'hoje' : diaDe(iso);
}

/** "Setembro" — só a primeira letra sobe. */
export function maiuscula(texto) {
  return texto ? texto[0].toUpperCase() + texto.slice(1) : texto;
}
