/**
 * Main UI Controller & Application Orchestrator
 * Connects TaxEngine, ArcaReconciler, CsvParser, ExportEngine & MockData.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Global State
  let contribuyente = { ...MockData.defaultContribuyente };
  let sistemaVouchers = [...MockData.defaultSistemaVouchers];
  let arcaVouchers = [...MockData.defaultArcaVouchers];

  const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  // Clave de almacenamiento CANÓNICA: siempre en base a los dígitos del CUIT,
  // sin importar si en pantalla se guardó/escribió con o sin guiones. Así
  // "Limpiar Todo", guardar e importar SIEMPRE leen/escriben la misma clave.
  function cuitKey(cuit) {
    return String(cuit || '').replace(/\D/g, '');
  }

  // Todo texto que venga de archivos o de ARCA pasa por acá antes de ir a
  // innerHTML, para que un nombre raro no rompa la pantalla.
  function escapeHtml(valor) {
    return String(valor == null ? '' : valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function leerCfgCuit(key) {
    try {
      const raw = localStorage.getItem('iva_cfg_' + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function actualizarHeader() {
    document.getElementById('header-razon-social').innerText = contribuyente.razon || '';
    document.getElementById('header-cuit').innerText =
      `CUIT: ${contribuyente.cuit || '-'} | ${contribuyente.condicion || 'Resp. Inscripto'}`;
  }

  function money(n) {
    return (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    mostrarEstadoArca();
  }

  async function mostrarEstadoArca() {
    const btn = document.getElementById('btn-quick-buscar-cuit');
    if (!btn || !window.ArcaApi || !ArcaApi.estado) return;
    const est = await ArcaApi.estado();
    let texto;
    if (est.configurado) {
      texto = `Conectado a ARCA (${est.environment === 'production' ? 'producción' : 'homologación'})`;
    } else if (est.sinServidor) {
      texto = 'Sin conexión a ARCA: abrí la app con iniciar.bat. La búsqueda funciona en modo manual.';
    } else {
      texto = est.error ? `ARCA con error de configuración: ${est.error}` : 'ARCA sin configurar (ver README-ARCA-SETUP.md). La búsqueda funciona en modo manual.';
    }
    btn.title = texto;
    let badge = document.getElementById('arca-estado');
    if (!badge) {
      badge = document.createElement('small');
      badge.id = 'arca-estado';
      badge.style.cssText = 'display:block; font-size:0.7rem; margin-top:0.25rem; opacity:0.85;';
      btn.parentElement?.appendChild(badge);
    }
    badge.textContent = (est.configurado ? '🟢 ' : '⚪ ') + texto;
  }

  function saveState() {
    try {
      localStorage.setItem('iva_contribuyente', JSON.stringify(contribuyente));
      const key = cuitKey(contribuyente.cuit);
      if (key) {
        // Datos propios de cada CUIT (razón social, condición y saldos del período anterior).
        localStorage.setItem('iva_cfg_' + key, JSON.stringify(contribuyente));
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
        actualizarHeader();

        const key = cuitKey(contribuyente.cuit);
        const savedSys = localStorage.getItem('iva_sys_' + key);
        const savedArca = localStorage.getItem('iva_arca_' + key);

        if (savedSys) sistemaVouchers = JSON.parse(savedSys);
        if (savedArca) arcaVouchers = JSON.parse(savedArca);
      }
    } catch(e) {
      console.warn('LocalStorage load error:', e);
    }
    // Limpia duplicados que hayan quedado guardados de importaciones anteriores
    const antes = sistemaVouchers.length + arcaVouchers.length;
    sistemaVouchers = quitarDuplicados(sistemaVouchers);
    arcaVouchers = quitarDuplicados(arcaVouchers);
    if (sistemaVouchers.length + arcaVouchers.length !== antes) saveState();
  }

  // ----------------------------------------------------
  // CONTROL DE COMPROBANTES DUPLICADOS
  // ----------------------------------------------------
  // Un comprobante se identifica por: operación (venta/compra), tipo de
  // comprobante, punto de venta + número, CUIT de la contraparte y alícuota
  // (una factura con varias alícuotas genera una fila por cada una).
  function normTexto(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s*\(.*\)\s*$/, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function normNumero(numero) {
    const s = String(numero || '').trim();
    // Separador de punto de venta: guion, barra o espacio ("00002-00000926", "00002/00000926", "2 926")
    if (/^\s*\d+\s*[-\/ ]\s*\d+\s*$/.test(s)) {
      const [pto, nro] = s.trim().split(/\s*[-\/ ]\s*/);
      const p = parseInt(String(pto).replace(/\D/g, ''), 10) || 0;
      const n = String(nro).replace(/\D/g, '');
      if (n) return `${p}-${parseInt(n, 10)}`;
    }
    const soloDig = s.replace(/\D/g, '');
    // "000200004521" (sin guion): los últimos 8 dígitos son el número
    if (/^\d+$/.test(s.replace(/[\s.]/g, '')) && soloDig.length > 8) {
      return `${parseInt(soloDig.slice(0, -8), 10) || 0}-${parseInt(soloDig.slice(-8), 10)}`;
    }
    return s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '');
  }

  // Mismo número de comprobante y mismo CUIT (sin importar tipo ni alícuota)
  function claveNumeroCuit(v) {
    return normNumero(v.numero) + '|' + String(v.cuit || '').replace(/\D/g, '');
  }

  // Número sin punto de venta (por si se cargó "125" en vez de "00003-00000125")
  function soloNumero(numero) {
    const n = normNumero(numero);
    return n.includes('-') ? n.split('-').pop() : n;
  }

  // ¿Puede ser la misma factura? Compara por CUIT + número, o por
  // CUIT/razón social + importe neto + fecha (por si el número se tipeó distinto)
  function esPosibleDuplicado(a, b) {
    const cuitA = String(a.cuit || '').replace(/\D/g, '');
    const cuitB = String(b.cuit || '').replace(/\D/g, '');
    const mismoCuit = cuitA && cuitA === cuitB;
    const mismaRazon = normTexto(a.razon) && normTexto(a.razon) === normTexto(b.razon);
    const mismoNumero = soloNumero(a.numero) && soloNumero(a.numero) === soloNumero(b.numero);
    const mismoNeto = Math.abs(Math.abs(Number(a.neto) || 0) - Math.abs(Number(b.neto) || 0)) < 0.01;
    const mismaFecha = String(a.fecha || '') === String(b.fecha || '');
    if (mismoCuit && mismoNumero) return true;
    if ((mismoCuit || mismaRazon) && mismoNeto && (mismaFecha || mismoNumero)) return true;
    if (mismaRazon && mismoNumero) return true;
    return false;
  }

  function claveComprobante(v) {
    const grupo = (v.tipoOp === 'venta' || v.tipoOp === 'exportacion') ? 'V' : 'C';
    const ali = Math.round((Number(v.alicuota) || 0) * 100);
    const base = [grupo, normTexto(v.tipoDoc), normNumero(v.numero), String(v.cuit || '').replace(/\D/g, ''), ali];
    // Retenciones / percepciones: muchas no traen número propio, se distinguen además por fecha e importe
    if (/retenci|percepci|certificado|constancia/i.test(String(v.tipoDoc || ''))) {
      base.push(String(v.fecha || ''), Math.round((Number(v.retenciones) || 0) * 100));
    }
    return base.join('|');
  }

  // Devuelve la lista sin duplicados (conserva la primera aparición)
  function quitarDuplicados(lista) {
    const vistos = new Set();
    return (lista || []).filter(v => {
      const k = claveComprobante(v);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  }

  // Agrega 'nuevos' a 'lista' omitiendo los que ya existen (o se repiten en el mismo archivo)
  function agregarSinDuplicados(lista, nuevos) {
    const vistos = new Set((lista || []).map(claveComprobante));
    const agregados = [];
    let duplicados = 0;
    (nuevos || []).forEach(v => {
      const k = claveComprobante(v);
      if (vistos.has(k)) { duplicados++; return; }
      vistos.add(k);
      agregados.push(v);
    });
    return { lista: [...(lista || []), ...agregados], agregados, duplicados };
  }

  // Importa comprobantes a los libros y a la base ARCA sin duplicar
  // Percepciones aduaneras que ya vienen dentro de su despacho (mismo número):
  // si también llegan desde "Mis Retenciones" no se cargan dos veces.
  const numAlfa = (n) => String(n || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  function quitarAduanaRepetida(imported) {
    const despachos = new Set([...sistemaVouchers, ...imported]
      .filter((v) => v.tipoOp === 'importacion' && Number(v.retenciones) > 0)
      .map((v) => numAlfa(v.numero)));
    const quedan = imported.filter((v) => !(v.tipoOp === 'retencion' && v.clase === 'aduanera' && despachos.has(numAlfa(v.numero))));
    quedan._headerLineDetectada = imported._headerLineDetectada;
    return { quedan, aduanaRepetida: imported.length - quedan.length };
  }

  function importarComprobantes(importedOriginal) {
    const { quedan: imported, aduanaRepetida } = quitarAduanaRepetida(importedOriginal);
    const rSys = agregarSinDuplicados(sistemaVouchers, imported);
    const rArca = agregarSinDuplicados(arcaVouchers, imported);
    sistemaVouchers = rSys.lista;
    arcaVouchers = rArca.lista;
    const agregados = rSys.agregados;
    agregados._headerLineDetectada = imported._headerLineDetectada;
    return { agregados, duplicados: rSys.duplicados, aduanaRepetida };
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
          const aviso = info.manual && info.motivoManual ? `(Modo manual: ${info.motivoManual})\n\n` : '';
          const userDefinedName = prompt(`${aviso}CUIT: ${info.cuit}\nIngresá o confirmá la Razón Social / Nombre para este CUIT:`, '');
          if (userDefinedName && userDefinedName.trim().length > 0) {
            razonFinal = userDefinedName.trim().toUpperCase();
          }
        }

        const cambioCuit = cuitKey(contribuyente.cuit) !== cuitKey(info.cuit);
        contribuyente.cuit = info.cuit;
        contribuyente.razon = razonFinal;
        contribuyente.condicion = info.condicion;
        if (cambioCuit) {
          // Si ya había datos guardados de este CUIT, se recuperan; si no, arranca limpio
          // (sin arrastrar los saldos del contribuyente anterior).
          const key = cuitKey(info.cuit);
          const previo = leerCfgCuit(key);
          contribuyente.stAnterior = previo ? Number(previo.stAnterior) || 0 : 0;
          contribuyente.sldAnterior = previo ? Number(previo.sldAnterior) || 0 : 0;
          try {
            const savedSys = localStorage.getItem('iva_sys_' + key);
            const savedArca = localStorage.getItem('iva_arca_' + key);
            sistemaVouchers = savedSys ? JSON.parse(savedSys) : [];
            arcaVouchers = savedArca ? JSON.parse(savedArca) : [];
          } catch (e) { sistemaVouchers = []; arcaVouchers = []; }
        }
        actualizarHeader();

        // Consultar si desea traer registros de ARCA o blanquear para su propia empresa
        const extra = [info.condicionARCA ? `• Condición ARCA: ${info.condicionARCA}` : '', info.domicilio ? `• Domicilio fiscal: ${info.domicilio}` : '']
          .filter(Boolean).join('\n');
        const syncArca = (sistemaVouchers.length || arcaVouchers.length) ? confirm(`Contribuyente configurado:\n• Razón Social: ${contribuyente.razon}\n• CUIT: ${contribuyente.cuit}\n${extra}\n\nEste CUIT ya tiene ${sistemaVouchers.length} comprobantes guardados. ¿Querés blanquearlos para empezar desde cero?`)
          : (alert(`Contribuyente configurado:\n• Razón Social: ${contribuyente.razon}\n• CUIT: ${contribuyente.cuit}\n${extra}`), false);

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
        if (result.cuit && cuitKey(result.cuit) !== cuitKey(contribuyente.cuit)) {
          // La DDJJ es de otro CUIT: se cambia de contribuyente sin pisar los datos del anterior.
          saveState();
          const key = cuitKey(result.cuit);
          const previo = leerCfgCuit(key);
          contribuyente = previo ? { ...previo } : { razon: result.razon || '', cuit: result.cuit, stAnterior: 0, sldAnterior: 0 };
          try {
            const savedSys = localStorage.getItem('iva_sys_' + key);
            const savedArca = localStorage.getItem('iva_arca_' + key);
            sistemaVouchers = savedSys ? JSON.parse(savedSys) : [];
            arcaVouchers = savedArca ? JSON.parse(savedArca) : [];
          } catch (e) { sistemaVouchers = []; arcaVouchers = []; }
          if (result.stAnterior > 0) contribuyente.stAnterior = result.stAnterior;
          if (result.sldAnterior > 0) contribuyente.sldAnterior = result.sldAnterior;
        }
        if (result.razon) contribuyente.razon = result.razon;

        actualizarHeader();

        saveState();
        recalculateAll();

        alert(`✅ ¡DDJJ del Período Anterior Procesada Exitosamente!\n\n• Saldo Técnico (1er Párrafo Art. 24): $${money(contribuyente.stAnterior)}\n• Saldo Libre Disponibilidad (2do Párrafo Art. 24): $${money(contribuyente.sldAnterior)}`);
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
        const { agregados, duplicados, aduanaRepetida } = importarComprobantes(imported);
        saveState();
        recalculateAll();
        modalPegar.classList.add('hidden');
        avisarResultadoImport(agregados, 'el texto pegado', duplicados, aduanaRepetida);
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

    function avisarResultadoImport(imported, origen, duplicados = 0, aduanaRepetida = 0) {
      const omitidos = [];
      if (duplicados > 0) omitidos.push(`• ${duplicados} ya estaban cargados (no se duplicaron)`);
      if (aduanaRepetida > 0) omitidos.push(`• ${aduanaRepetida} percepciones aduaneras ya incluidas en su despacho (no se duplicaron)`);
      const notaOmitidos = omitidos.length ? `\n\nOmitidos:\n${omitidos.join('\n')}` : '';
      if (imported.length === 0) {
        alert(`ℹ️ No se agregó nada nuevo desde ${origen}.${notaOmitidos}`);
        return;
      }
      const ventasCount = imported.filter(x => x.tipoOp === 'venta' || x.tipoOp === 'exportacion').length;
      const comprasCount = imported.filter(x => x.tipoOp === 'compra' || x.tipoOp === 'importacion').length;
      const retCount = imported.filter(x => x.tipoOp === 'retencion').length;
      const todosEnCero = imported.every(v => (!v.neto || v.neto === 0) && !(v.tipoOp === 'retencion' && v.retenciones));

      if (todosEnCero) {
        const headerDetectada = imported._headerLineDetectada || '(no disponible)';
        console.warn('Encabezado detectado en el archivo importado:', headerDetectada);
        alert(`⚠️ Se cargaron ${imported.length} filas desde ${origen}, pero todas quedaron con importe $0,00.\n\nEsto quiere decir que la app no reconoció la columna de "Importe Neto Gravado" en este archivo.\n\nEncabezado detectado:\n${headerDetectada}\n\nRevisá esa línea y avisale a tu desarrollador con este texto exacto para ajustar la detección de columnas.`);
      } else {
        alert(`✅ ¡Importación Exitosa desde "${origen}"!\n\n• Comprobantes cargados: ${imported.length}\n• Compras / Despachos: ${comprasCount}\n• Ventas / Exportaciones: ${ventasCount}${retCount ? `\n• Retenciones / Percepciones: ${retCount}` : ''}${notaOmitidos}`);
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
            const { agregados, duplicados, aduanaRepetida } = importarComprobantes(imported);
            saveState();
            recalculateAll();
            avisarResultadoImport(agregados, `"${file.name}" (${label || 'archivo'})`, duplicados, aduanaRepetida);
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
        actualizarHeader();
        actualizarHeader();
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
        // Las notas de crédito restan: se guardan en negativo aunque se tipeen en positivo
        neto: (/nota de cr[ée]dito/i.test(document.getElementById('comp-tipo-doc').value) ? -1 : 1) * Math.abs(parseFloat(document.getElementById('comp-neto').value) || 0),
        alicuota: parseFloat(document.getElementById('comp-alicuota').value) || 0,
        retenciones: parseFloat(document.getElementById('comp-retenciones').value) || 0,
        esAduanera: document.getElementById('comp-es-aduanera').value
      };

      const claveNueva = claveComprobante(newV);
      if (sistemaVouchers.some(v => claveComprobante(v) === claveNueva)) {
        alert(`⚠️ El comprobante ${newV.tipoDoc} ${newV.numero} (CUIT ${newV.cuit}) ya está cargado con alícuota ${newV.alicuota}%.\nNo se agregó para evitar duplicarlo.`);
        return;
      }

      // Posible duplicado: mismo número y CUIT pero distinto tipo o alícuota
      // (ej.: importada como Factura C y cargada a mano como Factura A/B)
      const parecidos = sistemaVouchers.filter(v => esPosibleDuplicado(v, newV));
      if (parecidos.length > 0) {
        const detalle = parecidos.map(v => `• ${v.fecha} | ${v.tipoDoc} ${v.numero} | ${v.razon} | Neto $${Number(v.neto || 0).toLocaleString('es-AR', {minimumFractionDigits: 2})} | ${v.alicuota}%`).join('\n');
        const seguir = confirm(`⚠️ POSIBLE FACTURA DUPLICADA\n\nYa ${parecidos.length === 1 ? 'hay un comprobante parecido' : 'hay ' + parecidos.length + ' comprobantes parecidos'} a ${newV.tipoDoc} ${newV.numero} (${newV.razon || 'CUIT ' + newV.cuit}):\n\n${detalle}\n\nSi es la misma factura, tocá CANCELAR para no duplicarla.\nTocá ACEPTAR solo si es otra alícuota de la misma factura o un comprobante distinto.`);
        if (!seguir) return;
      }

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
        if (info.manual) {
          alert(`Modo manual: ${info.motivoManual || 'ARCA no disponible'}\nCompletá la razón social a mano.`);
        } else {
          document.getElementById('cfg-razon').value = info.razon;
          contribuyente.condicion = info.condicion;
          alert(`CUIT consultado en ARCA:\n• Razón Social: ${info.razon}\n• Condición: ${info.condicionARCA || info.condicion}`);
        }
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

      actualizarHeader();

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
      ExportEngine.exportWorkingPaperCSV(summary, contribuyente, getPeriodoFiscal(sistemaVouchers));
    });

    document.getElementById('btn-print-papeles')?.addEventListener('click', () => {
      window.print();
    });

    // Libro IVA Digital (RG 4597): genera los TXT con el diseño de registro oficial de ARCA
    function periodoLID() {
      const fechas = sistemaVouchers.map(v => String(v.fecha || '')).filter(f => /^\d{4}-\d{2}/.test(f)).sort();
      return fechas.length ? fechas[fechas.length - 1].substring(0, 7).replace('-', '') : '';
    }

    // CONTROL CRUZADO: compara el IVA que queda escrito en el TXT con el de la liquidación
    // de la app, por concepto. Si no coinciden, avisa ANTES de descargar.
    function controlarTotalesLID(tipo) {
      const s = TaxEngine.calculateIVA(JSON.parse(JSON.stringify(sistemaVouchers)), {
        stAnterior: contribuyente.stAnterior, sldAnterior: contribuyente.sldAnterior,
        ...simParams, prorrateoPct: 100, incluirImpo: true
      });
      const t = ExportEngine.totalesTXT(tipo, sistemaVouchers);
      let filas = [];
      if (tipo === 'ventas') {
        filas = [['IVA facturas y notas de débito (débito fiscal)', s.dfPositivo, t.positivo],
                 ['IVA notas de crédito emitidas', s.restitucionDF, t.nc]];
      } else if (tipo === 'compras') {
        filas = [['IVA facturas y notas de débito (crédito fiscal)', s.cfPositivo, t.positivo],
                 ['IVA notas de crédito recibidas', s.restitucionCF, t.nc],
                 ['IVA despachos de importación', s.impoIVATotal, t.impo]];
      } else {
        filas = [['IVA despachos de importación', s.impoIVATotal, t.impo]];
      }
      const tolerancia = Math.max(1, t.lineas * 0.01); // redondeos de centavos por renglón
      const fmt = (x) => '$' + (Number(x) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const conDif = filas.filter(([, app, txt]) => Math.abs((app || 0) - (txt || 0)) > tolerancia);
      const detalle = filas.map(([c, app, txt]) => {
        const d = (app || 0) - (txt || 0);
        return `${Math.abs(d) > tolerancia ? '❌' : '✅'} ${c}\n     App: ${fmt(app)}  |  TXT: ${fmt(txt)}${Math.abs(d) > tolerancia ? '  |  Diferencia: ' + fmt(d) : ''}`;
      }).join('\n\n');
      return { ok: conDif.length === 0, detalle };
    }

    function exportarConControl(tipo, etiqueta) {
      const c = controlarTotalesLID(tipo);
      if (!c.ok) {
        const seguir = confirm(`⚠️ CONTROL DE TOTALES — ${etiqueta}\n\nEl IVA del archivo TXT NO coincide con la liquidación de la app:\n\n${c.detalle}\n\nCausas habituales: un comprobante con tipo mal cargado (ej. Factura C cargada como A), una nota de crédito cargada en positivo, o una retención/percepción cargada como compra.\n\nRevisalo antes de presentar. ¿Descargar el TXT igual?`);
        if (!seguir) return;
      }
      const n = ExportEngine.exportarLID(tipo, sistemaVouchers, contribuyente.cuit, periodoLID());
      if (!n) { alert(`No hay comprobantes de ${etiqueta.toLowerCase()} para exportar.`); return; }
      if (c.ok) alert(`✅ CONTROL DE TOTALES OK — ${etiqueta}\n\nEl IVA del TXT coincide con la liquidación de la app:\n\n${c.detalle}`);
    }

    document.getElementById('btn-export-lid-ventas')?.addEventListener('click', () => exportarConControl('ventas', 'Ventas'));
    document.getElementById('btn-export-lid-compras')?.addEventListener('click', () => exportarConControl('compras', 'Compras'));
    document.getElementById('btn-export-lid-impo')?.addEventListener('click', () => exportarConControl('importaciones', 'Importaciones'));
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
      const matchSearch = !searchTerm || String(v.cuit || '').includes(searchTerm) ||
        String(v.razon || '').toLowerCase().includes(searchTerm) || String(v.numero || '').toLowerCase().includes(searchTerm);
      const matchTipo = filterTipo === 'todos' || v.tipoOp === filterTipo;
      return matchSearch && matchTipo;
    });

    tbody.innerHTML = '';

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="13" style="text-align:center; padding: 2rem; color: #94a3b8;">No se encontraron comprobantes registrados.</td></tr>`;
      return;
    }

    filtered.forEach(v => {
      const iva = TaxEngine.ivaDe(v);
      const df = v.tipoOp === 'venta' ? iva : 0;
      const cf = (v.tipoOp === 'compra' || v.tipoOp === 'importacion') ? iva : 0;
      const neto = Number(v.neto) || 0;
      const ret = Number(v.retenciones) || 0;

      let badgeClass = 'venta';
      let labelOp = 'Venta Loc.';
      if (v.tipoOp === 'exportacion') { badgeClass = 'exportacion'; labelOp = 'Exportación (E)'; }
      else if (v.tipoOp === 'compra') { badgeClass = 'compra'; labelOp = 'Compra Loc.'; }
      else if (v.tipoOp === 'importacion') { badgeClass = 'importacion'; labelOp = 'Despacho Impo'; }
      else if (v.tipoOp === 'retencion') {
        badgeClass = 'compra';
        labelOp = v.clase === 'percepcion' ? 'Percepción IVA' : v.clase === 'aduanera' ? 'Percep. Aduanera' : 'Retención IVA';
      }
      const fmtSigno = (n) => (n !== 0 ? (n < 0 ? '-$' : '$') + money(Math.abs(n)) : '-');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(v.fecha)}</td>
        <td><span class="badge-op ${badgeClass}">${labelOp}</span></td>
        <td><strong>${escapeHtml(v.tipoDoc)}</strong><br><small>${escapeHtml(v.numero)}</small></td>
        <td>${escapeHtml(v.cuit)}</td>
        <td>${escapeHtml(v.razon)}</td>
        <td class="text-right">${v.tipoOp === 'retencion' ? '-' : (neto < 0 ? '-$' : '$') + money(Math.abs(neto))}</td>
        <td>${v.tipoOp === 'retencion' ? '-' : escapeHtml(TaxEngine.alicuotaDe(v)) + '%'}</td>
        <td class="text-right">${fmtSigno(df)}</td>
        <td class="text-right">${fmtSigno(cf)}</td>
        <td class="text-right">${fmtSigno(ret)}</td>
        <td>${v.esAduanera === 'si' ? 'Aduana RG 5339' : 'Mercado Interno'}</td>
        <td><span class="badge-status st-favor">🟢 Registrado</span></td>
        <td>
          <button class="btn btn-outline btn-sm btn-delete-comp" data-id="${escapeHtml(v.id)}" title="Eliminar"><i class="ri-delete-bin-line"></i></button>
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
        <td><strong>${escapeHtml(res.comprobante)}</strong></td>
        <td>${escapeHtml(res.cuitContraparte)}</td>
        <td>$${money(res.montoSistema)}</td>
        <td>$${money(res.montoArca)}</td>
        <td class="text-right" style="color: ${res.diferenciaIva > 0 ? '#ef4444' : '#10b981'}; font-weight:700;">
          $${money(res.diferenciaIva)}
        </td>
        <td><span class="${res.badgeClass}">${res.badgeText}</span></td>
        <td style="max-width: 300px; font-size: 0.8rem;">${escapeHtml(res.diagnostico)}</td>
        <td>
          ${res.status === 'SOLO_EN_ARCA' ? `<button class="btn btn-primary btn-sm btn-incorporar-arca" data-key="${escapeHtml(res.key)}">+ Incorporar a Libros</button>` : '<span style="color:#94a3b8;">-</span>'}
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-incorporar-arca').forEach(btn => {
      btn.addEventListener('click', () => {
        const filas = ArcaReconciler.filasArcaPorClave(arcaVouchers, btn.dataset.key);
        const nuevas = filas.filter(f => !sistemaVouchers.some(v => claveComprobante(v) === claveComprobante(f)));
        if (filas.length && !nuevas.length) {
          alert('Ese comprobante ya está en los libros locales. No se volvió a agregar.');
          return;
        }
        if (nuevas.length) {
          nuevas.forEach((f, i) => sistemaVouchers.push({ ...f, id: `v_inc_${Date.now()}_${i}` }));
          saveState();
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
    document.getElementById('sim-impo-monto').innerText = money(origSummary.impoIVATotal);
    document.getElementById('sim-percep-aduaneras-monto').innerText = money(origSummary.percepAduanerasTotal);

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
      recAlert.innerHTML = `<i class="ri-checkbox-circle-line"></i> <strong>Optimización Detectada:</strong> La simulación actual reduce el impuesto a pagar en $${money(ahorro)}.`;
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
    document.getElementById('wp-periodo').innerText = getPeriodoFiscal(sistemaVouchers);
    document.getElementById('wp-fecha-hoy').innerText = getFechaHoy();

    // 1. Débito Fiscal (una fila por alícuota con movimiento)
    const ORDEN_ALIC = [21, 10.5, 27, 5, 2.5, 0];
    const etiquetaAlic = (a) => (Number(a) === 0 ? 'Exentas / No gravadas' : `Gravadas al ${String(a).replace('.', ',')}%`);
    const filasAlic = (netos, ivas, prefijo) => {
      const filas = ORDEN_ALIC.filter((a) => netos[a] || ivas[a]);
      if (!filas.length) filas.push(21);
      return filas.map((a) => `<tr><td>${prefijo} ${etiquetaAlic(a)}</td><td class="text-right">$${money(netos[a])}</td><td class="text-right">$${money(ivas[a])}</td></tr>`).join('');
    };

    const tbodyDf = document.getElementById('wp-tbody-df');
    tbodyDf.innerHTML = filasAlic(summary.dfNetoPorAlicuota, summary.dfPorAlicuota, 'Ventas') + `
      <tr style="font-weight:700; background:#f8fafc;"><td>TOTAL DÉBITO FISCAL</td><td class="text-right">$${money(summary.dfNetoTotal)}</td><td class="text-right">$${money(summary.dfTotal)}</td></tr>
    `;

    // 2. Crédito Fiscal
    const tbodyCf = document.getElementById('wp-tbody-cf');
    tbodyCf.innerHTML = filasAlic(summary.cfNetoPorAlicuota, summary.cfPorAlicuota, 'Compras locales') + `
      <tr><td>Despachos de Importación SIM (Aduana)</td><td class="text-right">$${money(summary.impoNetoTotal)}</td><td class="text-right">$${money(summary.impoIVATotal)}</td></tr>
      <tr style="font-weight:700; background:#f8fafc;"><td>CRÉDITO FISCAL COMPUTABLE (prorrateo ${simParams.prorrateoPct}%)</td><td class="text-right">-</td><td class="text-right">$${money(summary.cfComputableTotal)}</td></tr>
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

  // Determina el Período Fiscal (mes/año) real en base a las fechas de los
  // comprobantes cargados, en lugar de un valor fijo. Toma el mes/año que
  // más se repite entre los comprobantes del sistema.
  function getPeriodoFiscal(vouchers) {
    const conteo = {};
    (vouchers || []).forEach(v => {
      if (!v.fecha) return;
      const key = v.fecha.substring(0, 7); // 'AAAA-MM'
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      conteo[key] = (conteo[key] || 0) + 1;
    });

    const keys = Object.keys(conteo);
    let periodoKey;
    if (keys.length > 0) {
      periodoKey = keys.sort((a, b) => conteo[b] - conteo[a])[0];
    } else {
      const hoy = new Date();
      periodoKey = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    }

    const [anio, mes] = periodoKey.split('-');
    return `${NOMBRES_MES[parseInt(mes, 10) - 1]} ${anio}`;
  }

  function getFechaHoy() {
    const hoy = new Date();
    const dd = String(hoy.getDate()).padStart(2, '0');
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const yyyy = hoy.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
});
