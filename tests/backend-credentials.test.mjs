import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Windows backend credentials are encrypted, reloadable and bound to their endpoint', { skip: process.platform !== 'win32' }, () => {
  const loader = fileURLToPath(new URL('../scripts/load-backend-credentials.ps1', import.meta.url)).replaceAll("'", "''");
  const script = `
    $ErrorActionPreference = 'Stop'
    $path = Join-Path ([System.IO.Path]::GetTempPath()) (([guid]::NewGuid().ToString()) + '.xml')
    try {
      $secret = ConvertTo-SecureString 'fixture-secret-only' -AsPlainText -Force
      $credential = [System.Management.Automation.PSCredential]::new('https://example.invalid/v1', $secret)
      $credential | Export-Clixml -LiteralPath $path
      if ((Get-Content -LiteralPath $path -Raw).Contains('fixture-secret-only')) { throw 'Plaintext credential was stored' }
      Remove-Item Env:CPA_BASE_URL,Env:CPA_API_KEY -ErrorAction SilentlyContinue
      . '${loader}' -CredentialPath $path
      if ($env:CPA_BASE_URL -ne 'https://example.invalid/v1' -or $env:CPA_API_KEY -ne 'fixture-secret-only') { throw 'Credential not restored' }
      $env:CPA_BASE_URL = 'https://other.invalid/v1'
      $env:CPA_API_KEY = 'explicit-override'
      . '${loader}' -CredentialPath $path
      if ($env:CPA_API_KEY -ne 'explicit-override') { throw 'Explicit credential overwritten' }
      Remove-Item Env:CPA_API_KEY
      $rejected = $false
      try { . '${loader}' -CredentialPath $path } catch { $rejected = $true }
      if (-not $rejected -or $env:CPA_API_KEY) { throw 'Credential leaked to another endpoint' }
      Write-Output 'PASS'
    } finally { Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue }
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PSModulePath: `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\Modules` },
  });
  assert.equal(result.status, 0, result.stderr || 'Windows credential loading regression failed');
  assert.match(result.stdout, /PASS/);
});
