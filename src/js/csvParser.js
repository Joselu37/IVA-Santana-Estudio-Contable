/**
 * Universal ARCA / AFIP CSV & TXT Parser
 * Reads:
 * 1. ARCA "Mis Comprobantes Recibidos" (Compras) CSV/TXT
 * 2. ARCA "Mis Comprobantes Emitidos" (Ventas / Exportación E) CSV/TXT
 * 3. ARCA "Despachos de Importación SIM" (Aduana) CSV/TXT
 * 4. DDJJ Formulario F.2002 / LID TXT / F.731 de Períodos Anteriores
 */

window.CsvParser = (function() {

  // Helper: Clean Argentine Number parsing (handles $ 1.250,50 -> 1250.50)
  function parseArgNumber(val) {
    if (val === null || val === undefined) return 0;
    let s = String(val).trim().replace(/\$/g, '').replace(/\s/g, '');
    if (!s) return 0;
    
    // Check if format is 1.250,50 (Argentine) vs 1,250.50 (US)
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }
    
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
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

    if (/^1\b|^001\b/i.test(s) && !s.includes('11') && !s.includes('19')) return 'Factura A';
    if (/^2\b|^002\b/i.test(s)) return 'Nota de Débito A';
    if (/^3\b|^003\b/i.test(s)) return 'Nota de Crédito A';
    if (/^6\b|^006\b/i.test(s)) return 'Factura B';
    if (/^7\b|^007\b/i.test(s)) return 'Nota de Crédito B';
    if (/^8\b|^008\b/i.test(s)) return 'Nota de Débito B';
    if (/^11\b|^011\b/i.test(s)) return 'Factura C';
    if (/^19\b|^019\b/i.test(s) || s.toUpperCase().includes('FACTURA E') || s.toUpperCase().includes('EXPORT')) return 'Factura E';
    if (s.toLowerCase().includes('despacho') || s.toLowerCase().includes('import')) return 'Despacho Impo';

    return s;
  }

  /**
   * Extrae saldos anteriores desde un archivo F.2002 / LID TXT / CSV DDJJ anterior
   */
  function parseDDJJAnterior(text) {
    if (!text) return null;
    const cleanText = String(text).replace(/^\uFEFF/, '').trim();

    let stAnterior = 0;
    let sldAnterior = 0;
    let cuitEncontrado = '';
    let razonEncontrada = '';

    // Intentar buscar números o palabras clave en el texto
    const lines = cleanText.split(/\r?\n/);

    lines.forEach(line => {
      const l = line.toLowerCase();
      
      // CUIT
      const cuitMatch = line.match(/\b(20|23|27|30|33|34)[\-]?\d{8}[\-]?\d\b/);
      if (cuitMatch && !cuitEncontrado) {
        cuitEncontrado = cuitMatch[0];
      }

      // Saldo Técnico 1er párrafo
      if (l.includes('saldo técnico') || l.includes('saldo tecnico') || l.includes('1er párrafo') || l.includes('1er parrafo') || l.includes('tecnico resultante')) {
        const numbers = line.match(/[\d\.\,]+/g);
        if (numbers && numbers.length > 0) {
          const val = parseArgNumber(numbers[numbers.length - 1]);
          if (val > 0) stAnterior = val;
        }
      }

      // Saldo Libre Disponibilidad 2do párrafo
      if (l.includes('libre disponibilidad') || l.includes('2do párrafo') || l.includes('2do parrafo') || l.includes('saldo libre')) {
        const numbers = line.match(/[\d\.\,]+/g);
        if (numbers && numbers.length > 0) {
          const val = parseArgNumber(numbers[numbers.length - 1]);
          if (val > 0) sldAnterior = val;
        }
      }
    });

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

    const rawHeaders = firstLine.split(delimiter).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

    function findHeaderIdx(patterns) {
      return rawHeaders.findIndex(h => patterns.some(p => h.includes(p)));
    }

    const idxFecha = findHeaderIdx(['fecha', 'date']);
    const idxTipo = findHeaderIdx(['tipo', 'comprobante', 'doc']);
    const idxPtoVta = findHeaderIdx(['punto de venta', 'pto vta', 'pto. vta', 'pto_vta', 'pv']);
    const idxNumDesde = findHeaderIdx(['número desde', 'numero desde', 'nro desde', 'numero', 'número', 'num']);
    const idxCuit = findHeaderIdx(['nro. doc. emisor', 'nro doc emisor', 'nro. doc. receptor', 'nro doc receptor', 'cuit', 'nro. doc', 'nro doc', 'cuit contraparte', 'codigo aduana']);
    const idxRazon = findHeaderIdx(['denominación emisor', 'denominacion emisor', 'denominación receptor', 'denominacion receptor', 'razón social', 'razon social', 'nombre', 'razon', 'aduana']);
    
    // Columnas de montos
    const idxNeto = findHeaderIdx(['imp. neto gravado', 'neto gravado', 'imp neto gravado', 'neto', 'cif_neto']);
    const idxTotal = findHeaderIdx(['imp. total', 'monto total', 'total']);
    const idxIva = findHeaderIdx(['iva', 'impuesto liquidado', 'débito fiscal', 'debito fiscal', 'crédito fiscal', 'credito fiscal']);
    const idxAlicuota = findHeaderIdx(['alícuota', 'alicuota', 'tasa']);
    const idxTributos = findHeaderIdx(['otros tributos', 'percepciones', 'retenciones', 'percepcion']);

    let fileIsVenta = rawHeaders.some(h => h.includes('receptor')) || rawHeaders.some(h => h.includes('cliente'));
    let fileIsCompra = rawHeaders.some(h => h.includes('emisor')) || rawHeaders.some(h => h.includes('proveedor'));
    let fileIsImpo = rawHeaders.some(h => h.includes('despacho') || h.includes('aduana') || h.includes('cif'));

    const parsedVouchers = [];

    for (let i = 1; i < lines.length; i++) {
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

      let ptoVta = idxPtoVta >= 0 ? cols[idxPtoVta] : (cols[2] || '00001');
      let numero = idxNumDesde >= 0 ? cols[idxNumDesde] : (cols[3] || '00000001');

      let cuitRaw = idxCuit >= 0 ? cols[idxCuit] : (cols[4] || '30000000000');
      let cuit = String(cuitRaw).replace(/\D/g, '');
      if (cuit.length === 11) {
        cuit = `${cuit.substring(0, 2)}-${cuit.substring(2, 10)}-${cuit.substring(10)}`;
      }

      let razon = idxRazon >= 0 ? cols[idxRazon] : (cols[5] || 'Contribuyente ARCA');
      
      let neto = idxNeto >= 0 ? parseArgNumber(cols[idxNeto]) : 0;
      let total = idxTotal >= 0 ? parseArgNumber(cols[idxTotal]) : 0;
      let iva = idxIva >= 0 ? parseArgNumber(cols[idxIva]) : 0;
      let alicuotaExplicit = idxAlicuota >= 0 ? parseArgNumber(cols[idxAlicuota]) : null;
      let retenciones = idxTributos >= 0 ? parseArgNumber(cols[idxTributos]) : (cols[8] ? parseArgNumber(cols[8]) : 0);

      // Si neto es 0 pero total > 0 e iva > 0
      if (neto === 0 && total > 0) {
        neto = total - iva - retenciones;
        if (neto < 0) neto = total;
      }

      // Si no viene Neto Gravado específico en la fila pero hay Total
      if (neto === 0 && cols[6]) {
        neto = parseArgNumber(cols[6]);
      }

      // Determinar alícuota
      let alicuota = 21;
      if (alicuotaExplicit !== null && alicuotaExplicit > 0) {
        alicuota = alicuotaExplicit;
      } else if (neto > 0 && iva > 0) {
        const calcAli = (iva / neto) * 100;
        if (Math.abs(calcAli - 21) < 2) alicuota = 21;
        else if (Math.abs(calcAli - 10.5) < 2) alicuota = 10.5;
        else if (Math.abs(calcAli - 27) < 2) alicuota = 27;
        else if (Math.abs(calcAli - 5) < 1) alicuota = 5;
        else if (Math.abs(calcAli - 2.5) < 1) alicuota = 2.5;
        else alicuota = Math.round(calcAli * 10) / 10;
      } else if (iva === 0 && neto > 0) {
        // Asumir alícuota general 21% si no viene discriminada
        iva = (neto * 0.21);
        alicuota = 21;
      }

      // Determine Operation Type (tipoOp)
      let tipoOp = 'compra';
      if (tipoDoc.includes('Factura E') || tipoDoc.toLowerCase().includes('export')) {
        tipoOp = 'exportacion';
        alicuota = 0;
        iva = 0;
      } else if (fileIsImpo || tipoDoc.toLowerCase().includes('despacho')) {
        tipoOp = 'importacion';
      } else if (fileIsVenta || defaultTipoOp === 'venta') {
        tipoOp = 'venta';
      } else if (fileIsCompra || defaultTipoOp === 'compra') {
        tipoOp = 'compra';
      }

      const ptoClean = String(ptoVta).replace(/\D/g, '').padStart(5, '0');
      const numClean = String(numero).replace(/\D/g, '').padStart(8, '0');
      const fullNumero = (ptoClean !== '00000' && numClean !== '00000000') ? `${ptoClean}-${numClean}` : String(numero);

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
        esAduanera: tipoOp === 'importacion' ? 'si' : 'no'
      });
    }

    return parsedVouchers;
  }

  return {
    parseArcaCSV,
    parseDDJJAnterior,
    parseArgNumber,
    parseArgDate
  };
})();
