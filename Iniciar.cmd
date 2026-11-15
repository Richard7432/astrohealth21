@echo off
setlocal
cd /d "%~dp0"
set "ASTRO_PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%ASTRO_PY%" goto bundled

py -3 -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>&1
if not errorlevel 1 goto pylauncher

python -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>&1
if not errorlevel 1 goto pythonpath

echo Python 3.10 ou mais recente e necessario. Consulte o README.md.
pause
exit /b 1

:bundled
"%ASTRO_PY%" -B server.py --open %*
goto finished

:pylauncher
py -3 -B server.py --open %*
goto finished

:pythonpath
python -B server.py --open %*

:finished
if errorlevel 1 pause

