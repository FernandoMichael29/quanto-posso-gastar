import { useCallback, useEffect, useState } from 'react';
import Esqueleto from '../../componentes/Esqueleto.jsx';
import { api, configurado } from '../../lib/api.js';
import { hojeISO, maiuscula, mesDeHoje, mesPorExtenso, somarMes } from '../../lib/datas.js';
import AbaResumo from './AbaResumo.jsx';
import AbaContas from './AbaContas.jsx';
import AbaLancamentos from './AbaLancamentos.jsx';
import { ConfirmarRenda, EditarLancamento, PagarFatura, PagarFixa, TornarMensal } from './Modais.jsx';
import { dataDoVencimento, fixasDoPainel, traduzir } from './util.js';

// A tela Mês: carrega o painel e os lançamentos, guarda qual janela está
// aberta e salva. O desenho de cada aba mora no arquivo dela.

const CHAVE_VISTA = 'qpg.mes.vista';
const VISTAS = [
  { id: 'resumo', rotulo: 'Resumo' },
  { id: 'contas', rotulo: 'Contas' },
  { id: 'lancamentos', rotulo: 'Lançamentos' }
];

export default function Mes({ cadastros, aoMudarDados }) {
  const [mes, setMes] = useState(mesDeHoje);
  const [painel, setPainel] = useState(null);
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  // Qual linha da tela está esperando a planilha responder ('lanc:<uuid>',
  // 'fixa:<nome>', 'fatura:<cartão>'). É o que põe a máscara em cima dela.
  const [ocupado, setOcupado] = useState(null);
  const [aprendido, setAprendido] = useState(null);
  // A aba lembrada neste aparelho: quem sempre abre em Contas não precisa tocar de novo.
  const [vista, setVista] = useState(() => {
    try { return localStorage.getItem(CHAVE_VISTA) || 'resumo'; } catch { return 'resumo'; }
  });

  // Janelas abertas — no máximo uma de cada, com o rascunho dentro.
  const [editando, setEditando] = useState(null);
  const [virandoMensal, setVirandoMensal] = useState(null);
  const [pagandoFixa, setPagandoFixa] = useState(null);
  const [pagandoFatura, setPagandoFatura] = useState(null);
  const [confirmandoRenda, setConfirmandoRenda] = useState(null);

  useEffect(() => { setAprendido(null); }, [mes]);
  useEffect(() => { try { localStorage.setItem(CHAVE_VISTA, vista); } catch { /* sem armazenamento, só não lembra */ } }, [vista]);

  const carregar = useCallback(async (alvo) => {
    if (!configurado()) { setErro('Configure o app nos Ajustes primeiro.'); return; }
    setCarregando(true);
    setErro(null);
    const [p, l] = await Promise.all([api.painel(alvo), api.lancamentos(alvo)]);
    setCarregando(false);
    if (p.ok) setPainel(p); else setErro(traduzir(p.erro));
    setLista(l.ok ? l.lancamentos : []);
  }, []);

  useEffect(() => { carregar(mes); }, [mes, carregar]);

  /**
   * Toda gravação é igual: trava os botões, chama, e se deu certo fecha a
   * janela e recarrega. A janela fecha antes da planilha responder, então a
   * linha mexida fica marcada como ocupada até o dado novo chegar — senão a
   * tela mostra o valor velho e parece que não salvou.
   */
  async function salvar(id, chamada, aoDarCerto) {
    setSalvando(true);
    setOcupado(id);
    const r = await chamada;
    setSalvando(false);
    if (!r.ok) { setErro(traduzir(r.erro)); setOcupado(null); return; }
    aoDarCerto(r);
    await carregar(mes);
    setOcupado(null);
    aoMudarDados?.();
  }

  function abrirLancamento(uuid) {
    const l = lista.find((x) => x.uuid === uuid);
    if (l) setEditando({ ...l });
  }

  /** Tocar num compromisso: já feito abre o lançamento; agendado pergunta se caiu. */
  function abrirCompromisso(f) {
    if (f.lancado) { abrirLancamento(f.uuid_lancamento); return; }
    // Já existe uma linha marcada para a frente: confirmar é promover aquela,
    // nunca criar outra — senão o mesmo salário entraria duas vezes.
    // O valor entra editável no rascunho: o que cai nem sempre é o combinado.
    if (f.uuid_agendado) { setConfirmandoRenda({ ...f, valor: f.valor_agendado ?? f.valor }); return; }
    const receita = f.tipo === 'receita';
    setPagandoFixa({
      nome: f.nome,
      receita,
      valorCombinado: f.valor,
      dia: f.dia,
      ajuste: 'excecao',
      lancamento: {
        tipo: receita ? 'receita' : 'despesa',
        valor: f.valor,
        categoria: f.categoria || '',
        descricao: f.nome,
        data: dataDoVencimento(mes, f.dia),
        conta: f.conta || '',
        metodo: f.metodo || '',
        pessoa: f.pessoa || ''
      }
    });
  }

  function abrirFatura(f) {
    if (f.pago) { abrirLancamento(f.uuid_pagamento); return; }
    setPagandoFatura({ cartao: f.cartao, valor: f.total, conta: '', data: dataDoVencimento(mes, f.dia) });
  }

  const temAtrasada = fixasDoPainel(painel).some((f) => f.situacao === 'erro');
  const pessoas = (cadastros.pessoas || []).filter((p) => p.ativo !== false);

  return (
    <>
      <SeletorMes mes={mes} aoMudar={setMes} />

      {/* Três perguntas, três abas: quanto sobra, o que ainda vence, o que aconteceu. */}
      <div className="abas vistas" role="tablist" aria-label="O que ver do mês">
        {VISTAS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={vista === v.id}
            className={vista === v.id ? 'ativa' : ''}
            onClick={() => setVista(v.id)}
          >
            {v.rotulo}
            {v.id === 'contas' && temAtrasada && <span className="marca-aba" aria-label="há conta vencida" />}
          </button>
        ))}
      </div>

      {erro && (
        <div className="aviso ruim" role="alert">
          <strong>Não consegui carregar</strong>
          <span className="detalhe">{erro}</span>
        </div>
      )}

      {aprendido && (
        <div className="aviso bom" role="status">
          <strong>Aprendi: “{aprendido.palavra}” agora é {aprendido.categoria}</strong>
          <span className="detalhe">Da próxima vez que você falar isso, já vem certo. Errei? Apague a palavra na aba categorias da planilha.</span>
        </div>
      )}

      {!painel && carregando && <Esqueleto />}

      {painel && vista === 'resumo' && <AbaResumo painel={painel} />}

      {painel && vista === 'contas' && (
        <AbaContas
          painel={painel}
          ocupado={ocupado}
          aoAbrirCompromisso={abrirCompromisso}
          aoAbrirFatura={abrirFatura}
          aoAbrirLancamento={abrirLancamento}
        />
      )}

      {vista === 'lancamentos' && (
        <AbaLancamentos
          key={mes}
          lista={lista}
          pessoas={pessoas}
          carregando={carregando && lista.length === 0}
          ocupado={ocupado}
          aoAbrir={(l) => setEditando({ ...l })}
        />
      )}

      {confirmandoRenda && (
        <ConfirmarRenda
          item={confirmandoRenda}
          previsto={confirmandoRenda.valor_agendado ?? confirmandoRenda.valor}
          ocupado={salvando}
          aoMudar={setConfirmandoRenda}
          aoFechar={() => setConfirmandoRenda(null)}
          aoConfirmar={() => salvar(
            `fixa:${confirmandoRenda.nome}`,
            api.confirmarRecebimento(confirmandoRenda.uuid_agendado, {
              data: hojeISO(),
              valor: Number(confirmandoRenda.valor) || 0
            }),
            () => setConfirmandoRenda(null)
          )}
        />
      )}

      {editando && (
        <EditarLancamento
          lancamento={editando}
          cadastros={cadastros}
          ocupado={salvando}
          aoMudar={setEditando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            const { uuid, ...campos } = editando;
            salvar(`lanc:${uuid}`, api.editarLancamento(uuid, campos), (r) => { setEditando(null); setAprendido(r.aprendido || null); });
          }}
          aoExcluir={() => salvar(`lanc:${editando.uuid}`, api.excluirLancamento(editando.uuid), () => setEditando(null))}
          aoTornarMensal={() => setVirandoMensal({
            uuid: editando.uuid,
            receita: editando.tipo === 'receita',
            nome: editando.descricao || editando.categoria || '',
            dia: Number(String(editando.data).slice(8, 10)) || '',
            mes_fim: ''
          })}
        />
      )}

      {pagandoFatura && (
        <PagarFatura
          fatura={pagandoFatura}
          contas={cadastros.contas}
          ocupado={salvando}
          aoMudar={setPagandoFatura}
          aoFechar={() => setPagandoFatura(null)}
          aoConfirmar={() => salvar(
            `fatura:${pagandoFatura.cartao}`,
            api.pagarFatura(pagandoFatura.cartao, mes, {
              valor: Number(pagandoFatura.valor) || 0,
              conta: pagandoFatura.conta,
              data: pagandoFatura.data
            }),
            () => setPagandoFatura(null)
          )}
        />
      )}

      {pagandoFixa && (
        <PagarFixa
          fixa={pagandoFixa}
          cadastros={cadastros}
          ocupado={salvando}
          aoMudar={setPagandoFixa}
          aoFechar={() => setPagandoFixa(null)}
          aoConfirmar={() => salvar(
            `fixa:${pagandoFixa.nome}`,
            api.pagarFixa(pagandoFixa.nome, mes, { ...pagandoFixa.lancamento, dia: pagandoFixa.dia, ajuste: pagandoFixa.ajuste }),
            () => setPagandoFixa(null)
          )}
        />
      )}

      {virandoMensal && (
        <TornarMensal
          regra={virandoMensal}
          ocupado={salvando}
          aoMudar={setVirandoMensal}
          aoFechar={() => setVirandoMensal(null)}
          aoConfirmar={() => salvar(
            `lanc:${virandoMensal.uuid}`,
            api.tornarMensal(virandoMensal.uuid, {
              nome: virandoMensal.nome,
              dia: virandoMensal.dia,
              mes_fim: virandoMensal.mes_fim || ''
            }),
            () => { setVirandoMensal(null); setEditando(null); }
          )}
        />
      )}
    </>
  );
}

function SeletorMes({ mes, aoMudar }) {
  const hoje = mesDeHoje();
  return (
    <div className="seletor-mes">
      <button type="button" onClick={() => aoMudar(somarMes(mes, -1))} aria-label="Mês anterior">‹</button>
      <div className="seletor-centro">
        <strong>{maiuscula(mesPorExtenso(mes))}</strong>
        {mes !== hoje && (
          <button type="button" className="btn discreto pequeno" onClick={() => aoMudar(hoje)}>
            voltar para hoje
          </button>
        )}
      </div>
      <button type="button" onClick={() => aoMudar(somarMes(mes, 1))} disabled={mes >= hoje} aria-label="Próximo mês">›</button>
    </div>
  );
}
