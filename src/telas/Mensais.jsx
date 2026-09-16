import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { paraSelecionar } from '../lib/cadastros.js';
import { formatarBRL, semAcento } from '../lib/parser.js';
import Sanfona from '../componentes/Sanfona.jsx';

// Contas fixas e rendas mensais — as regras que se repetem todo mês.
//
// Antes elas só nasciam falando, e não tinha conserto: uma frase mal entendida
// virava uma regra errada que voltava todo mês e não dava para editar nem
// apagar. Aqui elas viram o que sempre foram, uma lista com dono.

export default function Mensais({ cadastros, mes: mesRecebido, aoMudar }) {
  const hoje = new Date();
  const mes = mesRecebido || `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [recado, setRecado] = useState(null);
  const [confirmando, setConfirmando] = useState(null);
  const [filtro, setFiltro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await api.recorrentes(mes);
    setCarregando(false);
    if (r.ok) setLista(r.recorrentes || []);
    else setRecado({ tom: 'ruim', texto: 'Não consegui ler as regras mensais.' });
  }, [mes]);

  useEffect(() => { carregar(); }, [carregar]);

  async function salvar() {
    const campos = {
      nome: editando.nome,
      tipo: editando.tipo,
      valor: Number(editando.valor) || 0,
      dia: editando.dia === '' ? '' : Number(editando.dia),
      categoria: editando.categoria || '',
      conta: editando.conta || '',
      pessoa: editando.pessoa || ''
    };
    setOcupado(true);
    const r = await api.salvarRecorrente(editando._nome, mes, campos);
    setOcupado(false);

    if (r.ok) {
      setEditando(null);
      setRecado({ tom: 'bom', texto: `${campos.nome} atualizado.` });
      carregar();
      aoMudar?.();
    } else {
      setRecado({ tom: 'ruim', texto: TRADUZ[r.erro] || 'Não consegui salvar.' });
    }
  }

  async function apagar(nome) {
    setOcupado(true);
    const r = await api.excluirRecorrente(nome);
    setOcupado(false);
    setConfirmando(null);

    if (r.ok) {
      setEditando(null);
      setRecado({ tom: 'bom', texto: `${nome} apagado. Os lançamentos que já existem continuam lá.` });
      carregar();
      aoMudar?.();
    } else {
      setRecado({ tom: 'ruim', texto: TRADUZ[r.erro] || 'Não consegui apagar.' });
    }
  }

  async function encerrar(nome) {
    setOcupado(true);
    const r = await api.encerrarRecorrente(nome, mes);
    setOcupado(false);
    setConfirmando(null);

    if (r.ok) {
      setEditando(null);
      setRecado({ tom: 'bom', texto: `${nome} vale até ${mes} e não volta depois.` });
      carregar();
      aoMudar?.();
    } else {
      setRecado({ tom: 'ruim', texto: TRADUZ[r.erro] || 'Não consegui encerrar.' });
    }
  }

  const alvo = semAcento(filtro.trim());
  const encontradas = alvo
    ? lista.filter((r) => semAcento([r.nome, r.categoria, r.conta, r.pessoa].filter(Boolean).join(' ')).includes(alvo))
    : lista;
  const rendas = encontradas.filter((r) => r.tipo === 'receita');
  const fixas = encontradas.filter((r) => r.tipo !== 'receita');

  if (editando) {
    const receita = editando.tipo === 'receita';
    const categorias = paraSelecionar(
      (cadastros.categorias || []).filter((c) => !c.tipo || c.tipo === editando.tipo),
      editando.categoria,
      'categoria'
    );

    return (
      <>
        <p className="secao-titulo">Editar · {editando._nome}</p>

        <div className="cartao destaque">
          <div className="valor-linha">
            <span className={`valor ${editando.tipo}`}>{formatarBRL(editando.valor)}</span>
            <button
              type="button"
              className={`etiqueta alternavel ${editando.tipo}`}
              onClick={() => setEditando({
                ...editando,
                tipo: receita ? 'despesa' : 'receita',
                categoria: ''
              })}
              aria-label="Trocar entre entrada e saída"
            >
              {receita ? 'entrada' : 'saída'} ⇄
            </button>
          </div>

          <p className="ajuda">
            {receita
              ? 'Entrada: aparece em "Rendas do mês" e você confirma quando cair.'
              : 'Saída: aparece em "Contas fixas do mês" e o app cobra você dela.'}
          </p>

          <div className="campo">
            <label htmlFor="m-nome">Nome</label>
            <input
              id="m-nome"
              value={editando.nome}
              onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
              autoComplete="off"
            />
          </div>

          <div className="linha">
            <div className="campo">
              <label htmlFor="m-valor">Valor por mês</label>
              <input
                id="m-valor" type="number" inputMode="decimal" step="0.01"
                value={editando.valor}
                onChange={(e) => setEditando({ ...editando, valor: e.target.value })}
              />
            </div>
            <div className="campo">
              <label htmlFor="m-dia">{receita ? 'Cai no dia' : 'Vence no dia'}</label>
              <input
                id="m-dia" type="number" min="1" max="31" inputMode="numeric"
                value={editando.dia || ''}
                placeholder="—"
                onChange={(e) => setEditando({ ...editando, dia: e.target.value })}
              />
            </div>
          </div>

          <div className="linha">
            <div className="campo">
              <label htmlFor="m-categoria">Categoria</label>
              <select
                id="m-categoria"
                value={editando.categoria || ''}
                onChange={(e) => setEditando({ ...editando, categoria: e.target.value })}
              >
                <option value="">—</option>
                {categorias.map((c) => (
                  <option key={c.categoria} value={c.categoria}>
                    {c.categoria}{c.desativado ? ' (desativada)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="m-conta">{receita ? 'Cai em' : 'Pago com'}</label>
              <select
                id="m-conta"
                value={editando.conta || ''}
                onChange={(e) => setEditando({ ...editando, conta: e.target.value })}
              >
                <option value="">—</option>
                {paraSelecionar(cadastros.contas, editando.conta).map((c) => (
                  <option key={c.nome} value={c.nome}>
                    {c.nome}{c.desativado ? ' (desativada)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="campo">
            <label htmlFor="m-pessoa">De quem</label>
            <select
              id="m-pessoa"
              value={editando.pessoa || ''}
              onChange={(e) => setEditando({ ...editando, pessoa: e.target.value })}
            >
              <option value="">—</option>
              {paraSelecionar(cadastros.pessoas, editando.pessoa).map((p) => (
                <option key={p.nome} value={p.nome}>
                  {p.nome}{p.desativado ? ' (desativada)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="botoes">
            <button className="btn discreto" onClick={() => setEditando(null)} disabled={ocupado}>
              Cancelar
            </button>
            <button className="btn principal" onClick={salvar} disabled={ocupado}>
              {ocupado ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>

        {/* Duas saídas diferentes, e a diferença importa: uma conta que acabou
            precisa continuar existindo nos meses em que você pagou. */}
        <div className="cartao">
          <p className="ajuda" style={{ marginTop: 0 }}>
            <strong>Não é mais para cobrar você disso?</strong>
          </p>

          <button
            type="button"
            className="btn discreto"
            onClick={() => setConfirmando({ acao: 'encerrar', nome: editando._nome })}
            disabled={ocupado}
          >
            Encerrar — acabou, vale até este mês
          </button>

          <button
            type="button"
            className="btn perigo"
            onClick={() => setConfirmando({ acao: 'apagar', nome: editando._nome })}
            disabled={ocupado}
          >
            Apagar — foi engano, nunca existiu
          </button>

          <p className="ajuda">
            Apagar tira a regra de todos os meses, inclusive os passados. Os
            lançamentos que você já registrou continuam onde estão.
          </p>
        </div>

        {confirmando && (
          <div className="aviso ruim">
            <strong>
              {confirmando.acao === 'apagar'
                ? `Apagar "${confirmando.nome}" de todos os meses?`
                : `Encerrar "${confirmando.nome}" a partir de ${mes}?`}
            </strong>
            <div className="botoes">
              <button className="btn discreto" onClick={() => setConfirmando(null)} disabled={ocupado}>
                Não
              </button>
              <button
                className="btn perigo"
                disabled={ocupado}
                onClick={() => (confirmando.acao === 'apagar'
                  ? apagar(confirmando.nome)
                  : encerrar(confirmando.nome))}
              >
                {ocupado ? 'Um instante…' : 'Sim, pode'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {recado && (
        <div className={`aviso ${recado.tom}`} role="status">
          <strong>{recado.texto}</strong>
        </div>
      )}

      {carregando && <div className="cartao pensando"><span className="girando" aria-hidden="true" /><span>Lendo as regras…</span></div>}

      {!carregando && lista.length === 0 && (
        <p className="vazio">
          Nada se repete ainda. Fale &ldquo;meu aluguel é 1800 todo mês&rdquo; ou
          &ldquo;recebo 840 de Caju todo mês&rdquo; que a regra nasce sozinha.
        </p>
      )}

      {lista.length > 6 && (
        <div className="busca">
          <input
            type="search"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Procurar uma conta fixa ou renda…"
            aria-label="Procurar nas regras mensais"
            autoComplete="off"
          />
          {filtro && (
            <button type="button" className="busca-limpar" onClick={() => setFiltro('')} aria-label="Limpar a busca">
              ×
            </button>
          )}
        </div>
      )}

      {rendas.length > 0 && (
        <Sanfona
          titulo="Entra todo mês"
          resumo={`${rendas.length} · ${formatarBRL(soma(rendas))}`}
          inicial
        >
          <Grupo itens={rendas} aoEditar={setEditando} />
        </Sanfona>
      )}

      {fixas.length > 0 && (
        <Sanfona
          titulo="Sai todo mês"
          resumo={`${fixas.length} · ${formatarBRL(soma(fixas))}`}
          inicial
        >
          <Grupo itens={fixas} aoEditar={setEditando} />
        </Sanfona>
      )}

      {!carregando && lista.length > 0 && rendas.length + fixas.length === 0 && (
        <p className="vazio">Nada encontrado para &ldquo;{filtro}&rdquo;.</p>
      )}
    </>
  );
}

function soma(itens) {
  return itens.reduce((a, i) => a + i.valor, 0);
}

function Grupo({ itens, aoEditar }) {
  return (
    <div className="lista">
      {itens.map((r) => (
        <button
          type="button"
          className="item clicavel"
          key={r.nome}
          onClick={() => aoEditar({ ...r, _nome: r.nome })}
        >
          <span className="corpo">
            <span className="titulo">{r.nome}</span>
            <span className="meta">
              {[
                r.dia ? `dia ${r.dia}` : 'sem dia',
                r.categoria,
                r.conta,
                r.pessoa,
                r.excecao ? 'valor só deste mês' : null
              ].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className={`num ${r.tipo === 'receita' ? 'receita' : ''}`}>
            {r.tipo === 'receita' ? '+' : '−'}{formatarBRL(r.valor).replace('R$', '').trim()}
          </span>
          <span className="seta" aria-hidden="true">›</span>
        </button>
      ))}
    </div>
  );
}

const TRADUZ = {
  nome_vazio: 'O nome não pode ficar vazio.',
  compromisso_nao_encontrado: 'Essa regra não está mais na planilha.'
};
