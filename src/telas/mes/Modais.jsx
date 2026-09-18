// As janelas da tela Mês. Nenhuma fala com a planilha: recebem o rascunho,
// devolvem mudanças por aoMudar e chamam aoConfirmar. Quem salva é Mes.jsx.
import { useState } from 'react';
import CartaoLancamento from '../../componentes/CartaoLancamento.jsx';
import { formatarBRL, soNumero } from '../../lib/parser.js';

/**
 * Fechar com animação: o React desmonta na hora, então 'saindo' segura o
 * desenho pelos 120 ms da saída e só então avisa quem abriu.
 */
function useSaida(aoFechar, ocupado) {
  const [saindo, setSaindo] = useState(false);
  function fechar() {
    if (ocupado || saindo) return;
    setSaindo(true);
    setTimeout(aoFechar, 120);
  }
  return [saindo, fechar];
}

function Modal({ rotulo, saindo, aoFechar, children }) {
  return (
    <div className={`modal ${saindo ? 'saindo' : ''}`} role="dialog" aria-modal="true" aria-label={rotulo}>
      <div className="modal-fundo" onClick={aoFechar} />
      <div className="modal-corpo">{children}</div>
    </div>
  );
}

function Botoes({ ocupado, aoCancelar, rotuloCancelar = 'Cancelar', aoConfirmar, rotulo, rotuloOcupado, desabilitado }) {
  return (
    <div className="botoes">
      <button className="btn discreto" onClick={aoCancelar} disabled={ocupado}>{rotuloCancelar}</button>
      <button className="btn principal" onClick={aoConfirmar} disabled={ocupado || desabilitado}>
        {ocupado ? rotuloOcupado : rotulo}
      </button>
    </div>
  );
}

/**
 * Renda agendada: caiu mesmo, e de quanto? O valor vem preenchido com o
 * previsto e dá para corrigir aqui — comissão, hora extra e desconto fazem o
 * que cai ser diferente do combinado, e voltar depois para editar é um passo
 * que ninguém dá.
 */
export function ConfirmarRenda({ item, previsto, ocupado, aoMudar, aoFechar, aoConfirmar }) {
  const [saindo, fechar] = useSaida(aoFechar, ocupado);
  const valor = Number(item.valor) || 0;
  const diferenca = valor - previsto;
  const iguais = Math.abs(diferenca) < 0.01;

  return (
    <Modal rotulo="Confirmar recebimento" saindo={saindo} aoFechar={fechar}>
      <div className="cartao destaque">
        <div className="valor-linha">
          <label className="rotulo-campo-grande" htmlFor="renda-valor">Quanto caiu</label>
          <span className="etiqueta receita">agendado</span>
        </div>

        {/* O número grande é o próprio campo: ele continua sendo a estrela do
            card e muda ali mesmo, sem um segundo lugar para olhar. */}
        <div className="valor-campo">
          <span className="moeda" aria-hidden="true">R$</span>
          <input
            id="renda-valor"
            type="text"
            inputMode="numeric"
            aria-label="Quanto caiu, em reais"
            value={soNumero(valor)}
            onChange={(e) => {
              // Só dígitos, e os dois últimos são os centavos: digitar 235040
              // vira 2.350,40. No celular abre o teclado numérico e ninguém
              // precisa achar a vírgula.
              const digitos = e.target.value.replace(/\D/g, '').slice(0, 11);
              aoMudar({ ...item, valor: Number(digitos) / 100 });
            }}
          />
        </div>

        <p className="ajuda" style={{ margin: 0 }}>
          Previsto {formatarBRL(previsto)} ·{' '}
          <strong className={iguais ? '' : (diferenca > 0 ? 'mais' : 'menos')}>
            {iguais
              ? 'sem diferença'
              : `${formatarBRL(Math.abs(diferenca))} ${diferenca > 0 ? 'a mais' : 'a menos'}`}
          </strong>
          {iguais ? '.' : '. Vale só para este mês.'}
        </p>

        <p className="secao-titulo" style={{ margin: 0 }}>{item.nome_visivel || item.nome}</p>
        <p className="ajuda">
          Esse dinheiro está previsto, mas ainda não conta como recebido.
          Caiu mesmo? Registro com a data de hoje.
        </p>

        <Botoes ocupado={ocupado} aoCancelar={fechar} rotuloCancelar="Ainda não"
          aoConfirmar={aoConfirmar} rotulo="Caiu, pode contar" rotuloOcupado="Registrando…"
          desabilitado={!valor} />
      </div>
    </Modal>
  );
}

export function EditarLancamento({ lancamento, cadastros, ocupado, aoMudar, aoFechar, aoSalvar, aoExcluir, aoTornarMensal }) {
  const [saindo, fechar] = useSaida(aoFechar, ocupado);
  return (
    <Modal rotulo="Editar lançamento" saindo={saindo} aoFechar={fechar}>
      <CartaoLancamento
        valor={lancamento}
        aoMudar={aoMudar}
        cadastros={cadastros}
        modo="editar"
        ocupado={ocupado}
        aoConfirmar={aoSalvar}
        aoCancelar={fechar}
        aoExcluir={aoExcluir}
        aoTornarMensal={aoTornarMensal}
      />
    </Modal>
  );
}

export function PagarFatura({ fatura, contas, ocupado, aoMudar, aoFechar, aoConfirmar }) {
  const [saindo, fechar] = useSaida(aoFechar, ocupado);
  const mudar = (campo) => (e) => aoMudar({ ...fatura, [campo]: e.target.value });
  return (
    <Modal rotulo={`Pagar fatura ${fatura.cartao}`} saindo={saindo} aoFechar={fechar}>
      <div className="cartao destaque">
        <p className="secao-titulo" style={{ margin: 0 }}>Pagar fatura · {fatura.cartao}</p>
        <p className="ajuda">
          Aqui é onde o dinheiro sai de verdade. As compras que formaram esta fatura
          já foram contadas como gasto quando aconteceram, então este pagamento não
          entra de novo nas categorias.
        </p>

        <div className="linha">
          <div className="campo">
            <label htmlFor="fat-valor">Valor pago</label>
            <input id="fat-valor" type="number" inputMode="decimal" step="0.01" value={fatura.valor} onChange={mudar('valor')} />
          </div>
          <div className="campo">
            <label htmlFor="fat-data">Data</label>
            <input id="fat-data" type="date" value={fatura.data} onChange={mudar('data')} />
          </div>
        </div>

        <details className="opcional">
          <summary>De qual conta saiu <span>(opcional)</span></summary>
          <div className="campo">
            <select id="fat-conta" aria-label="De qual conta saiu" value={fatura.conta} onChange={mudar('conta')}>
              <option value="">não importa</option>
              {(contas || [])
                .filter((c) => c.tipo !== 'credito' && c.ativo !== false)
                .map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
            </select>
            <p className="ajuda">
              Só preencha se você acompanha o saldo de cada conta separado.
              Para o total do mês, tanto faz de onde saiu.
            </p>
          </div>
        </details>

        <Botoes ocupado={ocupado} aoCancelar={fechar} aoConfirmar={aoConfirmar}
          rotulo="Registrar pagamento" rotuloOcupado="Salvando…" desabilitado={!Number(fatura.valor)} />
      </div>
    </Modal>
  );
}

export function PagarFixa({ fixa, cadastros, ocupado, aoMudar, aoFechar, aoConfirmar }) {
  const [saindo, fechar] = useSaida(aoFechar, ocupado);
  const acao = fixa.receita ? 'Registrar recebimento' : 'Registrar pagamento';
  return (
    <Modal rotulo={`${acao} de ${fixa.nome}`} saindo={saindo} aoFechar={fechar}>
      <p className="modal-titulo">{acao} · {fixa.nome}</p>

      <CartaoLancamento
        valor={fixa.lancamento}
        aoMudar={(l) => aoMudar({ ...fixa, lancamento: l })}
        cadastros={cadastros}
        modo="confirmar"
        ocupado={ocupado}
        aoConfirmar={aoConfirmar}
        aoCancelar={fechar}
        rotuloCancelar="Fechar"
        permiteParcelar={false}
      />

      {/* Aqui só se registra o que aconteceu. Consertar a regra em si é em
          Ajustes, e sem este aviso não havia como descobrir isso. */}
      <p className="ajuda">
        Errado? {fixa.receita ? 'Esta renda' : 'Esta conta'} se conserta ou se apaga
        em <strong>Ajustes → Contas fixas e rendas mensais</strong>. Fechar aqui só
        fecha a janela.
      </p>

      {Math.abs(fixa.lancamento.valor - fixa.valorCombinado) >= 0.01 && (
        <div className="cartao">
          <p className="ajuda" style={{ margin: 0 }}>
            Veio diferente dos {formatarBRL(fixa.valorCombinado)} combinados. O que isso significa?
          </p>
          <div className="campo">
            <label htmlFor="ajuste-fixa">{fixa.receita ? 'A renda mensal' : 'A conta fixa'}</label>
            <select id="ajuste-fixa" value={fixa.ajuste} onChange={(e) => aoMudar({ ...fixa, ajuste: e.target.value })}>
              <option value="excecao">variou só este mês — continua {formatarBRL(fixa.valorCombinado)}</option>
              <option value="definir">
                {fixa.receita ? 'mudou de valor' : 'mudou de preço'} — passa a ser {formatarBRL(fixa.lancamento.valor)}
              </option>
              <option value="nenhum">{fixa.receita ? 'não mexer na renda' : 'não mexer na conta fixa'}</option>
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function TornarMensal({ regra, ocupado, aoMudar, aoFechar, aoConfirmar }) {
  const [saindo, fechar] = useSaida(aoFechar, ocupado);
  const mudar = (campo) => (e) => aoMudar({ ...regra, [campo]: e.target.value });
  const titulo = regra.receita ? 'Receber todo mês' : 'Repetir todo mês';
  return (
    <Modal rotulo="Transformar em conta fixa" saindo={saindo} aoFechar={fechar}>
      <div className="cartao destaque">
        <p className="secao-titulo" style={{ margin: 0 }}>{titulo}</p>
        <p className="ajuda">
          O {regra.receita ? 'recebimento' : 'gasto'} que você já registrou continua
          onde está. O que nasce aqui é a regra de que ele se repete — a partir deste mês,
          até você dizer o contrário.
          {regra.receita && ' A renda aparece como "a receber" todo mês, e você confirma quando cair.'}
        </p>

        <div className="campo">
          <label htmlFor="m-nome">Como chamar</label>
          <input id="m-nome" value={regra.nome} onChange={mudar('nome')} />
        </div>

        <div className="linha">
          <div className="campo">
            <label htmlFor="m-dia">{regra.receita ? 'Cai dia' : 'Vence dia'}</label>
            <input id="m-dia" type="number" min="1" max="31" inputMode="numeric" value={regra.dia} onChange={mudar('dia')} />
          </div>
          <div className="campo">
            <label htmlFor="m-fim">Até (opcional)</label>
            <input id="m-fim" type="month" value={regra.mes_fim} onChange={mudar('mes_fim')} />
          </div>
        </div>

        <Botoes ocupado={ocupado} aoCancelar={fechar} aoConfirmar={aoConfirmar}
          rotulo={titulo} rotuloOcupado="Salvando…" desabilitado={!regra.nome.trim()} />
      </div>
    </Modal>
  );
}
