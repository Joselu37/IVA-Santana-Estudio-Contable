/**
 * mockData.js
 * Caso demo: LOGÍSTICA & IMPEX S.A. — Responsable Inscripto con ventas locales,
 * exportaciones, compras locales e importaciones, para probar el liquidador
 * de punta a punta sin cargar datos reales.
 */
(function () {
  'use strict';

  function id() { return `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

  function casoDemo(periodo) {
    const p = periodo || new Date().toISOString().slice(0, 7);
    const dia = (n) => `${p}-${String(n).padStart(2, '0')}`;

    return [
      // Ventas mercado interno
      { id: id(), fuente: 'sistema', tipoOperacion: 'venta', fecha: dia(3), tipoDoc: 'Factura A', numero: '00001-00012345', cuit: '30500019073', razonSocial: 'CLIENTE DISTRIBUIDORA SRL', neto: 850000, alicuota: 21, retencionesPercepciones: 12000, esPercepcionAduanera: false, vinculadoExportacion: false, createdAt: new Date().toISOString() },
      { id: id(), fuente: 'sistema', tipoOperacion: 'venta', fecha: dia(10), tipoDoc: 'Factura B', numero: '00001-00012346', cuit: '27230938607', razonSocial: 'CONSUMIDOR FINAL VARIOS', neto: 320000, alicuota: 21, retencionesPercepciones: 0, esPercepcionAduanera: false, vinculadoExportacion: false, createdAt: new Date().toISOString() },
      { id: id(), fuente: 'sistema', tipoOperacion: 'venta', fecha: dia(15), tipoDoc: 'Factura A', numero: '00001-00012347', cuit: '30500010912', razonSocial: 'MAYORISTA DEL SUR SA', neto: 150000, alicuota: 10.5, retencionesPercepciones: 0, esPercepcionAduanera: false, vinculadoExportacion: false, createdAt: new Date().toISOString() },

      // Exportaciones (Factura E, alícuota 0)
      { id: id(), fuente: 'sistema', tipoOperacion: 'exportacion', fecha: dia(8), tipoDoc: 'Factura E', numero: '00002-00000501', cuit: '30500010912', razonSocial: 'GLOBAL IMPORT LLC (EXTERIOR)', neto: 2400000, alicuota: 0, retencionesPercepciones: 0, esPercepcionAduanera: false, vinculadoExportacion: false, createdAt: new Date().toISOString() },

      // Compras locales generales
      { id: id(), fuente: 'sistema', tipoOperacion: 'compra', fecha: dia(5), tipoDoc: 'Factura A', numero: '00003-00004521', cuit: '30500019073', razonSocial: 'ALQUILERES Y SERVICIOS SA', neto: 200000, alicuota: 21, retencionesPercepciones: 3000, esPercepcionAduanera: false, vinculadoExportacion: false, createdAt: new Date().toISOString() },

      // Compra vinculada directamente a exportación (insumo para producir lo exportado)
      { id: id(), fuente: 'sistema', tipoOperacion: 'compra', fecha: dia(6), tipoDoc: 'Factura A', numero: '00003-00004522', cuit: '27230938607', razonSocial: 'INSUMOS INDUSTRIALES SRL', neto: 900000, alicuota: 21, retencionesPercepciones: 0, esPercepcionAduanera: false, vinculadoExportacion: true, createdAt: new Date().toISOString() },

      // Despacho de importación (IVA aduanero + percepción RG 5339/2281)
      { id: id(), fuente: 'sistema', tipoOperacion: 'importacion', fecha: dia(12), tipoDoc: 'Despacho Impo', numero: '17001IC01-000123-4', cuit: '30500010912', razonSocial: 'DESPACHO ADUANA - PROVEEDOR EXTERIOR', neto: 500000, alicuota: 21, retencionesPercepciones: 45000, esPercepcionAduanera: true, vinculadoExportacion: false, createdAt: new Date().toISOString() }
    ];
  }

  window.MockData = { casoDemo };
})();
