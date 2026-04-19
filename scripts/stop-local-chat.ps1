$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeFile = Join-Path $root "tmp\runtime.json"

function Get-ListeningProcessIds {
  param(
    [int[]]$Ports
  )

  $ids = @()
  foreach ($port in $Ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      if ($connection.OwningProcess) {
        $ids += [int]$connection.OwningProcess
      }
    }
  }

  return $ids | Sort-Object -Unique
}

if (-not (Test-Path $runtimeFile)) {
  $fallbackProcessIds = Get-ListeningProcessIds -Ports @(3030, 5173)
  if (-not $fallbackProcessIds -or $fallbackProcessIds.Count -eq 0) {
    Write-Host "No runtime record found."
    exit 0
  }

  foreach ($processId in $fallbackProcessIds) {
    try {
      Stop-Process -Id ([int]$processId) -Force -ErrorAction Stop
      Write-Host "Stopped process $processId"
    } catch {
      Write-Host "Process $processId is already gone or cannot be stopped"
    }
  }

  Write-Host "Stopped fallback app instance by port."
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
