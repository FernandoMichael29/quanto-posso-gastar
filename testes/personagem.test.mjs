// Teste dos personagens. Rode com:  node testes/personagem.test.mjs
import assert from 'node:assert';
import { ANIMACOES, EM_LOOP, PERSONAGENS, humorDoHeroi, personagemPorId, pessoaDoPersonagem, reacaoAoLancamento } from '../src/lib/personagem.js';

const fer = personagemPorId('fernando');
const may = personagemPorId('mayara');
assert.strictEqual(PERSONAGENS.length, 2);
assert.strictEqual(personagemPorId('outro'), null);
assert.deepStrictEqual(ANIMACOES, ['parado', 'ataque', 'vitoria', 'ferido', 'moeda', 'triste', 'pergaminho', 'dormindo', 'contando', 'andando'], 'a ordem das linhas da folha');
assert.ok(EM_LOOP.every((a) => ANIMACOES.includes(a)));

// a pessoa do lançamento: como está escrito na planilha
assert.strictEqual(pessoaDoPersonagem(fer, [{ nome: 'Fernando' }, { nome: 'Mayara' }]), 'Fernando');
assert.strictEqual(pessoaDoPersonagem(may, [{ nome: 'MAYARA' }]), 'MAYARA', 'sem ligar para maiúscula');
assert.strictEqual(pessoaDoPersonagem(fer, [{ nome: 'Fernando Michael' }]), 'Fernando Michael', 'primeiro nome também vale');
assert.strictEqual(pessoaDoPersonagem(may, []), 'Mayara', 'sem cadastro: o nome do personagem');
assert.strictEqual(pessoaDoPersonagem(may, [{ nome: 'Mayara', ativo: false }, { nome: 'Mayara S.' }]), 'Mayara S.', 'desativada não conta se houver outra');
assert.strictEqual(pessoaDoPersonagem(null, [{ nome: 'Fernando' }]), '', 'sem personagem: vazio');

// humor do herói no topo
const bem = { ouro: 80, porDia: 100, livre: 2000, vida: 0.6 };
const hoje = '2026-10-20';
assert.strictEqual(humorDoHeroi(bem, { hoje, ultimoLancamento: '2026-10-19' }).anim, 'parado');
assert.strictEqual(humorDoHeroi(bem, { hoje, ultimoLancamento: '2026-10-17' }).anim, 'dormindo', '3 dias sem lançar: cochila');
assert.match(humorDoHeroi(bem, { hoje, ultimoLancamento: '2026-10-17' }).motivo, /3 dias/);
assert.strictEqual(humorDoHeroi(bem, { hoje, ultimoLancamento: '' }).anim, 'parado', 'sem lançamento nenhum, não dorme');
assert.strictEqual(humorDoHeroi({ ...bem, ouro: -5 }, { hoje }).anim, 'triste', 'passou do ouro de hoje');
assert.strictEqual(humorDoHeroi({ ...bem, livre: -10 }, { hoje }).anim, 'triste', 'mês no vermelho');
assert.strictEqual(humorDoHeroi({ ...bem, vida: 0.2 }, { hoje }).anim, 'parado', 'vida de 20% ainda é normal');
assert.strictEqual(humorDoHeroi({ ...bem, vida: 0.05 }, { hoje }).anim, 'contando', 'vida quase no fim: contando moedas');
assert.strictEqual(humorDoHeroi({ ...bem, ouro: 20 }, { hoje }).anim, 'contando', 'gastou quase todo o ouro de hoje');
assert.strictEqual(humorDoHeroi(null, { hoje }).anim, 'parado');
// reação ao lançamento
assert.strictEqual(reacaoAoLancamento({ tipo: 'receita' }, bem), 'vitoria');
assert.strictEqual(reacaoAoLancamento({ tipo: 'despesa' }, bem), 'moeda');
assert.strictEqual(reacaoAoLancamento({ tipo: 'despesa' }, { ...bem, ouro: -1 }), 'ferido', 'estourou o ouro de hoje: dano');
assert.strictEqual(reacaoAoLancamento(null, bem), null);

console.log('personagens: ok');

// quem é quem pelo campo pessoa
import { guardadoEmDupla, personagemDaPessoa } from '../src/lib/personagem.js';
assert.strictEqual(personagemDaPessoa('fernando michael').id, 'fernando');
assert.strictEqual(personagemDaPessoa('MAYARA').id, 'mayara');
assert.strictEqual(personagemDaPessoa(''), null);
assert.strictEqual(personagemDaPessoa('Casa'), null);
const dupla = guardadoEmDupla({ Fernando: 120, 'Mayara S.': 50, '': 30, Casa: 10, Outra: -40 });
assert.deepStrictEqual(dupla.map((d) => [d.id, d.valor]), [['fernando', 120], ['mayara', 50]], 'sem dono e outros somam juntos; negativo some');
assert.deepStrictEqual(guardadoEmDupla({ '': 25 }).map((d) => d.id), ['outros']);
assert.deepStrictEqual(guardadoEmDupla(undefined), []);
console.log('missão em dupla: ok');

// equipamentos
import { VISUAIS, nomeDoVisual, visuaisLiberados, visualVestido } from '../src/lib/personagem.js';
assert.deepStrictEqual(VISUAIS.map((v) => v.id), ['base', 'prata', 'ouro']);
assert.deepStrictEqual(visuaisLiberados({}), ['base']);
assert.deepStrictEqual(visuaisLiberados({ formiguinha: '2026-10-31' }), ['base', 'prata']);
assert.deepStrictEqual(visuaisLiberados({ formiguinha: 'x', guardiao: 'y' }), ['base', 'prata', 'ouro']);
assert.strictEqual(visualVestido(['base', 'prata'], ''), 'prata', 'padrão: o melhor liberado');
assert.strictEqual(visualVestido(['base', 'prata'], 'base'), 'base', 'escolheu o inicial');
assert.strictEqual(visualVestido(['base'], 'ouro'), 'base', 'não veste o que não liberou');
assert.strictEqual(nomeDoVisual(personagemPorId('fernando'), 'ouro'), 'Arco lendário');
assert.strictEqual(nomeDoVisual(personagemPorId('mayara'), 'base'), 'Inicial');
console.log('equipamentos: ok');
