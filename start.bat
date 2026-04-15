@echo off
cd /d "%~dp0"
echo Bodymaker を起動しています...
echo.
echo ブラウザで http://localhost:8000 を開いてください
echo 終了するには Ctrl+C を押してください
echo.
node server.js
pause
