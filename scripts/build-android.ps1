param(
    [Parameter(Mandatory = $true)][string]$ApiUrl,
    [switch]$Usb
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$uri = [Uri]$ApiUrl
if (-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('http', 'https') -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or $uri.UserInfo) {
    throw 'ApiUrl must be an HTTP(S) server origin without credentials or a path.'
}
if ($uri.Host -in @('0.0.0.0', '::', '[::]')) { throw 'Use a reachable server address, not a bind address.' }
if ($uri.IsLoopback -and -not $Usb) { throw 'Loopback requires -Usb and adb reverse; use the computer LAN address for Wi-Fi.' }
$origin = $uri.GetLeftPart([UriPartial]::Authority)
$health = Invoke-RestMethod "$origin/api/health" -TimeoutSec 10
if (-not $health.ok -or $health.app -ne 'zaizai') { throw 'Backend health check failed.' }
if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-17*' | Select-Object -First 1
    if (-not $jdk) { throw 'Set JAVA_HOME to a JDK 17 installation.' }
    $env:JAVA_HOME = $jdk.FullName
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $PWD '.tools\sdk' }
$previousApi = $env:VITE_NATIVE_API_URL
try {
    $env:VITE_NATIVE_API_URL = $origin
    node node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
    node node_modules/@capacitor/cli/bin/capacitor sync android
    if ($LASTEXITCODE -ne 0) { throw 'Android asset sync failed.' }
    & .\android\gradlew.bat -p android assembleDebug --no-daemon --offline
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    $apk = 'android/app/build/outputs/apk/debug/app-debug.apk'
    & (Join-Path $env:ANDROID_HOME 'build-tools/34.0.0/apksigner.bat') verify $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    New-Item -ItemType Directory -Path artifacts -Force | Out-Null
    Copy-Item -LiteralPath $apk -Destination 'artifacts/zaizai-mvp-debug.apk'
    Write-Output "APK: $PWD\artifacts\zaizai-mvp-debug.apk"
    Write-Output "Default backend: $origin"
    Write-Output 'Phone connectivity still requires LAN access or configured USB forwarding.'
} finally {
    $env:VITE_NATIVE_API_URL = $previousApi
}
