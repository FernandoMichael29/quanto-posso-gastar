import { useEffect, useMemo, useState } from 'react';
import Item, { Sprite } from '../componentes/Item.jsx';
import { chaveAprendivel, formatarBRL, soNumero, sugerirCategoria } from '../lib/parser.js';
import { diaOuHoje, hojeISO } from '../lib/datas.js';
import { enfileirar, ESTADO, novoId, remover } from '../lib/db.js';
import { api, configurado } from '../lib/api.js';
import { sincronizar } from '../lib/sync.js';
import { ativos, paraSelecionar } from '../lib/cadastros.js';
import { CATEGORIAS_PADRAO } from '../lib/categorias.js';

// A tela principal: registrar um gasto ou uma entrada à mão.
//
// Ela substituiu o microfone. Na prática o lançamento era sempre feito no
// formulário — no celular o teclado já dita, e falar com gente por perto não
// rola. Então o formulário virou a primeira coisa da tela, com o que se usa
// sempre à vista (valor, descrição, categoria, dia, conta) e o resto
// (parcelar, de quem, fonte, repetir) guardado em "Mais opções".

const CHAVE_CONTA = 'qpg.ultimaConta';

function lembrar(chave) {
  try { return localStorage.getItem(chave) || ''; } catch { return ''; }
}

function ontemISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

const vazio = (tipo, conta) => ({
  tipo, valor: 0, descricao: '', categoria: '', data: hojeISO(), conta: conta || '', pessoa: '', fonte: ''
});

export default function Novo({ cadastros, resumo, aoMudarFila }) {
  const [l, setL] = useState(() => vazio('despesa', lembrar(CHAVE_CONTA)));
  // O que as palavras-chave sugerem para a descrição — e se você já tocou num
  // item, caso em que a sugestão para de mexer na sua escolha.
  const [sugerida, setSugerida] = useState('');
  const [naMao, setNaMao] = useState(false);
  const [outroDia, setOutroDia] = useState(false);
  const [parcelado, setParcelado] = useState(false);
  const [vezes, setVezes] = useState('2');
  // A etiqueta às vezes diz "899 em 10x" e às vezes "10x de 89,90": você
  // digita o número que tem na frente e o app faz a conta do outro.
  const [ehParcela, setEhParcela] = useState(false);
  const [repete, setRepete] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState(null);

  const receita = l.tipo === 'receita';
  const todas = cadastros.categorias?.length ? cadastros.categorias : CATEGORIAS_PADRAO;
  const categorias = useMemo(
    () => ativos(todas).filter((c) => !c.tipo || c.tipo === l.tipo),
    [todas, l.tipo]
  );
  const contas = paraSelecionar(cadastros.contas, l.conta);
  const pessoas = paraSelecionar(cadastros.pessoas, l.pessoa);
  const fontes = paraSelecionar(cadastros.fontes, l.fonte);
  const mudar = (campo) => (e) => {
    const valor = e.target.value;
    setL((x) => ({ ...x, [campo]: valor }));
  };

  // Enquanto você digita, as suas palavras-chave escolhem o item.
  useEffect(() => {
    const s = sugerirCategoria(l.descricao, categorias, l.tipo);
    setSugerida(s);
    if (!naMao) setL((x) => (x.categoria === s ? x : { ...x, categoria: s }));
  }, [l.descricao, l.tipo, naMao, categorias]);

  // O "Desfazer" vive 10 s; depois disso o recado fica, só sem o botão.
  useEffect(() => {
    if (!recado?.desfazer) return;
    const t = setTimeout(() => setRecado((r) => (r ? { ...r, desfazer: null } : r)), 10000);
    return () => clearTimeout(t);
  }, [recado?.desfazer]);

  function trocarTipo(tipo) {
    if (tipo === l.tipo) return;
    setNaMao(false);
    setParcelado(false);
    setRepete(false);
    setL((x) => ({ ...x, tipo, categoria: '', fonte: '' }));
  }

  function escolher(categoria) {
    setNaMao(true);
    setL((x) => ({ ...x, categoria: x.categoria === categoria ? '' : categoria }));
  }

  /** Só dígitos, e os dois últimos são os centavos: 4200 vira 42,00. */
  function digitarValor(e) {
    const digitos = e.target.value.replace(/\D/g, '').slice(0, 11);
    setL((x) => ({ ...x, valor: Number(digitos) / 100 }));
  }

  const n = Math.min(60, Number(vezes) || 0);
  const comParcelas = !receita && parcelado && n >= 2;
  const total = comParcelas && ehParcela ? arredondar(l.valor * n) : l.valor;
  const cadaParcela = comParcelas ? (ehParcela ? l.valor : arredondar(l.valor / n)) : 0;
  // Marcar "parcelado" e deixar 1 vez gravaria uma compra à vista sem você notar.
  const parcelamentoIncompleto = !receita && parcelado && n < 2;
  const pronto = l.valor > 0 && !salvando && !parcelamentoIncompleto;

  async function registrar() {
    if (!pronto) return;
    setSalvando(true);
    // Toda escolha diferente do que as palavras-chave disseram vira palavra-chave
    // nova — inclusive quando elas não disseram nada.
    const palavra = chaveAprendivel(l.descricao);
    const aprender = Boolean(l.categoria && l.categoria !== sugerida && palavra);
    const uuid = novoId();
    await enfileirar({
      uuid,
      estado: ESTADO.PENDENTE,
      texto: '',
      lancamento: {
        tipo: l.tipo,
        valor: total,
        descricao: l.descricao.trim(),
        categoria: l.categoria,
        data: l.data,
        conta: l.conta,
        pessoa: l.pessoa,
        fonte: receita ? l.fonte : '',
        parcelas_total: comParcelas ? n : null,
        parcela_atual: comParcelas ? 1 : null,
        repete: !comParcelas && repete,
        origem: 'manual',
        aprender_categoria: aprender
      }
    });
    try { if (l.conta) localStorage.setItem(CHAVE_CONTA, l.conta); } catch { /* sem armazenamento, só não lembra */ }

    setRecado({
      tom: 'bom',
      titulo: comParcelas
        ? `Guardado: ${n}× de ${formatarBRL(cadaParcela)}`
        : `Guardado: ${receita ? '+' : '−'}${formatarBRL(total)}`,
      detalhe: aprender ? `Aprendi: “${palavra}” agora é ${l.categoria}.` : undefined,
      desfazer: [uuid]
    });
    // Recomeça limpo, mas mantém o que costuma se repetir de um para o outro.
    setL(vazio(l.tipo, l.conta));
    setNaMao(false);
    setOutroDia(false);
    setParcelado(false);
    setEhParcela(false);
    setVezes('2');
    setRepete(false);
    setSalvando(false);
    aoMudarFila?.();
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
      // "não encontrado" pode ser envio ainda em trânsito; duas novas
      // tentativas (3 s e 8 s) cobrem o envio normal.
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

  const hoje = hojeISO();
  const ontem = ontemISO();

  return (
    <>
      {recado && (
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
      )}

      <div className="cartao novo">
        <div className="alterna">
          <button type="button" className={`px ${!receita ? 'on gasto' : ''}`} aria-pressed={!receita} onClick={() => trocarTipo('despesa')}>
            − GASTO
          </button>
          <button type="button" className={`px ${receita ? 'on entrada' : ''}`} aria-pressed={receita} onClick={() => trocarTipo('receita')}>
            + ENTRADA
          </button>
        </div>

        {/* O número grande é o próprio campo, como no confirmar renda. */}
        <label className={`valor-px ${l.valor ? '' : 'zerado'}`}>
          <span className="moeda px">R$</span>
          <input
            className="px"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Valor, em reais"
            value={soNumero(l.valor)}
            onChange={digitarValor}
          />
        </label>

        <div className="campo">
          <label htmlFor="novo-descricao">O que foi</label>
          <input
            id="novo-descricao"
            value={l.descricao}
            onChange={mudar('descricao')}
            placeholder={receita ? 'salário, freela, pix do João…' : 'mercado, uber, almoço…'}
            autoComplete="off"
          />
        </div>

        <div className="escolha-categoria">
          <div className="categoria-topo">
            <span className="px">CATEGORIA</span>
            <strong className="px">{l.categoria || 'toque num item'}</strong>
          </div>
          <div className="inventario" role="listbox" aria-label="Categoria">
            {categorias.map((c) => (
              <button
                key={c.categoria}
                type="button"
                role="option"
                aria-selected={l.categoria === c.categoria}
                aria-label={c.categoria}
                title={c.categoria}
                className={`slot ${l.categoria === c.categoria ? 'escolhido' : ''}`}
                onClick={() => escolher(c.categoria)}
              >
                <Sprite categoria={c.categoria} receita={receita} iniciais />
              </button>
            ))}
          </div>
          {!naMao && sugerida && l.categoria === sugerida && (
            <p className="ajuda" style={{ margin: 0 }}>Escolhido pela descrição — toque em outro item se não for.</p>
          )}
        </div>

        <div className="chips">
          <button type="button" className={`chip ${!outroDia && l.data === hoje ? 'on' : ''}`}
            onClick={() => { setOutroDia(false); setL((x) => ({ ...x, data: hoje })); }}>
            hoje
          </button>
          <button type="button" className={`chip ${!outroDia && l.data === ontem ? 'on' : ''}`}
            onClick={() => { setOutroDia(false); setL((x) => ({ ...x, data: ontem })); }}>
            ontem
          </button>
          <button type="button" className={`chip ${outroDia ? 'on' : ''}`} onClick={() => setOutroDia(true)}>
            {outroDia ? diaOuHoje(l.data) : 'outro dia…'}
          </button>
          <select className="chip" value={l.conta} onChange={mudar('conta')} aria-label={receita ? 'Caiu em' : 'Pago com'}>
            <option value="">{receita ? 'caiu em…' : 'pago com…'}</option>
            {contas.map((c) => (
              <option key={c.nome} value={c.nome}>{c.nome}{c.desativado ? ' (desativada)' : ''}</option>
            ))}
          </select>
        </div>

        {outroDia && (
          <div className="campo">
            <label htmlFor="novo-data">Dia</label>
            <input id="novo-data" type="date" value={l.data} onChange={mudar('data')} />
          </div>
        )}

        <details className="opcional">
          <summary>Mais opções <span>({receita ? 'fonte, de quem, todo mês' : 'parcelar, de quem, todo mês'})</span></summary>
          <div style={{ display: 'grid', gap: 'var(--e3)' }}>
            {!receita && (
              <label className="repete-linha">
                <input type="checkbox" checked={parcelado} onChange={(e) => setParcelado(e.target.checked)} />
                <span>
                  Parcelado
                  <em>vira um lançamento por mês — este mês conta só a primeira parcela</em>
                </span>
              </label>
            )}

            {!receita && parcelado && (
              <>
                <div className="linha">
                  <div className="campo">
                    <label htmlFor="novo-vezes">Em quantas vezes</label>
                    <input id="novo-vezes" type="text" inputMode="numeric" autoComplete="off" value={vezes}
                      onChange={(e) => setVezes(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      onFocus={(e) => e.target.select()} />
                  </div>
                  <div className="campo">
                    <label>O valor digitado é</label>
                    <div className="chips">
                      <button type="button" className={`chip ${!ehParcela ? 'on' : ''}`} onClick={() => setEhParcela(false)}>o total</button>
                      <button type="button" className={`chip ${ehParcela ? 'on' : ''}`} onClick={() => setEhParcela(true)}>cada parcela</button>
                    </div>
                  </div>
                </div>
                <p className="ajuda" style={{ margin: 0 }}>
                  {comParcelas && l.valor > 0
                    ? `${n}× de ${formatarBRL(cadaParcela)} · total ${formatarBRL(total)}`
                    : 'De 2 a 60 vezes.'}
                </p>
              </>
            )}

            {receita && (
              <div className="campo">
                <label htmlFor="novo-fonte">Fonte da renda</label>
                <select id="novo-fonte" value={l.fonte} onChange={mudar('fonte')}>
                  <option value="">—</option>
                  {fontes.map((f) => <option key={f.nome} value={f.nome}>{f.nome}{f.desativado ? ' (desativada)' : ''}</option>)}
                </select>
              </div>
            )}

            <div className="campo">
              <label htmlFor="novo-pessoa">De quem</label>
              <select id="novo-pessoa" value={l.pessoa} onChange={mudar('pessoa')}>
                <option value="">—</option>
                {pessoas.map((p) => <option key={p.nome} value={p.nome}>{p.nome}{p.desativado ? ' (desativada)' : ''}</option>)}
              </select>
            </div>

            {!comParcelas && (
              <label className="repete-linha">
                <input type="checkbox" checked={repete} onChange={(e) => setRepete(e.target.checked)} />
                <span>
                  {receita ? 'Recebo todo mês' : 'Repete todo mês'}
                  <em>{receita ? 'vira renda mensal, e o app passa a esperar por ela' : 'vira conta fixa, e o app passa a cobrar você dela'}</em>
                </span>
              </label>
            )}
          </div>
        </details>

        <button type="button" className={`btn-px ${receita ? 'entrada' : ''}`} onClick={registrar} disabled={!pronto}>
          {salvando ? 'GUARDANDO…' : 'REGISTRAR'}
        </button>
      </div>

      {resumo && (
        <>
          <p className="secao-titulo">Este mês</p>
          <div className="resumo">
            <div><span className="r">Recebi</span><span className="v pos">{soNumero(resumo.receitas)}</span></div>
            <div><span className="r">Gastei</span><span className="v">{soNumero(resumo.despesas)}</span></div>
            <div><span className="r">Sobrou</span><span className={`v ${resumo.saldo >= 0 ? 'pos' : 'neg'}`}>{soNumero(resumo.saldo)}</span></div>
          </div>
        </>
      )}

      {resumo?.ultimos?.length > 0 && (
        <>
          <p className="secao-titulo">Últimos itens</p>
          <div className="lista">
            {resumo.ultimos.slice(0, 5).map((u) => (
              <div className="item extrato" key={u.uuid}>
                <Item categoria={u.categoria} receita={u.tipo === 'receita'} />
                <span className="corpo">
                  <span className="meta">{u.categoria || 'Sem categoria'} · {diaOuHoje(u.data)}</span>
                  <span className="titulo">{u.descricao || u.categoria}</span>
                </span>
                <span className={`num ${u.tipo === 'receita' ? 'receita' : ''}`}>
                  {u.tipo === 'receita' ? '+' : '−'}{soNumero(u.valor)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function arredondar(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}
