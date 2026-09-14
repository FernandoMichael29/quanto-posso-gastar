# Instalação passo a passo

Quatro etapas. Faça na ordem — cada uma produz um valor que a seguinte usa.
Tenha um bloco de notas aberto para guardar três coisas: **token do app**,
**endereço do script** e **chave da API**.

---

## Etapa 1 — A planilha e o script

1. Abra [sheets.new](https://sheets.new) com o seu Gmail. Dê o nome
   **Finanças — Quanto Posso Gastar**.
2. Menu **Extensões → Apps Script**. Vai abrir uma aba nova com um arquivo
   `Código.gs` contendo `function myFunction() {}`.
3. Apague tudo que estiver lá e cole o conteúdo de `apps-script/Codigo.gs`
   deste projeto. Salve (o ícone de disquete, ou Ctrl+S).
4. No seletor de função no topo, escolha **configurar** e clique em **Executar**.
5. O Google vai pedir autorização na primeira vez. Ele mostra um aviso de
   "app não verificado" — isso é normal, o app é seu:
   **Avançado → Acessar Finanças (não seguro) → Permitir**.
6. Quando terminar, abra **Registro de execução** (embaixo). Vai aparecer:

   ```
   Seu TOKEN do app é:
       a1b2c3d4e5f6...
   ```

   **Guarde esse token.** Se perder, rode a função `verToken()` para vê-lo de novo.

Sua planilha agora tem sete abas, com categorias e contas já preenchidas.

---

## Etapa 2 — Publicar o script

1. Ainda no Apps Script: **Implantar → Nova implantação**.
2. No ícone de engrenagem ao lado de "Selecionar tipo", escolha **App da Web**.
3. Preencha:
   - **Descrição**: `v1`
   - **Executar como**: **Eu** (seu e-mail)
   - **Quem pode acessar**: **Qualquer pessoa**
4. **Implantar**. Copie o **URL do app da Web** — termina em `/exec`.
   **Guarde esse endereço.**

> **Sobre "Qualquer pessoa":** é obrigatório para o app conseguir falar com o
> script sem login do Google. Quem protege é o token: qualquer requisição sem
> ele é recusada. Para uso pessoal isso é o padrão desse tipo de integração.

Sempre que você mudar o código do script, precisa fazer
**Implantar → Gerenciar implantações → editar → Nova versão** para a mudança
valer. Só salvar não basta.

---

## Etapa 3 — A chave da API da Claude

Você já comprou os créditos, então falta só gerar a chave. É rápido.

1. Entre em [console.anthropic.com](https://console.anthropic.com) com a conta
   onde você colocou os US$ 5.
2. No menu lateral, **API Keys** (em algumas contas fica dentro de Settings).
3. **Create Key**. Dê um nome que você reconheça depois — `quanto-posso-gastar`.
   Se perguntar o workspace, deixe o padrão.
4. A chave aparece **uma única vez**, começando com `sk-ant-`. Copie agora.
   Se fechar a tela sem copiar, não tem como recuperar — é só apagar e criar outra.

Agora coloque a chave no script:

5. Volte para o Apps Script, procure a função `salvarChaveAnthropic()` e
   substitua `COLE_SUA_CHAVE_AQUI` pela sua chave, entre as aspas.
6. Selecione **salvarChaveAnthropic** no seletor de função e **Executar**.
7. **Importante**: volte e apague a chave da linha, deixando
   `COLE_SUA_CHAVE_AQUI` como estava, e salve. A chave já está guardada nas
   propriedades do script — ela não precisa mais estar no código.

Para conferir se funcionou: **Configurações do projeto** (engrenagem na barra
lateral) → role até **Propriedades do script**. Devem aparecer `TOKEN` e
`ANTHROPIC_KEY`.

> **Enquanto a chave não estiver lá**, o app continua funcionando: as regras
> locais resolvem a maioria das frases, e as que precisariam da IA ficam
> guardadas na fila até você configurar. Nada se perde.

---

## Etapa 4 — Publicar o app e instalar no celular

1. No GitHub, crie um repositório **privado** chamado exatamente
   `quanto-posso-gastar`. O nome importa: é ele que vira o endereço.
2. Suba os arquivos deste projeto. Pelo site dá para arrastar a pasta em
   **Add file → Upload files** — mas note que o GitHub não sobe pastas ocultas
   por arrastar, então crie o arquivo `.github/workflows/deploy.yml` pelo
   **Add file → Create new file** (cole o caminho completo com as barras que ele
   cria as pastas sozinho).
3. No repositório: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
4. Vá na aba **Actions**. O fluxo "Publicar no GitHub Pages" roda sozinho —
   ele instala, testa e publica. Leva uns dois minutos. Ao terminar, o endereço
   aparece no próprio job: `https://SEU-USUARIO.github.io/quanto-posso-gastar/`
5. Abra esse endereço **no Chrome do seu S24**.
6. Vá na aba **Ajustes** e cole o endereço do script (Etapa 2) e o token
   (Etapa 1). Toque em **Salvar e testar**. Tem que aparecer
   "Conectado à sua planilha".
7. Menu do Chrome (⋮) → **Adicionar à tela inicial**. Ele vira um ícone normal,
   abre em tela cheia e funciona sem internet.
8. Toque no microfone e diga **"mercado 120 reais"**. Autorize o microfone
   quando o Chrome pedir. Confirme o cartão — a linha aparece na planilha.

---

## Como saber que está tudo certo

| Teste | O que deve acontecer |
|---|---|
| Falar "mercado 120 reais" | Cartão com R$ 120,00, categoria Mercado |
| Falar "recebi meu salário de 3000" | Cartão verde de entrada, categoria Salário |
| Falar "fone em 10x de 89,90" | Cartão com R$ 899,00 e etiqueta 10× |
| Ativar modo avião e registrar algo | Vai para a Fila como "Esperando internet" |
| Desligar o modo avião | Em até um minuto some da fila e aparece na planilha |
| Falar algo confuso, tipo "gastei uns troco no rolê" | Vai para a IA, ou fica na fila se ela não responder |

---

## Quando alguma coisa dá errado

**"Não consegui conectar" nos Ajustes**
O endereço precisa terminar em `/exec`, não em `/dev`. E confira se a
implantação está com acesso para "Qualquer pessoa".

**"O token não confere"**
Rode `verToken()` no Apps Script e cole o valor exato, sem espaços nas pontas.

**"Os créditos da API acabaram"**
Recarregue em console.anthropic.com → Billing. Tudo que estava esperando é
interpretado sozinho na próxima hora — você não precisa refazer nada. Você
também recebe um e-mail avisando (no máximo um por dia, para não virar spam).

**O microfone não abre**
Precisa ser HTTPS. O endereço do GitHub Pages já é. Se o Chrome tiver negado a
permissão antes: cadeado na barra de endereço → Permissões → Microfone → Permitir.

**Mudei o script e nada mudou**
Faltou criar uma nova versão da implantação (veja o fim da Etapa 2).

---

## Custo

Planilha, script, GitHub Pages: R$ 0.
API da Claude: cerca de R$ 1 a 2 por mês num uso pesado. Os US$ 5 que você
colocou devem durar mais de um ano.
