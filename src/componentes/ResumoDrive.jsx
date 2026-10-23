import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// "Resumo no Google Drive": a planilha mantém um Google Doc com tudo o que vai
// no CSV, reescrito de hora em hora (ver resumoIA_ no Codigo.gs). Com o Drive
// conectado ao Claude (ou a outra IA), basta pedir para ler esse documento.

const PEDIDO = (titulo) => `Leia o documento "${titulo}" no meu Google Drive e me diga quanto eu posso gastar hoje, sem atrasar nenhuma conta e sem desistir da meta de guardar.`;

const ERROS = {
  sem_rede: 'Sem internet agora. Tente de novo quando voltar.',
  acao_desconhecida: 'O script da planilha está atrasado: cole o Codigo.gs novo e implante em Nova versão.',
  precisa_autorizar: 'Falta autorizar o Docs e o Drive: no editor do Apps Script, escolha a função "autorizar" lá em cima e clique em Executar — o Google vai pedir a permissão uma vez. Depois tente de novo aqui.'
};

function quando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const z = (n) => String(n).padStart(2, '0');
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return `${mesmoDia ? 'hoje' : `${z(d.getDate())}/${z(d.getMonth() + 1)}`} às ${z(d.getHours())}:${z(d.getMinutes())}`;
}

export default function ResumoDrive() {
  const [estado, setEstado] = useState(null);       // resposta do script
  const [ocupado, setOcupado] = useState('');       // '' | 'ligar' | 'atualizar' | 'desligar'
  const [erro, setErro] = useState(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.resumoIA('estado').then((r) => {
      if (!vivo) return;
      if (r?.ok) setEstado(r);
      else if (r?.erro === 'acao_desconhecida') setEstado({ antigo: true });
      else setEstado({ ligado: false });
    });
    return () => { vivo = false; };
  }, []);

  async function fazer(operacao) {
    setOcupado(operacao); setErro(null);
    const r = await api.resumoIA(operacao);
    setOcupado('');
    if (r?.ok) setEstado(r);
    else setErro(ERROS[r?.erro] || 'Não consegui falar com a planilha. Tente de novo.');
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(PEDIDO(estado?.titulo || 'Quanto Posso Gastar — resumo para IA')); setCopiado(true); } catch { setCopiado(false); }
  }

  if (!estado || estado.antigo) return null;

  return (
    <div className="cartao resumo-drive">
      <p className="secao-titulo" style={{ margin: 0 }}>Resumo no seu Google Drive</p>
      {estado.ligado ? (
        <>
          <p className="resumo-drive-ok">
            <span className="ponto on" aria-hidden="true" /> Atualiza sozinho de hora em hora
            {estado.atualizado_em ? ` · última vez ${quando(estado.atualizado_em)}` : ''}.
          </p>
          <p className="ajuda" style={{ margin: 0 }}>
            Numa conversa com o Claude (com o Google Drive conectado), é só pedir:
          </p>
          <p className="pergunta-pronta">{PEDIDO(estado.titulo)}</p>
          <div className="botoes">
            <button type="button" className="btn discreto" onClick={copiar}>{copiado ? '✓ Copiado' : 'Copiar o pedido'}</button>
            {estado.url && <a className="btn" href={estado.url} target="_blank" rel="noreferrer">Abrir no Drive</a>}
          </div>
          <div className="botoes">
            <button type="button" className="btn discreto pequeno" onClick={() => fazer('atualizar')} disabled={Boolean(ocupado)}>
              {ocupado === 'atualizar' ? 'Atualizando…' : 'Atualizar agora'}
            </button>
            <button type="button" className="btn discreto pequeno" onClick={() => fazer('desligar')} disabled={Boolean(ocupado)}>
              {ocupado === 'desligar' ? 'Desligando…' : 'Parar de atualizar'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="ajuda" style={{ margin: 0 }}>
            Sem precisar baixar nada: a planilha mantém um documento <b>“Quanto Posso Gastar — resumo para IA”</b> na
            mesma pasta dela, com tudo o que vai no CSV (os lançamentos dos últimos 120 dias), e reescreve de hora em hora.
            Aí, em qualquer conversa com o Claude com o Drive conectado, você só pede para ele ler.
          </p>
          <button type="button" className="btn-px claro" onClick={() => fazer('ligar')} disabled={Boolean(ocupado)}>
            {ocupado === 'ligar' ? 'CRIANDO O DOCUMENTO…' : 'CRIAR RESUMO NO DRIVE'}
          </button>
          {estado.url && <p className="ajuda" style={{ margin: 0 }}>Ele está parado. <a href={estado.url} target="_blank" rel="noreferrer">Abrir o último</a></p>}
        </>
      )}
      {erro && <p className="ajuda ruim" role="alert" style={{ margin: 0 }}>{erro}</p>}
    </div>
  );
}
