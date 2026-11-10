@echo off
setlocal
cd /d "%~dp0"
call Start-Windows.cmd --companion %*
exit /b %ERRORLEVEL%
