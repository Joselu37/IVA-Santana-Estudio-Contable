# Conexión con ARCA (ex-AFIP) — Consulta de Padrón por CUIT

Esta integración agrega un endpoint `GET /api/padron/:cuit` a `server.js` que consulta
el **Padrón A13** de ARCA (`ws_sr_padron_a13`) y devuelve razón social, condición frente
al IVA, domicilio fiscal y actividades del contribuyente. Los botones **"Buscar CUIT en
ARCA"** y **"Consultar ARCA"** del `index.html` ya están conectados a este endpoint
(`src/js/arcaApi.js`).

**Importante sobre alcance:** el padrón te dice *quién es* el contribuyente y su
condición de IVA (Resp. Inscripto / Monotributo / Exento). Con eso el liquidador puede
categorizar correctamente cada comprobante (por ejemplo, para no computar crédito fiscal
de una factura a un monotributista). Pero **no reemplaza la carga de comprobantes**: los
montos de débito/crédito fiscal siguen saliendo de las facturas que cargues o importes.

## Por qué no funciona "out of the box"

El padrón **no es una API pública**: para consultarlo necesitás autenticarte con un
certificado digital X.509 propio, emitido por ARCA, y asociado a tu CUIT. Esto no se
puede llamar desde el navegador (requiere firmar criptográficamente con tu clave
privada), por eso vive en el backend (`server.js` → `server/arca/`).

## Paso 1 — Generar el certificado (ambiente de testing/homologación)

Para probar sin arriesgar tu certificado de producción:

1. Entrá a ARCA con tu Clave Fiscal (nivel de seguridad 3 o superior) y buscá el
   servicio **"WSASS - Autoservicio de Acceso a APIs de Homologación"**.
2. Generá un par de claves y un CSR (podés hacerlo con OpenSSL):
   ```bash
   openssl genrsa -out certs/arca.key 2048
   openssl req -new -key certs/arca.key -subj "/CN=liquidador-iva/O=TuEmpresa/C=AR" -out certs/arca.csr
   ```
3. Subí el `arca.csr` en WSASS. ARCA te devuelve el certificado firmado (`.crt`).
4. Dentro de WSASS mismo, asociá el certificado al servicio **`ws_sr_padron_a13`**.

## Paso 2 — Certificado de producción

Cuando quieras usar datos reales (no de prueba):

1. Ingresá a **"Administrador de Certificados Digitales"** en el portal de ARCA con tu
   Clave Fiscal, y generá el certificado de producción con el mismo CSR (o uno nuevo).
2. Andá a **"Administrador de Relaciones de Clave Fiscal"** y asociá ese certificado
   al servicio **Padrón (ws_sr_padron_a13)** para tu CUIT.

## Paso 3 — Configurar el liquidador

1. Copiá tu `arca.crt` y `arca.key` a la carpeta `certs/` del proyecto (creala si no
   existe).
2. Copiá `arca-config.example.json` como `arca-config.json` y completá:
   ```json
   {
     "environment": "testing",
     "cuitRepresentada": "TU_CUIT_SIN_GUIONES",
     "certPath": "./certs/arca.crt",
     "keyPath": "./certs/arca.key"
   }
   ```
   - `environment`: `"testing"` mientras uses el certificado de homologación,
     `"production"` cuando pases al certificado real.
   - `cuitRepresentada`: el CUIT dueño del certificado (normalmente el de tu estudio o
     el del contribuyente que estás liquidando).
3. **Nunca subas `arca-config.json` ni `certs/` a un repositorio git.** Agregalos a
   `.gitignore`:
   ```
   arca-config.json
   certs/
   server/arca/.token-cache/
   ```

## Paso 4 — Instalar dependencias y correr

```bash
npm install node-forge fast-xml-parser
node server.js
```

Abrí `http://localhost:3000`, escribí un CUIT válido en el buscador rápido del header y
tocá **"Buscar CUIT en ARCA"**. Si todo está bien configurado, la razón social y
condición de IVA se completan automáticamente.

## Estudio contable con varios clientes (multi-CUIT)

Si liquidás IVA para varios contribuyentes, cada uno tiene que autorizarte como
apoderado del servicio de Padrón **desde su propia Clave Fiscal**:
"Administrador de Relaciones de Clave Fiscal" → "Nueva Relación" → servicio
`ws_sr_padron_a13` → autorizar tu CUIT.

En `arca-config.json` completá:
- `cuitEstudio`: tu propio CUIT (dueño del certificado).
- `clientesAutorizados`: lista de CUITs que ya te autorizaron, con nombre para
  identificarlos fácil. Es solo una validación preventiva (evita gastar una
  consulta contra ARCA con un CUIT mal tipeado o que todavía no te autorizó);
  si un cliente nuevo te autoriza, agregalo a esta lista.

El liquidador manda automáticamente `?representada=<cuit_del_cliente_activo>`
al backend cuando consultás el padrón desde la app — no hace falta que edites
nada a mano por cada cliente, solo cambiá de contribuyente activo en el selector
del header.

## Flujo de trabajo del liquidador (una vez configurado ARCA)

1. **Cargar/crear el contribuyente**: buscá su CUIT en ARCA (autocompleta razón
   social y condición de IVA) o cargalo manualmente en "Ajustar Período / Saldos".
2. **Cargar comprobantes**: por CSV/TXT (botón "Importar"), pegando texto, o
   fila por fila con "Nuevo Comprobante". Para compras/importaciones marcá si
   están "vinculadas a exportación" (Art. 43) cuando corresponda.
3. **Conciliar** (opcional): importá el archivo oficial de "Mis Comprobantes"
   de ARCA marcándolo como fuente "ARCA" para cruzarlo contra tus libros.
4. **Simular** ajustes de prorrateo/inclusión de importaciones si hace falta.
5. **Papeles de trabajo**: pestaña 4, exportable a CSV o para imprimir/PDF.
6. **Exportar para ARCA**: TXT tipo LID y resumen para el F.2002 (pestaña 5) —
   revisar contra el instructivo vigente antes de importar a ARCA, ver nota
   dentro del código de `exportEngine.js`.

Los datos se guardan en el navegador (localStorage) por CUIT. Usá "Descargar
Backup (.json)" seguido para tener una copia en tu PC — sirve tanto como
respaldo como para pasar datos a otra computadora con "Restaurar Backup".

## Errores comunes

- **"ARCA todavía no está configurado en este servidor"** → falta `arca-config.json`.
- **"No se encontró el certificado en certPath"** → revisá la ruta en el JSON.
- **"WSAA rechazó la solicitud"** → el certificado no tiene asociado el servicio
  `ws_sr_padron_a13`, o estás usando un certificado de testing contra `production` (o
  viceversa).
- **"CUIT no encontrado en el padrón"** → en el ambiente de testing, ARCA solo reconoce
  un conjunto acotado de CUITs de prueba (los que provee el propio portal de
  homologación), no cualquier CUIT real.

## Notas técnicas

- El token de WSAA es válido 12hs; se cachea en `server/arca/.token-cache/` para no
  pedir uno nuevo en cada consulta (ARCA bloquea pedidos repetidos antes de que expire
  el anterior).
- La firma del TRA se hace con `node-forge` (CMS/PKCS#7), sin depender de tener OpenSSL
  instalado en el sistema — útil en Windows.
