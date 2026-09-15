import { useState } from 'react';
import { api } from '../lib/api.js';

// Contas, categorias, fontes de renda e pessoas. Os quatro funcionam igual:
// o primeiro campo é o nome, e desativar não apaga — os lançamentos antigos
// continuam apontando para aquele nome e o histórico segue fazendo sentido.

const TIPOS = {
  contas: {
    rotulo: 'Contas e cartões',
    ajuda: 'Com o que você paga: bancos, cartões, benefícios, espécie. O tipo aqui é o que diz se é crédito, débito ou dinheiro.',
    chave: 'nome',
    opcoes: ['conta corrente', 'credito', 'debito', 'beneficio', 'dinheiro', 'investimento'],
    campoTipo: 'tipo',
    temPessoa: true
  },
  fontes: {
    rotulo: 'Fontes de renda',
    ajuda: 'De onde a renda vem. Aparece só nos lançamentos de entrada.',
    chave: 'nome',
    opcoes: ['salario', 'freela', 'rendimento', 'beneficio', 'outro'],
    campoTipo: 'tipo',
    temPessoa: true
  },
  categorias: {
    rotulo: 'Categorias',
    ajuda: 'Como os gastos são agrupados. As palavras-chave ensinam o app a reconhecer pela fala.',
    chave: 'categoria',
    opcoes: ['despesa', 'receita'],
    campoTipo: 'tipo',
    temPessoa: false
  },
  pessoas: {
    rotulo: 'Pessoas',
    ajuda: 'Quem as contas e rendas pertencem.',
    chave: 'nome',
    opcoes: null,
    temPessoa: false
  }
};

export default function Cadastros({ cadastros, aoMudar }) {
  const [aberto, setAberto] = useState('contas');
  const [editando, setEditando] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [recado, setRecado] = useState(null);

  const def = TIPOS[aberto];
  const itens = cadastros[aberto] || [];

  async function salvar() {
    const nome = String(editando[def.chave] || '').trim();
    if (!nome) { setRecado({ tom: 'ruim', texto: 'O nome não pode ficar vazio.' }); return; }

    setOcupado(true);
    const r = await api.salvarCadastro(aberto, editando, editando._nomeAntigo);
    setOcupado(false);

    if (r.ok) {
      setEditando(null);
      setRecado({ tom: 'bom', texto: r.acao === 'criado' ? `${nome} criado.` : `${nome} atualizado.` });
      aoMudar?.();
    } else {
      setRecado({ tom: 'ruim', texto: r.detalhe || 'Não consegui salvar.' });
    }
  }

  async function alternarAtivo(item) {
    setOcupado(true);
    const r = item.ativo
      ? await api.excluirCadastro(aberto, item[def.chave])
      : await api.salvarCadastro(aberto, { ...item, ativo: true });
    setOcupado(false);
    if (r.ok) aoMudar?.();
    else setRecado({ tom: 'ruim', texto: 'Não consegui mudar isso agora.' });
  }

  return (
    <>
      <div className="abas">
        {Object.keys(TIPOS).map((t) => (
          <button key={t} className={aberto === t ? 'ativa' : ''}
                  onClick={() => { setAberto(t); setEditando(null); setRecado(null); }}>
            {TIPOS[t].rotulo.split(' ')[0]}
          </button>
        ))}
      </div>

      <p className="ajuda">{def.ajuda}</p>

      {recado && (
        <div className={`aviso ${recado.tom}`} role="status">
          <strong>{recado.texto}</strong>
        </div>
      )}

      {editando ? (
        <div className="cartao destaque">
          <div className="campo">
            <label htmlFor="cad-nome">Nome</label>
            <input
              id="cad-nome"
              value={editando[def.chave] || ''}
              onChange={(e) => setEditando({ ...editando, [def.chave]: e.target.value })}
              autoComplete="off"
            />
          </div>

          {def.opcoes && (
            <div className="campo">
              <label htmlFor="cad-tipo">Tipo</label>
              <select
                id="cad-tipo"
                value={editando[def.campoTipo] || ''}
                onChange={(e) => setEditando({ ...editando, [def.campoTipo]: e.target.value })}
              >
                <option value="">—</option>
                {def.opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}

          {def.temPessoa && (
            <div className="campo">
              <label htmlFor="cad-pessoa">De quem</label>
              <select
                id="cad-pessoa"
                value={editando.pessoa || ''}
                onChange={(e) => setEditando({ ...editando, pessoa: e.target.value })}
              >
                <option value="">—</option>
                {(cadastros.pessoas || []).map((p) => (
                  <option key={p.nome} value={p.nome}>{p.nome}</option>
                ))}
              </select>
            </div>
          )}

          {aberto === 'contas' && (
            <div className="campo">
              <label htmlFor="cad-saldo">Saldo inicial</label>
              <input
                id="cad-saldo" type="number" inputMode="decimal" step="0.01"
                value={editando.saldo_inicial ?? 0}
                onChange={(e) => setEditando({ ...editando, saldo_inicial: Number(e.target.value) })}
              />
            </div>
          )}

          {aberto === 'categorias' && (
            <>
              <div className="campo">
                <label htmlFor="cad-grupo">Grupo</label>
                <input
                  id="cad-grupo"
                  value={editando.grupo || ''}
                  placeholder="Essencial, Fixo, Variável…"
                  onChange={(e) => setEditando({ ...editando, grupo: e.target.value })}
                />
              </div>
              <div className="campo">
                <label htmlFor="cad-palavras">Palavras que disparam esta categoria</label>
                <input
                  id="cad-palavras"
                  value={editando.palavras_chave || ''}
                  placeholder="uber, 99, gasolina, posto"
                  onChange={(e) => setEditando({ ...editando, palavras_chave: e.target.value })}
                />
              </div>
              <div className="campo">
                <label htmlFor="cad-orcamento">Teto por mês (opcional)</label>
                <input
                  id="cad-orcamento" type="number" inputMode="decimal" step="0.01"
                  value={editando.orcamento_mes ?? ''}
                  onChange={(e) => setEditando({ ...editando, orcamento_mes: e.target.value })}
                />
              </div>
            </>
          )}

          <div className="botoes">
            <button className="btn discreto" onClick={() => setEditando(null)} disabled={ocupado}>
              Cancelar
            </button>
            <button className="btn principal" onClick={salvar} disabled={ocupado}>
              {ocupado ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn principal"
          onClick={() => setEditando({ [def.chave]: '', ativo: true })}
        >
          + Adicionar
        </button>
      )}

      <div className="lista">
        {itens.length === 0 && <p className="vazio">Nada cadastrado ainda.</p>}
        {itens.map((item) => (
          <div className={`item ${item.ativo ? '' : 'inativo'}`} key={item[def.chave]}>
            <span className="corpo">
              <span className="titulo">{item[def.chave]}</span>
              <span className="meta">
                {[item.tipo, item.pessoa, item.ativo ? null : 'desativado'].filter(Boolean).join(' · ') || '—'}
              </span>
            </span>
            <button
              className="btn discreto pequeno"
              onClick={() => setEditando({ ...item, _nomeAntigo: item[def.chave] })}
              disabled={ocupado}
            >
              editar
            </button>
            <button
              className="btn discreto pequeno"
              onClick={() => alternarAtivo(item)}
              disabled={ocupado}
            >
              {item.ativo ? 'desativar' : 'reativar'}
            </button>
          </div>
        ))}
      </div>

      <p className="ajuda">
        Dá pra fazer tudo isso falando também: &ldquo;adiciona o cartão Inter&rdquo;,
        &ldquo;cria a categoria Viagem&rdquo;, &ldquo;não uso mais o Santander&rdquo;.
      </p>
    </>
  );
}
