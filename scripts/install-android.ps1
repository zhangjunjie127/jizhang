param([string]$Serial = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$adb = Join-Path $root '.tools\sdk\platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb)) { $adb = (Get-Command adb -ErrorAction Stop).Source }
$apk = Join-Path $root 'artifacts\zaizai-mvp-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw 'Build the APK first.' }
$deviceArgs = @()
if ($Serial) { $deviceArgs = @('-s', $Serial) }
& $adb @deviceArgs get-state
if ($LASTEXITCODE -ne 0) { throw 'Connect one Android phone with USB debugging enabled and approve its prompt.' }
& $adb @deviceArgs install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }
& $adb @deviceArgs reverse tcp:8787 tcp:8787
if ($LASTEXITCODE -ne 0) { throw 'USB backend forwarding failed.' }
& $adb @deviceArgs shell am start -n cn.zaizai.companion/.MainActivity
