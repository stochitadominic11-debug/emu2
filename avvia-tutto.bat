@echo off
title RemotePlay Launcher
setlocal

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

if not exist "%PROJECT_DIR%\server.js" (
    echo ERRORE: non trovo "%PROJECT_DIR%\server.js"
    echo Questo file .bat deve stare nella cartella principale del progetto
    echo ^(quella che contiene anche server.js^).
    pause
    exit /b 1
)

:: ---------- prima volta: crea .env e config.json da solo ----------
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%\setup-helper.ps1" -ProjectDir "%PROJECT_DIR%"
if errorlevel 1 (
    pause
    exit /b 1
)

:: ---------- installa le dipendenze se manca node_modules ----------
if not exist "%PROJECT_DIR%\node_modules" (
    echo Installo le dipendenze del sito, un attimo...
    pushd "%PROJECT_DIR%"
    call npm install
    popd
)

if not exist "%PROJECT_DIR%\agent-win\node_modules" (
    echo Installo le dipendenze dell'agent, un attimo...
    pushd "%PROJECT_DIR%\agent-win"
    call npm install
    popd
)

:: ---------- avvio vero e proprio ----------
echo Avvio il server ^(sito + libreria^)...
start "RemotePlay - Server" cmd /k "cd /d "%PROJECT_DIR%" && node server.js"

echo Aspetto che il server sia pronto...
timeout /t 3 /nobreak >nul

echo Avvio l'agent ^(lancio giochi + joystick^)...
start "RemotePlay - Agent" cmd /k "cd /d "%PROJECT_DIR%\agent-win" && node agent.js config.json"

echo.
echo Fatto. Si sono aperte due finestre: Server e Agent.
echo Lasciale aperte mentre giocate.
echo Per fermare tutto, chiudi entrambe le finestre.
echo.
pause
endlocal
BATEOF
echo "--- contenuto scritto, righe totali: ---"
wc -l /home/claude/remote-play-web/avvia-tutto.bat