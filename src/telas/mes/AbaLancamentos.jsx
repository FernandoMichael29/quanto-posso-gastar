import { Fragment, useRef, useState } from 'react';
import Esqueleto from '../../componentes/Esqueleto.jsx';
import Capa from '../../componentes/Capa.jsx';
import { semAcento, soNumero } from '../../lib/parser.js';
import { diaDe } from '../../lib/datas.js';
import { ehFuturo } from './util.js';

/**
 * O que aconteceu no mês: busca, filtro por pessoa e páginas.
 * Quem usa passa key={mes} — mês novo começa com busca e página limpas.
 */
export default function AbaLancamentos({ lista, pessoas, carregando, ocupado, aoAbrir }) {
  const [busca, setBusca] = useState('');
  const [filtroPessoa, setFiltroPessoa] = useState('');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const topo = useRef(null);

  // Sem acento e sem caixa, em tudo que aparece na linha: quem procura
  // "oculos" espera achar "Óculos", e "nubank" pela conta.
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

  function irPara(n) {
    setPagina(Math.min(Math.max(1, n), totalPaginas));
    // Trocar de página sem voltar ao topo da lista deixa você no meio do nada.
    topo.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Filtro novo: a página 4 do resultado antigo não quer dizer nada.
  const filtrar = (set) => (e) => { set(e.target.value); setPagina(1); };

  return (
    <>
      <div className="secao-cabecalho" ref={topo}>
        <p className="secao-titulo" style={{ margin: 0 }}>
          Lançamentos{visiveis.length ? ` · ${visiveis.length}` : ''}
        </p>
        {pessoas.length > 1 && (
          <select className="filtro" value={filtroPessoa} onChange={filtrar(setFiltroPessoa)} aria-label="Filtrar por pessoa">
            <option value="">Todos</option>
            {pessoas.map((p) => <option key={p.nome} value={p.nome}>{p.nome}</option>)}
          </select>
        )}
      </div>

      {/* O X só aparece quando há o que apagar; o campo reserva o espaço dele
          o tempo todo, então o texto nunca corre por baixo do botão. */}
      <div className="busca">
        <input
          type="search"
          value={busca}
          onChange={filtrar(setBusca)}
          placeholder="Procurar por descrição, categoria, conta…"
          aria-label="Procurar nos lançamentos"
          autoComplete="off"
        />
        {busca && (
          <button type="button" className="busca-limpar" onClick={() => { setBusca(''); setPagina(1); }} aria-label="Limpar a busca">
            ×
          </button>
        )}
      </div>

      {carregando ? (
        <Esqueleto modo="lista" />
      ) : visiveis.length === 0 ? (
        <div className="lista">
          <p className="vazio">
            {busca
              ? `Nada encontrado para “${busca}”.`
              : 'Nada registrado neste mês ainda. Toque em Falar e diga um gasto, ou use "Adicionar à mão".'}
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
                className={`item clicavel ${l.status === 'agendado' ? 'agendado' : ''} ${ocupado === `lanc:${l.uuid}` ? 'ocupado' : ''}`}
                onClick={() => aoAbrir(l)}
                disabled={ocupado === `lanc:${l.uuid}`}
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
                  {l.status === 'agendado' && <span className="marca-agendado">agendado · ainda não conta</span>}
                </span>
                <span className={`num ${l.tipo === 'receita' ? 'receita' : ''}`}>
                  {l.tipo === 'receita' ? '+' : '−'}{soNumero(l.valor)}
                </span>
                <Capa quando={ocupado === `lanc:${l.uuid}`} />
              </button>
            </Fragment>
          ))}
        </div>
      )}

      {visiveis.length > 0 && (
        <div className="paginacao">
          <div className="paginas">
            <button type="button" className="btn discreto pequeno" onClick={() => irPara(paginaAtual - 1)}
              disabled={paginaAtual === 1} aria-label="Página anterior">‹</button>
            <span>{inicio + 1}–{inicio + daPagina.length} de {visiveis.length}</span>
            <button type="button" className="btn discreto pequeno" onClick={() => irPara(paginaAtual + 1)}
              disabled={paginaAtual >= totalPaginas} aria-label="Próxima página">›</button>
          </div>

          <label className="por-pagina">
            por página
            <select className="filtro" value={porPagina} onChange={(e) => { setPorPagina(Number(e.target.value)); setPagina(1); }}>
              {[10, 30, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      )}
    </>
  );
}
