/**
 * Universal ARCA / AFIP CSV & TXT Parser
 * Reads:
 * 1. ARCA "Mis Comprobantes Recibidos" (Compras) CSV/TXT
 * 2. ARCA "Mis Comprobantes Emitidos" (Ventas / Exportación E) CSV/TXT
 * 3. ARCA "Despachos de Importación SIM" (Aduana) CSV/TXT
 * 4. Libro de IVA Digital (LID) import files
 * 5. Custom Excel / Plantilla CSV exports
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
        // Argentine: 1.250,50 -> remove dots, replace comma with dot
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        // US: 1,250.50 -> remove commas
        s = s.replace(/,/g, '');
      }
    } else if (s.includes(',')) {
      // Single separator is comma -> decimal comma (e.g. 1250,50 -> 1250.50)
      s = s.replace(',', '.');
    }
    
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
  }

  // Helper: Parse Argentine Date (DD/MM/AAAA or AAAA-MM-DD) into YYYY-MM-DD
  function parseArgDate(val) {
    if (!val) return new Date().toISOString().substring(0, 10);
    const s = String(val).trim();

    // Check DD/MM/AAAA or DD-MM-AAAA
    const matchDMY = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (matchDMY) {
      const day = matchDMY[1].padStart(2, '0');
      const month = matchDMY[2].padStart(2, '0');
      const year = matchDMY[3];
      return `${year}-${month}-${day}`;
    }

    // Check AAAA-MM-DD
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

    // Official ARCA numeric codes:
    // 1=Factura A, 2=Nota de Debito A, 3=Nota de Credito A, 6=Factura B, 7=NC B, 8=ND B, 11=Factura C, 19=Factura E
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
   * Main CSV Parser Function
   */
  function parseArcaCSV(csvText, defaultTipoOp = null) {
    if (!csvText || typeof csvText !== 'string') return [];

    // Clean BOM if present
    const cleanText = csvText.replace(/^\uFEFF/, '').trim();
    const lines = cleanText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    // Determine Delimiter (; , \t |)
    const firstLine = lines[0];
    let delimiter = ';';
    if (firstLine.includes(';') && (firstLine.split(';').length >= firstLine.split(',').length)) {
      delimiter = ';';
    } else if (firstLine.includes('\t')) {
      delimiter = '\t';
    } else if (firstLine.includes(',')) {
      delimiter = ',';
    }

    // Split headers cleanly
    const rawHeaders = firstLine.split(delimiter).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

    // Header index finder helper
    function findHeaderIdx(patterns) {
      return rawHeaders.findIndex(h => patterns.some(p => h.includes(p)));
    }

    // Header Mappings for Official ARCA CSVs
    const idxFecha = findHeaderIdx(['fecha', 'date']);
    const idxTipo = findHeaderIdx(['tipo', 'comprobante', 'doc']);
    const idxPtoVta = findHeaderIdx(['punto de venta', 'pto vta', 'pto. vta', 'pto_vta', 'pv']);
    const idxNumDesde = findHeaderIdx(['número desde', 'numero desde', 'nro desde', 'numero', 'número', 'num']);
    const idxCuit = findHeaderIdx(['nro. doc. emisor', 'nro doc emisor', 'nro. doc. receptor', 'nro doc receptor', 'cuit', 'nro. doc', 'nro doc', 'cuit contraparte', 'codigo aduana']);
    const idxRazon = findHeaderIdx(['denominación emisor', 'denominacion emisor', 'denominación receptor', 'denominacion receptor', 'razón social', 'razon social', 'nombre', 'razon', 'aduana']);
    const idxNeto = findHeaderIdx(['imp. neto gravado', 'neto gravado', 'imp neto gravado', 'neto', 'cif_neto', 'imp. total']);
    const idxIva = findHeaderIdx(['iva', 'impuesto liquidado', 'débito fiscal', 'crédito fiscal']);
    const idxAlicuota = findHeaderIdx(['alícuota', 'alicuota', 'tasa']);
    const idxTributos = findHeaderIdx(['otros tributos', 'percepciones', 'retenciones', 'percepcion']);

    // Detect if this file is Compras (Recibidos) vs Ventas (Emitidos) vs Importaciones
    let fileIsVenta = rawHeaders.some(h => h.includes('receptor')) || rawHeaders.some(h => h.includes('cliente'));
    let fileIsCompra = rawHeaders.some(h => h.includes('emisor')) || rawHeaders.some(h => h.includes('proveedor'));
    let fileIsImpo = rawHeaders.some(h => h.includes('despacho') || h.includes('aduana') || h.includes('cif'));

    const parsedVouchers = [];

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle quoted CSV fields correctly
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

      // If headers weren't detected properly (e.g. no header line), fallback to column index
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
      
      let neto = parseArgNumber(idxNeto >= 0 ? cols[idxNeto] : cols[6]);
      let iva = idxIva >= 0 ? parseArgNumber(cols[idxIva]) : 0;
      let alicuotaExplicit = idxAlicuota >= 0 ? parseArgNumber(cols[idxAlicuota]) : null;
      let retenciones = idxTributos >= 0 ? parseArgNumber(cols[idxTributos]) : (cols[8] ? parseArgNumber(cols[8]) : 0);

      // Determine alicuota
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
      }

      // Determine Operation Type (tipoOp)
      let tipoOp = 'compra';
      if (tipoDoc.includes('Factura E') || tipoDoc.toLowerCase().includes('export')) {
        tipoOp = 'exportacion';
        alicuota = 0;
      } else if (fileIsImpo || tipoDoc.toLowerCase().includes('despacho')) {
        tipoOp = 'importacion';
      } else if (fileIsVenta || defaultTipoOp === 'venta') {
        tipoOp = 'venta';
      } else if (fileIsCompra || defaultTipoOp === 'compra') {
        tipoOp = 'compra';
      }

      // Format numero clean (00001-00001234)
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
        alicuota,
        retenciones,
        esAduanera: tipoOp === 'importacion' ? 'si' : 'no'
      });
    }

    return parsedVouchers;
  }

  return {
    parseArcaCSV,
    parseArgNumber,
    parseArgDate
  };
})();
