'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cargarFrontend } = require('./helpers');
const { ExportEngine, MockData, TaxEngine } = cargarFrontend();

const lineas = (t) => (t ? t.split('\r\n') : []);

test('largos de registro del Libro IVA Digital (caso demo)', () => {
  const v = ExportEngine.generarLIDVentas(MockData.defaultSistemaVouchers);
  const c = ExportEngine.generarLIDCompras(MockData.defaultSistemaVouchers);
  lineas(v.cbte).forEach((l) => assert.strictEqual(l.length, 266));
  lineas(v.alicuotas).forEach((l) => assert.strictEqual(l.length, 62));
  lineas(c.cbte).forEach((l) => assert.strictEqual(l.length, 325));
  lineas(c.alicuotas).forEach((l) => assert.strictEqual(l.length, 84));
  lineas(c.importaciones).forEach((l) => assert.strictEqual(l.length, 50));
  assert.ok(lineas(c.importaciones).length >= 1);
});

test('una factura partida en dos alícuotas = 1 comprobante + 2 alícuotas', () => {
  const base = { tipoOp: 'venta', tipoDoc: 'Factura A', numero: '00003-00000045', fecha: '2026-08-01', cuit: '30-50001091-2', razon: 'EMPRESA S.A.' };
  const v = ExportEngine.generarLIDVentas([{ ...base, neto: 1000, iva: 105, alicuota: 10.5 }, { ...base, neto: 1000, iva: 210, alicuota: 21 }]);
  const cb = lineas(v.cbte);
  assert.strictEqual(cb.length, 1);
  assert.strictEqual(cb[0].slice(8, 11), '001');
  assert.strictEqual(cb[0].slice(108, 123), '000000000231500', 'total 2315,00');
  assert.strictEqual(cb[0][241], '2', 'cantidad de alícuotas');
  assert.deepStrictEqual(lineas(v.alicuotas).map((x) => x.slice(43, 47)).sort(), ['0004', '0005']);
});

test('las retenciones/percepciones cargadas desde Mis Retenciones no van al Libro IVA', () => {
  const c = ExportEngine.generarLIDCompras([{ tipoOp: 'retencion', clase: 'percepcion', tipoDoc: 'Constancia Percepcion IVA', numero: '00001-00000001', cuit: '30500010912', retenciones: 500, neto: 0 }]);
  assert.strictEqual(c.cantidad, 0);
});

test('el IVA del TXT coincide con la liquidación (control de totales)', () => {
  const comps = MockData.defaultSistemaVouchers;
  const s = TaxEngine.calculateIVA(comps);
  assert.ok(Math.abs(ExportEngine.totalesTXT('ventas', comps).positivo - s.dfPositivo) < 1);
  const tc = ExportEngine.totalesTXT('compras', comps);
  assert.ok(Math.abs(tc.positivo - s.cfPositivo) < 1);
  assert.ok(Math.abs(tc.impo - s.impoIVATotal) < 1);
});
