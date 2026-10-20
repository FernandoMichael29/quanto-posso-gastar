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
export const ANIMACOES = ['parado', 'ataque', 'vitoria', 'ferido', 'moeda', 'triste', 'pergaminho', 'dormindo', 'contando', 'andando'];
/** As que ficam em loop, mais devagar (estado); as outras tocam uma vez (reação). */
export const EM_LOOP = ['parado', 'triste', 'dormindo', 'contando', 'andando'];

export const PERSONAGENS = [
  // cor: a do cartão na escolha; dupla: a do pedaço de cada um na barra da missão (capa verde, cachecol azul).
  { id: 'fernando', nome: 'Fernando', classe: 'Arqueiro', arma: 'Arco', especial: 'Tiro certo', cor: '#f6c63c', dupla: '#5fcf6a',
    equipamentos: { prata: 'Manto de prata', ouro: 'Arco lendário' } },
  { id: 'mayara', nome: 'Mayara', classe: 'Aventureira', arma: 'Espada', especial: 'Golpe', cor: '#8fd2ff', dupla: '#7cc4ff',
    equipamentos: { prata: 'Ombreiras de prata', ouro: 'Armadura lendária' } }
];

const CHAVE = 'qpg.personagem';

// --- Equipamentos: recompensa da missão ------------------------------------
// Cada visual é uma folha inteira (as 10 animações redesenhadas no PixelLab).
// Libera com uma conquista da casa (vale para os dois); cada celular escolhe
// qual vestir — o padrão é o melhor liberado.

export const VISUAIS = [
  { id: 'base', nome: 'Inicial', como: 'O equipamento do começo da aventura.' },
  { id: 'prata', conquista: 'formiguinha', como: 'Cumpra a missão de guardar num mês fechado (Formiguinha).' },
  { id: 'ouro', conquista: 'guardiao', como: 'Cumpra a missão três meses seguidos (Guardião do cofre).' }
];
const CHAVE_LIBERADOS = 'qpg.equip.liberados';
const CHAVE_ESCOLHA = 'qpg.equip.escolha';

/** O nome do visual para aquele herói ("Manto de prata", "Inicial"…). */
export const nomeDoVisual = (personagem, visual) => (visual === 'base' ? 'Inicial' : personagem?.equipamentos?.[visual] || visual);

/** Os visuais que as conquistas já liberaram, na ordem (sempre começa por "base"). */
export function visuaisLiberados(conquistas = {}) {
  return VISUAIS.filter((v) => !v.conquista || (conquistas || {})[v.conquista]).map((v) => v.id);
}

/** O que vestir: a escolha deste celular, se liberada; senão o melhor liberado. */
export function visualVestido(liberados, escolha) {
  return liberados.includes(escolha) ? escolha : liberados[liberados.length - 1] || 'base';
}

const ouvintes = new Set();
const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

export function equipamentoAtual() {
  const liberados = ler(CHAVE_LIBERADOS, ['base']);
  return { liberados, visual: visualVestido(liberados, ler(CHAVE_ESCOLHA, '')) };
}
export function aoMudarEquipamento(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
const avisar = () => ouvintes.forEach((fn) => fn());

/**
 * O painel trouxe as conquistas: guarda o que está liberado e devolve os
 * visuais que acabaram de liberar (para comemorar), sem repetir.
 */
export function atualizarLiberados(conquistas) {
  const antes = ler(CHAVE_LIBERADOS, ['base']);
  const agora = visuaisLiberados(conquistas);
  const novos = agora.filter((v) => !antes.includes(v));
  if (novos.length || agora.length !== antes.length) { gravar(CHAVE_LIBERADOS, agora); avisar(); }
  return novos;
}
export function vestir(visual) { gravar(CHAVE_ESCOLHA, visual); avisar(); }
const chave = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export const personagemPorId = (id) => PERSONAGENS.find((p) => p.id === id) || null;

/** O personagem de quem está no campo "pessoa" de um lançamento (pelo primeiro nome). */
export function personagemDaPessoa(pessoa) {
  const k = chave(pessoa).split(' ')[0];
  return k ? PERSONAGENS.find((p) => chave(p.nome) === k) || null : null;
}

/**
 * A missão em dupla: quanto cada um guardou no mês, do maior para o menor.
 * Quem não tem personagem (ou lançou sem pessoa) vira "outros".
 */
export function guardadoEmDupla(porPessoa = {}) {
  const soma = new Map();
  for (const [nome, v] of Object.entries(porPessoa || {})) {
    const p = personagemDaPessoa(nome);
    const id = p ? p.id : 'outros';
    soma.set(id, (soma.get(id) || 0) + (Number(v) || 0));
  }
  return [...soma.entries()]
    .map(([id, valor]) => ({ id, personagem: personagemPorId(id), valor: Math.round(valor * 100) / 100 }))
    .filter((x) => x.valor > 0)
    .sort((a, b) => b.valor - a.valor || a.id.localeCompare(b.id));
}

/** Quem joga neste celular (null = ainda não escolheu). */
export function personagemSalvo() {
  try { return personagemPorId(localStorage.getItem(CHAVE)); } catch { return null; }
}

export function salvarPersonagem(id) {
  try { localStorage.setItem(CHAVE, id); } catch { /* sem armazenamento: pergunta de novo na próxima vez */ }
}

const DIA = 86400000;
const diaUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/**
 * O humor do herói no topo da tela Novo, a partir do ouro de hoje:
 * dormindo (3+ dias sem lançar nada), triste (mês no vermelho ou passou do
 * ouro de hoje), contando moedas (já gastou mais de 70% do ouro de hoje, ou a
 * vida do mês está abaixo de 10%) ou parado (tudo bem).
 * `ultimoLancamento` é o dia do lançamento mais recente ("aaaa-mm-dd").
 */
export function humorDoHeroi(ouro, opcoes = {}) {
  const hoje = opcoes.hoje;
  const ultimo = opcoes.ultimoLancamento;
  if (hoje && ultimo && ultimo <= hoje) {
    const dias = Math.round((diaUTC(hoje) - diaUTC(ultimo)) / DIA);
    if (dias >= 3) return { anim: 'dormindo', motivo: `cochilou: ${dias} dias sem lançar nada` };
  }
  if (!ouro) return { anim: 'parado', motivo: 'esperando a planilha' };
  if (ouro.livre <= 0) return { anim: 'triste', motivo: 'o mês está no vermelho' };
  if (ouro.ouro < 0) return { anim: 'triste', motivo: 'passou do ouro de hoje' };
  const quaseAcabou = ouro.porDia > 0 && ouro.ouro < ouro.porDia * 0.3;
  if (quaseAcabou || (ouro.vida != null && ouro.vida < 0.1)) return { anim: 'contando', motivo: 'contando cada moeda' };
  return { anim: 'parado', motivo: 'tudo tranquilo' };
}

/**
 * A reação a um lançamento que acabou de entrar: renda comemora, gasto paga
 * com moeda — e se o gasto estourou o ouro de hoje, é dano.
 */
export function reacaoAoLancamento(efeito, ouroDepois) {
  if (!efeito) return null;
  if (efeito.tipo === 'receita') return 'vitoria';
  if (ouroDepois && ouroDepois.ouro < 0) return 'ferido';
  return 'moeda';
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
