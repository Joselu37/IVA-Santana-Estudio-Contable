/**
 * Universal ARCA / AFIP CSV & TXT Parser (Ultra-Robust Version)
 * Reads:
 * 1. ARCA "Mis Comprobantes Recibidos" (Compras) CSV/TXT
 * 2. ARCA "Mis Comprobantes Emitidos" (Ventas / Exportación E) CSV/TXT
 * 3. ARCA "Despachos de Importación SIM" (Aduana) CSV/TXT
 * 4. ARCA "Mis Retenciones / Percepciones" (Deducciones, SIRCER, RG 5339) CSV/TXT
 * 5. DDJJ Formulario F.2002 / LID TXT / F.731 de Períodos Anteriores
 */

window.CsvParser = (function() {

  // Helper: Clean Argentine Number parsing (handles $ 1.250,50 -> 1250.50)
  function parseArgNumber(val) {
    if (val === null || val === undefined) return 0;
    let s = String(val).trim().replace(/\$/g, '').replace(/\s/g, '');
    if (!s) return 0;
    
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    } else if ((s.match(/\./g) || []).length > 1) {
      // "1.250.000" = separador de miles sin decimales
      s = s.replace(/\./g, '');
    }
    
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
  }

  // Helper: Normalize String (removes accents, punctuation, lowercase)
  function normalizeStr(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Helper: Parse Argentine Date (DD/MM/AAAA or AAAA-MM-DD) into YYYY-MM-DD
  function parseArgDate(val) {
    if (!val) return new Date().toISOString().substring(0, 10);
    const s = String(val).trim();

    const matchDMY = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (matchDMY) {
      const day = matchDMY[1].padStart(2, '0');
      const month = matchDMY[2].padStart(2, '0');
      const year = matchDMY[3];
      return `${year}-${month}-${day}`;
    }

    const matchYMD = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (matchYMD) {
      const year = matchYMD[1];
      const month = matchYMD[2].padStart(2, '0');
      const day = matchYMD[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    return s;
  }

  // Helper: Clean Voucher Type
  function parseTipoDoc(val) {
    if (!val) return 'Factura A';
    let s = String(val).trim();

    // Codigos oficiales de comprobantes ARCA (el orden 6/7/8 es Factura B / ND B / NC B)
    const CODIGOS = {
      1: 'Factura A', 2: 'Nota de Débito A', 3: 'Nota de Crédito A',
      6: 'Factura B', 7: 'Nota de Débito B', 8: 'Nota de Crédito B',
      11: 'Factura C', 12: 'Nota de Débito C', 13: 'Nota de Crédito C',
      19: 'Factura E', 20: 'Nota de Débito E', 21: 'Nota de Crédito E',
      51: 'Factura M', 52: 'Nota de Débito M', 53: 'Nota de Crédito M'
    };
    const m = s.match(/^0*(\d+)(?:\s*-|\s|$)/);
    if (m && CODIGOS[parseInt(m[1], 10)]) return CODIGOS[parseInt(m[1], 10)];

    if (s.toUpperCase().includes('FACTURA E') || s.toUpperCase().includes('EXPORT')) return 'Factura E';
    if (s.toLowerCase().includes('despacho') || s.toLowerCase().includes('import')) return 'Despacho Impo';
    if (s.toLowerCase().includes('retencion') || s.toLowerCase().includes('retención')) return 'Certificado Retención';
    if (s.toLowerCase().includes('percepcion') || s.toLowerCase().includes('percepción')) return 'Constancia Percepción';

    return s;
  }

  /**
   * Extrae saldos anteriores desde un archivo F.2002 / LID TXT / CSV DDJJ anterior (Versión ultra flexible)
   */
  function parseDDJJAnterior(text) {
    if (!text) return null;
    const cleanText = String(text).replace(/^\uFEFF/, '').trim();

    let stAnterior = 0;
    let sldAnterior = 0;
    let cuitEncontrado = '';
    let razonEncontrada = '';

    const lines = cleanText.split(/\r?\n/);

    lines.forEach(line => {
      const l = normalizeStr(line);
      
      // Buscar CUIT
      const cuitMatch = line.match(/\b(20|23|27|30|33|34)[\-]?\d{8}[\-]?\d\b/);
      if (cuitMatch && !cuitEncontrado) {
        cuitEncontrado = cuitMatch[0];
      }

      // Saldo Técnico 1er párrafo (AFIP F.2002 / F.731 / LID)
      if (l.includes('saldo tecnico') || l.includes('primer parrafo') || l.includes('1er parrafo') || l.includes('tecnico resultante') || l.includes('saldo a favor primer') || l.includes('st anterior')) {
        const numbers = line.match(/[\d\.\,]+/g);
        if (numbers && numbers.length > 0) {
          const val = parseArgNumber(numbers[numbers.length - 1]);
          if (val > 0) stAnterior = val;
        }
      }

      // Saldo Libre Disponibilidad 2do párrafo
      if (l.includes('libre disponibilidad') || l.includes('segundo parrafo') || l.includes('2do parrafo') || l.includes('saldo libre') || l.includes('saldo a favor segundo') || l.includes('sld anterior')) {
        const numbers = line.match(/[\d\.\,]+/g);
        if (numbers && numbers.length > 0) {
          const val = parseArgNumber(numbers[numbers.length - 1]);
          if (val > 0) sldAnterior = val;
        }
      }
    });

    // Si no se encontró por palabras clave pero hay números grandes en la planilla DDJJ
    if (stAnterior === 0 && sldAnterior === 0) {
      lines.forEach(line => {
        const numbers = line.match(/[\d\.\,]{4,}/g);
        if (numbers) {
          numbers.forEach(nStr => {
            const val = parseArgNumber(nStr);
            if (val > 1000 && stAnterior === 0) {
              stAnterior = val;
            } else if (val > 500 && sldAnterior === 0 && val !== stAnterior) {
              sldAnterior = val;
            }
          });
        }
      });
    }

    return {
      stAnterior,
      sldAnterior,
      cuit: cuitEncontrado,
      razon: razonEncontrada
    };
  }

  /**
   * Main CSV Parser Function
   */
  function parseArcaCSV(csvText, defaultTipoOp = null) {
    if (!csvText || typeof csvText !== 'string') return [];

    const cleanText = csvText.replace(/^\uFEFF/, '').trim();
    const lines = cleanText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    const firstLine = lines[0];
    let delimiter = ';';
    if (firstLine.includes(';') && (firstLine.split(';').length >= firstLine.split(',').length)) {
      delimiter = ';';
    } else if (firstLine.includes('\t')) {
      delimiter = '\t';
    } else if (firstLine.includes(',')) {
      delimiter = ',';
    }

    // Algunos exportadores de ARCA agregan una línea de título/período ANTES de
    // la fila real de encabezados (ej: "Comprobantes Recibidos - Período 08/2026").
    // Buscamos, dentro de las primeras líneas, cuál es la que realmente contiene
    // encabezados de columna reconocibles, para no procesarla como si fuera un dato.
    const HEADER_TOKENS = ['fecha', 'cuit', 'doc', 'neto', 'importe', 'denominacion',
      'razon social', 'comprobante', 'numero', 'tipo', 'punto de venta', 'pto vta',
      'alicuota', 'iva', 'total', 'agente', 'regimen', 'despacho', 'aduana'];

    let headerLineIdx = 0;
    let bestScore = -1;
    const maxScan = Math.min(lines.length, 10);
    for (let i = 0; i < maxScan; i++) {
      const candidateHeaders = lines[i].split(delimiter).map(h => normalizeStr(h));
      const score = candidateHeaders.reduce((acc, h) => acc + (HEADER_TOKENS.some(t => h.includes(t)) ? 1 : 0), 0);
      // Requerimos al menos 2 columnas reconocibles para considerarla fila de encabezados real.
      if (score >= 2 && score > bestScore) {
        bestScore = score;
        headerLineIdx = i;
      }
    }

    const rawHeaders = lines[headerLineIdx].split(delimiter).map(h => normalizeStr(h));
    const headersOriginal = lines[headerLineIdx].split(delimiter).map(h => h.trim().replace(/^"+|"+$/g, '').trim());

    function findHeaderIdx(patterns) {
      return rawHeaders.findIndex(h => patterns.some(p => h.includes(p)));
    }
    // Busca patrón por patrón, en orden de preferencia (el primero que aparezca gana).
    function findByPriority(patterns, excluir) {
      for (const p of patterns) {
        const idx = rawHeaders.findIndex(h => h.includes(p) && !(excluir && excluir.test(h)));
        if (idx >= 0) return idx;
      }
      return -1;
    }
    // Para columnas de número de documento: ignorar "Tipo Doc. ..." (trae 80/96, no el CUIT).
    function findDocIdx(patterns) {
      return rawHeaders.findIndex(h => !h.startsWith('tipo') && patterns.some(p => h.includes(p)));
    }

    // ===== DETECCION DEL FORMATO "ANCHO" REAL DE ARCA (Mis Comprobantes) =====
    // El export real de ARCA no trae una sola columna de "Neto Gravado" + "Alicuota":
    // trae UN PAR de columnas (Neto Grav. IVA X% / IVA X%) POR CADA ALICUOTA posible
    // (0%, 2,5%, 5%, 10,5%, 21%, 27%), porque una misma factura puede tener partes
    // gravadas a distintas tasas a la vez. Si detectamos al menos una de estas
    // columnas, usamos el camino de parseo "ancho" (mas fiel a la realidad).
    const TASAS_IVA = [0, 2.5, 5, 10.5, 21, 27];
    function buscarColumnaTasa(conPrefijoNeto, tasa) {
      const tasaStr = String(tasa).replace('.', '[.,]');
      const prefijo = conPrefijoNeto ? '(?:imp\\.?\\s*)?neto\\s*grav(?:ado|\\.)?\\s*' : '(?:importe\\s*)?';
      const re = new RegExp(`^${prefijo}iva\\s*${tasaStr}\\s*%?$`, 'i');
      return headersOriginal.findIndex(h => re.test(h.replace(/\s+/g, ' ').trim()));
    }
    const columnasTasa = TASAS_IVA.map((tasa) => ({
      tasa,
      idxNeto: buscarColumnaTasa(true, tasa),
      idxIva: buscarColumnaTasa(false, tasa),
    })).filter((c) => c.idxNeto >= 0 || c.idxIva >= 0);

    const formatoAncho = columnasTasa.length > 0;

    const idxTipoCambio = findHeaderIdx(['tipo cambio', 'tipo de cambio']);
    const idxMoneda = findHeaderIdx(['moneda']);
    // En el export "Libro IVA Digital / Portal IVA" la columna se llama "Moneda Original" y los
    // importes YA vienen convertidos a pesos. En "Mis Comprobantes" y en "Comprobantes de
    // Compras/Ventas" los importes vienen en la moneda de la factura (hay que multiplicar por
    // el tipo de cambio).
    const importesYaEnPesos = idxMoneda >= 0 && rawHeaders[idxMoneda].includes('original');
    const esMonedaPesos = (m) => /^(\$|pes|ars|peso|pesos)?$/i.test(String(m || '').trim());
    function factorMoneda(cols) {
      if (importesYaEnPesos) return 1;
      const moneda = idxMoneda >= 0 ? cols[idxMoneda] : '$';
      if (esMonedaPesos(moneda)) return 1;
      const tc = idxTipoCambio >= 0 ? parseArgNumber(cols[idxTipoCambio]) : 1;
      return tc > 0 ? tc : 1;
    }

    const isMisRetenciones = rawHeaders.some(h => h.includes('retenido') || h.includes('percibido') || h.includes('agente') || h.includes('regimen') || h.includes('deduccion'));

    const idxFecha = findHeaderIdx(['fecha', 'date', 'emision', 'fecha ret']);
    const idxTipo = rawHeaders.findIndex(h =>
      ['tipo', 'comprobante', 'doc', 'cbte', 'impuesto', 'regimen'].some(p => h.includes(p)) && !h.includes('operacion'));
    const idxPtoVta = findHeaderIdx(['punto de venta', 'puntoventa', 'pto vta', 'ptovta', 'punto vta', 'codigoaduana', 'codigo aduana']);
    const idxTipoOperacion = rawHeaders.findIndex(h => h === 'tipooperacion' || h === 'tipo operacion' || h === 'operacion');
    const idxNumDesde = findHeaderIdx(['numero desde', 'nro desde', 'numero', 'num', 'cbte nro', 'nro comprobante']);

    const idxCuitAgente = findDocIdx(['cuit agente', 'cuitagente', 'nro doc agente', 'doc agente']);
    const idxCuitEmisor = findDocIdx(['nro doc emisor', 'doc emisor', 'cuit emisor']);
    const idxCuitReceptor = findDocIdx(['nro doc receptor', 'doc receptor', 'cuit receptor']);
    const idxCuitContraparte = findDocIdx(['nro doc vendedor', 'nro doc comprador']);
    const idxCuitGen = findDocIdx(['cuit', 'nro doc', 'doc', 'cuit contraparte', 'codigo aduana']);
    const idxCuit = idxCuitAgente >= 0 ? idxCuitAgente : (idxCuitEmisor >= 0 ? idxCuitEmisor : (idxCuitReceptor >= 0 ? idxCuitReceptor : (idxCuitContraparte >= 0 ? idxCuitContraparte : idxCuitGen)));

    // Nombre del agente: nunca la columna del CUIT del agente.
    const idxRazonAgente = rawHeaders.findIndex(h => !/cuit|^tipo|^nro|doc/.test(h) &&
      ['denominacion agente', 'denominacionagente', 'nombre agente', 'agente'].some(p => h.includes(p)));
    const idxRazonEmisor = findHeaderIdx(['denominacion emisor', 'nombre emisor', 'razon social emisor']);
    const idxRazonReceptor = findHeaderIdx(['denominacion receptor', 'nombre receptor', 'razon social receptor']);
    const idxRazonGen = findByPriority(['denominacion', 'razon social', 'nombre', 'razon', 'aduana'], /^codigo|cuit|^nro|^tipo/);
    const idxRazon = idxRazonAgente >= 0 ? idxRazonAgente : (idxRazonEmisor >= 0 ? idxRazonEmisor : (idxRazonReceptor >= 0 ? idxRazonReceptor : idxRazonGen));

    const idxNeto = findHeaderIdx(['imp neto gravado', 'neto gravado', 'neto', 'cif neto', 'subtotal']);
    const idxTotal = findByPriority(['imp total', 'importe total', 'monto total', 'total'], /neto|iva|tributo/);
    const idxExentas = findByPriority(['op exentas', 'operaciones exentas', 'exento']);
    const idxNoGravado = findByPriority(['neto no gravado', 'no gravado']);
    // Columna del IMPORTE de IVA: no confundir con "Alícuota IVA", "Neto Grav. IVA"
    // ni "Condición IVA", que también contienen la palabra "iva".
    const idxIva = rawHeaders.findIndex(h =>
      ['iva', 'impuesto liquidado', 'debito fiscal', 'credito fiscal', 'imp iva'].some(p => h.includes(p)) &&
      !/alicuota|tasa|neto|grav|condicion|cond |exent|percep|retenc/.test(h));
    const idxAlicuota = findHeaderIdx(['alicuota', 'tasa', 'pct']);
    // Ojo: "Otros Tributos" de Mis Comprobantes NO se toma, porque mezcla IIBB,
    // impuestos internos, etc. Las percepciones/retenciones de IVA se cargan
    // desde el archivo de "Mis Retenciones" o desde columnas que lo digan.
    const idxEsAduanera = findHeaderIdx(['esaduanera', 'es aduanera']);
    const idxTributos = findHeaderIdx(['percepciones', 'retenciones', 'percepcion', 'retencion', 'importe retenido', 'importe percibido', 'monto retenido', 'monto percibido']);

    const isVentasFile = rawHeaders.some(h => h.includes('receptor') || h.includes('cliente'));
    const isComprasFile = rawHeaders.some(h => h.includes('emisor') || h.includes('proveedor'));
    const isImpoFile = rawHeaders.some(h => h.includes('despacho') || h.includes('aduana') || h.includes('cif'));

    const parsedVouchers = [];
    const headerLineDetectada = lines[headerLineIdx];

    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      let cols = [];
      if (line.includes('"')) {
        const regex = new RegExp(`(?:^|${delimiter})(?:"([^"]*)"|([^"${delimiter}]*))`, 'g');
        let match;
        while ((match = regex.exec(line)) !== null) {
          cols.push((match[1] !== undefined ? match[1] : match[2] || '').trim());
        }
      } else {
        cols = line.split(delimiter).map(c => c.trim());
      }

      if (cols.length < 2) continue;

      let fechaRaw = idxFecha >= 0 ? cols[idxFecha] : cols[0];
      let fecha = parseArgDate(fechaRaw);

      let tipoDocRaw = idxTipo >= 0 ? cols[idxTipo] : cols[1];
      let tipoDoc = parseTipoDoc(tipoDocRaw);
      const esNotaCredito = /nota de cr[ée]dito|\bn\/?c\b/i.test(tipoDoc) || /nota de cr[ée]dito/i.test(String(tipoDocRaw));

      let ptoVta = idxPtoVta >= 0 ? cols[idxPtoVta] : '';
      let numero = idxNumDesde >= 0 ? cols[idxNumDesde] : (cols[3] || '00000001');
      if (idxPtoVta < 0 && idxNumDesde < 0) ptoVta = cols[2] || '00001';

      let cuitRaw = idxCuit >= 0 ? cols[idxCuit] : (cols[4] || '30000000000');
      let cuit = String(cuitRaw).replace(/\D/g, '');
      if (cuit.length === 11) {
        cuit = `${cuit.substring(0, 2)}-${cuit.substring(2, 10)}-${cuit.substring(10)}`;
      }

      let razon = idxRazon >= 0 ? cols[idxRazon] : (cols[5] || 'Agente / Contribuyente ARCA');

      let fullNumero;
      const numeroStr = String(numero || '').trim();
      if (!String(ptoVta || '').trim() && /^\d+-\d+$/.test(numeroStr)) {
        // El número ya viene completo "PPPPP-NNNNNNNN".
        const [p, n] = numeroStr.split('-');
        fullNumero = `${p.padStart(5, '0')}-${n.padStart(8, '0')}`;
      } else if (!String(ptoVta || '').trim()) {
        fullNumero = numeroStr;
      } else {
        const ptoClean = String(ptoVta).replace(/\D/g, '').padStart(5, '0');
        const numClean = numeroStr.replace(/\D/g, '').padStart(8, '0');
        // Despachos: el número es alfanumérico (ej. 26001IC04001294X): se respeta tal cual.
        const esAlfanumerico = /[A-Za-z]/.test(numeroStr);
        fullNumero = esAlfanumerico ? `${ptoClean}-${numeroStr}` :
          ((ptoClean !== '00000' && numClean !== '00000000') ? `${ptoClean}-${numClean}` : numeroStr);
      }

      const tipoDocNorm = normalizeStr(tipoDocRaw);
      const esRetPercep = isMisRetenciones || /retencion|percepcion/.test(tipoDocNorm);

      let tipoOp = 'compra';
      const operacionCol = idxTipoOperacion >= 0 ? normalizeStr(cols[idxTipoOperacion]) : '';
      const OPERACIONES = { venta: 'venta', ventas: 'venta', compra: 'compra', compras: 'compra',
        exportacion: 'exportacion', importacion: 'importacion', retencion: 'retencion', percepcion: 'retencion' };
      if (esRetPercep || OPERACIONES[operacionCol] === 'retencion') {
        // Retenciones / percepciones sufridas: son pagos a cuenta, no compras.
        // Se detectan por el contenido aunque se suban por otra zona.
        tipoOp = 'retencion';
      } else if (OPERACIONES[operacionCol]) {
        // La planilla trae su propia columna "TipoOperacion": manda sobre la zona elegida.
        tipoOp = OPERACIONES[operacionCol];
      } else if (tipoDoc.includes('Factura E') || tipoDoc.toLowerCase().includes('export')) {
        tipoOp = 'exportacion';
      } else if (defaultTipoOp) {
        // El usuario indico explicitamente que es este archivo (venta/compra/importacion):
        // eso pisa cualquier heuristica automatica por nombre de columna, que es fragil
        // y puede fallar segun el formato exacto del export de ARCA.
        tipoOp = defaultTipoOp;
      } else if (isImpoFile || tipoDoc.toLowerCase().includes('despacho')) {
        tipoOp = 'importacion';
      } else if (isVentasFile) {
        tipoOp = 'venta';
      } else if (isComprasFile) {
        tipoOp = 'compra';
      }

      const esAduaneraBase = tipoOp === 'importacion' ? 'si' : 'no';

      if (formatoAncho && tipoOp !== 'exportacion' && tipoOp !== 'retencion') {
        // ===== CAMINO "ANCHO": una fila de ARCA puede generar VARIAS filas
        // internas, una por cada alicuota que tenga montos (0%, 2,5%, 5%,
        // 10,5%, 21%, 27%), convirtiendo a pesos si la factura esta en
        // moneda extranjera, e invirtiendo el signo si es Nota de Credito.
        const tipoCambio = factorMoneda(cols);
        const moneda = idxMoneda >= 0 ? String(cols[idxMoneda] || '$').trim() : '$';
        // Las Notas de Credito siempre restan (algunos exports las traen en positivo y otros en negativo)
        const conSigno = (x) => (esNotaCredito ? -Math.abs(x) : x);

        columnasTasa.forEach((ct) => {
          if (ct.tasa === 0) return; // 0% no genera IVA: no aporta a debito/credito fiscal
          const netoOriginal = ct.idxNeto >= 0 ? parseArgNumber(cols[ct.idxNeto]) : 0;
          const ivaOriginal = ct.idxIva >= 0 ? parseArgNumber(cols[ct.idxIva]) : 0;
          if (netoOriginal === 0 && ivaOriginal === 0) return; // esta factura no tiene monto en esta alicuota

          const netoArs = conSigno(Math.round(netoOriginal * tipoCambio * 100) / 100);
          const ivaArs = conSigno(Math.round(ivaOriginal * tipoCambio * 100) / 100);

          parsedVouchers.push({
            id: 'arca_imp_' + Date.now() + '_' + i + '_' + ct.tasa + '_' + Math.random().toString(36).substr(2, 4),
            fecha,
            tipoOp,
            tipoDoc: !esMonedaPesos(moneda) ? `${tipoDoc} (${moneda} @ ${idxTipoCambio >= 0 ? parseArgNumber(cols[idxTipoCambio]) : tipoCambio})` : tipoDoc,
            numero: fullNumero,
            cuit: cuit || '30-00000000-0',
            razon: razon || 'CONTRIBUYENTE ARCA',
            neto: netoArs,
            iva: ivaArs,
            df: tipoOp === 'venta' ? ivaArs : 0,
            cf: (tipoOp === 'compra' || tipoOp === 'importacion') ? ivaArs : 0,
            alicuota: ct.tasa,
            retenciones: 0,
            esAduanera: esAduaneraBase,
            _linea: i
          });
        });

        // Exento / no gravado (y comprobantes B o C, que no discriminan IVA):
        // se cargan como una fila al 0% para que no se pierdan del libro.
        const generadas = parsedVouchers.filter(v => v._linea === i).length;
        const exentoNoGrav = (idxExentas >= 0 ? parseArgNumber(cols[idxExentas]) : 0) +
          (idxNoGravado >= 0 ? parseArgNumber(cols[idxNoGravado]) : 0);
        let netoCero = exentoNoGrav;
        if (generadas === 0 && netoCero === 0 && idxTotal >= 0) netoCero = parseArgNumber(cols[idxTotal]);
        if (netoCero !== 0) {
          const netoArs = conSigno(Math.round(netoCero * tipoCambio * 100) / 100);
          parsedVouchers.push({
            id: 'arca_imp_' + Date.now() + '_' + i + '_0_' + Math.random().toString(36).substr(2, 4),
            fecha,
            tipoOp,
            tipoDoc: !esMonedaPesos(moneda) ? `${tipoDoc} (${moneda} @ ${idxTipoCambio >= 0 ? parseArgNumber(cols[idxTipoCambio]) : tipoCambio})` : tipoDoc,
            numero: fullNumero,
            cuit: cuit || '30-00000000-0',
            razon: razon || 'CONTRIBUYENTE ARCA',
            neto: netoArs,
            iva: 0,
            df: 0,
            cf: 0,
            alicuota: 0,
            retenciones: 0,
            esAduanera: esAduaneraBase
          });
        }
        parsedVouchers.forEach(v => { if (v._linea === i) delete v._linea; });

        continue; // ya se agregaron las filas de esta factura, pasar a la siguiente linea
      }

      // ===== CAMINO "ANGOSTO" (formato clasico de 1 columna neto + 1 alicuota):
      // usado para archivos de retenciones/percepciones, despachos de importacion
      // con formato simple, plantillas del liquidador, u otros formatos no-ARCA.
      let neto = idxNeto >= 0 ? parseArgNumber(cols[idxNeto]) : 0;
      let total = idxTotal >= 0 ? parseArgNumber(cols[idxTotal]) : 0;
      let iva = idxIva >= 0 ? parseArgNumber(cols[idxIva]) : 0;
      let alicuotaExplicit = idxAlicuota >= 0 ? parseArgNumber(cols[idxAlicuota]) : null;
      // Solo usamos la columna 9 como retenciones en archivos SIN encabezados reconocibles (plantilla
      // simple del liquidador). En los exports de ARCA esa posicion puede ser el Tipo de Cambio u otra cosa.
      const sinEncabezadosConocidos = idxNeto < 0 && idxIva < 0 && idxTotal < 0;
      let retenciones = idxTributos >= 0
        ? parseArgNumber(cols[idxTributos])
        : (sinEncabezadosConocidos && cols[8] ? parseArgNumber(cols[8]) : 0);

      // Facturas en moneda extranjera: pasar todo a pesos con el tipo de cambio del comprobante
      const factor = factorMoneda(cols);
      if (factor !== 1) {
        neto = Math.round(neto * factor * 100) / 100;
        total = Math.round(total * factor * 100) / 100;
        iva = Math.round(iva * factor * 100) / 100;
        retenciones = Math.round(retenciones * factor * 100) / 100;
      }

      let esAduanera = esAduaneraBase;
      const lineNorm = normalizeStr(line);
      if (tipoOp === 'retencion') {
        let importe = retenciones || total || neto;
        if (!importe) {
          // Último recurso: la última columna con importe del renglón.
          for (let c = cols.length - 1; c >= 0; c--) {
            if ([idxCuit, idxNumDesde, idxPtoVta, idxFecha].includes(c)) continue;
            const v = parseArgNumber(cols[c]);
            if (v !== 0 && String(cols[c]).replace(/\D/g, '').length < 10) { importe = v; break; }
          }
        }
        const columnaAduanera = idxEsAduanera >= 0 ? normalizeStr(cols[idxEsAduanera]) : '';
        let clase = 'retencion';
        if (columnaAduanera === 'si' || /aduan|rg 5339|\b767\b/.test(lineNorm)) {
          clase = 'aduanera';
          tipoDoc = 'Percepcion Aduanera (RG 5339)';
        } else if (/percepcion|percibido/.test(normalizeStr(tipoDocRaw)) || /percepcion/.test(lineNorm)) {
          clase = 'percepcion';
          tipoDoc = 'Constancia Percepcion IVA';
        } else {
          tipoDoc = 'Certificado Retencion IVA';
        }
        parsedVouchers.push({
          id: 'arca_ret_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 4),
          fecha,
          tipoOp: 'retencion',
          clase,
          tipoDoc,
          numero: fullNumero,
          cuit: cuit || '30-00000000-0',
          razon: razon || 'AGENTE DE RETENCION',
          neto: 0,
          iva: 0,
          df: 0,
          cf: 0,
          alicuota: 0,
          retenciones: Math.abs(importe),
          esAduanera: clase === 'aduanera' ? 'si' : 'no'
        });
        continue;
      }

      // Comprobantes B y C (y tiques B/C): NO discriminan IVA -> no generan crédito/débito fiscal.
      // El importe total va completo como neto y el IVA queda en 0 (no se inventa un 21%).
      const tipoTxt = String(tipoDocRaw || tipoDoc);
      const esClaseC = /\b(factura|nota de d[ée]bito|nota de cr[ée]dito|tique|recibo)\b.*\bC\b|^0*(11|12|13|15|111|114|117)\b/i.test(tipoTxt) || /\bC$/.test(String(tipoDoc).trim());
      const esClaseB = /\b(factura|nota de d[ée]bito|nota de cr[ée]dito|tique|recibo)\b.*\bB\b|^0*(6|7|8|9|82|113|116)\b/i.test(tipoTxt) || /\bB$/.test(String(tipoDoc).trim());
      // C nunca discrimina IVA; B recibida por un Responsable Inscripto no da crédito fiscal.
      // (Las ventas B SÍ llevan débito fiscal, por eso solo se aplica a compras.)
      const sinIvaDiscriminado = esClaseC || (esClaseB && tipoOp === 'compra');
      if (sinIvaDiscriminado) {
        if (total > 0) neto = total;
        iva = 0;
      }

      if (neto === 0 && total > 0 && !sinIvaDiscriminado) {
        if (iva > 0) {
          neto = total - iva - retenciones;
        } else {
          neto = Math.round((total / 1.21) * 100) / 100;
          iva = Math.round((total - neto) * 100) / 100;
        }
        if (neto < 0) neto = total;
      }

      if (neto === 0) {
        const columnasExcluidas = [idxPtoVta, idxNumDesde, idxCuit, idxTipo, idxFecha];
        const candidatas = cols
          .map((colVal, cIdx) => ({ colVal, cIdx }))
          .filter(({ cIdx }) => !columnasExcluidas.includes(cIdx));

        const conDecimales = candidatas.find(({ colVal }) => {
          const soloDigitos = String(colVal).replace(/\D/g, '');
          if (soloDigitos.length >= 10) return false;
          return /[.,]\d{1,2}$/.test(String(colVal).trim());
        });

        if (conDecimales) {
          const valNum = parseArgNumber(conDecimales.colVal);
          if (valNum > 0) neto = valNum;
        }

        if (neto === 0) {
          candidatas.forEach(({ colVal }) => {
            if (neto !== 0) return;
            const soloDigitos = String(colVal).replace(/\D/g, '');
            if (soloDigitos.length >= 10) return;
            const valNum = parseArgNumber(colVal);
            if (valNum > 100) neto = valNum;
          });
        }
      }

      if (iva === 0 && neto > 0 && tipoOp !== 'exportacion' && !sinIvaDiscriminado) {
        // Sin columna de IVA: se calcula con la alícuota informada (o 21% si no hay).
        const tasa = (alicuotaExplicit !== null && alicuotaExplicit >= 0 && idxAlicuota >= 0) ? alicuotaExplicit : 21;
        iva = Math.round(neto * tasa) / 100;
      }

      let alicuota = (tipoOp === 'exportacion' || sinIvaDiscriminado) ? 0 : 21;
      if (alicuotaExplicit !== null && idxAlicuota >= 0 && (alicuotaExplicit > 0 || neto !== 0)) {
        alicuota = alicuotaExplicit;
      } else if (neto > 0 && iva > 0) {
        const calcAli = (iva / neto) * 100;
        if (Math.abs(calcAli - 21) < 2) alicuota = 21;
        else if (Math.abs(calcAli - 10.5) < 2) alicuota = 10.5;
        else if (Math.abs(calcAli - 27) < 2) alicuota = 27;
        else if (Math.abs(calcAli - 5) < 1) alicuota = 5;
        else if (Math.abs(calcAli - 2.5) < 1) alicuota = 2.5;
        else alicuota = Math.round(calcAli * 10) / 10;
      }

      if (tipoOp === 'exportacion') iva = 0;
      if (sinIvaDiscriminado) { iva = 0; alicuota = 0; }
      if (esNotaCredito) { neto = -Math.abs(neto); iva = -Math.abs(iva); }

      parsedVouchers.push({
        id: 'arca_imp_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 4),
        fecha,
        tipoOp,
        tipoDoc,
        numero: fullNumero,
        cuit: cuit || '30-00000000-0',
        razon: razon || 'CONTRIBUYENTE ARCA',
        neto,
        iva,
        df: tipoOp === 'venta' ? iva : 0,
        cf: (tipoOp === 'compra' || tipoOp === 'importacion') ? iva : 0,
        alicuota,
        retenciones,
        esAduanera: esAduanera === 'si' || tipoOp === 'importacion' ? 'si' : 'no'
      });
    }

    parsedVouchers._headerLineDetectada = headerLineDetectada;
    return parsedVouchers;
  }

  return {
    parseArcaCSV,
    parseDDJJAnterior,
    parseArgNumber,
    parseArgDate
  };
})();
