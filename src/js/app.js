/**
 * Main UI Controller & Application Orchestrator
 * Connects TaxEngine, ArcaReconciler, CsvParser, ExportEngine & MockData.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Global State
  let contribuyente = { ...MockData.defaultContribuyente };
  let sistemaVouchers = [...MockData.defaultSistemaVouchers];
  let arcaVouchers = [...MockData.defaultArcaVouchers];

  // Clave de almacenamiento CANÓNICA: siempre en base a los dígitos del CUIT,
  // sin importar si en pantalla se guardó/escribió con o sin guiones. Así
  // "Limpiar Todo", guardar e importar SIEMPRE leen/escriben la misma clave.
  function cuitKey(cuit) {
    return String(cuit || '').replace(/\D/g, '');
  }
  
  // Simulator State
  let simParams = {
    prorrateoPct: 100,
    incluirImpo: true,
    incluirPercepAduaneras: true,
    solicitarArt43: true
  };

  // DOM Elements
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // Live Condition Elements
  const liveDf = document.getElementById('live-df');
  const liveCf = document.getElementById('live-cf');
  const liveSt = document.getElementById('live-saldo-tecnico');
  const liveStBadge = document.getElementById('live-st-badge');
  const liveRet = document.getElementById('live-retenciones');
  const livePos = document.getElementById('live-posicion-final');
  const livePosBadge = document.getElementById('live-posicion-badge');

  // Modals & Forms
  const modalComp = document.getElementById('modal-comprobante');
  const modalConfig = document.getElementById('modal-config');
  const formComp = document.getElementById('form-comprobante');
  const formConfig = document.getElementById('form-config');

  // ----------------------------------------------------
  // INITIALIZATION
  // ----------------------------------------------------
  init();

  function init() {
    loadSavedState();
    bindEvents();
    recalculateAll();
  }

  function saveState() {
    try {
      localStorage.setItem('iva_contribuyente', JSON.stringify(contribuyente));
      const key = cuitKey(contribuyente.cuit);
      if (key) {
        localStorage.setItem('iva_sys_' + key, JSON.stringify(sistemaVouchers));
        localStorage.setItem('iva_arca_' + key, JSON.stringify(arcaVouchers));
      }
    } catch(e) {
      console.warn('LocalStorage save error:', e);
    }
  }

  function loadSavedState() {
    try {
      const savedCfg = localStorage.getItem('iva_contribuyente');
      if (savedCfg) {
        contribuyente = JSON.parse(savedCfg);
        document.getElementById('header-razon-social').innerText = contribuyente.razon;
        document.getElementById('header-cuit').innerText = `CUIT: ${contribuyente.cuit} | Resp. Inscripto`;

        const key = cuitKey(contribuyente.cuit);
        const savedSys = localStorage.getItem('iva_sys_' + key);
        const savedArca = localStorage.getItem('iva_arca_' + key);

        if (savedSys) sistemaVouchers = JSON.parse(savedSys);
        if (savedArca) arcaVouchers = JSON.parse(savedArca);
      }
    } catch(e) {
      console.warn('LocalStorage load error:', e);
    }
  }

  // ----------------------------------------------------
  // EVENT BINDINGS
  // ----------------------------------------------------
  function bindEvents() {
    // BUSCADOR RÁPIDO DE CUIT EN ARCA (PADRÓN Y REGISTROS)
    const btnQuickCuit = document.getElementById('btn-quick-buscar-cuit');
    const inputQuickCuit = document.getElementById('quick-cuit-input');

    async function buscarYSincronizarCuit(cuitValue) {
      if (!cuitValue || cuitValue.trim().length === 0) {
        alert('Por favor ingrese un número de CUIT válido (11 dígitos).');
        return;
      }
      try {
        btnQuickCuit.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Consultando ARCA...';
        btnQuickCuit.disabled = true;

        const info = await ArcaApi.consultarPadron(cuitValue);
        
        let razonFinal = info.razon;
        if (info.razon.startsWith('CONTRIBUYENTE CUIT')) {
          const userDefinedName = prompt(`CUIT: ${info.cuit}\nPor favor ingrese o confirme la Razón Social / Nombre para este CUIT:`, '');
          if (userDefinedName && userDefinedName.trim().length > 0) {
            razonFinal = userDefinedName.trim().toUpperCase();
          }
        }

        contribuyente.cuit = info.cuit;
        contribuyente.razon = razonFinal;
        
        document.getElementById('header-razon-social').innerText = contribuyente.razon;
        document.getElementById('header-cuit').innerText = `CUIT: ${contribuyente.cuit} | ${info.condicion}`;

        // Consultar si desea traer registros de ARCA o blanquear para su propia empresa
        const syncArca = confirm(`Contribuyente Configurado:\n• Razón Social: ${contribuyente.razon}\n• CUIT: ${contribuyente.cuit}\n\n¿Deseas blanquear la pantalla para comenzar la carga/importación de este CUIT desde cero?`);

        if (syncArca) {
          sistemaVouchers = [];
          arcaVouchers = [];
        }

        saveState();
        recalculateAll();
      } catch (err) {
        alert('Error al procesar CUIT: ' + err.message);
      } finally {
        btnQuickCuit.innerHTML = '<i class="ri-search-eye-line"></i> Buscar CUIT en ARCA';
        btnQuickCuit.disabled = false;
      }
    }

    btnQuickCuit?.addEventListener('click', () => {
      buscarYSincronizarCuit(inputQuickCuit.value);
    });

    inputQuickCuit?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        buscarYSincronizarCuit(inputQuickCuit.value);
      }
    });

    // IMPORTAR DDJJ PERÍODO ANTERIOR (SALDOS ART. 24)
    const inputFileDdjj = document.getElementById('input-file-ddjj');

    document.getElementById('btn-import-ddjj-top')?.addEventListener('click', () => inputFileDdjj?.click());
    document.getElementById('btn-import-ddjj-modal')?.addEventListener('click', () => inputFileDdjj?.click());

    async function extraerTextoPdf(arrayBuffer) {
      const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const lineasTotales = [];

      for (let numPagina = 1; numPagina <= pdf.numPages; numPagina++) {
        const pagina = await pdf.getPage(numPagina);
        const contenido = await pagina.getTextContent();

        // Agrupamos los fragmentos de texto por su posicion vertical (fila),
        // porque un PDF no tiene "lineas" como un CSV: cada palabra es un
        // fragmento con su propia coordenada. Sin esto, "Saldo tecnico" y su
        // importe (que estan en la misma fila visual, en columnas distintas)
        // quedarian separados y el buscador de palabras clave no los uniria.
        const filas = {};
        contenido.items.forEach((item) => {
          const y = Math.round(item.transform[5]);
          if (!filas[y]) filas[y] = [];
          filas[y].push({ x: item.transform[4], str: item.str });
        });

        Object.keys(filas)
          .map(Number)
          .sort((a, b) => b - a) // de arriba hacia abajo
          .forEach((y) => {
            const fila = filas[y].sort((a, b) => a.x - b.x).map((f) => f.str).join(' ');
            if (fila.trim()) lineasTotales.push(fila);
          });
      }

      return lineasTotales.join('\n');
    }

    function aplicarResultadoDdjj(result) {
      if (result && (result.stAnterior > 0 || result.sldAnterior > 0 || result.cuit)) {
        if (result.stAnterior > 0) contribuyente.stAnterior = result.stAnterior;
        if (result.sldAnterior > 0) contribuyente.sldAnterior = result.sldAnterior;
        if (result.cuit) contribuyente.cuit = result.cuit;
        if (result.razon) contribuyente.razon = result.razon;

        document.getElementById('header-razon-social').innerText = contribuyente.razon;
        document.getElementById('header-cuit').innerText = `CUIT: ${contribuyente.cuit} | Resp. Inscripto`;

        saveState();
        recalculateAll();

        alert(`✅ ¡DDJJ del Período Anterior Procesada Exitosamente!\n\n• Saldo Técnico (1er Párrafo Art. 24): $${contribuyente.stAnterior.toLocaleString('es-AR', {minimumFractionDigits:2})}\n• Saldo Libre Disponibilidad (2do Párrafo Art. 24): $${contribuyente.sldAnterior.toLocaleString('es-AR', {minimumFractionDigits:2})}`);
      } else {
        const stVal = prompt('No se pudieron detectar los saldos automaticamente.\nIngrese el Saldo Tecnico a Favor del periodo anterior ($) (1er Parrafo Art. 24):', contribuyente.stAnterior);
        const sldVal = prompt('Ingrese el Saldo de Libre Disponibilidad del periodo anterior ($) (2do Parrafo Art. 24):', contribuyente.sldAnterior);

        if (stVal !== null) contribuyente.stAnterior = parseFloat(stVal) || 0;
        if (sldVal !== null) contribuyente.sldAnterior = parseFloat(sldVal) || 0;

        saveState();
        recalculateAll();
        alert('Saldos del periodo anterior actualizados correctamente.');
      }
    }

    inputFileDdjj?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const esPdf = file.name.toLowerCase().endsWith('.pdf');

      try {
        if (esPdf) {
          const arrayBuffer = await file.arrayBuffer();
          const texto = await extraerTextoPdf(arrayBuffer);
          const result = CsvParser.parseDDJJAnterior(texto);
          aplicarResultadoDdjj(result);
        } else {
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const text = event.target.result;
              const result = CsvParser.parseDDJJAnterior(text);
              aplicarResultadoDdjj(result);
            } catch (err) {
              alert('Error al leer el archivo de la DDJJ anterior: ' + err.message);
            }
          };
          reader.readAsText(file, 'ISO-8859-1');
        }
      } catch (err) {
        console.error(err);
        alert('❌ No se pudo leer el PDF de la DDJJ anterior: ' + err.message + '\nPodes ingresar los saldos manualmente desde "Ajustar Periodo / Saldos".');
      } finally {
        inputFileDdjj.value = '';
      }
    });

    // ===== CARGA POR TIPO EXPLÍCITO: EMITIDOS / RECIBIDOS / IMPORTACIÓN =====
    // Cada zona tiene su propio input y fuerza su propio tipoOp — la app ya no
    // tiene que adivinar si un archivo es de venta o de compra.
    const ZONAS_IMPORT = [
      { dropzoneId: 'dropzone-emitidos', btnSelectId: 'btn-select-emitidos', btnPegarId: 'btn-pegar-emitidos', inputId: 'input-file-emitidos', tipo: 'venta', label: 'Comprobantes EMITIDOS (Ventas)' },
      { dropzoneId: 'dropzone-recibidos', btnSelectId: 'btn-select-recibidos', btnPegarId: 'btn-pegar-recibidos', inputId: 'input-file-recibidos', tipo: 'compra', label: 'Comprobantes RECIBIDOS (Compras)' },
      { dropzoneId: 'dropzone-impo', btnSelectId: 'btn-select-impo', btnPegarId: 'btn-pegar-impo', inputId: 'input-file-impo', tipo: 'importacion', label: 'Despachos de Importación' },
    ];

    const modalPegar = document.getElementById('modal-pegar-texto');
    const formPegar = document.getElementById('form-pegar-texto');
    let tipoActivoPegado = null; // qué zona abrió el modal de "Pegar Texto"

    ZONAS_IMPORT.forEach((zona) => {
      const dropzone = document.getElementById(zona.dropzoneId);
      const input = document.getElementById(zona.inputId);
      if (!dropzone || !input) return;

      document.getElementById(zona.btnSelectId)?.addEventListener('click', () => input.click());

      input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        processFile(file, zona.tipo, zona.label);
        input.value = '';
      });

      ['dragenter', 'dragover'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        }, false);
      });

      ['dragleave', 'drop'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
        }, false);
      });

      dropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) processFile(files[0], zona.tipo, zona.label);
      });

      document.getElementById(zona.btnPegarId)?.addEventListener('click', () => {
        tipoActivoPegado = zona.tipo;
        document.getElementById('modal-pegar-titulo').innerText = `Pegar texto — ${zona.label}`;
        document.getElementById('txt-paste-content').value = '';
        modalPegar.classList.remove('hidden');
      });
    });

    document.getElementById('btn-close-pegar')?.addEventListener('click', () => modalPegar.classList.add('hidden'));
    document.getElementById('btn-cancel-pegar')?.addEventListener('click', () => modalPegar.classList.add('hidden'));

    formPegar?.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = document.getElementById('txt-paste-content').value;
      if (!text || text.trim().length === 0) {
        alert('Por favor ingrese el texto de los comprobantes.');
        return;
      }

      const imported = CsvParser.parseArcaCSV(text, tipoActivoPegado);
      if (imported && imported.length > 0) {
        sistemaVouchers = [...sistemaVouchers, ...imported];
        arcaVouchers = [...arcaVouchers, ...imported];
        saveState();
        recalculateAll();
        modalPegar.classList.add('hidden');
        avisarResultadoImport(imported, 'el texto pegado');
      } else {
        alert('No se pudieron reconocer datos de comprobantes. Revisa el formato de separación por coma o punto y coma.');
      }
    });

    // Retenciones / Percepciones ARCA (SIRCER) — no fuerza venta/compra, se
    // detecta por el propio contenido del archivo (retenido/percibido/agente).
    const inputFileRetenciones = document.getElementById('input-file-retenciones');
    document.getElementById('btn-import-retenciones-top')?.addEventListener('click', () => {
      inputFileRetenciones?.click();
    });
    inputFileRetenciones?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      processFile(file, null, 'Retenciones / Percepciones');
      inputFileRetenciones.value = '';
    });

    function avisarResultadoImport(imported, origen) {
      const ventasCount = imported.filter(x => x.tipoOp === 'venta' || x.tipoOp === 'exportacion').length;
      const comprasCount = imported.filter(x => x.tipoOp === 'compra' || x.tipoOp === 'importacion').length;
      const todosEnCero = imported.every(v => !v.neto || v.neto === 0);

      if (todosEnCero) {
        const headerDetectada = imported._headerLineDetectada || '(no disponible)';
        console.warn('Encabezado detectado en el archivo importado:', headerDetectada);
        alert(`⚠️ Se cargaron ${imported.length} filas desde ${origen}, pero todas quedaron con importe $0,00.\n\nEsto quiere decir que la app no reconoció la columna de "Importe Neto Gravado" en este archivo.\n\nEncabezado detectado:\n${headerDetectada}\n\nRevisá esa línea y avisale a tu desarrollador con este texto exacto para ajustar la detección de columnas.`);
      } else {
        alert(`✅ ¡Importación Exitosa desde "${origen}"!\n\n• Comprobantes cargados: ${imported.length}\n• Compras / Despachos: ${comprasCount}\n• Ventas / Exportaciones: ${ventasCount}`);
      }
    }

    function processFile(file, tipoForzado, label) {
      if (!file) return;
      const fileName = file.name.toLowerCase();
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

      const reader = new FileReader();

      reader.onload = (event) => {
        try {
          let text = '';
          if (isExcel && typeof XLSX !== 'undefined') {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            text = XLSX.utils.sheet_to_csv(worksheet, { FS: ';' });
          } else {
            text = event.target.result;
          }

          const imported = CsvParser.parseArcaCSV(text, tipoForzado);

          if (imported && imported.length > 0) {
            sistemaVouchers = [...sistemaVouchers, ...imported];
            arcaVouchers = [...arcaVouchers, ...imported];
            saveState();
            recalculateAll();
            avisarResultadoImport(imported, `"${file.name}" (${label || 'archivo'})`);
          } else {
            alert(`⚠️ No se pudieron reconocer registros en "${file.name}".\nVerifica que el archivo contenga comprobantes válidos o las columnas de Mis Comprobantes ARCA.`);
          }
        } catch (err) {
          console.error('Error al procesar el archivo:', err);
          alert('❌ Ocurrió un error al procesar el archivo: ' + err.message);
        }
      };

      if (isExcel) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file, 'ISO-8859-1');
      }
    }

    // Navigation Tabs
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        const targetTab = document.getElementById(tab.dataset.tab);
        if (targetTab) targetTab.classList.add('active');

        // Re-render specific views if needed
        if (tab.dataset.tab === 'tab-conciliador') {
          runReconciliation();
        } else if (tab.dataset.tab === 'tab-simulador') {
          updateSimulatorView();
        } else if (tab.dataset.tab === 'tab-papeles') {
          renderWorkingPaper();
        } else if (tab.dataset.tab === 'tab-ddjj') {
          renderF2002Preview();
        }
      });
    });

    // Cargar Demo Button
    document.getElementById('btn-cargar-demo')?.addEventListener('click', () => {
      if (confirm('¿Deseas reemplazar los datos actuales con el Caso Demo de demostración (Logística & Impex S.A.)?')) {
        contribuyente = { ...MockData.defaultContribuyente };
        sistemaVouchers = [...MockData.defaultSistemaVouchers];
        arcaVouchers = [...MockData.defaultArcaVouchers];

        document.getElementById('header-razon-social').innerText = contribuyente.razon;
        document.getElementById('header-cuit').innerText = `CUIT: ${contribuyente.cuit} | Resp. Inscripto`;
        saveState();
        recalculateAll();
      }
    });

    // Limpiar Comprobantes Button
    document.getElementById('btn-limpiar-comprobantes')?.addEventListener('click', () => {
      if (confirm(`¿Estás seguro de blanquear todos los comprobantes del CUIT ${contribuyente.cuit}?`)) {
        sistemaVouchers = [];
        arcaVouchers = [];
        saveState();

        // Barrido de seguridad: por versiones anteriores del guardado, podían
        // quedar claves de este mismo CUIT con distinto formato (con/sin guiones).
        // Las eliminamos todas para que no vuelva a aparecer data vieja al recargar.
        try {
          const digitos = cuitKey(contribuyente.cuit);
          Object.keys(localStorage).forEach((k) => {
            if (!/^iva_(sys|arca)_/.test(k)) return;
            const kDigitos = k.replace(/^iva_(sys|arca)_/, '').replace(/\D/g, '');
            if (kDigitos === digitos) localStorage.removeItem(k);
          });
        } catch (e) {
          console.warn('No se pudo limpiar claves antiguas:', e);
        }

        recalculateAll();
      }
    });

    // Nuevo Comprobante Modal
    document.getElementById('btn-nuevo-comprobante')?.addEventListener('click', () => {
      formComp.reset();
      document.getElementById('comp-fecha').value = new Date().toISOString().substring(0, 10);
      modalComp.classList.remove('hidden');
    });

    document.getElementById('btn-close-modal')?.addEventListener('click', () => modalComp.classList.add('hidden'));
    document.getElementById('btn-cancel-modal')?.addEventListener('click', () => modalComp.classList.add('hidden'));

    formComp?.addEventListener('submit', (e) => {
      e.preventDefault();
      const newV = {
        id: 'v_' + Date.now(),
        fecha: document.getElementById('comp-fecha').value,
        tipoOp: document.getElementById('comp-tipo-op').value,
        tipoDoc: document.getElementById('comp-tipo-doc').value,
        numero: document.getElementById('comp-numero').value,
        cuit: document.getElementById('comp-cuit').value,
        razon: document.getElementById('comp-razon').value,
        neto: parseFloat(document.getElementById('comp-neto').value) || 0,
        alicuota: parseFloat(document.getElementById('comp-alicuota').value) || 0,
        retenciones: parseFloat(document.getElementById('comp-retenciones').value) || 0,
        esAduanera: document.getElementById('comp-es-aduanera').value
      };

      sistemaVouchers.push(newV);
      modalComp.classList.add('hidden');
      saveState();
      recalculateAll();
    });

    // Config Contribuyente Modal
    document.getElementById('btn-config-contribuyente')?.addEventListener('click', () => {
      document.getElementById('cfg-razon').value = contribuyente.razon;
      document.getElementById('cfg-cuit').value = contribuyente.cuit;
      document.getElementById('cfg-st-anterior').value = contribuyente.stAnterior;
      document.getElementById('cfg-sld-anterior').value = contribuyente.sldAnterior;
      modalConfig.classList.remove('hidden');
    });

    document.getElementById('btn-cfg-buscar-padron')?.addEventListener('click', async () => {
      const cuitVal = document.getElementById('cfg-cuit').value;
      if (!cuitVal) return alert('Ingrese un CUIT válido.');
      try {
        const info = await ArcaApi.consultarPadron(cuitVal);
        document.getElementById('cfg-cuit').value = info.cuit;
        document.getElementById('cfg-razon').value = info.razon;
        alert(`CUIT Consultado exitosamente:\n• Razón Social: ${info.razon}\n• Condición: ${info.condicion}`);
      } catch(e) {
        alert(e.message);
      }
    });

    document.getElementById('btn-close-config')?.addEventListener('click', () => modalConfig.classList.add('hidden'));
    document.getElementById('btn-cancel-config')?.addEventListener('click', () => modalConfig.classList.add('hidden'));

    formConfig?.addEventListener('submit', (e) => {
      e.preventDefault();
      const oldCuit = contribuyente.cuit;
      const newCuit = document.getElementById('cfg-cuit').value.trim();
      const resetVouchers = document.getElementById('cfg-limpiar-vouchers').checked;

      contribuyente.razon = document.getElementById('cfg-razon').value.trim();
      contribuyente.cuit = newCuit;
      contribuyente.stAnterior = parseFloat(document.getElementById('cfg-st-anterior').value) || 0;
      contribuyente.sldAnterior = parseFloat(document.getElementById('cfg-sld-anterior').value) || 0;

      document.getElementById('header-razon-social').innerText = contribuyente.razon;
      document.getElementById('header-cuit').innerText = `CUIT: ${contribuyente.cuit} | Resp. Inscripto`;

      // Si cambió el CUIT o se seleccionó blanquear
      if (cuitKey(oldCuit) !== cuitKey(newCuit) || resetVouchers) {
        // Intentar cargar datos existentes guardados para este nuevo CUIT
        const key = cuitKey(newCuit);
        const savedSys = localStorage.getItem('iva_sys_' + key);
        const savedArca = localStorage.getItem('iva_arca_' + key);

        if (savedSys && !resetVouchers) {
          sistemaVouchers = JSON.parse(savedSys);
          arcaVouchers = savedArca ? JSON.parse(savedArca) : [];
        } else {
          sistemaVouchers = [];
          arcaVouchers = [];
        }
      }

      modalConfig.classList.add('hidden');
      saveState();
      recalculateAll();
    });

    // Descargar Plantillas Modal
    const modalPlantillas = document.getElementById('modal-plantillas');
    document.getElementById('btn-descargar-plantillas')?.addEventListener('click', () => {
      modalPlantillas?.classList.remove('hidden');
    });

    document.getElementById('btn-close-plantillas')?.addEventListener('click', () => modalPlantillas?.classList.add('hidden'));
    document.getElementById('btn-cancel-plantillas')?.addEventListener('click', () => modalPlantillas?.classList.add('hidden'));

    document.getElementById('btn-tpl-maestra')?.addEventListener('click', () => ExportEngine.downloadTemplate('maestra'));
    document.getElementById('btn-tpl-ventas')?.addEventListener('click', () => ExportEngine.downloadTemplate('ventas'));
    document.getElementById('btn-tpl-compras')?.addEventListener('click', () => ExportEngine.downloadTemplate('compras'));
    document.getElementById('btn-tpl-impo')?.addEventListener('click', () => ExportEngine.downloadTemplate('impo'));
    document.getElementById('btn-tpl-retenciones')?.addEventListener('click', () => ExportEngine.downloadTemplate('retenciones'));

    // Re-ejecutar Cruce
    document.getElementById('btn-ejecutar-cruce')?.addEventListener('click', () => {
      runReconciliation();
    });

    // Filter Search
    document.getElementById('filter-search')?.addEventListener('input', renderComprobantesTable);
    document.getElementById('filter-tipo')?.addEventListener('change', renderComprobantesTable);

    // SIMULATOR CONTROLS (REAL-TIME REACTIVE)
    const simRange = document.getElementById('sim-prorrateo-range');
    const simVal = document.getElementById('sim-prorrateo-val');
    const simImpo = document.getElementById('sim-incluir-impo');
    const simPercep = document.getElementById('sim-incluir-percep-aduaneras');
    const simArt43 = document.getElementById('sim-solicitar-art43');

    simRange?.addEventListener('input', (e) => {
      simParams.prorrateoPct = parseFloat(e.target.value);
      simVal.innerText = `${simParams.prorrateoPct}% Computable`;
      updateSimulatorView();
    });

    simImpo?.addEventListener('change', (e) => {
      simParams.incluirImpo = e.target.checked;
      updateSimulatorView();
    });

    simPercep?.addEventListener('change', (e) => {
      simParams.incluirPercepAduaneras = e.target.checked;
      updateSimulatorView();
    });

    simArt43?.addEventListener('change', (e) => {
      simParams.solicitarArt43 = e.target.checked;
      updateSimulatorView();
    });

    // EXPORT BUTTONS
    document.getElementById('btn-export-excel')?.addEventListener('click', () => {
      const summary = TaxEngine.calculateIVA(sistemaVouchers, {
        stAnterior: contribuyente.stAnterior,
        sldAnterior: contribuyente.sldAnterior,
        ...simParams
      });
      ExportEngine.exportWorkingPaperCSV(summary, contribuyente);
    });

    document.getElementById('btn-print-papeles')?.addEventListener('click', () => {
      window.print();
    });

    document.getElementById('btn-export-lid-ventas')?.addEventListener('click', () => {
      const txt = ExportEngine.generateLIDVentasTXT(sistemaVouchers);
      ExportEngine.downloadFile(`LID_VENTAS_${contribuyente.cuit}.txt`, txt);
    });

    document.getElementById('btn-export-lid-compras')?.addEventListener('click', () => {
      const txt = ExportEngine.generateLIDComprasTXT(sistemaVouchers);
      ExportEngine.downloadFile(`LID_COMPRAS_${contribuyente.cuit}.txt`, txt);
    });

    document.getElementById('btn-export-lid-impo')?.addEventListener('click', () => {
      const txt = ExportEngine.generateLIDImportacionesTXT(sistemaVouchers);
      ExportEngine.downloadFile(`LID_IMPORTACIONES_${contribuyente.cuit}.txt`, txt);
    });
  }

  // ----------------------------------------------------
  // RECALCULATE & RENDER ALL
  // ----------------------------------------------------
  function recalculateAll() {
    // Calculate base Tax Engine summary
    const summary = TaxEngine.calculateIVA(sistemaVouchers, {
      stAnterior: contribuyente.stAnterior,
      sldAnterior: contribuyente.sldAnterior,
      ...simParams
    });

    // Update Live Banner
    liveDf.innerText = formatMoney(summary.dfTotal);
    liveCf.innerText = formatMoney(summary.cfComputableTotal);
    liveSt.innerText = formatMoney(summary.saldoTecnicoResultante);
    liveRet.innerText = formatMoney(summary.totalPagosACuenta);

    const cantVentas = sistemaVouchers.filter(v => v.tipoOp === 'venta' || v.tipoOp === 'exportacion').length;
    const cantCompras = sistemaVouchers.filter(v => v.tipoOp === 'compra' || v.tipoOp === 'importacion').length;
    const liveDfSub = document.getElementById('live-df-sub');
    const liveCfSub = document.getElementById('live-cf-sub');
    if (liveDfSub) liveDfSub.innerText = `${cantVentas} comprobantes ventas`;
    if (liveCfSub) liveCfSub.innerText = `${cantCompras} comprobantes compras · Incluye Impo & Prorrateo`;

    if (summary.saldoTecnicoResultante > 0) {
      liveStBadge.className = 'badge-status st-favor';
      liveStBadge.innerText = 'ST a Favor';
    } else {
      liveStBadge.className = 'badge-status st-pagar';
      liveStBadge.innerText = 'Sin Saldo Técnico';
    }

    if (summary.impuestoAPagar > 0) {
      livePos.innerText = formatMoney(summary.impuestoAPagar);
      livePosBadge.className = 'badge-status st-pagar';
      livePosBadge.innerText = 'IMPUESTO A PAGAR';
    } else {
      livePos.innerText = formatMoney(summary.saldoLibreDisponibilidadResultante);
      livePosBadge.className = 'badge-status st-favor';
      livePosBadge.innerText = 'SLD A FAVOR';
    }

    // Render Comprobantes Table
    renderComprobantesTable();

    // Run reconciliation matching
    runReconciliation();

    // Render Working Paper
    renderWorkingPaper();

    // Render F.2002 Summary
    renderF2002Preview();
  }

  // ----------------------------------------------------
  // RENDER COMPROBANTES TABLE
  // ----------------------------------------------------
  function renderComprobantesTable() {
    const tbody = document.getElementById('tbody-comprobantes');
    if (!tbody) return;

    const searchTerm = (document.getElementById('filter-search')?.value || '').toLowerCase();
    const filterTipo = document.getElementById('filter-tipo')?.value || 'todos';

    const filtered = sistemaVouchers.filter(v => {
      const matchSearch = v.cuit.includes(searchTerm) || v.razon.toLowerCase().includes(searchTerm) || v.numero.includes(searchTerm);
      const matchTipo = filterTipo === 'todos' || v.tipoOp === filterTipo;
      return matchSearch && matchTipo;
    });

    tbody.innerHTML = '';

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="13" style="text-align:center; padding: 2rem; color: #94a3b8;">No se encontraron comprobantes registrados.</td></tr>`;
      return;
    }

    filtered.forEach(v => {
      let df = 0;
      let cf = 0;

      if (v.tipoOp === 'venta') {
        df = parseFloat(v.df || v.iva) || ((v.neto * v.alicuota) / 100);
      } else if (v.tipoOp === 'compra' || v.tipoOp === 'importacion') {
        cf = parseFloat(v.cf || v.iva) || ((v.neto * v.alicuota) / 100);
      }

      let badgeClass = 'venta';
      let labelOp = 'Venta Loc.';
      if (v.tipoOp === 'exportacion') { badgeClass = 'exportacion'; labelOp = 'Exportación (E)'; }
      else if (v.tipoOp === 'compra') { badgeClass = 'compra'; labelOp = 'Compra Loc.'; }
      else if (v.tipoOp === 'importacion') { badgeClass = 'importacion'; labelOp = 'Despacho Impo'; }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${v.fecha}</td>
        <td><span class="badge-op ${badgeClass}">${labelOp}</span></td>
        <td><strong>${v.tipoDoc}</strong><br><small>${v.numero}</small></td>
        <td>${v.cuit}</td>
        <td>${v.razon}</td>
        <td class="text-right">$${v.neto.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
        <td>${v.alicuota}%</td>
        <td class="text-right">${df > 0 ? '$' + df.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '-'}</td>
        <td class="text-right">${cf > 0 ? '$' + cf.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '-'}</td>
        <td class="text-right">${v.retenciones > 0 ? '$' + v.retenciones.toLocaleString('es-AR', {minimumFractionDigits: 2}) : '-'}</td>
        <td>${v.esAduanera === 'si' ? 'Aduana RG 5339' : 'Mercado Interno'}</td>
        <td><span class="badge-status st-favor">🟢 Registrado</span></td>
        <td>
          <button class="btn btn-outline btn-sm btn-delete-comp" data-id="${v.id}" title="Eliminar"><i class="ri-delete-bin-line"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Delete event listeners
    document.querySelectorAll('.btn-delete-comp').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.dataset.id;
        sistemaVouchers = sistemaVouchers.filter(x => x.id !== id);
        saveState();
        recalculateAll();
      });
    });
  }

  // ----------------------------------------------------
  // RUN RECONCILIATION MATCHING
  // ----------------------------------------------------
  function runReconciliation() {
    const reconData = ArcaReconciler.reconcile(sistemaVouchers, arcaVouchers);

    document.getElementById('recon-stat-ok').innerText = reconData.okCount;
    document.getElementById('recon-stat-diff').innerText = reconData.diffCount;
    document.getElementById('recon-stat-missing').innerText = reconData.missingCount;
    document.getElementById('badge-discrepancias').innerText = reconData.diffCount + reconData.missingCount;

    const tbody = document.getElementById('tbody-conciliacion');
    if (!tbody) return;

    tbody.innerHTML = '';

    reconData.results.forEach(res => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${res.comprobante}</strong></td>
        <td>${res.cuitContraparte}</td>
        <td>$${res.montoSistema.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
        <td>$${res.montoArca.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
        <td class="text-right" style="color: ${res.diferenciaIva > 0 ? '#ef4444' : '#10b981'}; font-weight:700;">
          $${res.diferenciaIva.toLocaleString('es-AR', {minimumFractionDigits: 2})}
        </td>
        <td><span class="${res.badgeClass}">${res.badgeText}</span></td>
        <td style="max-width: 300px; font-size: 0.8rem;">${res.diagnostico}</td>
        <td>
          ${res.status === 'SOLO_EN_ARCA' ? `<button class="btn btn-primary btn-sm btn-incorporar-arca" data-num="${res.vArca.numero}">+ Incorporar a Libros</button>` : '<span style="color:#94a3b8;">-</span>'}
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-incorporar-arca').forEach(btn => {
      btn.addEventListener('click', () => {
        const num = btn.dataset.num;
        const vToIncorporate = arcaVouchers.find(a => a.numero === num);
        if (vToIncorporate) {
          sistemaVouchers.push({
            ...vToIncorporate,
            id: 'v_inc_' + Date.now()
          });
          recalculateAll();
          alert('Comprobante incorporado correctamente desde los registros de ARCA a los libros locales.');
        }
      });
    });
  }

  // ----------------------------------------------------
  // UPDATE SIMULATOR PREVIEW VIEW
  // ----------------------------------------------------
  function updateSimulatorView() {
    const origSummary = TaxEngine.calculateIVA(sistemaVouchers, {
      stAnterior: contribuyente.stAnterior,
      sldAnterior: contribuyente.sldAnterior,
      prorrateoPct: 100,
      incluirImpo: true,
      incluirPercepAduaneras: true,
      solicitarArt43: true
    });

    const modSummary = TaxEngine.calculateIVA(sistemaVouchers, {
      stAnterior: contribuyente.stAnterior,
      sldAnterior: contribuyente.sldAnterior,
      ...simParams
    });

    // Actualizar montos dinámicos en etiquetas de los switches
    document.getElementById('sim-impo-monto').innerText = origSummary.impoIVATotal.toLocaleString('es-AR', {minimumFractionDigits: 2});
    document.getElementById('sim-percep-aduaneras-monto').innerText = origSummary.percepAduanerasTotal.toLocaleString('es-AR', {minimumFractionDigits: 2});

    // Rellenar original
    document.getElementById('sim-orig-df').innerText = formatMoney(origSummary.dfTotal);
    document.getElementById('sim-orig-cf').innerText = formatMoney(origSummary.cfComputableTotal);
    document.getElementById('sim-orig-st').innerText = formatMoney(origSummary.saldoTecnicoResultante);
    document.getElementById('sim-orig-ret').innerText = formatMoney(origSummary.totalPagosACuenta);
    document.getElementById('sim-orig-res').innerText = origSummary.impuestoAPagar > 0 ? formatMoney(origSummary.impuestoAPagar) + ' (Pagar)' : formatMoney(origSummary.saldoLibreDisponibilidadResultante) + ' (SLD)';

    // Rellenar simulado
    document.getElementById('sim-mod-df').innerText = formatMoney(modSummary.dfTotal);
    document.getElementById('sim-mod-cf').innerText = formatMoney(modSummary.cfComputableTotal);
    document.getElementById('sim-mod-st').innerText = formatMoney(modSummary.saldoTecnicoResultante);
    document.getElementById('sim-mod-ret').innerText = formatMoney(modSummary.totalPagosACuenta);
    document.getElementById('sim-mod-res').innerText = modSummary.impuestoAPagar > 0 ? formatMoney(modSummary.impuestoAPagar) + ' (Pagar)' : formatMoney(modSummary.saldoLibreDisponibilidadResultante) + ' (SLD)';

    const recAlert = document.getElementById('sim-recommendation');
    if (modSummary.impuestoAPagar < origSummary.impuestoAPagar) {
      const ahorro = origSummary.impuestoAPagar - modSummary.impuestoAPagar;
      recAlert.innerHTML = `<i class="ri-checkbox-circle-line"></i> <strong>Optimización Detectada:</strong> La simulación actual reduce el impuesto a pagar en $${ahorro.toLocaleString('es-AR', {minimumFractionDigits: 2})}.`;
    } else {
      recAlert.innerHTML = `<i class="ri-information-line"></i> Moviendo los controles puedes simular diferir cómputos o solicitar recuperos de exportación Art. 43.`;
    }
  }

  // ----------------------------------------------------
  // RENDER WORKING PAPERS
  // ----------------------------------------------------
  function renderWorkingPaper() {
    const summary = TaxEngine.calculateIVA(sistemaVouchers, {
      stAnterior: contribuyente.stAnterior,
      sldAnterior: contribuyente.sldAnterior,
      ...simParams
    });

    document.getElementById('wp-razon').innerText = contribuyente.razon;
    document.getElementById('wp-cuit').innerText = contribuyente.cuit;

    // 1. Débito Fiscal
    const tbodyDf = document.getElementById('wp-tbody-df');
    tbodyDf.innerHTML = `
      <tr><td>Ventas Gravadas al 21%</td><td class="text-right">$${summary.dfNetoPorAlicuota[21].toLocaleString('es-AR', {minimumFractionDigits: 2})}</td><td class="text-right">$${summary.dfPorAlicuota[21].toLocaleString('es-AR', {minimumFractionDigits: 2})}</td></tr>
      <tr><td>Ventas Gravadas al 10.5%</td><td class="text-right">$${summary.dfNetoPorAlicuota[10.5].toLocaleString('es-AR', {minimumFractionDigits: 2})}</td><td class="text-right">$${summary.dfPorAlicuota[10.5].toLocaleString('es-AR', {minimumFractionDigits: 2})}</td></tr>
      <tr><td>Ventas Gravadas al 27%</td><td class="text-right">$${summary.dfNetoPorAlicuota[27].toLocaleString('es-AR', {minimumFractionDigits: 2})}</td><td class="text-right">$${summary.dfPorAlicuota[27].toLocaleString('es-AR', {minimumFractionDigits: 2})}</td></tr>
      <tr style="font-weight:700; background:#f8fafc;"><td>TOTAL DÉBITO FISCAL</td><td class="text-right">$${summary.dfNetoTotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td><td class="text-right">$${summary.dfTotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td></tr>
    `;

    // 2. Crédito Fiscal
    const tbodyCf = document.getElementById('wp-tbody-cf');
    tbodyCf.innerHTML = `
      <tr><td>Compras Locales Gravadas (21%, 10.5%, 27%)</td><td class="text-right">$${summary.cfNetoTotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td><td class="text-right">$${summary.cfTotalBruto.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td></tr>
      <tr><td>Despachos de Importación SIM (Aduana)</td><td class="text-right">$${summary.impoNetoTotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td><td class="text-right">$${summary.impoIVATotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td></tr>
      <tr><td>Prorrateo Computable (${simParams.prorrateoPct}%)</td><td class="text-right">-</td><td class="text-right">$${summary.cfComputableTotal.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td></tr>
    `;

    // 3. Exportación
    document.getElementById('wp-expo-monto').innerText = formatMoney(summary.expoNetoTotal);
    document.getElementById('wp-expo-cf-vinculado').innerText = formatMoney(summary.cfVinculadoExportacion);

    // 4. Determinación Impositiva
    document.getElementById('wp-calc-df').innerText = formatMoney(summary.dfTotal);
    document.getElementById('wp-calc-cf').innerText = `(${formatMoney(summary.cfComputableTotal)})`;
    document.getElementById('wp-calc-subtotal').innerText = formatMoney(summary.subtotalDebitoCredito);
    document.getElementById('wp-calc-st-anterior').innerText = `(${formatMoney(summary.stAnterior)})`;
    document.getElementById('wp-calc-st-final').innerText = formatMoney(summary.saldoTecnicoResultante);

    document.getElementById('wp-calc-retenciones').innerText = `(${formatMoney(summary.retencionesLocales)})`;
    document.getElementById('wp-calc-percepciones').innerText = `(${formatMoney(summary.percepcionesLocales)})`;
    document.getElementById('wp-calc-percep-aduaneras').innerText = `(${formatMoney(summary.percepAduanerasTotal)})`;
    document.getElementById('wp-calc-sld-anterior').innerText = `(${formatMoney(summary.sldAnterior)})`;

    const finalLabel = document.getElementById('wp-final-label');
    const finalVal = document.getElementById('wp-calc-final-res');

    if (summary.impuestoAPagar > 0) {
      finalLabel.innerText = 'IMPUESTO NETO A PAGAR (A ARCA):';
      finalVal.innerText = formatMoney(summary.impuestoAPagar);
    } else {
      finalLabel.innerText = 'SALDO A FAVOR DE LIBRE DISPONIBILIDAD RESULTANTE:';
      finalVal.innerText = formatMoney(summary.saldoLibreDisponibilidadResultante);
    }
  }

  // ----------------------------------------------------
  // RENDER F.2002 PREVIEW
  // ----------------------------------------------------
  function renderF2002Preview() {
    const summary = TaxEngine.calculateIVA(sistemaVouchers, {
      stAnterior: contribuyente.stAnterior,
      sldAnterior: contribuyente.sldAnterior,
      ...simParams
    });

    document.getElementById('f2002-neto-ventas').innerText = formatMoney(summary.dfNetoTotal);
    document.getElementById('f2002-df').innerText = formatMoney(summary.dfTotal);
    document.getElementById('f2002-expo-neto').innerText = formatMoney(summary.expoNetoTotal);
    document.getElementById('f2002-neto-compras').innerText = formatMoney(summary.cfNetoTotal);
    document.getElementById('f2002-neto-impo').innerText = formatMoney(summary.impoNetoTotal);
    document.getElementById('f2002-cf').innerText = formatMoney(summary.cfComputableTotal);

    if (summary.impuestoAPagar > 0) {
      document.getElementById('f2002-saldo-final').innerText = formatMoney(summary.impuestoAPagar) + ' A PAGAR';
    } else {
      document.getElementById('f2002-saldo-final').innerText = formatMoney(summary.saldoLibreDisponibilidadResultante) + ' A FAVOR (SLD)';
    }
  }

  // Utility Formatter
  function formatMoney(amount) {
    return '$' + (amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
});
