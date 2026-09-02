const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadConfig, resolveCuitRepresentada } = require('./server/arca/config');
const wsaa = require('./server/arca/wsaa');
const padron = require('./server/arca/padron');

const PORT = 3000;
const PUBLIC_DIR = __dirname;

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

// --- Validación de CUIT (11 dígitos + dígito verificador estándar AFIP/ARCA) ---
function isValidCuit(cuit) {
  if (!/^\d{11}$/.test(cuit)) return false;
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const digits = cuit.split('').map(Number);
  const sum = mult.reduce((acc, m, i) => acc + m * digits[i], 0);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) check = 9; // regla especial usada por ARCA
  return check === digits[10];
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function handlePadronRequest(req, res, cuitParam, representadaParam) {
  const cuit = String(cuitParam || '').replace(/[^0-9]/g, '');

  if (!isValidCuit(cuit)) {
    return sendJson(res, 400, { error: 'CUIT inválido. Debe tener 11 dígitos y dígito verificador correcto.' });
  }

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    return sendJson(res, 500, { error: `Configuración ARCA inválida: ${e.message}` });
  }

  if (!config) {
    return sendJson(res, 503, {
      error: 'ARCA todavía no está configurado en este servidor.',
      detalle: 'Copiá arca-config.example.json a arca-config.json, completá tus datos y colocá el certificado/clave. Ver README-ARCA-SETUP.md.'
    });
  }

  let cuitRepresentada;
  try {
    // Si no viene ?representada=, se asume que se consulta al propio CUIT
    // (representada = idPersona), útil cuando el estudio es dueño único del CUIT.
    cuitRepresentada = require('./server/arca/config').resolveCuitRepresentada(config, representadaParam || cuit);
  } catch (e) {
    return sendJson(res, 403, { error: e.message });
  }

  try {
    const { token, sign } = await wsaa.getTicket({
      service: 'ws_sr_padron_a13',
      environment: config.environment,
      certPem: config.certPem,
      keyPem: config.keyPem
    });

    const persona = await padron.getPersona({
      environment: config.environment,
      token,
      sign,
      cuitRepresentada,
      idPersona: cuit
    });

    return sendJson(res, 200, { ok: true, environment: config.environment, cuitRepresentada, persona });
  } catch (e) {
    return sendJson(res, 502, { error: `No se pudo consultar ARCA: ${e.message}` });
  }
}

function serveStatic(req, res) {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const padronMatch = url.pathname.match(/^\/api\/padron\/([0-9-]+)$/);
  if (padronMatch) {
    return handlePadronRequest(req, res, padronMatch[1], url.searchParams.get('representada'));
  }

  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
