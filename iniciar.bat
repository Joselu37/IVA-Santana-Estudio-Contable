@echo off
chcp 65001 >nul
title Liquidador de IVA - Santana Estudio Contable
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js en esta PC.
  echo Instalalo desde https://nodejs.org ^(version LTS^) y volve a abrir este archivo.
  pause
  exit /b 1
)

set FALTAN=0
if not exist "node_modules\node-forge" set FALTAN=1
if not exist "node_modules\fast-xml-parser" set FALTAN=1
if "%FALTAN%"=="1" (
  echo Instalando dependencias por unica vez...
  call npm install --omit=dev
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias. Revisa la conexion a internet.
    pause
    exit /b 1
  )
)

start "" /min cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:3000/"
node server.js
pause
