@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (echo Please install Node.js 24 first. & pause & exit /b 1)
if not exist node_modules\jose\package.json call npm ci --ignore-scripts
if not exist node_modules\jose\package.json (pause & exit /b 1)
echo Open the URL shown below in your browser. Keep this window open during the local proof.
call npm start
pause
