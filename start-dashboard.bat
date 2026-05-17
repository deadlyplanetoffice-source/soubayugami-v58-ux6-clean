@echo off
chcp 65001 >nul
title Soubayugami Kansokuki v58

cd /d "%~dp0"

if not exist package.json (
  if exist "%~dp0soubayugami-kansokuki-v58\package.json" (
    cd /d "%~dp0soubayugami-kansokuki-v58"
  )
)

if not exist package.json (
  echo package.json was not found.
  echo Please place this BAT in the soubayugami-kansokuki-v58 folder, or use run-v58.bat from the extracted root.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js LTS first.
  echo https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting Soubayugami Kansokuki v58...
start "" http://127.0.0.1:5173/
call npm run dev
pause
