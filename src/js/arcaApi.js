/**
 * ArcaApi — consulta de CUIT contra el servidor local (server.js → ARCA).
 *
 * window.ArcaApi.consultarPadron(cuit) devuelve
 *   { cuit, razon, condicion, impuestos, domicilio, fuente, manual }
 *
 * Si ARCA no está configurado o el servidor no está corriendo (por ejemplo,
 * si se abrió index.html con doble clic), funciona en MODO MANUAL: valida el
 * CUIT y devuelve razon = 'CONTRIBUYENTE CUIT ...' para que app.js pida el
 * nombre a mano. Así la app nunca queda trabada.
 *
 * No agregar acá addEventListener sobre los botones de búsqueda: eso lo maneja
 * app.js (dos listeners sobre el mismo botón desincronizan el estado).
 */
window.ArcaApi = (function () {
  const MULT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

  function limpiar(cuit) {
    return String(cuit || '').replace(/\D/g, '');
  }

  function esCuitValido(cuit) {
    const c = limpiar(cuit);
    if (!/^\d{11}$/.test(c)) return false;
    const d = c.split('').map(Number);
    let v = 11 - (MULT.reduce((acc, m, i) => acc + m * d[i], 0) % 11);
    if (v === 11) v = 0;
    if (v === 10) return false;
    return v === d[10];
  }

  function formatear(cuit) {
    const c = limpiar(cuit);
    return `${c.substring(0, 2)}-${c.substring(2, 10)}-${c.substring(10)}`;
  }

  function condicionCorta(condicionARCA) {
    const c = String(condicionARCA || '');
    if (/monotributo/i.test(c)) return 'Monotributo';
    if (/inscripto/i.test(c)) return 'Resp. Inscripto';
    if (/exento/i.test(c)) return 'Exento';
    return 'Condición IVA a verificar';
  }

  function resultadoManual(cuitLimpio, motivo) {
    return {
      cuit: formatear(cuitLimpio),
      razon: `CONTRIBUYENTE CUIT ${formatear(cuitLimpio)}`,
      condicion: 'Resp. Inscripto',
      impuestos: [],
      domicilio: '',
      fuente: 'manual',
      manual: true,
      motivoManual: motivo
    };
  }

  const servidorDisponible = () => location.protocol === 'http:' || location.protocol === 'https:';

  async function fetchJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      let data = null;
      try { data = await resp.json(); } catch (e) { /* respuesta sin JSON */ }
      return { status: resp.status, data };
    } finally {
      clearTimeout(t);
    }
  }

  /** Estado de la conexión con ARCA: { configurado, environment, cuitEstudio, error? } */
  async function estado() {
    if (!servidorDisponible()) return { configurado: false, sinServidor: true };
    try {
      const { status, data } = await fetchJson('/api/estado', 5000);
      if (status === 200 && data) return data;
    } catch (e) { /* servidor no disponible */ }
    return { configurado: false, sinServidor: true };
  }

  async function consultarPadron(cuitBruto) {
    const cuitLimpio = limpiar(cuitBruto);
    if (cuitLimpio.length !== 11) throw new Error('Ingresá un CUIT de 11 dígitos.');
    if (!esCuitValido(cuitLimpio)) throw new Error(`El CUIT ${formatear(cuitLimpio)} no es válido (el dígito verificador no coincide).`);

    if (!servidorDisponible()) {
      return resultadoManual(cuitLimpio, 'La app se abrió sin el servidor (usá iniciar.bat para conectar con ARCA).');
    }

    const est = await estado();
    if (!est.configurado) {
      return resultadoManual(cuitLimpio, est.sinServidor
        ? 'La app no está conectada al servidor (abrila con iniciar.bat).'
        : (est.error || 'ARCA todavía no está configurado en esta PC.'));
    }

    let respuesta;
    try {
      respuesta = await fetchJson(`/api/padron/${cuitLimpio}`, 45000);
    } catch (e) {
      const motivo = e.name === 'AbortError' ? 'ARCA tardó demasiado en responder.' : 'No se pudo contactar al servidor local.';
      return resultadoManual(cuitLimpio, motivo);
    }

    const { status, data } = respuesta;
    if (status === 200 && data && data.persona) {
      const p = data.persona;
      return {
        cuit: formatear(p.cuit || cuitLimpio),
        razon: p.razonSocial || `CONTRIBUYENTE CUIT ${formatear(cuitLimpio)}`,
        condicion: condicionCorta(p.condicionIVA),
        condicionARCA: p.condicionIVA,
        impuestos: (p.impuestos || []).map((i) => i.descripcion).filter(Boolean),
        domicilio: p.domicilioFiscal ? p.domicilioFiscal.direccion : '',
        fuente: p.fuente || 'ARCA',
        manual: false
      };
    }
    if (status === 400) throw new Error((data && data.error) || 'CUIT inválido.');
    // ARCA caído, servicio no autorizado o CUIT inexistente: se sigue en modo manual
    // mostrando el motivo, para no trabar el trabajo.
    return resultadoManual(cuitLimpio, (data && data.error) || `ARCA no respondió (HTTP ${status}).`);
  }

  return { consultarPadron, estado, esCuitValido, formatear };
})();
