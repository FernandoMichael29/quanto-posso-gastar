import { useEffect, useRef, useState } from 'react';
import Analise from '../componentes/Analise.jsx';
import { api, configurado } from '../lib/api.js';
import { escutar, ERRO_VOZ, temReconhecimento } from '../lib/voz.js';
import { guardar, lerCache, sincronizar } from '../lib/conversas.js';

const SUGESTOES = [
  'Estou pensando em comprar um carro com parcela de 950. Quanto isso afeta minhas finanças?',
  'Onde meu dinheiro está indo que eu não percebo?',
  'Consigo guardar 500 por mês do jeito que estou hoje?',
  'Se eu cortar delivery pela metade, quanto sobra no ano?'
];

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
  // O script devolveu 200 sem corpo nenhum: quase sempre a resposta se perdeu
  // no caminho depois de pronta.
  resposta_vazia: 'A resposta não chegou inteira no aparelho. A análise pode ter ficado guardada — veja no Histórico antes de perguntar de novo.',
  resposta_estranha: 'O script respondeu algo que não é JSON — provavelmente uma página de erro do Google.'
};

export default function Perguntar({ aoVerHistorico }) {
  const [pergunta, setPergunta] = useState('');
  const [pensando, setPensando] = useState(false);
  const [analise, setAnalise] = useState(null);
  const [recuperada, setRecuperada] = useState(false);
  const [erro, setErro] = useState(null);
  const [ouvindo, setOuvindo] = useState(false);
  const [recentes, setRecentes] = useState(() => lerCache().slice(0, 3));
  const sessao = useRef(null);

  // O histórico local abre na hora; a planilha atualiza em segundo plano.
  useEffect(() => {
    let vivo = true;
    sincronizar().then((r) => { if (vivo) setRecentes(r.lista.slice(0, 3)); });
    return () => { vivo = false; };
  }, []);

  async function enviar(texto) {
    const q = (texto ?? pergunta).trim();
    if (!q || pensando) return;

    if (!configurado()) { setErro(ERROS.sem_configuracao); return; }

    setPergunta(q);
    setPensando(true);
    setErro(null);
    setAnalise(null);
    setRecuperada(false);

    const r = await api.perguntar(q);

    if (r.ok) {
      setPensando(false);
      setAnalise(r);
      const nova = guardar(q, r);
      setRecentes([nova, ...lerCache().filter((c) => c.data !== nova.data)].slice(0, 3));
      return;
    }

    // A resposta pode ter se perdido no caminho depois de pronta — o script
    // grava toda análise na planilha, então vale procurar lá antes de dizer
    // que falhou. Isso não custa IA nenhuma.
    if (r.erro === 'resposta_vazia' || r.erro === 'resposta_estranha' || r.erro === 'sem_rede') {
      const guardada = await recuperarUltima(q);
      if (guardada) {
        setPensando(false);
        setAnalise(guardada);
        setRecuperada(true);
        return;
      }
    }

    setPensando(false);
    setErro([ERROS[r.erro] || 'Não consegui responder agora.', r.detalhe].filter(Boolean).join(' '));
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

          {/* As últimas já respondidas ficam à mão: reabrir não custa nada,
              perguntar de novo custa. */}
          {recentes.length > 0 && (
            <>
              <div className="secao-cabecalho">
                <p className="secao-titulo" style={{ margin: 0 }}>Você já perguntou</p>
                <button type="button" className="btn discreto pequeno" onClick={aoVerHistorico}>
                  ver todas ›
                </button>
              </div>
              <div className="lista">
                {recentes.map((c) => (
                  <button key={c.data} className="item sugestao" onClick={aoVerHistorico}>
                    <span className="corpo"><span className="titulo">{c.pergunta}</span></span>
                    <span className="seta" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </>
          )}
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
          {recuperada && (
            <div className="aviso bom" role="status">
              <strong>Recuperei a resposta da planilha</strong>
              <span className="detalhe">
                A análise já tinha sido feita e ficou guardada — não gastei uma nova chamada de IA.
              </span>
            </div>
          )}

          <Analise analise={analise} />

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
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
