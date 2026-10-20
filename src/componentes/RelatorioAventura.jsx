import { useEffect, useState } from 'react';
import Personagem, { Rosto } from './Personagem.jsx';
import { Medalha } from './Missao.jsx';
import { api } from '../lib/api.js';
import { formatarBRL } from '../lib/parser.js';
import { mesPorExtenso, somarMes } from '../lib/datas.js';
import { PERSONAGENS } from '../lib/personagem.js';
import { relatorioDoMes } from '../lib/relatorio.js';

// O relatório da aventura: no começo do mês, os dois heróis no acampamento
// contam como foi o mês que fechou. Aparece uma vez por celular (App.jsx decide).

export default function RelatorioAventura({ mes, heroi, aoFechar }) {
  const [dados, setDados] = useState(undefined);   // undefined = carregando, null = nada para contar, false = falhou
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.painel(mes).then((p) => { if (vivo) setDados(p.ok ? relatorioDoMes(p, mes) : false); });
    return () => { vivo = false; };
  }, [mes]);

  // Mês sem movimento: não há o que contar — fecha sem aparecer. Sem rede
  // (false), fecha avisando que não viu, para tentar de novo depois.
  useEffect(() => { if (dados === null) aoFechar(true); else if (dados === false) aoFechar(false); }, [dados]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!dados) return null;

  const fechar = () => { if (saindo) return; setSaindo(true); setTimeout(() => aoFechar(true), 120); };
  // Quem joga neste celular aparece primeiro.
  const herois = [...PERSONAGENS].sort((a, b) => (a.id === heroi?.id ? -1 : b.id === heroi?.id ? 1 : 0));
  const base = dados.noAzul ? 'contando' : 'triste';
  const proximo = mesPorExtenso(somarMes(mes, 1)).split(' de ')[0];

  return (
    <div className={`modal relatorio ${saindo ? 'saindo' : ''}`} role="dialog" aria-modal="true" aria-label={`Relatório da aventura de ${mesPorExtenso(mes)}`}>
      <div className="modal-fundo" onClick={fechar} />
      <div className="modal-corpo">
        <div className="relatorio-janela">
          <p className="rotulo-px">RELATÓRIO DA AVENTURA</p>
          <h2 className="px">{mesPorExtenso(mes).toUpperCase()}</h2>

          <div className="acampamento" aria-hidden="true">
            <span className="estrelas" />
            {herois.map((p, i) => (
              <Personagem key={p.id} id={p.id} tamanho={96} base={base} anim={dados.noAzul ? 'vitoria' : undefined}
                className={i === 0 ? 'primeiro' : ''} />
            ))}
            <span className="fogueira" />
          </div>

          <p className="relatorio-frase">
            {dados.noAzul
              ? <>O grupo fechou o mês <strong className="pos">no azul</strong>, com {formatarBRL(dados.sobrou)} sobrando.</>
              : <>O mês fechou <strong className="neg">{formatarBRL(-dados.sobrou)} no vermelho</strong>. O acampamento está quieto.</>}
          </p>

          <dl className="relatorio-numeros">
            <div><dt>Entrou</dt><dd className="pos">{formatarBRL(dados.receitas)}</dd></div>
            <div><dt>Saiu</dt><dd>{formatarBRL(dados.despesas)}</dd></div>
            {dados.guardado !== 0 && (
              <div>
                <dt>Foi para os baús</dt>
                <dd className="ouro">{formatarBRL(dados.guardado)}</dd>
              </div>
            )}
            {dados.chefes.total > 0 && (
              <div><dt>Chefes derrotados</dt><dd>{dados.chefes.derrotados} de {dados.chefes.total}</dd></div>
            )}
            {dados.missao && (
              <div>
                <dt>Missão de guardar {formatarBRL(dados.missao.meta)}</dt>
                <dd className={dados.missao.cumprida ? 'pos' : 'neg'}>{dados.missao.cumprida ? 'CUMPRIDA' : 'NÃO DEU'}</dd>
              </div>
            )}
            {dados.dragao && (
              <div><dt>O dragão do mês</dt><dd>{dados.dragao.nome} · {formatarBRL(dados.dragao.total)}</dd></div>
            )}
          </dl>

          {dados.dupla.length > 0 && (
            <div className="dupla">
              {dados.dupla.map((d) => (
                <span key={d.id} className="dupla-quem" style={{ '--cor': d.personagem?.dupla || '#c9cedd' }}>
                  {d.personagem ? <Rosto id={d.id} tamanho={22} /> : <i className="sem-dono px" aria-hidden="true">?</i>}
                  <span>{d.personagem ? d.personagem.nome : 'Sem dono'} guardou</span>
                  <b className="px">{formatarBRL(d.valor)}</b>
                </span>
              ))}
            </div>
          )}

          {dados.conquistas.length > 0 && (
            <div className="relatorio-medalhas">
              <span className="rotulo-px">CONQUISTAS DO MÊS</span>
              <div>
                {dados.conquistas.map((c) => (
                  <span key={c.id} className="medalha-mes"><span className="slot"><Medalha id={c.id} /></span>{c.nome}</span>
                ))}
              </div>
            </div>
          )}

          <button type="button" className="btn-px" onClick={fechar}>SEGUIR PARA {proximo.toUpperCase()}</button>
        </div>
      </div>
    </div>
  );
}
