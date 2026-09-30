@echo off
setlocal enabledelayedexpansion
title Transport Tycoon - Launcher

if "%~1"=="" (
  echo.
  echo   Glissez-deposez le DOSSIER du jeu ^(celui qui contient index.html^)
  echo   directement sur ce fichier .bat pour le lancer.
  echo.
  pause
  exit /b 1
)

set "GAMEDIR=%~1"

if not exist "%GAMEDIR%\index.html" (
  echo.
  echo   index.html introuvable dans : %GAMEDIR%
  echo   Verifiez que vous avez bien glisse le dossier du jeu ^(pas un fichier^).
  echo.
  pause
  exit /b 1
)

set PORT=8791

where python >nul 2>nul
if %errorlevel%==0 (
  set "PYCMD=python"
) else (
  where python3 >nul 2>nul
  if %errorlevel%==0 (
    set "PYCMD=python3"
  ) else (
    echo.
    echo   Python est introuvable sur ce PC.
    echo   Installez-le depuis https://python.org ^(cocher "Add to PATH"^)
    echo   puis relancez ce launcher.
    echo.
    pause
    exit /b 1
  )
)

set "LANIP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /R /C:"IPv4"') do (
  if not defined LANIP set "LANIP=%%a"
)
set "LANIP=%LANIP: =%"

echo.
echo   Dossier servi : %GAMEDIR%
echo   Demarrage du serveur local sur le port %PORT% ...
echo.
echo   Sur ce PC (Chrome)              : http://localhost:%PORT%
if defined LANIP echo   Sur Android (Chrome, meme Wi-Fi) : http://%LANIP%:%PORT%
echo.
echo   Laissez cette fenetre ouverte pendant que vous jouez.
echo   Fermez-la ^(ou Ctrl+C^) pour arreter le serveur.
echo.

start "" "http://localhost:%PORT%"

pushd "%GAMEDIR%"
%PYCMD% -m http.server %PORT%
popd

pause
