'use strict';
/**
 * Consulta al Padrón ARCA - Alcance 13 (ws_sr_padron_a13).
 * Devuelve razón social, condición frente al IVA, domicilio fiscal y actividades
 * de un CUIT, usando el token/sign obtenido del WSAA.
 */

const https = require('https');
const { XMLParser } = require('fast-xml-parser');

const PADRON_HOSTS = {
  testing: 'awshomo.afip.gov.ar',
  production: 'aws.afip.gov.ar'
};

function postSoap(hostname, soapEnvelope, soapAction) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(soapEnvelope, 'utf8');
    const req = https.request({
      hostname,
      path: '/sr-padron/webservices/personaServiceA13',
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

// Mapea el nombre de condición de IVA que devuelve ARCA a las categorías que usa el liquidador.
function inferCondicionIVA(persona) {
  const impuestos = [].concat(persona?.impuesto || []);
  const regimenes = [].concat(persona?.regGralActividadesUnicas || persona?.regimen || []);
  const monotributo = [].concat(persona?.monotributo || []);
  const idsImpuesto = impuestos.map((i) => String(i.idImpuesto ?? i));

  if (monotributo.length && monotributo[0]) return 'Responsable Monotributo';
  if (idsImpuesto.includes('30')) return 'IVA Responsable Inscripto'; // 30 = IVA en ARCA
  if (persona?.exento) return 'IVA Sujeto Exento';
  return 'Sin categorizar (verificar manualmente)';
}

/**
 * Consulta un CUIT en el padrón A13.
 * cuitRepresentada: CUIT titular del certificado/servicio (tu propio CUIT o el que representás).
 * idPersona: CUIT a consultar (puede ser el mismo que cuitRepresentada).
 */
async function getPersona({ environment, token, sign, cuitRepresentada, idPersona }) {
  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a13="http://a13.soap.ws.server.puc.sr/">
  <soapenv:Header/>
  <soapenv:Body>
    <a13:getPersona>
      <token>${token}</token>
      <sign>${sign}</sign>
      <cuitRepresentada>${cuitRepresentada}</cuitRepresentada>
      <idPersona>${idPersona}</idPersona>
    </a13:getPersona>
  </soapenv:Body>
</soapenv:Envelope>`;

  const host = PADRON_HOSTS[environment];
  if (!host) throw new Error(`Entorno ARCA inválido: ${environment}`);

  const { statusCode, body } = await postSoap(host, soapEnvelope, 'getPersona');
  if (statusCode !== 200) {
    throw new Error(`Padrón A13 respondió HTTP ${statusCode}: ${body.slice(0, 500)}`);
  }

  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const parsed = parser.parse(body);

  const fault = parsed?.Envelope?.Body?.Fault;
  if (fault) {
    throw new Error(`Padrón A13 rechazó la consulta: ${fault.faultstring || JSON.stringify(fault)}`);
  }

  const persona = parsed?.Envelope?.Body?.getPersonaResponse?.personaReturn?.persona;
  if (!persona) {
    throw new Error('CUIT no encontrado en el padrón de ARCA.');
  }

  const domicilios = [].concat(persona.domicilio || []);
  const fiscal = domicilios.find((d) => String(d.tipoDomicilio).toUpperCase().includes('FISCAL')) || domicilios[0] || {};
  const actividades = [].concat(persona.actividad || []);

  return {
    cuit: persona.idPersona,
    razonSocial: persona.razonSocial || `${persona.nombre || ''} ${persona.apellido || ''}`.trim(),
    tipoPersona: persona.tipoPersona, // FISICA | JURIDICA
    condicionIVA: inferCondicionIVA(persona),
    estadoClave: persona.estadoClave,
    domicilioFiscal: {
      direccion: [fiscal.direccion, fiscal.localidad, fiscal.descripcionProvincia]
        .filter(Boolean).join(', '),
      codigoPostal: fiscal.codigoPostal || null
    },
    actividades: actividades.map((a) => ({
      codigo: a.idActividad,
      descripcion: a.descripcionActividad,
      principal: a.orden === 1 || a.orden === '1'
    })),
    raw: persona // por si el liquidador necesita algún campo adicional no mapeado
  };
}

module.exports = { getPersona };
