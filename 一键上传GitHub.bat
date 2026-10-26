@echo off
chcp 65001
title 一键上传到 GitHub
cd /d "%~dp0"

echo.
echo   正在启动一键上传脚本...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\upload-github.ps1" %*

echo.
pause
