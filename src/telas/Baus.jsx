import { useCallback, useEffect, useMemo, useState } from 'react';
import Item, { SpriteBau } from '../componentes/Item.jsx';
import Capa from '../componentes/Capa.jsx';
import { agruparPorDia, rotuloDia } from '../componentes/Extrato.jsx';
import { api } from '../lib/api.js';
import { enfileirar, ESTADO, novoId } from '../lib/db.js';
import { sincronizar } from '../lib/sync.js';
import { formatarBRL, soNumero } from '../lib/parser.js';
import { hojeISO, mesDeHoje, mesPorExtenso } from '../lib/datas.js';
import { GUARDAR, RESGATAR, comPendentes, estadoDoBau, previsao } from '../lib/baus.js';

// Os baús: caixinhas para guardar dinheiro, cada uma com meta, "pra que é" e
// histórico. As contas moram em lib/baus.js; o dinheiro entra e sai pela
// mesma fila dos lançamentos (tipo guardar/resgatar), então funciona sem
// internet e aparece na hora.

const CACHE = 'qpg.baus';
const CHAVE_CONTA = 'qpg.ultimaConta';

const lembrar = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const centavos = (texto) => Number(String(texto).replace(/\D/g, '').slice(0, 11)) / 100;
const inteiro = (v) => Math.round(Number(v) || 0).toLocaleString('pt-BR');

function cacheSalvo() {
  try { return JSON.parse(localStorage.getItem(CACHE) || 'null') || { resposta: null, em: 0 }; } catch { return { resposta: null, em: 0 }; }
}

const ERROS = {
  nome_repetido: 'Já existe um baú com esse nome.',
  nome_vazio: 'Dê um nome ao baú.',
  valor_invalido: 'Esse valor não parece certo.',
  bau_com_dinheiro: 'Só dá para arquivar um baú vazio. Resgate o dinheiro antes.',
  acao_desconhecida: 'O script da planilha ainda não tem os baús. Implante a versão nova (2.9.0).'
};
const traduzir = (r) => ERROS[r?.erro] || 'Não consegui falar com a planilha. Tente de novo.';

export default function Baus({ cadastros, fila, aoMudarFila, aoVoltar }) {
  const [{ resposta, em }, setDados] = useState(cacheSalvo);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [aberto, setAberto] = useState(null);       // nome do baú aberto
  const [form, setForm] = useState(null);           // { nome_antigo?, nome, meta, objetivo, prazo, guardarJa }
  const [folha, setFolha] = useState(null);         // { modo, valor, data, conta, descricao }
  const [movimento, setMovimento] = useState(null); // movimento sendo editado
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const pedidoEm = Date.now();
    const r = await api.baus();
    setCarregando(false);
    if (!r.ok) { setErro(traduzir(r)); return; }
    setErro(null);
    setDados({ resposta: r, em: pedidoEm });
    try { localStorage.setItem(CACHE, JSON.stringify({ resposta: r, em: pedidoEm })); } catch { /* só não guarda */ }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const dados = useMemo(() => comPendentes(resposta, fila, { desde: em }), [resposta, fila, em]);
  const bau = aberto ? dados.baus.find((b) => b.nome === aberto) : null;
  const contas = (cadastros.contas || []).filter((c) => c.tipo !== 'credito' && c.ativo !== false);
  const contaPadrao = contas.some((c) => c.nome === lembrar(CHAVE_CONTA)) ? lembrar(CHAVE_CONTA) : (contas[0]?.nome || '');

  /** Guardar e resgatar entram na fila, como qualquer lançamento. */
  async function movimentar(nomeBau, modo, valor, extra = {}) {
    await enfileirar({
      uuid: novoId(),
      estado: ESTADO.PENDENTE,
      texto: '',
      lancamento: {
        tipo: modo,
        valor,
        categoria: nomeBau,
        descricao: (extra.descricao || '').trim(),
        data: extra.data || hojeISO(),
        conta: extra.conta || contaPadrao,
        origem: 'bau'
      }
    });
    aoMudarFila();
    sincronizar().then(() => { aoMudarFila(); carregar(); });
  }

  async function salvarForm() {
    setOcupado(true);
    setErro(null);
    // Só os campos do baú: o rascunho de edição carrega o histórico inteiro junto.
    const { guardarJa, nome_antigo: nomeAntigo, nome, meta, objetivo, prazo } = form;
    const r = await api.salvarBau({ nome_antigo: nomeAntigo || '', nome, meta, objetivo, prazo });
    setOcupado(false);
    if (!r.ok) { setErro(traduzir(r)); return; }
    if (guardarJa > 0) await movimentar(r.bau.nome, GUARDAR, guardarJa);
    setForm(null);
    setAberto(r.bau.nome);
    carregar();
  }

  async function arquivar() {
    setOcupado(true);
    const r = await api.excluirBau(bau.nome);
    setOcupado(false);
    if (!r.ok) { setErro(traduzir(r)); return; }
    setAberto(null);
    carregar();
  }

  async function salvarMovimento(excluir = false) {
    setOcupado(true);
    const { uuid, valor, data, descricao, conta } = movimento;
    const r = excluir
      ? await api.excluirLancamento(uuid)
      : await api.editarLancamento(uuid, { valor, data, descricao, conta });
    setOcupado(false);
    if (!r.ok) { setErro(traduzir(r)); return; }
    setMovimento(null);
    carregar();
  }

  // --- formulário: criar ou editar ---------------------------------------
  if (form) {
    return (
      <FormBau
        form={form}
        contas={contas}
        ocupado={ocupado}
        erro={erro}
        aoMudar={setForm}
        aoSalvar={salvarForm}
        aoVoltar={() => { setForm(null); setErro(null); }}
      />
    );
  }

  // --- dentro de um baú ---------------------------------------------------
  if (bau) {
    const p = previsao(bau);
    const estado = estadoDoBau(bau.saldo, bau.meta);
    const pct = bau.meta > 0 ? Math.min(100, Math.round((Math.max(0, bau.saldo) / bau.meta) * 100)) : 0;
    return (
      <>
        <button type="button" className="btn discreto voltar" onClick={() => { setAberto(null); setErro(null); }}>‹ Baús</button>
        {erro && <div className="aviso ruim" role="alert"><strong>{erro}</strong></div>}

        <div className={`janela-bau ${p.cheio ? 'cheio' : ''}`}>
          <div className="cab-bau">
            <span className="slot grande"><SpriteBau estado={estado} tamanho={64} /></span>
            <div className="cab-bau-texto">
              <h2>{bau.nome}</h2>
              <span className="saldo-bau">{formatarBRL(bau.saldo)}</span>
            </div>
          </div>
          <p className="objetivo">
            {bau.objetivo ? <>Pra que é: {bau.objetivo} </> : 'Sem descrição ainda. '}
            <button type="button" className="link-editar" onClick={() => setForm({ ...bau, nome_antigo: bau.nome, guardarJa: 0 })}>editar</button>
          </p>
          {bau.meta > 0 && (
            <div className="meta-bau">
              <div className="legenda"><span>META</span><span>R$ {inteiro(Math.max(0, bau.saldo))} / {inteiro(bau.meta)}</span></div>
              <div className={`hp ${p.cheio ? 'cheio-bau' : 'xp'}`} style={{ '--p': `${pct}%` }}
                role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`quanto do baú ${bau.nome} já encheu`}><i /></div>
            </div>
          )}
          <p className="sub">{frase(bau, p)}</p>
        </div>

        <div className="botoes-bau">
          <button type="button" className="btn-px" onClick={() => setFolha({ modo: GUARDAR, valor: 0, data: hojeISO(), conta: contaPadrao, descricao: '' })}>GUARDAR</button>
          <button type="button" className="btn-px claro" disabled={!(bau.saldo > 0)}
            onClick={() => setFolha({ modo: RESGATAR, valor: 0, data: hojeISO(), conta: contaPadrao, descricao: '' })}>RESGATAR</button>
        </div>

        {bau.movimentos.length === 0 ? (
          <div className="lista"><p className="vazio">Nada guardado ainda. Toque em GUARDAR para colocar a primeira moeda.</p></div>
        ) : agruparPorDia(bau.movimentos).map((g) => (
          <div className="grupo-dia" key={g.data}>
            <p className="secao-titulo" style={{ margin: 0 }}>{rotuloDia(g.data)}</p>
            <div className="lista">
              {g.itens.map((m) => (
                <button key={m.uuid} type="button" className="item clicavel extrato" disabled={m.pendente}
                  onClick={() => setMovimento({ ...m })}>
                  <Item tipo={m.tipo} />
                  <span className="corpo">
                    <span className="meta">{m.conta || 'sem conta'}{m.pendente ? ' · enviando…' : ''}</span>
                    <span className="titulo">{m.descricao || (m.tipo === GUARDAR ? 'Guardado' : 'Resgatado')}</span>
                  </span>
                  <span className={`num ${m.tipo === GUARDAR ? 'guardou' : 'resgatou'}`}>
                    {m.tipo === GUARDAR ? '+' : '−'}{soNumero(m.valor)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {Math.abs(bau.saldo) < 0.01 && !bau.sem_cadastro && (
          <button type="button" className="btn discreto pequeno arquivar" onClick={arquivar} disabled={ocupado}>
            Arquivar este baú
          </button>
        )}

        {folha && (
          <FolhaMovimento
            bau={bau}
            folha={folha}
            contas={contas}
            aoMudar={setFolha}
            aoFechar={() => setFolha(null)}
            aoConfirmar={() => {
              movimentar(bau.nome, folha.modo, folha.valor, folha);
              setFolha(null);
            }}
          />
        )}

        {movimento && (
          <EditarMovimento
            movimento={movimento}
            contas={contas}
            ocupado={ocupado}
            aoMudar={setMovimento}
            aoFechar={() => setMovimento(null)}
            aoSalvar={() => salvarMovimento(false)}
            aoExcluir={() => salvarMovimento(true)}
          />
        )}
      </>
    );
  }

  // --- a lista ------------------------------------------------------------
  return (
    <>
      <button type="button" className="btn discreto voltar" onClick={aoVoltar}>‹ Voltar</button>
      <p className="secao-titulo" style={{ margin: 0 }}>Baús</p>
      {erro && <div className="aviso ruim" role="alert"><strong>{erro}</strong></div>}

      <div className="janela-bau">
        <span className="rotulo-px">GUARDADO NOS BAÚS</span>
        <span className="saldo-bau grande">{formatarBRL(dados.total)}</span>
        <p className="sub">
          {dados.baus.length} {dados.baus.length === 1 ? 'baú' : 'baús'}
          {dados.guardadoMes !== 0 && (
            <> · <strong className={dados.guardadoMes > 0 ? 'pos' : 'neg'}>
              {dados.guardadoMes > 0 ? '+' : '−'}{formatarBRL(Math.abs(dados.guardadoMes))}
            </strong> {dados.guardadoMes > 0 ? 'guardados' : 'resgatados'} este mês</>
          )}
        </p>
      </div>

      {!resposta && carregando ? (
        <div className="lista"><p className="vazio">Abrindo os baús…</p></div>
      ) : dados.baus.length === 0 ? (
        <div className="lista">
          <p className="vazio">
            Nenhum baú ainda. Crie um para cada objetivo — viagem, reserva de emergência,
            um presente — e vá guardando aos poucos até encher.
          </p>
        </div>
      ) : (
        <div className="lista">
          {dados.baus.map((b) => <LinhaBau key={b.nome} bau={b} aoAbrir={() => setAberto(b.nome)} />)}
        </div>
      )}

      <button type="button" className="novo-bau px"
        onClick={() => setForm({ nome: '', meta: 0, objetivo: '', prazo: '', guardarJa: 0 })}>
        + NOVO BAÚ
      </button>
    </>
  );
}

function frase(bau, p) {
  if (!(bau.meta > 0)) return 'Sem meta: guarde quanto quiser.';
  if (p.cheio) return `Baú cheio: bateu a meta de ${formatarBRL(bau.meta)}.`;
  const partes = [`Faltam ${formatarBRL(p.falta)}.`];
  if (p.enche) partes.push(`No ritmo dos últimos meses (${formatarBRL(p.ritmo)} por mês), enche em ${mesPorExtenso(p.enche)}.`);
  if (p.atrasado) partes.push(`O prazo (${mesPorExtenso(bau.prazo)}) já passou.`);
  else if (p.porMes != null) partes.push(`Para chegar até ${mesPorExtenso(bau.prazo)}, guarde ${formatarBRL(p.porMes)} por mês.`);
  return partes.join(' ');
}

function LinhaBau({ bau, aoAbrir }) {
  const p = previsao(bau);
  const pct = bau.meta > 0 ? Math.min(100, Math.round((Math.max(0, bau.saldo) / bau.meta) * 100)) : 0;
  let meta;
  if (!(bau.meta > 0)) meta = 'sem meta';
  else if (p.cheio) meta = `${formatarBRL(bau.meta)} de meta`;
  else meta = `${pct}% de ${formatarBRL(bau.meta)} · faltam ${formatarBRL(p.falta)}`;
  return (
    <button type="button" className="bau-linha" onClick={aoAbrir}>
      <span className="slot"><SpriteBau estado={estadoDoBau(bau.saldo, bau.meta)} tamanho={44} /></span>
      <span className="corpo">
        <span className="t"><strong>{bau.nome}</strong><span className="px">{formatarBRL(bau.saldo)}</span></span>
        {bau.meta > 0 && <span className={`hp ${p.cheio ? 'cheio-bau' : 'xp'}`} style={{ '--p': `${pct}%` }}><i /></span>}
        <span className="m">{meta}{p.cheio && <> <span className="selo-cheio px">CHEIO</span></>}</span>
      </span>
    </button>
  );
}

// --- janelas ------------------------------------------------------------------

function useSaida(aoFechar, ocupado) {
  const [saindo, setSaindo] = useState(false);
  function fechar() {
    if (ocupado || saindo) return;
    setSaindo(true);
    setTimeout(aoFechar, 120);
  }
  return [saindo, fechar];
}

function Modal({ rotulo, saindo, aoFechar, children }) {
  return (
    <div className={`modal ${saindo ? 'saindo' : ''}`} role="dialog" aria-modal="true" aria-label={rotulo}>
      <div className="modal-fundo" onClick={aoFechar} />
      <div className="modal-corpo">{children}</div>
    </div>
  );
}

function CampoValor({ id, valor, aoMudar, rotulo }) {
  return (
    <label className={`valor-px ${valor ? '' : 'zerado'}`} htmlFor={id}>
      <span className="moeda px">R$</span>
      <input id={id} className="px" type="text" inputMode="numeric" autoComplete="off" aria-label={rotulo}
        value={soNumero(valor)} onChange={(e) => aoMudar(centavos(e.target.value))} />
    </label>
  );
}

function FolhaMovimento({ bau, folha, contas, aoMudar, aoFechar, aoConfirmar }) {
  const [saindo, fechar] = useSaida(aoFechar, false);
  const guardar = folha.modo === GUARDAR;
  const depois = Math.round((bau.saldo + (guardar ? 1 : -1) * folha.valor) * 100) / 100;
  const passou = !guardar && folha.valor > bau.saldo;
  const pct = (v) => (bau.meta > 0 ? Math.min(100, Math.max(0, (v / bau.meta) * 100)) : 0);
  const mudar = (campo) => (e) => aoMudar({ ...folha, [campo]: e.target.value });

  return (
    <Modal rotulo={`${guardar ? 'Guardar no' : 'Resgatar do'} baú ${bau.nome}`} saindo={saindo} aoFechar={fechar}>
      <div className="cartao folha-bau">
        <p className="secao-titulo" style={{ margin: 0 }}>Baú · <b>{bau.nome}</b></p>
        <div className="alterna">
          <button type="button" className={`px ${guardar ? 'on guardar' : ''}`} onClick={() => aoMudar({ ...folha, modo: GUARDAR })}>+ GUARDAR</button>
          <button type="button" className={`px ${!guardar ? 'on resgatar' : ''}`} disabled={!(bau.saldo > 0)}
            onClick={() => aoMudar({ ...folha, modo: RESGATAR })}>− RESGATAR</button>
        </div>
        <CampoValor id="bau-valor" valor={folha.valor} rotulo="Valor, em reais" aoMudar={(v) => aoMudar({ ...folha, valor: v })} />
        <div className="linha">
          <div className="campo">
            <label htmlFor="bau-data">Dia</label>
            <input id="bau-data" type="date" value={folha.data} onChange={mudar('data')} />
          </div>
          <div className="campo">
            <label htmlFor="bau-conta">{guardar ? 'Sai de' : 'Volta para'}</label>
            <select id="bau-conta" value={folha.conta} onChange={mudar('conta')}>
              {contas.map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
            </select>
          </div>
        </div>
        <div className="campo">
          <label htmlFor="bau-nota">Nota (opcional)</label>
          <input id="bau-nota" value={folha.descricao} onChange={mudar('descricao')}
            placeholder={guardar ? 'sobrou do salário, 13º…' : 'pra que foi o resgate'} autoComplete="off" />
        </div>

        <div className="janela-bau previa">
          <div className="legenda">
            <span>BAÚ</span>
            <span>R$ {inteiro(bau.saldo)} → <b>R$ {inteiro(Math.max(0, depois))}</b></span>
          </div>
          {bau.meta > 0 && (
            <div className="hp xp" style={{ '--p': `${pct(Math.max(0, Math.min(bau.saldo, depois)))}%` }}>
              <i />
              {folha.valor > 0 && (
                <b className="custo" style={{ left: `${pct(Math.min(bau.saldo, depois))}%`, width: `${Math.abs(pct(depois) - pct(bau.saldo))}%` }} />
              )}
            </div>
          )}
          <p className="sub">
            {passou
              ? `O baú só tem ${formatarBRL(bau.saldo)}.`
              : guardar
                ? 'Sai do seu mês: o ouro de hoje e a sobra já contam com isso. Não é gasto.'
                : 'Volta para o seu mês: o ouro de hoje sobe na hora.'}
          </p>
        </div>

        <div className="botoes">
          <button type="button" className="btn discreto" onClick={fechar}>Cancelar</button>
          <button type="button" className="btn principal" disabled={!(folha.valor > 0) || passou} onClick={aoConfirmar}>
            {guardar ? `Guardar ${formatarBRL(folha.valor)}` : `Resgatar ${formatarBRL(folha.valor)}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditarMovimento({ movimento, contas, ocupado, aoMudar, aoFechar, aoSalvar, aoExcluir }) {
  const [saindo, fechar] = useSaida(aoFechar, ocupado);
  const mudar = (campo) => (e) => aoMudar({ ...movimento, [campo]: e.target.value });
  const guardar = movimento.tipo === GUARDAR;
  return (
    <Modal rotulo="Editar movimento do baú" saindo={saindo} aoFechar={fechar}>
      <div className="cartao destaque">
        <p className="secao-titulo" style={{ margin: 0 }}>{guardar ? 'Guardado' : 'Resgatado'} · {movimento.categoria}</p>
        <CampoValor id="mov-valor" valor={Number(movimento.valor) || 0} rotulo="Valor, em reais"
          aoMudar={(v) => aoMudar({ ...movimento, valor: v })} />
        <div className="linha">
          <div className="campo">
            <label htmlFor="mov-data">Dia</label>
            <input id="mov-data" type="date" value={movimento.data} onChange={mudar('data')} />
          </div>
          <div className="campo">
            <label htmlFor="mov-conta">{guardar ? 'Saiu de' : 'Voltou para'}</label>
            <select id="mov-conta" value={movimento.conta} onChange={mudar('conta')}>
              {!contas.some((c) => c.nome === movimento.conta) && movimento.conta && <option value={movimento.conta}>{movimento.conta}</option>}
              {contas.map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
            </select>
          </div>
        </div>
        <div className="campo">
          <label htmlFor="mov-nota">Nota</label>
          <input id="mov-nota" value={movimento.descricao || ''} onChange={mudar('descricao')} autoComplete="off" />
        </div>
        <div className="botoes">
          <button type="button" className="btn discreto perigo" onClick={aoExcluir} disabled={ocupado}>Excluir</button>
          <button type="button" className="btn principal" onClick={aoSalvar} disabled={ocupado || !(Number(movimento.valor) > 0)}>
            {ocupado ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
        <Capa quando={ocupado} />
      </div>
    </Modal>
  );
}

function FormBau({ form, contas, ocupado, erro, aoMudar, aoSalvar, aoVoltar }) {
  const novo = !form.nome_antigo;
  const mudar = (campo) => (e) => aoMudar({ ...form, [campo]: e.target.value });
  const dica = form.meta > 0 && form.prazo && form.prazo >= mesDeHoje()
    ? previsao({ meta: form.meta, saldo: form.saldo || 0, prazo: form.prazo, por_mes: {} })
    : null;
  return (
    <>
      <button type="button" className="btn discreto voltar" onClick={aoVoltar}>‹ {novo ? 'Baús' : form.nome_antigo}</button>
      <p className="secao-titulo" style={{ margin: 0 }}>{novo ? 'Novo baú' : 'Editar baú'}</p>
      {erro && <div className="aviso ruim" role="alert"><strong>{erro}</strong></div>}
      <div className="cartao novo">
        <div className="campo">
          <label htmlFor="bau-nome">Nome do baú</label>
          <input id="bau-nome" value={form.nome} onChange={mudar('nome')} maxLength={40}
            placeholder="Viagem, reserva de emergência…" autoComplete="off" />
        </div>
        <div className="escolha-categoria">
          <span className="secao-titulo" style={{ margin: 0 }}>Meta (opcional)</span>
          <CampoValor id="bau-meta" valor={form.meta} rotulo="Meta, em reais" aoMudar={(v) => aoMudar({ ...form, meta: v })} />
        </div>
        <div className="campo">
          <label htmlFor="bau-objetivo">Pra que é (aparece dentro do baú)</label>
          <textarea id="bau-objetivo" rows={2} maxLength={300} value={form.objetivo} onChange={mudar('objetivo')}
            placeholder="Passagens e hotel em julho…" />
        </div>
        <div className="campo">
          <label htmlFor="bau-prazo">Até quando (opcional)</label>
          <input id="bau-prazo" type="month" value={form.prazo} min={mesDeHoje()} onChange={mudar('prazo')} />
        </div>
        {dica?.porMes != null && (
          <p className="ajuda" style={{ margin: 0 }}>
            Para chegar até {mesPorExtenso(form.prazo)}, guarde <strong>{formatarBRL(dica.porMes)}</strong> por mês.
          </p>
        )}
        {novo && contas.length > 0 && (
          <div className="escolha-categoria">
            <span className="secao-titulo" style={{ margin: 0 }}>Guardar já (opcional)</span>
            <CampoValor id="bau-ja" valor={form.guardarJa} rotulo="Guardar já, em reais" aoMudar={(v) => aoMudar({ ...form, guardarJa: v })} />
          </div>
        )}
        <button type="button" className="btn-px" onClick={aoSalvar} disabled={ocupado || !form.nome.trim()}>
          {ocupado ? 'SALVANDO…' : novo ? 'CRIAR BAÚ' : 'SALVAR'}
        </button>
      </div>
    </>
  );
}
