'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const forge = require('node-forge');
const wsaa = require('../server/arca/wsaa');

function certificadoDePrueba() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  const attrs = [{ name: 'commonName', value: 'test' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}
const { certPem, keyPem } = certificadoDePrueba();

test('formatArgTime convierte a hora argentina', () => {
  assert.strictEqual(wsaa.formatArgTime(new Date('2026-10-09T15:00:00Z')), '2026-10-09T12:00:00-03:00');
  assert.strictEqual(wsaa.formatArgTime(new Date('2026-10-10T01:30:05Z')), '2026-10-09T22:30:05-03:00');
});

test('buildTRA arma el XML con el servicio', () => {
  const tra = wsaa.buildTRA('ws_sr_constancia_inscripcion', new Date('2026-10-09T15:00:00Z'));
  assert.match(tra, /<service>ws_sr_constancia_inscripcion<\/service>/);
  assert.match(tra, /<generationTime>2026-10-09T11:50:00-03:00<\/generationTime>/);
  assert.match(tra, /<expirationTime>2026-10-09T12:10:00-03:00<\/expirationTime>/);
});

test('signTRA genera un CMS firmado que contiene el TRA', () => {
  const tra = wsaa.buildTRA('ws_sr_padron_a13');
  const cms = wsaa.signTRA(tra, certPem, keyPem);
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(cms)));
  assert.strictEqual(p7.rawCapture.content.value[0].value, tra);
  assert.strictEqual(p7.certificates.length, 1);
});

const RESPUESTA_OK = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><loginCmsReturn>&lt;?xml version="1.0" encoding="UTF-8" standalone="yes"?&gt;&lt;loginTicketResponse version="1.0"&gt;&lt;header&gt;&lt;source&gt;CN=wsaa&lt;/source&gt;&lt;destination&gt;SERIALNUMBER=CUIT 20111111112&lt;/destination&gt;&lt;uniqueId&gt;1&lt;/uniqueId&gt;&lt;generationTime&gt;2026-10-09T12:00:00.000-03:00&lt;/generationTime&gt;&lt;expirationTime&gt;2026-10-10T00:00:00.000-03:00&lt;/expirationTime&gt;&lt;/header&gt;&lt;credentials&gt;&lt;token&gt;PD94bWwgdG9rZW4=&lt;/token&gt;&lt;sign&gt;c2lnbg==&lt;/sign&gt;&lt;/credentials&gt;&lt;/loginTicketResponse&gt;</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`;

test('parseLoginResponse extrae token, sign y vencimiento', () => {
  const t = wsaa.parseLoginResponse(200, RESPUESTA_OK);
  assert.strictEqual(t.token, 'PD94bWwgdG9rZW4=');
  assert.strictEqual(t.sign, 'c2lnbg==');
  assert.strictEqual(t.expirationTime, '2026-10-10T00:00:00.000-03:00');
});

test('parseLoginResponse explica el error de "ticket ya vigente"', () => {
  const fault = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>ns1:coe.alreadyAuthenticated</faultcode><faultstring>El CEE ya posee un TA valido para el acceso al WSN solicitado</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;
  assert.throws(() => wsaa.parseLoginResponse(500, fault), (e) => e.code === 'WSAA_TA_VIGENTE');
});

test('parseLoginResponse informa otros rechazos', () => {
  const fault = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>ns1:cms.cert.untrusted</faultcode><faultstring>Certificado no emitido por AC de confianza</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;
  assert.throws(() => wsaa.parseLoginResponse(500, fault), /Certificado no emitido/);
});

test('getTicket guarda en caché y comparte pedidos simultáneos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsaa-'));
  wsaa.setCacheDir(dir);
  let llamadas = 0;
  wsaa._internals.setRequester(async () => {
    llamadas++;
    await new Promise((r) => setTimeout(r, 50));
    return { token: 'T', sign: 'S', expirationTime: new Date(Date.now() + 3600e3).toISOString() };
  });
  try {
    const args = { service: 'ws_sr_padron_a13', environment: 'testing', certPem, keyPem };
    const [a, b] = await Promise.all([wsaa.getTicket(args), wsaa.getTicket(args)]);
    assert.strictEqual(llamadas, 1, 'dos consultas juntas = un solo pedido a ARCA');
    assert.deepStrictEqual(a, b);
    await wsaa.getTicket(args);
    assert.strictEqual(llamadas, 1, 'la tercera usa la caché en disco');
    assert.strictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length, 1);
    await wsaa.getTicket({ ...args, environment: 'production' });
    assert.strictEqual(llamadas, 2, 'otro ambiente = otro ticket');
  } finally {
    wsaa._internals.setRequester(null);
  }
});

test('getTicket pide uno nuevo si el guardado está por vencer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsaa-'));
  wsaa.setCacheDir(dir);
  let llamadas = 0;
  wsaa._internals.setRequester(async () => {
    llamadas++;
    return { token: 'T' + llamadas, sign: 'S', expirationTime: new Date(Date.now() + 60e3).toISOString() };
  });
  try {
    const args = { service: 'x', environment: 'testing', certPem, keyPem };
    await wsaa.getTicket(args);
    await wsaa.getTicket(args);
    assert.strictEqual(llamadas, 2);
  } finally {
    wsaa._internals.setRequester(null);
  }
});
