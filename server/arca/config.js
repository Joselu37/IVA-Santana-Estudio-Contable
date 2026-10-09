'use strict';
/**
 * Lee arca-config.json (en la raíz del proyecto; NUNCA se sirve por web ni se
 * sube a git). Devuelve null si todavía no existe, para que la app pueda
 * funcionar en modo manual y avisar con claridad.
 *
 * Las rutas certPath/keyPath relativas se resuelven desde la carpeta del
 * proyecto, no desde donde se lanzó node (así funciona con doble clic).
 */
const fs = require('fs');
const path = require('path');
const { limpiarCuit, esCuitValido } = require('../lib/cuit');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
let CONFIG_PATH = path.join(PROJECT_ROOT, 'arca-config.json');
function setConfigPath(p) { CONFIG_PATH = p; }

const SERVICIOS_VALIDOS = ['a5', 'a13'];

function resolverRuta(p) {
  return path.isAbsolute(p) ? p : path.join(path.dirname(CONFIG_PATH), p);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`arca-config.json inválido: ${e.message}`);
  }

  // "cuitRepresentada" era el nombre viejo del campo: se acepta igual.
  const cuitEstudio = limpiarCuit(cfg.cuitEstudio || cfg.cuitRepresentada);

  const faltan = [];
  if (!cfg.environment) faltan.push('environment');
  if (!cfg.certPath) faltan.push('certPath');
  if (!cfg.keyPath) faltan.push('keyPath');
  if (!cuitEstudio) faltan.push('cuitEstudio');
  if (faltan.length) throw new Error(`arca-config.json incompleto. Faltan campos: ${faltan.join(', ')}`);

  if (!['testing', 'production'].includes(cfg.environment)) {
    throw new Error(`"environment" debe ser "testing" o "production", recibido: ${cfg.environment}`);
  }
  if (!esCuitValido(cuitEstudio)) {
    throw new Error(`"cuitEstudio" (${cuitEstudio}) no es un CUIT válido.`);
  }

  const certPath = resolverRuta(cfg.certPath);
  const keyPath = resolverRuta(cfg.keyPath);
  if (!fs.existsSync(certPath)) throw new Error(`No se encontró el certificado en certPath: ${cfg.certPath}`);
  if (!fs.existsSync(keyPath)) throw new Error(`No se encontró la clave privada en keyPath: ${cfg.keyPath}`);

  let servicios = Array.isArray(cfg.servicios) && cfg.servicios.length ? cfg.servicios : ['a5', 'a13'];
  servicios = servicios.map((s) => String(s).toLowerCase());
  const invalidos = servicios.filter((s) => !SERVICIOS_VALIDOS.includes(s));
  if (invalidos.length) {
    throw new Error(`"servicios" tiene valores no válidos: ${invalidos.join(', ')} (usar "a5" y/o "a13").`);
  }

  return {
    environment: cfg.environment,
    cuitEstudio,
    servicios,
    certPem: fs.readFileSync(certPath, 'utf8'),
    keyPem: fs.readFileSync(keyPath, 'utf8')
  };
}

/** Datos para mostrar en pantalla: nunca incluye certificado ni clave. */
function resumenPublico(config) {
  if (!config) return { configurado: false };
  return {
    configurado: true,
    environment: config.environment,
    cuitEstudio: config.cuitEstudio,
    servicios: config.servicios
  };
}

module.exports = { loadConfig, resumenPublico, setConfigPath, PROJECT_ROOT, get CONFIG_PATH() { return CONFIG_PATH; } };
