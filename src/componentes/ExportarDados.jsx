import { useState } from 'react';
import { api } from '../lib/api.js';

// "Levar meus dados para outra IA": a planilha monta um CSV com tudo (ver
// exportar_ no Codigo.gs) e aqui ele vira um arquivo para baixar — ou para
// mandar direto pelo compartilhar do celular — junto com uma pergunta pronta.

const ERROS = {
  sem_rede: 'Sem internet agora. O arquivo é montado na planilha — tente de novo quando voltar.',
  acao_desconhecida: 'O script da planilha está atrasado: cole o Codigo.gs novo e implante em Nova versão.'
};

function arquivoDe(nome, csv) {
  // O BOM faz o Excel abrir com acento certo.
  return new File(['﻿' + csv], nome, { type: 'text/csv;charset=utf-8' });
}

function baixar(arquivo) {
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement('a');
  a.href = url;
  a.download = arquivo.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function podeCompartilhar(arquivo) {
  try { return Boolean(navigator.canShare && navigator.canShare({ files: [arquivo] })); } catch { return false; }
}

export default function ExportarDados() {
  const [estado, setEstado] = useState('parado');   // parado → montando → pronto
  const [erro, setErro] = useState(null);
  const [pronto, setPronto] = useState(null);       // { arquivo, pergunta, lancamentos }
  const [copiado, setCopiado] = useState(false);

  async function montar() {
    setEstado('montando'); setErro(null); setCopiado(false);
    const r = await api.exportar();
    if (!r?.ok || !r.csv) {
      setEstado('parado');
      setErro(ERROS[r?.erro] || 'Não consegui montar o arquivo. Tente de novo.');
      return;
    }
    const arquivo = arquivoDe(r.nome || 'quanto-posso-gastar.csv', r.csv);
    setPronto({ arquivo, pergunta: r.pergunta || '', lancamentos: r.lancamentos || 0 });
    setEstado('pronto');
    baixar(arquivo);
  }

  async function compartilhar() {
    try {
      await navigator.share({ files: [pronto.arquivo], title: 'Minhas finanças', text: pronto.pergunta });
    } catch { /* fechou o compartilhar: tudo bem */ }
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(pronto.pergunta); setCopiado(true); } catch { setCopiado(false); }
  }

  return (
    <div className="cartao exportar">
      <p className="secao-titulo" style={{ margin: 0 }}>Levar meus dados para outra IA</p>
      <p className="ajuda" style={{ margin: 0 }}>
        Baixa um arquivo CSV com tudo: o mês de hoje e quanto está livre, a previsão de 12 meses, os meses
        anteriores, gastos por categoria, contas fixas, parcelas, faturas, saldos, baús e todos os lançamentos.
        É só anexar no ChatGPT, Gemini, Claude… e perguntar.
      </p>
      <button type="button" className="btn-px" onClick={montar} disabled={estado === 'montando'}>
        {estado === 'montando' ? 'MONTANDO O ARQUIVO…' : estado === 'pronto' ? '⇩ BAIXAR DE NOVO' : '⇩ BAIXAR MEUS DADOS (CSV)'}
      </button>
      {erro && <p className="ajuda ruim" role="alert" style={{ margin: 0 }}>{erro}</p>}
      {estado === 'pronto' && pronto && (
        <div className="exportar-pronto" role="status">
          <p style={{ margin: 0 }}>
            <b>{pronto.arquivo.name}</b> · {pronto.lancamentos} lançamentos. Se o download não começou, use o compartilhar.
          </p>
          {podeCompartilhar(pronto.arquivo) && (
            <button type="button" className="btn" onClick={compartilhar}>Compartilhar o arquivo</button>
          )}
          <p className="rotulo-px" style={{ margin: 0 }}>PERGUNTA PRONTA PARA COLAR</p>
          <p className="pergunta-pronta">{pronto.pergunta}</p>
          <button type="button" className="btn discreto" onClick={copiar}>{copiado ? '✓ Copiada' : 'Copiar a pergunta'}</button>
        </div>
      )}
    </div>
  );
}
