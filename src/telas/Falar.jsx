import { useEffect, useRef, useState } from 'react';
import { interpretar, formatarBRL } from '../lib/parser.js';
import { escutar, ERRO_VOZ, temReconhecimento } from '../lib/voz.js';
import { enfileirar, ESTADO, novoId } from '../lib/db.js';
import { api, configurado } from '../lib/api.js';
import { sincronizar } from '../lib/sync.js';

const IconeMic = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21" />
  </svg>
);

export default function Falar({ categorias, contas, resumo, aoMudarFila }) {
  const [ouvindo, setOuvindo] = useState(false);
  const [texto, setTexto] = useState('');
  const [rascunho, setRascunho] = useState(null);
  const [esperandoIA, setEsperandoIA] = useState(false);
  const [recado, setRecado] = useState(null);
  const sessao = useRef(null);

  useEffect(() => () => sessao.current?.cancelar(), []);

  function comecar() {
    setRecado(null);
    setRascunho(null);
    setTexto('');

    if (!navigator.onLine || !temReconhecimento()) {
      setRecado({
        tom: 'atencao',
        titulo: 'Sem internet para reconhecer a voz',
        detalhe: 'Digite no campo abaixo usando o microfone do seu teclado — ele funciona offline.'
      });
      return;
    }

    setOuvindo(true);
    sessao.current = escutar({
      aoTexto: (t) => setTexto(t),
      aoFim: (t) => { setOuvindo(false); if (t) processar(t); },
      aoErro: (codigo) => {
        setOuvindo(false);
        setRecado({ tom: 'atencao', titulo: ERRO_VOZ[codigo] || 'Não consegui ouvir' });
      }
    });
  }

  function parar() {
    sessao.current?.parar();
    setOuvindo(false);
  }

  /** Interpreta a frase: primeiro as regras locais, depois a IA se precisar. */
  async function processar(frase) {
    setTexto(frase);
    const r = interpretar(frase, { categorias });

    if (r.lancamento) {
      setRascunho({ ...r.lancamento, confianca: r.confianca, motivo: r.motivo });
      return;
    }

    // Regras locais não deram conta. Precisa da IA.
    if (!configurado()) {
      await guardarParaDepois(frase, 'sem_configuracao');
      return;
    }
    if (!navigator.onLine) {
      await guardarParaDepois(frase, 'sem_rede');
      return;
    }

    setEsperandoIA(true);
    const uuid = novoId();
    const resposta = await api.interpretar(frase, uuid);
    setEsperandoIA(false);

    if (resposta.ok && resposta.lancamentos?.length) {
      const [primeiro, ...extras] = resposta.lancamentos;
      setRascunho({
        ...primeiro,
        texto_falado: frase,
        confianca: 'ia',
        motivo: 'interpretado pela IA',
        extras
      });
      return;
    }

    await guardarParaDepois(frase, resposta.erro || 'nada_entendido', uuid);
  }

  /** Nada se perde: a frase entra na fila com o motivo. */
  async function guardarParaDepois(frase, motivo, uuid) {
    await enfileirar({
      uuid: uuid || novoId(),
      estado: ESTADO.AGUARDANDO_IA,
      motivo,
      texto: frase,
      lancamento: null
    });
    aoMudarFila?.();
    setTexto('');
    setRecado({
      tom: 'atencao',
      titulo: 'Guardei sua frase na fila',
      detalhe: MOTIVO_TELA[motivo] || 'Vou interpretar assim que der e você não precisa fazer nada.'
    });
  }

  async function confirmar() {
    const lista = [rascunho, ...(rascunho.extras || [])];
    for (const l of lista) {
      const { extras, motivo, ...limpo } = l;
      await enfileirar({
        uuid: novoId(),
        estado: ESTADO.PENDENTE,
        texto: rascunho.texto_falado || texto,
        lancamento: { ...limpo, texto_falado: rascunho.texto_falado || texto }
      });
    }
    setRascunho(null);
    setTexto('');
    aoMudarFila?.();
    setRecado({ tom: 'bom', titulo: `${lista.length > 1 ? lista.length + ' lançamentos guardados' : 'Guardado'}` });
    sincronizar().then(() => aoMudarFila?.());
  }

  return (
    <>
      {recado && (
        <div className={`aviso ${recado.tom}`} role="status">
          <strong>{recado.titulo}</strong>
          {recado.detalhe && <span className="detalhe">{recado.detalhe}</span>}
        </div>
      )}

      {!rascunho && (
        <div className="captura">
          <div className="mic-area">
            <button
              className={`mic ${ouvindo ? 'ouvindo' : ''}`}
              onClick={ouvindo ? parar : comecar}
              disabled={esperandoIA}
              aria-label={ouvindo ? 'Parar de escutar' : 'Falar um lançamento'}
            >
              <IconeMic />
            </button>
          </div>

          <div className="transcricao">
            {esperandoIA
              ? <span className="parcial">Pensando…</span>
              : texto || <span className="parcial">{ouvindo ? 'Pode falar…' : 'Toque e fale o gasto'}</span>}
          </div>

          {!ouvindo && !texto && (
            <p className="dica">Exemplos: &ldquo;mercado 120 reais&rdquo;, &ldquo;recebi meu salário de 3000&rdquo;, &ldquo;fone em 10x de 89,90&rdquo;</p>
          )}

          <div className="campo" style={{ width: '100%' }}>
            <label htmlFor="digitar">Ou escreva (o microfone do teclado funciona offline)</label>
            <input
              id="digitar"
              value={texto}
              placeholder="uber 23 reais"
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && texto.trim()) processar(texto.trim()); }}
            />
          </div>

          {texto.trim() && !ouvindo && (
            <button className="btn principal" onClick={() => processar(texto.trim())} disabled={esperandoIA}>
              Interpretar
            </button>
          )}
        </div>
      )}

      {rascunho && (
        <CartaoConfirmar
          rascunho={rascunho}
          setRascunho={setRascunho}
          categorias={categorias}
          contas={contas}
          onConfirmar={confirmar}
          onCancelar={() => { setRascunho(null); setTexto(''); }}
        />
      )}

      {resumo && (
        <>
          <p className="secao-titulo">Este mês</p>
          <div className="resumo">
            <div><span className="r">Entrou</span><span className="v pos">{formatarBRL(resumo.receitas)}</span></div>
            <div><span className="r">Saiu</span><span className="v">{formatarBRL(resumo.despesas)}</span></div>
            <div><span className="r">Sobra</span><span className={`v ${resumo.saldo >= 0 ? 'pos' : 'neg'}`}>{formatarBRL(resumo.saldo)}</span></div>
          </div>
        </>
      )}

      {resumo?.ultimos?.length > 0 && (
        <>
          <p className="secao-titulo">Últimos lançamentos</p>
          <div className="lista">
            {resumo.ultimos.slice(0, 8).map((l) => (
              <div className="item" key={l.uuid}>
                <div className="corpo">
                  <span className="titulo">{l.descricao || l.categoria}</span>
                  <span className="meta">{l.categoria} · {formatarData(l.data)}</span>
                </div>
                <span className={`num ${l.tipo === 'receita' ? 'receita' : ''}`}>
                  {l.tipo === 'receita' ? '+' : '−'}{formatarBRL(l.valor).replace('R$', '').trim()}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function CartaoConfirmar({ rascunho, setRascunho, categorias, contas, onConfirmar, onCancelar }) {
  const mudar = (campo) => (e) => setRascunho({ ...rascunho, [campo]: e.target.value });
  const daTipo = categorias.filter((c) => !c.tipo || c.tipo === rascunho.tipo);

  return (
    <div className="cartao destaque">
      <div className="valor-linha">
        <span className={`valor ${rascunho.tipo}`}>{formatarBRL(rascunho.valor)}</span>
        <span className={`etiqueta ${rascunho.tipo}`}>{rascunho.tipo === 'receita' ? 'entrada' : 'saída'}</span>
        {rascunho.parcelas_total > 1 && (
          <span className="etiqueta">{rascunho.parcelas_total}× de {formatarBRL(rascunho.valor / rascunho.parcelas_total)}</span>
        )}
      </div>

      <p className="ajuda">{rascunho.motivo}{rascunho.confianca === 'ia' ? '' : ' · regras locais'}</p>

      <div className="campo">
        <label htmlFor="descricao">Descrição</label>
        <input id="descricao" value={rascunho.descricao || ''} onChange={mudar('descricao')} />
      </div>

      <div className="linha">
        <div className="campo">
          <label htmlFor="categoria">Categoria</label>
          <select id="categoria" value={rascunho.categoria} onChange={mudar('categoria')}>
            {daTipo.map((c) => <option key={c.categoria} value={c.categoria}>{c.categoria}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="valorcampo">Valor</label>
          <input
            id="valorcampo"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={rascunho.valor}
            onChange={(e) => setRascunho({ ...rascunho, valor: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="linha">
        <div className="campo">
          <label htmlFor="data">Data</label>
          <input id="data" type="date" value={rascunho.data} onChange={mudar('data')} />
        </div>
        <div className="campo">
          <label htmlFor="conta">Conta</label>
          <select id="conta" value={rascunho.conta} onChange={mudar('conta')}>
            {contas.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {rascunho.extras?.length > 0 && (
        <div className="aviso bom">
          <strong>+{rascunho.extras.length} lançamento{rascunho.extras.length > 1 ? 's' : ''} na mesma frase</strong>
          <span className="detalhe">
            {rascunho.extras.map((e) => `${e.categoria} ${formatarBRL(e.valor)}`).join(' · ')}
          </span>
        </div>
      )}

      <div className="botoes">
        <button className="btn discreto" onClick={onCancelar}>Descartar</button>
        <button className="btn principal" onClick={onConfirmar}>Confirmar</button>
      </div>
    </div>
  );
}

const MOTIVO_TELA = {
  sem_creditos: 'Os créditos da API acabaram. Assim que você recarregar, interpreto sozinho — sua frase está guardada.',
  chave_invalida: 'A chave da API foi recusada. Confira nos Ajustes do script.',
  sem_chave: 'A chave da API ainda não foi configurada no script.',
  sem_rede: 'Sem internet agora. Envio assim que voltar.',
  sem_configuracao: 'Configure o endereço e o token nos Ajustes para eu conseguir enviar.',
  api_fora: 'A IA está fora do ar. Tento de novo sozinho.',
  limite_taxa: 'Muitas chamadas seguidas. Tento de novo daqui a pouco.',
  nada_entendido: 'Não achei um valor na frase. Dá uma olhada na fila e corrija se quiser.'
};

function formatarData(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).split('-');
  const hoje = new Date();
  const z = (n) => String(n).padStart(2, '0');
  if (iso === `${hoje.getFullYear()}-${z(hoje.getMonth() + 1)}-${z(hoje.getDate())}`) return 'hoje';
  return `${d}/${m}`;
}
