@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed
    pause
    exit /b 1
  )
)

echo Installing Claude Code hook...
call npm run install-hook
if errorlevel 1 (
  echo hook install failed
  pause
  exit /b 1
)

echo Starting claude-bouncer...
call npm start
