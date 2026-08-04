@echo off
setlocal
cd /d "%~dp0"

set PNPM_CMD=pnpm
if exist "%APPDATA%\npm\pnpm.cmd" set PNPM_CMD="%APPDATA%\npm\pnpm.cmd"

echo Starting Postgres (Docker)...
where docker >nul 2>nul
if %errorlevel%==0 (
  docker compose -f infra\docker-compose.yml up -d
) else (
  echo Docker not found on PATH - skipping database startup.
)

echo.
echo Starting Markaz (API + desktop app)...
echo Close this window to stop everything.
echo.
call %PNPM_CMD% dev

pause
