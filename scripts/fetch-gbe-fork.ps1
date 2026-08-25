# Baixa e instala os binários pre-compilados do emulador Goldberg/GSE
# (gbe_fork) usados pelo GhostBox para conquistas offline.
#
# O Windows Defender costuma marcar o arquivo .7z do release como falso
# positivo ("software possivelmente indesejado"). Se o download falhar:
#   1. Adicione uma excecao no Defender para a pasta de download temporaria:
#      Add-MpPreference -ExclusionPath "$env:TEMP\gbe-fetch"
#   2. Rode este script novamente.
#
# Uso:  powershell -ExecutionPolicy Bypass -File scripts/fetch-gbe-fork.ps1

param(
    [string]$ReleaseTag = "release-2026_08_23"
)

$ErrorActionPreference = "Stop"

$repo = "Detanup01/gbe_fork"
$tmpRoot = Join-Path $env:TEMP "gbe-fetch"
$outDir = Join-Path $PSScriptRoot "..\src-tauri\binaries\gbe_fork"
New-Item -ItemType Directory -Force $tmpRoot | Out-Null
New-Item -ItemType Directory -Force $outDir | Out-Null

Write-Host "[1/5] Baixando extrator 7zr.exe..."
$sevenZip = Join-Path $tmpRoot "7zr.exe"
if (-not (Test-Path $sevenZip)) {
    Invoke-WebRequest "https://www.7-zip.org/a/7zr.exe" -OutFile $sevenZip -UseBasicParsing
}

Write-Host "[2/5] Baixando emu-win-release ($ReleaseTag)..."
$archive = Join-Path $tmpRoot "emu-win-release.7z"
Invoke-WebRequest "https://github.com/$repo/releases/download/$ReleaseTag/emu-win-release.7z" -OutFile $archive -UseBasicParsing

Write-Host "[3/5] Extraindo..."
$extractDir = Join-Path $tmpRoot "emu"
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
& $sevenZip x -y "-o$extractDir" $archive | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Extracao falhou (codigo $LASTEXITCODE)." }

Write-Host "[4/5] Localizando DLLs do emulador..."
$x64Dll = Get-ChildItem $extractDir -Recurse -Filter "steam_api64.dll" | Select-Object -First 1
$x86Dll = Get-ChildItem $extractDir -Recurse -Filter "steam_api.dll" | Select-Object -First 1
if (-not $x64Dll -or -not $x86Dll) { throw "DLLs steam_api(64).dll nao encontradas no pacote." }

New-Item -ItemType Directory -Force (Join-Path $outDir "x64") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $outDir "x86") | Out-Null
Copy-Item $x64Dll.FullName (Join-Path $outDir "x64\steam_api64.dll") -Force
Copy-Item $x86Dll.FullName (Join-Path $outDir "x86\steam_api.dll") -Force

Write-Host "[5/5] Registrando versao..."
Set-Content -Path (Join-Path $outDir "VERSION.txt") -Value $ReleaseTag

Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
Remove-Item -Force $archive -ErrorAction SilentlyContinue
Write-Host "OK: binarios instalados em $(Resolve-Path $outDir)"
