/**
 * exportEngine.js
 * Genera todos los archivos descargables: CSV de comprobantes, TXT estilo LID,
 * backup JSON completo del contribuyente, y dispara la impresión del papel de
 * trabajo (para guardar como PDF desde el navegador).
 *
 * NOTA sobre los TXT "LID": el formato de columnas de la Resolución General de
 * ARCA para el Libro de IVA Digital tiene una especificación de campos fija que
 * puede cambiar. Lo que se genera acá es un archivo delimitado con los campos
 * habituales (fecha, tipo, punto de venta, número, CUIT, neto, alícuota, IVA)
 * a modo de borrador: antes de importarlo a ARCA hay que validarlo contra el
 * instructivo vigente de la RG correspondiente.
 */
(function () {
  'use strict';

  function descargarTexto(nombreArchivo, contenido, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([contenido], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function csvEscape(v) {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function comprobantesACsv(comprobantes) {
    const headers = ['fecha', 'tipoOperacion', 'tipoDoc', 'numero', 'cuit', 'razonSocial', 'neto', 'alicuota', 'iva', 'retencionesPercepciones', 'vinculadoExportacion'];
    const filas = comprobantes.map((c) => [
      c.fecha, c.tipoOperacion, c.tipoDoc, c.numero, c.cuit, c.razonSocial,
      c.neto, c.alicuota, Math.round((Number(c.neto) * Number(c.alicuota) / 100 + Number.EPSILON) * 100) / 100,
      c.retencionesPercepciones, c.vinculadoExportacion ? 'si' : 'no'
    ]);
    return [headers, ...filas].map((f) => f.map(csvEscape).join(';')).join('\r\n');
  }

  function exportarComprobantesCsv(comprobantes, nombreArchivo) {
    // BOM para que Excel en Windows reconozca UTF-8 (tildes, Ñ) correctamente
    descargarTexto(nombreArchivo, '\uFEFF' + comprobantesACsv(comprobantes), 'text/csv;charset=utf-8');
  }

  function exportarLidTxt(comprobantes, tipo, nombreArchivo) {
    // tipo: 'ventas' | 'compras' | 'importacion'
    const filtrados = comprobantes.filter((c) => {
      if (tipo === 'ventas') return c.tipoOperacion === 'venta' || c.tipoOperacion === 'exportacion';
      if (tipo === 'compras') return c.tipoOperacion === 'compra';
      return c.tipoOperacion === 'importacion';
    });
    const lineas = filtrados.map((c) => {
      const iva = Math.round((Number(c.neto) * Number(c.alicuota) / 100 + Number.EPSILON) * 100) / 100;
      return [
        c.fecha.replace(/-/g, ''), c.tipoDoc, c.numero.replace('-', ''), c.cuit,
        Number(c.neto).toFixed(2), Number(c.alicuota).toFixed(2), iva.toFixed(2),
        Number(c.retencionesPercepciones || 0).toFixed(2)
      ].join('|');
    });
    descargarTexto(nombreArchivo, lineas.join('\r\n'), 'text/plain;charset=utf-8');
  }

  function exportarPapelTrabajoCsv(liquidacion, contribuyente, nombreArchivo) {
    if (!liquidacion.aplica) {
      descargarTexto(nombreArchivo, `Sin liquidación: ${liquidacion.motivo}`, 'text/csv;charset=utf-8');
      return;
    }
    const L = liquidacion;
    const filas = [
      ['Contribuyente', contribuyente.razonSocial],
      ['CUIT', contribuyente.cuit],
      ['Período', L.periodo],
      [''],
      ['DÉBITO FISCAL POR ALÍCUOTA'],
      ['Alícuota', 'Neto', 'IVA'],
      ...L.dfPorAlicuota.map((g) => [`${g.alicuota}%`, g.neto.toFixed(2), g.iva.toFixed(2)]),
      ['Total Débito Fiscal', '', L.debitoFiscal.toFixed(2)],
      [''],
      ['CRÉDITO FISCAL'],
      ['CF Compras generales (post-prorrateo)', '', L.cfGeneralComputable.toFixed(2)],
      ['CF Vinculado directo a Exportación (Art. 43)', '', L.cfVinculadoExpoDirecto.toFixed(2)],
      ['Total Crédito Fiscal Computable', '', L.creditoFiscalComputable.toFixed(2)],
      [''],
      ['DETERMINACIÓN'],
      ['Subtotal (DF - CF)', '', L.subtotal.toFixed(2)],
      ['Saldo Técnico Período Anterior', '', L.saldoTecnicoAnterior.toFixed(2)],
      ['Saldo Técnico Resultante', '', L.saldoTecnicoResultante.toFixed(2)],
      ['Retenciones/Percepciones Locales', '', L.retencionesPercepcionesLocales.toFixed(2)],
      ['Percepciones Aduaneras', '', L.percepcionesAduaneras.toFixed(2)],
      ['Saldo Libre Disponibilidad Anterior', '', L.saldoLibreDisponibilidadAnterior.toFixed(2)],
      [L.esAFavor ? 'SALDO A FAVOR' : 'SALDO A PAGAR', '', Math.abs(L.posicionFinal).toFixed(2)]
    ];
    descargarTexto(nombreArchivo, '\uFEFF' + filas.map((f) => f.map(csvEscape).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  function imprimirPapelTrabajo() {
    window.print();
  }

  function exportarBackupJson(contribuyenteData, nombreArchivo) {
    descargarTexto(nombreArchivo, JSON.stringify(contribuyenteData, null, 2), 'application/json;charset=utf-8');
  }

  window.ExportEngine = {
    exportarComprobantesCsv,
    exportarLidTxt,
    exportarPapelTrabajoCsv,
    imprimirPapelTrabajo,
    exportarBackupJson,
    descargarTexto
  };
})();
