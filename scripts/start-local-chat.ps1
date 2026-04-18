param(
  [switch]$Background,
  [switch]$SkipInstall
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeDir = Join-Path $root "tmp"
$runtimeFile = Join-Path $runtimeDir "runtime.json"
$backendScript = Join-Path $PSScriptRoot "dev-backend.ps1"
$frontendScript = Join-Path $PSScriptRoot "dev-frontend.ps1"

. (Join-Path $PSScriptRoot "common.ps1")

function Test-TcpPort {
  param(
    [string]$HostName,
    [int]$Port
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    $success = $async.AsyncWaitHandle.WaitOne(300)
    if (-not $success) {
      return $false
    }
    $client.EndConnect($async) | Out-Null
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Wait-TcpPort {
  param(
    [string]$HostName,
    [int]$Port,
    [int]$TimeoutSeconds = 60
  )

  for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
    if (Test-TcpPort -HostName $HostName -Port $Port) {
      return $true
    }
    Start-Sleep -Seconds 1
  }

  return $false
}

function Start-LocalProcess {
  param(
    [string]$ScriptPath
  )

  $windowStyle = if ($Background) { "Hidden" } else { "Normal" }

  return Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $ScriptPath) `
    -WorkingDirectory $root `
    -WindowStyle $windowStyle `
    -PassThru
}

Set-Location $root
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

if ((Test-TcpPort -HostName "127.0.0.1" -Port 3030) -and (Test-TcpPort -HostName "127.0.0.1" -Port 5173)) {
  if (-not $Background) {
    Start-Process "http://127.0.0.1:5173" | Out-Null
    Write-Host "App is already running. Browser opened."
  } else {
    Write-Host "App is already running."
  }
  exit 0
}

if ((Test-TcpPort -HostName "127.0.0.1" -Port 3030) -or (Test-TcpPort -HostName "127.0.0.1" -Port 5173)) {
  throw "Port 3030 or 5173 is already occupied, but the app is not fully running."
}

if (-not $SkipInstall -and -not (Test-Path (Join-Path $root "node_modules"))) {
  Invoke-RepoNpm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed."
  }
}

$backendProcess = Start-LocalProcess -ScriptPath $backendScript
$frontendProcess = Start-LocalProcess -ScriptPath $frontendScript

$backendReady = Wait-TcpPort -HostName "127.0.0.1" -Port 3030 -TimeoutSeconds 60
$frontendReady = Wait-TcpPort -HostName "127.0.0.1" -Port 5173 -TimeoutSeconds 60

if (-not ($backendReady -and $frontendReady)) {
  foreach ($processId in @($backendProcess.Id, $frontendProcess.Id)) {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
    }
  }

  throw "Startup timeout: frontend or backend did not become ready in time."
}

@{
  backendPid = $backendProcess.Id
  frontendPid = $frontendProcess.Id
  startedAt = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -Path $runtimeFile -Encoding UTF8

if (-not $Background) {
  Start-Process "http://127.0.0.1:5173" | Out-Null
}

Write-Host "App started."
Write-Host "Frontend: http://127.0.0.1:5173"
Write-Host "Backend: http://127.0.0.1:3030"
