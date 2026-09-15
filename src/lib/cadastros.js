// Um cadastro desativado sai dos seletores — foi exatamente isso que você pediu
// ao desativar. Mas ele não pode sumir de um lançamento que já aponta para ele:
// abrir um gasto antigo pago no "Cartão" desativado e salvar a descrição não
// pode apagar a conta dele sem ninguém pedir. Então a lista de opções é
// "os ativos + o que já estava escolhido ali", e só.

/**
 * @param {Array} lista   cadastro vindo da planilha (cada item tem `ativo`)
 * @param {string} atual  o valor já selecionado no lançamento, se houver
 * @param {string} chave  campo que guarda o nome ('nome' ou 'categoria')
 */
export function paraSelecionar(lista, atual, chave = 'nome') {
  const todos = (lista || []).map((i) => (typeof i === 'string' ? { [chave]: i } : i));
  const vivos = todos.filter((i) => i.ativo !== false);

  if (!atual) return vivos;
  if (vivos.some((i) => i[chave] === atual)) return vivos;

  const desativado = todos.find((i) => i[chave] === atual);
  return desativado ? [...vivos, { ...desativado, desativado: true }] : vivos;
}

/** Só os ativos, para quando não há valor escolhido para preservar. */
export function ativos(lista) {
  return (lista || []).filter((i) => i.ativo !== false);
}
