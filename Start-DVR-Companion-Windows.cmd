@echo off
setlocal
cd /d "%~dp0"
call Start-Windows.cmd --analysis %*
exit /b %ERRORLEVEL%
