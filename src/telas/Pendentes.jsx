import { useState } from 'react';
import { ESTADO, MOTIVO, ROTULO_ESTADO, remover } from '../lib/db.js';
import { formatarBRL } from '../lib/parser.js';
import { sincronizar } from '../lib/sync.js';

// Motivos que precisam de uma ação sua antes de adiantar tentar de novo.
const PRECISA_DE_VOCE = {
  sem_creditos: {
    titulo: 'Os créditos da API acabaram',
    o_que_fazer: 'Recarregue em console.anthropic.com → Billing. Nada foi perdido: assim que houver saldo, tudo aqui é interpretado sozinho.'
  },
  chave_invalida: {
    titulo: 'A chave da API foi recusada',
    o_que_fazer: 'Confira a propriedade ANTHROPIC_KEY no seu Apps Script.'
  },
  sem_chave: {
    titulo: 'A chave da API ainda não foi configurada',
    o_que_fazer: 'Rode a função salvarChaveAnthropic() no Apps Script com sua chave.'
  },
  sem_configuracao: {
    titulo: 'O app ainda não está ligado à planilha',
    o_que_fazer: 'Preencha o endereço e o token na aba Ajustes.'
  },
  token_invalido: {
    titulo: 'O token não confere',
    o_que_fazer: 'Rode verToken() no Apps Script e cole o valor certo nos Ajustes.'
  },
  teto_diario: {
    titulo: 'Teto diário de interpretações atingido',
    o_que_fazer: 'Tudo aqui é interpretado sozinho amanhã. Se você não fez esse volume de lançamentos hoje, troque o token: rode girarToken() no Apps Script.'
  }
};

export default function Pendentes({ fila, aoMudarFila }) {
  const [sincronizando, setSincronizando] = useState(false);

  const pendentes = fila.filter((i) => i.estado !== ESTADO.SINCRONIZADO);
  const prontos = fila.filter((i) => i.estado === ESTADO.SINCRONIZADO);

  const bloqueio = pendentes.map((i) => i.motivo).find((m) => PRECISA_DE_VOCE[m]);

  async function tentarAgora() {
    setSincronizando(true);
    await sincronizar();
    setSincronizando(false);
    aoMudarFila?.();
  }

  async function descartar(uuid) {
    await remover(uuid);
    aoMudarFila?.();
  }

  return (
    <>
      {bloqueio && (
        <div className="aviso ruim" role="alert">
          <strong>{PRECISA_DE_VOCE[bloqueio].titulo}</strong>
          <span className="detalhe">{PRECISA_DE_VOCE[bloqueio].o_que_fazer}</span>
        </div>
      )}

      {!navigator.onLine && (
        <div className="aviso atencao">
          <strong>Você está sem internet</strong>
          <span className="detalhe">Continue registrando normalmente. Tudo sobe sozinho quando o sinal voltar.</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <p className="secao-titulo" style={{ margin: 0 }}>
          Na fila{pendentes.length ? ` · ${pendentes.length}` : ''}
        </p>
        <button className="btn pequeno" onClick={tentarAgora} disabled={sincronizando || !navigator.onLine}>
          {sincronizando ? 'Tentando…' : 'Tentar agora'}
        </button>
      </div>

      {pendentes.length === 0 ? (
        <div className="lista"><p className="vazio">Nada esperando. Tudo já está na planilha.</p></div>
      ) : (
        <div className="lista">
          {pendentes.map((i) => (
            <Linha key={i.uuid} item={i} onDescartar={() => descartar(i.uuid)} />
          ))}
        </div>
      )}

      {prontos.length > 0 && (
        <>
          <p className="secao-titulo">Já sincronizados</p>
          <div className="lista">
            {prontos.slice(0, 15).map((i) => <Linha key={i.uuid} item={i} />)}
          </div>
          <p className="ajuda">Some daqui sozinho depois de uma semana — na planilha fica para sempre.</p>
        </>
      )}
    </>
  );
}

function Linha({ item, onDescartar }) {
  const l = item.lancamento;
  const quando = new Date(item.criado_em).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });

  return (
    <div className="item">
      <span className={`ponto ${item.estado}`} style={{ marginTop: 7 }} aria-hidden="true" />
      <div className="corpo">
        <span className="titulo">
          {l ? (l.descricao || l.categoria) : item.texto || '(sem texto)'}
        </span>
        <span className="meta">
          {ROTULO_ESTADO[item.estado]}
          {item.motivo && MOTIVO[item.motivo] ? ` · ${MOTIVO[item.motivo]}` : ''}
          {' · '}{quando}
          {item.tentativas > 0 ? ` · ${item.tentativas} tentativa${item.tentativas > 1 ? 's' : ''}` : ''}
        </span>
        {!l && item.estado === ESTADO.AGUARDANDO_IA && (
          <span className="meta">Sua frase está guardada — interpreto assim que der.</span>
        )}
      </div>
      {l && <span className={`num ${l.tipo === 'receita' ? 'receita' : ''}`}>{formatarBRL(l.valor)}</span>}
      {onDescartar && (
        <button className="btn discreto pequeno" onClick={onDescartar} aria-label="Descartar da fila">✕</button>
      )}
    </div>
  );
}
