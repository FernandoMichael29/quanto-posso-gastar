import { useEffect, useRef, useState } from 'react';
import { interpretar, soNumero, chaveAprendivel } from '../lib/parser.js';
import { hojeISO, diaOuHoje } from '../lib/datas.js';
import { escutar, ERRO_VOZ, temReconhecimento } from '../lib/voz.js';
import { enfileirar, ESTADO, novoId, remover } from '../lib/db.js';
import { api, configurado } from '../lib/api.js';
import { sincronizar } from '../lib/sync.js';
import CartaoLancamento from '../componentes/CartaoLancamento.jsx';
import { ativos } from '../lib/cadastros.js';

const IconeMic = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21" />
  </svg>
);

export default function Falar({ cadastros, resumo, aoMudarFila, aoIrParaFila }) {
  // Categoria desativada não é mais sugerida pelas regras locais.
  const categorias = ativos(cadastros.categorias);
  const [ouvindo, setOuvindo] = useState(false);
  const [texto, setTexto] = useState('');
  const [rascunho, setRascunho] = useState(null);
  const [novo, setNovo] = useState(null);
  const [esperandoIA, setEsperandoIA] = useState(false);
  const [recado, setRecado] = useState(null);
  const sessao = useRef(null);

  useEffect(() => () => sessao.current?.cancelar(), []);

  // O botão Desfazer vive 10 s; depois disso o recado fica, só sem o botão.
  useEffect(() => {
    if (!recado?.desfazer) return;
    const t = setTimeout(() => setRecado((r) => (r ? { ...r, desfazer: null } : r)), 10000);
    return () => clearTimeout(t);
  }, [recado?.desfazer]);

  function comecar() {
    setRecado(null);
    setRascunho(null);
    setTexto('');

    if (!navigator.onLine || !temReconhecimento()) {
      setRecado({
        tom: 'atencao',
        titulo: 'Sem internet para reconhecer a voz',
        detalhe: 'Use "Adicionar à mão" — o microfone do seu teclado funciona offline dentro do formulário.'
      });
      return;
    }

    setOuvindo(true);
    sessao.current = escutar({
      aoTexto: (t) => setTexto(t),
      aoFim: (t) => { setOuvindo(false); if (t) processar(t); },
      aoErro: (codigo) => {
        setOuvindo(false);
        setRecado({ tom: 'atencao', titulo: ERRO_VOZ[codigo] || 'Não consegui ouvir' });
      }
    });
  }

  function parar() {
    sessao.current?.parar();
    setOuvindo(false);
  }

  /** Interpreta a frase: primeiro as regras locais, depois a IA se precisar. */
  async function processar(frase) {
    setTexto(frase);
    const r = interpretar(frase, { categorias });

    if (r.lancamento) {
      setRascunho({ ...r.lancamento, categoria_sugerida: r.lancamento.categoria, confianca: r.confianca, motivo: r.motivo });
      return;
    }

    // Regras locais não deram conta. Precisa da IA.
    if (!configurado()) {
      await guardarParaDepois(frase, 'sem_configuracao');
      return;
    }
    if (!navigator.onLine) {
      await guardarParaDepois(frase, 'sem_rede');
      return;
    }

    setEsperandoIA(true);
    const uuid = novoId();
    const resposta = await api.interpretar(frase, uuid);
    setEsperandoIA(false);

    if (resposta.ok && resposta.lancamentos?.length) {
      const [primeiro, ...extras] = resposta.lancamentos;
      setRascunho({
        ...primeiro,
        categoria_sugerida: primeiro.categoria,
        texto_falado: frase,
        confianca: 'ia',
        motivo: 'interpretado pela IA',
        extras
      });
      return;
    }

    await guardarParaDepois(frase, resposta.erro || 'nada_entendido', uuid);
  }

  /** Nada se perde: a frase entra na fila com o motivo. */
  async function guardarParaDepois(frase, motivo, uuid) {
    await enfileirar({
      uuid: uuid || novoId(),
      estado: ESTADO.AGUARDANDO_IA,
      motivo,
      texto: frase,
      lancamento: null
    });
    aoMudarFila?.();
    setTexto('');
    setRecado({
      tom: 'atencao',
      fila: true,
      titulo: 'Guardei sua frase na fila',
      detalhe: MOTIVO_TELA[motivo] || 'Vou interpretar assim que der e você não precisa fazer nada.'
    });
  }

  /** Um lançamento em branco, com o que dá para presumir sem chutar. */
  function comecarNovo() {
    setRecado(null);
    setRascunho(null);
    setNovo({
      tipo: 'despesa',
      valor: '',
      categoria: '',
      descricao: '',
      data: hojeISO(),
      conta: '',
      pessoa: ''
    });
  }

  async function salvarNovo() {
    const { motivo, ...limpo } = novo;
    const uuid = novoId();
    await enfileirar({
      uuid,
      estado: ESTADO.PENDENTE,
      texto: '',
      lancamento: { ...limpo, valor: Number(limpo.valor) || 0, origem: 'manual' }
    });
    setNovo(null);
    aoMudarFila?.();
    setRecado({ tom: 'bom', titulo: 'Guardado', desfazer: [uuid] });
    sincronizar().then(() => aoMudarFila?.());
  }

  async function confirmar() {
    const lista = [rascunho, ...(rascunho.extras || [])];
    let aprendeu = null;
    const uuids = [];
    for (const l of lista) {
      const { extras, motivo, categoria_sugerida, ...limpo } = l;
      // Só o primeiro tem sugestão guardada; os extras vêm da IA sem você mexer.
      const corrigiu = categoria_sugerida !== undefined && limpo.categoria && limpo.categoria !== categoria_sugerida;
      if (corrigiu && chaveAprendivel(limpo.descricao)) {
        aprendeu = { palavra: chaveAprendivel(limpo.descricao), categoria: limpo.categoria };
      }
      const uuid = novoId();
      uuids.push(uuid);
      await enfileirar({
        uuid,
        estado: ESTADO.PENDENTE,
        texto: rascunho.texto_falado || texto,
        lancamento: { ...limpo, aprender_categoria: Boolean(corrigiu), texto_falado: rascunho.texto_falado || texto }
      });
    }
    setRascunho(null);
    setTexto('');
    aoMudarFila?.();
    setRecado({
      tom: 'bom',
      titulo: `${lista.length > 1 ? lista.length + ' lançamentos guardados' : 'Guardado'}`,
      detalhe: aprendeu ? `Aprendi: “${aprendeu.palavra}” agora é ${aprendeu.categoria}.` : undefined,
      desfazer: uuids
    });
    sincronizar().then(() => aoMudarFila?.());
  }

  /**
   * Apaga da fila e da planilha. O envio começa logo depois de guardar, então
   * o lançamento pode estar em qualquer um dos dois lados — ou no meio do caminho.
   */
  async function desfazer(uuids) {
    setRecado({ tom: 'bom', titulo: 'Desfazendo…' });
    for (const u of uuids) await remover(u);
    aoMudarFila?.();

    // Sem internet nada saiu do aparelho: tirar da fila basta.
    if (!navigator.onLine || !configurado()) {
      setRecado({ tom: 'bom', titulo: 'Desfeito' });
      return;
    }

    let falhou = false;
    for (const u of uuids) {
      let r = await api.excluirLancamento(u);
      // ponytail: "não encontrado" pode ser envio ainda em trânsito; duas novas
      // tentativas (3 s e 8 s) cobrem o envio normal. Envio mais lento que isso
      // grava a linha — o recado de erro só aparece se a planilha recusar.
      for (const espera of [3000, 5000]) {
        if (r.ok || r.erro !== 'nao_encontrado') break;
        await new Promise((ok) => setTimeout(ok, espera));
        r = await api.excluirLancamento(u);
      }
      if (!r.ok && r.erro !== 'nao_encontrado') falhou = true;
    }

    aoMudarFila?.();
    setRecado(falhou
      ? { tom: 'ruim', titulo: 'Não consegui desfazer', detalhe: 'Apague em Mês › Lançamentos.' }
      : { tom: 'bom', titulo: 'Desfeito' });
  }

  return (
    <>
      {recado && (
        recado.fila && aoIrParaFila ? (
          <button type="button" className={`aviso ${recado.tom} clicavel`} onClick={aoIrParaFila}>
            <strong>{recado.titulo}</strong>
            {recado.detalhe && <span className="detalhe">{recado.detalhe}</span>}
            <span className="detalhe ver-fila">Toque para ver a fila ›</span>
          </button>
        ) : (
          <div className={`aviso ${recado.tom} ${recado.desfazer ? 'com-acao' : ''}`} role="status">
            <div className="aviso-texto">
              <strong>{recado.titulo}</strong>
              {recado.detalhe && <span className="detalhe">{recado.detalhe}</span>}
            </div>
            {recado.desfazer && (
              <button type="button" className="btn discreto pequeno desfazer" onClick={() => desfazer(recado.desfazer)}>
                Desfazer
              </button>
            )}
          </div>
        )
      )}

      {!rascunho && !novo && (
        <div className="captura">
          <div className="mic-area">
            <button
              className={`mic ${ouvindo ? 'ouvindo' : ''}`}
              onClick={ouvindo ? parar : comecar}
              disabled={esperandoIA}
              aria-label={ouvindo ? 'Parar de escutar' : 'Falar um lançamento'}
            >
              <IconeMic />
            </button>
          </div>

          <div className="transcricao">
            {esperandoIA
              ? <span className="parcial">Pensando…</span>
              : texto || <span className="parcial">{ouvindo ? 'Pode falar…' : 'Toque e fale o gasto'}</span>}
          </div>

          {!ouvindo && !texto && (
            <p className="dica">Exemplos: &ldquo;mercado 120 reais&rdquo;, &ldquo;recebi meu salário de 3000&rdquo;, &ldquo;fone em 10x de 89,90&rdquo;</p>
          )}

          {/* A saída para quando falar não serve: sem internet, com barulho, ou
              quando é mais rápido preencher do que explicar. */}
          <button type="button" className="btn adicionar" onClick={comecarNovo} disabled={esperandoIA}>
            + Adicionar à mão
          </button>
        </div>
      )}

      {novo && (
        <CartaoLancamento
          valor={novo}
          aoMudar={setNovo}
          cadastros={cadastros}
          modo="novo"
          aoConfirmar={salvarNovo}
          aoCancelar={() => setNovo(null)}
          rotuloCancelar="Cancelar"
        />
      )}

      {rascunho && (
        <CartaoLancamento
          valor={rascunho}
          aoMudar={setRascunho}
          cadastros={cadastros}
          modo="confirmar"
          aoConfirmar={confirmar}
          aoCancelar={() => { setRascunho(null); setTexto(''); }}
        />
      )}

      {/* Formulário aberto: o resto sai de cena para ele ter a tela toda. */}
      {resumo && !rascunho && !novo && (
        <>
          <p className="secao-titulo">Este mês</p>
          <div className="resumo">
            <div><span className="r">Recebi</span><span className="v pos">{soNumero(resumo.receitas)}</span></div>
            <div><span className="r">Gastei</span><span className="v">{soNumero(resumo.despesas)}</span></div>
            <div><span className="r">Sobrou</span><span className={`v ${resumo.saldo >= 0 ? 'pos' : 'neg'}`}>{soNumero(resumo.saldo)}</span></div>
          </div>
        </>
      )}

      {resumo?.ultimos?.length > 0 && !rascunho && !novo && (
        <>
          <p className="secao-titulo">Últimos lançamentos</p>
          <div className="lista">
            {resumo.ultimos.slice(0, 8).map((l) => (
              <div className="item" key={l.uuid}>
                <div className="corpo">
                  <span className="titulo">{l.descricao || l.categoria}</span>
                  <span className="meta">{l.categoria} · {diaOuHoje(l.data)}</span>
                </div>
                <span className={`num ${l.tipo === 'receita' ? 'receita' : ''}`}>
                  {l.tipo === 'receita' ? '+' : '−'}{soNumero(l.valor)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

const MOTIVO_TELA = {
  sem_creditos: 'Os créditos da API acabaram. Assim que você recarregar, interpreto sozinho — sua frase está guardada.',
  chave_invalida: 'A chave da API foi recusada. Confira nos Ajustes do script.',
  sem_chave: 'A chave da API ainda não foi configurada no script.',
  sem_rede: 'Sem internet agora. Envio assim que voltar.',
  sem_configuracao: 'Configure o endereço e o token nos Ajustes para eu conseguir enviar.',
  api_fora: 'A IA está fora do ar. Tento de novo sozinho.',
  limite_taxa: 'Muitas chamadas seguidas. Tento de novo daqui a pouco.',
  nada_entendido: 'Não achei um valor na frase. Dá uma olhada na fila e corrija se quiser.',
  teto_diario: 'Bateu o teto diário de interpretações por IA. Sua frase está guardada e é interpretada amanhã sozinha.'
};
