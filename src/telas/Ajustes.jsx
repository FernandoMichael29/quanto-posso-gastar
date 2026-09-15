import { useState } from 'react';
import { api, enderecoPlausivel, invalidarAcesso, lerConfig, marcarAcessoValido, salvarConfig } from '../lib/api.js';

export default function Ajustes({ aoSalvar }) {
  const inicial = lerConfig();
  const [url, setUrl] = useState(inicial.url || '');
  const [token, setToken] = useState(inicial.token || '');
  const [teste, setTeste] = useState(null);
  const [testando, setTestando] = useState(false);

  async function salvarETestar(e) {
    e.preventDefault();

    // Erra cedo e com clareza: "0" não é um endereço, e esperar o servidor
    // responder para descobrir isso só atrasa a correção.
    if (!enderecoPlausivel(url)) {
      setTeste({
        tom: 'ruim',
        titulo: 'Esse endereço não parece um app da Web do Apps Script',
        detalhe: 'Ele começa com https://script.google.com/macros/s/ e termina em /exec. Pegue em Implantar → Gerenciar implantações.'
      });
      return;
    }
    if (token.trim().length < 8) {
      setTeste({
        tom: 'ruim',
        titulo: 'O token parece curto demais',
        detalhe: 'É uma sequência longa de letras e números. Rode verToken() no Apps Script para vê-lo de novo.'
      });
      return;
    }

    salvarConfig({ url: url.trim(), token: token.trim() });
    setTestando(true);
    setTeste(null);
    const r = await api.ping();
    setTestando(false);

    if (r.ok) {
      marcarAcessoValido();
      setTeste({
        tom: 'bom',
        titulo: 'Conectado à sua planilha',
        detalhe: r.ia
          ? 'A chave da IA também já está configurada no script.'
          : 'Falta salvar a chave da API no script. Sem ela, as regras locais continuam funcionando e as frases difíceis ficam guardadas na fila.'
      });
      aoSalvar?.();
    } else {
      invalidarAcesso();
      setTeste({
        tom: 'ruim',
        titulo: ERRO_TESTE[r.erro] || 'Não consegui conectar',
        detalhe: r.detalhe || 'Confira se o endereço termina em /exec e se o script foi publicado com acesso para "Qualquer pessoa".'
      });
    }
  }

  return (
    <form onSubmit={salvarETestar} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="cartao">
        <div className="campo">
          <label htmlFor="url">Endereço do Apps Script</label>
          <input
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            autoComplete="off"
            spellCheck="false"
          />
        </div>

        <div className="campo">
          <label htmlFor="token">Token do app</label>
          <input
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="o valor que apareceu ao rodar configurar()"
            autoComplete="off"
            spellCheck="false"
          />
        </div>

        <button className="btn principal" type="submit" disabled={testando}>
          {testando ? 'Testando…' : 'Salvar e testar'}
        </button>
      </div>

      {teste && (
        <div className={`aviso ${teste.tom}`} role="status">
          <strong>{teste.titulo}</strong>
          <span className="detalhe">{teste.detalhe}</span>
        </div>
      )}

      <div className="cartao">
        <p className="secao-titulo" style={{ margin: 0 }}>Onde achar esses dois valores</p>
        <p className="ajuda">
          Na sua planilha, menu <code>Extensões → Apps Script</code>. Rode a função <code>configurar()</code> uma vez:
          o token aparece no registro de execução. O endereço sai em <code>Implantar → Nova implantação → App da Web</code>,
          com acesso para <strong>Qualquer pessoa</strong> — é o token que protege, não o endereço.
        </p>
        <p className="ajuda">
          Estes dois valores ficam guardados só neste aparelho, neste navegador. Se você abrir o app no PC,
          precisa preencher lá também.
        </p>
      </div>
    </form>
  );
}

const ERRO_TESTE = {
  sem_configuracao: 'Preencha os dois campos',
  token_invalido: 'O token não confere',
  sem_rede: 'Não consegui alcançar o script',
  api_fora: 'O script respondeu com erro'
};
