// Os dois heróis do app e quem está jogando neste celular.
//
// A escolha fica no aparelho (cada celular é de uma pessoa) e vira a "pessoa"
// padrão dos lançamentos. As artes vêm do PixelLab: uma folha por personagem,
// uma linha por animação, 9 quadros de 80×80 (ferramentas/personagens/montar.py);
// quem carrega as folhas é componentes/Personagem.jsx (aqui fica só a lógica,
// para os testes rodarem no node).

export const LADO = 80;
export const QUADROS = 9;
/** A ordem das linhas na folha — a mesma de ferramentas/personagens/montar.py. */
export const ANIMACOES = ['parado', 'ataque', 'vitoria', 'ferido', 'moeda'];

export const PERSONAGENS = [
  { id: 'fernando', nome: 'Fernando', classe: 'Arqueiro', arma: 'Arco', especial: 'Tiro certo', cor: '#f6c63c' },
  { id: 'mayara', nome: 'Mayara', classe: 'Aventureira', arma: 'Espada', especial: 'Golpe', cor: '#8fd2ff' }
];

const CHAVE = 'qpg.personagem';
const chave = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export const personagemPorId = (id) => PERSONAGENS.find((p) => p.id === id) || null;

/** Quem joga neste celular (null = ainda não escolheu). */
export function personagemSalvo() {
  try { return personagemPorId(localStorage.getItem(CHAVE)); } catch { return null; }
}

export function salvarPersonagem(id) {
  try { localStorage.setItem(CHAVE, id); } catch { /* sem armazenamento: pergunta de novo na próxima vez */ }
}

/**
 * O nome que vai no campo "pessoa" do lançamento: o da pessoa cadastrada com o
 * mesmo nome do personagem (respeitando como está escrito na planilha). Sem
 * cadastro, usa o nome do personagem mesmo.
 */
export function pessoaDoPersonagem(personagem, pessoas = []) {
  if (!personagem) return '';
  const ativas = pessoas.filter((p) => p.ativo !== false && !p.desativado);
  const alvo = chave(personagem.nome);
  const achada = ativas.find((p) => chave(p.nome) === alvo)
    || ativas.find((p) => chave(p.nome).split(' ')[0] === alvo);
  return achada ? achada.nome : personagem.nome;
}
