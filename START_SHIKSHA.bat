@echo off
setlocal
cd /d "%~dp0backend"
if not exist ".env" copy /y ".env.example" ".env" >nul
if not exist "node_modules" (
  echo Installing Shiksha Copilot document-import dependencies...
  call npm install
  if errorlevel 1 echo WARNING: Optional PDF/DOCX import dependencies failed to install. Core demo mode still runs; TXT import remains available.
)
start "Shiksha Copilot Server" cmd /k "cd /d ""%~dp0backend"" && node server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:8787"
endlocal
