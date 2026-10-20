// Importar o extrato do banco: ler o arquivo (PDF do Nubank e do Itaú, CSV do
// Nubank, OFX de qualquer banco), entender cada movimento e sugerir o que ele
// vira no app. Tudo aqui é conta pura (os testes rodam no node); quem abre o
// PDF é lib/pdfLinhas.js e quem desenha é telas/Importar.jsx.
//
// Um movimento lido: { id, data: 'aaaa-mm-dd', valor (com sinal: − saiu, + entrou),
//   operacao: o que o banco escreveu ("Transferência enviada pelo Pix"),
//   contraparte: o nome do outro lado ("ELEVAR TELECOM LTDA"), detalhe: o resto }
//
// O `id` é estável: o mesmo movimento lido de novo (outro arquivo do mesmo
// período) dá o mesmo id — e vira o uuid do lançamento, então importar duas
// vezes não duplica nada.

import { semAcento, sugerirCategoria } from './parser.js';

const MESES_CURTOS = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
const z = (n) => String(n).padStart(2, '0');
const DINHEIRO = /^[+-]?\s?\d{1,3}(\.\d{3})*,\d{2}$/;

/** "2.989,28" → 2989.28; "- 2.893,89" → −2893.89 */
export function lerValor(t) {
  const s = String(t || '').replace(/\s/g, '');
  if (!/^[+-]?\d{1,3}(\.\d{3})*,\d{2}$/.test(s) && !/^[+-]?\d+,\d{2}$/.test(s)) return null;
  const n = Number(s.replace(/[+-]/, '').replace(/\./g, '').replace(',', '.'));
  return Math.round((s.startsWith('-') ? -n : n) * 100) / 100;
}

/** Hash curto e estável (FNV-1a de 32 bits, duas voltas) para o id do movimento. */
export function hashCurto(texto) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

const normal = (t) => semAcento(String(t || '')).replace(/[^a-z0-9]+/g, ' ').trim();

/** Dá o id a cada movimento: banco + dia + valor + texto + "qual deles" (dois boletos iguais no mesmo dia são dois). */
function comIds(banco, movimentos) {
  const vistos = new Map();
  return movimentos.map((m) => {
    const base = m.idBanco
      ? `${banco}|${m.idBanco}`
      : `${banco}|${m.data}|${m.valor.toFixed(2)}|${normal(m.operacao)}|${normal(m.contraparte)}`;
    const n = (vistos.get(base) || 0) + 1;
    vistos.set(base, n);
    return { ...m, id: `imp-${hashCurto(`${base}|${n}`)}` };
  });
}

/**
 * O nome do outro lado, sem CPF/CNPJ, banco e agência:
 * "ANA LIMA SOUZA - •••.111.222- •• - ITAÚ…" → "ANA LIMA SOUZA"
 * "58.025.342 JOAO MARCOS PEREIRA ROGADO -" → "JOAO MARCOS PEREIRA ROGADO"
 */
export function nomeDaContraparte(texto) {
  let t = String(texto || '').split(/\s+-\s+|\s+-$|•/)[0];
  t = t.replace(/\d{2,3}\.\d{3}\.\d{3}(\/\d{4}-?\d{0,2})?/g, '').replace(/^[\d.\-/\s]+/, '').replace(/\s+/g, ' ').trim();
  return t.replace(/[\s-]+$/, '');
}

// --- PDF: as linhas vêm de lib/pdfLinhas.js ---------------------------------
// Cada linha: { pagina, y, itens: [{ x, t }] } em ordem de leitura.

const textoDaLinha = (l) => l.itens.map((i) => i.t).join(' ');

export function detectarBanco(linhas) {
  const tudo = linhas.slice(0, 40).map(textoDaLinha).join('\n');
  if (/VALORES EM R\$/.test(tudo) && /Movimenta[cç][oõ]es|Saldo inicial/.test(tudo)) return 'nubank_conta';
  if (/extrato conta \/ lan[cç]amentos/i.test(tudo) || /valor \(R\$\)\s+saldo \(R\$\)/i.test(tudo)) return 'itau_conta';
  return null;
}

/** Nubank, extrato da conta em PDF: dia → "Total de entradas/saídas" → movimentos (o sinal vem da seção). */
export function lerNubankContaPdf(linhas) {
  let titular = '', cpfMeio = '', inicio = '', fim = '';
  const movimentos = [];
  let dia = '', sinal = 0, atual = null, xContraparte = null, xOperacao = null;

  for (const l of linhas) {
    const its = l.itens;
    const txt = textoDaLinha(l);
    if (!titular && l.pagina === 1 && its.length === 1 && /^[A-ZÀ-Ú][a-zà-ú]+( [A-ZÀ-Ú][a-zà-ú]+)+$/.test(its[0].t.trim())) titular = its[0].t.trim();
    const cpf = /•••\.(\d{3}\.\d{3})-••/.exec(txt);
    if (!cpfMeio && cpf && /CPF/.test(txt)) cpfMeio = cpf[1];
    const per = /(\d{2}) DE ([A-ZÇ]+) DE (\d{4}) a (\d{2}) DE ([A-ZÇ]+) DE (\d{4})/.exec(txt);
    if (per && !inicio) {
      const mes = (n) => MESES_CURTOS[n.slice(0, 3).replace('Ç', 'C')] || 0;
      inicio = `${per[3]}-${z(mes(per[2]))}-${per[1]}`;
      fim = `${per[6]}-${z(mes(per[5]))}-${per[4]}`;
    }

    // "06 OUT 2026  Total de entradas  + 2.989,28": abre o dia (e a seção)
    const d = /^(\d{2}) ([A-Z]{3}) (\d{4})$/.exec((its[0]?.t || '').trim());
    if (d && MESES_CURTOS[d[2]]) dia = `${d[3]}-${z(MESES_CURTOS[d[2]])}-${d[1]}`;
    if (/Total de entradas/.test(txt) && dia) { sinal = 1; atual = null; continue; }
    if (/Total de sa[ií]das/.test(txt) && dia) { sinal = -1; atual = null; continue; }
    if (!dia || !sinal) continue;

    const ultimo = its[its.length - 1];
    const valor = ultimo && DINHEIRO.test(ultimo.t.trim()) ? lerValor(ultimo.t) : null;
    if (valor != null && its.length >= 2) {
      const meio = its.slice(1, -1);
      atual = {
        data: dia, valor: Math.round(sinal * Math.abs(valor) * 100) / 100,
        operacao: its[0].t.trim(), detalhe: meio.map((i) => i.t).join(' ').trim()
      };
      xContraparte = meio[0]?.x ?? null;
      xOperacao = its[0].x;
      movimentos.push(atual);
      continue;
    }
    // Continuação do movimento de cima (linha sem valor): o que está na coluna
    // da operação ("Open Banking") completa a operação; o que está na coluna do
    // nome completa o nome/conta. Cabeçalho e rodapé ficam em outras colunas.
    if (!atual || !its.length) continue;
    for (const it of its) {
      if (Math.abs(it.x - xOperacao) <= 6) atual.operacao = `${atual.operacao} ${it.t.trim()}`;
      else if (it.x > 200 && it.x < 330 && (xContraparte == null || Math.abs(it.x - xContraparte) <= 10)) {
        if (xContraparte == null) xContraparte = it.x;
        atual.detalhe = `${atual.detalhe} ${it.t.trim()}`.trim();
      }
    }
  }
  const lidos = movimentos.map((m) => ({ ...m, contraparte: nomeDaContraparte(m.detalhe) }));
  return { banco: 'nubank_conta', rotulo: 'Nubank · conta', titular, cpfMeio, inicio, fim, movimentos: comIds('nubank', lidos) };
}

/** Itaú, extrato da conta em PDF: "dd/mm/aaaa  DESCRIÇÃO  valor  [saldo]"; "SALDO DO DIA" não é movimento. */
export function lerItauContaPdf(linhas) {
  let titular = '', inicio = '', fim = '', xValor = null, xSaldo = null;
  const movimentos = [];
  for (const l of linhas) {
    const txt = textoDaLinha(l);
    if (!titular && /^[A-ZÀ-Ú ]{8,}$/.test((l.itens[0]?.t || '').trim()) && l.pagina === 1 && l.itens.length >= 2) titular = l.itens[0].t.trim();
    const per = /(\d{2})\/(\d{2})\/(\d{4}) até (\d{2})\/(\d{2})\/(\d{4})/.exec(txt);
    if (per && !inicio) { inicio = `${per[3]}-${per[2]}-${per[1]}`; fim = `${per[6]}-${per[5]}-${per[4]}`; }
    const cab = l.itens.find((i) => /^valor/i.test(i.t)); const cabS = l.itens.find((i) => /^saldo \(/i.test(i.t));
    if (cab && cabS) { xValor = cab.x; xSaldo = cabS.x; continue; }

    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((l.itens[0]?.t || '').trim());
    if (!d) continue;
    const desc = (l.itens[1]?.t || '').trim();
    if (/^SALDO/i.test(desc)) continue;
    const valores = l.itens.slice(2).filter((i) => DINHEIRO.test(i.t.trim()));
    if (!valores.length) continue;
    // o valor é o número mais perto da coluna "valor" (o outro é o saldo)
    const pertoDoValor = (i) => (xValor == null || xSaldo == null ? true : Math.abs(i.x - xValor) < Math.abs(i.x - xSaldo));
    const v = valores.find(pertoDoValor);
    if (!v) continue;
    movimentos.push({
      data: `${d[3]}-${d[2]}-${d[1]}`, valor: lerValor(v.t),
      operacao: desc.replace(/\d{2}\/\d{2}$/, '').trim(), detalhe: desc, contraparte: ''
    });
  }
  // o Itaú lista do mais novo para o mais antigo: em ordem de data fica mais fácil conferir
  movimentos.reverse();
  return { banco: 'itau_conta', rotulo: 'Itaú · conta', titular, cpfMeio: '', inicio, fim, movimentos: comIds('itau', movimentos) };
}

// --- CSV (Nubank) e OFX ------------------------------------------------------

function linhasCsv(texto) {
  return String(texto).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const campos = []; let atual = '', aspas = false;
    for (const c of l) {
      if (c === '"') aspas = !aspas;
      else if (c === ',' && !aspas) { campos.push(atual); atual = ''; }
      else atual += c;
    }
    campos.push(atual);
    return campos.map((x) => x.trim());
  });
}

export function lerCsv(texto) {
  const [cab, ...resto] = linhasCsv(texto);
  if (!cab) return null;
  const k = cab.map((c) => normal(c));
  // Nubank conta: Data,Valor,Identificador,Descrição (dd/mm/aaaa; valor com sinal)
  if (k[0] === 'data' && k.includes('valor') && k.includes('identificador')) {
    const iD = k.indexOf('data'), iV = k.indexOf('valor'), iI = k.indexOf('identificador'), iT = k.findIndex((c) => c.startsWith('descri'));
    const movimentos = resto.map((r) => {
      const [dd, mm, aa] = r[iD].split('/');
      const descricao = r[iT] || '';
      const [operacao, ...partes] = descricao.split(' - ');
      return { data: `${aa}-${mm}-${dd}`, valor: Math.round(Number(r[iV]) * 100) / 100, operacao: operacao.trim(),
        detalhe: partes.join(' - '), contraparte: nomeDaContraparte(partes.join(' - ')), idBanco: r[iI] };
    }).filter((m) => m.data.length === 10 && !Number.isNaN(m.valor));
    return { banco: 'nubank_conta', rotulo: 'Nubank · conta (CSV)', titular: '', cpfMeio: '', movimentos: comIds('nubank', movimentos) };
  }
  // Nubank cartão: date,title,amount  (ou date,category,title,amount) — compra é positiva
  if (k[0] === 'date' && k.includes('title') && k.includes('amount')) {
    const iD = k.indexOf('date'), iT = k.indexOf('title'), iA = k.indexOf('amount');
    const movimentos = resto.map((r) => ({
      data: r[iD], valor: -Math.round(Number(r[iA]) * 100) / 100, operacao: r[iT], detalhe: '', contraparte: r[iT]
    })).filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.data) && !Number.isNaN(m.valor));
    return { banco: 'nubank_cartao', rotulo: 'Nubank · cartão (CSV)', titular: '', cpfMeio: '', movimentos: comIds('nubank-cartao', movimentos) };
  }
  return null;
}

export function lerOfx(texto) {
  const blocos = String(texto).split(/<STMTTRN>/i).slice(1);
  if (!blocos.length) return null;
  const campo = (b, nome) => (new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(b)?.[1] || '').trim();
  const movimentos = blocos.map((b) => {
    const dt = campo(b, 'DTPOSTED');
    const nome = campo(b, 'NAME'), memo = campo(b, 'MEMO');
    return {
      data: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
      valor: Math.round(Number(campo(b, 'TRNAMT').replace(',', '.')) * 100) / 100,
      operacao: memo || nome, detalhe: nome && memo ? nome : '', contraparte: nome && memo ? nome : '',
      idBanco: campo(b, 'FITID') || ''
    };
  }).filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.data) && !Number.isNaN(m.valor) && m.valor !== 0);
  const banco = /<ORG>([^<\r\n]*)/i.exec(texto)?.[1]?.trim() || 'banco';
  return { banco: 'ofx', rotulo: `${banco} (OFX)`, titular: '', cpfMeio: '', movimentos: comIds(`ofx-${normal(banco)}`, movimentos) };
}

/** Lê qualquer arquivo suportado. `linhas` para PDF; `texto` para CSV/OFX. */
export function lerExtrato({ linhas, texto }) {
  if (linhas) {
    const banco = detectarBanco(linhas);
    if (banco === 'nubank_conta') return lerNubankContaPdf(linhas);
    if (banco === 'itau_conta') return lerItauContaPdf(linhas);
    return null;
  }
  if (texto && /<OFX>|<STMTTRN>/i.test(texto)) return lerOfx(texto);
  if (texto) return lerCsv(texto);
  return null;
}

// --- O que cada movimento vira -------------------------------------------------

const LIGACOES = ['de', 'da', 'do', 'das', 'dos', 'e'];
const SUFIXOS = /\b(ltda|s ?a|me|epp|eireli|cia|holding|unidade|ltda me)\b/g;

/** A palavra-chave para aprender: o nome sem sufixo de empresa, até 3 palavras ("elevar telecom"). */
export function palavraDoMovimento(m) {
  const base = normal(m.contraparte || m.operacao).replace(SUFIXOS, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  const p = base.split(' ').filter((w) => w.length > 1 && !LIGACOES.includes(w)).slice(0, 3).join(' ');
  return p.length >= 3 ? p : '';
}

/** "ELEVAR TELECOM LTDA" → "Elevar Telecom Ltda" (a descrição que vai para o app). */
export function descricaoDoMovimento(m) {
  const t = (m.contraparte || m.operacao || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return t.replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).slice(0, 80);
}

/** É dinheiro indo de uma conta sua para outra sua? (mesmo CPF, ou o nome do titular) */
export function ehDoTitular(m, titular, cpfMeio) {
  const txt = `${m.detalhe} ${m.contraparte} ${m.operacao}`;
  if (cpfMeio && txt.replace(/\s/g, '').includes(cpfMeio)) return true;
  const nomes = normal(titular).split(' ').filter(Boolean);
  if (!nomes.length) return false;
  const lado = normal(m.contraparte || '');
  if (nomes.length >= 2 && lado.startsWith(`${nomes[0]} ${nomes[1]}`)) return true;
  // Itaú corta o nome: "PIX TRANSF FERNAND20/10"
  const corte = /pix transf ([a-z ]+)$/.exec(normal(m.operacao));
  return Boolean(corte && corte[1].trim().length >= 5 && nomes.join(' ').startsWith(corte[1].trim()));
}

/**
 * O que o movimento vira: despesa, receita, guardar/resgatar (baú) ou "fora"
 * (pagamento de fatura, transferência entre as suas contas — não é gasto).
 * Devolve { tipo, categoria, motivo, descricao, palavra }.
 */
export function classificar(m, ctx = {}) {
  const op = normal(m.operacao);
  const descricao = descricaoDoMovimento(m);
  const palavra = palavraDoMovimento(m);
  const base = { descricao, palavra, categoria: '', motivo: '' };
  if (/aplicacao rdb|aplicacao (em|na) caixinha|guardad. na caixinha|deposito (em|na) caixinha/.test(op)) {
    return { ...base, tipo: 'guardar', descricao: 'Guardado na caixinha', motivo: 'caixinha do banco: vai como guardar no baú' };
  }
  if (/resgate rdb|resgate (da|de) caixinha/.test(op)) {
    return { ...base, tipo: 'resgatar', descricao: 'Resgate da caixinha', motivo: 'caixinha do banco: vai como resgatar do baú' };
  }
  if (/pagamento (de |da )?fatura|pagamento recebido/.test(op)) {
    return { ...base, tipo: 'fora', motivo: 'pagamento de fatura: as compras já contam' };
  }
  if (ehDoTitular(m, ctx.titular, ctx.cpfMeio)) {
    return { ...base, tipo: 'fora', descricao: 'Transferência entre contas', motivo: 'transferência entre as suas contas: fica fora do gasto' };
  }
  // Pix para alguém da casa (as pessoas do cadastro): o dinheiro não saiu da casa.
  const lado = normal(m.contraparte);
  const daCasa = (ctx.pessoas || []).find((p) => {
    const n = normal(p.nome).split(' ')[0];
    return n.length >= 3 && lado.split(' ')[0] === n && !normal(ctx.titular).startsWith(n);
  });
  if (daCasa && /transfer|pix/.test(op)) {
    return { ...base, tipo: 'fora', descricao: `Transferência para ${daCasa.nome}`, motivo: `transferência para ${daCasa.nome}: o dinheiro continua na casa` };
  }
  const tipo = m.valor < 0 ? 'despesa' : 'receita';
  const texto = `${m.contraparte} ${m.operacao}`;
  let categoria = sugerirCategoria(texto, ctx.categorias || [], tipo);
  if (!categoria && tipo === 'receita') {
    if (/remuneracao|salario/.test(op)) categoria = 'Salário';
    else if (/rend pago|rendimento/.test(op)) categoria = 'Rendimento';
    else if (/estorno|reembolso/.test(op)) categoria = 'Reembolso';
  }
  // só sugere categoria que existe no cadastro (com a grafia de lá)
  const achada = (ctx.categorias || []).find((c) => normal(c.categoria) === normal(categoria));
  return { ...base, tipo, categoria: achada ? achada.categoria : (ctx.categorias?.length ? '' : categoria) };
}

/** O baú que recebe o "guardar" da caixinha: o que rende, ou o primeiro. */
export function bauPadrao(baus = []) {
  const ativos = baus.filter((b) => !b.sem_cadastro);
  return (ativos.find((b) => b.rende?.tipo) || ativos.find((b) => /caixinha/i.test(b.nome)) || ativos[0])?.nome || '';
}
