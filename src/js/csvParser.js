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

    if (/^1\b|^001\b/i.test(s) && !s.includes('11') && !s.includes('19')) return 'Factura A';
    if (/^2\b|^002\b/i.test(s)) return 'Nota de Débito A';
    if (/^3\b|^003\b/i.test(s)) return 'Nota de Crédito A';
    if (/^6\b|^006\b/i.test(s)) return 'Factura B';
    if (/^7\b|^007\b/i.test(s)) return 'Nota de Crédito B';
    if (/^8\b|^008\b/i.test(s)) return 'Nota de Débito B';
    if (/^11\b|^011\b/i.test(s)) return 'Factura C';
    if (/^19\b|^019\b/i.test(s) || s.toUpperCase().includes('FACTURA E') || s.toUpperCase().includes('EXPORT')) return 'Factura E';
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

    const rawHeaders = firstLine.split(delimiter).map(h => normalizeStr(h));

    function findHeaderIdx(patterns) {
      return rawHeaders.findIndex(h => patterns.some(p => h.includes(p)));
    }

    const isMisRetenciones = rawHeaders.some(h => h.includes('retenido') || h.includes('percibido') || h.includes('agente') || h.includes('regimen') || h.includes('deduccion'));

    const idxFecha = findHeaderIdx(['fecha', 'date', 'emision', 'fecha ret']);
    const idxTipo = findHeaderIdx(['tipo', 'comprobante', 'doc', 'cbte', 'impuesto', 'regimen']);
    const idxPtoVta = findHeaderIdx(['punto de venta', 'pto vta', 'pv', 'punto vta']);
    const idxNumDesde = findHeaderIdx(['numero desde', 'nro desde', 'numero', 'num', 'cbte nro', 'nro comprobante']);
    
    const idxCuitAgente = findHeaderIdx(['cuit agente', 'nro doc agente', 'doc agente']);
    const idxCuitEmisor = findHeaderIdx(['nro doc emisor', 'doc emisor', 'cuit emisor']);
    const idxCuitReceptor = findHeaderIdx(['nro doc receptor', 'doc receptor', 'cuit receptor']);
    const idxCuitGen = findHeaderIdx(['cuit', 'nro doc', 'doc', 'cuit contraparte', 'codigo aduana']);
    const idxCuit = idxCuitAgente >= 0 ? idxCuitAgente : (idxCuitEmisor >= 0 ? idxCuitEmisor : (idxCuitReceptor >= 0 ? idxCuitReceptor : idxCuitGen));

    const idxRazonAgente = findHeaderIdx(['denominacion agente', 'nombre agente', 'agente']);
    const idxRazonEmisor = findHeaderIdx(['denominacion emisor', 'nombre emisor', 'razon social emisor']);
    const idxRazonReceptor = findHeaderIdx(['denominacion receptor', 'nombre receptor', 'razon social receptor']);
    const idxRazonGen = findHeaderIdx(['denominacion', 'razon social', 'nombre', 'razon', 'aduana']);
    const idxRazon = idxRazonAgente >= 0 ? idxRazonAgente : (idxRazonEmisor >= 0 ? idxRazonEmisor : (idxRazonReceptor >= 0 ? idxRazonReceptor : idxRazonGen));

    const idxNeto = findHeaderIdx(['imp neto gravado', 'neto gravado', 'neto', 'cif neto', 'subtotal']);
    const idxTotal = findHeaderIdx(['imp total', 'monto total', 'total', 'importe total']);
    const idxIva = findHeaderIdx(['iva', 'impuesto liquidado', 'debito fiscal', 'credito fiscal', 'imp iva']);
    const idxAlicuota = findHeaderIdx(['alicuota', 'tasa', 'pct']);
    const idxTributos = findHeaderIdx(['otros tributos', 'percepciones', 'retenciones', 'percepcion', 'retencion', 'importe retenido', 'importe percibido', 'monto retenido', 'monto percibido']);

    const isVentasFile = rawHeaders.some(h => h.includes('receptor') || h.includes('cliente'));
    const isComprasFile = rawHeaders.some(h => h.includes('emisor') || h.includes('proveedor'));
    const isImpoFile = rawHeaders.some(h => h.includes('despacho') || h.includes('aduana') || h.includes('cif'));

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

      let razon = idxRazon >= 0 ? cols[idxRazon] : (cols[5] || 'Agente / Contribuyente ARCA');

      let neto = idxNeto >= 0 ? parseArgNumber(cols[idxNeto]) : 0;
      let total = idxTotal >= 0 ? parseArgNumber(cols[idxTotal]) : 0;
      let iva = idxIva >= 0 ? parseArgNumber(cols[idxIva]) : 0;
      let alicuotaExplicit = idxAlicuota >= 0 ? parseArgNumber(cols[idxAlicuota]) : null;
      let retenciones = idxTributos >= 0 ? parseArgNumber(cols[idxTributos]) : (cols[8] ? parseArgNumber(cols[8]) : 0);

      let esAduanera = 'no';
      const lineNorm = normalizeStr(line);
      if (isMisRetenciones || lineNorm.includes('retencion') || lineNorm.includes('percepcion')) {
        if (retenciones === 0 && total > 0) {
          retenciones = total;
        }
        if (lineNorm.includes('aduana') || lineNorm.includes('767') || lineNorm.includes('rg 5339')) {
          esAduanera = 'si';
          tipoDoc = 'Percepción Aduanera (RG 5339)';
        } else if (lineNorm.includes('percepcion')) {
          tipoDoc = 'Constancia Percepción IVA';
        } else {
          tipoDoc = 'Certificado Retención IVA';
        }
      }

      if (neto === 0 && total > 0) {
        if (iva > 0) {
          neto = total - iva - retenciones;
        } else {
          neto = Math.round((total / 1.21) * 100) / 100;
          iva = Math.round((total - neto) * 100) / 100;
        }
        if (neto < 0) neto = total;
      }

      if (neto === 0) {
        cols.forEach((colVal, cIdx) => {
          const valNum = parseArgNumber(colVal);
          if (valNum > 100 && neto === 0 && cIdx !== idxPtoVta && cIdx !== idxNumDesde) {
            neto = valNum;
          }
        });
      }

      if (iva === 0 && neto > 0 && !tipoDoc.includes('Factura E')) {
        iva = Math.round((neto * 0.21) * 100) / 100;
      }

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

      let tipoOp = 'compra';
      if (tipoDoc.includes('Factura E') || tipoDoc.toLowerCase().includes('export')) {
        tipoOp = 'exportacion';
        alicuota = 0;
        iva = 0;
      } else if (isImpoFile || tipoDoc.toLowerCase().includes('despacho')) {
        tipoOp = 'importacion';
      } else if (isVentasFile || defaultTipoOp === 'venta') {
        tipoOp = 'venta';
      } else if (isComprasFile || defaultTipoOp === 'compra') {
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
        esAduanera: esAduanera === 'si' || tipoOp === 'importacion' ? 'si' : 'no'
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
