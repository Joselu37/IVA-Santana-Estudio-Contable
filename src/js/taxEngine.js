/**
 * Motor de liquidación de IVA (Responsables Inscriptos y Sociedades).
 * Mercado interno, Exportaciones (Art. 43), Importaciones (despachos / RG 5339),
 * Prorrateo Art. 13 y Saldos Art. 24.
 *
 * Función pura: recibe comprobantes y parámetros y devuelve números.
 * No toca la pantalla ni modifica los comprobantes que recibe.
 *
 * Tipos de operación (tipoOp):
 *   venta | exportacion | compra | importacion | retencion
 * Los registros "retencion" son retenciones/percepciones sufridas cargadas desde
 * "Mis Retenciones" (clase: 'retencion' | 'percepcion' | 'aduanera').
 *
 * Notas de crédito: igual que el Libro IVA Digital, no se restan de su propio
 * total sino que se suman del otro lado:
 *  - NC recibidas (compras) → "Restitución de crédito fiscal": suman al Débito Fiscal
 *  - NC emitidas (ventas)   → "Restitución de débito fiscal": suman al Crédito Fiscal
 * El saldo final es el mismo, pero así los totales coinciden con los de ARCA.
 */
(function (root) {
  const ALICUOTAS = [0, 2.5, 5, 10.5, 21, 27];

  function num(v) {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function redondear(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /** Alícuota estándar más cercana (0, 2.5, 5, 10.5, 21, 27). */
  function alicuotaNormalizada(alicuota) {
    const a = num(alicuota);
    return ALICUOTAS.reduce((mejor, x) => (Math.abs(x - a) < Math.abs(mejor - a) ? x : mejor), ALICUOTAS[0]);
  }

  /** Clase del comprobante por su nombre ("Factura C", "11 - Factura C", "Nota de Crédito B"...). */
  function claseComprobante(comp) {
    const t = String(comp.tipoDoc || '').replace(/\s*\(.*\)\s*$/, '').trim();
    const m = t.match(/\b([ABCEM])$/);
    return m ? m[1] : '';
  }

  /** Certificados de retención / constancias de percepción cargados como compra: no son facturas. */
  function esPagoACuentaCargadoComoCompra(comp) {
    const t = String(comp.tipoDoc || '');
    return /retenci|percepci|certificado|constancia|sircer/i.test(t) && !/factura|nota de|despacho/i.test(t);
  }

  /** ¿Este comprobante no genera débito/crédito fiscal? */
  function sinIVA(comp) {
    if (!comp) return true;
    if (comp.tipoOp === 'exportacion' || comp.tipoOp === 'retencion') return true;
    const clase = claseComprobante(comp);
    if (comp.tipoOp === 'venta' && clase === 'C') return true; // Factura C no lleva débito
    if (comp.tipoOp === 'compra' && (clase === 'B' || clase === 'C' || esPagoACuentaCargadoComoCompra(comp))) return true;
    return false;
  }

  /** IVA informado en el comprobante (null si no vino el dato). Un 0 informado se respeta. */
  function ivaInformado(comp) {
    const campo = comp.tipoOp === 'venta' ? 'df' : 'cf';
    const v = comp[campo] !== undefined && comp[campo] !== null && comp[campo] !== '' ? comp[campo] : comp.iva;
    if (v === undefined || v === null || v === '') return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  /**
   * IVA de un comprobante: el informado o, si no vino (carga manual / plantilla),
   * neto × alícuota. Respeta el signo (notas de crédito).
   */
  function ivaDe(comp) {
    if (sinIVA(comp)) return 0;
    const inf = ivaInformado(comp);
    if (inf !== null) return inf;
    return (num(comp.neto) * num(comp.alicuota)) / 100;
  }

  /** Alícuota efectiva: la informada, o la deducida de IVA/neto si no vino. */
  function alicuotaDe(comp) {
    if (sinIVA(comp) && comp.tipoOp !== 'exportacion') return 0;
    const a = num(comp.alicuota);
    if (a > 0) return alicuotaNormalizada(a);
    const neto = num(comp.neto);
    const iva = ivaDe(comp);
    if (neto !== 0 && iva !== 0) return alicuotaNormalizada((iva / neto) * 100);
    return 0;
  }

  function bucketsVacios() {
    const b = {};
    ALICUOTAS.forEach((a) => { b[a] = 0; });
    return b;
  }

  /**
   * @param {Array} comprobantes
   * @param {Object} params { stAnterior, sldAnterior, prorrateoPct, incluirImpo, incluirPercepAduaneras, solicitarArt43 }
   */
  function calculateIVA(comprobantes, params = {}) {
    const prorrateoPct = (params.prorrateoPct !== undefined ? num(params.prorrateoPct) : 100) / 100;
    const stAnterior = num(params.stAnterior);
    const sldAnterior = num(params.sldAnterior);
    const incluirImpo = params.incluirImpo !== false;
    const incluirPercepAduaneras = params.incluirPercepAduaneras !== false;
    const solicitarArt43 = params.solicitarArt43 !== false;

    let dfNetoTotal = 0;
    let dfPositivo = 0, restitucionDF = 0; // ventas (NC emitidas = restitución de débito)
    const dfPorAlicuota = bucketsVacios(), dfNetoPorAlicuota = bucketsVacios();

    let expoNetoTotal = 0;

    let cfNetoTotal = 0; // solo compras locales
    let cfPositivo = 0, restitucionCF = 0; // compras (NC recibidas = restitución de crédito)
    const cfPorAlicuota = bucketsVacios(), cfNetoPorAlicuota = bucketsVacios();

    let impoNetoTotal = 0, impoIVATotal = 0;
    let percepAduanerasTotal = 0;
    let retencionesLocales = 0, percepcionesLocales = 0;

    (comprobantes || []).forEach((comp) => {
      const neto = num(comp.neto);
      const retPercep = num(comp.retenciones);
      const esAduanera = comp.esAduanera === 'si' || comp.esAduanera === true;

      switch (comp.tipoOp) {
        case 'venta': {
          const iva = ivaDe(comp);
          const a = alicuotaDe(comp);
          dfNetoTotal += neto;
          if (iva >= 0) dfPositivo += iva; else restitucionDF += -iva;
          dfPorAlicuota[a] += iva;
          dfNetoPorAlicuota[a] += neto;
          // Retenciones de IVA sufridas al cobrar esta venta.
          retencionesLocales += retPercep;
          break;
        }
        case 'exportacion':
          expoNetoTotal += neto;
          retencionesLocales += retPercep;
          break;
        case 'compra': {
          const iva = ivaDe(comp);
          const a = alicuotaDe(comp);
          cfNetoTotal += neto;
          if (iva >= 0) cfPositivo += iva; else restitucionCF += -iva;
          cfPorAlicuota[a] += iva;
          cfNetoPorAlicuota[a] += neto;
          // Percepciones de IVA sufridas en la factura de compra.
          percepcionesLocales += retPercep;
          break;
        }
        case 'importacion':
          if (incluirImpo) {
            impoNetoTotal += neto;
            impoIVATotal += ivaDe(comp);
          }
          if (esAduanera) {
            if (incluirPercepAduaneras) percepAduanerasTotal += retPercep;
          } else {
            percepcionesLocales += retPercep;
          }
          break;
        case 'retencion': {
          const clase = comp.clase || (esAduanera ? 'aduanera' : 'retencion');
          if (clase === 'aduanera') {
            if (incluirPercepAduaneras) percepAduanerasTotal += retPercep;
          } else if (clase === 'percepcion') {
            percepcionesLocales += retPercep;
          } else {
            retencionesLocales += retPercep;
          }
          break;
        }
        default:
          break;
      }
    });

    // Débito fiscal total: ventas + restitución de crédito (NC recibidas).
    const dfTotal = dfPositivo + restitucionCF;
    const cfTotalBruto = cfPositivo - restitucionCF;

    // Prorrateo Art. 13: alcanza al crédito de compras locales e importaciones.
    // Las restituciones de débito (NC emitidas) se computan completas.
    const cfImpoComputable = incluirImpo ? impoIVATotal : 0;
    const cfComputableTotal = (cfPositivo + cfImpoComputable) * prorrateoPct + restitucionDF;

    // Art. 43: proporción del crédito vinculada a exportaciones (informativo).
    const ventasTotales = dfNetoTotal + expoNetoTotal;
    const coefExportacion = ventasTotales > 0 ? expoNetoTotal / ventasTotales : 0;
    const cfVinculadoExportacion = solicitarArt43 ? cfComputableTotal * coefExportacion : 0;

    // Primer párrafo Art. 24: saldo técnico.
    const subtotalDebitoCredito = dfTotal - cfComputableTotal;
    const saldoTecnicoNeto = subtotalDebitoCredito - stAnterior;
    const saldoTecnicoResultante = saldoTecnicoNeto < 0 ? -saldoTecnicoNeto : 0;
    const remanenteADisponer = saldoTecnicoNeto > 0 ? saldoTecnicoNeto : 0;

    // Segundo párrafo Art. 24: pagos a cuenta y saldo de libre disponibilidad.
    const totalPagosACuenta = retencionesLocales + percepcionesLocales + percepAduanerasTotal + sldAnterior;
    const netFinal = remanenteADisponer - totalPagosACuenta;
    const impuestoAPagar = netFinal > 0 ? netFinal : 0;
    const saldoLibreDisponibilidadResultante = netFinal < 0 ? -netFinal : 0;

    const r = redondear;
    const rb = (b) => { const o = {}; Object.keys(b).forEach((k) => { o[k] = r(b[k]); }); return o; };

    return {
      dfTotal: r(dfTotal),
      dfNetoTotal: r(dfNetoTotal),
      dfPorAlicuota: rb(dfPorAlicuota),
      dfNetoPorAlicuota: rb(dfNetoPorAlicuota),
      expoNetoTotal: r(expoNetoTotal),
      cfTotalBruto: r(cfTotalBruto),
      cfNetoTotal: r(cfNetoTotal),
      cfPorAlicuota: rb(cfPorAlicuota),
      cfNetoPorAlicuota: rb(cfNetoPorAlicuota),
      cfComputableTotal: r(cfComputableTotal),
      cfVinculadoExportacion: r(cfVinculadoExportacion),
      dfPositivo: r(dfPositivo),
      cfPositivo: r(cfPositivo),
      restitucionDF: r(restitucionDF),
      restitucionCF: r(restitucionCF),
      coefExportacion,
      impoNetoTotal: r(impoNetoTotal),
      impoIVATotal: r(impoIVATotal),
      percepAduanerasTotal: r(percepAduanerasTotal),
      retencionesLocales: r(retencionesLocales),
      percepcionesLocales: r(percepcionesLocales),
      subtotalDebitoCredito: r(subtotalDebitoCredito),
      stAnterior: r(stAnterior),
      saldoTecnicoResultante: r(saldoTecnicoResultante),
      sldAnterior: r(sldAnterior),
      totalPagosACuenta: r(totalPagosACuenta),
      impuestoAPagar: r(impuestoAPagar),
      saldoLibreDisponibilidadResultante: r(saldoLibreDisponibilidadResultante)
    };
  }

  root.TaxEngine = { calculateIVA, ivaDe, alicuotaDe, alicuotaNormalizada, claseComprobante, sinIVA, ALICUOTAS };
})(typeof window !== 'undefined' ? window : globalThis);
