// Contas da tela Mês que não desenham nada: dá para ler e testar sem React.
import { formatarBRL, soNumero } from '../../lib/parser.js';
import { hojeISO, mesDeHoje } from '../../lib/datas.js';

/** O vencimento dentro do mês, sem estourar o fim do mês nem passar de hoje. */
export function dataDoVencimento(mes, dia) {
  const ultimo = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
  const d = Math.min(Math.max(Number(dia) || 1, 1), ultimo);
  const iso = `${mes}-${String(d).padStart(2, '0')}`;
  const hoje = hojeISO();
  return iso > hoje ? hoje : iso;
}

// Conta fixa vence, renda cai. Mesma lógica de datas, palavras diferentes —
// "venceu há 5 dias" numa entrada de dinheiro não quer dizer nada.
const PALAVRAS = {
  despesa: {
    feito: 'já lançado',
    futuro: (d) => `vence dia ${d}`,
    passado: (d) => `venceu dia ${d} e não foi lançado`,
    emDias: (n) => (n === 1 ? 'vence amanhã' : `vence em ${n} dias`),
    hoje: 'vence hoje',
    atrasado: (n) => `venceu há ${n} dia${n > 1 ? 's' : ''} e não foi lançado`
  },
  receita: {
    feito: 'já recebido',
    futuro: (d) => `cai dia ${d}`,
    passado: (d) => `era para cair dia ${d} e não foi registrado`,
    emDias: (n) => (n === 1 ? 'cai amanhã' : `cai em ${n} dias`),
    hoje: 'cai hoje',
    atrasado: (n) => `era para ter caído há ${n} dia${n > 1 ? 's' : ''}`
  }
};

/** Em que pé está um compromisso do mês, comparando o dia dele com hoje. */
export function situacaoDa(f, mesPainel) {
  const p = PALAVRAS[f.tipo === 'receita' ? 'receita' : 'despesa'];

  if (f.lancado) return { situacao: 'sincronizado', rotulo: p.feito };
  if (!f.dia) return { situacao: 'pendente', rotulo: 'sem dia definido' };

  const mesHoje = mesDeHoje();
  if (mesPainel > mesHoje) return { situacao: 'pendente', rotulo: p.futuro(f.dia) };
  if (mesPainel < mesHoje) return { situacao: 'erro', rotulo: p.passado(f.dia) };

  const diasAte = f.dia - new Date().getDate();
  if (diasAte > 0) return { situacao: 'pendente', rotulo: p.emDias(diasAte) };
  if (diasAte === 0) return { situacao: 'pendente', rotulo: p.hoje };
  return { situacao: 'erro', rotulo: p.atrasado(-diasAte) };
}

/**
 * Contas fixas com situação calculada. Uma conta que não virou lançamento pode
 * ainda ir vencer ou já ter vencido sem registro — chamar as duas de "previsto"
 * escondia a segunda, que é a que precisa de você. O nome visível é o do
 * lançamento quando existe: é o que você edita.
 */
export function fixasDoPainel(painel) {
  return (painel?.fixas || []).map((f) => comNome({ ...f, ...situacaoDa(f, painel.mes) }));
}

export function rendasDoPainel(painel) {
  const rendas = (painel?.rendas || []).map((r) => {
    const base = { ...r, tipo: 'receita' };
    return comNome({ ...base, ...situacaoDa(base, painel.mes) });
  });
  // Renda marcada para a frente que não pertence a regra nenhuma: entra na
  // lista como item a confirmar, senão só existiria no total.
  const soltos = (painel?.agendados_soltos || []).map((a) => ({
    nome: a.nome,
    nome_visivel: a.nome,
    valor: a.valor,
    tipo: 'receita',
    lancado: false,
    uuid_agendado: a.uuid,
    valor_agendado: a.valor,
    situacao: 'pendente',
    rotulo: 'agendado, confirme quando cair'
  }));
  return rendas.concat(soltos);
}

const comNome = (c) => ({ ...c, nome_visivel: c.nome_lancado || c.nome });

export function resumirFixas(lista) {
  return {
    total: lista.reduce((a, f) => a + f.valor, 0),
    nomes: lista.map((f) => f.nome)
  };
}

/** Um mês que ainda está correndo tem previsão; um mês fechado só tem fato. */
export function mesAberto(painel) {
  return Boolean(painel) && painel.mes >= mesDeHoje();
}

/**
 * A frase embaixo do número. Existe para o número nunca ser lido como
 * promessa: diz de onde ele veio e o que ainda depende de acontecer.
 */
export function notaDaResposta(painel, aberto, livre) {
  if (!aberto) return 'O mês já fechou: é o que entrou menos o que saiu.';

  const p = painel.previsao || {};
  const partes = [];
  if (p.ainda_entra > 0) partes.push('o que ainda entra');
  if (p.ainda_sai > 0) partes.push('as contas que faltam pagar');

  if (livre < 0) {
    return partes.length
      ? `Contando ${partes.join(' e ')}, o mês fecha no vermelho.`
      : 'O mês já está no vermelho.';
  }
  if (!partes.length) return 'Tudo do mês já aconteceu — é o que sobrou de verdade.';
  return `Já contando ${partes.join(' e ')}. Não inclui o que você ainda não registrou.`;
}

/** "Transporte · R$ 1.935,32" — o resumo da sanfona fechada. */
export function lider(porCategoria) {
  const topo = (porCategoria || [])[0];
  return topo ? `${topo.nome} · ${formatarBRL(topo.total)}` : '';
}

/** "+1.234,56" / "−800,00": o sinal é parte da conta, não só a cor. */
export function comSinal(v) {
  return `${v < 0 ? '−' : '+'}${soNumero(Math.abs(v))}`;
}

/** Já aconteceu, ou ainda está por vir? É o que separa a lista em duas. */
export function ehFuturo(l) {
  return Boolean(l) && String(l.data || '') > hojeISO();
}

const TRADUZ = {
  sem_configuracao: 'Configure o endereço e o token nos Ajustes.',
  sem_rede: 'Sem internet. Esta tela lê os dados da planilha na hora.',
  token_invalido: 'O token não confere.',
  nao_encontrado: 'Esse lançamento não está mais na planilha.',
  nao_gravou: 'A planilha não gravou o lançamento. Tente de novo.',
  compromisso_nao_encontrado: 'Essa conta fixa não está mais cadastrada neste mês.',
  valor_zerado: 'Sem valor, não dá para lançar.',
  api_fora: 'O script respondeu com erro.'
};

export function traduzir(codigo) {
  return TRADUZ[codigo] || 'Algo deu errado ao falar com a planilha.';
}
