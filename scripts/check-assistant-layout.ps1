$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not $env:JAVA_HOME) {
    $env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-17*' | Select-Object -First 1).FullName
}
$output = 'artifacts/android-layout-check'
New-Item -ItemType Directory -Path $output -Force | Out-Null
& "$env:JAVA_HOME/bin/javac.exe" -d $output android/app/src/main/java/cn/zaizai/companion/AssistantPanelLayout.java tests/android/AssistantPanelLayoutTest.java
if ($LASTEXITCODE -ne 0) { throw 'Layout check compilation failed.' }
& "$env:JAVA_HOME/bin/java.exe" -cp $output cn.zaizai.companion.AssistantPanelLayoutTest
if ($LASTEXITCODE -ne 0) { throw 'Layout check failed.' }
