import { useEffect, useRef, useState } from 'react';
import { Sprite } from './Item.jsx';
import { formatarBRL } from '../lib/parser.js';
import Personagem from './Personagem.jsx';
import { humorDoHeroi, reacaoAoLancamento } from '../lib/personagem.js';

// A janela de jogo no topo da tela Novo: o ouro de hoje e a vida do mês.
// A conta mora em lib/ouro.js; aqui é só o desenho e a animação.

const inteiro = (v) => Math.round(Number(v) || 0).toLocaleString('pt-BR');
const parado = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** O número anda até o valor novo em degraus, como contador de jogo. */
function useContagem(alvo, passos = 8, duracao = 480) {
  const [mostrado, setMostrado] = useState(alvo);
  const atual = useRef(alvo);
  useEffect(() => {
    if (alvo == null) return undefined;
    const inicio = atual.current ?? alvo;
    if (inicio === alvo || parado()) { atual.current = alvo; setMostrado(alvo); return undefined; }
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      const v = i >= passos ? alvo : inicio + ((alvo - inicio) * i) / passos;
      atual.current = v;
      setMostrado(v);
      if (i >= passos) clearInterval(t);
    }, duracao / passos);
    return () => clearInterval(t);
  }, [alvo, passos, duracao]);
  return mostrado;
}

export default function Hud({ dados, efeito, heroi, hoje, ultimoLancamento }) {
  const ouro = useContagem(dados ? Math.max(0, dados.ouro) : null);
  const [treme, setTreme] = useState(false);
  // O herói reage ao que acabou de entrar e depois volta ao humor do mês.
  const [reacao, setReacao] = useState(null);
  const vezes = useRef(0);
  useEffect(() => {
    if (!efeito) return;
    vezes.current += 1;
    setReacao({ anim: reacaoAoLancamento(efeito, dados), vez: vezes.current });
  }, [efeito]); // eslint-disable-line react-hooks/exhaustive-deps
  const humor = humorDoHeroi(dados, { hoje, ultimoLancamento });
  const retrato = heroi ? (
    <span className={`retrato-heroi ${humor.anim}`}>
      <Personagem id={heroi.id} tamanho={88} base={humor.anim} anim={reacao?.anim} vez={reacao?.vez || 0}
        aoTerminar={() => setReacao(null)} rotulo={`${heroi.nome}: ${humor.motivo}`} />
    </span>
  ) : <span className="slot"><Sprite categoria="Salário" receita /></span>;

  // Gasto é "dano": a janela treme quando ele entra.
  useEffect(() => {
    if (!efeito || efeito.tipo === 'receita' || parado()) return undefined;
    setTreme(true);
    const t = setTimeout(() => setTreme(false), 380);
    return () => clearTimeout(t);
  }, [efeito]);

  if (!dados) {
    return (
      <div className="hud" aria-busy="true">
        <div className="hud-topo">
          <div>
            <div className="hud-rotulo">OURO DE HOJE</div>
            <div className="ouro zerado">R$ …</div>
          </div>
          {retrato}
        </div>
        <p className="sub">Lendo a planilha…</p>
      </div>
    );
  }

  const vida = dados.vida;
  const tom = vida == null ? 'vida' : vida > 0.5 ? 'vida' : vida > 0.25 ? 'alerta' : 'perigo';
  let frase;
  if (dados.ouro < 0) {
    frase = <>Passou <strong>{formatarBRL(-dados.ouro)}</strong> do ouro de hoje.{dados.amanha != null && <> Amanhã: {formatarBRL(dados.amanha)} por dia.</>}</>;
  } else if (dados.livre <= 0) {
    frase = dados.reserva > 0 && dados.livre + dados.reserva > 0
      ? <>Sem ouro hoje: faltam <strong>{formatarBRL(-dados.livre)}</strong> para cumprir a missão de guardar {formatarBRL(dados.meta)}.</>
      : <>O mês já está <strong>{formatarBRL(-(dados.livre + (dados.reserva || 0)))}</strong> no vermelho.</>;
  } else {
    frase = <>Dá pra gastar isso hoje sem apertar o resto do mês{dados.reserva > 0 ? ' — com a missão já separada' : ''}. {dados.dias > 1 ? `Faltam ${dados.dias} dias.` : 'Último dia do mês.'}</>;
  }

  return (
    <div className={`hud ${treme ? 'treme' : ''}`} role="status" aria-live="polite">
      <div className="hud-topo">
        <div>
          <div className="hud-rotulo">OURO DE HOJE</div>
          <div className={`ouro ${dados.ouro <= 0 ? 'zerado' : ''}`}>{formatarBRL(ouro)}</div>
        </div>
        {retrato}
      </div>

      <p className="sub">{frase}{heroi && humor.anim === 'dormindo' && <> {heroi.nome} {humor.motivo} — lance algo para acordar.</>}</p>

      {vida != null && (
        <div className="hud-vida">
          <div className="legenda">
            <span>VIDA DO MÊS</span>
            <span>R$ {inteiro(Math.max(0, dados.livre))} / {inteiro(dados.total)}</span>
          </div>
          <div className={`hp ${tom}`} style={{ '--p': `${Math.round(vida * 100)}%` }}><i /></div>
        </div>
      )}

      {/* A chave reinicia a animação a cada lançamento novo. */}
      {efeito && (
        <span key={efeito.id} className={`dano ${efeito.tipo === 'receita' ? 'ganho' : ''}`} aria-hidden="true">
          {efeito.tipo === 'receita' ? '+' : '−'}{formatarBRL(efeito.valor)}
        </span>
      )}
    </div>
  );
}
