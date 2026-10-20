// node testes/fogueira.test.mjs — a fogueira da casa (lib/fogueira.js)
import assert from 'node:assert/strict';
import { acesosDaFila, calendarioDoMes, diaMais, estadoDaFogueira, nivelDaFogueira, proximoNivel } from '../src/lib/fogueira.js';

const HOJE = '2026-10-20';
const dias = (de, n) => Array.from({ length: n }, (_, i) => diaMais(de, i));
const ms = (iso, h = 10) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d, h).getTime(); };

// níveis
assert.equal(nivelDaFogueira(0).id, 'apagada');
assert.equal(nivelDaFogueira(1).id, 'faisca');
assert.equal(nivelDaFogueira(6).id, 'brasa');
assert.equal(nivelDaFogueira(7).id, 'fogueira');
assert.equal(nivelDaFogueira(29).id, 'grande');
assert.equal(nivelDaFogueira(45).id, 'enorme');
assert.equal(nivelDaFogueira(60).arte, 'azul');
assert.equal(proximoNivel(5).min, 7);
assert.equal(proximoNivel(80), null);

// a planilha manda: 12 dias, aceso hoje
let s = { hoje: HOJE, dias: 12, aceso_hoje: true, quem_hoje: ['Mayara'], recorde: 21, acesos: dias('2026-10-09', 12) };
let e = estadoDaFogueira(s, [], HOJE);
assert.equal(e.dias, 12); assert.equal(e.acesoHoje, true); assert.equal(e.emRisco, false);
assert.equal(e.recorde, 21); assert.equal(e.nivel.id, 'fogueira'); assert.deepEqual(e.quemHoje, ['Mayara']);
assert.equal(e.semana.length, 7); assert.equal(e.semana[6].hoje, true); assert.equal(e.semana[6].letra, 'T', '20/10/2026 é terça');

// hoje ainda não: conta até ontem, em risco; a fila deste celular acende na hora
s = { hoje: HOJE, dias: 11, aceso_hoje: false, quem_hoje: [], recorde: 11, acesos: dias('2026-10-09', 11) };
e = estadoDaFogueira(s, [], HOJE);
assert.equal(e.dias, 11); assert.equal(e.emRisco, true);
const fila = [{ criado_em: ms(HOJE), lancamento: { data: HOJE, pessoa: 'Fernando' } }];
e = estadoDaFogueira(s, fila, HOJE);
assert.equal(e.dias, 12); assert.equal(e.acesoHoje, true); assert.deepEqual(e.quemHoje, ['Fernando']); assert.equal(e.recorde, 12);

// lançado offline ontem (ainda na fila) religa a sequência que a planilha via apagada
s = { hoje: HOJE, dias: 0, aceso_hoje: false, quem_hoje: [], recorde: 30, acesos: dias('2026-10-10', 9) };   // 10..18, 19 apagado
e = estadoDaFogueira(s, [{ criado_em: ms('2026-10-19', 22), lancamento: { data: '2026-10-19' } }], HOJE);
assert.equal(e.dias, 10, '10 a 19');
// gasto de 2 dias atrás lançado agora acende aquele dia; de 3 dias atrás, não
const f2 = acesosDaFila([{ criado_em: ms(HOJE), lancamento: { data: '2026-10-18' } }, { criado_em: ms(HOJE), lancamento: { data: '2026-10-17' } }], HOJE);
assert.ok(f2.has('2026-10-18') && !f2.has('2026-10-17'));

// cache de outro dia: conta pelos dias conhecidos
e = estadoDaFogueira({ hoje: '2026-10-18', dias: 9, aceso_hoje: true, acesos: dias('2026-10-10', 9), recorde: 9 }, [], HOJE);
assert.equal(e.dias, 0, 'ontem (19) apagou');

// sem dado da planilha: nada
assert.equal(estadoDaFogueira(null, [], HOJE), null);
assert.equal(estadoDaFogueira({}, [], HOJE), null);

// calendário
const cal = calendarioDoMes('2026-10', new Set(['2026-10-20']), HOJE);
assert.equal(cal.filter((c) => c === null).length, 4, '1/10/2026 é quinta');
assert.equal(cal.filter(Boolean).length, 31);
assert.ok(cal.find((c) => c?.dia === '2026-10-20').aceso && cal.find((c) => c?.dia === '2026-10-20').hoje);
assert.ok(cal.find((c) => c?.dia === '2026-10-21').futuro);

console.log('fogueira: ok');
