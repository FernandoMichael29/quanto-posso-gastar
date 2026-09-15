import { useCallback, useEffect, useState } from 'react';
import Barras from '../componentes/Barras.jsx';
import GraficoEvolucao from '../componentes/GraficoEvolucao.jsx';
import CartaoLancamento from '../componentes/CartaoLancamento.jsx';
import { api, configurado } from '../lib/api.js';
import { formatarBRL } from '../lib/parser.js';

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
  const [pagando, setPagando] = useState(null);

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

  async function pagarFixa(f) {
    setPagando(f.nome);
    const r = await api.pagarFixa(f.nome, mes, { dia: f.dia });
    setPagando(null);
    if (r.ok) { carregar(mes); aoMudarDados?.(); }
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
  const visiveis = filtroPessoa
    ? lista.filter((l) => l.pessoa === filtroPessoa)
    : lista;

  const dadosCorte = painel?.[CORTES.find((c) => c.id === corte).campo] || [];

  // Uma conta fixa que não virou lançamento pode estar em dois estados muito
  // diferentes: ainda vai vencer, ou já venceu e ninguém registrou. Chamar as
  // duas de "previsto" escondia a segunda, que é justamente a que precisa de você.
  const fixas = (painel?.fixas || []).map((f) => ({ ...f, ...situacaoDa(f, painel.mes) }));
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
            <div><span className="r">Entrou</span><span className="v pos">{formatarBRL(painel.receitas)}</span></div>
            <div><span className="r">Saiu</span><span className="v">{formatarBRL(painel.despesas)}</span></div>
            <div>
              <span className="r">Sobra</span>
              <span className={`v ${painel.saldo >= 0 ? 'pos' : 'neg'}`}>{formatarBRL(painel.saldo)}</span>
            </div>
          </div>

          {fixas.length > 0 && (
            <>
              <div className="secao-cabecalho">
                <p className="secao-titulo" style={{ margin: 0 }}>Contas fixas do mês</p>
                <span className="ajuda" style={{ margin: 0 }}>
                  {formatarBRL(painel.fixas_total)} no total
                </span>
              </div>
              <div className="lista">
                {fixas.map((f) => (
                  <div className={`item fixa ${f.lancado ? 'paga' : ''}`} key={f.nome}>
                    <span className={`ponto ${f.situacao}`} aria-hidden="true" />
                    <span className="corpo">
                      <span className="titulo">{f.nome}</span>
                      <span className={`meta ${f.situacao === 'erro' ? 'atrasada' : ''}`}>
                        {f.rotulo}{f.categoria ? ` · ${f.categoria}` : ''}
                      </span>
                    </span>
                    <span className="num">{formatarBRL(f.valor)}</span>
                    {!f.lancado && (
                      <button
                        className="btn discreto pequeno"
                        onClick={() => pagarFixa(f)}
                        disabled={pagando === f.nome}
                      >
                        {pagando === f.nome ? '…' : 'paguei'}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {atrasadas.total > 0 && (
                <div className="aviso ruim">
                  <strong>Venceu e não foi lançado: {formatarBRL(atrasadas.total)}</strong>
                  <span className="detalhe">
                    {atrasadas.nomes.join(' · ')} — se já pagou, toque em &ldquo;paguei&rdquo;.
                  </span>
                </div>
              )}

              {aVencer.total > 0 && (
                <div className="aviso atencao">
                  <strong>Ainda vai vencer: {formatarBRL(aVencer.total)}</strong>
                  <span className="detalhe">
                    Sobra projetada no fim do mês: {formatarBRL(painel.saldo - painel.previsto_total)}.
                  </span>
                </div>
              )}
            </>
          )}

          <GraficoEvolucao evolucao={painel.evolucao} mesAtual={painel.mes} />

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
        </>
      )}

      <div className="secao-cabecalho">
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

      {carregando && !painel ? (
        <div className="cartao pensando"><span className="girando" aria-hidden="true" /><span>Carregando o mês…</span></div>
      ) : visiveis.length === 0 ? (
        <div className="lista"><p className="vazio">Nenhum lançamento neste mês.</p></div>
      ) : (
        <div className="lista">
          {visiveis.map((l) => (
            <button type="button" className="item clicavel" key={l.uuid} onClick={() => setEditando({ ...l })}>
              <span className="corpo">
                <span className="titulo">{l.descricao || l.categoria || '(sem descrição)'}</span>
                <span className="meta">
                  {[l.categoria, l.conta, l.pessoa].filter(Boolean).join(' · ')} · {diaDe(l.data)}
                  {l.revisar ? ' · confira' : ''}
                </span>
              </span>
              <span className={`num ${l.tipo === 'receita' ? 'receita' : ''}`}>
                {l.tipo === 'receita' ? '+' : '−'}{formatarBRL(l.valor).replace('R$', '').trim()}
              </span>
            </button>
          ))}
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
                nome: editando.descricao || editando.categoria || '',
                dia: Number(String(editando.data).slice(8, 10)) || '',
                mes_fim: ''
              })}
            />
          </div>
        </div>
      )}

      {virandoMensal && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Transformar em conta fixa">
          <div className="modal-fundo" onClick={() => !salvando && setVirandoMensal(null)} />
          <div className="modal-corpo">
            <div className="cartao destaque">
              <p className="secao-titulo" style={{ margin: 0 }}>Repetir todo mês</p>
              <p className="ajuda">
                O gasto que você já registrou continua onde está. O que nasce aqui é a regra
                de que ele se repete — a partir deste mês, até você dizer o contrário.
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
                  <label htmlFor="m-dia">Vence dia</label>
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
                  {salvando ? 'Salvando…' : 'Repetir todo mês'}
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

/** Em que pé está uma conta fixa, comparando o vencimento com hoje. */
function situacaoDa(f, mesPainel) {
  if (f.lancado) return { situacao: 'sincronizado', rotulo: 'já lançado' };
  if (!f.dia) return { situacao: 'pendente', rotulo: 'sem dia definido' };

  const hoje = new Date();
  const mesHoje = mesDeHoje();

  if (mesPainel > mesHoje) return { situacao: 'pendente', rotulo: `vence dia ${f.dia}` };
  if (mesPainel < mesHoje) return { situacao: 'erro', rotulo: `venceu dia ${f.dia} e não foi lançado` };

  const diasAte = f.dia - hoje.getDate();
  if (diasAte > 0) {
    return {
      situacao: 'pendente',
      rotulo: diasAte === 1 ? 'vence amanhã' : `vence em ${diasAte} dias`
    };
  }
  if (diasAte === 0) return { situacao: 'pendente', rotulo: 'vence hoje' };
  return {
    situacao: 'erro',
    rotulo: `venceu há ${-diasAte} dia${diasAte < -1 ? 's' : ''} e não foi lançado`
  };
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
  api_fora: 'O script respondeu com erro.'
};

function traduzir(codigo) {
  return TRADUZ[codigo] || 'Algo deu errado ao falar com a planilha.';
}
