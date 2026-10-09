/**
 * Export Engine for ARCA Files (Libro IVA Digital TXT) & Working Papers (Excel/CSV)
 */

window.ExportEngine = (function() {
  /* ==================================================================
   * LIBRO IVA DIGITAL (RG 4597) - Diseño de registro oficial ARCA
   * (validado contra el importador del LID). Archivos de ancho fijo:
   *   LIBRO_IVA_DIGITAL_VENTAS_CBTE        266 caracteres
   *   LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS    62 caracteres
   *   LIBRO_IVA_DIGITAL_COMPRAS_CBTE       325 caracteres
   *   LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS   84 caracteres
   *   LIBRO_IVA_DIGITAL_IMPORTACIONES       50 caracteres
   * Importes: 15 posiciones (13 enteros + 2 decimales, sin separador).
   * Codificación ANSI (Windows-1252), fin de línea CRLF.
   * CBTE y ALICUOTAS se generan en el mismo orden.
   * ================================================================== */

  const LONG = { VTA_CBTE: 266, VTA_ALI: 62, CPA_CBTE: 325, CPA_ALI: 84, IMPO: 50 };
  const CUIT_ADUANA_DEFAULT = '33693450239'; // DGA - Dirección General de Aduanas

  // Tabla de comprobantes ARCA
  const TIPOS_CBTE = [
    [/despacho|importaci/i, 66],
    [/nota de d[ée]bito a\b|\bnd a\b/i, 2], [/nota de cr[ée]dito a\b|\bnc a\b/i, 3], [/factura a\b/i, 1],
    [/nota de d[ée]bito b\b|\bnd b\b/i, 7], [/nota de cr[ée]dito b\b|\bnc b\b/i, 8], [/factura b\b/i, 6],
    [/nota de d[ée]bito c\b|\bnd c\b/i, 12], [/nota de cr[ée]dito c\b|\bnc c\b/i, 13], [/factura c\b/i, 11],
    [/nota de d[ée]bito e\b|\bnd e\b/i, 20], [/nota de cr[ée]dito e\b|\bnc e\b/i, 21], [/factura e\b/i, 19],
    [/nota de d[ée]bito m\b|\bnd m\b/i, 52], [/nota de cr[ée]dito m\b|\bnc m\b/i, 53], [/factura m\b/i, 51]
  ];

  // Códigos de alícuota de IVA ARCA
  function codigoAlicuota(tasa) {
    const t = Math.abs(Number(tasa) || 0);
    if (t === 0) return '0003';
    if (Math.abs(t - 10.5) < 0.01) return '0004';
    if (Math.abs(t - 21) < 0.01) return '0005';
    if (Math.abs(t - 27) < 0.01) return '0006';
    if (Math.abs(t - 5) < 0.01) return '0008';
    if (Math.abs(t - 2.5) < 0.01) return '0009';
    return '0005';
  }

  function codigoTipoCbte(c) {
    if (c.tipoOp === 'importacion') return 66;
    const s = String(c.tipoDoc || '').replace(/\s*\(.*\)\s*$/, '').trim(); // quita "(USD @ 950)"
    const num = s.match(/^0*(\d{1,3})\b/);
    if (num) return parseInt(num[1], 10);
    for (const [re, cod] of TIPOS_CBTE) if (re.test(s)) return cod;
    return c.tipoOp === 'exportacion' ? 19 : 1;
  }

  const esClaseBoC = (cod) => [6, 7, 8, 11, 12, 13].includes(cod);
  const esClaseC = (cod) => [11, 12, 13].includes(cod);

  // Comprobantes que NO van al Libro IVA (retenciones / percepciones sufridas)
  function esSoloPagoACuenta(c) {
    const s = String(c.tipoDoc || '');
    return /retenci|percepci|certificado|constancia|sircer/i.test(s) && !/factura|nota de|despacho/i.test(s);
  }

  // ---------- Formateadores de campos ----------
  const num = (v, len) => String(v == null ? '' : v).replace(/\D/g, '').slice(-len).padStart(len, '0');
  const alfa = (v, len) => quitarNoAnsi(String(v == null ? '' : v)).substring(0, len).padEnd(len, ' ');
  const imp = (v) => {
    const cents = Math.round(Math.abs(Number(v) || 0) * 100);
    return String(cents).padStart(15, '0').slice(-15);
  };
  const fecha = (f) => {
    const s = String(f || '');
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}${m[2]}${m[3]}`;
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return `${m[3]}${m[2]}${m[1]}`;
    return num(s, 8);
  };
  const TC_PESOS = '0001000000'; // 4 enteros + 6 decimales (los importes ya están convertidos a pesos)

  function quitarNoAnsi(s) {
    // Mantiene caracteres Latin-1 (á, é, ñ, etc.); el resto se translitera o se reemplaza
    return s.replace(/[\r\n\t]/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF]/g, ch => {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      return /^[\x20-\x7E]$/.test(base) ? base : ' ';
    });
  }

  function documento(cuitRaw) {
    const d = String(cuitRaw || '').replace(/\D/g, '');
    if (d.length === 11) return { cod: '80', nro: d };          // CUIT
    if (d.length >= 7 && d.length <= 8) return { cod: '96', nro: d }; // DNI
    return { cod: '99', nro: '0' };                              // Sin identificar
  }

  function partirNumero(numero) {
    const s = String(numero || '');
    const parts = s.split('-');
    if (parts.length >= 2) return { ptoVta: num(parts[0], 5), nro: num(parts[1], 20) };
    const d = s.replace(/\D/g, '');
    if (d.length > 8) return { ptoVta: num(d.slice(0, d.length - 8), 5), nro: num(d.slice(-8), 20) };
    return { ptoVta: '00001', nro: num(d || '1', 20) };
  }

  function normalizarDespacho(numero) {
    return String(numero || '').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 16).padEnd(16, ' ');
  }

  /**
   * Agrupa las filas internas (una por alícuota) en comprobantes.
   * El parser puede partir una factura en varias filas, una por cada alícuota.
   */
  function agruparComprobantes(lista) {
    const map = new Map();
    lista.forEach(c => {
      const tipo = codigoTipoCbte(c);
      const doc = documento(c.cuit);
      const esImpo = tipo === 66;
      const pn = esImpo ? { ptoVta: '00000', nro: num('0', 20) } : partirNumero(c.numero);
      const key = [tipo, pn.ptoVta, pn.nro, esImpo ? normalizarDespacho(c.numero) : '', doc.nro].join('|');
      if (!map.has(key)) {
        map.set(key, {
          fecha: fecha(c.fecha), tipo, ptoVta: pn.ptoVta, nro: pn.nro,
          despacho: esImpo ? normalizarDespacho(c.numero) : null,
          doc, razon: c.razon || '', tipoOp: c.tipoOp,
          percepcionIVA: 0, alicuotas: new Map()
        });
      }
      const g = map.get(key);
      const neto = Math.abs(Number(c.neto) || 0);
      const ivaExpl = c.iva != null && c.iva !== '' ? Math.abs(Number(c.iva) || 0) : null;
      const iva = c.tipoOp === 'exportacion' ? 0
        : (ivaExpl != null && (ivaExpl > 0 || Number(c.alicuota) === 0) ? ivaExpl
          : Math.round(neto * (Number(c.alicuota) || 0)) / 100);
      const codAli = c.tipoOp === 'exportacion' ? '0003' : codigoAlicuota(c.alicuota);
      const a = g.alicuotas.get(codAli) || { neto: 0, iva: 0 };
      a.neto += neto; a.iva += iva;
      g.alicuotas.set(codAli, a);
      g.percepcionIVA += Math.abs(Number(c.retenciones) || 0);
    });
    const res = Array.from(map.values());
    res.forEach(g => {
      g.noGravado = 0;
      g.alicuotas = ajustarAlicuotas(g, Array.from(g.alicuotas.entries())
        .map(([cod, v]) => ({ cod, neto: Math.round(v.neto * 100) / 100, iva: Math.round(v.iva * 100) / 100 })));
      g.netoTotal = g.alicuotas.reduce((s, a) => s + a.neto, 0);
      g.ivaTotal = g.alicuotas.reduce((s, a) => s + a.iva, 0);
    });
    res.sort((x, y) => x.fecha.localeCompare(y.fecha) || x.tipo - y.tipo || x.ptoVta.localeCompare(y.ptoVta) || x.nro.localeCompare(y.nro));
    return res;
  }

  /**
   * ARCA exige que en cada alícuota: IVA = neto gravado x tasa.
   * Los exports de "Mis Comprobantes" traen un solo neto y un solo IVA por
   * comprobante; en tiques de supermercado (21% + 10,5% mezclados) eso no
   * cuadra con ninguna tasa. Acá se reparte el neto entre las dos tasas que
   * explican el IVA informado (sin cambiar el IVA total del comprobante).
   */
  const TASA_COD = { '0004': 10.5, '0005': 21, '0006': 27, '0008': 5, '0009': 2.5 };
  const COD_TASA = { 2.5: '0009', 5: '0008', 10.5: '0004', 21: '0005', 27: '0006' };
  const r2 = (x) => Math.round(x * 100) / 100;

  function ajustarAlicuotas(g, alis) {
    const out = [];
    alis.forEach(a => {
      const tasa = TASA_COD[a.cod];
      if (!tasa || a.neto <= 0 || Math.abs(r2(a.neto * tasa / 100) - a.iva) <= 0.01) { out.push(a); return; }
      const efectiva = a.iva / a.neto * 100;
      // Tasas vecinas que encierran la tasa efectiva
      const tasas = [10.5, 21, 27];
      let baja = null, alta = null;
      for (let i = 0; i < tasas.length - 1; i++) if (efectiva > tasas[i] && efectiva < tasas[i + 1]) { baja = tasas[i]; alta = tasas[i + 1]; }
      if (baja !== null) {
        // nA + nB = N ; nA*alta + nB*baja = IVA  ->  nA = (IVA - N*baja) / (alta - baja)
        const nAlta = r2((a.iva * 100 - a.neto * baja) / (alta - baja));
        const nBaja = r2(a.neto - nAlta);
        const ivaAlta = r2(nAlta * alta / 100);
        const ivaBaja = r2(nBaja * baja / 100);
        out.push({ cod: COD_TASA[alta], neto: nAlta, iva: ivaAlta });
        out.push({ cod: COD_TASA[baja], neto: nBaja, iva: ivaBaja });
      } else if (efectiva < 10.5) {
        // Parte gravada al 10,5% (o a la tasa del comprobante) y el resto no gravado/exento
        const t = efectiva < tasa ? tasa : 10.5;
        const nGrav = r2(a.iva * 100 / t);
        out.push({ cod: COD_TASA[t], neto: nGrav, iva: r2(nGrav * t / 100) });
        g.noGravado += r2(a.neto - nGrav);
      } else {
        // Tasa efectiva mayor a 27%: se recalcula el IVA sobre el neto
        out.push({ cod: a.cod, neto: a.neto, iva: r2(a.neto * tasa / 100) });
      }
    });
    // Unifica si quedaron dos renglones con la misma alícuota
    const m = new Map();
    out.forEach(a => { const x = m.get(a.cod) || { cod: a.cod, neto: 0, iva: 0 }; x.neto = r2(x.neto + a.neto); x.iva = r2(x.iva + a.iva); m.set(a.cod, x); });
    return Array.from(m.values()).filter(a => a.neto !== 0 || a.iva !== 0 || a.cod === '0003');
  }

  function verificarLongitud(lineas, largo, nombre) {
    lineas.forEach((l, i) => {
      if (l.length !== largo) console.error(`[LID] ${nombre} línea ${i + 1}: largo ${l.length} (esperado ${largo})`);
    });
  }

  /**
   * VENTAS: devuelve { cbte, alicuotas } (texto de cada archivo).
   */
  function generarLIDVentas(comprobantes) {
    const grupos = agruparComprobantes(
      comprobantes.filter(c => (c.tipoOp === 'venta' || c.tipoOp === 'exportacion') && !esSoloPagoACuenta(c))
    );
    const cbte = [], ali = [];

    grupos.forEach(g => {
      const esExpo = [19, 20, 21].includes(g.tipo);
      const soloCero = g.alicuotas.every(a => a.cod === '0003');
      let exentas = 0, codOp = ' ';
      let alis = g.alicuotas;

      if (esExpo) {
        codOp = 'X';
      } else if (soloCero) {
        codOp = 'E';
        exentas = g.netoTotal;
        alis = [{ cod: '0003', neto: 0, iva: 0 }];
      }
      if (esClaseC(g.tipo)) alis = [];

      const total = g.netoTotal + g.ivaTotal + g.noGravado;

      cbte.push(
        g.fecha +                         // 1  Fecha comprobante
        num(g.tipo, 3) +                  // 2  Tipo de comprobante
        g.ptoVta +                        // 3  Punto de venta
        g.nro +                           // 4  Número de comprobante
        g.nro +                           // 5  Número de comprobante hasta
        g.doc.cod +                       // 6  Código documento comprador
        num(g.doc.nro, 20) +              // 7  Número identificación comprador
        alfa(g.razon, 30) +               // 8  Apellido y nombre / denominación
        imp(total) +                      // 9  Importe total
        imp(g.noGravado) +                // 10 Conceptos no gravados
        imp(0) +                          // 11 Percepción a no categorizados
        imp(exentas) +                    // 12 Operaciones exentas
        imp(0) +                          // 13 Percepciones impuestos nacionales
        imp(0) +                          // 14 Percepciones IIBB
        imp(0) +                          // 15 Percepciones municipales
        imp(0) +                          // 16 Impuestos internos
        'PES' +                           // 17 Código de moneda
        TC_PESOS +                        // 18 Tipo de cambio
        String(alis.length) +             // 19 Cantidad de alícuotas
        codOp +                           // 20 Código de operación
        imp(0) +                          // 21 Otros tributos
        '00000000'                        // 22 Fecha vencimiento de pago
      );

      alis.forEach(a => ali.push(
        num(g.tipo, 3) + g.ptoVta + g.nro + imp(a.neto) + a.cod + imp(a.iva)
      ));
    });

    verificarLongitud(cbte, LONG.VTA_CBTE, 'VENTAS_CBTE');
    verificarLongitud(ali, LONG.VTA_ALI, 'VENTAS_ALICUOTAS');
    return { cbte: cbte.join('\r\n'), alicuotas: ali.join('\r\n'), cantidad: grupos.length };
  }

  /**
   * COMPRAS (incluye despachos de importación tipo 066):
   * devuelve { cbte, alicuotas, importaciones }.
   */
  function generarLIDCompras(comprobantes) {
    const grupos = agruparComprobantes(
      comprobantes.filter(c => (c.tipoOp === 'compra' || c.tipoOp === 'importacion') && !esSoloPagoACuenta(c))
        .filter(c => (Number(c.neto) || 0) !== 0 || (Number(c.iva) || 0) !== 0)
    );
    const cbte = [], ali = [], impo = [];

    grupos.forEach(g => {
      const esImpo = g.tipo === 66;
      let alis = g.alicuotas;
      let codOp = ' ';
      let exentas = 0;
      let doc = g.doc;

      if (esImpo && doc.cod !== '80') doc = { cod: '80', nro: CUIT_ADUANA_DEFAULT };

      if (esClaseBoC(g.tipo)) {
        alis = []; // B y C: sin discriminar IVA, cantidad de alícuotas = 0
      } else if (alis.every(a => a.cod === '0003')) {
        codOp = esImpo ? 'X' : 'E';
        if (!esImpo) { exentas = g.netoTotal; alis = [{ cod: '0003', neto: 0, iva: 0 }]; }
      }

      const ivaComputable = esClaseBoC(g.tipo) ? 0 : g.ivaTotal;
      const total = g.netoTotal + g.ivaTotal + g.noGravado + g.percepcionIVA;

      cbte.push(
        g.fecha +                                   // 1  Fecha comprobante / oficialización
        num(g.tipo, 3) +                            // 2  Tipo de comprobante
        g.ptoVta +                                  // 3  Punto de venta
        g.nro +                                     // 4  Número de comprobante
        (esImpo ? g.despacho : ' '.repeat(16)) +    // 5  Despacho de importación
        doc.cod +                                   // 6  Código documento vendedor
        num(doc.nro, 20) +                          // 7  Número identificación vendedor
        alfa(g.razon, 30) +                         // 8  Denominación vendedor
        imp(total) +                                // 9  Importe total
        imp(g.noGravado) +                          // 10 Conceptos no gravados
        imp(exentas) +                              // 11 Operaciones exentas
        imp(g.percepcionIVA) +                      // 12 Percepciones / pagos a cuenta de IVA
        imp(0) +                                    // 13 Percepciones otros imp. nacionales
        imp(0) +                                    // 14 Percepciones IIBB
        imp(0) +                                    // 15 Percepciones municipales
        imp(0) +                                    // 16 Impuestos internos
        'PES' +                                     // 17 Código de moneda
        TC_PESOS +                                  // 18 Tipo de cambio
        String(alis.length) +                       // 19 Cantidad de alícuotas
        codOp +                                     // 20 Código de operación
        imp(ivaComputable) +                        // 21 Crédito fiscal computable
        imp(0) +                                    // 22 Otros tributos
        '00000000000' +                             // 23 CUIT emisor / corredor
        ' '.repeat(30) +                            // 24 Denominación emisor / corredor
        imp(0)                                      // 25 IVA comisión
      );

      alis.forEach(a => {
        if (esImpo) {
          impo.push(g.despacho + imp(a.neto) + a.cod + imp(a.iva));
        } else {
          ali.push(num(g.tipo, 3) + g.ptoVta + g.nro + doc.cod + num(doc.nro, 20) + imp(a.neto) + a.cod + imp(a.iva));
        }
      });
    });

    verificarLongitud(cbte, LONG.CPA_CBTE, 'COMPRAS_CBTE');
    verificarLongitud(ali, LONG.CPA_ALI, 'COMPRAS_ALICUOTAS');
    verificarLongitud(impo, LONG.IMPO, 'IMPORTACIONES');
    return { cbte: cbte.join('\r\n'), alicuotas: ali.join('\r\n'), importaciones: impo.join('\r\n'), cantidad: grupos.length };
  }

  /**
   * Suma el IVA tal como quedó escrito en los TXT (leyendo las líneas generadas),
   * separando facturas/ND de notas de crédito. Sirve para controlar contra la liquidación.
   */
  const CODIGOS_NC = new Set([3, 8, 13, 21, 53, 110, 112, 113, 114, 119]);
  function totalesTXT(tipo, comprobantes) {
    const t = { positivo: 0, nc: 0, impo: 0, lineas: 0 };
    const sumar = (texto, desde, hasta) => (texto ? texto.split('\r\n') : []).forEach(l => {
      const iva = (+l.slice(desde, hasta) || 0) / 100;
      if (CODIGOS_NC.has(+l.slice(0, 3))) t.nc += iva; else t.positivo += iva;
      t.lineas++;
    });
    if (tipo === 'ventas') {
      sumar(generarLIDVentas(comprobantes).alicuotas, 47, 62);
    } else {
      const r = generarLIDCompras(comprobantes);
      if (tipo === 'compras') sumar(r.alicuotas, 69, 84);
      (r.importaciones ? r.importaciones.split('\r\n') : []).forEach(l => { t.impo += (+l.slice(35, 50) || 0) / 100; t.lineas++; });
    }
    ['positivo', 'nc', 'impo'].forEach(k => { t[k] = Math.round(t[k] * 100) / 100; });
    return t;
  }

  // Compatibilidad con la API anterior (devuelven solo el archivo CBTE)
  function generateLIDVentasTXT(comprobantes) { return generarLIDVentas(comprobantes).cbte; }
  function generateLIDComprasTXT(comprobantes) { return generarLIDCompras(comprobantes).cbte; }
  function generateLIDImportacionesTXT(comprobantes) { return generarLIDCompras(comprobantes).importaciones; }

  /**
   * Codifica texto a bytes ANSI (Windows-1252 / ISO-8859-1), como exige ARCA.
   * Con UTF-8 las letras con tilde ocupan 2 bytes y rompen el ancho fijo.
   */
  function aBytesAnsi(texto) {
    // Se limpia cada línea por separado para NO perder los saltos de línea (CRLF)
    const s = String(texto).split(/\r?\n/).map(quitarNoAnsi).join('\r\n');
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xFF;
    return bytes;
  }

  /**
   * Descarga un TXT en formato ANSI listo para importar en Libro IVA Digital.
   */
  function downloadTxtAnsi(filename, content) {
    downloadFile(filename, aBytesAnsi(content), 'text/plain;charset=windows-1252');
  }

  /**
   * Descarga los archivos del Libro IVA Digital para el período.
   * tipo: 'ventas' | 'compras' | 'importaciones'
   */
  function exportarLID(tipo, comprobantes, cuit, periodo) {
    const sufijo = `${String(cuit || '').replace(/\D/g, '')}${periodo ? '_' + periodo : ''}`;
    const archivos = [];
    if (tipo === 'ventas') {
      const r = generarLIDVentas(comprobantes);
      if (!r.cantidad) return 0;
      archivos.push([`LIBRO_IVA_DIGITAL_VENTAS_CBTE_${sufijo}.txt`, r.cbte]);
      archivos.push([`LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS_${sufijo}.txt`, r.alicuotas]);
    } else if (tipo === 'compras') {
      const r = generarLIDCompras(comprobantes);
      if (!r.cantidad) return 0;
      archivos.push([`LIBRO_IVA_DIGITAL_COMPRAS_CBTE_${sufijo}.txt`, r.cbte]);
      archivos.push([`LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS_${sufijo}.txt`, r.alicuotas]);
      if (r.importaciones) archivos.push([`LIBRO_IVA_DIGITAL_IMPORTACIONES_${sufijo}.txt`, r.importaciones]);
    } else if (tipo === 'importaciones') {
      const r = generarLIDCompras(comprobantes);
      if (!r.importaciones) return 0;
      archivos.push([`LIBRO_IVA_DIGITAL_IMPORTACIONES_${sufijo}.txt`, r.importaciones]);
    }
    // Pequeña pausa entre descargas para que el navegador no bloquee las siguientes
    archivos.forEach(([nombre, contenido], i) => setTimeout(() => downloadTxtAnsi(nombre, contenido), i * 400));
    return archivos.length;
  }

  /**
   * Downloads a raw file in browser (content: string or Uint8Array).
   */
  function downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8;') {
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }

  /**
   * Exports Working Papers as Excel CSV.
   */
  function exportWorkingPaperCSV(taxSummary, contribuyente, periodoFiscal) {
    let csv = `PAPEL DE TRABAJO LIQUIDACION DE IVA - ARCA\n`;
    csv += `Contribuyente:;${contribuyente.razon}\n`;
    csv += `CUIT:;${contribuyente.cuit}\n`;
    csv += `Periodo:;${periodoFiscal || 'N/D'}\n\n`;

    csv += `CONCEPTO;MONTO NETO ($);IVA DÉBITO/CRÉDITO ($)\n`;
    csv += `Ventas Gravadas Mercado Interno;${taxSummary.dfNetoTotal.toFixed(2)};${taxSummary.dfTotal.toFixed(2)}\n`;
    csv += `Exportaciones (Factura E);${taxSummary.expoNetoTotal.toFixed(2)};0.00\n`;
    csv += `Compras Locales Gravadas;${taxSummary.cfNetoTotal.toFixed(2)};${taxSummary.cfTotalBruto.toFixed(2)}\n`;
    csv += `Despachos de Importacion SIM;${taxSummary.impoNetoTotal.toFixed(2)};${taxSummary.impoIVATotal.toFixed(2)}\n\n`;

    csv += `DETERMINACION DEL IMPUESTO\n`;
    csv += `Total Débito Fiscal;${taxSummary.dfTotal.toFixed(2)}\n`;
    csv += `Total Crédito Fiscal Computable;-${taxSummary.cfComputableTotal.toFixed(2)}\n`;
    csv += `Saldo Técnico Anterior;-${taxSummary.stAnterior.toFixed(2)}\n`;
    csv += `Saldo Técnico Resultante;${taxSummary.saldoTecnicoResultante.toFixed(2)}\n`;
    csv += `Retenciones IVA sufridas;-${taxSummary.retencionesLocales.toFixed(2)}\n`;
    csv += `Percepciones IVA sufridas;-${taxSummary.percepcionesLocales.toFixed(2)}\n`;
    csv += `Percepciones aduaneras;-${taxSummary.percepAduanerasTotal.toFixed(2)}\n`;
    csv += `Saldo Libre Disponibilidad Anterior;-${taxSummary.sldAnterior.toFixed(2)}\n`;
    csv += `Impuesto a Pagar Resultante;${taxSummary.impuestoAPagar.toFixed(2)}\n`;
    csv += `Saldo Libre Disponibilidad Resultante;${taxSummary.saldoLibreDisponibilidadResultante.toFixed(2)}\n`;

    // BOM para que Excel abra bien los acentos.
    downloadFile(`Papel_de_Trabajo_IVA_${String(contribuyente.cuit || '').replace(/\D/g, '')}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8;');
  }

  /**
   * Generates downloadable CSV template files.
   */
  function downloadTemplate(type) {
    let filename = '';
    let content = '';

    if (type === 'maestra') {
      filename = 'Plantilla_Maestra_Comprobantes_IVA.csv';
      // La columna TipoOperacion (venta / compra / exportacion / importacion) permite
      // mezclar todo en un solo archivo: manda sobre la zona por la que se suba.
      content = `TipoOperacion;Fecha;TipoComprobante;PuntoVenta;Numero;CUIT_Contraparte;RazonSocial;NetoGravado;AlicuotaIVA;Retenciones_Percepciones\n`;
      content += `venta;2026-08-01;Factura A;00001;00012345;30500012344;DISTRIBUIDORA EJEMPLO S.A.;500000.00;21.0;0.00\n`;
      content += `exportacion;2026-08-02;Factura E;00001;00000100;55001294810;CLIENTE EXTERIOR CORP (USA);1200000.00;0.0;0.00\n`;
      content += `compra;2026-08-05;Factura A;00002;00088910;30708912341;PROVEEDOR NACIONAL S.R.L.;250000.00;21.0;5250.00\n`;
      content += `importacion;2026-08-10;Despacho Impo;26001;IC04001999X;33999000019;ADUANA DE BUENOS AIRES SIM;3500000.00;21.0;700000.00\n`;
    } else if (type === 'ventas') {
      filename = 'Plantilla_Ventas_y_Exportaciones.csv';
      content = `Fecha;TipoComprobante;PuntoVenta;Numero;CUIT_Cliente;RazonSocial;NetoGravado;AlicuotaIVA;Retenciones\n`;
      content += `2026-08-01;Factura A;00001;00012345;30500012344;CLIENTE LOCAL S.A.;450000.00;21.0;0.00\n`;
      content += `2026-08-05;Factura E;00001;00000100;55001294810;IMPORTADOR EXTRANJERO LLC;850000.00;0.0;0.00\n`;
    } else if (type === 'compras') {
      filename = 'Plantilla_Compras_Locales.csv';
      content = `Fecha;TipoComprobante;PuntoVenta;Numero;CUIT_Proveedor;RazonSocial;NetoGravado;AlicuotaIVA;Percepciones\n`;
      content += `2026-08-03;Factura A;00005;00012940;30708912341;PROVEEDOR INDUSTRIAL S.A.;180000.00;21.0;3780.00\n`;
      content += `2026-08-12;Factura A;00001;00000845;30612345678;SERVICIOS TÉCNICOS S.R.L.;40000.00;27.0;0.00\n`;
    } else if (type === 'impo') {
      filename = 'Plantilla_Despachos_Importacion_SIM.csv';
      content = `Fecha;TipoComprobante;CodigoAduana;NumeroDespacho;CUITAduana;AduanaNombre;CIF_Neto;AlicuotaIVA;PercepcionAduaneraRG5339\n`;
      content += `2026-08-08;Despacho Impo;26001;IC04001294X;33999000019;ADUANA BUENOS AIRES;6500000.00;21.0;1300000.00\n`;
    } else if (type === 'retenciones') {
      filename = 'Plantilla_Retenciones_y_Percepciones.csv';
      content = `Fecha;TipoComprobante;NumeroComprobante;CUITAgente;DenominacionAgente;ImporteRetenidoPercibido;EsAduanera\n`;
      content += `2026-08-03;Certificado Retención IVA;00001-00004521;30500012344;DISTRIBUIDORA CLIENTE S.A.;45000.00;no\n`;
      content += `2026-08-08;Percepción Aduanera RG 5339;26001-IC04001294X;33999000019;ADUANA DE BUENOS AIRES;1300000.00;si\n`;
      content += `2026-08-15;Retención Bancaria SIRCER;00000-00994120;30999000029;BANCO DE LA NACIÓN ARGENTINA;12500.00;no\n`;
    }

    downloadFile(filename, content, 'text/csv;charset=utf-8;');
  }

  return {
    generateLIDVentasTXT,
    generateLIDComprasTXT,
    generateLIDImportacionesTXT,
    generarLIDVentas,
    generarLIDCompras,
    exportarLID,
    totalesTXT,
    downloadTxtAnsi,
    downloadFile,
    exportWorkingPaperCSV,
    downloadTemplate
  };
})();
