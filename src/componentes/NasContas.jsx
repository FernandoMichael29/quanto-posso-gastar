import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatarBRL, soNumero } from '../lib/parser.js';
import { nomeDoMes, mesDeHoje } from '../lib/datas.js';
import { CampoValor, Modal, useSaida } from '../telas/Baus.jsx';

// "Dinheiro nas contas" (Mês → Resumo): o saldo de cada conta a partir do
// último valor conferido com o banco, e quanto ela rende. O rendimento de
// conta que rende pelo CDI entra como renda um pouco por dia — quem faz isso é
// o script (atualizarRendimentosContas_); aqui só se mostra e se acerta.

const CACHE = 'qpg.contas';
const diaMes = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const sinalBRL = (v) => `${v < 0 ? '−' : '+'}${formatarBRL(Math.abs(v))}`;
const uns = (v) => (Math.abs(v) >= 10 ? `R$ ${Math.round(v).toLocaleString('pt-BR')}` : formatarBRL(v));
const pctTexto = (v) => String(Math.round((Number(v) || 0) * 100) / 100).replace('.', ',');

function cacheSalvo() {
  try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { return null; }
}

/** Um rostinho de cor por banco: ajuda a achar a conta sem ler. */
export function iconeDaConta(c) {
  const n = String(c?.nome || '').toLowerCase();
  if (c?.tipo === 'dinheiro' || /dinheiro|carteira|esp[eé]cie/.test(n)) return '💵';
  if (/nu ?bank|\bnu\b/.test(n)) return '🟣';
  if (/ita[uú]|inter\b/.test(n)) return '🟠';
  if (/santander|bradesco/.test(n)) return '🔴';
  if (/caixa|mercado ?pago/.test(n)) return '🔵';
  if (/brasil|\bbb\b/.test(n)) return '🟡';
  if (/picpay|sicredi|sicoob/.test(n)) return '🟢';
  if (/c6/.test(n)) return '⚫';
  if (c?.tipo === 'beneficio') return '🍽️';
  return '🏦';
}

export function textoRende(r) {
  if (r?.tipo === 'cdi') return `▲ ${pctTexto(r.pct)}% do CDI`;
  if (r?.tipo === 'extrato') return 'rendimento vem do extrato';
  return 'não rende';
}

/** Benefício (Caju, VR) só aparece se você já informou o saldo dele. */
const visivel = (c) => c.tipo !== 'beneficio' || c.saldo !== null;

const ERROS = {
  conta_desconhecida: 'Essa conta não existe mais (ou é cartão de crédito).',
  saldo_invalido: 'Esse saldo não parece um valor.',
  data_invalida: 'A data do saldo está no futuro.'
};

export default function NasContas({ painel, aoMudar }) {
  const [dados, setDados] = useState(cacheSalvo);
  const [aberta, setAberta] = useState(null);       // nome da conta aberta
  const [semScript, setSemScript] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.contasSaldo().then((r) => {
      if (!vivo) return;
      if (r?.ok) {
        setDados(r);
        try { localStorage.setItem(CACHE, JSON.stringify(r)); } catch { /* sem espaço: tudo bem */ }
      } else if (r?.erro === 'acao_desconhecida') setSemScript(true);
    });
    return () => { vivo = false; };
  }, [painel]);

  if (semScript || !dados?.contas) return null;
  const lista = dados.contas.filter(visivel);
  if (!lista.length) return null;

  const conhecidas = lista.filter((c) => c.saldo !== null);
  const algumaRende = lista.some((c) => c.rende?.tipo === 'cdi' && c.saldo !== null);
  const mes = mesDeHoje();
  const conta = lista.find((c) => c.nome === aberta);

  function aoAcertar(r) {
    setDados(r);
    try { localStorage.setItem(CACHE, JSON.stringify(r)); } catch { /* ok */ }
    aoMudar?.();
  }

  return (
    <div className="cartao nas-contas">
      <div className="cab">
        <span className="secao-titulo" style={{ margin: 0 }}>Dinheiro nas contas</span>
        <span className="px total">{conhecidas.length ? formatarBRL(dados.total) : '—'}</span>
      </div>
      {algumaRende && dados.rendeu_mes > 0 && (
        <span className="rend">
          Rendeu <b>+{formatarBRL(dados.rendeu_mes)}</b> em {nomeDoMes(mes).toLowerCase()} — já entrou como renda, um pouco por dia.
        </span>
      )}
      {!conhecidas.length && (
        <span className="rend">Toque numa conta e digite o saldo que aparece no app do banco. Daí para frente o app acompanha sozinho.</span>
      )}
      <div className="bolsas">
        {lista.map((c) => (
          <button key={c.nome} type="button" className="bolsa" onClick={() => setAberta(c.nome)}>
            <span className="moeda" aria-hidden="true">{iconeDaConta(c)}</span>
            <span className="n">
              <strong>{c.nome}</strong>
              <small>
                {textoRende(c.rende)}
                {c.saldo !== null ? ` · conferido ${diaMes(c.conferido?.data)}` : ''}
              </small>
            </span>
            <span className="v">
              {c.saldo !== null
                ? <span className={`px ${c.saldo < 0 ? 'neg' : ''}`}>{formatarBRL(c.saldo)}</span>
                : <span className="informar">informar saldo</span>}
              {c.saldo !== null && c.rende?.tipo === 'cdi' && c.rendeu_mes > 0 && (
                <small className="verde">+{formatarBRL(c.rendeu_mes)} em {nomeDoMes(mes).toLowerCase()}</small>
              )}
            </span>
          </button>
        ))}
      </div>
      <span className="conferido">
        Saldo = o último valor conferido com o banco + o que foi lançado depois{algumaRende ? ' + o rendimento estimado' : ''}.
        {dados.estimado ? ' O Banco Central não respondeu hoje: o CDI usado é o último conhecido.' : ''}
      </span>
      {conta && <ContaAberta conta={conta} dados={dados} aoAcertar={aoAcertar} aoFechar={() => setAberta(null)} />}
    </div>
  );
}

function ContaAberta({ conta, dados, aoAcertar, aoFechar }) {
  const [acerto, setAcerto] = useState(conta.saldo === null ? { valor: 0 } : null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);
  const [feito, setFeito] = useState(null);
  const [saindo, fechar] = useSaida(aoFechar, ocupado);
  const r = conta.rende || {};
  const mes = mesDeHoje();
  const novo = conta.saldo === null;

  async function confirmar() {
    setOcupado(true); setErro(null);
    const resp = await api.acertarConta(conta.nome, acerto.valor);
    setOcupado(false);
    if (!resp?.ok) { setErro(ERROS[resp?.erro] || 'Não consegui falar com a planilha. Tente de novo.'); return; }
    setFeito(resp.acertado || null);
    setAcerto(null);
    aoAcertar(resp);
  }

  if (acerto) {
    const dif = novo ? null : Math.round((acerto.valor - conta.saldo) * 100) / 100;
    return (
      <Modal rotulo={`Acertar com o banco · ${conta.nome}`} saindo={saindo} aoFechar={fechar}>
        <div className="cartao destaque folha-bau">
          <p className="secao-titulo" style={{ margin: 0 }}>{novo ? 'Saldo de hoje' : 'Acertar com o banco'} · <b>{conta.nome}</b></p>
          <p className="ajuda" style={{ margin: 0 }}>Abra o app do banco e digite o saldo que aparece lá agora.</p>
          <CampoValor id="conta-saldo" valor={acerto.valor} rotulo="Saldo no app do banco, em reais"
            aoMudar={(v) => setAcerto({ valor: v })} />
          {!novo && (
            <div className="dif">
              {Math.abs(dif) < 0.01
                ? 'Igual ao que o app calculava: nada para acertar.'
                : <>O app calculava <b>{formatarBRL(conta.saldo)}</b>. A diferença de <strong className={dif > 0 ? 'pos' : 'neg'}>{sinalBRL(dif)}</strong> fica registrada, e o cálculo continua a partir do valor do banco.</>}
            </div>
          )}
          {!novo && Math.abs(dif) > Math.max(50, Math.abs(conta.saldo) * 0.05) && (
            <p className="ajuda" style={{ margin: 0 }}>Diferença grande: confira se não ficou faltando lançar alguma coisa nesta conta.</p>
          )}
          <p className="ajuda" style={{ margin: 0 }}>
            Dica: ao importar o extrato em PDF, o <b>saldo final</b> do Nubank e o <b>saldo do dia</b> do Itaú acertam sozinhos.
          </p>
          {erro && <div className="aviso ruim" role="alert"><strong>{erro}</strong></div>}
          <div className="botoes">
            <button type="button" className="btn discreto" onClick={novo ? fechar : () => setAcerto(null)} disabled={ocupado}>Cancelar</button>
            <button type="button" className="btn principal" onClick={confirmar}
              disabled={ocupado || (!novo && Math.abs(dif) < 0.01)}>{ocupado ? 'Salvando…' : (novo ? 'Salvar saldo' : 'Acertar')}</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal rotulo={`Conta ${conta.nome}`} saindo={saindo} aoFechar={fechar}>
      <div className="cartao conta-aberta">
        <div className="janela-bau">
          <div className="cab-bau">
            <span className="slot grande icone-conta" aria-hidden="true">{iconeDaConta(conta)}</span>
            <div className="cab-bau-texto">
              <h2>{conta.nome}</h2>
              <span className="saldo-bau">{formatarBRL(conta.saldo)}</span>
            </div>
          </div>
          {r.tipo === 'cdi' && <span className="selo-rende px">▲ {pctTexto(r.pct)}% DO CDI</span>}
          {feito && feito.diferenca !== null && Math.abs(feito.diferenca) >= 0.01 && (
            <p className="sub">Acertado: {sinalBRL(feito.diferenca)} em relação ao que o app calculava.</p>
          )}
          <div className="linhas-rende">
            <div>
              <span>Conferido {conta.conferido?.origem === 'extrato' ? 'pelo extrato' : 'com o banco'} em {diaMes(conta.conferido?.data)}</span>
              <b>{formatarBRL(conta.conferido?.saldo)}</b>
            </div>
            {conta.entrou > 0 && <div><span>Entrou depois disso</span><b className="verde">+{formatarBRL(conta.entrou)}</b></div>}
            {conta.saiu > 0 && <div><span>Saiu depois disso</span><b>−{formatarBRL(conta.saiu)}</b></div>}
            {r.tipo === 'cdi' && <div><span>Rendeu depois disso</span><b className="verde">+{formatarBRL(conta.rendeu)}</b></div>}
            {r.tipo === 'cdi' && (
              <div className="cinza">
                <span>
                  Rendendo uns {uns(conta.rende_por_mes)} por mês (já sem o IR)
                  {dados.cdi_data ? ` · CDI de ${diaMes(dados.cdi_data)}` : ''}
                  {dados.estimado ? ' · estimado' : ''}
                </span>
              </div>
            )}
          </div>
          <p className="sub">
            {r.tipo === 'cdi'
              ? <>O que rende entra como renda todo dia útil — em {nomeDoMes(mes).toLowerCase()} já são <b>+{formatarBRL(conta.rendeu_mes)}</b>, e o herói ganha esse ouro.</>
              : r.tipo === 'extrato'
                ? 'O rendimento desta conta chega quando você importa o extrato (o REND PAGO do Itaú, por exemplo).'
                : 'Esta conta não rende. Se ela rende (Nubank, Mercado Pago…), mude em Ajustes → Contas.'}
          </p>
        </div>

        <button type="button" className="btn-px" onClick={() => setAcerto({ valor: Math.max(0, conta.saldo) })}>ACERTAR COM O BANCO</button>

        {conta.rendimentos?.length > 0 && (
          <>
            <p className="secao-titulo" style={{ margin: 0 }}>Rendimentos</p>
            <div className="lista">
              {conta.rendimentos.map((m) => (
                <div key={m.mes} className="item">
                  <span className="corpo">
                    <span className="meta">{m.mes === mes ? 'até agora · renda do mês' : 'renda do mês'}</span>
                    <span className="titulo">Rendeu em {nomeDoMes(m.mes).toLowerCase()}</span>
                  </span>
                  <span className="num receita">+{soNumero(m.valor)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {conta.acertos?.length > 0 && (
          <>
            <p className="secao-titulo" style={{ margin: 0 }}>Conferências com o banco</p>
            <div className="lista">
              {conta.acertos.map((a, i) => (
                <div key={`${a.data}-${i}`} className="item">
                  <span className="corpo">
                    <span className="meta">{diaMes(a.data)} · {a.origem === 'extrato' ? 'extrato importado' : 'você digitou'}</span>
                    <span className="titulo">Saldo {formatarBRL(a.saldo)}</span>
                  </span>
                  <span className="num">{a.diferenca === null || Math.abs(a.diferenca) < 0.01 ? '—' : sinalBRL(a.diferenca).replace('R$ ', '')}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <button type="button" className="btn discreto" onClick={fechar}>Fechar</button>
      </div>
    </Modal>
  );
}
