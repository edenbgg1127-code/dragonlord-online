@echo off
rem ============================================
rem  Dragonlord Online - one-click server start
rem  (Windows: double-click this file to play)
rem ============================================
cd /d "%~dp0"
title Dragonlord Online Server
echo ============================================
echo   Dragonlord Online - starting server...
echo ============================================
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js not found. Please install it first:
  echo         https://nodejs.org  (LTS version)
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing packages, please wait about 1 minute...
  call npm.cmd install --no-audit --no-fund
)
echo.
echo Server starting! Open your browser at:  http://localhost:3000
echo Friends on the same Wi-Fi can join with  http://YOUR-IP:3000
echo (Close this window to stop the server)
echo.
call npm.cmd start
pause
