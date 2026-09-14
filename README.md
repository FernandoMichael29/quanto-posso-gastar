# Quanto Posso Gastar

Finanças por voz. Você aperta um botão, fala *"mercado 120 reais"*, e isso vira
uma linha na sua planilha do Google — com ou sem internet no momento da fala.

- **Front-end**: React + Vite, instalável no celular como app (PWA)
- **Servidor**: Google Apps Script — grátis, e é onde ficam as chaves
- **Banco de dados**: a sua planilha do Google
- **IA**: API da Claude, chamada só quando as regras locais não dão conta

## Instalação

Quatro etapas. Leva uns 25 minutos na primeira vez.
O passo a passo detalhado está em [`INSTALAR.md`](./INSTALAR.md).

1. Criar a planilha e colar o script
2. Publicar o script e pegar o endereço + token
3. Criar a chave da API da Claude
4. Publicar o app no GitHub Pages e instalar no celular

## Estrutura

```
apps-script/Codigo.gs   o servidor inteiro: planilha, IA, fila, avisos
src/lib/parser.js       entende português sem internet e sem custo
src/lib/db.js           a fila local (IndexedDB) — nada se perde
src/lib/sync.js         quando e como tentar de novo
src/lib/api.js          conversa com o Apps Script
src/lib/voz.js          microfone, com queda para o teclado quando offline
src/telas/              Falar, Fila e Ajustes
public/sw.js            abre offline e sincroniza com o app fechado
testes/parser.test.mjs  19 frases reais em português
```

## Rodar na sua máquina

Só se você quiser mexer no código — para usar no dia a dia, o GitHub Pages
resolve e você não precisa de nada instalado.

```bash
npm install
npm run teste    # testa o parser em português
npm run dev      # abre em http://localhost:5173
```

O microfone do navegador só funciona em HTTPS ou em `localhost`.

## O que já está pronto

Fase 1 e parte da Fase 2: registrar por voz, regras locais, interpretação por
IA, fila offline com estados, resumo do mês e avisos quando algo trava.

Fases seguintes: painel com gráficos, e a tela de perguntar
*"e se eu comprar um carro de 950 por mês?"* com projeção.
