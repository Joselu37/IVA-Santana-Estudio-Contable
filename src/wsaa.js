'use strict';
/**
 * Cliente WSAA (Web Service de Autenticación y Autorización) de ARCA.
 *
 * Flujo:
 *  1. Genera un TRA (Ticket de Requerimiento de Acceso) en XML.
 *  2. Lo firma en CMS/PKCS#7 usando el certificado + clave privada del contribuyente.
 *  3. Lo envía al WSAA (SOAP) y recibe token + sign, válidos por 12hs.
 *  4. Cachea el token en disco por servicio, para no pedir uno nuevo en cada request
 *     (ARCA bloquea si pedís tickets nuevos antes de que expire el anterior).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const forge = require('node-forge');
const { XMLParser } = require('fast-xml-parser');

const WSAA_URLS = {
  testing: 'wsaahomo.afip.gov.ar',
  production: 'wsaa.afip.gov.ar'
};

const CACHE_DIR = path.join(__dirname, '.token-cache');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function pad(n) { return String(n).padStart(2, '0'); }

// Formato requerido por WSAA: YYYY-MM-DDTHH:mm:ss-03:00 (hora Arg, sin milisegundos)
function formatArgTime(date) {
  // Convertimos a hora Argentina (UTC-3) manualmente para no depender de la TZ del server.
  const argMs = date.getTime() - 3 * 60 * 60 * 1000;
  const d = new Date(argMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}-03:00`;
}

function buildTRA(service) {
  const now = new Date();
  const generationTime = new Date(now.getTime() - 10 * 60 * 1000); // -10 min (margen de reloj)
  const expirationTime = new Date(now.getTime() + 10 * 60 * 1000); // +10 min
  const uniqueId = Math.floor(now.getTime() / 1000);

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${formatArgTime(generationTime)}</generationTime>
    <expirationTime>${formatArgTime(expirationTime)}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}

/**
 * Firma el TRA con el certificado (.crt/.pem) y clave privada (.key/.pem) del contribuyente.
 * Devuelve el CMS en base64, listo para mandar al WSAA.
 */
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

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

function postSoap(hostname, soapEnvelope, soapAction) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(soapEnvelope, 'utf8');
    const req = https.request({
      hostname,
      path: '/ws/services/LoginCms',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': body.length,
        'SOAPAction': soapAction
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Pide un ticket de acceso (token+sign) al WSAA para el servicio indicado.
 * environment: 'testing' | 'production'
 */
async function requestNewTicket({ service, environment, certPem, keyPem }) {
  const traXml = buildTRA(service);
  const cms = signTRA(traXml, certPem, keyPem);

  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const host = WSAA_URLS[environment];
  if (!host) throw new Error(`Entorno ARCA inválido: ${environment} (usar 'testing' o 'production')`);

  const { statusCode, body } = await postSoap(host, soapEnvelope, 'loginCms');

  if (statusCode !== 200) {
    throw new Error(`WSAA respondió HTTP ${statusCode}: ${body.slice(0, 500)}`);
  }

  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const outer = parser.parse(body);
  const fault = outer?.Envelope?.Body?.Fault;
  if (fault) {
    throw new Error(`WSAA rechazó la solicitud: ${fault.faultstring || JSON.stringify(fault)}`);
  }

  const loginCmsReturn = outer?.Envelope?.Body?.loginCmsResponse?.loginCmsReturn;
  if (!loginCmsReturn) {
    throw new Error('Respuesta de WSAA sin loginCmsReturn. Revisar certificado y ambiente.');
  }

  const inner = parser.parse(loginCmsReturn);
  const credentials = inner?.loginTicketResponse?.credentials;
  const header = inner?.loginTicketResponse?.header;
  if (!credentials || !header) {
    throw new Error('No se pudo interpretar el loginTicketResponse de WSAA.');
  }

  return {
    token: credentials.token,
    sign: credentials.sign,
    expirationTime: header.expirationTime
  };
}

function cacheFilePath(service, environment) {
  ensureCacheDir();
  const safe = `${service}_${environment}`.replace(/[^a-zA-Z0-9_]/g, '_');
  return path.join(CACHE_DIR, `${safe}.json`);
}

function readCache(service, environment) {
  const file = cacheFilePath(service, environment);
  if (!fs.existsSync(file)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Damos 5 minutos de margen antes de la expiración real.
    if (new Date(cached.expirationTime).getTime() - Date.now() > 5 * 60 * 1000) {
      return cached;
    }
  } catch (e) { /* cache corrupto, se pide uno nuevo */ }
  return null;
}

function writeCache(service, environment, ticket) {
  ensureCacheDir();
  fs.writeFileSync(cacheFilePath(service, environment), JSON.stringify(ticket), 'utf8');
}

/**
 * API pública: devuelve {token, sign}, usando caché en disco si sigue vigente.
 */
async function getTicket({ service, environment, certPem, keyPem }) {
  const cached = readCache(service, environment);
  if (cached) return cached;

  const ticket = await requestNewTicket({ service, environment, certPem, keyPem });
  writeCache(service, environment, ticket);
  return ticket;
}

module.exports = { getTicket, buildTRA, signTRA };
