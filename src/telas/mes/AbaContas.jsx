import Compromissos from '../../componentes/Compromissos.jsx';
import Sanfona from '../../componentes/Sanfona.jsx';
import { formatarBRL } from '../../lib/parser.js';
import { diaDe, nomeDoMes } from '../../lib/datas.js';
import { fixasDoPainel, rendasDoPainel, resumirFixas } from './util.js';

/** O que ainda vence ou cai: rendas, contas fixas, faturas e parceladas. */
export default function AbaContas({ painel, aoAbrirCompromisso, aoAbrirFatura, aoAbrirLancamento }) {
  const fixas = fixasDoPainel(painel);
  const atrasadas = resumirFixas(fixas.filter((f) => f.situacao === 'erro'));
  const aVencer = resumirFixas(fixas.filter((f) => f.situacao === 'pendente'));

  // A fatura só é conta a pagar depois que fecha. Antes disso ainda aceita
  // compras — vencer neste mês não quer dizer que já dá para pagar.
  const faturasAPagar = (painel.faturas || []).filter((f) => !f.aberta);
  const fechando = (painel.faturas || []).filter((f) => f.aberta)
    .concat(painel.faturas_em_formacao || [])
    .sort((a, b) => (a.fecha_em || '').localeCompare(b.fecha_em || ''));
  const totalFechando = fechando.reduce((a, f) => a + f.total, 0);

  return (
    <>
      {/* Renda mensal vem antes das contas: é com ela que você paga o resto. */}
      <Compromissos
        titulo="Rendas do mês"
        resumo={painel.a_receber_total > 0 ? `${formatarBRL(painel.a_receber_total)} a receber` : 'tudo recebido'}
        itens={rendasDoPainel(painel)}
        aoAbrir={aoAbrirCompromisso}
        rotuloFeitos={{ um: 'já recebida', varios: 'já recebidas' }}
      />

      {fixas.length > 0 && (
        <>
          <Compromissos
            titulo="Contas fixas do mês"
            resumo={`${formatarBRL(painel.fixas_total)} no total`}
            itens={fixas}
            aoAbrir={aoAbrirCompromisso}
            rotuloFeitos={{ um: 'já lançada', varios: 'já lançadas' }}
          />

          {atrasadas.total > 0 && (
            <div className="aviso ruim">
              <strong>Venceu e não foi lançado: {formatarBRL(atrasadas.total)}</strong>
              <span className="detalhe">
                {atrasadas.nomes.join(' · ')} — se já pagou, toque na conta para registrar.
              </span>
            </div>
          )}

          {aVencer.total > 0 && (
            <div className="aviso atencao">
              <strong>Ainda vai vencer: {formatarBRL(aVencer.total)}</strong>
              <span className="detalhe">
                Sobra projetada no fim do mês:{' '}
                {formatarBRL(painel.saldo + (painel.a_receber_total || 0) - painel.previsto_total)}
                {painel.a_receber_total > 0
                  ? ` (contando ${formatarBRL(painel.a_receber_total)} que ainda entram).`
                  : '.'}
              </span>
            </div>
          )}
        </>
      )}

      {painel.cartoes_sem_ciclo?.length > 0 && (
        <div className="aviso atencao">
          <strong>Falta o ciclo de {painel.cartoes_sem_ciclo.map((c) => c.nome).join(', ')}</strong>
          <span className="detalhe">
            {formatarBRL(painel.cartoes_sem_ciclo.reduce((a, c) => a + c.total, 0))} em compras
            sem fatura, porque o cartão não tem dia de vencimento.
            Preencha em Ajustes → Contas.
          </span>
        </div>
      )}

      {faturasAPagar.length > 0 && (
        <>
          <div className="secao-cabecalho">
            <p className="secao-titulo" style={{ margin: 0 }}>Faturas a pagar</p>
            {painel.faturas_abertas > 0 && (
              <span className="ajuda" style={{ margin: 0 }}>{formatarBRL(painel.faturas_abertas)} em aberto</span>
            )}
          </div>
          <div className="lista">
            {faturasAPagar.map((f) => (
              <button
                type="button"
                className={`item fatura clicavel ${f.pago ? 'paga' : ''}`}
                key={f.cartao}
                onClick={() => aoAbrirFatura(f)}
              >
                <span className={`ponto ${f.pago ? 'sincronizado' : 'pendente'}`} aria-hidden="true" />
                <span className="corpo">
                  <span className="titulo">{f.cartao}</span>
                  <span className="meta">
                    {f.pago
                      ? `paga${f.pago_em ? ` em ${diaDe(f.pago_em)}` : ''}`
                      : `${f.lancamentos} compra${f.lancamentos === 1 ? '' : 's'}${f.dia ? ` · vence dia ${f.dia}` : ''}`}
                    {f.pessoa ? ` · ${f.pessoa}` : ''}
                  </span>
                </span>
                <span className="num">{formatarBRL(f.pago ? f.valor_pago : f.total)}</span>
                <span className="seta" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Uma linha por compra, não por parcela: o que você quer saber é "devo
          quanto por mês, e até quando". */}
      {painel.parceladas?.length > 0 && (
        <>
          <p className="secao-titulo">Contas parceladas</p>
          <Sanfona
            titulo={`${painel.parceladas.length} compras parceladas`}
            resumo={`${formatarBRL(painel.parceladas.reduce((a, p) => a + p.valor, 0))} neste mês`}
          >
            <div className="lista">
              {painel.parceladas.map((p) => (
                <button type="button" className="item clicavel" key={p.uuid} onClick={() => aoAbrirLancamento(p.uuid)}>
                  <span className="corpo">
                    <span className="titulo">{p.nome}</span>
                    <span className="meta">
                      parcela {p.parcela_atual} de {p.parcelas_total}
                      {p.conta ? ` · ${p.conta}` : ''}
                      {p.pessoa ? ` · ${p.pessoa}` : ''}
                    </span>
                    <span className="meta">
                      faltam {p.parcelas_restantes} ({formatarBRL(p.falta_pagar)})
                      {p.ultima ? ` · até ${nomeDoMes(p.ultima.slice(0, 7))}` : ''}
                    </span>
                  </span>
                  <span className="num">{formatarBRL(p.valor)}</span>
                  <span className="seta" aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </Sanfona>
        </>
      )}

      {/* Comprou no crédito e ainda não virou fatura: o dinheiro já está
          comprometido, mesmo vencendo só no mês que vem. */}
      {fechando.length > 0 && (
        <>
          <div className="secao-cabecalho">
            <p className="secao-titulo" style={{ margin: 0 }}>Faturas fechando</p>
            <span className="ajuda" style={{ margin: 0 }}>{formatarBRL(totalFechando)} já comprometidos</span>
          </div>
          <div className="lista">
            {fechando.map((f) => (
              <div className="item fatura" key={`${f.cartao}-${f.mes}`}>
                <span className="ponto" aria-hidden="true" />
                <span className="corpo">
                  <span className="titulo">{f.cartao}</span>
                  <span className="meta">
                    {f.lancamentos} compra{f.lancamentos === 1 ? '' : 's'}
                    {f.fecha_em ? ` · fecha ${diaDe(f.fecha_em)}` : ''}
                    {f.dia ? ` · vence ${nomeDoMes(f.mes)}, dia ${f.dia}` : ''}
                    {f.pessoa ? ` · ${f.pessoa}` : ''}
                  </span>
                </span>
                <span className="num">{formatarBRL(f.total)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
