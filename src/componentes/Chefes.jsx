import { useState } from 'react';
import Item from './Item.jsx';
import Capa from './Capa.jsx';
import Sanfona from './Sanfona.jsx';
import { valorQueVale } from './Compromissos.jsx';
import { formatarBRL } from '../lib/parser.js';
import Personagem, { useReacao } from './Personagem.jsx';
import { personagemSalvo } from '../lib/personagem.js';

// Contas fixas como chefes de fase. Cada conta tem a vida cheia até ser
// lançada; lançar é o golpe final — a barra esvazia e cai o carimbo.
//
// O que já foi derrotado continua dobrado numa sanfona (a lista no dia 20 é
// quase toda resolvida, e o que pede você sumiria no meio). A exceção é o
// chefe que caiu agora, nesta tela: ele fica onde estava até você sair, senão
// a animação aconteceria num lugar que você não está olhando.

const assinatura = (itens) => itens.map((i) => `${i.nome}:${i.lancado ? 1 : 0}`).join('|');
const porDia = (a, b) => (Number(a.dia) || 99) - (Number(b.dia) || 99);
const soma = (lista) => lista.reduce((a, i) => a + valorQueVale(i), 0);

export default function Chefes({ itens, ocupado, aoAbrir }) {
  const [visto, setVisto] = useState(() => assinatura(itens));
  const [abatidos, setAbatidos] = useState(() => new Set());
  // O herói de quem está jogando: ataca o chefe que caiu e comemora a fase limpa.
  const [heroi] = useState(personagemSalvo);
  const [reacao, reagir] = useReacao();

  // Guardar o que mudou desde a última vez, durante o desenho (o jeito do
  // React para "estado que depende do anterior"). Comparar por assinatura:
  // a lista é recriada a cada desenho, então comparar o objeto entraria em loop.
  const agora = assinatura(itens);
  if (agora !== visto) {
    const antes = new Map(visto.split('|').map((s) => [s.slice(0, s.lastIndexOf(':')), s.endsWith(':1')]));
    const caiu = itens.filter((i) => i.lancado && antes.get(i.nome) === false).map((i) => i.nome);
    setVisto(agora);
    if (caiu.length) {
      setAbatidos((s) => new Set([...s, ...caiu]));
      reagir('ataque', itens.every((i) => i.lancado) ? 'vitoria' : null);
    }
  }

  if (!itens.length) return null;

  const vivos = itens.filter((i) => !i.lancado || abatidos.has(i.nome)).sort(porDia);
  const derrotados = itens.filter((i) => i.lancado && !abatidos.has(i.nome)).sort(porDia);
  const nDerrotados = itens.filter((i) => i.lancado).length;
  const total = soma(itens);
  const restante = soma(itens.filter((i) => !i.lancado));
  const pct = total > 0 ? Math.round((restante / total) * 100) : 0;
  const atacando = itens.filter((i) => !i.lancado && i.situacao === 'erro').length;

  return (
    <>
      <div className="secao-cabecalho">
        <p className="secao-titulo" style={{ margin: 0 }}>Chefes do mês</p>
        <span className="ajuda" style={{ margin: 0 }}>{nDerrotados} de {itens.length} derrotados</span>
      </div>

      <div className={`placar-chefes ${restante === 0 ? 'limpo' : ''} ${heroi ? 'com-heroi' : ''}`}>
        {heroi && (
          <span className="heroi-placar">
            <Personagem id={heroi.id} tamanho={80} {...reacao} />
          </span>
        )}
        <div className="placar-corpo">
        <div className="legenda">
          <span>{restante === 0 ? 'FASE LIMPA' : 'VIDA DOS CHEFES'}</span>
          <span>{formatarBRL(restante)}</span>
        </div>
        <div className={`hp ${atacando ? 'perigo' : 'chefe'}`} style={{ '--p': `${pct}%` }}
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
          aria-label="quanto das contas fixas ainda falta lançar">
          <i />
        </div>
        <p className="sub">
          {restante === 0
            ? 'Todas as contas fixas do mês já foram lançadas.'
            : atacando
              ? <><strong>{atacando} {atacando === 1 ? 'chefe atacando' : 'chefes atacando'}</strong> — venceu e não foi lançado.</>
              : `${formatarBRL(total)} no total. Lançou, derrotou.`}
        </p>
        </div>
      </div>

      {vivos.length > 0 && (
        <div className="lista">
          {vivos.map((i) => (
            <Chefe key={i.nome} i={i} abatido={abatidos.has(i.nome)} ocupado={ocupado} aoAbrir={aoAbrir} />
          ))}
        </div>
      )}

      {derrotados.length > 0 && (
        <Sanfona
          titulo={`${derrotados.length} ${derrotados.length === 1 ? 'chefe derrotado' : 'chefes derrotados'}`}
          resumo={formatarBRL(soma(derrotados))}
        >
          <div className="lista">
            {derrotados.map((i) => (
              <Chefe key={i.nome} i={i} ocupado={ocupado} aoAbrir={aoAbrir} />
            ))}
          </div>
        </Sanfona>
      )}
    </>
  );
}

function Chefe({ i, abatido = false, ocupado, aoAbrir }) {
  const atacando = !i.lancado && i.situacao === 'erro';
  const salvando = ocupado === `fixa:${i.nome}`;
  return (
    <button
      type="button"
      className={`item chefe clicavel ${i.lancado ? 'derrotado' : ''} ${atacando ? 'atacando' : ''} ${abatido ? 'abatido' : ''} ${salvando ? 'ocupado' : ''}`}
      onClick={() => aoAbrir(i)}
      disabled={salvando}
    >
      <Item categoria={i.categoria} />
      <span className="corpo">
        <span className="titulo">{i.nome_visivel || i.nome}</span>
        <span className={`meta ${atacando ? 'atrasada' : ''}`}>
          {atacando && <b className="tag-px">ATACANDO</b>}
          {i.rotulo}
        </span>
        <span className={`hp fina ${atacando ? 'perigo' : 'chefe'}`} style={{ '--p': i.lancado ? '0%' : '100%' }} aria-hidden="true">
          <i />
        </span>
      </span>
      <span className="num">{formatarBRL(valorQueVale(i))}</span>
      <span className="seta" aria-hidden="true">›</span>
      {i.lancado && <span className="carimbo" aria-label="derrotado">DERROTADO</span>}
      <Capa quando={salvando} />
    </button>
  );
}
