param(
    [string]$CredentialPath = (Join-Path $env:LOCALAPPDATA 'Zaizai\backend-credential.xml')
)
$ErrorActionPreference = 'Stop'
if (-not $env:CPA_API_KEY -and (Test-Path -LiteralPath $CredentialPath)) {
    # Windows CLIXML credentials are protected with the current user's DPAPI key.
    $credential = Import-Clixml -LiteralPath $CredentialPath
    if ($credential -isnot [System.Management.Automation.PSCredential]) {
        throw 'Invalid saved backend credential.'
    }
    $savedBase = $credential.UserName.TrimEnd('/')
    if ($env:CPA_BASE_URL -and $env:CPA_BASE_URL.TrimEnd('/') -ne $savedBase) {
        throw 'Saved credential belongs to a different AI endpoint. Supply matching credentials.'
    }
    $env:CPA_BASE_URL = $savedBase
    $env:CPA_API_KEY = $credential.GetNetworkCredential().Password
    Remove-Variable credential
}
