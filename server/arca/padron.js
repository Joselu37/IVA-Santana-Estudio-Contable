'use strict';
/**
 * Consultas al padrón de ARCA.
 *
 *  - A5  (ws_sr_constancia_inscripcion): datos de la constancia de inscripción.
 *        Es el que trae los impuestos (IVA, monotributo), así que es el que sirve
 *        para conocer la CONDICIÓN FRENTE AL IVA.
 *  - A13 (ws_sr_padron_a13): datos generales (nombre, domicilio, estado). No trae
 *        impuestos; se usa como respaldo si el certificado no tiene el A5.
 *
 * En ambos, cuitRepresentada es el CUIT dueño del certificado (el del estudio)
 * e idPersona es el CUIT que se consulta (puede ser cualquiera).
 */

const { XMLParser } = require('fast-xml-parser');
const { postSoap, xmlEscape, extraerFault } = require('./soap');

const HOSTS = {
  testing: 'awshomo.afip.gov.ar',
  production: 'aws.afip.gov.ar'
};

const SERVICIOS = {
  a5: {
    wsaaService: 'ws_sr_constancia_inscripcion',
    path: '/sr-padron/webservices/personaServiceA5',
    namespace: 'http://a5.soap.ws.server.puc.sr/',
    metodo: 'getPersona_v2'
  },
  a13: {
    wsaaService: 'ws_sr_padron_a13',
    path: '/sr-padron/webservices/personaServiceA13',
    namespace: 'http://a13.soap.ws.server.puc.sr/',
    metodo: 'getPersona'
  }
};

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
const lista = (x) => (x == null ? [] : [].concat(x));

function armarEnvelope(servicio, { token, sign, cuitRepresentada, idPersona }) {
  const s = SERVICIOS[servicio];
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="${s.namespace}">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:${s.metodo}>
      <token>${xmlEscape(token)}</token>
      <sign>${xmlEscape(sign)}</sign>
      <cuitRepresentada>${xmlEscape(cuitRepresentada)}</cuitRepresentada>
      <idPersona>${xmlEscape(idPersona)}</idPersona>
    </ns:${s.metodo}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// Códigos de impuesto de ARCA relevantes para IVA.
const IMP_IVA = '30';
const IMP_IVA_EXENTO = '32';
const IMP_MONOTRIBUTO = '20';

function condicionDesdeImpuestos(idsImpuesto, tieneMonotributo) {
  if (tieneMonotributo || idsImpuesto.includes(IMP_MONOTRIBUTO)) return 'Responsable Monotributo';
  if (idsImpuesto.includes(IMP_IVA)) return 'IVA Responsable Inscripto';
  if (idsImpuesto.includes(IMP_IVA_EXENTO)) return 'IVA Sujeto Exento';
  return 'Sin categorizar (verificar manualmente)';
}

function armarDireccion(dom) {
  if (!dom) return { direccion: '', codigoPostal: null };
  return {
    direccion: [dom.direccion, dom.localidad, dom.descripcionProvincia].filter(Boolean).join(', '),
    codigoPostal: dom.codPostal || dom.codigoPostal || null
  };
}

/** Normaliza la respuesta del A5 (getPersona_v2). */
function normalizarA5(personaReturn) {
  const errores = lista(personaReturn?.errorConstancia?.error).filter(Boolean);
  const dg = personaReturn?.datosGenerales;
  if (!dg) {
    throw new Error(errores.length ? `ARCA: ${errores.join(' / ')}` : 'CUIT no encontrado en el padrón de ARCA.');
  }
  const rg = personaReturn?.datosRegimenGeneral || {};
  const mono = personaReturn?.datosMonotributo;
  const impuestos = lista(rg.impuesto).concat(lista(mono?.impuesto));
  const idsImpuesto = impuestos.map((i) => String(i.idImpuesto ?? ''));
  const actividades = lista(rg.actividad).concat(lista(mono?.actividadMonotributista));

  return {
    cuit: String(dg.idPersona || ''),
    razonSocial: dg.razonSocial || `${dg.apellido || ''} ${dg.nombre || ''}`.trim(),
    tipoPersona: dg.tipoPersona || null,
    condicionIVA: condicionDesdeImpuestos(idsImpuesto, !!mono),
    categoriaMonotributo: mono?.categoriaMonotributo?.descripcionCategoria || null,
    estadoClave: dg.estadoClave || null,
    domicilioFiscal: armarDireccion(dg.domicilioFiscal),
    impuestos: impuestos.map((i) => ({ id: String(i.idImpuesto ?? ''), descripcion: i.descripcionImpuesto || '' })),
    actividades: actividades.map((a) => ({
      codigo: String(a.idActividad ?? ''),
      descripcion: a.descripcionActividad || '',
      principal: String(a.orden) === '1'
    })),
    avisos: errores,
    fuente: 'ARCA A5 (constancia de inscripción)'
  };
}

/** Normaliza la respuesta del A13 (getPersona). */
function normalizarA13(personaReturn) {
  const persona = personaReturn?.persona;
  if (!persona) throw new Error('CUIT no encontrado en el padrón de ARCA.');
  const domicilios = lista(persona.domicilio);
  const fiscal = domicilios.find((d) => String(d.tipoDomicilio).toUpperCase().includes('FISCAL')) || domicilios[0];
  return {
    cuit: String(persona.idPersona || ''),
    razonSocial: persona.razonSocial || `${persona.apellido || ''} ${persona.nombre || ''}`.trim(),
    tipoPersona: persona.tipoPersona || null,
    // El A13 no informa impuestos: no se puede saber la condición de IVA.
    condicionIVA: 'Sin categorizar (el padrón A13 no informa IVA)',
    categoriaMonotributo: null,
    estadoClave: persona.estadoClave || null,
    domicilioFiscal: armarDireccion(fiscal),
    impuestos: [],
    actividades: [],
    avisos: [],
    fuente: 'ARCA A13 (padrón general)'
  };
}

/** Interpreta el XML de respuesta. Exportada para testear sin conexión. */
function parsearRespuesta(servicio, statusCode, body) {
  let parsed = null;
  try { parsed = parser.parse(body); } catch (e) { /* se informa abajo */ }
  const fault = parsed && extraerFault(parsed);
  if (fault) throw new Error(`Padrón ${servicio.toUpperCase()} rechazó la consulta: ${fault}`);
  if (statusCode !== 200) throw new Error(`Padrón ${servicio.toUpperCase()} respondió HTTP ${statusCode}`);

  const bodyXml = parsed?.Envelope?.Body || {};
  const respuesta = bodyXml[`${SERVICIOS[servicio].metodo}Response`];
  const personaReturn = respuesta?.personaReturn;
  return servicio === 'a5' ? normalizarA5(personaReturn) : normalizarA13(personaReturn);
}

async function consultar(servicio, { environment, token, sign, cuitRepresentada, idPersona }) {
  const s = SERVICIOS[servicio];
  if (!s) throw new Error(`Servicio de padrón desconocido: ${servicio}`);
  const hostname = HOSTS[environment];
  if (!hostname) throw new Error(`Entorno ARCA inválido: ${environment}`);
  const envelope = armarEnvelope(servicio, { token, sign, cuitRepresentada, idPersona });
  const { statusCode, body } = await postSoap({ hostname, path: s.path, envelope, soapAction: '' });
  return parsearRespuesta(servicio, statusCode, body);
}

module.exports = { SERVICIOS, consultar, parsearRespuesta, condicionDesdeImpuestos, armarEnvelope };
