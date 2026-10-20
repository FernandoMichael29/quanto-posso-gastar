import { useEffect, useState } from 'react';
import Capa from './Capa.jsx';
import { desligarAvisos, estadoDosAvisos, ligarAvisos, testarAviso } from '../lib/avisos.js';

// Ajustes → "Avisos de conta fixa": ligar a notificação deste celular.

const ERROS = {
  negado: 'O celular bloqueou as notificações do app. Libere nas configurações do navegador (ou do app instalado) e tente de novo.',
  acao_desconhecida: 'O script da planilha ainda não tem os avisos. Implante a versão nova (2.13.0).',
  servico_desconhecido: 'Este navegador usa um serviço de aviso que o script não conhece.',
  inscricao_expirou: 'A inscrição deste celular expirou. Ligue os avisos de novo.',
  nao_inscrito: 'Este celular não está inscrito. Ligue os avisos de novo.'
};

export default function Avisos({ pessoa }) {
  const [estado, setEstado] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [recado, setRecado] = useState(null);

  useEffect(() => { estadoDosAvisos().then(setEstado); }, []);

  async function fazer(acao, sucesso) {
    setOcupado(true); setRecado(null);
    let r;
    try { r = await acao(); } catch { r = { ok: false }; }
    setOcupado(false);
    setEstado(await estadoDosAvisos());
    setRecado(r.ok ? { tom: 'bom', texto: sucesso } : { tom: 'ruim', texto: ERROS[r.erro] || 'Não consegui agora. Tente de novo.' });
  }

  if (estado === null) return null;
  return (
    <div className="cartao avisos">
      {estado === 'instalar' && (
        <p className="ajuda" style={{ margin: 0 }}>
          No iPhone, o aviso só chega com o app instalado: no Safari, toque em <b>Compartilhar → Adicionar à Tela de Início</b> e abra o app pelo ícone.
        </p>
      )}
      {estado === 'sem_suporte' && <p className="ajuda" style={{ margin: 0 }}>Este navegador não recebe notificação. Use o Chrome (Android) ou o app instalado na tela inicial.</p>}
      {estado === 'negado' && <p className="ajuda" style={{ margin: 0 }}>{ERROS.negado}</p>}
      {estado === 'desligado' && (
        <>
          <p className="ajuda" style={{ margin: 0 }}>
            Todo dia ao meio-dia, se tiver conta fixa vencendo hoje, amanhã ou atrasada sem lançamento, o app avisa — mesmo fechado. Sem conta para avisar, fica quieto.
          </p>
          <button type="button" className="btn-px" disabled={ocupado} onClick={() => fazer(() => ligarAvisos(pessoa), 'Avisos ligados neste celular.')}>
            LIGAR AVISOS NESTE CELULAR
          </button>
        </>
      )}
      {estado === 'ligado' && (
        <>
          <p className="avisos-ligado"><span className="ponto on" aria-hidden="true" /> Ligado neste celular — todo dia ao meio-dia, só quando tem conta para avisar.</p>
          <div className="botoes">
            <button type="button" className="btn discreto" disabled={ocupado} onClick={() => fazer(desligarAvisos, 'Avisos desligados neste celular.')}>Desligar</button>
            <button type="button" className="btn principal" disabled={ocupado} onClick={() => fazer(testarAviso, 'Pronto: o aviso de teste deve chegar em alguns segundos.')}>Mandar um teste</button>
          </div>
        </>
      )}
      {recado && <p className={`ajuda ${recado.tom === 'ruim' ? 'ruim' : ''}`} style={{ margin: 0 }}>{recado.texto}</p>}
      <Capa quando={ocupado} />
    </div>
  );
}
