@echo off
call "%~dp0Start-Windows.cmd" --train %*
exit /b %errorlevel%
