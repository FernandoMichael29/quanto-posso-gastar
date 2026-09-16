import { useState } from 'react';
import { formatarBRL } from '../lib/parser.js';
import { paraSelecionar } from '../lib/cadastros.js';

// O mesmo cartão em três lugares: quando você acabou de falar um gasto e vai
// confirmar, quando cria um na mão, e quando toca num lançamento da lista do
// mês para corrigir. Um formulário só, um comportamento só — o que muda entre
// eles são os rótulos e o que faz sentido editar em cada momento.

export default function CartaoLancamento({
  valor,            // o lançamento em edição
  aoMudar,          // (novoLancamento) => void
  cadastros,        // { categorias, contas, fontes, pessoas }
  modo = 'confirmar',   // 'novo' | 'confirmar' | 'editar'
  aoConfirmar,
  aoCancelar,
  aoExcluir,
  aoTornarMensal,
  rotuloCancelar,
  permiteParcelar = true,
  ocupado = false
}) {
  const l = valor;
  const receita = l.tipo === 'receita';
  const mudar = (campo) => (e) => aoMudar({ ...l, [campo]: e.target.value });

  const categorias = paraSelecionar(
    (cadastros.categorias || []).filter((c) => !c.tipo || c.tipo === l.tipo),
    l.categoria,
    'categoria'
  );
  // Parcelar só faz sentido antes de existir: depois de gravado, o parcelamento
  // já virou N linhas na planilha, e mexer no número aqui deixaria as irmãs
  // desencontradas. Para mudar, exclui a compra e lança de novo.
  const podeParcelar = permiteParcelar && !receita && modo !== 'editar';

  // O "quantas vezes" é digitado, e digitar passa por estados inválidos: para
  // escrever 10 você digita 1 antes. Se o campo corrigir a cada tecla, o 1 vira
  // 2 e o 0 seguinte vira 20 — foi o que acontecia. Então o texto cru mora aqui,
  // e o conserto só acontece quando você sai do campo.
  const [parcelar, setParcelar] = useState(() => Number(valor.parcelas_total) > 1);
  const [vezes, setVezes] = useState(
    () => (Number(valor.parcelas_total) > 1 ? String(valor.parcelas_total) : '2')
  );

  const nVezes = Number(vezes) || 0;
  const parcelado = podeParcelar ? (parcelar && nVezes > 1) : Number(l.parcelas_total) > 1;
  const jaGravado = modo === 'editar' && Boolean(l.parcela_atual);
  const quantas = podeParcelar ? nVezes : Number(l.parcelas_total) || 0;

  // Antes de gravar, `valor` é o total da compra; depois de gravada, cada linha
  // já é uma parcela. Por isso o rótulo muda entre os dois momentos.
  const valorParcela = parcelado && !jaGravado && quantas > 1
    ? Number(l.valor) / quantas
    : Number(l.valor);

  // Os três números conversam: total, vezes e parcela. Você mexe em qualquer um
  // e os outros se ajustam — porque às vezes a etiqueta diz "10x de 89,90" e
  // às vezes diz "899,00 em 10x", e fazer a conta de cabeça é trabalho do app.
  const [parcelaTexto, setParcelaTexto] = useState(
    () => textoDe(dividir(valor.valor, valor.parcelas_total))
  );

  function marcarParcelado(marcado) {
    setParcelar(marcado);
    const n = marcado ? (nVezes > 1 ? nVezes : 2) : 0;
    if (marcado && nVezes < 2) setVezes('2');
    setParcelaTexto(marcado ? textoDe(dividir(l.valor, n)) : '');
    aoMudar({
      ...l,
      parcelas_total: marcado ? n : null,
      parcela_atual: marcado ? 1 : null
    });
  }

  function digitarVezes(texto) {
    const limpo = texto.replace(/\D/g, '').slice(0, 2);
    setVezes(limpo);
    const n = Number(limpo);
    // Mexer no número de vezes recalcula a parcela, nunca o total: o que você
    // combinou com a loja foi o preço da compra.
    setParcelaTexto(textoDe(dividir(l.valor, n)));
    // Enquanto o número ainda não faz sentido, o lançamento fica sem
    // parcelamento — mas a caixa continua marcada e o campo, aberto.
    aoMudar({
      ...l,
      parcelas_total: n > 1 ? n : null,
      parcela_atual: n > 1 ? 1 : null
    });
  }

  /** Só aqui o número é ajustado para a faixa válida. */
  function arrumarVezes() {
    const n = Math.min(60, Math.max(2, Number(vezes) || 2));
    setVezes(String(n));
    setParcelaTexto(textoDe(dividir(l.valor, n)));
    aoMudar({ ...l, parcelas_total: n, parcela_atual: 1 });
  }

  /** Mexeu no total: a parcela é consequência. */
  function digitarTotal(texto) {
    aoMudar({ ...l, valor: texto });
    if (parcelar) setParcelaTexto(textoDe(dividir(texto, nVezes)));
  }

  /** Mexeu na parcela: o total é consequência. */
  function digitarParcela(texto) {
    setParcelaTexto(texto);
    const p = Number(String(texto).replace(',', '.'));
    if (nVezes > 1 && p) aoMudar({ ...l, valor: arredondar(p * nVezes) });
  }

  // Nem todo total divide certinho: 100 em 3x dá 33,33 com um centavo sobrando.
  // Quem fica com ele é a primeira parcela, como o cartão faz — e é melhor
  // dizer isso do que deixar você conferir a conta e achar que o app errou.
  const parcelaExibida = Number(String(parcelaTexto).replace(',', '.')) || 0;
  const sobra = parcelado && nVezes > 1
    ? arredondar(Number(l.valor) - parcelaExibida * nVezes)
    : 0;

  // Confirmar com "1 vez" digitado gravaria uma compra sem parcelamento sem
  // você perceber. Melhor segurar o botão e dizer o porquê.
  const parcelamentoIncompleto = podeParcelar && parcelar && nVezes < 2;

  const contas = paraSelecionar(cadastros.contas, l.conta);
  const fontes = paraSelecionar(cadastros.fontes, l.fonte);
  const pessoas = paraSelecionar(cadastros.pessoas, l.pessoa);

  return (
    <div className="cartao destaque">
      <div className="valor-linha">
        <span className={`valor ${l.tipo}`}>{formatarBRL(l.valor)}</span>
        <button
          type="button"
          className={`etiqueta alternavel ${l.tipo}`}
          onClick={() => aoMudar({
            ...l,
            tipo: receita ? 'despesa' : 'receita',
            categoria: '',
            fonte: receita ? '' : l.fonte
          })}
          aria-label="Trocar entre entrada e saída"
        >
          {receita ? 'entrada' : 'saída'} ⇄
        </button>
        {parcelado && (
          <span className="etiqueta">
            {jaGravado
              ? `parcela ${l.parcela_atual} de ${l.parcelas_total}`
              : `${quantas}× de ${formatarBRL(valorParcela)}`}
          </span>
        )}
      </div>

      {l.motivo && <p className="ajuda">{l.motivo}</p>}

      {/* Antes de gravar, deixo claro o que vai acontecer: a compra não pesa
          inteira neste mês, ela vira uma parcela por mês. */}
      {parcelado && modo !== 'editar' && (
        <p className="ajuda">
          Vira {quantas} lançamentos de {formatarBRL(valorParcela)}, um por mês —
          este mês conta só a primeira.
        </p>
      )}

      {parcelado && jaGravado && (
        <p className="ajuda">
          Categoria, descrição e conta valem para as {l.parcelas_total} parcelas.
          Valor e data mudam só nesta.
        </p>
      )}

      <div className="campo">
        <label htmlFor="c-descricao">Descrição</label>
        <input id="c-descricao" value={l.descricao || ''} onChange={mudar('descricao')} />
      </div>

      <div className="linha">
        <div className="campo">
          <label htmlFor="c-valor">{parcelado && !jaGravado ? 'Valor total' : 'Valor'}</label>
          <input
            id="c-valor" type="number" inputMode="decimal" step="0.01"
            value={l.valor ?? ''}
            placeholder="0,00"
            onChange={(e) => digitarTotal(e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="c-data">Data</label>
          <input id="c-data" type="date" value={l.data || ''} onChange={mudar('data')} />
        </div>
      </div>

      {/* O valor digitado é sempre o da compra inteira, e o app divide. Pedir o
          valor da parcela pareceria mais direto, mas aí quem tem que fazer a
          multiplicação é você, e 3× de 33,33 nunca fecha os 100. */}
      {podeParcelar && (
        <div className="parcelar">
          <label className="repete-linha">
            <input
              type="checkbox"
              checked={parcelar}
              onChange={(e) => marcarParcelado(e.target.checked)}
            />
            <span>
              Parcelado
              <em>o valor acima é o total; eu divido em uma parcela por mês</em>
            </span>
          </label>

          {parcelar && (
            <div className="linha">
              <div className="campo">
                <label htmlFor="c-parcelas">Em quantas vezes</label>
                <input
                  id="c-parcelas"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={vezes}
                  onChange={(e) => digitarVezes(e.target.value)}
                  onBlur={arrumarVezes}
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <div className="campo">
                <label htmlFor="c-parcela">Cada parcela</label>
                <input
                  id="c-parcela" type="number" inputMode="decimal" step="0.01"
                  value={parcelaTexto}
                  placeholder={nVezes > 1 ? '0,00' : 'de 2 a 60 vezes'}
                  disabled={nVezes < 2}
                  onChange={(e) => digitarParcela(e.target.value)}
                />
              </div>
            </div>
          )}

          {Math.abs(sobra) >= 0.01 && (
            <p className="ajuda" style={{ margin: 0 }}>
              {sobra > 0
                ? `Não divide exato: a primeira parcela fica ${formatarBRL(parcelaExibida + sobra)}.`
                : `Assim o total vira ${formatarBRL(parcelaExibida * nVezes)}.`}
            </p>
          )}
        </div>
      )}

      <div className="linha">
        <div className="campo">
          <label htmlFor="c-categoria">Categoria</label>
          <select id="c-categoria" value={l.categoria || ''} onChange={mudar('categoria')}>
            <option value="">—</option>
            {categorias.map((c) => (
              <option key={c.categoria} value={c.categoria}>
                {c.categoria}{c.desativado ? ' (desativada)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="c-conta">{receita ? 'Caiu em' : 'Pago com'}</label>
          <select id="c-conta" value={l.conta || ''} onChange={mudar('conta')}>
            <option value="">—</option>
            {contas.map((c) => (
              <option key={c.nome} value={c.nome}>
                {c.nome}{c.desativado ? ' (desativada)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={receita ? 'linha' : ''}>
        {receita && (
          <div className="campo">
            <label htmlFor="c-fonte">Fonte da renda</label>
            <select id="c-fonte" value={l.fonte || ''} onChange={mudar('fonte')}>
              <option value="">—</option>
              {fontes.map((f) => (
                <option key={f.nome} value={f.nome}>
                  {f.nome}{f.desativado ? ' (desativada)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="campo">
          <label htmlFor="c-pessoa">De quem</label>
          <select id="c-pessoa" value={l.pessoa || ''} onChange={mudar('pessoa')}>
            <option value="">—</option>
            {pessoas.map((p) => (
              <option key={p.nome} value={p.nome}>
                {p.nome}{p.desativado ? ' (desativada)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {l.extras?.length > 0 && (
        <div className="aviso bom">
          <strong>+{l.extras.length} lançamento{l.extras.length > 1 ? 's' : ''} na mesma frase</strong>
          <span className="detalhe">
            {l.extras.map((e) => `${e.categoria} ${formatarBRL(e.valor)}`).join(' · ')}
          </span>
        </div>
      )}

      {/* Sempre visível e sempre desmarcado. Um palpite do app sobre o que se
          repete erraria justamente nos casos ambíguos; um toque não erra.
          Vale para os dois lados: salário também é coisa que volta todo mês. */}
      {modo !== 'editar' && !parcelado && (
        <label className="repete-linha">
          <input
            type="checkbox"
            checked={Boolean(l.repete)}
            onChange={(e) => aoMudar({ ...l, repete: e.target.checked })}
          />
          <span>
            {receita ? 'Recebo todo mês' : 'Repete todo mês'}
            <em>
              {receita
                ? 'vira renda mensal, e o app passa a esperar por ela'
                : 'vira conta fixa, e o app passa a cobrar você dela'}
            </em>
          </span>
        </label>
      )}

      {modo === 'editar' && aoTornarMensal && !parcelado && (
        <button type="button" className="btn repetir" onClick={aoTornarMensal} disabled={ocupado}>
          ↻ {receita ? 'Esta renda entra todo mês' : 'Este gasto se repete todo mês'}
        </button>
      )}

      {l.texto_falado && modo === 'editar' && (
        <p className="ajuda">Você falou: &ldquo;{l.texto_falado}&rdquo;</p>
      )}

      <div className="botoes">
        {modo === 'editar' && aoExcluir && (
          <button type="button" className="btn perigo" onClick={aoExcluir} disabled={ocupado}>
            {parcelado ? `Excluir as ${l.parcelas_total}` : 'Excluir'}
          </button>
        )}
        <button type="button" className="btn discreto" onClick={aoCancelar} disabled={ocupado}>
          {rotuloCancelar || (modo === 'editar' ? 'Fechar' : 'Descartar')}
        </button>
        <button
          type="button"
          className="btn principal"
          onClick={aoConfirmar}
          disabled={ocupado || !Number(l.valor) || parcelamentoIncompleto}
        >
          {ocupado ? 'Salvando…' : ROTULO_OK[modo] || 'Confirmar'}
        </button>
      </div>
    </div>
  );
}

const ROTULO_OK = { novo: 'Adicionar', confirmar: 'Confirmar', editar: 'Salvar' };

/** Divide o total pelas vezes, com duas casas. Sem vezes válidas, dá vazio. */
function dividir(total, vezes) {
  const t = Number(String(total ?? '').replace(',', '.'));
  const n = Number(vezes);
  if (!t || !n || n < 2) return null;
  return arredondar(t / n);
}

function arredondar(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function textoDe(v) {
  return v == null ? '' : String(v);
}
