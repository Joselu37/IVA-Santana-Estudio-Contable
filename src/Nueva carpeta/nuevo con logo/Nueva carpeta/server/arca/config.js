'use strict';
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'arca-config.json');

/**
 * Lee arca-config.json (fuera de src/, NO debe subirse a git — contiene rutas a
 * certificados privados). Devuelve null si todavía no fue configurado, para que
 * el endpoint pueda avisar de forma clara en vez de explotar.
 *
 * Soporta el caso "estudio contable con varios clientes": el certificado es uno
 * solo (el del estudio), pero cada cliente lo autoriza como apoderado para el
 * servicio ws_sr_padron_a13 desde su propia Clave Fiscal. Por eso acá NO fijamos
 * un único cuitRepresentada: la lista "clientesAutorizados" es solo para
 * validar contra errores de tipeo antes de llamar a ARCA (evita gastar una
 * consulta con un CUIT que sabemos que no está autorizado).
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`arca-config.json inválido: ${e.message}`);
  }

  const required = ['environment', 'certPath', 'keyPath'];
  const missing = required.filter((k) => !cfg[k]);
  if (missing.length) {
    throw new Error(`arca-config.json incompleto. Faltan campos: ${missing.join(', ')}`);
  }
  if (!['testing', 'production'].includes(cfg.environment)) {
    throw new Error(`"environment" debe ser "testing" o "production", recibido: ${cfg.environment}`);
  }
  if (!fs.existsSync(cfg.certPath)) {
    throw new Error(`No se encontró el certificado en certPath: ${cfg.certPath}`);
  }
  if (!fs.existsSync(cfg.keyPath)) {
    throw new Error(`No se encontró la clave privada en keyPath: ${cfg.keyPath}`);
  }

  const clientesAutorizados = Array.isArray(cfg.clientesAutorizados)
    ? cfg.clientesAutorizados.map((c) => ({
        cuit: String(c.cuit).replace(/[^0-9]/g, ''),
        nombre: c.nombre || ''
      }))
    : [];

  return {
    environment: cfg.environment,
    // CUIT propio del estudio/contribuyente único, usado como default cuando no
    // se especifica a nombre de qué cliente se consulta (caso de un solo CUIT).
    cuitEstudio: cfg.cuitEstudio ? String(cfg.cuitEstudio).replace(/[^0-9]/g, '') : null,
    clientesAutorizados,
    certPem: fs.readFileSync(cfg.certPath, 'utf8'),
    keyPem: fs.readFileSync(cfg.keyPath, 'utf8')
  };
}

/**
 * Resuelve a nombre de qué CUIT hay que hacer la consulta (cuitRepresentada).
 * Prioridad: 1) el que venga explícito en el request, 2) el CUIT propio del
 * estudio como fallback si no hay lista de clientes cargada todavía.
 */
function resolveCuitRepresentada(config, cuitRepresentadaSolicitado) {
  if (cuitRepresentadaSolicitado) {
    const limpio = String(cuitRepresentadaSolicitado).replace(/[^0-9]/g, '');
    if (config.clientesAutorizados.length &&
        !config.clientesAutorizados.some((c) => c.cuit === limpio) &&
        limpio !== config.cuitEstudio) {
      const nombres = config.clientesAutorizados.map((c) => `${c.cuit}${c.nombre ? ' (' + c.nombre + ')' : ''}`).join(', ');
      throw new Error(
        `El CUIT ${limpio} no figura en clientesAutorizados de arca-config.json. ` +
        `Clientes conocidos: ${nombres || '(ninguno cargado)'}. ` +
        `Si el cliente ya te autorizó como apoderado en ARCA, agregalo a arca-config.json.`
      );
    }
    return limpio;
  }
  if (config.cuitEstudio) return config.cuitEstudio;
  throw new Error(
    'No se indicó a nombre de qué CUIT consultar (cuitRepresentada) y no hay "cuitEstudio" configurado como default.'
  );
}

module.exports = { loadConfig, resolveCuitRepresentada, CONFIG_PATH };
