'use strict';
/**
 * Envío de pedidos SOAP a los web services de ARCA.
 * Único lugar donde se hace HTTPS contra ARCA: todos los servicios (WSAA,
 * padrones, factura electrónica, etc.) usan esta función.
 */
const https = require('https');

const TIMEOUT_MS_DEFAULT = 20000;

function postSoap({ hostname, path, envelope, soapAction = '', timeoutMs = TIMEOUT_MS_DEFAULT }) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(envelope, 'utf8');
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': body.length,
        SOAPAction: soapAction
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`ARCA no respondió en ${Math.round(timeoutMs / 1000)} segundos (${hostname}). Probá de nuevo en unos minutos.`));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Escapa texto para meterlo dentro de un elemento XML. */
function xmlEscape(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Busca un SOAP Fault en el XML ya parseado y devuelve su texto (o null). */
function extraerFault(parsed) {
  const fault = parsed?.Envelope?.Body?.Fault;
  if (!fault) return null;
  return fault.faultstring || fault.faultcode || JSON.stringify(fault);
}

module.exports = { postSoap, xmlEscape, extraerFault, TIMEOUT_MS_DEFAULT };
