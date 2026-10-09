'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cargarFrontend } = require('./helpers');
const { CsvParser, TaxEngine } = cargarFrontend();

const HEADER_ANCHO = 'Fecha de Emisión;Tipo de Comprobante;Punto de Venta;Número Desde;Número Hasta;Cód. Autorización;Tipo Doc. Receptor;Nro. Doc. Receptor;Denominación Receptor;Tipo Cambio;Moneda;Imp. Neto Gravado IVA 0%;IVA 2,5%;Imp. Neto Gravado IVA 2,5%;IVA 5%;Imp. Neto Gravado IVA 5%;IVA 10,5%;Imp. Neto Gravado IVA 10,5%;IVA 21%;Imp. Neto Gravado IVA 21%;IVA 27%;Imp. Neto Gravado IVA 27%;Imp. Neto Gravado Total;Imp. Neto No Gravado;Imp. Op. Exentas;Otros Tributos;Total IVA;Imp. Total';

test('Mis Comprobantes formato ancho: multi-alícuota, NC y dólares', () => {
  const csv = [
    'Mis Comprobantes Emitidos - CUIT 20172543597',
    HEADER_ANCHO,
    '01/08/2026;1 - Factura A;3;45;45;123;80;30500010912;EMPRESA SA;1;$;0;0;0;0;0;105;1000;210;1000;0;0;2000;0;0;50;315;2365',
    '05/08/2026;3 - Nota de Crédito A;3;7;7;124;80;30500010912;EMPRESA SA;1;$;0;0;0;0;0;0;0;21;100;0;0;100;0;0;0;21;121',
    '06/08/2026;1 - Factura A;3;46;46;125;80;30500010912;EMPRESA SA;1000,50;DOL;0;0;0;0;0;0;0;21;100;0;0;100;0;0;0;21;121'
  ].join('\n');
  const v = CsvParser.parseArcaCSV(csv, 'venta');
  assert.strictEqual(v.length, 4, 'la primera factura se parte en 10,5% y 21%');
  assert.deepStrictEqual(v.map((x) => x.alicuota), [10.5, 21, 21, 21]);
  assert.strictEqual(v[0].numero, '00003-00000045');
  assert.strictEqual(v[0].cuit, '30-50001091-2', 'toma el Nro. Doc. y no el Tipo Doc.');
  assert.strictEqual(v[2].neto, -100);
  assert.strictEqual(v[2].iva, -21);
  assert.strictEqual(v[3].neto, 100050);
  assert.match(v[3].tipoDoc, /DOL @ 1000.5/);
  const r = TaxEngine.calculateIVA(v);
  // La NC emitida va como restitución de débito (del lado del crédito), igual que en ARCA.
  assert.strictEqual(r.dfTotal, 105 + 210 + 21010.5);
  assert.strictEqual(r.restitucionDF, 21);
  assert.strictEqual(r.subtotalDebitoCredito, 105 + 210 + 21010.5 - 21);
});

test('plantilla de compras: IVA calculado con la alícuota de cada fila', () => {
  const csv = 'Fecha;TipoComprobante;PuntoVenta;Numero;CUIT_Proveedor;RazonSocial;NetoGravado;AlicuotaIVA;Percepciones\n' +
    '2026-08-03;Factura A;00005;00012940;30708912341;PROVEEDOR S.A.;180000.00;21.0;3780.00\n' +
    '2026-08-12;Factura A;00001;00000845;30612345678;SERVICIOS S.R.L.;40000.00;27.0;0.00\n' +
    '2026-08-13;Factura A;00001;00000846;30612345678;SERVICIOS S.R.L.;1000.00;0;0';
  const v = CsvParser.parseArcaCSV(csv, 'compra');
  assert.deepStrictEqual(v.map((x) => [x.numero, x.iva, x.alicuota, x.retenciones]), [
    ['00005-00012940', 37800, 21, 3780],
    ['00001-00000845', 10800, 27, 0],
    ['00001-00000846', 0, 0, 0]
  ]);
});

test('plantilla maestra: la columna TipoOperacion manda sobre la zona', () => {
  const csv = 'TipoOperacion;Fecha;TipoComprobante;PuntoVenta;Numero;CUIT_Contraparte;RazonSocial;NetoGravado;AlicuotaIVA;Retenciones_Percepciones\n' +
    'venta;2026-08-01;Factura A;00001;00012345;30500012344;CLIENTE;500000.00;21.0;0.00\n' +
    'compra;2026-08-05;Factura A;00002;00088910;30708912341;PROVEEDOR;250000.00;21.0;5250.00\n' +
    'importacion;2026-08-10;Despacho Impo;26001;IC04001999X;33999000019;ADUANA;3500000.00;21.0;700000.00';
  const v = CsvParser.parseArcaCSV(csv, 'compra');
  assert.deepStrictEqual(v.map((x) => x.tipoOp), ['venta', 'compra', 'importacion']);
  assert.strictEqual(v[0].tipoDoc, 'Factura A');
  assert.strictEqual(v[2].numero, '26001-IC04001999X');
  assert.strictEqual(v[2].esAduanera, 'si');
});

test('Mis Retenciones: son pagos a cuenta (no compras) aunque se suban por otra zona', () => {
  const csv = 'Fecha;TipoComprobante;NumeroComprobante;CUITAgente;DenominacionAgente;ImporteRetenidoPercibido;EsAduanera\n' +
    '2026-08-03;Certificado Retención IVA;00001-00004521;30500012344;CLIENTE S.A.;45000.00;no\n' +
    '2026-08-08;Percepción Aduanera RG 5339;26001-IC04001294X;33999000019;ADUANA;1300000.00;si\n' +
    '2026-08-09;Percepción IVA;00002-00000001;30500012344;PROVEEDOR;800,00;no';
  const v = CsvParser.parseArcaCSV(csv, 'venta');
  assert.deepStrictEqual(v.map((x) => [x.tipoOp, x.clase, x.retenciones, x.neto]), [
    ['retencion', 'retencion', 45000, 0],
    ['retencion', 'aduanera', 1300000, 0],
    ['retencion', 'percepcion', 800, 0]
  ]);
  assert.strictEqual(v[0].numero, '00001-00004521');
  const r = TaxEngine.calculateIVA(v);
  assert.strictEqual(r.cfComputableTotal, 0, 'una retención no genera crédito fiscal');
  assert.strictEqual(r.totalPagosACuenta, 1345800);
});

test('números argentinos', () => {
  assert.strictEqual(CsvParser.parseArgNumber('$ 1.250.000,50'), 1250000.5);
  assert.strictEqual(CsvParser.parseArgNumber('1.250.000'), 1250000);
  assert.strictEqual(CsvParser.parseArgNumber('-3.000,10'), -3000.1);
  assert.strictEqual(CsvParser.parseArgNumber('1234.56'), 1234.56);
  assert.strictEqual(CsvParser.parseArgNumber(''), 0);
});

test('formato ancho: Factura B/C recibida y operaciones exentas no se pierden', () => {
  const csv = [
    HEADER_ANCHO.replace('Receptor', 'Emisor').replace('Receptor', 'Emisor').replace('Receptor', 'Emisor'),
    '02/08/2026;11 - Factura C;2;10;10;1;80;20172543597;MONOTRIBUTISTA;1;$;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;5000',
    '03/08/2026;1 - Factura A;2;11;11;1;80;30500010912;EMPRESA SA;1;$;0;0;0;0;0;0;0;210;1000;0;0;1000;0;300;0;210;1510'
  ].join('\n');
  const v = CsvParser.parseArcaCSV(csv, 'compra');
  assert.deepStrictEqual(v.map((x) => [x.tipoDoc, x.neto, x.iva, x.alicuota]), [
    ['Factura C', 5000, 0, 0],
    ['Factura A', 1000, 210, 21],
    ['Factura A', 300, 0, 0]
  ]);
  const r = TaxEngine.calculateIVA(v);
  assert.strictEqual(r.cfComputableTotal, 210, 'la Factura C no da crédito fiscal');
});

test('formato angosto: Factura B recibida con solo total no inventa IVA', () => {
  const csv = 'Fecha;Tipo;Punto de Venta;Numero;CUIT;Razon Social;Importe Total\n2026-08-03;Factura B;1;5;30500010912;KIOSCO;1210,00';
  const v = CsvParser.parseArcaCSV(csv, 'compra');
  assert.strictEqual(v[0].neto, 1210);
  assert.strictEqual(v[0].iva, 0);
  assert.strictEqual(TaxEngine.ivaDe({ tipoOp: 'compra', tipoDoc: 'Factura B', neto: 1000, alicuota: 21 }), 0);
  assert.strictEqual(TaxEngine.ivaDe({ tipoOp: 'venta', tipoDoc: 'Factura B', neto: 1000, alicuota: 21 }), 210, 'en ventas B sí hay débito');
});

test('despacho: razón social de la aduana, no el código', () => {
  const csv = 'Fecha;TipoComprobante;CodigoAduana;NumeroDespacho;CUITAduana;AduanaNombre;CIF_Neto;AlicuotaIVA;PercepcionAduaneraRG5339\n2026-08-08;Despacho Impo;26001;IC04001294X;33999000019;ADUANA BUENOS AIRES;6500000.00;21.0;1300000.00';
  assert.strictEqual(CsvParser.parseArcaCSV(csv, 'importacion')[0].razon, 'ADUANA BUENOS AIRES');
});
