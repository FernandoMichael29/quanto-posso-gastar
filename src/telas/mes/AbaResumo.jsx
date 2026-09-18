import { useState } from 'react';
import Barras from '../../componentes/Barras.jsx';
import GraficoEvolucao from '../../componentes/GraficoEvolucao.jsx';
import Sanfona from '../../componentes/Sanfona.jsx';
import { formatarBRL, soNumero } from '../../lib/parser.js';
import { comSinal, lider, mesAberto, notaDaResposta } from './util.js';

const CORTES = [
  { id: 'categoria', rotulo: 'Categoria', campo: 'por_categoria' },
  { id: 'conta', rotulo: 'Conta', campo: 'por_conta' },
  { id: 'pessoa', rotulo: 'Pessoa', campo: 'por_pessoa' },
  { id: 'grupo', rotulo: 'Grupo', campo: 'por_grupo' }
];

/** Quanto sobra, e a prova: a conta montada, o gráfico e para onde foi. */
export default function AbaResumo({ painel }) {
  const [corte, setCorte] = useState('categoria');

  const aberto = mesAberto(painel);
  const livre = aberto && painel.previsao ? painel.previsao.sobra : (painel.saldo || 0);
  const dadosCorte = painel[CORTES.find((c) => c.id === corte).campo] || [];

  return (
    <>
      {/* A resposta primeiro, a prova depois. O app se chama "quanto posso
          gastar": o número que responde abre a tela. */}
      <div className="resposta">
        <div>
          <p className="resposta-rotulo">{aberto ? 'Livre para gastar' : 'Sobrou no mês'}</p>
          {/* A chave é o próprio valor: mudou, entra de novo e o realce diz
              onde olhar depois de salvar. */}
          <p key={livre} className={`resposta-numero realce ${livre < 0 ? 'neg' : ''}`}>{formatarBRL(livre)}</p>
          <p className="resposta-nota">{notaDaResposta(painel, aberto, livre)}</p>
        </div>

        {/* A conta que dá o número de cima, montada. Sem ela, "Livre" e
            "Sobrou" pareciam dois números brigando. */}
        {aberto && painel.previsao ? (
          <>
            <p className="fatos-mes">
              Recebi <strong className="pos">{soNumero(painel.receitas)}</strong>
              <span aria-hidden="true"> · </span>
              Gastei <strong>{soNumero(painel.despesas)}</strong>
            </p>
            <dl className="conta-livre">
              <div>
                <dt>Sobrou até agora</dt>
                <dd className={painel.previsao.ja_sobrou < 0 ? 'neg' : ''}>{comSinal(painel.previsao.ja_sobrou)}</dd>
              </div>
              <div>
                <dt>Ainda entra</dt>
                <dd className="pos">{comSinal(painel.previsao.ainda_entra)}</dd>
              </div>
              <div>
                <dt>Ainda sai</dt>
                <dd className="warn">{comSinal(-painel.previsao.ainda_sai)}</dd>
              </div>
              <div className="total">
                <dt>Sobra no fim do mês</dt>
                <dd className={livre < 0 ? 'neg' : 'pos'}>{comSinal(livre)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="resumo">
            <div><span className="r">Recebi</span><span className="v pos">{soNumero(painel.receitas)}</span></div>
            <div><span className="r">Gastei</span><span className="v">{soNumero(painel.despesas)}</span></div>
            <div>
              <span className="r">Sobrou</span>
              <span className={`v ${painel.saldo >= 0 ? 'pos' : 'neg'}`}>{soNumero(painel.saldo)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Gastar no crédito não é o mesmo que o dinheiro sair da conta.
          Sem esta linha, o "sobra" acima parece menos do que você tem. */}
      {(painel.no_credito > 0 || painel.saiu_caixa !== painel.despesas) && (
        <div className="faixa-caixa">
          <span>Já saiu da conta <strong>{formatarBRL(painel.saiu_caixa)}</strong></span>
          {painel.no_credito > 0 && (
            <span>Vai sair na fatura <strong>{formatarBRL(painel.no_credito)}</strong></span>
          )}
        </div>
      )}

      <GraficoEvolucao evolucao={painel.evolucao} mesAtual={painel.mes} />

      {/* Fechada por padrão: é a seção mais alta e a que menos exige ação.
          O cabeçalho já entrega o essencial — quem lidera. */}
      <Sanfona titulo="Para onde foi" resumo={lider(painel.por_categoria)}>
        <div className="abas">
          {CORTES.map((c) => (
            <button key={c.id} className={corte === c.id ? 'ativa' : ''} onClick={() => setCorte(c.id)}>
              {c.rotulo}
            </button>
          ))}
        </div>

        <Barras
          dados={dadosCorte}
          orcamentos={corte === 'categoria' ? painel.orcamentos : {}}
          vazio="Nenhuma saída registrada neste mês."
        />

        {painel.por_fonte?.length > 0 && (
          <>
            <p className="secao-titulo">De onde veio a renda</p>
            <Barras dados={painel.por_fonte} vazio="Nenhuma entrada registrada." />
          </>
        )}
      </Sanfona>
    </>
  );
}
