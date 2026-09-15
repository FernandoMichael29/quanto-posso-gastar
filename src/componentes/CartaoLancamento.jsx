import { formatarBRL } from '../lib/parser.js';
import { paraSelecionar } from '../lib/cadastros.js';

// O mesmo cartão em dois lugares: quando você acabou de falar um gasto e vai
// confirmar, e quando toca num lançamento da lista do mês para corrigir.
// Um formulário só, um comportamento só.

export default function CartaoLancamento({
  valor,            // o lançamento em edição
  aoMudar,          // (novoLancamento) => void
  cadastros,        // { categorias, contas, fontes, pessoas }
  modo = 'confirmar',
  aoConfirmar,
  aoCancelar,
  aoExcluir,
  aoTornarMensal,
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
        {l.parcelas_total > 1 && (
          <span className="etiqueta">
            {l.parcelas_total}× de {formatarBRL(l.valor / l.parcelas_total)}
          </span>
        )}
      </div>

      {l.motivo && <p className="ajuda">{l.motivo}</p>}

      <div className="campo">
        <label htmlFor="c-descricao">Descrição</label>
        <input id="c-descricao" value={l.descricao || ''} onChange={mudar('descricao')} />
      </div>

      <div className="linha">
        <div className="campo">
          <label htmlFor="c-valor">Valor</label>
          <input
            id="c-valor" type="number" inputMode="decimal" step="0.01"
            value={l.valor}
            onChange={(e) => aoMudar({ ...l, valor: Number(e.target.value) })}
          />
        </div>
        <div className="campo">
          <label htmlFor="c-data">Data</label>
          <input id="c-data" type="date" value={l.data || ''} onChange={mudar('data')} />
        </div>
      </div>

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

      {/* Sempre visível e sempre desmarcado. Um palpite do app sobre o que é
          conta fixa erraria justamente nos casos ambíguos; um toque não erra. */}
      {modo === 'confirmar' && !receita && (
        <label className="repete-linha">
          <input
            type="checkbox"
            checked={Boolean(l.repete)}
            onChange={(e) => aoMudar({ ...l, repete: e.target.checked })}
          />
          <span>
            Repete todo mês
            <em>vira conta fixa, e o app passa a cobrar você dela</em>
          </span>
        </label>
      )}

      {modo === 'editar' && aoTornarMensal && (
        <button type="button" className="btn repetir" onClick={aoTornarMensal} disabled={ocupado}>
          ↻ Este gasto se repete todo mês
        </button>
      )}

      {l.texto_falado && modo === 'editar' && (
        <p className="ajuda">Você falou: &ldquo;{l.texto_falado}&rdquo;</p>
      )}

      <div className="botoes">
        {modo === 'editar' && aoExcluir && (
          <button type="button" className="btn perigo" onClick={aoExcluir} disabled={ocupado}>
            Excluir
          </button>
        )}
        <button type="button" className="btn discreto" onClick={aoCancelar} disabled={ocupado}>
          {modo === 'editar' ? 'Fechar' : 'Descartar'}
        </button>
        <button type="button" className="btn principal" onClick={aoConfirmar} disabled={ocupado}>
          {ocupado ? 'Salvando…' : (modo === 'editar' ? 'Salvar' : 'Confirmar')}
        </button>
      </div>
    </div>
  );
}
