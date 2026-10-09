'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cargarFrontend } = require('./helpers');
const { TaxEngine, MockData } = cargarFrontend();

test('caso demo: resultado conocido', () => {
  const r = TaxEngine.calculateIVA(MockData.defaultSistemaVouchers, { stAnterior: 150000, sldAnterior: 45000 });
  assert.strictEqual(r.dfTotal, 1165500);
  assert.strictEqual(r.cfComputableTotal, 1851000);
  assert.strictEqual(r.saldoTecnicoResultante, 835500);
  assert.strictEqual(r.totalPagosACuenta, 1382800);
  assert.strictEqual(r.impuestoAPagar, 0);
  assert.strictEqual(r.saldoLibreDisponibilidadResultante, 1382800);
  assert.strictEqual(r.cfNetoTotal, 2200000, 'el neto de compras locales no incluye importaciones');
});

test('no modifica los comprobantes recibidos', () => {
  const comps = [{ tipoOp: 'venta', neto: 1000, iva: 210, alicuota: 0 }];
  const copia = JSON.stringify(comps);
  TaxEngine.calculateIVA(comps);
  assert.strictEqual(JSON.stringify(comps), copia);
});

test('impuesto a pagar simple con retenciones y percepciones', () => {
  const r = TaxEngine.calculateIVA([
    { tipoOp: 'venta', neto: 100000, alicuota: 21, retenciones: 2000 },
    { tipoOp: 'compra', neto: 50000, alicuota: 21, retenciones: 1000 },
    { tipoOp: 'retencion', clase: 'percepcion', retenciones: 500 },
    { tipoOp: 'retencion', clase: 'retencion', retenciones: 300 }
  ]);
  assert.strictEqual(r.dfTotal, 21000);
  assert.strictEqual(r.cfComputableTotal, 10500);
  assert.strictEqual(r.retencionesLocales, 2300);
  assert.strictEqual(r.percepcionesLocales, 1500);
  assert.strictEqual(r.impuestoAPagar, 21000 - 10500 - 3800);
});

test('notas de crédito: van como restitución del otro lado (criterio ARCA) y el saldo es el mismo', () => {
  const r = TaxEngine.calculateIVA([
    { tipoOp: 'venta', neto: 10000, alicuota: 21 },
    { tipoOp: 'venta', neto: -2000, iva: -420, alicuota: 21 },
    { tipoOp: 'compra', tipoDoc: 'Factura A', neto: 1000, alicuota: 21 },
    { tipoOp: 'compra', tipoDoc: 'Nota de Crédito A', neto: -100, iva: -21, alicuota: 21 }
  ]);
  assert.strictEqual(r.dfTotal, 2100 + 21, 'débito + restitución de crédito');
  assert.strictEqual(r.cfComputableTotal, 210 + 420, 'crédito + restitución de débito');
  assert.strictEqual(r.impuestoAPagar, 1680 - 189);
});

test('Factura C emitida no lleva débito; B/C recibidas no dan crédito', () => {
  const r = TaxEngine.calculateIVA([
    { tipoOp: 'venta', tipoDoc: 'Factura C', neto: 1000, alicuota: 21 },
    { tipoOp: 'venta', tipoDoc: 'Factura B', neto: 1000, alicuota: 21 },
    { tipoOp: 'compra', tipoDoc: 'Factura B', neto: 1210, iva: 210, alicuota: 21 },
    { tipoOp: 'compra', tipoDoc: '11 - Factura C', neto: 500, alicuota: 21 }
  ]);
  assert.strictEqual(r.dfTotal, 210);
  assert.strictEqual(r.cfComputableTotal, 0);
});

test('un IVA informado en 0 se respeta (no se inventa 21%)', () => {
  assert.strictEqual(TaxEngine.ivaDe({ tipoOp: 'compra', tipoDoc: 'Factura A', neto: 1000, iva: 0, alicuota: 21 }), 0);
  assert.strictEqual(TaxEngine.ivaDe({ tipoOp: 'compra', tipoDoc: 'Factura A', neto: 1000, alicuota: 21 }), 210);
});

test('alícuota 0 va a "exentas", no al 21%', () => {
  const r = TaxEngine.calculateIVA([{ tipoOp: 'compra', neto: 5000, alicuota: 0 }, { tipoOp: 'venta', neto: 1000, alicuota: 10.5 }]);
  assert.strictEqual(r.cfNetoPorAlicuota[0], 5000);
  assert.strictEqual(r.cfNetoPorAlicuota[21], 0);
  assert.strictEqual(r.dfPorAlicuota[10.5], 105);
});

test('prorrateo Art. 13 alcanza también al IVA de importación', () => {
  const comps = [
    { tipoOp: 'compra', neto: 1000, alicuota: 21 },
    { tipoOp: 'importacion', neto: 1000, alicuota: 21, esAduanera: 'si' }
  ];
  assert.strictEqual(TaxEngine.calculateIVA(comps, { prorrateoPct: 50 }).cfComputableTotal, 210);
  assert.strictEqual(TaxEngine.calculateIVA(comps, { prorrateoPct: 50, incluirImpo: false }).cfComputableTotal, 105);
});

test('percepciones aduaneras se pueden excluir en el simulador', () => {
  const comps = [{ tipoOp: 'retencion', clase: 'aduanera', retenciones: 1000, esAduanera: 'si' }];
  assert.strictEqual(TaxEngine.calculateIVA(comps).percepAduanerasTotal, 1000);
  assert.strictEqual(TaxEngine.calculateIVA(comps, { incluirPercepAduaneras: false }).percepAduanerasTotal, 0);
});

test('redondeo a centavos', () => {
  const r = TaxEngine.calculateIVA([{ tipoOp: 'venta', neto: 0.1, alicuota: 21 }, { tipoOp: 'venta', neto: 0.2, alicuota: 21 }]);
  assert.strictEqual(r.dfNetoTotal, 0.3);
});
