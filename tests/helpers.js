'use strict';
// Carga los módulos del navegador (src/js) dentro de node para testearlos.
const path = require('path');
globalThis.window = globalThis;
function cargarFrontend() {
  for (const f of ['taxEngine', 'csvParser', 'arcaReconciler', 'exportEngine', 'mockData']) {
    require(path.join(__dirname, '..', 'src', 'js', `${f}.js`));
  }
  return globalThis;
}
module.exports = { cargarFrontend };
