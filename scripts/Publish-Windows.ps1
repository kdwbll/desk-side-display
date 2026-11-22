param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$OutputDirectory = "artifacts/windows"
)

$ErrorActionPreference = "Stop"
$repository = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$project = Join-Path $repository "DeskSideDisplay.csproj"
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
$runtime = "9.0.23"
$scratch = Join-Path ([IO.Path]::GetTempPath()) ("DeskSideDisplay-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $scratch | Out-Null
$targets = Join-Path $scratch "RuntimeVersion.targets"
$notices = Join-Path $scratch "DotNetNotices.txt"

try {
    @"
<Project>
  <ItemGroup>
    <KnownFrameworkReference Update="Microsoft.NETCore.App;Microsoft.AspNetCore.App;Microsoft.WindowsDesktop.App;Microsoft.WindowsDesktop.App.WindowsForms" LatestRuntimeFrameworkVersion="$runtime" />
    <KnownAppHostPack Update="Microsoft.NETCore.App" AppHostPackVersion="$runtime" />
  </ItemGroup>
</Project>
"@ | Set-Content -LiteralPath $targets -Encoding UTF8
    $settings = @(
        "-p:DeskSideSingleFile=true",
        "-p:CustomAfterMicrosoftCommonTargets=$targets",
        "-p:DeskSideRuntimeNotices=$notices"
    )
    dotnet restore $project --nologo -r win-x64 @settings
    if ($LASTEXITCODE -ne 0) { throw "Runtime restore failed." }
    $cacheLine = dotnet nuget locals global-packages --list --force-english-output
    if ($LASTEXITCODE -ne 0) { throw "Could not locate NuGet packages." }
    $cache = $cacheLine -replace "^global-packages:\s*", ""

    $runtimePack = Join-Path $cache "microsoft.netcore.app.runtime.win-x64/$runtime"
    $hostPack = Join-Path $cache "microsoft.netcore.app.host.win-x64/$runtime"
    $aspPack = Join-Path $cache "microsoft.aspnetcore.app.runtime.win-x64/$runtime"
    $desktopPack = Join-Path $cache "microsoft.windowsdesktop.app.runtime.win-x64/$runtime"
    $licenses = [ordered]@{
        ".NET Runtime license" = Join-Path $runtimePack "LICENSE.TXT"
        ".NET Runtime third-party notices" = Join-Path $runtimePack "THIRD-PARTY-NOTICES.TXT"
        ".NET AppHost license" = Join-Path $hostPack "LICENSE.TXT"
        ".NET AppHost third-party notices" = Join-Path $hostPack "THIRD-PARTY-NOTICES.TXT"
        "ASP.NET Core license" = "https://raw.githubusercontent.com/dotnet/aspnetcore/v$runtime/LICENSE.txt"
        "ASP.NET Core third-party notices" = Join-Path $aspPack "THIRD-PARTY-NOTICES.TXT"
        "Windows Desktop license" = Join-Path $desktopPack "LICENSE"
        "Windows Forms third-party notices" = "https://raw.githubusercontent.com/dotnet/winforms/v$runtime/THIRD-PARTY-NOTICES.TXT"
        "Windows Presentation Foundation third-party notices" = "https://raw.githubusercontent.com/dotnet/wpf/v$runtime/THIRD-PARTY-NOTICES.TXT"
    }
    $combined = foreach ($license in $licenses.GetEnumerator()) {
        $license.Key
        if ($license.Value.StartsWith("https://")) {
            [string](Invoke-WebRequest -UseBasicParsing -Uri $license.Value -TimeoutSec 30).Content
        } else {
            Get-Content -LiteralPath $license.Value -Raw
        }
        ""
    }
    [IO.File]::WriteAllLines($notices, [string[]]$combined)

    dotnet publish $project --nologo --no-restore -c Release -r win-x64 @settings "-p:Version=$Version" -p:DebugType=None -p:DebugSymbols=false -o $output
    if ($LASTEXITCODE -ne 0) { throw "Single-file publish failed." }
    $exe = Join-Path $output "DeskSideDisplay.exe"
    Get-FileHash -LiteralPath $exe -Algorithm SHA256
}
finally {
    foreach ($file in @($targets, $notices)) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    }
    Remove-Item -LiteralPath $scratch
}
