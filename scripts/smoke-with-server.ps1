$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeFile = Join-Path $root "tmp\runtime.json"
$hadRuntime = Test-Path $runtimeFile

Set-Location $root

if (-not $hadRuntime) {
  $stalePids = Get-NetTCPConnection -LocalPort 3030,5173 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $stalePids) {
    try {
      Stop-Process -Id ([int]$processId) -Force -ErrorAction Stop
    } catch {
    }
  }
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-local-chat.ps1") -Background -SkipInstall
if ($LASTEXITCODE -ne 0) {
  throw "Failed to start local app for smoke test."
}

try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-smoke-test.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "Smoke test failed."
  }
} finally {
  if (-not $hadRuntime -and (Test-Path $runtimeFile)) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stop-local-chat.ps1") | Out-Null
  }
}
