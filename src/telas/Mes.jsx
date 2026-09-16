import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Barras from '../componentes/Barras.jsx';
import GraficoEvolucao from '../componentes/GraficoEvolucao.jsx';
import CartaoLancamento from '../componentes/CartaoLancamento.jsx';
import Compromissos from '../componentes/Compromissos.jsx';
import Sanfona from '../componentes/Sanfona.jsx';
import { api, configurado } from '../lib/api.js';
import { formatarBRL, semAcento } from '../lib/parser.js';

const CORTES = [
  { id: 'categoria', rotulo: 'Categoria', campo: 'por_categoria' },
  { id: 'conta', rotulo: 'Conta', campo: 'por_conta' },
  { id: 'pessoa', rotulo: 'Pessoa', campo: 'por_pessoa' },
  { id: 'grupo', rotulo: 'Grupo', campo: 'por_grupo' }
];

export default function Mes({ cadastros, aoMudarDados }) {
  const [mes, setMes] = useState(() => mesDeHoje());
  const [painel, setPainel] = useState(null);
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [corte, setCorte] = useState('categoria');
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [filtroPessoa, setFiltroPessoa] = useState('');
  const [virandoMensal, setVirandoMensal] = useState(null);
  const [pagandoFixa, setPagandoFixa] = useState(null);
  const [pagandoFatura, setPagandoFatura] = useState(null);
  const [confirmandoRenda, setConfirmandoRenda] = useState(null);
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const listaTopo = useRef(null);

  // Mudou o mês, a busca ou o filtro de pessoa: a página 4 do resultado antigo
  // não quer dizer nada no novo.
  useEffect(() => { setPagina(1); }, [mes, busca, filtroPessoa]);

  const carregar = useCallback(async (alvo) => {
    if (!configurado()) { setErro('Configure o app nos Ajustes primeiro.'); return; }
    setCarregando(true);
    setErro(null);

    const [p, l] = await Promise.all([api.painel(alvo), api.lancamentos(alvo)]);
    setCarregando(false);

    if (p.ok) setPainel(p); else setErro(traduzir(p.erro));
    if (l.ok) setLista(l.lancamentos); else setLista([]);
  }, []);

  useEffect(() => { carregar(mes); }, [mes, carregar]);

  async function salvarEdicao() {
    setSalvando(true);
    const { uuid, ...campos } = editando;
    const r = await api.editarLancamento(uuid, campos);
    setSalvando(false);
    if (r.ok) { setEditando(null); carregar(mes); aoMudarDados?.(); }
    else setErro(traduzir(r.erro));
  }

  async function confirmarMensal() {
    setSalvando(true);
    const r = await api.tornarMensal(virandoMensal.uuid, {
      nome: virandoMensal.nome,
      dia: virandoMensal.dia,
      mes_fim: virandoMensal.mes_fim || ''
    });
    setSalvando(false);
    if (r.ok) {
      setVirandoMensal(null);
      setEditando(null);
      carregar(mes);
      aoMudarDados?.();
    } else setErro(traduzir(r.erro));
  }

  async function confirmarAgendado(item) {
    setSalvando(true);
    const r = await api.confirmarRecebimento(item.uuid_agendado, { data: hojeISO() });
    setSalvando(false);
    if (r.ok) { setConfirmandoRenda(null); carregar(mes); aoMudarDados?.(); }
    else setErro(traduzir(r.erro));
  }

  /** Tocar num compromisso: já feito abre o lançamento; agendado pergunta se caiu. */
  function abrirFixa(f) {
    if (f.lancado) {
      const lancamento = lista.find((l) => l.uuid === f.uuid_lancamento);
      if (lancamento) setEditando({ ...lancamento });
      return;
    }
    // Já existe uma linha marcada para a frente: confirmar é promover aquela,
    // nunca criar outra — senão o mesmo salário entraria duas vezes.
    if (f.uuid_agendado) { setConfirmandoRenda(f); return; }
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

  async function confirmarPagamento() {
    const { nome, ajuste, lancamento } = pagandoFixa;
    setSalvando(true);
    const r = await api.pagarFixa(nome, mes, { ...lancamento, dia: pagandoFixa.dia, ajuste });
    setSalvando(false);
    if (r.ok) { setPagandoFixa(null); carregar(mes); aoMudarDados?.(); }
    else setErro(traduzir(r.erro));
  }

  function abrirFatura(f) {
    if (f.pago) {
      const l = lista.find((x) => x.uuid === f.uuid_pagamento);
      if (l) setEditando({ ...l });
      return;
    }
    setPagandoFatura({
      cartao: f.cartao,
      valor: f.total,
      conta: '',
      data: hojeOuVencimento(mes, f.dia)
    });
  }

  async function confirmarFatura() {
    setSalvando(true);
    const r = await api.pagarFatura(pagandoFatura.cartao, mes, {
      valor: Number(pagandoFatura.valor) || 0,
      conta: pagandoFatura.conta,
      data: pagandoFatura.data
    });
    setSalvando(false);
    if (r.ok) { setPagandoFatura(null); carregar(mes); aoMudarDados?.(); }
    else setErro(traduzir(r.erro));
  }

  async function excluirEdicao() {
    setSalvando(true);
    const r = await api.excluirLancamento(editando.uuid);
    setSalvando(false);
    if (r.ok) { setEditando(null); carregar(mes); aoMudarDados?.(); }
    else setErro(traduzir(r.erro));
  }

  const pessoas = (cadastros.pessoas || []).filter((p) => p.ativo !== false);

  // Busca sem acento e sem caixa, em tudo que aparece na linha: quem procura
  // "oculos" espera achar "Óculos", e quem procura "nubank" espera achar pela
  // conta, não só pela descrição.
  const alvo = semAcento(busca.trim());
  const visiveis = lista.filter((l) => {
    if (filtroPessoa && l.pessoa !== filtroPessoa) return false;
    if (!alvo) return true;
    return semAcento(
      [l.descricao, l.categoria, l.conta, l.pessoa, l.metodo, l.texto_falado].filter(Boolean).join(' ')
    ).includes(alvo);
  });

  const totalPaginas = Math.max(1, Math.ceil(visiveis.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const daPagina = visiveis.slice(inicio, inicio + porPagina);
  const primeiroDaPagina = visiveis.length ? inicio + 1 : 0;
  const ultimoDaPagina = inicio + daPagina.length;

  function irPara(n) {
    const destino = Math.min(Math.max(1, n), totalPaginas);
    setPagina(destino);
    // Trocar de página sem voltar ao topo da lista deixa você no meio do nada.
    listaTopo.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const dadosCorte = painel?.[CORTES.find((c) => c.id === corte).campo] || [];

  // Uma conta fixa que não virou lançamento pode estar em dois estados muito
  // diferentes: ainda vai vencer, ou já venceu e ninguém registrou. Chamar as
  // duas de "previsto" escondia a segunda, que é justamente a que precisa de você.
  // O nome que aparece é o do lançamento quando ele já existe — é o que você
  // edita, e ver o nome antigo depois de corrigir parece que nada foi salvo.
  const comNome = (c) => ({ ...c, nome_visivel: c.nome_lancado || c.nome });

  const fixas = (painel?.fixas || []).map((f) => comNome({ ...f, ...situacaoDa(f, painel.mes) }));
  const rendas = (painel?.rendas || []).map((r) => {
    const base = { ...r, tipo: 'receita' };
    return comNome({ ...base, ...situacaoDa(base, painel.mes) });
  });

  // Renda marcada para uma data à frente que não pertence a regra nenhuma:
  // entra na lista como item a confirmar, senão ela só existiria no total.
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
  // A fatura só é conta a pagar depois que fecha. Antes disso ela ainda aceita
  // compras — vencer neste mês não quer dizer que já dá para pagar.
  const faturasAPagar = (painel?.faturas || []).filter((f) => !f.aberta);
  const fechando = (painel?.faturas || []).filter((f) => f.aberta)
    .concat(painel?.faturas_em_formacao || [])
    .sort((a, b) => (a.fecha_em || '').localeCompare(b.fecha_em || ''));
  const totalFechando = fechando.reduce((a, f) => a + f.total, 0);

  const atrasadas = resumirFixas(fixas.filter((f) => f.situacao === 'erro'));
  const aVencer = resumirFixas(fixas.filter((f) => f.situacao === 'pendente'));

  return (
    <>
      <SeletorMes mes={mes} aoMudar={setMes} />

      {erro && (
        <div className="aviso ruim" role="alert">
          <strong>Não consegui carregar</strong>
          <span className="detalhe">{erro}</span>
        </div>
      )}

      {painel && (
        <>
          <div className="resumo">
            <div><span className="r">Recebi</span><span className="v pos">{formatarBRL(painel.receitas)}</span></div>
            <div><span className="r">Gastei</span><span className="v">{formatarBRL(painel.despesas)}</span></div>
            <div>
              <span className="r">Sobrou</span>
              <span className={`v ${painel.saldo >= 0 ? 'pos' : 'neg'}`}>{formatarBRL(painel.saldo)}</span>
            </div>
          </div>

          {/* A pergunta do app: dá para comprar aquilo? O quadro acima é o que
              já aconteceu; este é o que o mês promete. Separados de propósito —
              misturar os dois é como um app de finanças começa a mentir. */}
          {painel.previsao && (painel.previsao.ainda_entra > 0 || painel.previsao.ainda_sai > 0) && (
            <div className="previsao">
              <div className="previsao-topo">
                <span className="r">Se tudo acontecer, sobra</span>
                <strong className={painel.previsao.sobra >= 0 ? 'pos' : 'neg'}>
                  {formatarBRL(painel.previsao.sobra)}
                </strong>
              </div>
              <div className="previsao-contas">
                <span>
                  sobrou até agora <strong>{formatarBRL(painel.previsao.ja_sobrou)}</strong>
                </span>
                {painel.previsao.ainda_entra > 0 && (
                  <span className="mais">
                    ainda entra <strong>{formatarBRL(painel.previsao.ainda_entra)}</strong>
                  </span>
                )}
                {painel.previsao.ainda_sai > 0 && (
                  <span className="menos">
                    ainda sai <strong>{formatarBRL(painel.previsao.ainda_sai)}</strong>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Gastar no crédito não é o mesmo que o dinheiro sair da conta.
              Sem esta linha, o "sobra" acima parece menos do que você tem. */}
          {(painel.no_credito > 0 || painel.saiu_caixa !== painel.despesas) && (
            <div className="faixa-caixa">
              <span>Já saiu da conta <strong>{formatarBRL(painel.saiu_caixa)}</strong></span>
              {painel.no_credito > 0 && (
                <span>Vai sair na fatura <strong>{formatarBRL(painel.no_credito)}</strong></span>
              )}
            </div>
          )}

          {/* Renda mensal vem antes das contas: é com ela que você paga o resto. */}
          <Compromissos
            titulo="Rendas do mês"
            resumo={painel.a_receber_total > 0
              ? `${formatarBRL(painel.a_receber_total)} a receber`
              : 'tudo recebido'}
            itens={rendas.concat(soltos)}
            aoAbrir={abrirFixa}
            rotuloFeitos={{ um: 'já recebida', varios: 'já recebidas' }}
          />

          {fixas.length > 0 && (
            <>
              <Compromissos
                titulo="Contas fixas do mês"
                resumo={`${formatarBRL(painel.fixas_total)} no total`}
                itens={fixas}
                aoAbrir={abrirFixa}
                rotuloFeitos={{ um: 'já lançada', varios: 'já lançadas' }}
              />

              {atrasadas.total > 0 && (
                <div className="aviso ruim">
                  <strong>Venceu e não foi lançado: {formatarBRL(atrasadas.total)}</strong>
                  <span className="detalhe">
                    {atrasadas.nomes.join(' · ')} — se já pagou, toque na conta para registrar.
                  </span>
                </div>
              )}

              {aVencer.total > 0 && (
                <div className="aviso atencao">
                  <strong>Ainda vai vencer: {formatarBRL(aVencer.total)}</strong>
                  <span className="detalhe">
                    Sobra projetada no fim do mês:{' '}
                    {formatarBRL(painel.saldo + (painel.a_receber_total || 0) - painel.previsto_total)}
                    {painel.a_receber_total > 0
                      ? ` (contando ${formatarBRL(painel.a_receber_total)} que ainda entram).`
                      : '.'}
                  </span>
                </div>
              )}
            </>
          )}

          {painel.cartoes_sem_ciclo?.length > 0 && (
            <div className="aviso atencao">
              <strong>Falta o ciclo de {painel.cartoes_sem_ciclo.map((c) => c.nome).join(', ')}</strong>
              <span className="detalhe">
                {formatarBRL(painel.cartoes_sem_ciclo.reduce((a, c) => a + c.total, 0))} em compras
                sem fatura, porque o cartão não tem dia de vencimento.
                Preencha em Ajustes → Contas.
              </span>
            </div>
          )}

          {faturasAPagar.length > 0 && (
            <>
              <div className="secao-cabecalho">
                <p className="secao-titulo" style={{ margin: 0 }}>Faturas a pagar</p>
                {painel.faturas_abertas > 0 && (
                  <span className="ajuda" style={{ margin: 0 }}>
                    {formatarBRL(painel.faturas_abertas)} em aberto
                  </span>
                )}
              </div>
              <div className="lista">
                {faturasAPagar.map((f) => (
                  <button
                    type="button"
                    className={`item fatura clicavel ${f.pago ? 'paga' : ''}`}
                    key={f.cartao}
                    onClick={() => abrirFatura(f)}
                  >
                    <span className={`ponto ${f.pago ? 'sincronizado' : 'pendente'}`} aria-hidden="true" />
                    <span className="corpo">
                      <span className="titulo">{f.cartao}</span>
                      <span className="meta">
                        {f.pago
                          ? `paga${f.pago_em ? ` em ${diaDe(f.pago_em)}` : ''}`
                          : `${f.lancamentos} compra${f.lancamentos === 1 ? '' : 's'}${f.dia ? ` · vence dia ${f.dia}` : ''}`}
                        {f.pessoa ? ` · ${f.pessoa}` : ''}
                      </span>
                    </span>
                    <span className="num">{formatarBRL(f.pago ? f.valor_pago : f.total)}</span>
                    <span className="seta" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* O que você comprou no crédito e ainda não virou fatura para pagar.
              Sem isto, comprar no Itaú hoje não aparece em lugar nenhum: a
              fatura só vence mês que vem, mas o dinheiro já está comprometido. */}
          {fechando.length > 0 && (
            <>
              <div className="secao-cabecalho">
                <p className="secao-titulo" style={{ margin: 0 }}>Faturas que ainda estão fechando</p>
                <span className="ajuda" style={{ margin: 0 }}>
                  {formatarBRL(totalFechando)} já comprometidos
                </span>
              </div>
              <div className="lista">
                {fechando.map((f) => (
                  <div className="item fatura" key={`${f.cartao}-${f.mes}`}>
                    <span className="ponto" aria-hidden="true" />
                    <span className="corpo">
                      <span className="titulo">{f.cartao}</span>
                      <span className="meta">
                        {f.lancamentos} compra{f.lancamentos === 1 ? '' : 's'}
                        {f.fecha_em ? ` · fecha ${diaDe(f.fecha_em)}` : ''}
                        {f.dia ? ` · vence ${mesCurto(f.mes)}, dia ${f.dia}` : ''}
                        {f.pessoa ? ` · ${f.pessoa}` : ''}
                      </span>
                    </span>
                    <span className="num">{formatarBRL(f.total)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <GraficoEvolucao evolucao={painel.evolucao} mesAtual={painel.mes} />

          {/* Fechada por padrão: é a seção mais alta da tela e a que menos
              exige ação. O cabeçalho já entrega o essencial — quem lidera. */}
          <Sanfona titulo="Para onde foi o dinheiro" resumo={lider(painel.por_categoria)}>
            <div className="abas">
              {CORTES.map((c) => (
                <button
                  key={c.id}
                  className={corte === c.id ? 'ativa' : ''}
                  onClick={() => setCorte(c.id)}
                >
                  {c.rotulo}
                </button>
              ))}
            </div>

            <Barras
              dados={dadosCorte}
              orcamentos={corte === 'categoria' ? painel.orcamentos : {}}
              vazio="Nenhuma saída registrada neste mês."
            />

            {painel.por_fonte?.length > 0 && (
              <>
                <p className="secao-titulo">De onde veio a renda</p>
                <Barras dados={painel.por_fonte} vazio="Nenhuma entrada registrada." />
              </>
            )}
          </Sanfona>
        </>
      )}

      <div className="secao-cabecalho" ref={listaTopo}>
        <p className="secao-titulo" style={{ margin: 0 }}>
          Lançamentos{visiveis.length ? ` · ${visiveis.length}` : ''}
        </p>
        {pessoas.length > 1 && (
          <select
            className="filtro"
            value={filtroPessoa}
            onChange={(e) => setFiltroPessoa(e.target.value)}
            aria-label="Filtrar por pessoa"
          >
            <option value="">Todos</option>
            {pessoas.map((p) => <option key={p.nome} value={p.nome}>{p.nome}</option>)}
          </select>
        )}
      </div>

      {/* O X só aparece quando há o que apagar, e o campo reserva o espaço dele
          o tempo todo — assim o texto nunca corre por baixo do botão. */}
      <div className="busca">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar por descrição, categoria, conta…"
          aria-label="Procurar nos lançamentos"
          autoComplete="off"
        />
        {busca && (
          <button
            type="button"
            className="busca-limpar"
            onClick={() => setBusca('')}
            aria-label="Limpar a busca"
          >
            ×
          </button>
        )}
      </div>

      {carregando ? (
        <div className="cartao pensando"><span className="girando" aria-hidden="true" /><span>Carregando o mês…</span></div>
      ) : visiveis.length === 0 ? (
        <div className="lista">
          <p className="vazio">
            {busca ? `Nada encontrado para “${busca}”.` : 'Nenhum lançamento neste mês.'}
          </p>
        </div>
      ) : (
        <div className="lista">
          {daPagina.map((l, i) => (
            <Fragment key={l.uuid}>
              {/* A virada do que aconteceu para o que ainda vai acontecer.
                  Sem a marca, ver 28/09 depois de 01/09 parece desordem. */}
              {ehFuturo(l) && !ehFuturo(daPagina[i - 1]) && (
                <p className="divisor-lista">daqui para baixo, ainda vai acontecer</p>
              )}
            <button
              type="button"
              className={`item clicavel ${l.status === 'agendado' ? 'agendado' : ''}`}
              onClick={() => setEditando({ ...l })}
            >
              <span className="corpo">
                <span className="titulo">{l.descricao || l.categoria || '(sem descrição)'}</span>
                <span className="meta">
                  {[
                    l.categoria,
                    l.conta,
                    l.pessoa,
                    Number(l.parcelas_total) > 1 ? `parcela ${l.parcela_atual}/${l.parcelas_total}` : null
                  ].filter(Boolean).join(' · ')} · {diaDe(l.data)}
                  {l.revisar ? ' · confira' : ''}
                </span>
                {l.status === 'agendado' && (
                  <span className="marca-agendado">agendado · ainda não conta</span>
                )}
              </span>
              <span className={`num ${l.tipo === 'receita' ? 'receita' : ''}`}>
                {l.tipo === 'receita' ? '+' : '−'}{formatarBRL(l.valor).replace('R$', '').trim()}
              </span>
            </button>
            </Fragment>
          ))}
        </div>
      )}

      {visiveis.length > 0 && (
        <div className="paginacao">
          <div className="paginas">
            <button
              type="button"
              className="btn discreto pequeno"
              onClick={() => irPara(paginaAtual - 1)}
              disabled={paginaAtual === 1}
              aria-label="Página anterior"
            >
              ‹
            </button>
            <span>
              {primeiroDaPagina}–{ultimoDaPagina} de {visiveis.length}
            </span>
            <button
              type="button"
              className="btn discreto pequeno"
              onClick={() => irPara(paginaAtual + 1)}
              disabled={paginaAtual >= totalPaginas}
              aria-label="Próxima página"
            >
              ›
            </button>
          </div>

          <label className="por-pagina">
            por página
            <select
              className="filtro"
              value={porPagina}
              onChange={(e) => { setPorPagina(Number(e.target.value)); setPagina(1); }}
            >
              {[10, 30, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      )}

      {confirmandoRenda && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Confirmar recebimento">
          <div className="modal-fundo" onClick={() => !salvando && setConfirmandoRenda(null)} />
          <div className="modal-corpo">
            <div className="cartao destaque">
              <div className="valor-linha">
                <span className="valor receita">{formatarBRL(confirmandoRenda.valor_agendado ?? confirmandoRenda.valor)}</span>
                <span className="etiqueta receita">agendado</span>
              </div>
              <p className="secao-titulo" style={{ margin: 0 }}>{confirmandoRenda.nome_visivel || confirmandoRenda.nome}</p>
              <p className="ajuda">
                Esse dinheiro está previsto, mas ainda não conta como recebido.
                Caiu mesmo? Registro com a data de hoje.
              </p>
              <div className="botoes">
                <button className="btn discreto" onClick={() => setConfirmandoRenda(null)} disabled={salvando}>
                  Ainda não
                </button>
                <button className="btn principal" onClick={() => confirmarAgendado(confirmandoRenda)} disabled={salvando}>
                  {salvando ? 'Registrando…' : 'Caiu, pode contar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editando && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Editar lançamento">
          <div className="modal-fundo" onClick={() => !salvando && setEditando(null)} />
          <div className="modal-corpo">
            <CartaoLancamento
              valor={editando}
              aoMudar={setEditando}
              cadastros={cadastros}
              modo="editar"
              ocupado={salvando}
              aoConfirmar={salvarEdicao}
              aoCancelar={() => setEditando(null)}
              aoExcluir={excluirEdicao}
              aoTornarMensal={() => setVirandoMensal({
                uuid: editando.uuid,
                receita: editando.tipo === 'receita',
                nome: editando.descricao || editando.categoria || '',
                dia: Number(String(editando.data).slice(8, 10)) || '',
                mes_fim: ''
              })}
            />
          </div>
        </div>
      )}

      {pagandoFatura && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={`Pagar fatura ${pagandoFatura.cartao}`}>
          <div className="modal-fundo" onClick={() => !salvando && setPagandoFatura(null)} />
          <div className="modal-corpo">
            <div className="cartao destaque">
              <p className="secao-titulo" style={{ margin: 0 }}>Pagar fatura · {pagandoFatura.cartao}</p>
              <p className="ajuda">
                Aqui é onde o dinheiro sai de verdade. As compras que formaram esta fatura
                já foram contadas como gasto quando aconteceram, então este pagamento não
                entra de novo nas categorias.
              </p>

              <div className="linha">
                <div className="campo">
                  <label htmlFor="fat-valor">Valor pago</label>
                  <input
                    id="fat-valor" type="number" inputMode="decimal" step="0.01"
                    value={pagandoFatura.valor}
                    onChange={(e) => setPagandoFatura({ ...pagandoFatura, valor: e.target.value })}
                  />
                </div>
                <div className="campo">
                  <label htmlFor="fat-data">Data</label>
                  <input
                    id="fat-data" type="date"
                    value={pagandoFatura.data}
                    onChange={(e) => setPagandoFatura({ ...pagandoFatura, data: e.target.value })}
                  />
                </div>
              </div>

              <details className="opcional">
                <summary>De qual conta saiu <span>(opcional)</span></summary>
                <div className="campo">
                  <select
                    id="fat-conta"
                    aria-label="De qual conta saiu"
                    value={pagandoFatura.conta}
                    onChange={(e) => setPagandoFatura({ ...pagandoFatura, conta: e.target.value })}
                  >
                    <option value="">não importa</option>
                    {(cadastros.contas || [])
                      .filter((c) => c.tipo !== 'credito' && c.ativo !== false)
                      .map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
                  </select>
                  <p className="ajuda">
                    Só preencha se você acompanha o saldo de cada conta separado.
                    Para o total do mês, tanto faz de onde saiu.
                  </p>
                </div>
              </details>

              <div className="botoes">
                <button className="btn discreto" onClick={() => setPagandoFatura(null)} disabled={salvando}>
                  Cancelar
                </button>
                <button
                  className="btn principal"
                  onClick={confirmarFatura}
                  disabled={salvando || !Number(pagandoFatura.valor)}
                >
                  {salvando ? 'Salvando…' : 'Registrar pagamento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pagandoFixa && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${pagandoFixa.receita ? 'Registrar recebimento' : 'Registrar pagamento'} de ${pagandoFixa.nome}`}
        >
          <div className="modal-fundo" onClick={() => !salvando && setPagandoFixa(null)} />
          <div className="modal-corpo">
            <p className="modal-titulo">
              {pagandoFixa.receita ? 'Registrar recebimento' : 'Registrar pagamento'} · {pagandoFixa.nome}
            </p>

            <CartaoLancamento
              valor={pagandoFixa.lancamento}
              aoMudar={(l) => setPagandoFixa({ ...pagandoFixa, lancamento: l })}
              cadastros={cadastros}
              modo="confirmar"
              ocupado={salvando}
              aoConfirmar={confirmarPagamento}
              aoCancelar={() => setPagandoFixa(null)}
              rotuloCancelar="Fechar"
              permiteParcelar={false}
            />

            {/* Aqui só se registra o que aconteceu. Consertar a regra em si —
                virar entrada, mudar o dia, apagar — é em Ajustes, e sem este
                aviso não havia como descobrir isso. */}
            <p className="ajuda">
              Errado? {pagandoFixa.receita ? 'Esta renda' : 'Esta conta'} se conserta ou se apaga
              em <strong>Ajustes → Contas fixas e rendas mensais</strong>. Fechar aqui só
              fecha a janela.
            </p>

            {Math.abs(pagandoFixa.lancamento.valor - pagandoFixa.valorCombinado) >= 0.01 && (
              <div className="cartao">
                <p className="ajuda" style={{ margin: 0 }}>
                  Veio diferente dos {formatarBRL(pagandoFixa.valorCombinado)} combinados.
                  O que isso significa?
                </p>
                <div className="campo">
                  <label htmlFor="ajuste-fixa">{pagandoFixa.receita ? 'A renda mensal' : 'A conta fixa'}</label>
                  <select
                    id="ajuste-fixa"
                    value={pagandoFixa.ajuste}
                    onChange={(e) => setPagandoFixa({ ...pagandoFixa, ajuste: e.target.value })}
                  >
                    <option value="excecao">variou só este mês — continua {formatarBRL(pagandoFixa.valorCombinado)}</option>
                    <option value="definir">
                      {pagandoFixa.receita ? 'mudou de valor' : 'mudou de preço'} — passa a ser {formatarBRL(pagandoFixa.lancamento.valor)}
                    </option>
                    <option value="nenhum">{pagandoFixa.receita ? 'não mexer na renda' : 'não mexer na conta fixa'}</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {virandoMensal && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Transformar em conta fixa">
          <div className="modal-fundo" onClick={() => !salvando && setVirandoMensal(null)} />
          <div className="modal-corpo">
            <div className="cartao destaque">
              <p className="secao-titulo" style={{ margin: 0 }}>
                {virandoMensal.receita ? 'Receber todo mês' : 'Repetir todo mês'}
              </p>
              <p className="ajuda">
                O {virandoMensal.receita ? 'recebimento' : 'gasto'} que você já registrou continua
                onde está. O que nasce aqui é a regra de que ele se repete — a partir deste mês,
                até você dizer o contrário.
                {virandoMensal.receita &&
                  ' A renda aparece como "a receber" todo mês, e você confirma quando cair.'}
              </p>

              <div className="campo">
                <label htmlFor="m-nome">Como chamar</label>
                <input
                  id="m-nome"
                  value={virandoMensal.nome}
                  onChange={(e) => setVirandoMensal({ ...virandoMensal, nome: e.target.value })}
                />
              </div>

              <div className="linha">
                <div className="campo">
                  <label htmlFor="m-dia">{virandoMensal.receita ? 'Cai dia' : 'Vence dia'}</label>
                  <input
                    id="m-dia" type="number" min="1" max="31" inputMode="numeric"
                    value={virandoMensal.dia}
                    onChange={(e) => setVirandoMensal({ ...virandoMensal, dia: e.target.value })}
                  />
                </div>
                <div className="campo">
                  <label htmlFor="m-fim">Até (opcional)</label>
                  <input
                    id="m-fim" type="month"
                    value={virandoMensal.mes_fim}
                    onChange={(e) => setVirandoMensal({ ...virandoMensal, mes_fim: e.target.value })}
                  />
                </div>
              </div>

              <div className="botoes">
                <button className="btn discreto" onClick={() => setVirandoMensal(null)} disabled={salvando}>
                  Cancelar
                </button>
                <button className="btn principal" onClick={confirmarMensal} disabled={salvando || !virandoMensal.nome.trim()}>
                  {salvando ? 'Salvando…' : (virandoMensal.receita ? 'Receber todo mês' : 'Repetir todo mês')}
                </button>
              </div>
            </div>
          </div>
        </div>
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
        <strong>{mesPorExtenso(mes)}</strong>
        {mes !== hoje && (
          <button type="button" className="btn discreto pequeno" onClick={() => aoMudar(hoje)}>
            voltar para hoje
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => aoMudar(somarMes(mes, 1))}
        disabled={mes >= hoje}
        aria-label="Próximo mês"
      >›</button>
    </div>
  );
}

/** O dia do vencimento dentro do mês, sem estourar o fim nem passar de hoje. */
/** O vencimento daquele mês, ou hoje se ele ainda não chegou. */
function hojeOuVencimento(mes, dia) {
  return dataDoVencimento(mes, dia);
}

function dataDoVencimento(mes, dia) {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  const ultimo = new Date(ano, m, 0).getDate();
  const d = Math.min(Math.max(Number(dia) || 1, 1), ultimo);
  const iso = `${mes}-${String(d).padStart(2, '0')}`;
  const hoje = new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  return iso > hojeIso ? hojeIso : iso;
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
function situacaoDa(f, mesPainel) {
  const p = PALAVRAS[f.tipo === 'receita' ? 'receita' : 'despesa'];

  if (f.lancado) return { situacao: 'sincronizado', rotulo: p.feito };
  if (!f.dia) return { situacao: 'pendente', rotulo: 'sem dia definido' };

  const hoje = new Date();
  const mesHoje = mesDeHoje();

  if (mesPainel > mesHoje) return { situacao: 'pendente', rotulo: p.futuro(f.dia) };
  if (mesPainel < mesHoje) return { situacao: 'erro', rotulo: p.passado(f.dia) };

  const diasAte = f.dia - hoje.getDate();
  if (diasAte > 0) return { situacao: 'pendente', rotulo: p.emDias(diasAte) };
  if (diasAte === 0) return { situacao: 'pendente', rotulo: p.hoje };
  return { situacao: 'erro', rotulo: p.atrasado(-diasAte) };
}

/** "Transporte lidera com R$ 1.935,32" — o resumo da sanfona fechada. */
function lider(porCategoria) {
  const topo = (porCategoria || [])[0];
  return topo ? `${topo.nome} lidera com ${formatarBRL(topo.total)}` : '';
}

function resumirFixas(lista) {
  return {
    total: lista.reduce((a, f) => a + f.valor, 0),
    nomes: lista.map((f) => f.nome)
  };
}

function mesDeHoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-10" vira "outubro". */
function mesCurto(mes) {
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const [ano, m] = String(mes || '').split('-');
  const nome = nomes[Number(m) - 1];
  if (!nome) return mes;
  return ano === String(new Date().getFullYear()) ? nome : `${nome} de ${ano}`;
}

/** Já aconteceu, ou ainda está por vir? É o que separa a lista em duas. */
function ehFuturo(l) {
  return Boolean(l) && String(l.data || '') > hojeISO();
}

function hojeISO() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function somarMes(mes, n) {
  let ano = Number(mes.slice(0, 4));
  let m = Number(mes.slice(5, 7)) + n;
  while (m > 12) { m -= 12; ano++; }
  while (m < 1) { m += 12; ano--; }
  return `${ano}-${String(m).padStart(2, '0')}`;
}

const COMPLETOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function mesPorExtenso(mes) {
  const m = COMPLETOS[Number(mes.slice(5, 7)) - 1];
  // Só a primeira letra sobe: "Setembro de 2026", nunca "Setembro De 2026".
  return m ? `${m[0].toUpperCase()}${m.slice(1)} de ${mes.slice(0, 4)}` : mes;
}

function diaDe(iso) {
  const [, m, d] = String(iso).split('-');
  return `${d}/${m}`;
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

function traduzir(codigo) {
  return TRADUZ[codigo] || 'Algo deu errado ao falar com a planilha.';
}
