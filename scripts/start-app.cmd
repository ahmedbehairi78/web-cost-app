@echo off
title Web Cost App
set "APP_ROOT=%~dp0..\"
cd /d "%APP_ROOT%"

if not exist "package.json" (
    echo [ERROR] Could not find package.json in %APP_ROOT%
    pause
    exit /b 1
)

echo.
echo  Web Cost App — starting frontend (:3000) and local API (:3001)
echo  Browser opens automatically when the dev server is ready.
echo  Close this window to stop both servers.
echo.

start /min "" "%SystemRoot%\System32\cmd.exe" /c "for /l %%i in (1,1,45) do (curl -fsS -o NUL http://127.0.0.1:3000/ >nul 2>&1 && (start "" http://localhost:3000/ && exit /b 0) & timeout /t 1 /nobreak >nul)"

call npm run dev:local
if errorlevel 1 (
    echo.
    echo [ERROR] dev:local failed.
    echo   - If ports 3000 / 3001 are busy, close the other Web Cost App window or run:
    echo       netstat -ano ^| findstr ":3000 :3001"
    echo       taskkill /PID ^<pid^> /F
    echo   - If node_modules is missing, run: npm install
    echo   - Then retry: npm run dev:local
    pause
)
