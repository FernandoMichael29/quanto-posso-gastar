import { useRef, useState } from 'react';
import GraficoProjecao from '../componentes/GraficoProjecao.jsx';
import { api, configurado } from '../lib/api.js';
import { escutar, ERRO_VOZ, temReconhecimento } from '../lib/voz.js';
import { formatarBRL } from '../lib/parser.js';

const SUGESTOES = [
  'Estou pensando em comprar um carro com parcela de 950. Quanto isso afeta minhas finanças?',
  'Onde meu dinheiro está indo que eu não percebo?',
  'Consigo guardar 500 por mês do jeito que estou hoje?',
  'Se eu cortar delivery pela metade, quanto sobra no ano?'
];

const VEREDITOS = {
  confortavel: { rotulo: 'Cabe no seu orçamento', classe: 'bom' },
  apertado: { rotulo: 'Cabe, mas sem margem', classe: 'atencao' },
  arriscado: { rotulo: 'Compromete mais do que sobra', classe: 'ruim' }
};

const ERROS = {
  sem_dados: 'Ainda não tenho lançamentos suficientes para projetar. Registre sua renda e alguns gastos primeiro — uma ou duas semanas já dão uma boa base.',
  sem_chave: 'A chave da API não está configurada no script.',
  sem_creditos: 'Os créditos da API acabaram. Recarregue em console.anthropic.com e tente de novo.',
  chave_invalida: 'A chave da API foi recusada. Confira o ANTHROPIC_KEY no Apps Script.',
  teto_diario: 'Você atingiu o teto de análises por hoje. Ele volta amanhã.',
  sem_rede: 'Sem internet. Esta tela precisa de conexão — ela consulta seu histórico na hora.',
  sem_configuracao: 'Configure o endereço e o token nos Ajustes primeiro.',
  limite_taxa: 'Muitas chamadas seguidas. Espera um minuto e tenta de novo.',
  api_fora: 'A IA está fora do ar agora. Tenta daqui a pouco.',
  // O script devolveu 200 sem corpo nenhum: quase sempre a execução dele
  // estourou o tempo no meio da análise.
  resposta_vazia: 'O script da planilha não terminou a análise a tempo e não respondeu nada. Tente de novo — se repetir, veja "Execuções" no Apps Script para ver onde ele parou.',
  resposta_estranha: 'O script respondeu algo que não é JSON. Confira se a implantação está atualizada no Apps Script.'
};

export default function Perguntar() {
  const [pergunta, setPergunta] = useState('');
  const [pensando, setPensando] = useState(false);
  const [analise, setAnalise] = useState(null);
  const [erro, setErro] = useState(null);
  const [ouvindo, setOuvindo] = useState(false);
  const sessao = useRef(null);

  async function enviar(texto) {
    const q = (texto ?? pergunta).trim();
    if (!q || pensando) return;

    if (!configurado()) { setErro(ERROS.sem_configuracao); return; }

    setPergunta(q);
    setPensando(true);
    setErro(null);
    setAnalise(null);

    const r = await api.perguntar(q);

    if (r.ok) { setPensando(false); setAnalise(r); return; }

    // A resposta pode ter se perdido no caminho depois de pronta — o script
    // grava toda análise na planilha, então vale procurar lá antes de dizer
    // que falhou. Isso não custa IA nenhuma.
    if (r.erro === 'resposta_vazia' || r.erro === 'sem_rede') {
      const guardada = await recuperarUltima(q);
      if (guardada) {
        setPensando(false);
        setAnalise({ ...guardada, recuperada: true });
        return;
      }
    }

    setPensando(false);
    setErro(ERROS[r.erro] || r.detalhe || 'Não consegui responder agora.');
  }

  /** A última análise da planilha, se for desta mesma pergunta e recente. */
  async function recuperarUltima(q) {
    const r = await api.conversas(1);
    const c = r.ok && r.conversas?.[0];
    if (!c?.analise) return null;
    if (normalizar(c.pergunta) !== normalizar(q)) return null;
    const quando = Date.parse(c.data);
    if (!quando || Date.now() - quando > 15 * 60 * 1000) return null;
    return c.analise;
  }

  function falar() {
    if (!temReconhecimento() || !navigator.onLine) {
      setErro('Sem reconhecimento de voz agora. Use o microfone do teclado no campo.');
      return;
    }
    setOuvindo(true);
    sessao.current = escutar({
      aoTexto: (t) => setPergunta(t),
      aoFim: (t) => { setOuvindo(false); if (t) enviar(t); },
      aoErro: (c) => { setOuvindo(false); setErro(ERRO_VOZ[c] || 'Não consegui ouvir.'); }
    });
  }

  const veredito = analise && VEREDITOS[analise.veredito];

  return (
    <>
      <div className="cartao">
        <div className="campo">
          <label htmlFor="pergunta">Pergunte sobre o seu dinheiro</label>
          <textarea
            id="pergunta"
            rows={3}
            value={pergunta}
            placeholder="Estou pensando em comprar um carro com parcela de 950. Quanto isso afeta minhas finanças?"
            onChange={(e) => setPergunta(e.target.value)}
          />
        </div>
        <div className="botoes">
          <button
            className="btn"
            onClick={ouvindo ? () => { sessao.current?.parar(); setOuvindo(false); } : falar}
            disabled={pensando}
          >
            {ouvindo ? 'Ouvindo…' : '🎙 Falar'}
          </button>
          <button className="btn principal" onClick={() => enviar()} disabled={pensando || !pergunta.trim()}>
            {pensando ? 'Analisando…' : 'Perguntar'}
          </button>
        </div>
        <p className="ajuda">
          Eu leio seu histórico real, seus compromissos fixos e o que você já me contou.
          Cada pergunta custa menos de vinte centavos.
        </p>
      </div>

      {!analise && !pensando && !erro && (
        <>
          <p className="secao-titulo">Para começar</p>
          <div className="lista">
            {SUGESTOES.map((s) => (
              <button key={s} className="item sugestao" onClick={() => enviar(s)}>
                <span className="corpo"><span className="titulo">{s}</span></span>
                <span className="seta" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </>
      )}

      {pensando && (
        <div className="cartao pensando">
          <span className="girando" aria-hidden="true" />
          <span>Lendo seus meses e montando a projeção…</span>
        </div>
      )}

      {erro && (
        <div className="aviso ruim" role="alert">
          <strong>Não deu pra responder</strong>
          <span className="detalhe">{erro}</span>
        </div>
      )}

      {analise && (
        <>
          {analise.recuperada && (
            <div className="aviso bom" role="status">
              <strong>Recuperei a resposta da planilha</strong>
              <span className="detalhe">
                A análise já tinha sido feita e ficou guardada — não gastei uma nova chamada de IA.
              </span>
            </div>
          )}

          {veredito && (
            <div className={`aviso ${veredito.classe}`}>
              <strong>{veredito.rotulo}</strong>
              {analise.compromisso_mensal > 0 && (
                <span className="detalhe">
                  Simulando {formatarBRL(analise.compromisso_mensal)} por mês.
                </span>
              )}
            </div>
          )}

          <div className="cartao">
            {String(analise.resposta || '')
              .split(/\n{2,}/)
              .filter(Boolean)
              .map((p, i) => <p key={i}>{p}</p>)}
          </div>

          <GraficoProjecao
            projecao={analise.projecao}
            compromisso={analise.compromisso_mensal}
          />

          {analise.sugestoes?.length > 0 && (
            <>
              <p className="secao-titulo">O que dá pra fazer</p>
              <div className="lista">
                {analise.sugestoes.map((s, i) => (
                  <div className="item" key={i}>
                    <span className="marcador" aria-hidden="true">{i + 1}</span>
                    <span className="corpo"><span className="titulo">{s}</span></span>
                  </div>
                ))}
              </div>
            </>
          )}

          {analise.premissas?.length > 0 && (
            <>
              <p className="secao-titulo">No que eu me baseei</p>
              <div className="cartao">
                <ul className="premissas">
                  {analise.premissas.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
                <p className="ajuda">
                  Se alguma dessas premissas estiver errada, me corrija falando —
                  tipo &ldquo;meu aluguel agora é 1900&rdquo; — e pergunte de novo.
                </p>
              </div>
            </>
          )}

          <button className="btn discreto" onClick={() => { setAnalise(null); setPergunta(''); }}>
            Fazer outra pergunta
          </button>
        </>
      )}
    </>
  );
}

/** Compara perguntas ignorando acento, caixa e espaço sobrando. */
function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
