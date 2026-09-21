param(
    [string]$BindAddress = '127.0.0.1',
    [int]$Port = 8787
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
. (Join-Path $PSScriptRoot 'load-backend-credentials.ps1')
if (-not $env:CPA_BASE_URL) {
    $env:CPA_BASE_URL = Read-Host 'CPA base URL (ending in /v1)'
}
if (-not $env:CPA_API_KEY) {
    $secret = Read-Host 'CPA API key' -AsSecureString
    $env:CPA_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password
}
$env:HOST = $BindAddress
$env:PORT = "$Port"
try { node server/index.mjs }
finally { Remove-Item Env:CPA_API_KEY -ErrorAction SilentlyContinue }
