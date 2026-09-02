/**
 * Preset Realistic Datasets for Demonstration
 * Empresa: LOGÍSTICA & IMPEX S.A. (CUIT: 30-71458962-9)
 * Operaciones: Mercado Interno + Exportación (Factura E) + Importación (Despacho SIM) + Percepciones RG 5339.
 */

window.MockData = (function() {
  const defaultContribuyente = {
    razon: 'LOGÍSTICA & IMPEX S.A.',
    cuit: '30-71458962-9',
    stAnterior: 150000.00,
    sldAnterior: 45000.00
  };

  // Comprobantes registrados en el sistema del contribuyente
  const defaultSistemaVouchers = [
    {
      id: 'v1',
      fecha: '2026-08-02',
      tipoOp: 'venta',
      tipoDoc: 'Factura A',
      numero: '00002-00004521',
      cuit: '30-50001234-4',
      razon: 'DISTRIBUIDORA DEL SUR S.R.L.',
      neto: 4500000.00,
      alicuota: 21,
      retenciones: 0,
      esAduanera: 'no'
    },
    {
      id: 'v2',
      fecha: '2026-08-05',
      tipoOp: 'exportacion',
      tipoDoc: 'Factura E',
      numero: '00001-00000312',
      cuit: '55-00129481-0',
      razon: 'LATAM TRADING CORP (CHILE)',
      neto: 8200000.00,
      alicuota: 0,
      retenciones: 0,
      esAduanera: 'no'
    },
    {
      id: 'v3',
      fecha: '2026-08-10',
      tipoOp: 'venta',
      tipoDoc: 'Factura A',
      numero: '00002-00004522',
      cuit: '33-65498712-9',
      razon: 'SUPERMERCADOS ANDINOS S.A.',
      neto: 2100000.00,
      alicuota: 10.5,
      retenciones: 0,
      esAduanera: 'no'
    },
    {
      id: 'v4',
      fecha: '2026-08-03',
      tipoOp: 'compra',
      tipoDoc: 'Factura A',
      numero: '00005-00012940',
      cuit: '30-70891234-1',
      razon: 'PROVEEDORES INDUSTRIALES S.A.',
      neto: 1800000.00,
      alicuota: 21,
      retenciones: 37800.00, // Percepción IIBB/IVA
      esAduanera: 'no'
    },
    {
      id: 'v5',
      fecha: '2026-08-08',
      tipoOp: 'importacion',
      tipoDoc: 'Despacho Impo',
      numero: '26001IC04001294X',
      cuit: '33-99900001-9',
      razon: 'ADUANA DE BUENOS AIRES (SIM)',
      neto: 6500000.00,
      alicuota: 21,
      retenciones: 1300000.00, // Percepción IVA Aduanera RG 5339 (20%)
      esAduanera: 'si'
    },
    {
      id: 'v6',
      fecha: '2026-08-12',
      tipoOp: 'compra',
      tipoDoc: 'Factura A',
      numero: '00001-00000845',
      cuit: '30-61234567-8',
      razon: 'SERVICIOS TÉCNICOS S.R.L.',
      neto: 400000.00,
      alicuota: 27,
      retenciones: 0,
      esAduanera: 'no'
    }
  ];

  // Comprobantes descargados del portal ARCA (Mis Comprobantes)
  // Incluye coincidencias, una diferencia de monto en V4 y un comprobante omitido V7
  const defaultArcaVouchers = [
    {
      fecha: '2026-08-02',
      tipoOp: 'venta',
      tipoDoc: 'Factura A',
      numero: '00002-00004521',
      cuit: '30-50001234-4',
      razon: 'DISTRIBUIDORA DEL SUR S.R.L.',
      neto: 4500000.00,
      alicuota: 21,
      retenciones: 0,
      esAduanera: 'no'
    },
    {
      fecha: '2026-08-05',
      tipoOp: 'exportacion',
      tipoDoc: 'Factura E',
      numero: '00001-00000312',
      cuit: '55-00129481-0',
      razon: 'LATAM TRADING CORP (CHILE)',
      neto: 8200000.00,
      alicuota: 0,
      retenciones: 0,
      esAduanera: 'no'
    },
    {
      fecha: '2026-08-10',
      tipoOp: 'venta',
      tipoDoc: 'Factura A',
      numero: '00002-00004522',
      cuit: '33-65498712-9',
      razon: 'SUPERMERCADOS ANDINOS S.A.',
      neto: 2100000.00,
      alicuota: 10.5,
      retenciones: 0,
      esAduanera: 'no'
    },
    {
      fecha: '2026-08-03',
      tipoOp: 'compra',
      tipoDoc: 'Factura A',
      numero: '00005-00012940',
      cuit: '30-70891234-1',
      razon: 'PROVEEDORES INDUSTRIALES S.A.',
      neto: 1850000.00, // <--- Diferencia de $50.000 con el libro local
      alicuota: 21,
      retenciones: 38850.00,
      esAduanera: 'no'
    },
    {
      fecha: '2026-08-08',
      tipoOp: 'importacion',
      tipoDoc: 'Despacho Impo',
      numero: '26001IC04001294X',
      cuit: '33-99900001-9',
      razon: 'ADUANA DE BUENOS AIRES (SIM)',
      neto: 6500000.00,
      alicuota: 21,
      retenciones: 1300000.00,
      esAduanera: 'si'
    },
    {
      fecha: '2026-08-12',
      tipoOp: 'compra',
      tipoDoc: 'Factura A',
      numero: '00001-00000845',
      cuit: '30-61234567-8',
      razon: 'SERVICIOS TÉCNICOS S.R.L.',
      neto: 400000.00,
      alicuota: 27,
      retenciones: 0,
      esAduanera: 'no'
    },
    {
      // Comprobante que está en ARCA pero NO ingresado en el libro local
      fecha: '2026-08-14',
      tipoOp: 'compra',
      tipoDoc: 'Factura A',
      numero: '00012-00009941',
      cuit: '30-54912384-2',
      razon: 'INSUMOS GRAFICOS S.A.',
      neto: 350000.00,
      alicuota: 21,
      retenciones: 7350.00,
      esAduanera: 'no'
    }
  ];

  return {
    defaultContribuyente,
    defaultSistemaVouchers,
    defaultArcaVouchers
  };
})();
