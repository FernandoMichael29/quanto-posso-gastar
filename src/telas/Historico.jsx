import { useEffect, useState } from 'react';
import Analise from '../componentes/Analise.jsx';
import Esqueleto from '../componentes/Esqueleto.jsx';
import { formatarBRL } from '../lib/parser.js';
import { excluir, gastoDoMes, lerCache, sincronizar } from '../lib/conversas.js';

// Rótulo curto do veredito, na cor que ele merece.
const VEREDITO = {
  confortavel: { texto: 'cabe', classe: 'pos' },
  apertado: { texto: 'aperta', classe: 'warn' },
  arriscado: { texto: 'arriscado', classe: 'neg' }
};

// Toda pergunta já foi paga uma vez. Aqui elas ficam para ser reabertas de
// graça: a lista sai do aparelho (abre na hora, inclusive offline) e se
// atualiza com a planilha quando há internet.

export default function Historico() {
  const [lista, setLista] = useState(lerCache);
  const [carregando, setCarregando] = useState(false);
  const [aberta, setAberta] = useState(null);
  const [apagando, setApagando] = useState(null);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    let vivo = true;
    setCarregando(lerCache().length === 0);
    sincronizar().then((r) => {
      if (!vivo) return;
      setCarregando(false);
      setLista(r.lista);
      if (!r.ok && r.lista.length) setAviso('Mostrando o que está guardado neste aparelho.');
    });
    return () => { vivo = false; };
  }, []);

  async function apagar(c) {
    setApagando(c.data);
    const foi = await excluir(c.data);
    setApagando(null);
    if (!foi) { setAviso('Não consegui apagar essa pergunta na planilha.'); return; }
    setLista((atual) => atual.filter((x) => x.data !== c.data));
    if (aberta?.data === c.data) setAberta(null);
  }

  const gasto = gastoDoMes(lista);

  if (aberta) {
    return (
      <>
        <button className="btn discreto voltar" onClick={() => setAberta(null)}>‹ Todas as perguntas</button>

        <div className="cartao">
          <p className="secao-titulo" style={{ margin: 0 }}>{quando(aberta.data)}</p>
          <p style={{ margin: 0 }}>{aberta.pergunta}</p>
        </div>

        {aberta.analise
          ? <Analise analise={aberta.analise} />
          : (
            <div className="cartao">
              <p style={{ margin: 0 }}>{aberta.resposta}</p>
              <p className="ajuda">
                Esta é uma pergunta antiga: o texto ficou guardado, mas o gráfico e as
                sugestões não — eles só passaram a ser salvos depois.
              </p>
            </div>
          )}
      </>
    );
  }

  return (
    <>
      <p className="secao-titulo">Perguntas que você já fez</p>

      {aviso && (
        <div className="aviso atencao" role="status">
          <span className="detalhe">{aviso}</span>
        </div>
      )}

      {carregando && <Esqueleto modo="lista" />}

      {!carregando && lista.length === 0 && (
        <div className="lista">
          <p className="vazio">
            Nada aqui ainda. Toque em Perguntar e faça a primeira pergunta — ela fica
            guardada e você reabre quantas vezes quiser, sem pagar de novo.
          </p>
        </div>
      )}

      {lista.length > 0 && (
        <div className="lista">
          {lista.map((c) => (
            <div className={`item conversa ${apagando === c.data ? 'ocupado' : ''}`} key={c.data}>
              <button type="button" className="corpo abrir-conversa" onClick={() => setAberta(c)}>
                <span className="titulo">{c.pergunta}</span>
                <span className="meta">
                  {quando(c.data)}
                  {VEREDITO[c.analise?.veredito] && (
                    <>
                      {' · '}
                      <strong className={VEREDITO[c.analise.veredito].classe}>
                        {VEREDITO[c.analise.veredito].texto}
                      </strong>
                    </>
                  )}
                </span>
              </button>
              <button
                type="button"
                className="btn discreto pequeno"
                onClick={() => apagar(c)}
                disabled={apagando === c.data}
                aria-label={`Apagar a pergunta ${c.pergunta}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {gasto.quantas > 0 && (
        <p className="ajuda">
          {gasto.quantas} {gasto.quantas === 1 ? 'análise' : 'análises'} este mês ·{' '}
          {formatarBRL(gasto.total)} em IA.
        </p>
      )}
    </>
  );
}

/** "hoje, 13:53" ou "15/09, 09:12" — data curta, hora sempre. */
function quando(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const z = (n) => String(n).padStart(2, '0');
  const hora = `${z(d.getHours())}:${z(d.getMinutes())}`;
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return mesmoDia ? `hoje, ${hora}` : `${z(d.getDate())}/${z(d.getMonth() + 1)}, ${hora}`;
}
