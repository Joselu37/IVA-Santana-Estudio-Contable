'use strict';
/**
 * Utilidades de CUIT/CUIL compartidas (servidor y tests).
 * Reutilizable en cualquier herramienta del estudio.
 */

const MULTIPLICADORES = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

function limpiarCuit(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '');
}

/**
 * Valida un CUIT/CUIL con el dígito verificador estándar (módulo 11).
 * Si el cálculo da 10 el número es inválido: ARCA en esos casos asigna
 * prefijo 23/33, y con ese prefijo el mismo cálculo ya da el dígito correcto.
 */
function esCuitValido(valor) {
  const cuit = limpiarCuit(valor);
  if (!/^\d{11}$/.test(cuit)) return false;
  const digitos = cuit.split('').map(Number);
  const suma = MULTIPLICADORES.reduce((acc, m, i) => acc + m * digitos[i], 0);
  let verificador = 11 - (suma % 11);
  if (verificador === 11) verificador = 0;
  if (verificador === 10) return false;
  return verificador === digitos[10];
}

function formatearCuit(valor) {
  const c = limpiarCuit(valor);
  return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c;
}

module.exports = { limpiarCuit, esCuitValido, formatearCuit };
