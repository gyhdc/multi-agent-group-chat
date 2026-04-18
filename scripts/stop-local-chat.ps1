$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeFile = Join-Path $root "tmp\runtime.json"

if (-not (Test-Path $runtimeFile)) {
  Write-Host "No runtime record found."
  exit 0
}

$runtime = Get-Content -Path $runtimeFile -Raw | ConvertFrom-Json

foreach ($processId in @($runtime.backendPid, $runtime.frontendPid)) {
  if (-not $processId) {
    continue
  }

  try {
    Stop-Process -Id ([int]$processId) -Force -ErrorAction Stop
    Write-Host "Stopped process $processId"
  } catch {
    Write-Host "Process $processId is already gone or cannot be stopped"
  }
}

Remove-Item -Path $runtimeFile -Force -ErrorAction SilentlyContinue
Write-Host "App instance stopped."
