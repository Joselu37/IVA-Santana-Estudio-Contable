/**
 * Conciliador: cruza los comprobantes de tus libros (sistema) contra los de
 * "Mis Comprobantes" de ARCA.
 *
 * Un mismo comprobante puede venir partido en varias filas (una por alícuota),
 * así que primero se agrupa por CUIT + tipo + número y recién después se
 * comparan neto e IVA por separado.
 */
(function (root) {
  const TOLERANCIA = 1.0; // pesos

  function num(v) {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function ivaDe(v) {
    if (root.TaxEngine && root.TaxEngine.ivaDe) return root.TaxEngine.ivaDe(v);
    return (num(v.neto) * num(v.alicuota)) / 100;
  }

  function makeKey(v) {
    const cuit = String(v.cuit || '').replace(/\D/g, '');
    const num = String(v.numero || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const tipo = String(v.tipoDoc || '').toLowerCase().replace(/\s*\(.*\)\s*$/, '').trim();
    return `${v.tipoOp || ''}|${cuit}|${tipo}|${num}`;
  }

  function agrupar(lista) {
    const mapa = new Map();
    (lista || []).forEach((v) => {
      const key = makeKey(v);
      let g = mapa.get(key);
      if (!g) {
        g = { key, primero: v, filas: [], neto: 0, iva: 0, retenciones: 0 };
        mapa.set(key, g);
      }
      g.filas.push(v);
      g.neto += num(v.neto);
      g.iva += ivaDe(v);
      g.retenciones += num(v.retenciones);
    });
    return mapa;
  }

  const total = (g) => g.neto + g.iva + g.retenciones;
  const fmt = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function resultado(status, g, montoSistema, montoArca, diferenciaIva, diagnostico) {
    const v = g.primero;
    const badges = {
      COINCIDE_OK: ['badge-status st-favor', '🟢 Coincide'],
      DIFERENCIA_MONTO: ['badge-status st-pagar', '🟡 Diferencia de monto'],
      SOLO_EN_SISTEMA: ['badge-status st-pagar', '🔴 No figura en ARCA'],
      SOLO_EN_ARCA: ['badge-status st-pagar', '🔵 Solo en ARCA']
    };
    return {
      key: g.key,
      status,
      badgeClass: badges[status][0],
      badgeText: badges[status][1],
      comprobante: `${v.tipoDoc} ${v.numero}`,
      cuitContraparte: v.cuit,
      montoSistema,
      montoArca,
      diferenciaIva,
      categoria: v.tipoOp,
      diagnostico
    };
  }

  /**
   * @param {Array} sistemaVouchers - comprobantes de tus libros
   * @param {Array} arcaVouchers - comprobantes de ARCA
   */
  function reconcile(sistemaVouchers, arcaVouchers) {
    const sistema = agrupar(sistemaVouchers);
    const arca = agrupar(arcaVouchers);
    const results = [];
    let okCount = 0, diffCount = 0, missingCount = 0;

    sistema.forEach((gs, key) => {
      const ga = arca.get(key);
      if (!ga) {
        missingCount++;
        results.push(resultado('SOLO_EN_SISTEMA', gs, total(gs), 0, Math.abs(gs.iva),
          'Está en tus libros pero no en "Mis Comprobantes" de ARCA. Verificá si fue anulado o mal cargado.'));
        return;
      }
      const difNeto = gs.neto - ga.neto;
      const difIva = gs.iva - ga.iva;
      const difRet = gs.retenciones - ga.retenciones;
      if (Math.abs(difNeto) < TOLERANCIA && Math.abs(difIva) < TOLERANCIA && Math.abs(difRet) < TOLERANCIA) {
        okCount++;
        results.push(resultado('COINCIDE_OK', gs, total(gs), total(ga), 0,
          'Comprobante validado contra los registros de ARCA.'));
      } else {
        diffCount++;
        const partes = [];
        if (Math.abs(difNeto) >= TOLERANCIA) partes.push(`neto $${fmt(difNeto)}`);
        if (Math.abs(difIva) >= TOLERANCIA) partes.push(`IVA $${fmt(difIva)}`);
        if (Math.abs(difRet) >= TOLERANCIA) partes.push(`ret./percep. $${fmt(difRet)}`);
        results.push(resultado('DIFERENCIA_MONTO', gs, total(gs), total(ga), Math.abs(difIva),
          `Diferencia (libros − ARCA): ${partes.join(', ')}. Verificá alícuota o tipeo.`));
      }
    });

    arca.forEach((ga, key) => {
      if (sistema.has(key)) return;
      missingCount++;
      results.push(resultado('SOLO_EN_ARCA', ga, 0, total(ga), Math.abs(ga.iva),
        'Figura en ARCA pero no está en tus libros. Tocá "+ Incorporar" para agregarlo.'));
    });

    return { results, okCount, diffCount, missingCount };
  }

  /** Filas de ARCA que corresponden a una clave (para "Incorporar a libros"). */
  function filasArcaPorClave(arcaVouchers, key) {
    return (arcaVouchers || []).filter((v) => makeKey(v) === key);
  }

  root.ArcaReconciler = { reconcile, makeKey, filasArcaPorClave };
})(typeof window !== 'undefined' ? window : globalThis);
