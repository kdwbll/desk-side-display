@echo off
setlocal
set "DESK_SIDE_DISPLAY_ROOT=%~dp0"

rem Use Unicode code points for the Chinese shortcut name while keeping this file ASCII.
powershell.exe -NoLogo -NoProfile -NonInteractive -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "$project = (Get-Item -LiteralPath $env:DESK_SIDE_DISPLAY_ROOT).FullName;" ^
    "$launcher = (Get-Item -LiteralPath (Join-Path $project 'Start-DeskSideDisplay.cmd')).FullName;" ^
    "$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory);" ^
    "if (-not [IO.Directory]::Exists($desktop)) { throw 'The Windows desktop folder could not be found.' }" ^
    "$name = -join [char[]](0x684C, 0x9762, 0x526F, 0x5C4F);" ^
    "$path = Join-Path $desktop ($name + '.lnk');" ^
    "$shell = New-Object -ComObject WScript.Shell;" ^
    "$shortcut = $shell.CreateShortcut($path);" ^
    "if ((Test-Path -LiteralPath $path) -and $shortcut.TargetPath -ne $launcher) { throw ('A different shortcut already exists at ' + $path) }" ^
    "$shortcut.TargetPath = $launcher;" ^
    "$shortcut.WorkingDirectory = $project;" ^
    "$shortcut.WindowStyle = 7;" ^
    "$shortcut.Description = 'Open the Desk Side Display control panel';" ^
    "$shortcut.Save();" ^
    "Write-Host ('Created Windows desktop shortcut: ' + $path);"

if not errorlevel 1 exit /b 0
pause
exit /b 1
