param([switch]$Build)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $projectRoot 'apps/web'
$viteEntry = Join-Path $projectRoot 'node_modules/vite/bin/vite.js'
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCommand) { throw 'Node.js 22 or later is required. Run this script in a terminal with Node.js on PATH.' }
if (-not (Test-Path -LiteralPath $viteEntry)) { throw 'Install the workspace dependencies first.' }

Push-Location -LiteralPath $webRoot
try {
  if ($Build) {
    & $nodeCommand.Source $viteEntry build --config vite.redesign.config.ts
  } else {
    Write-Host 'Markaz design preview: http://127.0.0.1:5186/redesign.html'
    & $nodeCommand.Source $viteEntry --config vite.redesign.config.ts
  }
  if ($LASTEXITCODE -ne 0) { throw "Preview command exited with code $LASTEXITCODE" }
} finally {
  Pop-Location
}
