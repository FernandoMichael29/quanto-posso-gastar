import { useEffect, useState } from 'react';
import Personagem, { Rosto } from './Personagem.jsx';
import { Medalha } from './Missao.jsx';
import { Sprite } from './Item.jsx';
import { FogoDoNivel } from './Fogueira.jsx';
import { api } from '../lib/api.js';
import { formatarBRL } from '../lib/parser.js';
import { nomeDoMes } from '../lib/datas.js';
import { CONQUISTAS } from '../lib/missao.js';
import { PERSONAGENS, guardadoEmDupla } from '../lib/personagem.js';
import { nivelDaFogueira } from '../lib/fogueira.js';
import { fraseDoAno } from '../lib/relatorio.js';

// O relatório do ano: seis slides no acampamento. Abre sozinho na primeira
// semana de janeiro (App.jsx) e pelo botão em Mês → Resumo (`manual`).

const LETRA = 'JFMAMJJASOND';
const inteiro = (v) => `${v < 0 ? '−' : ''}R$ ${Math.abs(Math.round(Number(v) || 0)).toLocaleString('pt-BR')}`;
const mesNome = (m) => { const n = nomeDoMes(m); return n.charAt(0).toUpperCase() + n.slice(1).replace(/ de \d{4}$/, ''); };
const SLIDES = 6;

export default function RelatorioAno({ ano, heroi, manual = false, aoFechar }) {
  const [r, setR] = useState(undefined);       // undefined = carregando, false = falhou
  const [slide, setSlide] = useState(0);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.relatorioAno(ano).then((x) => { if (vivo) setR(x?.ok ? x : false); });
    return () => { vivo = false; };
  }, [ano]);

  const vazio = r && !r.meses_com_movimento;
  // Sozinho (janeiro): sem rede não marca como visto; ano vazio fecha calado.
  useEffect(() => {
    if (manual) return;
    if (r === false) aoFechar(false);
    else if (vazio) aoFechar(true);
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps

  const fechar = () => { if (saindo) return; setSaindo(true); setTimeout(() => aoFechar(true), 120); };
  if (r === undefined && !manual) return null;
  if (!manual && (r === false || vazio)) return null;

  const herois = [...PERSONAGENS].sort((a, b) => (a.id === heroi?.id ? -1 : b.id === heroi?.id ? 1 : 0));
  const ultimo = slide === SLIDES - 1;

  let corpo;
  if (r === undefined) corpo = <p className="relatorio-frase">Juntando o ano inteiro…</p>;
  else if (r === false) corpo = <p className="relatorio-frase">Não consegui falar com a planilha. Tente de novo daqui a pouco.</p>;
  else if (vazio) corpo = <p className="relatorio-frase">Nada foi registrado em {ano}. A aventura ainda vai começar.</p>;
  else corpo = [Capa, Meses, Dragao, Baus, FogueiraDoAno, Conquistas][slide]({ r, herois });

  return (
    <div className={`modal relatorio ${saindo ? 'saindo' : ''}`} role="dialog" aria-modal="true" aria-label={`Relatório do ano de ${ano}`}>
      <div className="modal-fundo" onClick={fechar} />
      <div className="modal-corpo">
        <div className="relatorio-janela relatorio-ano">
          <p className="rotulo-px">RELATÓRIO DO ANO{r && !vazio ? ` · ${slide + 1} DE ${SLIDES}` : ''}</p>
          {corpo}
          {r && !vazio && (
            <>
              <div className="pontos-slide" aria-hidden="true">
                {Array.from({ length: SLIDES }, (_, i) => <i key={i} className={i === slide ? 'on' : ''} />)}
              </div>
              <div className="botoes-slide">
                {slide > 0 && <button type="button" className="btn discreto" onClick={() => setSlide(slide - 1)}>Voltar</button>}
                <button type="button" className="btn-px" onClick={ultimo ? fechar : () => setSlide(slide + 1)}>
                  {!ultimo ? 'PRÓXIMO' : r.ate_agora ? 'FECHAR' : `QUE VENHA ${Number(r.ano) + 1}`}
                </button>
              </div>
            </>
          )}
          {(!r || vazio) && <button type="button" className="btn-px" onClick={fechar}>FECHAR</button>}
        </div>
      </div>
    </div>
  );
}

function Capa({ r, herois }) {
  const azul = r.sobrou >= 0;
  return (
    <>
      <h2 className="px">A AVENTURA DE {r.ano}</h2>
      {r.ate_agora && <p className="rotulo-px">ATÉ AGORA</p>}
      <div className={`acampamento ${azul ? 'brilho' : ''}`} aria-hidden="true">
        <span className="estrelas" />
        {herois.map((p, i) => (
          <Personagem key={p.id} id={p.id} tamanho={96} base={azul ? 'contando' : 'triste'} anim={azul ? 'vitoria' : undefined}
            className={i === 0 ? 'primeiro' : ''} />
        ))}
        <span className="fogo-acampamento"><FogoDoNivel nivel={nivelDaFogueira(azul ? 14 : 3)} tamanho={72} /></span>
      </div>
      <p className="relatorio-frase">
        O grupo {fraseDoAno(r)} e {r.ate_agora ? 'está' : 'terminou o ano'}{' '}
        {azul
          ? <>com <strong className="pos">{formatarBRL(r.sobrou)}</strong> sobrando.</>
          : <><strong className="neg">{formatarBRL(-r.sobrou)}</strong> no vermelho.</>}
      </p>
      <dl className="relatorio-numeros">
        <div><dt>Entrou</dt><dd className="pos">{formatarBRL(r.entrou)}</dd></div>
        <div><dt>Saiu</dt><dd>{formatarBRL(r.saiu)}</dd></div>
        <div><dt>Sobrou</dt><dd className={azul ? 'pos' : 'neg'}>{formatarBRL(r.sobrou)}</dd></div>
      </dl>
    </>
  );
}

function Meses({ r }) {
  const maior = Math.max(1, ...r.meses.map((m) => Math.abs(m.sobra)));
  return (
    <>
      <h2 className="px">MÊS A MÊS</h2>
      <div className="ano-barras" role="img" aria-label="Quanto sobrou em cada mês">
        {r.meses.map((m, i) => {
          const h = Math.round((Math.abs(m.sobra) / maior) * 100);
          return (
            <span key={m.mes} className={`${m.futuro || !m.teve ? 'sem' : m.sobra >= 0 ? 'azul' : 'vermelho'}`}>
              <i className="cima" style={{ height: m.sobra > 0 ? `${h}%` : 0 }} />
              <i className="baixo" style={{ height: m.sobra < 0 ? `${h}%` : 0 }} />
              <b className="px">{LETRA[i]}</b>
            </span>
          );
        })}
      </div>
      <p className="relatorio-frase">
        {r.no_azul} de {r.meses_com_movimento} {r.meses_com_movimento === 1 ? 'mês' : 'meses'} no azul.
      </p>
      <dl className="relatorio-numeros">
        {r.melhor_mes && <div><dt>Mês que mais sobrou</dt><dd className="pos">{mesNome(r.melhor_mes.mes)} · {inteiro(r.melhor_mes.sobra)}</dd></div>}
        {r.pior_mes && r.pior_mes.mes !== r.melhor_mes?.mes && (
          <div><dt>Mês mais pesado</dt><dd className={r.pior_mes.sobra < 0 ? 'neg' : ''}>{mesNome(r.pior_mes.mes)} · {inteiro(r.pior_mes.sobra)}</dd></div>
        )}
        <div><dt>Média que saiu por mês</dt><dd>{inteiro(r.saiu / Math.max(1, r.meses_com_movimento))}</dd></div>
      </dl>
    </>
  );
}

function Dragao({ r }) {
  const d = r.categorias[0];
  if (!d) return <><h2 className="px">O DRAGÃO DO ANO</h2><p className="relatorio-frase">Nenhum gasto registrado. Dragão nenhum apareceu.</p></>;
  const pct = r.saiu > 0 ? Math.round((d.total / r.saiu) * 100) : 0;
  const maior = r.categorias[0].total || 1;
  return (
    <>
      <h2 className="px">O DRAGÃO DO ANO</h2>
      <div className="dragao-ano">
        <span className="slot grande"><Sprite categoria={d.nome} iniciais /></span>
        <span>
          <b className="px">{d.nome.toUpperCase()}</b>
          <span>{formatarBRL(d.total)} · {pct}% de tudo que saiu</span>
        </span>
      </div>
      <div className="lista-dragoes">
        {r.categorias.map((c) => (
          <div key={c.nome}>
            <span className="slot"><Sprite categoria={c.nome} iniciais /></span>
            <span className="nome">{c.nome}</span>
            <span className="barra-dragao"><i style={{ width: `${Math.max(4, (c.total / maior) * 100)}%` }} /></span>
            <b className="px">{inteiro(c.total)}</b>
          </div>
        ))}
      </div>
    </>
  );
}

function Baus({ r }) {
  const dupla = guardadoEmDupla(r.guardado_por_pessoa);
  return (
    <>
      <h2 className="px">OS BAÚS</h2>
      <p className="relatorio-frase">
        {r.guardado > 0
          ? <>Foram <strong className="ouro-txt">{formatarBRL(r.guardado)}</strong> para os baús em {r.ano}.</>
          : 'Nenhum dinheiro foi para os baús este ano.'}
      </p>
      {dupla.length > 0 && (
        <div className="dupla">
          {dupla.map((x) => (
            <span key={x.id} className="dupla-quem" style={{ '--cor': x.personagem?.dupla || '#c9cedd' }}>
              {x.personagem ? <Rosto id={x.id} tamanho={22} /> : <i className="sem-dono px" aria-hidden="true">?</i>}
              <span>{x.personagem ? x.personagem.nome : 'Sem dono'} guardou</span>
              <b className="px">{formatarBRL(x.valor)}</b>
            </span>
          ))}
        </div>
      )}
      <dl className="relatorio-numeros">
        <div><dt>O dinheiro rendeu</dt><dd className="pos">{formatarBRL(r.rendeu)}</dd></div>
        {r.rendeu_baus > 0 && <div><dt>· nos baús</dt><dd>{formatarBRL(r.rendeu_baus)}</dd></div>}
        {r.rendeu_contas > 0 && <div><dt>· nas contas</dt><dd>{formatarBRL(r.rendeu_contas)}</dd></div>}
      </dl>
    </>
  );
}

function FogueiraDoAno({ r }) {
  const f = r.fogueira || { maior: 0, dias_acesos: 0 };
  const nivel = nivelDaFogueira(f.maior);
  return (
    <>
      <h2 className="px">A FOGUEIRA</h2>
      <div className={`acampamento ${nivel.brilho ? 'brilho' : ''}`} aria-hidden="true">
        <span className="estrelas" />
        <span className="fogo-acampamento"><FogoDoNivel nivel={nivel} tamanho={96} apagada={!f.maior} /></span>
      </div>
      <p className="relatorio-frase">
        {f.maior
          ? <>A maior fogueira do ano durou <strong className="ouro-txt">{f.maior} {f.maior === 1 ? 'dia' : 'dias'}</strong>{f.fim ? ` (até ${f.fim.slice(8, 10)}/${f.fim.slice(5, 7)})` : ''}.</>
          : 'A fogueira não chegou a acender este ano.'}
      </p>
      <dl className="relatorio-numeros">
        <div><dt>Dias com o fogo aceso</dt><dd>{f.dias_acesos}</dd></div>
        <div><dt>Chefes derrotados (contas fixas)</dt><dd>{r.chefes.derrotados} de {r.chefes.total}</dd></div>
      </dl>
    </>
  );
}

function Conquistas({ r }) {
  const lista = r.conquistas.map((c) => ({ ...c, nome: CONQUISTAS.find((x) => x.id === c.id)?.nome })).filter((c) => c.nome);
  return (
    <>
      <h2 className="px">CONQUISTAS</h2>
      {lista.length ? (
        <div className="relatorio-medalhas ano">
          {lista.map((c) => (
            <span key={c.id} className="medalha-mes">
              <span className="slot"><Medalha id={c.id} /></span>
              <span>{c.nome}<small> · {c.dia.slice(8, 10)}/{c.dia.slice(5, 7)}</small></span>
            </span>
          ))}
        </div>
      ) : <p className="relatorio-frase">Nenhuma medalha nova este ano — o próximo é a chance.</p>}
      <p className="relatorio-frase">
        {lista.length} {lista.length === 1 ? 'conquista' : 'conquistas'} em {r.ano}.
        {r.ate_agora ? ' O ano ainda não acabou.' : ' Que o próximo ano seja ainda melhor para o grupo.'}
      </p>
    </>
  );
}
