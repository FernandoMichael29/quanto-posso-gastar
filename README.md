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

## Fato ou regra

A distinção que o app precisa acertar:

| Você fala | O que acontece |
|---|---|
| "mercado 120 reais" | Um gasto de hoje |
| "meu gasto mensal com aluguel é 1800" | Passa a valer 1800 por mês, até você dizer outra coisa |
| "esse mês o aluguel foi 1850" | Vale só neste mês; o futuro continua 1800 |
| "meu aluguel agora é 1900" | Daqui pra frente é 1900 — e o mês passado continua 1800 |
| "cancelei a netflix" | Encerra o compromisso neste mês |

Nada é sobrescrito: cada mudança fecha a vigência anterior e abre uma nova, então
o histórico fica inteiro e as projeções olham para o valor certo de cada mês.

## Estrutura

```
apps-script/Codigo.gs        o servidor inteiro: planilha, IA, vigências, fila, avisos
src/lib/parser.js            entende português sem internet e sem custo
src/lib/db.js                a fila local (IndexedDB) — nada se perde
src/lib/sync.js              quando e como tentar de novo
src/lib/api.js               conversa com o Apps Script
src/lib/voz.js               microfone, com queda para o teclado quando offline
src/telas/                   Falar, Perguntar, Fila e Ajustes
src/componentes/             o gráfico de projeção
public/sw.js                 abre offline e sincroniza com o app fechado
testes/parser.test.mjs       28 frases reais em português
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

- **Registrar por voz** com regras locais e interpretação por IA
- **Fila offline** com estados e nova tentativa automática — nada se perde,
  nem sem internet nem sem créditos na API
- **Compromissos fixos com histórico de valores** (a tabela acima)
- **Perguntar e simular**: "um carro de 950 por mês, quanto me afeta?", com
  projeção de 12 meses em gráfico
- **Memória**: o que você conta sobre si entra no contexto das próximas análises
- Tetos diários de uso, limite por minuto e troca de token, como defesa de custo

Falta a Fase 3: o painel de acompanhamento com gastos por categoria e evolução
do saldo — mais útil depois de algumas semanas de dados.
