/**
 * Tax Engine for Argentine VAT (IVA) Settlement
 * Supports Responsables Inscriptos & Sociedades
 * Handles Mercado Interno, Exportaciones (Art. 43), Importaciones (Despachos SIM / RG 5339),
 * Prorrateo Art. 13, and Saldos Art. 24.
 */

window.TaxEngine = (function() {
  /**
   * Calculates full VAT status given a list of comprobantes and taxpayer parameters.
   * @param {Array} comprobantes - List of invoices/despachos
   * @param {Object} params - { stAnterior, sldAnterior, prorrateoPct, incluirImpo, incluirPercepAduaneras, solicitarArt43 }
   */
  function calculateIVA(comprobantes, params = {}) {
    const prorrateoPct = (params.prorrateoPct !== undefined ? params.prorrateoPct : 100) / 100;
    const stAnterior = parseFloat(params.stAnterior) || 0;
    const sldAnterior = parseFloat(params.sldAnterior) || 0;
    const incluirImpo = params.incluirImpo !== false;
    const incluirPercepAduaneras = params.incluirPercepAduaneras !== false;
    const solicitarArt43 = params.solicitarArt43 !== false;

    // Totales Débito Fiscal (Ventas)
    let dfTotal = 0;
    let dfNetoTotal = 0;
    let dfPorAlicuota = { 21: 0, 10.5: 0, 27: 0, 5: 0, 2.5: 0 };
    let dfNetoPorAlicuota = { 21: 0, 10.5: 0, 27: 0, 5: 0, 2.5: 0 };
    
    // Ventas Exportación (Factura E)
    let expoNetoTotal = 0;

    // Totales Crédito Fiscal (Compras)
    let cfTotalBruto = 0;
    let cfNetoTotal = 0;
    let cfPorAlicuota = { 21: 0, 10.5: 0, 27: 0, 5: 0, 2.5: 0 };
    let cfNetoPorAlicuota = { 21: 0, 10.5: 0, 27: 0, 5: 0, 2.5: 0 };

    // Importaciones (Despachos Aduana)
    let impoNetoTotal = 0;
    let impoIVATotal = 0;
    let percepAduanerasTotal = 0; // RG 5339 / RG 2281

    // Retenciones & Percepciones Sufrientes (Locales)
    let retencionesLocales = 0;
    let percepcionesLocales = 0;

    // Iterar comprobantes
    comprobantes.forEach(comp => {
      const neto = parseFloat(comp.neto) || 0;
      let alicuota = parseFloat(comp.alicuota) || 0;
      const retPercep = parseFloat(comp.retenciones) || 0;
      const esAduanera = comp.esAduanera === 'si' || comp.esAduanera === true;

      // 1. VENTAS (Mercado Interno)
      if (comp.tipoOp === 'venta') {
        dfNetoTotal += neto;
        
        let dfComp = parseFloat(comp.df || comp.iva) || 0;
        if (dfComp === 0 && neto > 0 && alicuota > 0) {
          dfComp = (neto * alicuota) / 100;
        } else if (dfComp > 0 && neto > 0 && alicuota === 0) {
          alicuota = Math.round((dfComp / neto) * 100 * 10) / 10;
          comp.alicuota = alicuota;
        }

        dfTotal += dfComp;

        // Clasificación por alícuota en tabla
        const aliKey = [21, 10.5, 27, 5, 2.5].find(a => Math.abs(a - alicuota) < 1) || 21;
        dfPorAlicuota[aliKey] = (dfPorAlicuota[aliKey] || 0) + dfComp;
        dfNetoPorAlicuota[aliKey] = (dfNetoPorAlicuota[aliKey] || 0) + neto;
      } 
      // 2. EXPORTACIONES (Factura E)
      else if (comp.tipoOp === 'exportacion') {
        expoNetoTotal += neto;
        // Alícuota 0% en exportación
      }
      // 3. COMPRAS LOCALES
      else if (comp.tipoOp === 'compra') {
        cfNetoTotal += neto;
        
        let cfComp = parseFloat(comp.cf || comp.iva) || 0;
        if (cfComp === 0 && neto > 0 && alicuota > 0) {
          cfComp = (neto * alicuota) / 100;
        } else if (cfComp > 0 && neto > 0 && alicuota === 0) {
          alicuota = Math.round((cfComp / neto) * 100 * 10) / 10;
          comp.alicuota = alicuota;
        }

        cfTotalBruto += cfComp;

        const aliKey = [21, 10.5, 27, 5, 2.5].find(a => Math.abs(a - alicuota) < 1) || 21;
        cfPorAlicuota[aliKey] = (cfPorAlicuota[aliKey] || 0) + cfComp;
        cfNetoPorAlicuota[aliKey] = (cfNetoPorAlicuota[aliKey] || 0) + neto;

        if (retPercep > 0) {
          percepcionesLocales += retPercep;
        }
      }
      // 4. DESPACHOS DE IMPORTACIÓN (Aduana)
      else if (comp.tipoOp === 'importacion') {
        if (incluirImpo) {
          impoNetoTotal += neto;
          let impoIVA = parseFloat(comp.cf || comp.iva) || 0;
          if (impoIVA === 0 && neto > 0 && alicuota > 0) {
            impoIVA = (neto * alicuota) / 100;
          }
          impoIVATotal += impoIVA;
          cfNetoTotal += neto;
        }
        if (retPercep > 0) {
          if (esAduanera) {
            if (incluirPercepAduaneras) {
              percepAduanerasTotal += retPercep;
            }
          } else {
            percepcionesLocales += retPercep;
          }
        }
      }
    });

    // Cómputo Crédito Fiscal con Prorrateo Art. 13
    const cfComputableLocales = cfTotalBruto * prorrateoPct;
    const cfComputableTotal = cfComputableLocales + (incluirImpo ? impoIVATotal : 0);

    // Recupero de IVA Exportador (Art. 43)
    const ventasTotales = dfNetoTotal + expoNetoTotal;
    let coefExportacion = 0;
    if (ventasTotales > 0) {
      coefExportacion = expoNetoTotal / ventasTotales;
    }
    const cfVinculadoExportacion = solicitarArt43 ? (cfComputableTotal * coefExportacion) : 0;

    // Subtotal Débito vs Crédito
    const subtotalDebitoCredito = dfTotal - cfComputableTotal;

    // Determinación de Saldo Técnico (1er Párrafo Art. 24)
    let saldoTecnicoNeto = subtotalDebitoCredito - stAnterior;
    let saldoTecnicoResultante = 0;
    let remanenteADisponer = 0;

    if (saldoTecnicoNeto < 0) {
      saldoTecnicoResultante = Math.abs(saldoTecnicoNeto);
      remanenteADisponer = 0;
    } else {
      saldoTecnicoResultante = 0;
      remanenteADisponer = saldoTecnicoNeto;
    }

    // Retenciones y Percepciones totales
    const totalPagosACuenta = retencionesLocales + percepcionesLocales + percepAduanerasTotal + sldAnterior;

    // Posición Definitiva (2do Párrafo Art. 24)
    let impuestoAPagar = 0;
    let saldoLibreDisponibilidadResultante = 0;

    if (remanenteADisponer > 0) {
      const netFinal = remanenteADisponer - totalPagosACuenta;
      if (netFinal > 0) {
        impuestoAPagar = netFinal;
        saldoLibreDisponibilidadResultante = 0;
      } else {
        impuestoAPagar = 0;
        saldoLibreDisponibilidadResultante = Math.abs(netFinal);
      }
    } else {
      impuestoAPagar = 0;
      saldoLibreDisponibilidadResultante = totalPagosACuenta;
    }

    return {
      dfTotal,
      dfNetoTotal,
      dfPorAlicuota,
      dfNetoPorAlicuota,
      expoNetoTotal,
      cfTotalBruto,
      cfNetoTotal,
      cfComputableTotal,
      cfVinculadoExportacion,
      coefExportacion,
      impoNetoTotal,
      impoIVATotal,
      percepAduanerasTotal,
      retencionesLocales,
      percepcionesLocales,
      subtotalDebitoCredito,
      stAnterior,
      saldoTecnicoResultante,
      sldAnterior,
      totalPagosACuenta,
      impuestoAPagar,
      saldoLibreDisponibilidadResultante
    };
  }

  return {
    calculateIVA
  };
})();
