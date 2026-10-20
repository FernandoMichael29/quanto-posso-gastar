// O "ouro de hoje": quanto dá para gastar hoje sem apertar o resto do mês.
//
//   livre         = o que sobra no fim do mês, já descontadas as contas fixas
//                   que ainda vão sair e somadas as rendas que ainda vão entrar
//   livre do dia  = livre + o que você já gastou hoje por conta própria
//   por dia       = livre do dia ÷ dias que faltam (contando hoje)
//   ouro de hoje  = por dia − gasto livre de hoje
//
// Com missão do mês (meta de guardar), ela sai do livre antes de tudo: o ouro
// é o que dá para gastar e ainda cumprir a missão.
//
// Assim gastar 42 hoje tira 42 do ouro de hoje — e não 42 ÷ 12. Conta fixa
// paga e parcela antiga não entram no "gasto livre": já estavam reservadas.

const z = (n) => String(n).padStart(2, '0');
const isoDia = (d) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
const arred = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** A meta de guardar que vale no mês: a última vigência que começou até ele. */
export function metaDoMes(metas, mes) {
  let valor = 0;
  for (const m of metas || []) if (m && m.desde <= mes) valor = Number(m.valor) || 0;
  return valor;
}

/** Dias que faltam no mês, contando hoje. */
export function diasRestantes(agora = new Date()) {
  const ultimo = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  return ultimo - agora.getDate() + 1;
}

/**
 * O que a planilha ainda não contou: o que está só no aparelho, e o que acabou
 * de subir depois que o painel foi pedido. Sem isso o ouro só cairia segundos
 * depois de registrar — e às vezes subia de volta antes de cair de vez.
 */
export function pendentesDoMes(fila, { mes, hoje, desde = 0 }) {
  const soma = { livre: 0, hoje: 0, receitas: 0, porCategoria: {} };
  for (const item of fila || []) {
    const l = item.lancamento;
    if (!l || !String(l.data || '').startsWith(mes)) continue;
    const painelJaViu = item.estado === 'sincronizado' && !(Number(item.ultima_tentativa) > desde);
    if (painelJaViu) continue;
    // Parcelado: neste mês pesa só a primeira parcela.
    const vezes = Number(l.parcelas_total) > 1 ? Number(l.parcelas_total) : 1;
    const valor = (Number(l.valor) || 0) / vezes;
    if (l.tipo === 'receita') { soma.livre += valor; soma.receitas += valor; continue; }
    if (l.tipo === 'fatura') continue;
    soma.livre -= valor;
    const cat = l.categoria || 'Outros';
    soma.porCategoria[cat] = (soma.porCategoria[cat] || 0) + valor;
    if (l.data === hoje) soma.hoje += valor;
  }
  return soma;
}

/**
 * @param painel  resposta de api.painel() do mês atual
 * @param fila    itens do aparelho (db.listar())
 * @param opcoes  { agora: Date, desde: quando o painel foi pedido (ms) }
 */
export function calcularOuro(painel, fila = [], opcoes = {}) {
  if (!painel?.previsao) return null;
  const agora = opcoes.agora || new Date();
  const hoje = isoDia(agora);
  const mes = hoje.slice(0, 7);
  if (painel.mes && painel.mes !== mes) return null;   // virou o mês: o painel é velho

  const p = pendentesDoMes(fila, { mes, hoje, desde: opcoes.desde || 0 });
  const reserva = metaDoMes(painel.metas, mes);
  const livre = (Number(painel.previsao.sobra) || 0) + p.livre - reserva;
  const gastoHoje = (Number(painel.gasto_livre_hoje) || 0) + p.hoje;
  const dias = diasRestantes(agora);
  const porDia = Math.max(0, livre + gastoHoje) / dias;
  const total = (Number(painel.receitas) || 0) + (Number(painel.previsao.ainda_entra) || 0) + p.receitas;

  return {
    ouro: arred(porDia - gastoHoje),
    porDia: arred(porDia),
    gastoHoje: arred(gastoHoje),
    livre: arred(livre),
    reserva,
    total: arred(total),
    // a vida do mês: quanto do dinheiro do mês ainda está livre
    vida: total > 0 ? Math.min(1, Math.max(0, livre / total)) : null,
    dias,
    amanha: dias > 1 ? arred(Math.max(0, livre) / (dias - 1)) : null
  };
}
