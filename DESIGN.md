# Quanto Posso Gastar — sistema visual 2.0

O contrato de design do app. Quem mexer na interface depois lê isto antes.

## Modo

**Operate.** O usuário está no meio de uma tarefa — registrar um gasto, conferir
o mês, decidir se dá para comprar. Familiaridade é recurso, não preguiça: a
ferramenta tem que sumir dentro da tarefa. Expressão vive no detalhe preciso,
não em invenção de affordance.

## A ideia que organiza tudo

O app responde **uma** pergunta, e ela está no nome. Então a tela do mês abre
com a resposta em tamanho de manchete — *Livre para gastar* — e tudo abaixo é a
prova: o que entrou, o que saiu, o que ainda vem, o que está comprometido.

Antes a tela dava três números do mesmo tamanho e deixava a soma com o usuário.
A hierarquia da v2 nasce da ordem **resposta → prova → detalhe**.

## Três regras

1. **Número é tipografia.** Dinheiro é o conteúdo, não adorno. Todo valor é
   `font-variant-numeric: tabular-nums`, alinhado à direita, na mesma coluna do
   cabeçalho de seção à última linha da lista. Os olhos descem uma coluna só.

2. **Fato e previsão não se misturam.** O que aconteceu é sólido; o que vai
   acontecer é apagado (opacidade .3 nas barras), tracejado (a linha do "hoje",
   a faixa de caixa) e sempre rotulado. Um app de finanças que borra essa
   fronteira mente com boa intenção.

3. **A moldura recua.** Topo, rodapé e títulos de seção são finos, discretos,
   em 11px maiúsculo. O peso visual fica nos dados.

## Cor — contida

Uma cor por significado, nunca por decoração.

| Papel | Claro | Escuro |
|---|---|---|
| entra, confirmado, ação | `#0E7566` | `#4FC9B1` |
| espera por você | `#8A5A10` | `#E0A85A` |
| sai, atrasado, destrutivo | `#9B3427` | `#E9897B` |

Todos os pares de texto/fundo dos dois temas passam de 4.5:1 (barras de gráfico,
3:1). O que se escreve **em cima** de cor cheia usa `--sobre-accent` /
`--sobre-warn`, porque branco sobre o verde claro do tema escuro dá 2:1 —
ilegível. Rodar a verificação a cada mudança de paleta.

## Tipografia

Uma família só (stack do sistema): carrega título, rótulo, botão e dado. Escala
fixa em px, razão ~1.15 — nada de tipografia fluida, que num app só encolhe
texto sem motivo.

`44` manchete · `32` valor do lançamento · `15/14.5` corpo e títulos de lista ·
`12.5` meta · `11` rótulo maiúsculo.

## Ritmo

Escala de espaço em variáveis (`--e1` a `--e8`, de 4 a 44px). Agrupamento
apertado, separação generosa: `20px` entre seções, `12px` dentro de um bloco,
mais espaço acima de um título do que abaixo.

## Componentes

Cada coisa interativa tem os sete estados: normal, hover, foco, ativo,
desabilitado, carregando, erro. Um vocabulário só por papel — mesmo botão,
mesmo campo, mesma linha de lista em todas as telas.

- **Lista** (`.lista` + `.item`): ponto de estado · corpo · número · seta.
- **Sanfona**: o que já está resolvido dobra; o que pede ação fica aberto.
- **Esqueleto** em vez de roda d'água: reserva o lugar que o conteúdo vai ocupar.
- **Vazio que ensina**: diz o que fazer, não "nada aqui".

## Movimento

120–180ms, só para comunicar estado. Sem coreografia de entrada — o usuário
abriu o app para fazer uma coisa. `prefers-reduced-motion` desliga tudo.

## O que não fazer

- Card igual como andaime de página.
- Texto com gradiente, sombra colorida, blur decorativo.
- Fonte de display em rótulo, botão ou dado.
- Modal como primeira ideia: esgotar o inline antes.
- Cor forte em estado inativo.
- Superfície do navegador sem tema (seleção, barra de rolagem, anel de foco).
