$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24, then retry.' }
Write-Host 'Somalia El Nino Watch: http://127.0.0.1:4173'
& node (Join-Path $PSScriptRoot 'work/somalia-flood-watch/server.mjs')
