// Teste dos personagens. Rode com:  node testes/personagem.test.mjs
import assert from 'node:assert';
import { ANIMACOES, PERSONAGENS, personagemPorId, pessoaDoPersonagem } from '../src/lib/personagem.js';

const fer = personagemPorId('fernando');
const may = personagemPorId('mayara');
assert.strictEqual(PERSONAGENS.length, 2);
assert.strictEqual(personagemPorId('outro'), null);
assert.deepStrictEqual(ANIMACOES, ['parado', 'ataque', 'vitoria', 'ferido', 'moeda'], 'a ordem das linhas da folha');

// a pessoa do lançamento: como está escrito na planilha
assert.strictEqual(pessoaDoPersonagem(fer, [{ nome: 'Fernando' }, { nome: 'Mayara' }]), 'Fernando');
assert.strictEqual(pessoaDoPersonagem(may, [{ nome: 'MAYARA' }]), 'MAYARA', 'sem ligar para maiúscula');
assert.strictEqual(pessoaDoPersonagem(fer, [{ nome: 'Fernando Michael' }]), 'Fernando Michael', 'primeiro nome também vale');
assert.strictEqual(pessoaDoPersonagem(may, []), 'Mayara', 'sem cadastro: o nome do personagem');
assert.strictEqual(pessoaDoPersonagem(may, [{ nome: 'Mayara', ativo: false }, { nome: 'Mayara S.' }]), 'Mayara S.', 'desativada não conta se houver outra');
assert.strictEqual(pessoaDoPersonagem(null, [{ nome: 'Fernando' }]), '', 'sem personagem: vazio');

console.log('personagens: ok');
