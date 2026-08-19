/**
 * taxEngine.js
 * Motor de liquidación de IVA (régimen general, Ley de IVA arts. 11-24 y 43).
 *
 * IMPORTANTE — LEER ANTES DE USAR EN UNA DDJJ REAL:
 * Este motor cubre el circuito general (ventas/compras mercado interno,
 * exportaciones a alícuota 0%, importaciones con IVA aduanero). NO contempla
 * regímenes especiales (construcción, financiero, agropecuario, turismo,
 * etc.), prorrateo de crédito fiscal indirecto por destino mixto más allá del
 * slider del simulador, ni la totalidad de percepciones/retenciones vigentes.
 * Es una herramienta de apoyo: el resultado siempre debe ser revisado por un
 * contador antes de presentar la DDJJ.
 *
 * Convención de signos: todos los importes que "restan" al saldo se devuelven
 * en positivo (el valor absoluto); quien renderiza decide mostrarlos entre
 * paréntesis. current el cálculo de la posición final SÍ resta internamente.
 */
(function () {
  'use strict';

  const ALICUOTAS_VALIDAS = [21, 10.5, 27, 0];

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function esMonotributo(condicionIVA) {
    return /monotribut/i.test(condicionIVA || '');
  }

  function esExento(condicionIVA) {
    return /exent/i.test(condicionIVA || '');
  }

  /**
   * Filtra comprobantes de un contribuyente al período fiscal (YYYY-MM) indicado.
   */
  function filtrarPorPeriodo(comprobantes, periodoYYYYMM) {
    if (!periodoYYYYMM) return comprobantes;
    return comprobantes.filter((c) => (c.fecha || '').slice(0, 7) === periodoYYYYMM);
  }

  /**
   * Agrupa un array de comprobantes de venta/compra por alícuota, sumando neto e IVA.
   */
  function agruparPorAlicuota(comprobantes) {
    const grupos = {};
    for (const c of comprobantes) {
      const alic = Number(c.alicuota);
      if (!grupos[alic]) grupos[alic] = { alicuota: alic, neto: 0, iva: 0, cantidad: 0 };
      grupos[alic].neto += Number(c.neto) || 0;
      grupos[alic].iva += (Number(c.neto) || 0) * alic / 100;
      grupos[alic].cantidad += 1;
    }
    return Object.values(grupos).sort((a, b) => b.alicuota - a.alicuota);
  }

  /**
   * Calcula la liquidación completa de un período para un contribuyente.
   *
   * @param {Object} params
   * @param {Array} params.comprobantes - todos los comprobantes cargados (de fuente 'sistema', ya filtrados de duplicados si corresponde)
   * @param {String} params.periodo - 'YYYY-MM'
   * @param {String} params.condicionIVA - condición del contribuyente (para gating de Monotributo)
   * @param {Number} params.saldoTecnicoAnterior - Art. 24, 1er párrafo
   * @param {Number} params.saldoLibreDisponibilidadAnterior - Art. 24, 2do párrafo
   * @param {Object} params.opciones - toggles del simulador
   * @param {Number} params.opciones.prorrateoPct - 0-100, % de CF general computable
   * @param {Boolean} params.opciones.incluirImportaciones
   * @param {Boolean} params.opciones.incluirPercepcionesAduaneras
   * @param {Boolean} params.opciones.solicitarArt43
   */
  function liquidar({
    comprobantes,
    periodo,
    condicionIVA,
    saldoTecnicoAnterior = 0,
    saldoLibreDisponibilidadAnterior = 0,
    opciones = {}
  }) {
    const {
      prorrateoPct = 100,
      incluirImportaciones = true,
      incluirPercepcionesAduaneras = true,
      solicitarArt43 = true
    } = opciones;

    if (esMonotributo(condicionIVA)) {
      return {
        aplica: false,
        motivo: 'El contribuyente es Responsable Monotributo: no liquida IVA (Anexo Ley 24.977).',
        periodo
      };
    }

    const delPeriodo = filtrarPorPeriodo(
      comprobantes.filter((c) => c.fuente !== 'arca'), // solo libros propios, no lo importado como "oficial" para conciliar
      periodo
    );

    const ventas = delPeriodo.filter((c) => c.tipoOperacion === 'venta');
    const exportaciones = delPeriodo.filter((c) => c.tipoOperacion === 'exportacion');
    const compras = delPeriodo.filter((c) => c.tipoOperacion === 'compra');
    const importaciones = delPeriodo.filter((c) => c.tipoOperacion === 'importacion');

    // --- 1. DÉBITO FISCAL ---
    const dfPorAlicuota = agruparPorAlicuota(ventas);
    const debitoFiscal = round2(dfPorAlicuota.reduce((acc, g) => acc + g.iva, 0));
    const montoExportaciones = round2(exportaciones.reduce((acc, c) => acc + (Number(c.neto) || 0), 0));
    const montoVentasGravadas = round2(ventas.reduce((acc, c) => acc + (Number(c.neto) || 0), 0));

    // --- 2. CRÉDITO FISCAL ---
    // CF directamente vinculado a exportación (marcado manualmente por el usuario, Art. 43)
    const comprasVinculadasExpo = compras.filter((c) => c.vinculadoExportacion);
    const comprasGenerales = compras.filter((c) => !c.vinculadoExportacion);
    const impoVinculadasExpo = importaciones.filter((c) => c.vinculadoExportacion);
    const impoGenerales = importaciones.filter((c) => !c.vinculadoExportacion);

    const cfVinculadoExpoDirecto = round2(
      [...comprasVinculadasExpo, ...impoVinculadasExpo].reduce(
        (acc, c) => acc + (Number(c.neto) || 0) * (Number(c.alicuota) || 0) / 100,
        0
      )
    );

    const cfComprasGenerales = round2(
      comprasGenerales.reduce((acc, c) => acc + (Number(c.neto) || 0) * (Number(c.alicuota) || 0) / 100, 0)
    );
    const cfImportacionesGenerales = incluirImportaciones
      ? round2(impoGenerales.reduce((acc, c) => acc + (Number(c.neto) || 0) * (Number(c.alicuota) || 0) / 100, 0))
      : 0;

    // El prorrateo del simulador (Art. 13) se aplica sobre el CF general no vinculado
    // directamente a un destino (gravado local vs. exportación). El CF vinculado
    // directo a exportación (marcado por el usuario) SIEMPRE es 100% computable,
    // ya que es Art. 43, no está sujeto al prorrateo del Art. 13.
    const factorProrrateo = Math.max(0, Math.min(100, Number(prorrateoPct))) / 100;
    const cfGeneralComputable = round2((cfComprasGenerales + cfImportacionesGenerales) * factorProrrateo);

    const creditoFiscalComputable = round2(cfGeneralComputable + (solicitarArt43 ? cfVinculadoExpoDirecto : 0));

    const cfPorAlicuotaCompras = agruparPorAlicuota(comprasGenerales);
    const cfPorAlicuotaImpo = incluirImportaciones ? agruparPorAlicuota(impoGenerales) : [];

    // --- 3. PERCEPCIONES / RETENCIONES ---
    const percepcionesAduaneras = incluirPercepcionesAduaneras
      ? round2(importaciones.filter((c) => c.esPercepcionAduanera)
          .reduce((acc, c) => acc + (Number(c.retencionesPercepciones) || 0), 0))
      : 0;

    const retencionesPercepcionesLocales = round2(
      [...ventas, ...compras, ...exportaciones]
        .reduce((acc, c) => acc + (Number(c.retencionesPercepciones) || 0), 0)
    );

    // --- 4. DETERMINACIÓN DEL SALDO (Art. 24) ---
    const subtotal = round2(debitoFiscal - creditoFiscalComputable);
    const saldoTecnicoResultante = round2(subtotal - Number(saldoTecnicoAnterior || 0));

    // El saldo técnico (1er párrafo) solo se "usa" para pagar si es positivo (a favor
    // del fisco). Si es negativo, es saldo a favor del contribuyente y se traslada
    // como saldoTecnicoAnterior del próximo período (no compensa retenciones/percepciones).
    const baseParaDescuentos = Math.max(0, saldoTecnicoResultante);

    const posicionFinal = round2(
      baseParaDescuentos
      - retencionesPercepcionesLocales
      - percepcionesAduaneras
      - Number(saldoLibreDisponibilidadAnterior || 0)
    );

    return {
      aplica: true,
      periodo,
      debitoFiscal,
      dfPorAlicuota,
      montoExportaciones,
      montoVentasGravadas,
      creditoFiscalComputable,
      cfComprasGenerales,
      cfImportacionesGenerales,
      cfGeneralComputable,
      cfVinculadoExpoDirecto,
      cfPorAlicuotaCompras,
      cfPorAlicuotaImpo,
      percepcionesAduaneras,
      retencionesPercepcionesLocales,
      subtotal,
      saldoTecnicoAnterior: round2(Number(saldoTecnicoAnterior || 0)),
      saldoTecnicoResultante,
      saldoLibreDisponibilidadAnterior: round2(Number(saldoLibreDisponibilidadAnterior || 0)),
      posicionFinal,
      esAFavor: posicionFinal < 0,
      cantidadComprobantes: delPeriodo.length,
      cantidadVentas: ventas.length,
      cantidadCompras: compras.length + importaciones.length,
      cantidadExportaciones: exportaciones.length
    };
  }

  window.TaxEngine = { liquidar, agruparPorAlicuota, filtrarPorPeriodo, esMonotributo, esExento, round2, ALICUOTAS_VALIDAS };
})();
