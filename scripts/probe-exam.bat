@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo.
echo  Exam query local probe
echo.
node scripts\probe-exam-local.js
echo.
pause
