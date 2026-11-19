@echo off
setlocal
pushd "%~dp0"
set "DOTNET_CLI_TELEMETRY_OPTOUT=1"
powershell.exe -NoProfile -Command "try { $live = Invoke-RestMethod 'http://127.0.0.1:8766/api/state' -TimeoutSec 2; if ($null -ne $live.control.preferences) { exit 0 } } catch {} ; exit 1"
if not errorlevel 1 (
    start "" "http://127.0.0.1:8766/"
    popd
    exit /b 0
)
dotnet build --nologo
if errorlevel 1 goto failed
dotnet "bin\Debug\net9.0-windows10.0.19041.0\DeskSideDisplay.dll" --open-control
if errorlevel 1 goto failed
popd
exit /b 0

:failed
pause
popd
exit /b 1
