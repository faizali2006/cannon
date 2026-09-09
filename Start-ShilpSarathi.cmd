@echo off
setlocal
cd /d "%~dp0"
title ShilpSarathi App Service

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)

echo Starting ShilpSarathi...
echo Keep this window open while using the app.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8787/'"
npm start

echo.
echo ShilpSarathi stopped.
pause
