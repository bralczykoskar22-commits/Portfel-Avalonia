@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Brak Node.js. Zainstaluj Node.js 20 lub nowszy.
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo Brak Rust. Zainstaluj Rust stable przez rustup.
  pause
  exit /b 1
)

echo [1/3] Instalowanie zależności...
call npm ci
if errorlevel 1 goto :failure

echo [2/3] Testowanie interfejsu...
call npm test
if errorlevel 1 goto :failure

echo [3/3] Budowanie programu i instalatora...
call npm run build
if errorlevel 1 goto :failure

echo.
echo Gotowe.
echo Program: src-tauri\target\release\Portfel.exe
echo Instalator: src-tauri\target\release\bundle\nsis\
pause
exit /b 0

:failure
echo.
echo Kompilacja nie powiodła się. Przeczytaj komunikat powyżej.
pause
exit /b 1

