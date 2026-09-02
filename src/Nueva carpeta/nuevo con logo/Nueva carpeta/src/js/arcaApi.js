/**
 * arcaApi.js
 * Conecta los botones "Buscar CUIT en ARCA" / "Consultar ARCA" del index.html
 * con el endpoint del backend (/api/padron/:cuit), que a su vez habla con
 * el webservice de Padrón A13 de ARCA (WSAA + ws_sr_padron_a13).
 *
 * Expone window.ArcaApi.consultarCuit(cuit) para que taxEngine.js / app.js
 * puedan reusarlo al procesar comprobantes.
 */
(function () {
  'use strict';

  function limpiarCuit(cuit) {
    return String(cuit || '').replace(/[^0-9]/g, '');
  }

  async function consultarCuit(cuit, cuitRepresentada) {
    const cuitLimpio = limpiarCuit(cuit);
    if (cuitLimpio.length !== 11) {
      throw new Error('El CUIT debe tener 11 dígitos.');
    }

    // cuitRepresentada = a nombre de qué cliente del estudio se hace la consulta
    // (el CUIT que autorizó al estudio como apoderado del servicio de Padrón).
    // Si no se pasa, el backend asume que se representa a sí mismo (cuitLimpio).
    const qs = cuitRepresentada ? `?representada=${limpiarCuit(cuitRepresentada)}` : '';
    const resp = await fetch(`/api/padron/${cuitLimpio}${qs}`);
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || `Error consultando ARCA (HTTP ${resp.status})`);
    }
    return data.persona;
  }

  function formatCuit(cuit) {
    const c = limpiarCuit(cuit);
    if (c.length !== 11) return cuit;
    return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
  }

  function setLoading(button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.dataset.originalHtml = button.dataset.originalHtml || button.innerHTML;
    button.innerHTML = loading
      ? '<i class="ri-loader-4-line ri-spin"></i> Consultando ARCA...'
      : button.dataset.originalHtml;
  }

  function mostrarError(mensaje) {
    // Reemplazar por el sistema de notificaciones del liquidador si existe (app.js / toast, etc.)
    if (window.mostrarToast) {
      window.mostrarToast(mensaje, 'error');
    } else {
      alert(mensaje);
    }
  }

  function actualizarHeaderYConfig(persona) {
    const razonHeader = document.getElementById('header-razon-social');
    const cuitHeader = document.getElementById('header-cuit');
    const razonCfg = document.getElementById('cfg-razon');
    const cuitCfg = document.getElementById('cfg-cuit');

    if (razonHeader) razonHeader.textContent = persona.razonSocial || '(sin razón social)';
    if (cuitHeader) {
      cuitHeader.textContent = `CUIT: ${formatCuit(persona.cuit)} | ${persona.condicionIVA}`;
    }
    if (razonCfg) razonCfg.value = persona.razonSocial || '';
    if (cuitCfg) cuitCfg.value = formatCuit(persona.cuit);

    // Otros módulos (taxEngine.js, app.js) pueden escuchar este evento para
    // ajustar cómo se liquida el IVA según la condición del contribuyente
    // (Resp. Inscripto / Monotributo / Exento, etc.)
    document.dispatchEvent(new CustomEvent('arca:persona-actualizada', { detail: persona }));
  }

  async function onBuscarClick(inputEl, buttonEl) {
    const cuit = inputEl ? inputEl.value : null;
    if (!cuit) {
      mostrarError('Ingresá un CUIT para consultar.');
      return;
    }

    setLoading(buttonEl, true);
    try {
      const persona = await consultarCuit(cuit);
      actualizarHeaderYConfig(persona);
    } catch (e) {
      mostrarError(e.message);
    } finally {
      setLoading(buttonEl, false);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const quickInput = document.getElementById('quick-cuit-input');
    const quickBtn = document.getElementById('btn-quick-buscar-cuit');
    if (quickBtn) {
      quickBtn.addEventListener('click', () => onBuscarClick(quickInput, quickBtn));
    }

    const cfgInput = document.getElementById('cfg-cuit');
    const cfgBtn = document.getElementById('btn-cfg-buscar-padron');
    if (cfgBtn) {
      cfgBtn.addEventListener('click', () => onBuscarClick(cfgInput, cfgBtn));
    }
  });

  window.ArcaApi = { consultarCuit, formatCuit };
})();
