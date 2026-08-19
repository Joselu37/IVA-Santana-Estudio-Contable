/**
 * arcaReconciler.js
 * Cruza los comprobantes cargados como libros propios (fuente: 'sistema') contra
 * los importados como oficiales de ARCA (fuente: 'arca', vía "Mis Comprobantes"
 * exportado a CSV/TXT e importado con el mismo parser).
 *
 * Clave de cruce: tipoOperacion + cuit + numero (normalizado). Si no aparece en
 * ambos lados, se marca "faltante"; si aparece en ambos pero difieren neto/IVA,
 * se marca "diferencia"; si coincide, "ok".
 */
(function () {
  'use strict';

  function normalizarNumero(numero) {
    return String(numero || '').replace(/[^0-9-]/g, '');
  }

  function claveComprobante(c) {
    return `${c.tipoOperacion}|${c.cuit}|${normalizarNumero(c.numero)}`;
  }

  function tolerable(a, b) {
    return Math.abs(Number(a) - Number(b)) <= 0.5; // medio peso de tolerancia por redondeo
  }

  /**
   * @param {Array} comprobantes - todos los comprobantes del contribuyente (ambas fuentes)
   * @param {String} periodo - 'YYYY-MM', opcional
   */
  function ejecutarCruce(comprobantes, periodo) {
    const delPeriodo = periodo
      ? comprobantes.filter((c) => (c.fecha || '').slice(0, 7) === periodo)
      : comprobantes;

    const sistema = delPeriodo.filter((c) => c.fuente !== 'arca');
    const arca = delPeriodo.filter((c) => c.fuente === 'arca');

    const mapaArca = new Map(arca.map((c) => [claveComprobante(c), c]));
    const mapaSistema = new Map(sistema.map((c) => [claveComprobante(c), c]));

    const filas = [];
    let ok = 0, diff = 0, missing = 0;

    for (const c of sistema) {
      const key = claveComprobante(c);
      const par = mapaArca.get(key);
      if (!par) {
        filas.push({
          comprobante: c, contraparte: null, estado: 'solo_sistema',
          diagnostico: 'Está en tus libros pero no aparece en el archivo de ARCA importado. Verificá si fue presentado o si falta importar ese período de ARCA.'
        });
        missing++;
        continue;
      }
      if (!tolerable(c.neto, par.neto) || Number(c.alicuota) !== Number(par.alicuota)) {
        filas.push({
          comprobante: c, contraparte: par, estado: 'diferencia',
          diagnostico: `Monto o alícuota no coincide: sistema $${c.neto} (${c.alicuota}%) vs ARCA $${par.neto} (${par.alicuota}%). Revisar cuál es el correcto antes de liquidar.`
        });
        diff++;
      } else {
        filas.push({ comprobante: c, contraparte: par, estado: 'ok', diagnostico: 'Coincide.' });
        ok++;
      }
    }

    for (const c of arca) {
      const key = claveComprobante(c);
      if (!mapaSistema.has(key)) {
        filas.push({
          comprobante: c, contraparte: null, estado: 'solo_arca',
          diagnostico: 'Aparece en el archivo de ARCA pero no está cargado en tus libros. Revisá si corresponde cargarlo (podría ser una compra/venta no registrada).'
        });
        missing++;
      }
    }

    return { filas, stats: { ok, diff, missing } };
  }

  window.ArcaReconciler = { ejecutarCruce, claveComprobante };
})();
