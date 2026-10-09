# Este archivo se mantiene por compatibilidad: ahora el liquidador se inicia
# con node (server.js), que es el que tiene la conexión con ARCA.
# Lo más simple es hacer doble clic en "iniciar.bat".
Set-Location -Path $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "No se encontró Node.js. Instalalo desde https://nodejs.org (versión LTS)."
    exit 1
}
if (-not (Test-Path "node_modules/node-forge") -or -not (Test-Path "node_modules/fast-xml-parser")) { npm install --omit=dev }
Start-Process "http://localhost:3000/"
node server.js
