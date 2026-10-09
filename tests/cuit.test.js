'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { esCuitValido, formatearCuit, limpiarCuit } = require('../server/lib/cuit');

test('valida CUITs correctos (con y sin guiones)', () => {
  for (const c of ['20-17254359-7', '30500010912', '27230938607', '33693450239']) assert.ok(esCuitValido(c), c);
});

test('rechaza CUITs con dígito verificador incorrecto o largo inválido', () => {
  for (const c of ['20172543598', '3050001091', '305000109121', 'abc', '', null]) assert.ok(!esCuitValido(c), String(c));
});

test('rechaza el caso "verificador 10" (ARCA usa prefijo 23 en esos casos)', () => {
  // Buscamos un número cuyo verificador calculado dé 10 y probamos que no se acepte con 9.
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let base = null;
  for (let n = 10000000; n < 10000200; n++) {
    const s = '20' + n;
    const suma = mult.reduce((a, m, i) => a + m * Number(s[i]), 0);
    if (11 - (suma % 11) === 10) { base = s; break; }
  }
  assert.ok(base);
  assert.ok(!esCuitValido(base + '9'));
});

test('formatea y limpia', () => {
  assert.strictEqual(formatearCuit('30500010912'), '30-50001091-2');
  assert.strictEqual(limpiarCuit('30-50001091-2'), '30500010912');
});
