@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Liquidador IVA Santana.lnk')); $s.TargetPath='%~dp0iniciar.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0src\assets\santana-liquidador.ico,0'; $s.Description='Liquidador de IVA - Santana Estudio Contable'; $s.Save()"
echo Acceso directo creado en el escritorio.
timeout /t 3 >nul
