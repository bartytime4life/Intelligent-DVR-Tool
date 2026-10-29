@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  python -m edge.pc_setup --check %*
) else (
  py -3.12 -m edge.pc_setup --check %*
)
set "DVR_EXIT=%ERRORLEVEL%"
if not "%DVR_EXIT%"=="0" echo Setup failed. Read the message above; install 64-bit Python 3.12 if needed.
if not defined DVR_NONINTERACTIVE pause
exit /b %DVR_EXIT%
