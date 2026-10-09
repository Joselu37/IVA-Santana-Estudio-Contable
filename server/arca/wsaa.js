'use strict';
/**
 * Cliente WSAA (Web Service de Autenticación y Autorización) de ARCA.
 *
 * Flujo:
 *  1. Genera un TRA (Ticket de Requerimiento de Acceso) en XML.
 *  2. Lo firma en CMS/PKCS#7 con el certificado + clave privada.
 *  3. Lo envía al WSAA y recibe token + sign (válidos ~12 h).
 *  4. Guarda el ticket en disco por servicio/ambiente/certificado, porque ARCA
 *     rechaza pedir un ticket nuevo mientras el anterior siga vigente.
 *
 * Es un módulo autocontenido: sirve igual para padrón, factura electrónica
 * (wsfe), constancia de inscripción, etc. Solo cambia el nombre del servicio.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const forge = require('node-forge');
const { XMLParser } = require('fast-xml-parser');
const { postSoap, extraerFault, xmlEscape } = require('./soap');

const WSAA_HOSTS = {
  testing: 'wsaahomo.afip.gov.ar',
  production: 'wsaa.afip.gov.ar'
};
const WSAA_PATH = '/ws/services/LoginCms';

// Fuera de las carpetas que sirve el servidor web (ver server.js).
let cacheDir = path.join(__dirname, '..', '..', 'data', 'token-cache');
function setCacheDir(dir) { cacheDir = dir; if (typeof cacheMemoria !== 'undefined') cacheMemoria.clear(); }

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });

function pad(n) { return String(n).padStart(2, '0'); }

// Formato pedido por WSAA: YYYY-MM-DDTHH:mm:ss-03:00 (hora argentina, sin ms).
function formatArgTime(date) {
  const d = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}-03:00`;
}

function buildTRA(service, now = new Date()) {
  const generationTime = new Date(now.getTime() - 10 * 60 * 1000); // margen por reloj desfasado
  const expirationTime = new Date(now.getTime() + 10 * 60 * 1000);
  const uniqueId = Math.floor(now.getTime() / 1000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${formatArgTime(generationTime)}</generationTime>
    <expirationTime>${formatArgTime(expirationTime)}</expirationTime>
  </header>
  <service>${xmlEscape(service)}</service>
</loginTicketRequest>`;
}

/** Firma el TRA y devuelve el CMS en base64. */
function signTRA(traXml, certPem, keyPem) {
  const cert = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() }
    ]
  });
  p7.sign({ detached: false });
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

/** Interpreta la respuesta SOAP del WSAA. Exportada para poder testearla. */
function parseLoginResponse(statusCode, body) {
  let outer = null;
  try { outer = parser.parse(body); } catch (e) { /* se informa abajo */ }

  const fault = outer && extraerFault(outer);
  if (fault) {
    if (/alreadyAuthenticated|ya posee un TA valido/i.test(fault)) {
      const err = new Error('ARCA indica que ya existe un ticket vigente para este certificado y servicio, ' +
        'pero no está guardado en esta PC (se pidió desde otro programa o se borró la carpeta data/token-cache). ' +
        'Esperá a que venza (como máximo 12 horas) y volvé a intentar.');
      err.code = 'WSAA_TA_VIGENTE';
      throw err;
    }
    throw new Error(`WSAA rechazó la solicitud: ${fault}`);
  }
  if (statusCode !== 200) {
    throw new Error(`WSAA respondió HTTP ${statusCode}: ${String(body).slice(0, 300)}`);
  }

  const loginCmsReturn = outer?.Envelope?.Body?.loginCmsResponse?.loginCmsReturn;
  if (!loginCmsReturn) {
    throw new Error('Respuesta de WSAA sin loginCmsReturn. Revisá el certificado y el ambiente (testing/production).');
  }
  const inner = parser.parse(loginCmsReturn);
  const credentials = inner?.loginTicketResponse?.credentials;
  const header = inner?.loginTicketResponse?.header;
  if (!credentials?.token || !credentials?.sign || !header?.expirationTime) {
    throw new Error('No se pudo interpretar el loginTicketResponse de WSAA.');
  }
  return { token: credentials.token, sign: credentials.sign, expirationTime: header.expirationTime };
}

async function requestNewTicket({ service, environment, certPem, keyPem }) {
  const host = WSAA_HOSTS[environment];
  if (!host) throw new Error(`Entorno ARCA inválido: ${environment} (usar 'testing' o 'production')`);

  const cms = signTRA(buildTRA(service), certPem, keyPem);
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const { statusCode, body } = await postSoap({ hostname: host, path: WSAA_PATH, envelope, soapAction: 'loginCms' });
  return parseLoginResponse(statusCode, body);
}

// --- Caché en disco ---------------------------------------------------------

function huellaCertificado(certPem) {
  return crypto.createHash('sha256').update(String(certPem)).digest('hex').slice(0, 12);
}

function cacheFilePath(service, environment, certPem) {
  const safe = `${service}_${environment}_${huellaCertificado(certPem)}`.replace(/[^a-zA-Z0-9_]/g, '_');
  return path.join(cacheDir, `${safe}.json`);
}

const MARGEN_MS = 5 * 60 * 1000;

// Copia en memoria: si el disco falla (antivirus, permisos), el ticket recién
// emitido no se pierde mientras el servidor siga abierto.
const cacheMemoria = new Map();

function vigente(ticket) {
  return ticket && new Date(ticket.expirationTime).getTime() - Date.now() > MARGEN_MS;
}

function readCache(service, environment, certPem) {
  const file = cacheFilePath(service, environment, certPem);
  const enMemoria = cacheMemoria.get(file);
  if (vigente(enMemoria)) return enMemoria;
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (new Date(cached.expirationTime).getTime() - Date.now() > MARGEN_MS) return cached;
  } catch (e) { /* no existe o está corrupto: se pide uno nuevo */ }
  return null;
}

function writeCache(service, environment, certPem, ticket) {
  const file = cacheFilePath(service, environment, certPem);
  cacheMemoria.set(file, ticket);
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(ticket), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file); // escritura atómica: nunca queda un archivo a medio escribir
  } catch (e) {
    console.warn(`Aviso: no se pudo guardar el ticket de ARCA en disco (${e.message}). Se usa el de memoria.`);
  }
}

// Si llegan dos consultas juntas sin ticket guardado, comparten el mismo pedido
// al WSAA (si no, ARCA rechazaría el segundo).
const pedidosEnCurso = new Map();
let solicitarTicket = requestNewTicket; // reemplazable en los tests

/** API pública: devuelve {token, sign, expirationTime}, usando la caché si sigue vigente. */
async function getTicket({ service, environment, certPem, keyPem }) {
  const cached = readCache(service, environment, certPem);
  if (cached) return cached;

  const clave = cacheFilePath(service, environment, certPem);
  if (pedidosEnCurso.has(clave)) return pedidosEnCurso.get(clave);

  const pedido = (async () => {
    try {
      const ticket = await solicitarTicket({ service, environment, certPem, keyPem });
      writeCache(service, environment, certPem, ticket);
      return ticket;
    } finally {
      pedidosEnCurso.delete(clave);
    }
  })();
  pedidosEnCurso.set(clave, pedido);
  return pedido;
}

module.exports = {
  getTicket,
  buildTRA,
  signTRA,
  formatArgTime,
  parseLoginResponse,
  setCacheDir,
  _internals: { requestNewTicket, readCache, writeCache, pedidosEnCurso, setRequester(fn) { solicitarTicket = fn || requestNewTicket; } }
};
