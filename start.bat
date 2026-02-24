@echo off
SETLOCAL EnableDelayedExpansion

REM Disable QuickEdit mode to prevent console freeze on click
reg add HKCU\Console /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>&1

REM ================= CONFIGURATION =================
SET "START_DIR=%CD%"
SET NGINX_PATH=C:\nginx
SET PROJECT_ROOT=E:\MARKET_WIZARD
SET CLIENT_PATH=%PROJECT_ROOT%\client
SET PYTHON_PATH=%PROJECT_ROOT%\.venv\Scripts\python.exe
REM =================================================

echo ========================================
echo    MONEYPRINTER.LIVE PRODUCTION RELOAD
echo ========================================
echo.

REM ---------------------------------------------
REM 1. KILL PROCESSES (full purge)
REM ---------------------------------------------
echo [1/4] Purging all services...

echo    - Killing MoneyPrinter backend windows...
taskkill /F /FI "WINDOWTITLE eq MoneyPrinter*" /T 2>nul

REM Kill MoneyPrinter backend on port 5000
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5000" ^| find "LISTENING"') do (
    taskkill /F /PID %%a /T 2>nul
    echo    - Backend (Port 5000^) killed.
)

REM Kill ALL nginx (shared process, must restart clean to pick up config)
taskkill /F /IM nginx.exe 2>nul
if !ERRORLEVEL! EQU 0 (
    echo    - All nginx processes killed.
) else (
    echo    - No nginx processes found.
)

timeout /t 2 /nobreak >nul
echo.

REM ---------------------------------------------
REM 2. REBUILD FRONTEND
REM ---------------------------------------------
echo [2/4] Rebuilding Frontend (React CRA)...
cd /d "%CLIENT_PATH%"

if exist "build" (
    rd /s /q "build" >nul 2>&1
    if exist "build" (
        set "TRASH_NAME=build_trash_!RANDOM!"
        ren build "!TRASH_NAME!" >nul 2>&1
        if exist "build" (
            echo    CRITICAL: Could not remove build folder. Close Explorer and retry.
            pause
            exit /b 1
        )
        echo    - Locked build renamed to !TRASH_NAME!
    ) else (
        echo    - Old build cleared.
    )
)

echo    - Running npm build...
call npm run build
IF %ERRORLEVEL% NEQ 0 (
    echo    BUILD FAILED - aborting.
    pause
    exit /b %ERRORLEVEL%
)
echo    - Build successful.
echo.

REM ---------------------------------------------
REM 3. START NGINX (clean start, all stale processes already killed in step 1)
REM ---------------------------------------------
echo [3/4] Starting Nginx (fresh)...
cd /d "%NGINX_PATH%"

if exist "%NGINX_PATH%\cache" (
    rd /s /q "%NGINX_PATH%\cache" >nul 2>&1
    mkdir "%NGINX_PATH%\cache"
    echo    - Nginx cache purged.
)

REM Kill any stragglers that survived step 1
taskkill /F /IM nginx.exe 2>nul >nul

nginx.exe -t
IF %ERRORLEVEL% NEQ 0 (
    echo    NGINX CONFIG ERROR - aborting.
    pause
    exit /b 1
)
echo    - Config OK.

start nginx
timeout /t 2 /nobreak >nul
echo    - Nginx started (serves moneyprinter + plair + deepmirror).
echo.

REM ---------------------------------------------
REM 4. START BACKEND
REM ---------------------------------------------
echo [4/4] Starting Backend...
echo    - Python: %PYTHON_PATH%

start "MoneyPrinter Backend (Port 5000)" cmd /k "cd /d %PROJECT_ROOT%\server && %PYTHON_PATH% app.py"
echo    - Backend started on port 5000.

echo.
echo ========================================
echo    MONEYPRINTER.LIVE IS LIVE
echo ========================================
echo.
echo    Site:     https://moneyprinter.live
echo    Backend:  http://localhost:5000
echo    API docs: http://localhost:5000/docs
echo.
echo    Nginx serves all sites (moneyprinter + plair + deepmirror).
echo.
cd /d "%START_DIR%"
cmd /k
