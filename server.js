'use strict';
/**
 * Servidor local del Liquidador de IVA — Santana Estudio Contable.
 *
 *  - Solo atiende en esta PC (127.0.0.1): nadie de la red del estudio puede entrar.
 *  - Solo entrega los archivos de la app (index.html, logo y carpeta src/).
 *    Nunca entrega arca-config.json, certs/, data/ ni el código del servidor.
 *  - API:
 *      GET /api/estado         → si ARCA está configurado (sin datos sensibles)
 *      GET /api/padron/:cuit   → consulta el padrón de ARCA (A5 y/o A13)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadConfig, resumenPublico } = require('./server/arca/config');
const wsaa = require('./server/arca/wsaa');
const padron = require('./server/arca/padron');
const { limpiarCuit, esCuitValido } = require('./server/lib/cuit');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = __dirname;

// Lo único que se puede pedir por web.
const ARCHIVOS_PUBLICOS = new Set(['/index.html', '/santana-logo-icon.png']);
const CARPETAS_PUBLICAS = ['/src/'];

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

const HEADERS_SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...HEADERS_SEGURIDAD,
    'Content-Type': 'application/json; charset=UTF-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { ...HEADERS_SEGURIDAD, 'Content-Type': 'text/plain; charset=UTF-8' });
  res.end(text);
}

/** Devuelve la ruta en disco si el pedido es un archivo público; si no, null. */
function resolverArchivoPublico(pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (e) {
    return null;
  }
  if (rel === '/') rel = '/index.html';
  if (rel.includes('\0') || rel.includes('\\')) return null;

  // Normalizamos y rechazamos cualquier intento de salir de la carpeta ("..").
  const normalizado = path.posix.normalize(rel);
  if (normalizado !== rel || normalizado.split('/').some((seg) => seg === '..' || seg.startsWith('.'))) return null;

  const permitido = ARCHIVOS_PUBLICOS.has(normalizado) || CARPETAS_PUBLICAS.some((c) => normalizado.startsWith(c));
  if (!permitido) return null;

  const abs = path.join(PUBLIC_DIR, normalizado);
  if (!abs.startsWith(PUBLIC_DIR + path.sep)) return null;
  return abs;
}

function serveStatic(req, res, pathname) {
  const filePath = resolverArchivoPublico(pathname);
  if (!filePath) return sendText(res, 404, 'No encontrado');

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return sendText(res, 404, 'No encontrado');
      return sendText(res, 500, 'Error del servidor');
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { ...HEADERS_SEGURIDAD, 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' };
    // Evita que el navegador use versiones viejas de la app después de una actualización.
    if (['.html', '.js', '.css'].includes(ext)) headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}

function leerConfigSegura() {
  try {
    return { config: loadConfig(), error: null };
  } catch (e) {
    return { config: null, error: e.message };
  }
}

async function handleEstado(req, res) {
  const { config, error } = leerConfigSegura();
  if (error) return sendJson(res, 200, { configurado: false, error });
  return sendJson(res, 200, resumenPublico(config));
}

async function handlePadron(req, res, cuitParam) {
  const cuit = limpiarCuit(cuitParam);
  if (!esCuitValido(cuit)) {
    return sendJson(res, 400, { error: 'CUIT inválido. Debe tener 11 dígitos y el dígito verificador correcto.' });
  }

  const { config, error } = leerConfigSegura();
  if (error) return sendJson(res, 500, { error: `Configuración ARCA inválida: ${error}` });
  if (!config) {
    return sendJson(res, 503, {
      error: 'ARCA todavía no está configurado en esta PC.',
      detalle: 'Copiá arca-config.example.json como arca-config.json, completalo y poné el certificado en la carpeta certs. Ver README-ARCA-SETUP.md.'
    });
  }

  const errores = [];
  for (const servicio of config.servicios) {
    try {
      const { token, sign } = await wsaa.getTicket({
        service: padron.SERVICIOS[servicio].wsaaService,
        environment: config.environment,
        certPem: config.certPem,
        keyPem: config.keyPem
      });
      const persona = await padron.consultar(servicio, {
        environment: config.environment,
        token,
        sign,
        cuitRepresentada: config.cuitEstudio,
        idPersona: cuit
      });
      return sendJson(res, 200, { ok: true, environment: config.environment, servicio, persona });
    } catch (e) {
      errores.push(`${servicio.toUpperCase()}: ${e.message}`);
    }
  }
  return sendJson(res, 502, { error: `No se pudo consultar ARCA. ${errores.join(' | ')}` });
}

// Solo se aceptan pedidos dirigidos a esta PC. Evita que una página web
// maliciosa use el certificado del estudio mediante "DNS rebinding".
function hostPermitido(hostHeader) {
  const host = String(hostHeader || '').toLowerCase().replace(/:\d+$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function crearServidor() {
  return http.createServer((req, res) => {
    if (!hostPermitido(req.headers.host)) return sendText(res, 403, 'Acceso no permitido');
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (e) {
      return sendText(res, 400, 'Pedido inválido');
    }

    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido' });
      if (url.pathname === '/api/estado') return handleEstado(req, res);
      const m = url.pathname.match(/^\/api\/padron\/([0-9-]{11,13})$/);
      if (m) return handlePadron(req, res, m[1]);
      return sendJson(res, 404, { error: 'Ruta de API inexistente' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Método no permitido');
    return serveStatic(req, res, url.pathname);
  });
}

if (require.main === module) {
  const server = crearServidor();
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\nEl puerto ${PORT} ya está en uso: probablemente el liquidador ya está abierto.`);
      console.error(`Abrí http://localhost:${PORT} en el navegador, o cerrá la otra ventana y volvé a iniciar.\n`);
    } else {
      console.error('No se pudo iniciar el servidor:', e.message);
    }
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    const { config, error } = leerConfigSegura();
    console.log(`\nLiquidador de IVA funcionando en http://localhost:${PORT}/`);
    if (error) console.log(`ARCA: configuración con error → ${error}`);
    else if (!config) console.log('ARCA: sin configurar (la búsqueda de CUIT funciona en modo manual).');
    else console.log(`ARCA: configurado (${config.environment}, CUIT ${config.cuitEstudio}, servicios ${config.servicios.join('+')}).`);
    console.log('Para cerrar el liquidador, cerrá esta ventana.\n');
  });
}

module.exports = { crearServidor, resolverArchivoPublico };
