import { useEffect, useMemo, useState } from 'react';
import { CONQUISTAS, calcularMissao, conquistasMerecidas, nivel } from '../lib/missao.js';
import { FOLHA_CONQUISTAS, MEDALHA } from '../lib/icones.js';
import { api } from '../lib/api.js';
import { formatarBRL, soNumero } from '../lib/parser.js';
import { hojeISO } from '../lib/datas.js';
import { guardadoEmDupla } from '../lib/personagem.js';
import { Rosto } from './Personagem.jsx';

// A missão do mês (guardar um valor, a barra de XP) e as conquistas, na aba
// Resumo do Mês. A conta mora em lib/missao.js; aqui é o desenho, a edição da
// meta e o aviso de conquista nova.

export function Medalha({ id, bloqueada = false }) {
  return (
    <span
      className={`sprite medalha ${bloqueada ? 'bloqueada' : ''}`}
      style={{ backgroundImage: `url(${FOLHA_CONQUISTAS})`, backgroundPositionX: `${-32 * (MEDALHA[id] ?? 0)}px` }}
    />
  );
}

const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

/** O campo da meta: mesma máscara de centavos da tela Novo. */
function EditarMeta({ inicial, ocupado, aoSalvar, aoCancelar, foco = false }) {
  const [valor, setValor] = useState(inicial || 0);
  return (
    <form
      className="meta-edita"
      onSubmit={(e) => { e.preventDefault(); aoSalvar(valor); }}
    >
      <label className="valor-px pequeno">
        <span className="moeda px">R$</span>
        <input
          className="px"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Quanto guardar por mês, em reais"
          value={soNumero(valor)}
          onChange={(e) => setValor(Number(e.target.value.replace(/\D/g, '').slice(0, 10)) / 100)}
          autoFocus={foco}
        />
      </label>
      <div className="meta-botoes">
        {aoCancelar && (
          <button type="button" className="btn discreto pequeno" onClick={aoCancelar} disabled={ocupado}>Cancelar</button>
        )}
        {inicial > 0 && (
          <button type="button" className="btn discreto pequeno" onClick={() => aoSalvar(0)} disabled={ocupado}>Desistir da missão</button>
        )}
        <button type="submit" className="btn-px pequeno" disabled={ocupado || !(valor > 0)}>
          {inicial > 0 ? 'SALVAR' : 'ACEITAR MISSÃO'}
        </button>
      </div>
    </form>
  );
}

/**
 * @param painel     painel do mês aberto na tela Mês
 * @param aoMudar    recarrega o painel depois de salvar a meta
 */
export default function Missao({ painel, aoMudar }) {
  const missao = useMemo(() => calcularMissao(painel), [painel]);
  // A missão em dupla: o que já está trancado em baú, separado por quem guardou.
  const dupla = useMemo(() => guardadoEmDupla(painel.guardado_por_pessoa), [painel]);
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);

  // As conquistas que o script já guardou, mais as que os dados de agora dão.
  const [guardadas, setGuardadas] = useState(painel.conquistas || {});
  useEffect(() => { setGuardadas((g) => ({ ...g, ...(painel.conquistas || {}) })); }, [painel]);
  const merecidas = useMemo(() => conquistasMerecidas(painel), [painel]);
  // Conquistas novas esperando a vez de aparecer: uma de cada vez, 6 s cada.
  const [avisos, setAvisos] = useState([]);
  const nova = avisos[0] || null;
  const [aberta, setAberta] = useState(null);

  // Conquista nova: avisa o script (para valer no celular e no computador e não
  // sumir quando o mês virar) e comemora. Sem rede, comemora do mesmo jeito e
  // tenta guardar de novo na próxima vez que a tela abrir.
  useEffect(() => {
    const novas = [...merecidas].filter((id) => !guardadas[id]);
    if (!novas.length) return;
    setAvisos((a) => [...a, ...novas.filter((id) => !a.includes(id))]);
    const hoje = hojeISO();
    setGuardadas((g) => ({ ...g, ...Object.fromEntries(novas.map((id) => [id, hoje])) }));
    api.conquistar(novas).then((r) => { if (r.ok) setGuardadas((g) => ({ ...g, ...r.conquistas })); });
  }, [merecidas]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!nova) return undefined;
    const t = setTimeout(() => setAvisos((a) => a.slice(1)), 6000);
    return () => clearTimeout(t);
  }, [nova]);

  async function salvarMeta(valor) {
    setOcupado(true);
    setErro(null);
    const r = await api.salvarMeta(valor);
    setOcupado(false);
    if (!r.ok) { setErro('Não consegui salvar a missão. Tente de novo.'); return; }
    setEditando(false);
    aoMudar?.();
  }

  const quantas = CONQUISTAS.filter((c) => guardadas[c.id]).length;
  const detalhe = CONQUISTAS.find((c) => c.id === aberta);

  return (
    <>
      {nova && (
        <div className="conquista-nova" role="status" key={nova}>
          <span className="slot"><Medalha id={nova} /></span>
          <span className="corpo">
            <span className="px rotulo">CONQUISTA DESBLOQUEADA</span>
            <strong>{CONQUISTAS.find((c) => c.id === nova)?.nome}</strong>
            <span className="como">{CONQUISTAS.find((c) => c.id === nova)?.como}</span>
          </span>
          <button type="button" className="fechar" aria-label="Fechar" onClick={() => setAvisos((a) => a.slice(1))}>×</button>
        </div>
      )}

      {/* A missão só existe no mês que está correndo: o passado já tem resposta. */}
      {missao && (
        <>
          <div className="secao-cabecalho">
            <p className="secao-titulo" style={{ margin: 0 }}>Missão do mês</p>
            <span className="nivel px">NV {nivel(quantas)}</span>
          </div>

          <div className={`missao ${missao.cumprida ? 'cumprida' : ''}`}>
            {missao.meta > 0 && !editando ? (
              <>
                <div className="missao-topo">
                  <span className="slot"><Medalha id={missao.cumprida ? 'formiguinha' : 'primeira_missao'} /></span>
                  <span className="corpo">
                    <strong>Guardar {formatarBRL(missao.meta)}</strong>
                    <span className="sub">
                      {missao.cumprida
                        ? 'Missão cumprida, se o mês terminar assim. Recompensa: Formiguinha.'
                        : missao.guardado > 0
                          ? `Se o mês terminar assim, você guarda ${formatarBRL(missao.guardado)}.`
                          : 'Do jeito que está, o mês não sobra nada para guardar.'}
                    </span>
                  </span>
                  <button type="button" className="mudar" onClick={() => setEditando(true)}>mudar</button>
                </div>
                <div className="missao-xp">
                  <div className="legenda">
                    <span>XP</span>
                    <span>R$ {Math.round(Math.max(0, missao.guardado)).toLocaleString('pt-BR')} / {Math.round(missao.meta).toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="hp xp" style={{ '--p': `${Math.round(missao.fracao * 100)}%` }}
                    role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(missao.fracao * 100)}
                    aria-label="quanto da missão já está garantido"><i />
                    {missao.garantido > 0 && !dupla.length && <b className="garantido" style={{ width: `${Math.min(100, Math.round((missao.garantido / missao.meta) * 100))}%` }} />}
                    {dupla.length > 0 && (() => {
                      let x = 0;
                      return dupla.map((d) => {
                        const w = Math.max(0, Math.min(100 - x, (d.valor / missao.meta) * 100));
                        const pedaco = <b key={d.id} className="garantido parte" style={{ left: `${x}%`, width: `${w}%`, '--cor': d.personagem?.dupla || '#c9cedd' }} />;
                        x += w;
                        return pedaco;
                      });
                    })()}
                  </div>
                </div>
                {dupla.length > 0 && (
                  <div className="dupla" aria-label="quem guardou quanto neste mês">
                    {dupla.map((d) => (
                      <span key={d.id} className="dupla-quem" style={{ '--cor': d.personagem?.dupla || '#c9cedd' }}>
                        {d.personagem ? <Rosto id={d.id} tamanho={22} /> : <i className="sem-dono px" aria-hidden="true">?</i>}
                        <span>{d.personagem ? d.personagem.nome : 'Sem dono'}</span>
                        <b className="px">{formatarBRL(d.valor)}</b>
                      </span>
                    ))}
                  </div>
                )}
                <p className="sub">
                  {missao.cumprida
                    ? 'O ouro de hoje já deixa a missão separada.'
                    : <>Faltam <strong>{formatarBRL(missao.falta)}</strong>. O ouro de hoje já deixa a missão separada.</>}
                  {missao.cumpridasSeguidas > 1 && ` ${missao.cumpridasSeguidas} meses seguidos cumprindo.`}
                  {missao.garantido > 0 && ` ${formatarBRL(missao.garantido)} já estão trancados em baús${dupla.length > 1 ? ' — guardados em dupla' : ''}.`}
                </p>
              </>
            ) : (
              <>
                {!editando && (
                  <p className="sub" style={{ marginTop: 0 }}>
                    <strong>Nenhuma missão ainda.</strong> Diga quanto quer guardar por mês: o ouro de hoje
                    passa a separar esse valor antes de dizer quanto dá para gastar.
                  </p>
                )}
                <EditarMeta
                  inicial={missao.meta}
                  ocupado={ocupado}
                  aoSalvar={salvarMeta}
                  aoCancelar={editando ? () => setEditando(false) : null}
                  foco={editando}
                />
              </>
            )}
            {erro && <p className="sub ruim">{erro}</p>}
          </div>
        </>
      )}

      <div className="secao-cabecalho">
        <p className="secao-titulo" style={{ margin: 0 }}>Conquistas</p>
        <span className="ajuda" style={{ margin: 0 }}>{quantas} de {CONQUISTAS.length}</span>
      </div>
      <div className="conquistas">
        <div className="vitrine" role="list">
          {CONQUISTAS.map((c) => {
            const ganha = Boolean(guardadas[c.id]);
            return (
              <button
                key={c.id}
                type="button"
                role="listitem"
                className={`slot ${ganha ? 'ganha' : ''} ${aberta === c.id ? 'escolhido' : ''}`}
                aria-label={`${c.nome}${ganha ? '' : ' (bloqueada)'}`}
                onClick={() => setAberta(aberta === c.id ? null : c.id)}
              >
                <Medalha id={c.id} bloqueada={!ganha} />
              </button>
            );
          })}
        </div>
        <p className="conquista-detalhe">
          {detalhe ? (
            <>
              <strong>{detalhe.nome}</strong>
              {guardadas[detalhe.id] ? ` · ganha em ${dataBR(guardadas[detalhe.id])}. ` : ' · bloqueada. '}
              {detalhe.como}
            </>
          ) : (
            'Toque numa medalha para ver como ganhar. Cada conquista sobe um nível.'
          )}
        </p>
      </div>
    </>
  );
}
