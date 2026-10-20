import { useMemo, useState } from 'react';
import Item, { Sprite } from '../componentes/Item.jsx';
import Capa from '../componentes/Capa.jsx';
import Personagem from '../componentes/Personagem.jsx';
import { api } from '../lib/api.js';
import { enfileirar, ESTADO } from '../lib/db.js';
import { sincronizar } from '../lib/sync.js';
import { formatarBRL, soNumero } from '../lib/parser.js';
import { ativos } from '../lib/cadastros.js';
import { CATEGORIAS_PADRAO } from '../lib/categorias.js';
import { bauPadrao, classificar, lerExtrato } from '../lib/importar.js';
import { personagemSalvo } from '../lib/personagem.js';

// Importar o extrato do banco: escolher o arquivo → conferir → lançar.
// Nada sobe antes de você conferir; o que entra vai pela fila de sempre, com o
// id do movimento como uuid (importar de novo não duplica).

const ROTULO_TIPO = { despesa: 'Gasto', receita: 'Entrada', guardar: 'Guardar no baú', resgatar: 'Resgatar do baú', fora: 'Fora do gasto' };
const diaBR = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const chave = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function bausSalvos() {
  try { return JSON.parse(localStorage.getItem('qpg.baus') || 'null')?.resposta?.baus || []; } catch { return []; }
}

/** A conta do app que combina com o banco do arquivo (e com quem está jogando). */
function contaProvavel(contas, extrato, pessoa) {
  const banco = extrato.banco.startsWith('nubank') ? 'nubank' : extrato.banco.startsWith('itau') ? 'itau' : '';
  const cartao = extrato.banco === 'nubank_cartao';
  const doBanco = contas.filter((c) => banco && chave(c.nome).includes(banco) && (cartao ? c.tipo === 'credito' : c.tipo !== 'credito'));
  return (doBanco.find((c) => chave(c.nome).includes(chave(pessoa).split(' ')[0])) || doBanco[0] || contas[0])?.nome || '';
}

export default function Importar({ cadastros, pessoaPadrao, aoVoltar, aoMudarFila }) {
  const [etapa, setEtapa] = useState('escolher');   // escolher → conferir → pronto
  const [extrato, setExtrato] = useState(null);
  const [erro, setErro] = useState(null);
  const [lendo, setLendo] = useState(false);
  const [conta, setConta] = useState('');
  const [pessoa, setPessoa] = useState(pessoaPadrao);
  const [itens, setItens] = useState([]);           // movimentos + escolha (marcado, tipo, categoria…)
  const [jaImportados, setJaImportados] = useState(0);
  const [editando, setEditando] = useState(null);
  const [lancados, setLancados] = useState(0);
  const [acertarSaldo, setAcertarSaldo] = useState(true);
  const [saldoAcertado, setSaldoAcertado] = useState(null);   // null | 'enviando' | 'ok' | 'falhou'
  const heroi = personagemSalvo();

  const contas = (cadastros.contas || []).filter((c) => c.ativo !== false);
  const pessoas = (cadastros.pessoas || []).filter((p) => p.ativo !== false);
  const todasCategorias = cadastros.categorias?.length ? cadastros.categorias : CATEGORIAS_PADRAO;
  const [baus, setBaus] = useState(bausSalvos);

  async function escolherArquivo(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setErro(null); setLendo(true); setExtrato(null);
    try {
      let lido;
      if (/\.pdf$/i.test(arquivo.name) || arquivo.type === 'application/pdf') {
        const { linhasDoPdf } = await import('../lib/pdfLinhas.js');
        lido = lerExtrato({ linhas: await linhasDoPdf(await arquivo.arrayBuffer()) });
      } else {
        lido = lerExtrato({ texto: await arquivo.text() });
      }
      if (!lido || !lido.movimentos.length) {
        setErro('Não reconheci esse arquivo. Por enquanto: PDF do extrato da conta do Nubank ou do Itaú, CSV do Nubank (conta ou fatura) e OFX.');
      } else {
        setExtrato(lido);
        setConta(contaProvavel(contas, lido, pessoaPadrao));
      }
    } catch {
      setErro('Não consegui abrir esse arquivo. Se for PDF com senha, exporte de novo sem senha.');
    }
    setLendo(false);
  }

  async function conferir() {
    setLendo(true);
    const ctx = { titular: extrato.titular, cpfMeio: extrato.cpfMeio, categorias: ativos(todasCategorias), pessoas };
    // Os baús (para a caixinha virar "guardar"): do cache, ou pergunta à planilha.
    let listaBaus = baus;
    if (!listaBaus.length) {
      const rb = await api.baus();
      if (rb.ok) { listaBaus = rb.baus || []; setBaus(listaBaus); }
    }
    const bau = bauPadrao(listaBaus);
    const base = extrato.movimentos.map((m) => {
      const c = classificar(m, ctx);
      return { ...m, ...c, sugerida: c.categoria, bau: ['guardar', 'resgatar'].includes(c.tipo) ? bau : '', marcado: c.tipo !== 'fora', aprender: false, parecido: null };
    });
    const r = await api.conferirImportacao(base.map((m) => ({ id: m.id, data: m.data, valor: Math.abs(m.valor), tipo: m.tipo })));
    setLendo(false);
    let lista = base;
    if (r.ok) {
      const ja = new Set(r.importados || []);
      setJaImportados(ja.size);
      lista = base.filter((m) => !ja.has(m.id)).map((m) => (r.parecidos?.[m.id] ? { ...m, parecido: r.parecidos[m.id], marcado: false } : m));
    } else {
      setErro('Sem conexão com a planilha: não deu para ver o que já foi lançado. Confira com atenção antes de lançar.');
    }
    setItens(lista);
    setEtapa('conferir');
  }

  const marcados = itens.filter((m) => m.marcado && m.tipo !== 'fora');
  const semCategoria = marcados.filter((m) => ['despesa', 'receita'].includes(m.tipo) && !m.categoria).length;
  const semBau = marcados.filter((m) => ['guardar', 'resgatar'].includes(m.tipo) && !m.bau).length;
  const totais = useMemo(() => {
    let saiu = 0, entrou = 0;
    for (const m of marcados) { if (m.valor < 0) saiu += -m.valor; else entrou += m.valor; }
    return { saiu, entrou };
  }, [marcados]);

  // O saldo final do extrato acerta o saldo da conta (cartão de crédito não tem saldo).
  const contaEscolhida = contas.find((c) => c.nome === conta);
  const saldoDoExtrato = extrato?.saldoFinal && contaEscolhida && contaEscolhida.tipo !== 'credito' ? extrato.saldoFinal : null;

  async function lancar() {
    setLendo(true);
    for (const m of marcados) {
      const bau = ['guardar', 'resgatar'].includes(m.tipo);
      await enfileirar({
        uuid: m.id,
        estado: ESTADO.PENDENTE,
        texto: '',
        lancamento: {
          tipo: m.tipo,
          valor: Math.abs(m.valor),
          categoria: bau ? m.bau : (m.categoria || (m.tipo === 'receita' ? 'Outras Entradas' : 'Outros')),
          descricao: m.descricao,
          data: m.data,
          conta,
          pessoa,
          origem: 'importado',
          aprender_categoria: Boolean(m.aprender && m.palavra && m.categoria),
          palavra_chave: m.palavra || ''
        }
      });
    }
    setLancados(marcados.length);
    setLendo(false);
    setEtapa('pronto');
    aoMudarFila?.();
    const saldo = acertarSaldo ? saldoDoExtrato : null;
    if (saldo) setSaldoAcertado('enviando');
    sincronizar().then(async () => {
      aoMudarFila?.();
      if (!saldo) return;
      // Depois da fila: assim o app compara o saldo do banco já com os movimentos novos.
      const r = await api.acertarConta(conta, saldo.valor, { origem: 'extrato', data: saldo.data });
      setSaldoAcertado(r?.ok ? 'ok' : 'falhou');
    });
  }

  const mudarItem = (id, campos) => setItens((l) => l.map((m) => (m.id === id ? { ...m, ...campos } : m)));

  // --- pronto -------------------------------------------------------------
  if (etapa === 'pronto') {
    return (
      <>
        <div className="cartao importado-fim">
          {heroi && <Personagem id={heroi.id} tamanho={112} anim="vitoria" base="contando" />}
          <p className="secao-titulo" style={{ margin: 0 }}>{lancados ? `${lancados} ${lancados === 1 ? 'movimento lançado' : 'movimentos lançados'}` : 'Nada novo para lançar'}</p>
          <p className="ajuda" style={{ margin: 0 }}>Estão subindo pela fila. Se a internet cair, sobem sozinhos quando voltar.</p>
          {saldoAcertado === 'enviando' && <p className="ajuda" style={{ margin: 0 }}>Acertando o saldo de {conta}…</p>}
          {saldoAcertado === 'ok' && <p className="ajuda" style={{ margin: 0 }}>✓ Saldo de {conta} acertado com o extrato: {formatarBRL(saldoDoExtrato?.valor)} em {diaBR(saldoDoExtrato?.data)}.</p>}
          {saldoAcertado === 'falhou' && <p className="ajuda ruim" style={{ margin: 0 }}>Não consegui acertar o saldo agora — dá para fazer em Mês → Dinheiro nas contas.</p>}
          <button type="button" className="btn-px" onClick={aoVoltar}>VER NO EXTRATO</button>
        </div>
      </>
    );
  }

  // --- conferir -----------------------------------------------------------
  if (etapa === 'conferir') {
    const novos = itens.filter((m) => !m.parecido && m.tipo !== 'fora');
    const parecidos = itens.filter((m) => m.parecido);
    const fora = itens.filter((m) => !m.parecido && m.tipo === 'fora');
    const grupo = (titulo, lista) => lista.length > 0 && (
      <>
        <p className="nota-px">{titulo}</p>
        <div className="lista">
          {lista.map((m) => <LinhaImportada key={m.id} m={m} aoMarcar={() => mudarItem(m.id, { marcado: !m.marcado })} aoAbrir={() => setEditando(m.id)} />)}
        </div>
      </>
    );
    const atual = itens.find((m) => m.id === editando);
    return (
      <>
        <button type="button" className="btn discreto voltar" onClick={() => { setEtapa('escolher'); setErro(null); }}>‹ Escolher outro arquivo</button>
        <p className="secao-titulo" style={{ margin: 0 }}>Conferir · {conta || extrato.rotulo}{extrato.inicio ? ` · ${diaBR(extrato.inicio)} a ${diaBR(extrato.fim)}` : ''}</p>
        {erro && <div className="aviso atencao" role="status"><strong>{erro}</strong></div>}
        <div className="resumo-imp">
          <span className="on"><b className="px">{novos.length}</b>novos</span>
          <span><b className="px">{parecidos.length}</b>já lançados</span>
          <span><b className="px">{fora.length}</b>fora do gasto</span>
        </div>
        {jaImportados > 0 && <p className="ajuda" style={{ margin: 0 }}>{jaImportados} {jaImportados === 1 ? 'movimento já tinha' : 'movimentos já tinham'} sido importados antes — ficaram de fora.</p>}
        {grupo('NOVOS — MARCADOS VÃO PARA A PLANILHA', novos)}
        {grupo('JÁ LANÇADOS À MÃO — TOQUE NO QUADRADO SE FOR OUTRO', parecidos)}
        {grupo('FORA DO GASTO — TOQUE NO QUADRADO PARA INCLUIR', fora)}
        {!itens.length && <div className="lista"><p className="vazio">Tudo deste arquivo já está no app.</p></div>}

        <div className="barra-imp">
          <div className="tot">
            <span>{marcados.filter((m) => m.valor < 0).length} saídas · −{formatarBRL(totais.saiu)}</span>
            <span>{marcados.filter((m) => m.valor > 0).length} entradas · +{formatarBRL(totais.entrou)}</span>
          </div>
          {(semCategoria > 0 || semBau > 0) && (
            <p className="ajuda" style={{ margin: 0 }}>
              {semCategoria > 0 && `${semCategoria} sem categoria (vão como "Outros"). `}
              {semBau > 0 && (baus.length
                ? `${semBau} de caixinha sem baú — toque para escolher.`
                : `${semBau} de caixinha, mas você ainda não tem baú: crie um na pílula do topo, ou desmarque.`)}
            </p>
          )}
          {saldoDoExtrato && (
            <label className="aprender">
              <input type="checkbox" checked={acertarSaldo} onChange={(e) => setAcertarSaldo(e.target.checked)} />
              <span>Acertar o saldo de <b>{conta}</b> para <b>{formatarBRL(saldoDoExtrato.valor)}</b> (saldo de {diaBR(saldoDoExtrato.data)} no extrato)</span>
            </label>
          )}
          <button type="button" className="btn-px" disabled={(!marcados.length && !(saldoDoExtrato && acertarSaldo)) || semBau > 0 || lendo} onClick={lancar}>
            {lendo ? 'LANÇANDO…' : !marcados.length ? 'SÓ ACERTAR O SALDO' : `LANÇAR ${marcados.length} ${marcados.length === 1 ? 'MOVIMENTO' : 'MOVIMENTOS'}`}
          </button>
        </div>

        {atual && (
          <EditarImportado
            m={atual}
            categorias={ativos(todasCategorias).filter((c) => !c.tipo || c.tipo === (atual.valor < 0 ? 'despesa' : 'receita'))}
            baus={baus}
            aoMudar={(campos) => mudarItem(atual.id, campos)}
            aoFechar={() => setEditando(null)}
          />
        )}
      </>
    );
  }

  // --- escolher -----------------------------------------------------------
  return (
    <>
      <button type="button" className="btn discreto voltar" onClick={aoVoltar}>‹ Extrato</button>
      <p className="secao-titulo" style={{ margin: 0 }}>Importar extrato do banco</p>
      <div className="cartao passo">
        <ol>
          <li>No app do banco, exporte o extrato do período:<br />
            <b>Nubank conta</b> — Extrato → exportar (PDF ou CSV)<br />
            <b>Nubank cartão</b> — Fatura → exportar fatura (CSV)<br />
            <b>Itaú</b> — Extrato → salvar em PDF (ou OFX no site)</li>
          <li>Escolha o arquivo aqui. Ele é lido no próprio celular, e nada sobe para a planilha antes de você conferir.</li>
        </ol>
        <label className="solta">
          <input type="file" accept=".pdf,.csv,.ofx,.txt,application/pdf,text/csv" onChange={escolherArquivo} hidden />
          <span className="px">{lendo ? 'LENDO…' : 'ESCOLHER ARQUIVO'}</span>
          PDF, CSV ou OFX
        </label>
        {erro && <div className="aviso ruim" role="alert"><strong>{erro}</strong></div>}
        {extrato && (
          <>
            <div className="detectado">
              <span>✓ <b>{extrato.rotulo}</b> — {extrato.movimentos.length} movimentos{extrato.inicio ? ` de ${diaBR(extrato.inicio)} a ${diaBR(extrato.fim)}` : ''}</span>
            </div>
            <div className="linha">
              <div className="campo">
                <label htmlFor="imp-conta">Conta no app</label>
                <select id="imp-conta" value={conta} onChange={(e) => setConta(e.target.value)}>
                  {contas.map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="imp-pessoa">De quem</label>
                <select id="imp-pessoa" value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
                  <option value="">—</option>
                  {pessoas.map((p) => <option key={p.nome} value={p.nome}>{p.nome}</option>)}
                </select>
              </div>
            </div>
            <button type="button" className="btn-px" onClick={conferir} disabled={lendo}>
              {lendo ? 'CONFERINDO…' : `CONFERIR ${extrato.movimentos.length} MOVIMENTOS`}
            </button>
          </>
        )}
        <Capa quando={lendo} />
      </div>
    </>
  );
}

function LinhaImportada({ m, aoMarcar, aoAbrir }) {
  const bau = ['guardar', 'resgatar'].includes(m.tipo);
  const tag = m.parecido
    ? `já está no app: "${m.parecido.descricao || m.parecido.categoria}" de ${diaBR(m.parecido.data)}`
    : bau ? (m.bau ? `→ vai como ${m.tipo === 'guardar' ? 'GUARDAR no' : 'RESGATAR do'} baú ${m.bau}` : 'caixinha: toque para escolher o baú')
      : m.tipo === 'fora' ? m.motivo : '';
  return (
    <div className={`item imp ${m.marcado ? '' : 'fora'}`}>
      <button type="button" className={`marca ${m.marcado ? 'on' : ''}`} onClick={aoMarcar}
        aria-pressed={m.marcado} aria-label={m.marcado ? 'Não lançar' : 'Lançar'}>{m.marcado ? '✓' : ''}</button>
      <button type="button" className="imp-abrir" onClick={aoAbrir}>
        <Item categoria={m.categoria} receita={m.valor > 0} tipo={bau ? m.tipo : undefined} />
        <span className="corpo">
          <span className="meta">
            {diaBR(m.data)} · {bau || m.tipo === 'fora'
              ? ROTULO_TIPO[m.tipo]
              : <span className="chip-cat">{m.categoria || 'Sem categoria'}{m.categoria && m.categoria === m.sugerida ? <i> sugerido</i> : !m.categoria ? <i> escolher</i> : null}</span>}
          </span>
          <span className="titulo">{m.descricao}</span>
          {tag && <span className="tag-imp">{tag}</span>}
        </span>
        <span className={`num ${m.valor > 0 ? 'receita' : bau ? 'guardou' : ''}`}>{m.valor > 0 ? '+' : '−'}{soNumero(Math.abs(m.valor))}</span>
      </button>
    </div>
  );
}

function EditarImportado({ m, categorias, baus, aoMudar, aoFechar }) {
  const [saindo, setSaindo] = useState(false);
  const fechar = () => { if (saindo) return; setSaindo(true); setTimeout(aoFechar, 120); };
  const bau = ['guardar', 'resgatar'].includes(m.tipo);
  const podeAprender = !bau && m.tipo !== 'fora' && m.palavra && m.categoria;
  return (
    <div className={`modal ${saindo ? 'saindo' : ''}`} role="dialog" aria-modal="true" aria-label="Ajustar movimento">
      <div className="modal-fundo" onClick={fechar} />
      <div className="modal-corpo">
        <div className="cartao destaque">
          <p className="secao-titulo" style={{ margin: 0 }}>{(m.operacao || '').toUpperCase()} · {m.valor > 0 ? '+' : '−'}{formatarBRL(Math.abs(m.valor))}</p>
          {m.contraparte && <p className="ajuda" style={{ margin: 0 }}>{m.contraparte}</p>}
          <div className="campo">
            <label htmlFor="imp-desc">Descrição</label>
            <input id="imp-desc" value={m.descricao} maxLength={80} onChange={(e) => aoMudar({ descricao: e.target.value })} autoComplete="off" />
          </div>
          <div className="campo">
            <label htmlFor="imp-tipo">Vira</label>
            <select id="imp-tipo" value={m.tipo} onChange={(e) => aoMudar({ tipo: e.target.value, marcado: e.target.value !== 'fora' })}>
              {(m.valor < 0 ? ['despesa', 'guardar', 'fora'] : ['receita', 'resgatar', 'fora']).map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
            </select>
          </div>
          {bau ? (
            <div className="campo">
              <label htmlFor="imp-bau">Baú</label>
              <select id="imp-bau" value={m.bau} onChange={(e) => aoMudar({ bau: e.target.value })}>
                <option value="">Escolha o baú</option>
                {baus.map((b) => <option key={b.nome} value={b.nome}>{b.nome}</option>)}
              </select>
            </div>
          ) : m.tipo !== 'fora' && (
            <div className="escolha-categoria">
              <div className="categoria-topo">
                <span className="px">CATEGORIA</span>
                <strong className="px">{m.categoria || 'toque num item'}</strong>
              </div>
              <div className="inventario" role="listbox" aria-label="Categoria">
                {categorias.map((c) => (
                  <button key={c.categoria} type="button" role="option" aria-selected={m.categoria === c.categoria}
                    aria-label={c.categoria} title={c.categoria}
                    className={`slot ${m.categoria === c.categoria ? 'escolhido' : ''}`}
                    onClick={() => aoMudar({ categoria: c.categoria, aprender: c.categoria !== m.sugerida && Boolean(m.palavra) })}>
                    <Sprite categoria={c.categoria} receita={m.valor > 0} iniciais />
                  </button>
                ))}
              </div>
            </div>
          )}
          {podeAprender && (
            <label className="aprender">
              <input type="checkbox" checked={m.aprender} onChange={(e) => aoMudar({ aprender: e.target.checked })} />
              <span>Sempre que aparecer <b>"{m.palavra}"</b>, usar <b>{m.categoria}</b></span>
            </label>
          )}
          <div className="botoes">
            <button type="button" className="btn discreto" onClick={() => { aoMudar({ marcado: !m.marcado }); fechar(); }}>
              {m.marcado ? 'Não lançar este' : 'Lançar este'}
            </button>
            <button type="button" className="btn principal" onClick={fechar}>Pronto</button>
          </div>
        </div>
      </div>
    </div>
  );
}
