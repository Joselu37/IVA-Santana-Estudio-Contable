/**
 * ARCA Reconciler & Matching Engine
 * Cross-references local accounting vouchers with official ARCA "Mis Comprobantes" records.
 */

window.ArcaReconciler = (function() {
  /**
   * Reconciles local vouchers list against ARCA downloaded vouchers list.
   * @param {Array} sistemaVouchers - Vouchers in user system
   * @param {Array} arcaVouchers - Vouchers downloaded from ARCA
   */
  function reconcile(sistemaVouchers, arcaVouchers) {
    const results = [];
    let okCount = 0;
    let diffCount = 0;
    let missingCount = 0;

    // Helper key generator: CUIT-Tipo-Numero
    function makeKey(v) {
      const cuit = (v.cuit || '').replace(/\D/g, '');
      const num = (v.numero || '').replace(/\D/g, '');
      const tipo = (v.tipoDoc || '').toLowerCase().trim();
      return `${cuit}-${tipo}-${num}`;
    }

    const arcaMap = new Map();
    arcaVouchers.forEach(v => {
      arcaMap.set(makeKey(v), v);
    });

    const matchedArcaKeys = new Set();

    // 1. Process all local system vouchers
    sistemaVouchers.forEach(vSistema => {
      const key = makeKey(vSistema);
      const vArca = arcaMap.get(key);

      if (vArca) {
        matchedArcaKeys.add(key);
        const montoSystem = (vSistema.neto * (1 + (vSistema.alicuota || 0) / 100)) + (vSistema.retenciones || 0);
        const montoArca = (vArca.neto * (1 + (vArca.alicuota || 0) / 100)) + (vArca.retenciones || 0);

        const diffMonto = Math.abs(montoSystem - montoArca);

        if (diffMonto < 1.0) {
          // OK Match
          okCount++;
          results.push({
            status: 'COINCIDE_OK',
            badgeClass: 'badge-status st-favor',
            badgeText: '🟢 Coincide 100%',
            comprobante: `${vSistema.tipoDoc} ${vSistema.numero}`,
            cuitContraparte: vSistema.cuit,
            montoSistema: montoSystem,
            montoArca: montoArca,
            diferenciaIva: 0,
            categoria: vSistema.tipoOp,
            diagnostico: 'Comprobante validado correctamente contra los registros oficiales de ARCA.',
            vSistema,
            vArca
          });
        } else {
          // Difference in amount or rate
          diffCount++;
          const diffIva = Math.abs(((vSistema.neto * vSistema.alicuota) / 100) - ((vArca.neto * vArca.alicuota) / 100));
          results.push({
            status: 'DIFERENCIA_MONTO',
            badgeClass: 'badge-status st-pagar',
            badgeText: '🟡 Diferencia de Monto',
            comprobante: `${vSistema.tipoDoc} ${vSistema.numero}`,
            cuitContraparte: vSistema.cuit,
            montoSistema: montoSystem,
            montoArca: montoArca,
            diferenciaIva: diffIva,
            categoria: vSistema.tipoOp,
            diagnostico: `Diferencia de $${diffMonto.toFixed(2)} detected. Verificar alícuota o tipeo en comprobante.`,
            vSistema,
            vArca
          });
        }
      } else {
        // Missing in ARCA / Solo en Sistema
        missingCount++;
        const montoSystem = (vSistema.neto * (1 + (vSistema.alicuota || 0) / 100)) + (vSistema.retenciones || 0);
        results.push({
          status: 'SOLO_EN_SISTEMA',
          badgeClass: 'badge-status st-pagar',
          badgeText: '🔴 No figura en ARCA',
          comprobante: `${vSistema.tipoDoc} ${vSistema.numero}`,
          cuitContraparte: vSistema.cuit,
          montoSistema: montoSystem,
          montoArca: 0,
          diferenciaIva: (vSistema.neto * vSistema.alicuota) / 100,
          categoria: vSistema.tipoOp,
          diagnostico: 'Advertencia: Registrado localmente pero ausente en "Mis Comprobantes ARCA". Verificar si fue anulado.',
          vSistema,
          vArca: null
        });
      }
    });

    // 2. Vouchers present only in ARCA
    arcaVouchers.forEach(vArca => {
      const key = makeKey(vArca);
      if (!matchedArcaKeys.has(key)) {
        missingCount++;
        const montoArca = (vArca.neto * (1 + (vArca.alicuota || 0) / 100)) + (vArca.retenciones || 0);
        results.push({
          status: 'SOLO_EN_ARCA',
          badgeClass: 'badge-status st-pagar',
          badgeText: '🔵 Solo en ARCA',
          comprobante: `${vArca.tipoDoc} ${vArca.numero}`,
          cuitContraparte: vArca.cuit,
          montoSistema: 0,
          montoArca: montoArca,
          diferenciaIva: (vArca.neto * vArca.alicuota) / 100,
          categoria: vArca.tipoOp,
          diagnostico: 'Comprobante emitido/recibido en ARCA no ingresado aún al libro IVA local. Presionar "+" para incorporar.',
          vSistema: null,
          vArca
        });
      }
    });

    return {
      results,
      okCount,
      diffCount,
      missingCount
    };
  }

  return {
    reconcile
  };
})();
