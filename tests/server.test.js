'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../server/arca/config');
const wsaa = require('../server/arca/wsaa');
const padron = require('../server/arca/padron');
const { crearServidor, resolverArchivoPublico } = require('../server');

// Pedido HTTP "crudo" (sin que nadie normalice la ruta), como haría un atacante.
function pedir(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

let server, port;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-'));

test.before(async () => {
  config.setConfigPath(path.join(tmp, 'arca-config.json')); // sin configurar al principio
  server = crearServidor();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
test.after(() => server.close());

test('sirve la app', async () => {
  const r = await pedir(port, '/');
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /<html/i);
  assert.strictEqual((await pedir(port, '/src/js/app.js')).status, 200);
  assert.strictEqual((await pedir(port, '/src/css/main.css')).status, 200);
  assert.strictEqual((await pedir(port, '/santana-logo-icon.png')).status, 200);
  assert.strictEqual((await pedir(port, '/index.html?v=2')).status, 200);
  assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
});

test('NO entrega archivos sensibles ni del servidor', async () => {
  for (const ruta of [
    '/arca-config.json', '/arca-config.example.json', '/certs/arca.key', '/server.js',
    '/server/arca/config.js', '/data/token-cache/x.json', '/package.json', '/node_modules/node-forge/package.json',
    '/src/../server.js', '/src/%2e%2e/server.js', '/src/..%2fserver.js', '/src/..%5cserver.js',
    '/../../Windows/win.ini', '/src/.env', '/%00'
  ]) {
    const r = await pedir(port, ruta);
    assert.strictEqual(r.status, 404, `${ruta} debería dar 404 y dio ${r.status}`);
  }
});

test('rechaza pedidos con otro Host (DNS rebinding)', async () => {
  const r = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/estado', headers: { Host: 'atacante.com' } }, (res) => resolve(res.statusCode));
    req.on('error', reject);
    req.end();
  });
  assert.strictEqual(r, 403);
});

test('resolverArchivoPublico solo acepta rutas permitidas', () => {
  assert.ok(resolverArchivoPublico('/src/js/app.js'));
  assert.strictEqual(resolverArchivoPublico('/src/../arca-config.json'), null);
  assert.strictEqual(resolverArchivoPublico('/certs/arca.key'), null);
});

test('API: estado sin configurar y validación de CUIT', async () => {
  const e = await pedir(port, '/api/estado');
  assert.deepStrictEqual(JSON.parse(e.body), { configurado: false });
  assert.strictEqual((await pedir(port, '/api/padron/20172543598')).status, 400);
  const sinCfg = await pedir(port, '/api/padron/20172543597');
  assert.strictEqual(sinCfg.status, 503);
  assert.strictEqual((await pedir(port, '/api/otra')).status, 404);
});

test('API: con configuración consulta A5 y si falla cae a A13', async () => {
  fs.mkdirSync(path.join(tmp, 'certs'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'certs', 'arca.crt'), 'CERT');
  fs.writeFileSync(path.join(tmp, 'certs', 'arca.key'), 'KEY');
  fs.writeFileSync(path.join(tmp, 'arca-config.json'), JSON.stringify({
    environment: 'testing', cuitEstudio: '20172543597', certPath: 'certs/arca.crt', keyPath: 'certs/arca.key'
  }));

  const origTicket = wsaa.getTicket, origConsultar = padron.consultar;
  const pedidos = [];
  wsaa.getTicket = async ({ service }) => { pedidos.push(service); return { token: 't', sign: 's' }; };
  padron.consultar = async (servicio, args) => {
    assert.strictEqual(args.cuitRepresentada, '20172543597', 'representada = CUIT del estudio');
    if (servicio === 'a5') throw new Error('Computador no autorizado a acceder al servicio');
    return { cuit: args.idPersona, razonSocial: 'EMPRESA SA', condicionIVA: 'x' };
  };
  try {
    const est = JSON.parse((await pedir(port, '/api/estado')).body);
    assert.deepStrictEqual(est, { configurado: true, environment: 'testing', cuitEstudio: '20172543597', servicios: ['a5', 'a13'] });
    assert.ok(!JSON.stringify(est).includes('KEY'), 'el estado nunca expone la clave');

    const r = await pedir(port, '/api/padron/30-50001091-2');
    assert.strictEqual(r.status, 200, r.body);
    const data = JSON.parse(r.body);
    assert.strictEqual(data.servicio, 'a13');
    assert.strictEqual(data.persona.razonSocial, 'EMPRESA SA');
    assert.deepStrictEqual(pedidos, ['ws_sr_constancia_inscripcion', 'ws_sr_padron_a13']);

    padron.consultar = async () => { throw new Error('caído'); };
    const r2 = await pedir(port, '/api/padron/30500010912');
    assert.strictEqual(r2.status, 502);
    assert.match(JSON.parse(r2.body).error, /A5: caído \| A13: caído/);
  } finally {
    wsaa.getTicket = origTicket;
    padron.consultar = origConsultar;
  }
});

test('config: errores claros', () => {
  fs.writeFileSync(path.join(tmp, 'arca-config.json'), JSON.stringify({ environment: 'prod', certPath: 'x', keyPath: 'y', cuitEstudio: '20172543597' }));
  assert.throws(() => config.loadConfig(), /"environment" debe ser/);
  fs.writeFileSync(path.join(tmp, 'arca-config.json'), JSON.stringify({ environment: 'testing', certPath: 'x', keyPath: 'y' }));
  assert.throws(() => config.loadConfig(), /Faltan campos: cuitEstudio/);
  fs.writeFileSync(path.join(tmp, 'arca-config.json'), '{ mal json');
  assert.throws(() => config.loadConfig(), /inválido/);
  // nombre viejo del campo sigue funcionando
  fs.writeFileSync(path.join(tmp, 'arca-config.json'), JSON.stringify({ environment: 'testing', cuitRepresentada: '20172543597', certPath: 'certs/arca.crt', keyPath: 'certs/arca.key' }));
  assert.strictEqual(config.loadConfig().cuitEstudio, '20172543597');
});
