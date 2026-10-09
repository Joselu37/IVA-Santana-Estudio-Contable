'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cargarFrontend } = require('./helpers');
const { ArcaReconciler } = cargarFrontend();

const base = { tipoOp: 'venta', tipoDoc: 'Factura A', numero: '00003-00000045', cuit: '30-50001091-2' };

test('factura partida por alícuota coincide con la misma de ARCA', () => {
  const libros = [{ ...base, neto: 1000, iva: 105, alicuota: 10.5 }, { ...base, neto: 1000, iva: 210, alicuota: 21 }];
  const arca = [{ ...base, neto: 1000, iva: 210, alicuota: 21 }, { ...base, neto: 1000, iva: 105, alicuota: 10.5 }];
  const r = ArcaReconciler.reconcile(libros, arca);
  assert.strictEqual(r.okCount, 1);
  assert.strictEqual(r.diffCount + r.missingCount, 0);
});

test('diferencia de IVA se informa con detalle', () => {
  const r = ArcaReconciler.reconcile([{ ...base, neto: 1000, iva: 210, alicuota: 21 }], [{ ...base, neto: 1000, iva: 105, alicuota: 10.5 }]);
  assert.strictEqual(r.diffCount, 1);
  assert.match(r.results[0].diagnostico, /IVA \$105,00/);
});

test('faltantes de un lado y del otro, e incorporar por clave', () => {
  const soloArca = { ...base, numero: '00003-00000099', neto: 50, iva: 10.5, alicuota: 21 };
  const r = ArcaReconciler.reconcile([{ ...base, neto: 1, iva: 0.21, alicuota: 21 }], [soloArca]);
  assert.deepStrictEqual(r.results.map((x) => x.status).sort(), ['SOLO_EN_ARCA', 'SOLO_EN_SISTEMA']);
  const k = r.results.find((x) => x.status === 'SOLO_EN_ARCA').key;
  assert.deepStrictEqual(ArcaReconciler.filasArcaPorClave([soloArca], k), [soloArca]);
});
