@echo off
title Monikers Party Server
cd /d "%~dp0"
if not exist node_modules (
  echo Installing required packages. This requires internet the first time only...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
echo.
echo Starting Monikers Party...
echo Keep this window open while playing.
echo.
call npm start
pause
