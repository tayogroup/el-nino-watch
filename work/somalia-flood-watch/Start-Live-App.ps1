$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-Host 'Install Node.js 24 (or Node.js 22 or newer), then run this script again.'
    exit 1
}
Write-Host 'Somalia El Nino Watch: http://127.0.0.1:4173'
Write-Host 'Open this address in a browser. Keep this window open for live data. Ctrl+C stops the app.'
& $nodeCommand.Source (Join-Path $PSScriptRoot 'server.mjs')
