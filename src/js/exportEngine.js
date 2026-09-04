/**
 * Export Engine for ARCA Files (Libro IVA Digital TXT) & Working Papers (Excel/CSV)
 */

window.ExportEngine = (function() {
  /**
   * Generates ARCA Libro IVA Digital (LID) Ventas TXT file.
   * Fixed length formatting based on ARCA specifications.
   */
  function generateLIDVentasTXT(comprobantes) {
    const ventas = comprobantes.filter(c => c.tipoOp === 'venta' || c.tipoOp === 'exportacion');
    let txtLines = [];

    ventas.forEach(c => {
      const fechaClean = (c.fecha || '').replace(/-/g, ''); // AAAAMMDD
      const tipoCod = c.tipoOp === 'exportacion' ? '019' : '001'; // 001=Factura A, 019=Factura E
      const parts = (c.numero || '00001-00000001').split('-');
      const ptoVta = (parts[0] || '1').padStart(5, '0');
      const numComp = (parts[1] || '1').padStart(20, '0');
      const cuitClean = (c.cuit || '').replace(/\D/g, '').padStart(20, '0');
      const razon = (c.razon || '').padEnd(30, ' ').substring(0, 30);
      
      const netoCents = Math.round(c.neto * 100).toString().padStart(15, '0');
      const dfCents = Math.round(((c.neto * c.alicuota) / 100) * 100).toString().padStart(15, '0');

      // ARCA LID Ventas Line format (simplified spec compliant)
      const line = `${fechaClean}${tipoCod}${ptoVta}${numComp}${numComp}${cuitClean}${razon}${netoCents}${dfCents}`;
      txtLines.push(line);
    });

    return txtLines.join('\r\n');
  }

  /**
   * Generates ARCA Libro IVA Digital (LID) Compras TXT file.
   */
  function generateLIDComprasTXT(comprobantes) {
    const compras = comprobantes.filter(c => c.tipoOp === 'compra');
    let txtLines = [];

    compras.forEach(c => {
      const fechaClean = (c.fecha || '').replace(/-/g, '');
      const tipoCod = '001'; // Factura A
      const parts = (c.numero || '00001-00000001').split('-');
      const ptoVta = (parts[0] || '1').padStart(5, '0');
      const numComp = (parts[1] || '1').padStart(20, '0');
      const cuitClean = (c.cuit || '').replace(/\D/g, '').padStart(20, '0');
      const razon = (c.razon || '').padEnd(30, ' ').substring(0, 30);
      
      const netoCents = Math.round(c.neto * 100).toString().padStart(15, '0');
      const cfCents = Math.round(((c.neto * c.alicuota) / 100) * 100).toString().padStart(15, '0');

      const line = `${fechaClean}${tipoCod}${ptoVta}${numComp}${numComp}${cuitClean}${razon}${netoCents}${cfCents}`;
      txtLines.push(line);
    });

    return txtLines.join('\r\n');
  }

  /**
   * Generates ARCA Libro IVA Digital (LID) Despachos de Importación TXT.
   */
  function generateLIDImportacionesTXT(comprobantes) {
    const impos = comprobantes.filter(c => c.tipoOp === 'importacion');
    let txtLines = [];

    impos.forEach(c => {
      const fechaClean = (c.fecha || '').replace(/-/g, '');
      const despNumero = (c.numero || '').padEnd(16, ' ').substring(0, 16);
      const netoCents = Math.round(c.neto * 100).toString().padStart(15, '0');
      const ivaCents = Math.round(((c.neto * c.alicuota) / 100) * 100).toString().padStart(15, '0');
      const percepCents = Math.round((c.retenciones || 0) * 100).toString().padStart(15, '0');

      const line = `${fechaClean}${despNumero}${netoCents}${ivaCents}${percepCents}`;
      txtLines.push(line);
    });

    return txtLines.join('\r\n');
  }

  /**
   * Downloads a raw text file in browser.
   */
  function downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8;') {
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Exports Working Papers as Excel CSV.
   */
  function exportWorkingPaperCSV(taxSummary, contribuyente) {
    let csv = `PAPEL DE TRABAJO LIQUIDACION DE IVA - ARCA\n`;
    csv += `Contribuyente:;${contribuyente.razon}\n`;
    csv += `CUIT:;${contribuyente.cuit}\n`;
    csv += `Periodo:;Agosto 2026\n\n`;

    csv += `CONCEPTO;MONTO NETO ($);IVA DÉBITO/CRÉDITO ($)\n`;
    csv += `Ventas Gravadas Mercado Interno;${taxSummary.dfNetoTotal.toFixed(2)};${taxSummary.dfTotal.toFixed(2)}\n`;
    csv += `Exportaciones (Factura E);${taxSummary.expoNetoTotal.toFixed(2)};0.00\n`;
    csv += `Compras Locales Gravadas;${taxSummary.cfNetoTotal.toFixed(2)};${taxSummary.cfTotalBruto.toFixed(2)}\n`;
    csv += `Despachos de Importacion SIM;${taxSummary.impoNetoTotal.toFixed(2)};${taxSummary.impoIVATotal.toFixed(2)}\n\n`;

    csv += `DETERMINACION DEL IMPUESTO\n`;
    csv += `Total Débito Fiscal;${taxSummary.dfTotal.toFixed(2)}\n`;
    csv += `Total Crédito Fiscal Computable;-${taxSummary.cfComputableTotal.toFixed(2)}\n`;
    csv += `Saldo Técnico Anterior;-${taxSummary.stAnterior.toFixed(2)}\n`;
    csv += `Saldo Técnico Resultante;${taxSummary.saldoTecnicoResultante.toFixed(2)}\n`;
    csv += `Retenciones y Percepciones Totales;-${taxSummary.totalPagosACuenta.toFixed(2)}\n`;
    csv += `Impuesto a Pagar Resultante;${taxSummary.impuestoAPagar.toFixed(2)}\n`;
    csv += `Saldo Libre Disponibilidad Resultante;${taxSummary.saldoLibreDisponibilidadResultante.toFixed(2)}\n`;

    downloadFile(`Papel_de_Trabajo_IVA_${contribuyente.cuit}.csv`, csv, 'text/csv;charset=utf-8;');
  }

  /**
   * Generates downloadable CSV template files.
   */
  function downloadTemplate(type) {
    let filename = '';
    let content = '';

    if (type === 'maestra') {
      filename = 'Plantilla_Maestra_Comprobantes_IVA.csv';
      content = `Fecha;TipoComprobante;PuntoVenta;Numero;CUIT_Contraparte;RazonSocial;NetoGravado;AlicuotaIVA;Retenciones_Percepciones\n`;
      content += `2026-08-01;Factura A;00001;00012345;30500012344;DISTRIBUIDORA EJEMPLO S.A.;500000.00;21.0;0.00\n`;
      content += `2026-08-02;Factura E;00001;00000100;55001294810;CLIENTE EXTERIOR CORP (USA);1200000.00;0.0;0.00\n`;
      content += `2026-08-05;Factura A;00002;00088910;30708912341;PROVEEDOR NACIONAL S.R.L.;250000.00;21.0;5250.00\n`;
      content += `2026-08-10;Despacho Impo;26001;IC04001999X;33999000019;ADUANA DE BUENOS AIRES SIM;3500000.00;21.0;700000.00\n`;
    } else if (type === 'ventas') {
      filename = 'Plantilla_Ventas_y_Exportaciones.csv';
      content = `Fecha;TipoComprobante;PuntoVenta;Numero;CUIT_Cliente;RazonSocial;NetoGravado;AlicuotaIVA;Retenciones\n`;
      content += `2026-08-01;Factura A;00001;00012345;30500012344;CLIENTE LOCAL S.A.;450000.00;21.0;0.00\n`;
      content += `2026-08-05;Factura E;00001;00000100;55001294810;IMPORTADOR EXTRANJERO LLC;850000.00;0.0;0.00\n`;
    } else if (type === 'compras') {
      filename = 'Plantilla_Compras_Locales.csv';
      content = `Fecha;TipoComprobante;PuntoVenta;Numero;CUIT_Proveedor;RazonSocial;NetoGravado;AlicuotaIVA;Percepciones\n`;
      content += `2026-08-03;Factura A;00005;00012940;30708912341;PROVEEDOR INDUSTRIAL S.A.;180000.00;21.0;3780.00\n`;
      content += `2026-08-12;Factura A;00001;00000845;30612345678;SERVICIOS TÉCNICOS S.R.L.;40000.00;27.0;0.00\n`;
    } else if (type === 'impo') {
      filename = 'Plantilla_Despachos_Importacion_SIM.csv';
      content = `Fecha;TipoComprobante;CodigoAduana;NumeroDespacho;CUITAduana;AduanaNombre;CIF_Neto;AlicuotaIVA;PercepcionAduaneraRG5339\n`;
      content += `2026-08-08;Despacho Impo;26001;IC04001294X;33999000019;ADUANA BUENOS AIRES;6500000.00;21.0;1300000.00\n`;
    } else if (type === 'retenciones') {
      filename = 'Plantilla_Retenciones_y_Percepciones.csv';
      content = `Fecha;TipoComprobante;NumeroComprobante;CUITAgente;DenominacionAgente;ImporteRetenidoPercibido;EsAduanera\n`;
      content += `2026-08-03;Certificado Retención IVA;00001-00004521;30500012344;DISTRIBUIDORA CLIENTE S.A.;45000.00;no\n`;
      content += `2026-08-08;Percepción Aduanera RG 5339;26001-IC04001294X;33999000019;ADUANA DE BUENOS AIRES;1300000.00;si\n`;
      content += `2026-08-15;Retención Bancaria SIRCER;00000-00994120;30999000029;BANCO DE LA NACIÓN ARGENTINA;12500.00;no\n`;
    }

    downloadFile(filename, content, 'text/csv;charset=utf-8;');
  }

  return {
    generateLIDVentasTXT,
    generateLIDComprasTXT,
    generateLIDImportacionesTXT,
    downloadFile,
    exportWorkingPaperCSV,
    downloadTemplate
  };
})();
