/**
 * app.js
 * Orquestador de la SPA. Maneja estado por contribuyente (localStorage),
 * navegación entre tabs, modales, y dispara los recálculos de taxEngine
 * cada vez que cambian los comprobantes o los parámetros del simulador.
 */
(function () {
  'use strict';

  const STORAGE_PREFIX = 'liquidador_iva_';
  const STORAGE_ACTIVO = 'liquidador_iva_activo';

  const state = {
    cuit: null,
    config: {
      razonSocial: '', tipoPersona: 'JURIDICA', condicionIVA: 'IVA Responsable Inscripto',
      periodo: new Date().toISOString().slice(0, 7),
      saldoTecnicoAnterior: 0, saldoLibreDisponibilidadAnterior: 0
    },
    comprobantes: [],
    editandoId: null,
    ultimaLiquidacion: null
  };

  // ---------- Persistencia ----------
  function claveStorage(cuit) { return `${STORAGE_PREFIX}${cuit}`; }

  function guardar() {
    if (!state.cuit) return;
    try {
      localStorage.setItem(claveStorage(state.cuit), JSON.stringify({
        config: state.config, comprobantes: state.comprobantes
      }));
      localStorage.setItem(STORAGE_ACTIVO, state.cuit);
    } catch (e) {
      console.error('No se pudo guardar en localStorage', e);
      mostrarToast('No se pudo guardar (¿localStorage lleno o deshabilitado?). Descargá un backup como respaldo.', 'error');
    }
  }

  function sanitizarComprobantes(lista) {
    if (!Array.isArray(lista)) return [];
    const validos = [];
    let descartados = 0;
    lista.forEach((c) => {
      if (c && typeof c === 'object' && c.id && c.cuit && c.tipoOperacion && !isNaN(Number(c.neto))) {
        validos.push({
          ...c,
          razonSocial: c.razonSocial || '',
          tipoDoc: c.tipoDoc || '',
          numero: c.numero || '',
          fecha: c.fecha || '',
          alicuota: isNaN(Number(c.alicuota)) ? 21 : Number(c.alicuota),
          retencionesPercepciones: Number(c.retencionesPercepciones) || 0
        });
      } else {
        descartados++;
      }
    });
    if (descartados > 0) {
      console.warn(`Se descartaron ${descartados} comprobante(s) corruptos al cargar (les faltaba CUIT, tipo de operación o el monto no era un número).`);
    }
    return validos;
  }

  function cargar(cuit) {
    const raw = localStorage.getItem(claveStorage(cuit));
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return { config: data.config, comprobantes: sanitizarComprobantes(data.comprobantes) };
    } catch (e) { return null; }
  }

  function listarContribuyentesGuardados() {
    const lista = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX) && key !== STORAGE_ACTIVO) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          lista.push({ cuit: key.slice(STORAGE_PREFIX.length), razonSocial: data?.config?.razonSocial || '(sin nombre)' });
        } catch (e) { /* ignorar entradas corruptas */ }
      }
    }
    return lista;
  }

  // ---------- Toast simple ----------
  function mostrarToast(mensaje, tipo = 'info') {
    let cont = document.getElementById('toast-container');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'toast-container';
      document.body.appendChild(cont);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    el.textContent = mensaje;
    cont.appendChild(el);
    setTimeout(() => el.classList.add('visible'), 10);
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 4500);
  }
  window.mostrarToast = mostrarToast;

  // ---------- Formato ----------
  function money(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
  }
  function formatCuit(cuit) {
    const c = String(cuit || '').replace(/[^0-9]/g, '');
    return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : cuit;
  }

  // ---------- Selección de contribuyente ----------
  function seleccionarContribuyente(cuit, datosIniciales) {
    state.cuit = String(cuit).replace(/[^0-9]/g, '');
    const guardado = cargar(state.cuit);
    if (guardado) {
      state.config = { ...state.config, ...guardado.config };
      state.comprobantes = guardado.comprobantes || [];
    } else if (datosIniciales) {
      state.config = { ...state.config, ...datosIniciales };
      state.comprobantes = [];
    } else {
      state.comprobantes = [];
    }
    guardar();
    poblarSelectorContribuyentes();
    aplicarConfigAUI();
    renderTodo();
  }

  function poblarSelectorContribuyentes() {
    const sel = document.getElementById('select-contribuyente-guardado');
    if (!sel) return;
    const lista = listarContribuyentesGuardados();
    sel.innerHTML = '<option value="">Cambiar contribuyente guardado...</option>' +
      lista.map((c) => `<option value="${c.cuit}" ${c.cuit === state.cuit ? 'selected' : ''}>${formatCuit(c.cuit)} — ${c.razonSocial}</option>`).join('');
  }

  function aplicarConfigAUI() {
    const razonHeader = document.getElementById('header-razon-social');
    const cuitHeader = document.getElementById('header-cuit');
    if (razonHeader) razonHeader.textContent = state.config.razonSocial || '(sin razón social)';
    if (cuitHeader) cuitHeader.textContent = `CUIT: ${formatCuit(state.cuit)} | ${state.config.condicionIVA}`;

    const map = {
      'cfg-cuit': formatCuit(state.cuit), 'cfg-razon': state.config.razonSocial,
      'cfg-tipo-persona': state.config.tipoPersona, 'cfg-condicion-iva': state.config.condicionIVA,
      'cfg-periodo': state.config.periodo,
      'cfg-st-anterior': state.config.saldoTecnicoAnterior, 'cfg-sld-anterior': state.config.saldoLibreDisponibilidadAnterior
    };
    Object.entries(map).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.value = val ?? '';
    });

    renderAlertaCondicionIVA();
  }

  function renderAlertaCondicionIVA() {
    const el = document.getElementById('alerta-condicion-iva');
    if (!el) return;
    if (window.TaxEngine.esMonotributo(state.config.condicionIVA)) {
      el.textContent = `⚠ ${state.config.razonSocial || 'Este contribuyente'} es Responsable Monotributo: no liquida IVA. Podés cargar comprobantes igual como registro, pero el liquidador no va a calcular débito/crédito fiscal.`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  // ---------- Tabs ----------
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'tab-conciliador') renderConciliador();
        if (btn.dataset.tab === 'tab-papeles') renderPapelTrabajo();
        if (btn.dataset.tab === 'tab-simulador') renderSimulador();
        if (btn.dataset.tab === 'tab-ddjj') renderDdjj();
      });
    });
  }

  // ---------- Modales ----------
  function abrirModal(id) {
    // Resguardo: si por algún motivo quedó otro modal abierto, lo cerramos antes
    // de mostrar el nuevo, para que nunca queden dos superpuestos tapándose.
    document.querySelectorAll('.modal-backdrop').forEach((m) => {
      if (m.id !== id) m.classList.add('hidden');
    });
    document.getElementById(id).classList.remove('hidden');
  }
  function cerrarModal(id) { document.getElementById(id).classList.add('hidden'); }

  function initModales() {
    document.getElementById('btn-nuevo-comprobante').addEventListener('click', () => abrirFormComprobante(null));
    document.getElementById('btn-close-modal').addEventListener('click', () => cerrarModal('modal-comprobante'));
    document.getElementById('btn-cancel-modal').addEventListener('click', () => cerrarModal('modal-comprobante'));

    document.getElementById('btn-config-contribuyente').addEventListener('click', () => abrirModal('modal-config'));
    document.getElementById('btn-close-config').addEventListener('click', () => cerrarModal('modal-config'));
    document.getElementById('btn-cancel-config').addEventListener('click', () => cerrarModal('modal-config'));

    document.getElementById('btn-descargar-plantillas').addEventListener('click', () => abrirModal('modal-plantillas'));
    document.getElementById('btn-close-plantillas').addEventListener('click', () => cerrarModal('modal-plantillas'));
    document.getElementById('btn-cancel-plantillas').addEventListener('click', () => cerrarModal('modal-plantillas'));

    document.getElementById('btn-pegar-texto').addEventListener('click', () => abrirModal('modal-pegar-texto'));
    document.getElementById('btn-close-pegar').addEventListener('click', () => cerrarModal('modal-pegar-texto'));
    document.getElementById('btn-cancel-pegar').addEventListener('click', () => cerrarModal('modal-pegar-texto'));

    document.getElementById('comp-tipo-op').addEventListener('change', actualizarVisibilidadVinculoExpo);

    document.getElementById('form-comprobante').addEventListener('submit', onGuardarComprobante);
    document.getElementById('form-config').addEventListener('submit', onGuardarConfig);
    document.getElementById('form-pegar-texto').addEventListener('submit', onProcesarTextoPegado);
  }

  function actualizarVisibilidadVinculoExpo() {
    const tipoOp = document.getElementById('comp-tipo-op').value;
    const grupo = document.getElementById('grupo-vinculado-expo');
    grupo.style.display = (tipoOp === 'compra' || tipoOp === 'importacion') ? '' : 'none';
  }

  function asegurarOpcionSelect(selectId, valor) {
    if (!valor) return;
    const sel = document.getElementById(selectId);
    const existe = Array.from(sel.options).some((o) => o.value === valor);
    if (!existe) {
      const opt = document.createElement('option');
      opt.value = valor;
      opt.textContent = `${valor} (cargado por importación/grilla)`;
      sel.appendChild(opt);
    }
  }

  function abrirFormComprobante(comprobante) {
    state.editandoId = comprobante ? comprobante.id : null;
    document.getElementById('modal-title').textContent = comprobante ? 'Editar Comprobante' : 'Agregar Nuevo Comprobante / Despacho';
    const f = document.getElementById('form-comprobante');
    f.reset();
    if (comprobante) {
      document.getElementById('comp-tipo-op').value = comprobante.tipoOperacion;
      document.getElementById('comp-fecha').value = comprobante.fecha;
      asegurarOpcionSelect('comp-tipo-doc', comprobante.tipoDoc);
      document.getElementById('comp-tipo-doc').value = comprobante.tipoDoc;
      document.getElementById('comp-numero').value = comprobante.numero;
      document.getElementById('comp-cuit').value = comprobante.cuit;
      document.getElementById('comp-razon').value = comprobante.razonSocial;
      document.getElementById('comp-neto').value = comprobante.neto;
      document.getElementById('comp-alicuota').value = comprobante.alicuota;
      document.getElementById('comp-retenciones').value = comprobante.retencionesPercepciones;
      document.getElementById('comp-es-aduanera').value = comprobante.esPercepcionAduanera ? 'si' : 'no';
      document.getElementById('comp-vinculado-expo').value = comprobante.vinculadoExportacion ? 'si' : 'no';
    } else {
      document.getElementById('comp-fecha').value = `${state.config.periodo}-01`;
    }
    actualizarVisibilidadVinculoExpo();
    abrirModal('modal-comprobante');
  }

  function onGuardarComprobante(e) {
    e.preventDefault();
    const cuit = document.getElementById('comp-cuit').value.replace(/[^0-9]/g, '');
    if (cuit.length !== 11) { mostrarToast('El CUIT de la contraparte debe tener 11 dígitos.', 'error'); return; }

    const data = {
      tipoOperacion: document.getElementById('comp-tipo-op').value,
      fecha: document.getElementById('comp-fecha').value,
      tipoDoc: document.getElementById('comp-tipo-doc').value,
      numero: document.getElementById('comp-numero').value,
      cuit,
      razonSocial: document.getElementById('comp-razon').value,
      neto: parseFloat(document.getElementById('comp-neto').value) || 0,
      alicuota: parseFloat(document.getElementById('comp-alicuota').value),
      retencionesPercepciones: parseFloat(document.getElementById('comp-retenciones').value) || 0,
      esPercepcionAduanera: document.getElementById('comp-es-aduanera').value === 'si',
      vinculadoExportacion: document.getElementById('comp-vinculado-expo').value === 'si'
    };

    if (state.editandoId) {
      const idx = state.comprobantes.findIndex((c) => c.id === state.editandoId);
      if (idx >= 0) state.comprobantes[idx] = { ...state.comprobantes[idx], ...data };
    } else {
      state.comprobantes.push({ id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, fuente: 'sistema', ...data, createdAt: new Date().toISOString() });
    }
    guardar();
    cerrarModal('modal-comprobante');
    renderTodo();
    mostrarToast('Comprobante guardado y liquidación recalculada.', 'success');
  }

  function eliminarComprobante(id) {
    if (!confirm('¿Eliminar este comprobante?')) return;
    state.comprobantes = state.comprobantes.filter((c) => c.id !== id);
    guardar();
    renderTodo();
  }

  function onGuardarConfig(e) {
    e.preventDefault();
    const nuevoCuit = document.getElementById('cfg-cuit').value.replace(/[^0-9]/g, '');
    const limpiar = document.getElementById('cfg-limpiar-vouchers').checked;

    state.config = {
      razonSocial: document.getElementById('cfg-razon').value,
      tipoPersona: document.getElementById('cfg-tipo-persona').value,
      condicionIVA: document.getElementById('cfg-condicion-iva').value,
      periodo: document.getElementById('cfg-periodo').value || state.config.periodo,
      saldoTecnicoAnterior: parseFloat(document.getElementById('cfg-st-anterior').value) || 0,
      saldoLibreDisponibilidadAnterior: parseFloat(document.getElementById('cfg-sld-anterior').value) || 0
    };

    if (nuevoCuit && nuevoCuit !== state.cuit) {
      const cuitAnterior = state.cuit;
      state.cuit = nuevoCuit;
      if (limpiar) state.comprobantes = [];
      else {
        const previo = cargar(nuevoCuit);
        if (previo) state.comprobantes = previo.comprobantes || [];
      }
      mostrarToast(`Contribuyente cambiado de ${formatCuit(cuitAnterior)} a ${formatCuit(nuevoCuit)}.`, 'info');
    }

    guardar();
    poblarSelectorContribuyentes();
    aplicarConfigAUI();
    cerrarModal('modal-config');
    renderTodo();
  }

  // Escucha la respuesta del padrón ARCA (disparada desde arcaApi.js) para
  // autocompletar razón social / condición IVA / tipo de persona.
  document.addEventListener('arca:persona-actualizada', (ev) => {
    const persona = ev.detail;
    const tipoPersonaEl = document.getElementById('cfg-tipo-persona');
    const condicionEl = document.getElementById('cfg-condicion-iva');
    if (tipoPersonaEl && persona.tipoPersona) tipoPersonaEl.value = persona.tipoPersona;
    if (condicionEl && persona.condicionIVA) {
      const opciones = Array.from(condicionEl.options).map((o) => o.value);
      if (opciones.includes(persona.condicionIVA)) condicionEl.value = persona.condicionIVA;
    }
    state.config.razonSocial = persona.razonSocial;
    state.config.condicionIVA = persona.condicionIVA || state.config.condicionIVA;
    state.config.tipoPersona = persona.tipoPersona || state.config.tipoPersona;
    renderAlertaCondicionIVA();
  });

  function onProcesarTextoPegado(e) {
    e.preventDefault();
    const texto = document.getElementById('txt-paste-content').value;
    const fuente = document.getElementById('select-fuente-import').value;
    const { comprobantes, errores } = window.CsvParser.parsearTexto(texto, { fuente });
    state.comprobantes.push(...comprobantes);
    guardar();
    cerrarModal('modal-pegar-texto');
    renderTodo();
    mostrarToast(`Se cargaron ${comprobantes.length} comprobantes.${errores.length ? ' ' + errores.length + ' filas con errores (ver consola).' : ''}`, errores.length ? 'error' : 'success');
    if (errores.length) console.warn('Errores de importación:', errores);
  }

  // ---------- Import de archivo / dropzone ----------
  function initImportArchivo() {
    const input = document.getElementById('input-file-arca');
    document.getElementById('btn-dropzone-select').addEventListener('click', () => input.click());
    document.getElementById('btn-import-arca').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      if (!input.files.length) return;
      await procesarArchivo(input.files[0]);
      input.value = '';
    });

    const dropzone = document.getElementById('dropzone-arca');
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) await procesarArchivo(e.dataTransfer.files[0]);
    });
  }

  async function procesarArchivo(file) {
    try {
      const texto = await window.CsvParser.leerArchivo(file);
      const fuente = document.getElementById('select-fuente-import').value;
      const { comprobantes, errores } = window.CsvParser.parsearTexto(texto, { fuente });
      state.comprobantes.push(...comprobantes);
      guardar();
      renderTodo();
      mostrarToast(`Se importaron ${comprobantes.length} comprobantes de "${file.name}".${errores.length ? ' ' + errores.length + ' filas con errores.' : ''}`, errores.length ? 'error' : 'success');
      if (errores.length) console.warn('Errores de importación:', errores);
    } catch (err) {
      mostrarToast(`No se pudo procesar el archivo: ${err.message}`, 'error');
    }
  }

  // ---------- Tabla de comprobantes ----------
  const TIPO_LABEL = { venta: 'Venta ME', exportacion: 'Exportación', compra: 'Compra ME', importacion: 'Impo. Aduana' };

  function renderTablaComprobantes() {
    const tbody = document.getElementById('tbody-comprobantes');
    const buscar = (document.getElementById('filter-search').value || '').toLowerCase();
    const filtroTipo = document.getElementById('filter-tipo').value;

    const filas = state.comprobantes.filter((c) => {
      if (filtroTipo !== 'todos' && c.tipoOperacion !== filtroTipo) return false;
      if (!buscar) return true;
      return (c.cuit || '').includes(buscar) || (c.razonSocial || '').toLowerCase().includes(buscar) || (c.numero || '').toLowerCase().includes(buscar);
    }).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="13" class="empty-state">No hay comprobantes cargados para este filtro. Usá "Nuevo Comprobante", pegá texto o importá un archivo.</td></tr>';
      return;
    }

    tbody.innerHTML = filas.map((c) => {
      const iva = round2(Number(c.neto) * Number(c.alicuota) / 100);
      const esVenta = c.tipoOperacion === 'venta' || c.tipoOperacion === 'exportacion';
      return `<tr>
        <td>${c.fecha}</td>
        <td><span class="pill pill-${c.tipoOperacion}">${TIPO_LABEL[c.tipoOperacion] || c.tipoOperacion}</span></td>
        <td>${c.tipoDoc}<br><small>${c.numero}</small></td>
        <td>${formatCuit(c.cuit)}</td>
        <td>${escapeHtml(c.razonSocial)}</td>
        <td class="text-right">${money(c.neto)}</td>
        <td class="text-right">${c.alicuota}%</td>
        <td class="text-right">${esVenta ? money(iva) : '—'}</td>
        <td class="text-right">${!esVenta ? money(iva) : '—'}</td>
        <td class="text-right">${c.retencionesPercepciones ? money(c.retencionesPercepciones) : '—'}</td>
        <td>${c.vinculadoExportacion ? '<span class="pill pill-expo-link">Vinc. Expo</span>' : '—'}</td>
        <td><span class="pill pill-fuente-${c.fuente}">${c.fuente === 'arca' ? 'ARCA' : 'Sistema'}</span></td>
        <td>
          <button class="btn-icon" title="Editar" onclick="AppLiquidador.editar('${c.id}')"><i class="ri-pencil-line"></i></button>
          <button class="btn-icon" title="Eliminar" onclick="AppLiquidador.eliminar('${c.id}')"><i class="ri-delete-bin-line"></i></button>
        </td>
      </tr>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  // ---------- Liquidación y banner en vivo ----------
  function recalcular() {
    const opciones = leerOpcionesSimulador();
    const liq = window.TaxEngine.liquidar({
      comprobantes: state.comprobantes,
      periodo: state.config.periodo,
      condicionIVA: state.config.condicionIVA,
      saldoTecnicoAnterior: state.config.saldoTecnicoAnterior,
      saldoLibreDisponibilidadAnterior: state.config.saldoLibreDisponibilidadAnterior,
      opciones
    });
    state.ultimaLiquidacion = liq;
    return liq;
  }

  function leerOpcionesSimulador() {
    return {
      prorrateoPct: Number(document.getElementById('sim-prorrateo-range')?.value ?? 100),
      incluirImportaciones: document.getElementById('sim-incluir-impo')?.checked ?? true,
      incluirPercepcionesAduaneras: document.getElementById('sim-incluir-percep-aduaneras')?.checked ?? true,
      solicitarArt43: document.getElementById('sim-solicitar-art43')?.checked ?? true
    };
  }

  function renderBannerVivo() {
    const liq = state.ultimaLiquidacion;
    const dfEl = document.getElementById('live-df');
    const cfEl = document.getElementById('live-cf');
    const stEl = document.getElementById('live-saldo-tecnico');
    const stBadge = document.getElementById('live-st-badge');
    const retEl = document.getElementById('live-retenciones');
    const posEl = document.getElementById('live-posicion-final');
    const posBadge = document.getElementById('live-posicion-badge');

    if (!liq || !liq.aplica) {
      [dfEl, cfEl, stEl, retEl, posEl].forEach((el) => { if (el) el.textContent = '$0,00'; });
      if (stBadge) { stBadge.textContent = liq && !liq.aplica ? 'No liquida IVA' : 'Determinando...'; }
      if (posBadge) posBadge.textContent = 'Pendiente de cierre';
      return;
    }

    dfEl.textContent = money(liq.debitoFiscal);
    document.getElementById('live-df-sub').textContent = `${liq.cantidadVentas} comprobantes ventas`;
    cfEl.textContent = money(liq.creditoFiscalComputable);
    stEl.textContent = money(liq.saldoTecnicoResultante);
    stBadge.textContent = liq.saldoTecnicoResultante >= 0 ? 'Saldo técnico a pagar' : 'Saldo técnico a favor';
    retEl.textContent = money(liq.percepcionesAduaneras + liq.retencionesPercepcionesLocales);
    posEl.textContent = money(Math.abs(liq.posicionFinal));
    posBadge.textContent = liq.esAFavor ? 'A FAVOR (saldo libre disponibilidad)' : 'A PAGAR';
    posBadge.className = `badge-status ${liq.esAFavor ? 'badge-success' : 'badge-warning'}`;
  }

  // ---------- Conciliador ----------
  function renderConciliador() {
    const { filas, stats } = window.ArcaReconciler.ejecutarCruce(state.comprobantes, state.config.periodo);
    document.getElementById('recon-stat-ok').textContent = stats.ok;
    document.getElementById('recon-stat-diff').textContent = stats.diff;
    document.getElementById('recon-stat-missing').textContent = stats.missing;
    document.getElementById('badge-discrepancias').textContent = stats.diff + stats.missing;

    const tbody = document.getElementById('tbody-conciliacion');
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No hay datos para conciliar. Importá un archivo marcado como "Archivo oficial de ARCA" para comparar contra tus libros.</td></tr>';
      return;
    }
    tbody.innerHTML = filas.map((f) => {
      const c = f.comprobante;
      const estadoLabel = { ok: 'Coincide', diferencia: 'Diferencia', solo_sistema: 'Solo en Libros', solo_arca: 'Solo en ARCA' }[f.estado];
      const estadoClase = { ok: 'success', diferencia: 'warning', solo_sistema: 'danger', solo_arca: 'danger' }[f.estado];
      return `<tr>
        <td>${c.tipoDoc}<br><small>${c.numero}</small></td>
        <td>${formatCuit(c.cuit)}</td>
        <td class="text-right">${money(c.neto)}</td>
        <td class="text-right">${f.contraparte ? money(f.contraparte.neto) : '—'}</td>
        <td class="text-right">${f.contraparte ? money(Math.abs((c.neto * c.alicuota / 100) - (f.contraparte.neto * f.contraparte.alicuota / 100))) : '—'}</td>
        <td><span class="badge-status badge-${estadoClase}">${estadoLabel}</span></td>
        <td>${escapeHtml(f.diagnostico)}</td>
        <td><button class="btn-icon" title="Editar" onclick="AppLiquidador.editar('${c.id}')"><i class="ri-pencil-line"></i></button></td>
      </tr>`;
    }).join('');
  }

  // ---------- Simulador ----------
  function renderSimulador() {
    const original = window.TaxEngine.liquidar({
      comprobantes: state.comprobantes, periodo: state.config.periodo, condicionIVA: state.config.condicionIVA,
      saldoTecnicoAnterior: state.config.saldoTecnicoAnterior, saldoLibreDisponibilidadAnterior: state.config.saldoLibreDisponibilidadAnterior,
      opciones: { prorrateoPct: 100, incluirImportaciones: true, incluirPercepcionesAduaneras: true, solicitarArt43: true }
    });
    const simulado = recalcular();

    document.getElementById('sim-prorrateo-val').textContent = `${document.getElementById('sim-prorrateo-range').value}% Computable`;

    const impoTotal = round2(state.comprobantes.filter((c) => c.tipoOperacion === 'importacion' && (c.fecha || '').slice(0, 7) === state.config.periodo).reduce((a, c) => a + (c.neto * c.alicuota / 100), 0));
    const percepAduTotal = round2(state.comprobantes.filter((c) => c.tipoOperacion === 'importacion' && c.esPercepcionAduanera && (c.fecha || '').slice(0, 7) === state.config.periodo).reduce((a, c) => a + Number(c.retencionesPercepciones || 0), 0));
    document.getElementById('sim-impo-monto').textContent = impoTotal.toLocaleString('es-AR');
    document.getElementById('sim-percep-aduaneras-monto').textContent = percepAduTotal.toLocaleString('es-AR');

    const pintar = (prefix, liq) => {
      if (!liq.aplica) return;
      document.getElementById(`${prefix}-df`).textContent = money(liq.debitoFiscal);
      document.getElementById(`${prefix}-cf`).textContent = money(liq.creditoFiscalComputable);
      document.getElementById(`${prefix}-st`).textContent = money(liq.saldoTecnicoResultante);
      document.getElementById(`${prefix}-ret`).textContent = money(liq.percepcionesAduaneras + liq.retencionesPercepcionesLocales);
      document.getElementById(`${prefix}-res`).textContent = money(Math.abs(liq.posicionFinal)) + (liq.esAFavor ? ' (a favor)' : ' (a pagar)');
    };
    if (original.aplica) pintar('sim-orig', original);
    if (simulado.aplica) pintar('sim-mod', simulado);

    const rec = document.getElementById('sim-recommendation');
    if (original.aplica && simulado.aplica) {
      const delta = round2(simulado.posicionFinal - original.posicionFinal);
      rec.innerHTML = delta === 0
        ? '<i class="ri-information-line"></i> Los parámetros simulados no modifican el resultado respecto de la liquidación original.'
        : `<i class="ri-information-line"></i> Con estos parámetros, la posición final cambia en ${money(Math.abs(delta))} ${delta < 0 ? 'a favor' : 'en contra'} respecto de la liquidación original.`;
    }
  }

  function initSimulador() {
    ['sim-prorrateo-range', 'sim-incluir-impo', 'sim-incluir-percep-aduaneras', 'sim-solicitar-art43'].forEach((id) => {
      document.getElementById(id).addEventListener('input', () => { recalcular(); renderBannerVivo(); renderSimulador(); });
    });
  }

  // ---------- Papel de trabajo ----------
  function renderPapelTrabajo() {
    const liq = recalcular();
    document.getElementById('wp-razon').textContent = state.config.razonSocial;
    document.getElementById('wp-cuit').textContent = formatCuit(state.cuit);
    document.getElementById('wp-periodo').textContent = state.config.periodo;
    document.getElementById('wp-fecha-hoy').textContent = new Date().toLocaleDateString('es-AR');

    if (!liq.aplica) {
      document.getElementById('working-paper-view').innerHTML = `<div class="empty-state">${liq.motivo}</div>`;
      return;
    }

    document.getElementById('wp-tbody-df').innerHTML = liq.dfPorAlicuota.map((g) =>
      `<tr><td>Ventas gravadas ${g.alicuota}%</td><td class="text-right">${money(g.neto)}</td><td class="text-right">${money(g.iva)}</td></tr>`
    ).join('') || '<tr><td colspan="3" class="empty-state">Sin ventas en el período.</td></tr>';

    const filasCf = [
      ...liq.cfPorAlicuotaCompras.map((g) => ({ label: `Compras locales ${g.alicuota}%`, neto: g.neto, iva: g.iva })),
      ...liq.cfPorAlicuotaImpo.map((g) => ({ label: `Importaciones ${g.alicuota}%`, neto: g.neto, iva: g.iva }))
    ];
    document.getElementById('wp-tbody-cf').innerHTML = (filasCf.map((f) =>
      `<tr><td>${f.label}</td><td class="text-right">${money(f.neto)}</td><td class="text-right">${money(f.iva)}</td></tr>`
    ).join('') || '<tr><td colspan="3" class="empty-state">Sin compras en el período.</td></tr>')
      + `<tr class="subtotal-row"><td>Prorrateo aplicado (Art. 13)</td><td class="text-right" colspan="2">${document.getElementById('sim-prorrateo-range').value}% computable sobre CF general</td></tr>`
      + `<tr class="subtotal-row"><td>CF vinculado directo a Exportación (Art. 43, 100% computable)</td><td class="text-right" colspan="2">${money(liq.cfVinculadoExpoDirecto)}</td></tr>`;

    document.getElementById('wp-expo-monto').textContent = money(liq.montoExportaciones);
    document.getElementById('wp-expo-cf-vinculado').textContent = money(liq.cfVinculadoExpoDirecto);

    document.getElementById('wp-calc-df').textContent = money(liq.debitoFiscal);
    document.getElementById('wp-calc-cf').textContent = `(${money(liq.creditoFiscalComputable)})`;
    document.getElementById('wp-calc-subtotal').textContent = money(liq.subtotal);
    document.getElementById('wp-calc-st-anterior').textContent = `(${money(liq.saldoTecnicoAnterior)})`;
    document.getElementById('wp-calc-st-final').textContent = money(liq.saldoTecnicoResultante);
    document.getElementById('wp-calc-retenciones').textContent = `(${money(liq.retencionesPercepcionesLocales)})`;
    document.getElementById('wp-calc-percepciones').textContent = `(${money(0)})`;
    document.getElementById('wp-calc-percep-aduaneras').textContent = `(${money(liq.percepcionesAduaneras)})`;
    document.getElementById('wp-calc-sld-anterior').textContent = `(${money(liq.saldoLibreDisponibilidadAnterior)})`;
    document.getElementById('wp-final-label').textContent = liq.esAFavor
      ? 'POSICIÓN DEFINITIVA A FAVOR (Saldo Libre Disponibilidad):' : 'POSICIÓN DEFINITIVA A PAGAR:';
    document.getElementById('wp-calc-final-res').textContent = money(Math.abs(liq.posicionFinal));
  }

  // ---------- DDJJ / Exportar ARCA ----------
  function renderDdjj() {
    const liq = recalcular();
    if (!liq.aplica) return;
    document.getElementById('f2002-neto-ventas').textContent = money(liq.montoVentasGravadas);
    document.getElementById('f2002-df').textContent = money(liq.debitoFiscal);
    document.getElementById('f2002-expo-neto').textContent = money(liq.montoExportaciones);
    document.getElementById('f2002-neto-compras').textContent = money(liq.cfComprasGenerales / 0.21 || 0);
    document.getElementById('f2002-neto-impo').textContent = money(liq.cfImportacionesGenerales / 0.21 || 0);
    document.getElementById('f2002-cf').textContent = money(liq.creditoFiscalComputable);
    document.getElementById('f2002-saldo-final').textContent = `${money(Math.abs(liq.posicionFinal))} ${liq.esAFavor ? '(a favor)' : '(a pagar)'}`;
  }

  function initDdjjBotones() {
    document.getElementById('btn-export-lid-ventas').addEventListener('click', () =>
      window.ExportEngine.exportarLidTxt(state.comprobantes.filter((c) => (c.fecha || '').slice(0, 7) === state.config.periodo), 'ventas', `LID_ventas_${state.cuit}_${state.config.periodo}.txt`));
    document.getElementById('btn-export-lid-compras').addEventListener('click', () =>
      window.ExportEngine.exportarLidTxt(state.comprobantes.filter((c) => (c.fecha || '').slice(0, 7) === state.config.periodo), 'compras', `LID_compras_${state.cuit}_${state.config.periodo}.txt`));
    document.getElementById('btn-export-lid-impo').addEventListener('click', () =>
      window.ExportEngine.exportarLidTxt(state.comprobantes.filter((c) => (c.fecha || '').slice(0, 7) === state.config.periodo), 'importacion', `LID_importaciones_${state.cuit}_${state.config.periodo}.txt`));
  }

  // ---------- Botones generales ----------
  function initBotonesGenerales() {
    document.getElementById('btn-cargar-demo').addEventListener('click', () => {
      const demo = window.MockData.casoDemo(state.config.periodo);
      state.comprobantes.push(...demo);
      guardar();
      renderTodo();
      mostrarToast('Caso demo cargado: ventas, exportación, compras e importación.', 'success');
    });

    document.getElementById('btn-limpiar-comprobantes').addEventListener('click', () => {
      if (!confirm('¿Vaciar TODOS los comprobantes de este contribuyente? Esta acción no se puede deshacer (descargá un backup antes si no estás seguro).')) return;
      state.comprobantes = [];
      guardar();
      renderTodo();
    });

    document.getElementById('filter-search').addEventListener('input', renderTablaComprobantes);
    document.getElementById('filter-tipo').addEventListener('change', renderTablaComprobantes);

    document.getElementById('btn-export-excel').addEventListener('click', () => {
      const liq = state.ultimaLiquidacion || recalcular();
      window.ExportEngine.exportarPapelTrabajoCsv(liq, { razonSocial: state.config.razonSocial, cuit: formatCuit(state.cuit) }, `papel_trabajo_${state.cuit}_${state.config.periodo}.csv`);
    });
    document.getElementById('btn-print-papeles').addEventListener('click', () => window.ExportEngine.imprimirPapelTrabajo());

    document.getElementById('btn-backup-descargar').addEventListener('click', () => {
      window.ExportEngine.exportarBackupJson({ cuit: state.cuit, config: state.config, comprobantes: state.comprobantes }, `backup_${state.cuit}_${new Date().toISOString().slice(0, 10)}.json`);
    });
    document.getElementById('btn-backup-restaurar').addEventListener('click', () => document.getElementById('input-backup-restaurar').click());
    document.getElementById('input-backup-restaurar').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const texto = await window.CsvParser.leerArchivo(file);
        const data = JSON.parse(texto);
        if (!data.cuit || !Array.isArray(data.comprobantes)) throw new Error('El archivo no tiene el formato de backup esperado.');
        seleccionarContribuyente(data.cuit, data.config);
        state.comprobantes = data.comprobantes;
        guardar();
        renderTodo();
        mostrarToast(`Backup restaurado: ${data.comprobantes.length} comprobantes para ${formatCuit(data.cuit)}.`, 'success');
      } catch (err) {
        mostrarToast(`No se pudo restaurar el backup: ${err.message}`, 'error');
      }
      e.target.value = '';
    });

    document.getElementById('select-contribuyente-guardado').addEventListener('change', (e) => {
      if (e.target.value) seleccionarContribuyente(e.target.value);
    });

    document.getElementById('btn-ejecutar-cruce').addEventListener('click', renderConciliador);

    document.querySelectorAll('[id^="btn-tpl-"]').forEach((btn) => {
      btn.addEventListener('click', () => descargarPlantilla(btn.id));
    });
  }

  function descargarPlantilla(btnId) {
    const encabezado = 'fecha;tipoDoc;puntoVenta;numero;cuit;razonSocial;neto;alicuota;retenciones;tipoOperacion';
    const ejemplos = {
      'btn-tpl-maestra': [
        '2026-08-01;Factura A;00001;00012345;30500019073;CLIENTE SA;500000.00;21.0;0.00;venta',
        '2026-08-02;Factura E;00002;00000501;30500010912;CLIENTE EXTERIOR;2000000.00;0;0.00;exportacion',
        '2026-08-03;Factura A;00003;00004521;27230938607;PROVEEDOR SRL;300000.00;21.0;0.00;compra',
        '2026-08-04;Despacho Impo;17001IC01;000123-4;30500010912;ADUANA;500000.00;21.0;45000.00;importacion'
      ],
      'btn-tpl-ventas': [
        '2026-08-01;Factura A;00001;00012345;30500019073;CLIENTE SA;500000.00;21.0;0.00;venta',
        '2026-08-02;Factura E;00002;00000501;30500010912;CLIENTE EXTERIOR;2000000.00;0;0.00;exportacion'
      ],
      'btn-tpl-compras': ['2026-08-03;Factura A;00003;00004521;27230938607;PROVEEDOR SRL;300000.00;21.0;0.00;compra'],
      'btn-tpl-impo': ['2026-08-04;Despacho Impo;17001IC01;000123-4;30500010912;ADUANA;500000.00;21.0;45000.00;importacion']
    };
    const nombre = { 'btn-tpl-maestra': 'plantilla_maestra', 'btn-tpl-ventas': 'plantilla_ventas', 'btn-tpl-compras': 'plantilla_compras', 'btn-tpl-impo': 'plantilla_importaciones' }[btnId];
    window.ExportEngine.descargarTexto(`${nombre}.csv`, '\uFEFF' + [encabezado, ...ejemplos[btnId]].join('\r\n'), 'text/csv;charset=utf-8');
  }

  // ---------- Grilla de carga manual (varios comprobantes a la vez) ----------
  const ALICUOTAS_GRILLA = [21, 10.5, 27, 0];

  function grillaFilaHtml(rowId) {
    const opcionesAlicuota = ALICUOTAS_GRILLA.map((a) => `<option value="${a}">${a}%</option>`).join('');
    return `<tr data-row-id="${rowId}">
      <td>
        <select data-campo="tipoOperacion">
          <option value="venta">Venta ME</option>
          <option value="exportacion">Exportación</option>
          <option value="compra">Compra ME</option>
          <option value="importacion">Impo. Aduana</option>
        </select>
      </td>
      <td><input type="date" data-campo="fecha" value="${state.config.periodo}-01"></td>
      <td><input type="text" data-campo="tipoDoc" placeholder="Factura A"></td>
      <td><input type="text" data-campo="numero" placeholder="00001-00012345"></td>
      <td><input type="text" data-campo="cuit" placeholder="30500010912" maxlength="11"></td>
      <td><input type="text" data-campo="razonSocial" placeholder="Razón social"></td>
      <td><input type="number" step="0.01" data-campo="neto" placeholder="0.00"></td>
      <td>
        <select data-campo="alicuota">${opcionesAlicuota}</select>
      </td>
      <td><input type="number" step="0.01" data-campo="retenciones" placeholder="0.00"></td>
      <td class="center"><input type="checkbox" data-campo="esPercepcionAduanera"></td>
      <td class="center"><input type="checkbox" data-campo="vinculadoExportacion"></td>
      <td><button type="button" class="btn-icon" title="Quitar fila" data-accion="quitar-fila"><i class="ri-close-line"></i></button></td>
    </tr>`;
  }

  function grillaAgregarFilas(cantidad) {
    const tbody = document.getElementById('tbody-grilla');
    for (let i = 0; i < cantidad; i++) {
      const rowId = `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      tbody.insertAdjacentHTML('beforeend', grillaFilaHtml(rowId));
    }
  }

  function grillaVaciar() {
    document.getElementById('tbody-grilla').innerHTML = '';
    grillaAgregarFilas(5);
  }

  function leerFilaGrilla(tr) {
    const val = (campo) => tr.querySelector(`[data-campo="${campo}"]`).value;
    const chk = (campo) => tr.querySelector(`[data-campo="${campo}"]`).checked;
    return {
      tipoOperacion: val('tipoOperacion'),
      fecha: val('fecha'),
      tipoDoc: val('tipoDoc').trim(),
      numero: val('numero').trim(),
      cuit: val('cuit').replace(/[^0-9]/g, ''),
      razonSocial: val('razonSocial').trim(),
      neto: parseFloat(val('neto')),
      alicuota: parseFloat(val('alicuota')),
      retencionesPercepciones: parseFloat(val('retenciones')) || 0,
      esPercepcionAduanera: chk('esPercepcionAduanera'),
      vinculadoExportacion: chk('vinculadoExportacion')
    };
  }

  function filaEstaVacia(fila) {
    // No usamos "fecha" para decidir si está vacía: el input de fecha siempre trae
    // un valor por defecto (primer día del período), así que una fila realmente
    // vacía se reconoce por la ausencia de CUIT, razón social y monto.
    return !fila.cuit && !fila.razonSocial && (isNaN(fila.neto) || fila.neto === 0);
  }

  function validarFilaGrilla(fila) {
    const errores = [];
    if (!fila.fecha) errores.push('falta fecha');
    if (fila.cuit.length !== 11) errores.push('CUIT inválido (11 dígitos)');
    if (!fila.razonSocial) errores.push('falta razón social');
    if (isNaN(fila.neto) || fila.neto <= 0) errores.push('neto debe ser mayor a 0');
    if (isNaN(fila.alicuota)) errores.push('falta alícuota');
    return errores;
  }

  function onGrillaGuardarTodo() {
    const filas = Array.from(document.querySelectorAll('#tbody-grilla tr'));
    let agregados = 0;
    let conError = 0;
    const detalleErrores = [];

    filas.forEach((tr, idx) => {
      tr.classList.remove('grilla-fila-invalida');
      const fila = leerFilaGrilla(tr);
      if (filaEstaVacia(fila)) return; // se ignora silenciosamente

      const errores = validarFilaGrilla(fila);
      if (errores.length) {
        tr.classList.add('grilla-fila-invalida');
        conError++;
        detalleErrores.push(`Fila ${idx + 1}: ${errores.join(', ')}.`);
        return;
      }

      state.comprobantes.push({
        id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fuente: 'sistema',
        ...fila,
        createdAt: new Date().toISOString()
      });
      agregados++;
    });

    if (agregados > 0) {
      guardar();
      renderTodo();
    }

    if (conError) {
      mostrarToast(`Se guardaron ${agregados} comprobantes. ${conError} fila(s) con errores quedaron marcadas en rojo — revisalas y volvé a guardar.`, 'error');
      console.warn('Errores de carga en grilla:', detalleErrores);
    } else if (agregados > 0) {
      cerrarModal('modal-grilla');
      mostrarToast(`Se guardaron ${agregados} comprobantes desde la grilla.`, 'success');
    } else {
      mostrarToast('No había filas con datos para guardar.', 'info');
    }
  }

  function initGrilla() {
    document.getElementById('btn-carga-grilla').addEventListener('click', () => {
      if (!document.getElementById('tbody-grilla').children.length) grillaAgregarFilas(5);
      abrirModal('modal-grilla');
    });
    document.getElementById('btn-close-grilla').addEventListener('click', () => cerrarModal('modal-grilla'));
    document.getElementById('btn-cancel-grilla').addEventListener('click', () => cerrarModal('modal-grilla'));
    document.getElementById('btn-grilla-agregar-fila').addEventListener('click', () => grillaAgregarFilas(1));
    document.getElementById('btn-grilla-agregar-10').addEventListener('click', () => grillaAgregarFilas(10));
    document.getElementById('btn-grilla-vaciar').addEventListener('click', () => {
      if (confirm('¿Vaciar todas las filas de la grilla actual (no afecta comprobantes ya guardados)?')) grillaVaciar();
    });
    document.getElementById('btn-grilla-guardar-todo').addEventListener('click', onGrillaGuardarTodo);
    document.getElementById('tbody-grilla').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-accion="quitar-fila"]');
      if (btn) btn.closest('tr').remove();
    });
  }

  // ---------- Editar / eliminar expuestos globalmente para los botones inline ----------
  window.AppLiquidador = {
    editar: (id) => abrirFormComprobante(state.comprobantes.find((c) => c.id === id)),
    eliminar: eliminarComprobante
  };

  // ---------- Render general ----------
  function renderTodo() {
    try {
      recalcular();
      renderTablaComprobantes();
      renderBannerVivo();
      const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
      if (activeTab === 'tab-conciliador') renderConciliador();
      if (activeTab === 'tab-papeles') renderPapelTrabajo();
      if (activeTab === 'tab-simulador') renderSimulador();
      if (activeTab === 'tab-ddjj') renderDdjj();
    } catch (e) {
      console.error('Error al renderizar:', e);
      mostrarToast(`Error al actualizar la vista: ${e.message}. Revisá la consola (F12) — puede haber un comprobante con datos inválidos.`, 'error');
    }
  }

  // ---------- Init ----------
  function initSeguro(nombre, fn) {
    try {
      fn();
    } catch (e) {
      console.error(`Error inicializando "${nombre}":`, e);
      mostrarToast(`Ocurrió un error iniciando "${nombre}": ${e.message}. El resto de la app debería seguir funcionando; revisá la consola (F12) para más detalle.`, 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initSeguro('tabs', initTabs);
    initSeguro('modales', initModales);
    initSeguro('grilla', initGrilla);
    initSeguro('import de archivos', initImportArchivo);
    initSeguro('simulador', initSimulador);
    initSeguro('botones DDJJ', initDdjjBotones);
    initSeguro('botones generales', initBotonesGenerales);

    const activo = localStorage.getItem(STORAGE_ACTIVO);
    const inicial = activo ? cargar(activo) : null;
    if (activo && inicial) {
      seleccionarContribuyente(activo);
    } else {
      seleccionarContribuyente('30500010912', {
        razonSocial: 'LOGÍSTICA & IMPEX S.A.', tipoPersona: 'JURIDICA', condicionIVA: 'IVA Responsable Inscripto',
        periodo: new Date().toISOString().slice(0, 7), saldoTecnicoAnterior: 150000, saldoLibreDisponibilidadAnterior: 45000
      });
    }
  });
})();
