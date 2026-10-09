'use strict';
const test = require('node:test');
const assert = require('node:assert');
const padron = require('../server/arca/padron');

const env = (inner) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`;

test('A5: responsable inscripto con actividades y domicilio', () => {
  const xml = env(`<ns2:getPersona_v2Response xmlns:ns2="http://a5.soap.ws.server.puc.sr/"><personaReturn>
    <datosGenerales><apellido>PEREZ</apellido><nombre>JUAN</nombre><estadoClave>ACTIVO</estadoClave><idPersona>20172543597</idPersona><tipoPersona>FISICA</tipoPersona>
      <domicilioFiscal><codPostal>3470</codPostal><descripcionProvincia>CORRIENTES</descripcionProvincia><direccion>SAN MARTIN 123</direccion><localidad>MERCEDES</localidad></domicilioFiscal></datosGenerales>
    <datosRegimenGeneral>
      <actividad><descripcionActividad>SERVICIOS DE CONTABILIDAD</descripcionActividad><idActividad>692000</idActividad><orden>1</orden></actividad>
      <impuesto><descripcionImpuesto>GANANCIAS PERSONAS FISICAS</descripcionImpuesto><idImpuesto>11</idImpuesto></impuesto>
      <impuesto><descripcionImpuesto>IVA</descripcionImpuesto><idImpuesto>30</idImpuesto></impuesto>
    </datosRegimenGeneral></personaReturn></ns2:getPersona_v2Response>`);
  const p = padron.parsearRespuesta('a5', 200, xml);
  assert.strictEqual(p.razonSocial, 'PEREZ JUAN');
  assert.strictEqual(p.condicionIVA, 'IVA Responsable Inscripto');
  assert.strictEqual(p.domicilioFiscal.direccion, 'SAN MARTIN 123, MERCEDES, CORRIENTES');
  assert.strictEqual(p.domicilioFiscal.codigoPostal, '3470');
  assert.strictEqual(p.actividades[0].codigo, '692000');
  assert.ok(p.actividades[0].principal);
  assert.strictEqual(p.cuit, '20172543597');
});

test('A5: monotributista', () => {
  const xml = env(`<getPersona_v2Response><personaReturn>
    <datosGenerales><razonSocial>KIOSCO SA</razonSocial><idPersona>30500010912</idPersona></datosGenerales>
    <datosMonotributo><categoriaMonotributo><descripcionCategoria>D LOCACIONES DE SERVICIO</descripcionCategoria></categoriaMonotributo>
      <impuesto><descripcionImpuesto>MONOTRIBUTO</descripcionImpuesto><idImpuesto>20</idImpuesto></impuesto></datosMonotributo>
    </personaReturn></getPersona_v2Response>`);
  const p = padron.parsearRespuesta('a5', 200, xml);
  assert.strictEqual(p.condicionIVA, 'Responsable Monotributo');
  assert.strictEqual(p.categoriaMonotributo, 'D LOCACIONES DE SERVICIO');
});

test('A5: errorConstancia sin datos se informa', () => {
  const xml = env(`<getPersona_v2Response><personaReturn><errorConstancia><error>No existe persona con ese Id</error></errorConstancia></personaReturn></getPersona_v2Response>`);
  assert.throws(() => padron.parsearRespuesta('a5', 200, xml), /No existe persona/);
});

test('A13: datos generales sin condición de IVA', () => {
  const xml = env(`<getPersonaResponse><personaReturn><persona><idPersona>30500010912</idPersona><razonSocial>EMPRESA SA</razonSocial>
    <domicilio><tipoDomicilio>FISCAL</tipoDomicilio><direccion>MITRE 1</direccion><localidad>CORRIENTES</localidad></domicilio></persona></personaReturn></getPersonaResponse>`);
  const p = padron.parsearRespuesta('a13', 200, xml);
  assert.strictEqual(p.razonSocial, 'EMPRESA SA');
  assert.match(p.condicionIVA, /no informa IVA/);
  assert.strictEqual(p.domicilioFiscal.direccion, 'MITRE 1, CORRIENTES');
});

test('SOAP Fault se transforma en error legible', () => {
  const xml = env(`<soap:Fault><faultcode>soap:Server</faultcode><faultstring>No se encuentra autorizado a utilizar el servicio</faultstring></soap:Fault>`);
  assert.throws(() => padron.parsearRespuesta('a5', 500, xml), /No se encuentra autorizado/);
});

test('el envelope escapa caracteres especiales del token', () => {
  const xml = padron.armarEnvelope('a5', { token: 'a<b&c', sign: 's', cuitRepresentada: '1', idPersona: '2' });
  assert.match(xml, /<token>a&lt;b&amp;c<\/token>/);
  assert.match(xml, /<ns:getPersona_v2>/);
});
