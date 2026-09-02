document.addEventListener('DOMContentLoaded', () => {
  // 1. Identificar los elementos del DOM de la barra rápida y configuración
  const btnQuickSearch = document.getElementById('btn-quick-buscar-cuit');
  const inputQuickCuit = document.getElementById('quick-cuit-input');
  
  const btnConfigSearch = document.getElementById('btn-cfg-buscar-padron');
  const inputConfigCuit = document.getElementById('cfg-cuit');

  // 2. Función principal de consulta
  async function consultarPadronARCA(cuitBruto) {
    // Limpiar el CUIT de guiones y espacios
    const cuit = cuitBruto.replace(/\D/g, '');

    if (cuit.length !== 11) {
      alert("Por favor, ingrese un CUIT válido de 11 dígitos.");
      return;
    }

    try {
      // AQUÍ IRÍA EL FETCH A TU BACKEND (Ej: Node.js) QUE SE CONECTA A AFIP
      // const response = await fetch(`/api/arca/padron/${cuit}`);
      // const data = await response.json();

      // MOCK: Simulador de respuesta de API para que la app sea funcional ahora mismo
      const data = simularLlamadaAPI(cuit);

      // 3. LA VALIDACIÓN SOLICITADA:
      // Validar que sea Responsable Inscripto o una Sociedad (Ej: Tipo Jurídica)
      const esResponsableInscripto = data.impuestos.includes('IVA');
      const esSociedad = data.tipoPersona === 'Jurídica';

      if (!esResponsableInscripto && !esSociedad) {
        // Mensaje de error si no cumple la condición
        alert("El contribuyente no está registrado en el impuesto o no es una sociedad válida para esta liquidación.");
        return; // Cortar la ejecución aquí
      }

      // 4. Actualizar la interfaz (UI) si la validación es exitosa[cite: 3]
      // Topbar
      document.getElementById('header-razon-social').innerText = data.razonSocial;
      document.getElementById('header-cuit').innerText = `CUIT: ${data.cuitFormateado} | Resp. Inscripto`;
      
      // Modal de Configuración
      document.getElementById('cfg-razon').value = data.razonSocial;
      document.getElementById('cfg-cuit').value = data.cuitFormateado;
      
      // Papeles de Trabajo
      const wpRazon = document.getElementById('wp-razon');
      const wpCuit = document.getElementById('wp-cuit');
      if (wpRazon) wpRazon.innerText = data.razonSocial;
      if (wpCuit) wpCuit.innerText = data.cuitFormateado;

      alert(`Datos de ${data.razonSocial} cargados con éxito.`);

    } catch (error) {
      console.error("Error al consultar ARCA:", error);
      alert("Hubo un error de conexión al consultar el padrón.");
    }
  }

  // 5. Asignar los eventos a los botones[cite: 3]
  if (btnQuickSearch) {
    btnQuickSearch.addEventListener('click', () => {
      consultarPadronARCA(inputQuickCuit.value);
    });
  }

  if (btnConfigSearch) {
    btnConfigSearch.addEventListener('click', () => {
      consultarPadronARCA(inputConfigCuit.value);
    });
  }
});

/**
 * Función auxiliar para simular la respuesta del padrón ARCA.
 * Puedes reemplazar esto cuando conectes tu backend Node.js.
 */
function simularLlamadaAPI(cuit) {
  const prefijo = cuit.substring(0, 2);
  const cuitFormateado = `${cuit.substring(0, 2)}-${cuit.substring(2, 10)}-${cuit.substring(10)}`;
  
  let respuesta = {
    cuitFormateado: cuitFormateado,
    razonSocial: 'CONTRIBUYENTE GENÉRICO',
    tipoPersona: 'Física',
    impuestos: []
  };

  // Lógica simulada basada en el CUIT
  if (prefijo === '30' || prefijo === '33' || prefijo === '34') {
    // Es una sociedad (Persona Jurídica)
    respuesta.tipoPersona = 'Jurídica';
    respuesta.razonSocial = 'LOGÍSTICA & IMPEX S.A.'; //[cite: 3]
    respuesta.impuestos = ['IVA', 'GANANCIAS'];
  } else if (cuit === '20123456789') {
    // Ejemplo de Persona Física que SÍ es Responsable Inscripto
    respuesta.tipoPersona = 'Física';
    respuesta.razonSocial = 'SANTANA ESTUDIO CONTABLE'; //[cite: 3]
    respuesta.impuestos = ['IVA']; 
  } else {
    // Ejemplo de Persona Física Monotributista (Fallará la validación)
    respuesta.tipoPersona = 'Física';
    respuesta.razonSocial = 'JUAN PÉREZ (MONOTRIBUTO)';
    respuesta.impuestos = ['MONOTRIBUTO'];
  }

  return respuesta;
}