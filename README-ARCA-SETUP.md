# Liquidador de IVA — Santana Estudio Contable

## Cómo abrirlo

Hacé doble clic en **`iniciar.bat`**. La primera vez instala lo necesario (necesita
internet y [Node.js LTS](https://nodejs.org)). Se abre el navegador en
`http://localhost:3000`. Para cerrarlo, cerrá la ventana negra.

> Si abrís `index.html` directamente con doble clic, la app funciona igual pero
> sin conexión a ARCA (la búsqueda de CUIT pasa a modo manual).

La app funciona **sin configurar ARCA**: importás comprobantes, liquidás y exportás.
ARCA solo hace falta para que la búsqueda de CUIT complete sola la razón social,
la condición frente al IVA y el domicilio.

## Seguridad

- El servidor solo atiende **en esta PC** (127.0.0.1). Nadie de la red del estudio
  puede entrar.
- Solo entrega los archivos de la app (`index.html`, `src/`). Nunca entrega
  `arca-config.json`, la carpeta `certs/` ni `data/`.
- No compartas ni subas a internet `arca-config.json`, `certs/` ni `data/`
  (ya están en `.gitignore`).

## Conectar con ARCA (padrón)

### 1. Certificado

Generá la clave y el pedido de certificado (CSR). Con OpenSSL:

```bash
openssl genrsa -out certs/arca.key 2048
openssl req -new -key certs/arca.key -subj "/C=AR/O=Santana Estudio Contable/CN=liquidador-iva/serialNumber=CUIT 20XXXXXXXXX" -out certs/arca.csr
```

- **Homologación (pruebas):** servicio *WSASS – Autoservicio de Acceso a APIs de
  Homologación*. Subís el CSR, te da el `.crt`.
- **Producción:** *Administración de Certificados Digitales* con tu Clave Fiscal.
  Guardá el `.crt` como `certs/arca.crt`.

### 2. Autorizar los servicios del padrón

En WSASS (homologación) o en *Administrador de Relaciones de Clave Fiscal*
(producción), asociá el certificado a:

- **`ws_sr_constancia_inscripcion`** (padrón A5): trae la **condición de IVA**
  (inscripto / monotributo / exento). Es el recomendado.
- **`ws_sr_padron_a13`** (padrón A13): datos generales, sin impuestos. Queda como respaldo.

Con tu propio certificado podés consultar el padrón de **cualquier CUIT**; no hace
falta que cada cliente te autorice para esto. (Para *emitir* facturas a nombre de
un cliente, en cambio, sí se necesita la delegación del cliente.)

### 3. Configurar

Copiá `arca-config.example.json` como **`arca-config.json`** y completá:

```json
{
  "environment": "testing",
  "cuitEstudio": "TU_CUIT_SIN_GUIONES",
  "certPath": "certs/arca.crt",
  "keyPath": "certs/arca.key",
  "servicios": ["a5", "a13"]
}
```

- `environment`: `"testing"` con certificado de homologación, `"production"` con el real.
- `cuitEstudio`: tu CUIT (dueño del certificado).
- `servicios`: los padrones que tengas habilitados, en orden de preferencia.
  Si el A5 falla, la app prueba con el A13.

Reiniciá con `iniciar.bat`. Debajo del buscador de CUIT tiene que decir
**🟢 Conectado a ARCA**.

## Cómo se usa

1. **Contribuyente:** buscá el CUIT arriba (ARCA o manual). Cada CUIT guarda sus
   propios comprobantes y saldos del período anterior.
2. **Comprobantes:** importá *Mis Comprobantes* (Emitidos / Recibidos), despachos,
   o las plantillas. La **plantilla maestra** trae una columna `TipoOperacion`
   (venta / compra / exportacion / importacion) para mezclar todo en un archivo.
3. **Retenciones y percepciones de IVA:** con el botón de *Mis Retenciones*.
   Se cargan como pagos a cuenta, no como compras. La columna "Otros Tributos"
   de Mis Comprobantes **no** se toma, porque mezcla IIBB e impuestos internos.
4. **Conciliar, simular, papeles de trabajo** (pestañas 2 a 4).
5. **Libro IVA Digital** (pestaña 5): baja los archivos de importación de ARCA:
   - Ventas: `VENTAS_CBTE` + `VENTAS_ALICUOTAS`
   - Compras: `COMPRAS_CBTE` + `COMPRAS_ALICUOTAS` (+ `IMPORTACIONES` si hay despachos)

   Los montos van en pesos. El crédito fiscal computable se informa igual al IVA
   de cada comprobante (sin prorrateo); si aplicás prorrateo, ajustalo en el
   Libro IVA Digital. **Antes de presentar, revisá la importación en ARCA.**

Los datos quedan guardados en este navegador, en esta PC. Si borrás los datos de
navegación, se pierden: conservá siempre los archivos originales que importaste.

## Para desarrollar

```bash
npm test        # 47 pruebas automáticas (motor de IVA, importación, Libro IVA Digital, servidor, ARCA)
npm start       # igual que iniciar.bat
```

Módulos reutilizables para otras herramientas:

| Archivo | Para qué sirve |
|---|---|
| `server/arca/wsaa.js` | Autenticación con ARCA para **cualquier** web service (wsfe, padrones…) |
| `server/arca/soap.js` | Envío de pedidos a ARCA con límite de tiempo |
| `server/arca/config.js` | Lectura segura del certificado y la configuración |
| `server/lib/cuit.js` | Validar y formatear CUIT |
| `src/js/taxEngine.js` | Motor de liquidación de IVA (función pura, testeada) |
| `src/js/exportEngine.js` | Archivos del Libro IVA Digital |

## Errores comunes

- **"ARCA sin configurar"** → falta `arca-config.json` (la app sigue en modo manual).
- **"No se encontró el certificado"** → revisá `certPath`/`keyPath`. Son relativos a la carpeta del proyecto.
- **"WSAA rechazó la solicitud"** → el certificado no tiene asociado el servicio,
  o estás usando un certificado de testing contra producción (o al revés).
- **"Ya existe un ticket vigente"** → se pidió un acceso desde otro programa o se
  borró `data/token-cache`. Esperá a que venza (como máximo 12 h).
- **"El puerto 3000 ya está en uso"** → el liquidador ya está abierto en otra ventana.
- En **homologación**, ARCA solo reconoce algunos CUIT de prueba.
