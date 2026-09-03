/**
 * ArcaApi
 * Módulo único de consulta de padrón/CUIT. Expone window.ArcaApi.consultarPadron(cuit),
 * que es lo que consume app.js (barra rápida y modal de configuración).
 *
 * IMPORTANTE: esto es un MOCK. Reemplazar el cuerpo de consultarPadron() por un fetch
 * real a tu backend cuando esté disponible (ver README-ARCA-SETUP.md).
 *
 * No agregar acá ningún addEventListener sobre los botones de búsqueda de CUIT:
 * esos ya están manejados centralizadamente en app.js. Tener dos listeners sobre el
 * mismo botón (uno acá y otro en app.js) desincroniza lo que se ve en pantalla del
 * estado interno real (contribuyente.cuit) que usa el resto de la app para guardar
 * y calcular — fue exactamente el bug que causaba que "Limpiar Todo" no se sostuviera.
 */
window.ArcaApi = (function () {
  function simularPadron(cuitLimpio) {
    const prefijo = cuitLimpio.substring(0, 2);
    const cuitFormateado = `${cuitLimpio.substring(0, 2)}-${cuitLimpio.substring(2, 10)}-${cuitLimpio.substring(10)}`;

    let razonSocial = `CONTRIBUYENTE CUIT ${cuitFormateado}`;
    let condicion = 'Resp. Inscripto';
    let impuestos = ['IVA'];

    if (prefijo === '30' || prefijo === '33' || prefijo === '34') {
      razonSocial = 'LOGÍSTICA & IMPEX S.A.';
      condicion = 'Resp. Inscripto';
      impuestos = ['IVA', 'GANANCIAS'];
    } else if (cuitLimpio === '20123456789') {
      razonSocial = 'SANTANA ESTUDIO CONTABLE';
      condicion = 'Resp. Inscripto';
      impuestos = ['IVA'];
    } else {
      condicion = 'Monotributo';
      razonSocial = `CONTRIBUYENTE CUIT ${cuitFormateado}`;
      impuestos = ['MONOTRIBUTO'];
    }

    return { cuitFormateado, razonSocial, condicion, impuestos };
  }

  /**
   * @param {String} cuitBruto - con o sin guiones/espacios
   * @returns {Promise<{cuit:String, razon:String, condicion:String, impuestos:String[]}>}
   */
  function consultarPadron(cuitBruto) {
    return new Promise((resolve, reject) => {
      const cuitLimpio = String(cuitBruto || '').replace(/\D/g, '');
      if (cuitLimpio.length !== 11) {
        reject(new Error('Ingrese un CUIT válido de 11 dígitos.'));
        return;
      }

      // AQUÍ IRÍA EL FETCH REAL A TU BACKEND (Node.js) QUE SE CONECTA A ARCA:
      // fetch(`/api/arca/padron/${cuitLimpio}`).then(r => r.json()).then(data => resolve({...})).catch(reject);

      const data = simularPadron(cuitLimpio);
      resolve({
        cuit: data.cuitFormateado,
        razon: data.razonSocial,
        condicion: data.condicion,
        impuestos: data.impuestos
      });
    });
  }

  return { consultarPadron };
})();
