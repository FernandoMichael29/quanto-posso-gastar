// Gerado por ferramentas/icones/gerar.py — não edite à mão.
import folha from '../assets/icones.png';
import folhaAbas from '../assets/abas.png';
import folhaConquistas from '../assets/conquistas.png';
import folhaBaus from '../assets/baus.png';

export const FOLHA = folha;
export const FOLHA_ABAS = folhaAbas;
export const FOLHA_CONQUISTAS = folhaConquistas;
export const FOLHA_BAUS = folhaBaus;

// Categoria (minúscula, sem acento) → coluna na folha de 32 px.
export const COLUNA = {
  'salario': 0,
  'saude': 1,
  'alimentacao': 2,
  'compras': 3,
  'mercado': 4,
  'transporte': 5,
  'moradia': 6,
  'telefone': 7,
  'assinaturas': 8,
  'educacao': 9,
  'lazer': 10,
  'casa': 11,
  'pet': 12,
  'presentes': 13,
  'taxas': 14,
  'imposto': 15,
  'freela': 16,
  'reembolso': 17,
  'rendimento': 18,
  'outras entradas': 19,
  'outros': 20,
};

// Aba → coluna na folha de 24 px.
export const ABA = {
  novo: 0,
  mes: 1,
  perguntar: 2,
  historico: 3,
  ajustes: 4,
};

// Conquista → coluna na folha de medalhas (32 px).
export const MEDALHA = {
  primeira_missao: 0,
  fase_limpa: 1,
  bolso_trancado: 2,
  mana_intacta: 3,
  no_azul: 4,
  trinca: 5,
  formiguinha: 6,
  guardiao: 7,
};

// Estado do baú (vazio → cheio) → coluna na folha de baús (32 px).
export const BAU = {
  vazio: 0,
  comecando: 1,
  metade: 2,
  cheio: 3,
};
