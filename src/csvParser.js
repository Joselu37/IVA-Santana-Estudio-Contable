/**
 * csvParser.js
 * Convierte archivos CSV/TXT (o texto pegado desde Excel) en comprobantes.
 *
 * Formato esperado por fila (separador ; o tab), 9 u 10 columnas:
 *   fecha;tipoDoc;puntoVenta;numero;cuit;razonSocial;neto;alicuota;retenciones[;tipoOperacion]
 * Ejemplo:
 *   2026-08-01;Factura A;00001;00012345;30500012344;PROVEEDOR S.A.;500000.00;21.0;0.00;compra
 *
 * Si la columna tipoOperacion no viene, se infiere:
 *  - alicuota 0 y tipoDoc contiene "E" -> exportacion
 *  - por defecto -> compra (el usuario puede reclasificar filas después de importar)
 */
(function () {
  'use strict';

  function limpiarNumero(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    // admite tanto "1.234,56" (AR) como "1234.56" (US); nos quedamos con el último separador como decimal
    const s = String(str).trim().replace(/\$/g, '').replace(/\s/g, '');
    if (/,\d{1,2}$/.test(s) && s.includes('.')) {
      return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    }
    if (/,\d{1,2}$/.test(s)) {
      return parseFloat(s.replace(',', '.')) || 0;
    }
    return parseFloat(s.replace(/,/g, '')) || 0;
  }

  function inferirTipoOperacion(tipoDoc, alicuota) {
    const doc = String(tipoDoc || '').toLowerCase();
    if (doc.includes('despacho') || doc.includes('impo')) return 'importacion';
    if (doc.includes('factura e') || (Number(alicuota) === 0 && doc.includes('e'))) return 'exportacion';
    return 'compra';
  }

  function detectarSeparador(linea) {
    if (linea.includes(';')) return ';';
    if (linea.includes('\t')) return '\t';
    return ',';
  }

  function generarId() {
    return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Parsea texto plano (pegado o leído de archivo) a un array de comprobantes.
   * @param {String} texto
   * @param {Object} opciones - { fuente: 'sistema'|'arca', tipoOperacionForzado: string|null }
   */
  function parsearTexto(texto, opciones = {}) {
    const { fuente = 'sistema', tipoOperacionForzado = null } = opciones;
    const lineas = String(texto).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const errores = [];
    const comprobantes = [];

    lineas.forEach((linea, idx) => {
      // saltar posible fila de encabezado
      if (idx === 0 && /fecha/i.test(linea) && /(cuit|neto)/i.test(linea)) return;

      const sep = detectarSeparador(linea);
      const cols = linea.split(sep).map((c) => c.trim());

      if (cols.length < 7) {
        errores.push(`Línea ${idx + 1}: se esperaban al menos 7 columnas, se encontraron ${cols.length}.`);
        return;
      }

      const [fecha, tipoDoc, puntoVenta, numero, cuit, razonSocial, netoStr, alicuotaStr, retStr, tipoOpStr] = cols;

      const cuitLimpio = String(cuit || '').replace(/[^0-9]/g, '');
      if (cuitLimpio.length !== 11) {
        errores.push(`Línea ${idx + 1}: CUIT "${cuit}" inválido (debe tener 11 dígitos).`);
        return;
      }

      const neto = limpiarNumero(netoStr);
      const alicuota = alicuotaStr !== undefined ? limpiarNumero(alicuotaStr) : 21;
      const retenciones = retStr !== undefined ? limpiarNumero(retStr) : 0;
      const tipoOperacion = tipoOperacionForzado
        || (tipoOpStr ? tipoOpStr.trim().toLowerCase() : null)
        || inferirTipoOperacion(tipoDoc, alicuota);

      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        errores.push(`Línea ${idx + 1}: fecha "${fecha}" debe tener formato YYYY-MM-DD.`);
        return;
      }

      comprobantes.push({
        id: generarId(),
        fuente,
        tipoOperacion,
        fecha,
        tipoDoc: tipoDoc || '',
        numero: `${puntoVenta || ''}-${numero || ''}`.replace(/^-|-$/g, ''),
        cuit: cuitLimpio,
        razonSocial: razonSocial || '',
        neto: round2(neto),
        alicuota,
        retencionesPercepciones: round2(retenciones),
        esPercepcionAduanera: tipoOperacion === 'importacion' && alicuota === 0 && retenciones > 0,
        vinculadoExportacion: false,
        createdAt: new Date().toISOString()
      });
    });

    return { comprobantes, errores };
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  /**
   * Lee un File (input o drag&drop) y devuelve el texto plano.
   */
  function leerArchivo(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  window.CsvParser = { parsearTexto, leerArchivo, limpiarNumero };
})();
