// Lista usada enquanto o app ainda não baixou as categorias da sua planilha.
// A versão que manda é sempre a da aba `categorias` — edite lá, não aqui.

export const CATEGORIAS_PADRAO = [
  { categoria: 'Mercado', grupo: 'Essencial', tipo: 'despesa', palavras: ['mercado', 'supermercado', 'feira', 'hortifruti', 'açougue', 'padaria', 'compras do mes', 'atacadao', 'assai', 'carrefour'] },
  { categoria: 'Alimentação', grupo: 'Essencial', tipo: 'despesa', palavras: ['almoço', 'almocei', 'janta', 'jantar', 'lanche', 'ifood', 'rappi', 'restaurante', 'pizza', 'hamburguer', 'cafe', 'padoca', 'marmita'] },
  { categoria: 'Transporte', grupo: 'Essencial', tipo: 'despesa', palavras: ['uber', '99', 'taxi', 'onibus', 'metro', 'passagem', 'gasolina', 'posto', 'combustivel', 'alcool', 'etanol', 'estacionamento', 'pedagio', 'ipva'] },
  { categoria: 'Moradia', grupo: 'Essencial', tipo: 'despesa', palavras: ['aluguel', 'condominio', 'luz', 'energia', 'agua', 'gas', 'iptu', 'internet', 'wifi', 'faxina'] },
  { categoria: 'Saúde', grupo: 'Essencial', tipo: 'despesa', palavras: ['farmacia', 'remedio', 'medico', 'consulta', 'exame', 'dentista', 'plano de saude', 'oculos', 'academia'] },
  { categoria: 'Telefone', grupo: 'Essencial', tipo: 'despesa', palavras: ['celular', 'recarga', 'vivo', 'claro', 'tim', 'oi'] },
  { categoria: 'Assinaturas', grupo: 'Fixo', tipo: 'despesa', palavras: ['netflix', 'spotify', 'youtube premium', 'disney', 'prime', 'hbo', 'max', 'assinatura', 'mensalidade', 'icloud', 'google one'] },
  { categoria: 'Educação', grupo: 'Fixo', tipo: 'despesa', palavras: ['faculdade', 'curso', 'livro', 'apostila', 'material escolar', 'udemy', 'alura'] },
  { categoria: 'Lazer', grupo: 'Variável', tipo: 'despesa', palavras: ['cinema', 'bar', 'cerveja', 'balada', 'show', 'jogo', 'steam', 'viagem', 'passeio', 'role'] },
  { categoria: 'Compras', grupo: 'Variável', tipo: 'despesa', palavras: ['roupa', 'tenis', 'camisa', 'calca', 'eletronico', 'fone', 'shopping', 'shopee', 'mercado livre', 'amazon'] },
  { categoria: 'Casa', grupo: 'Variável', tipo: 'despesa', palavras: ['movel', 'decoracao', 'utensilio', 'ferramenta', 'reforma', 'conserto'] },
  { categoria: 'Pet', grupo: 'Variável', tipo: 'despesa', palavras: ['racao', 'veterinario', 'petshop', 'pet'] },
  { categoria: 'Presentes', grupo: 'Variável', tipo: 'despesa', palavras: ['presente', 'aniversario', 'natal'] },
  { categoria: 'Taxas', grupo: 'Fixo', tipo: 'despesa', palavras: ['tarifa', 'juros', 'multa', 'anuidade', 'imposto'] },
  { categoria: 'Outros', grupo: 'Variável', tipo: 'despesa', palavras: [] },
  { categoria: 'Salário', grupo: 'Renda', tipo: 'receita', palavras: ['salario', 'salário', 'pagamento', 'holerite', 'contracheque'] },
  { categoria: 'Freela', grupo: 'Renda', tipo: 'receita', palavras: ['freela', 'freelance', 'bico', 'job'] },
  { categoria: 'Reembolso', grupo: 'Renda', tipo: 'receita', palavras: ['reembolso', 'devolucao', 'estorno', 'me pagou', 'pagou de volta'] },
  { categoria: 'Rendimento', grupo: 'Renda', tipo: 'receita', palavras: ['rendimento', 'dividendo', 'cdb', 'tesouro'] },
  { categoria: 'Outras Entradas', grupo: 'Renda', tipo: 'receita', palavras: ['vendi', 'ganhei'] }
];
