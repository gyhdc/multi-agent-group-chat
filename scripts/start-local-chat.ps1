param(
  [switch]$Background,
  [switch]$SkipInstall
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeDir = Join-Path $root "tmp"
$runtimeFile = Join-Path $runtimeDir "runtime.json"
$logDir = Join-Path $runtimeDir "logs"
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

function Get-ProcessInfoSafe {
  param(
    [int]$ProcessId
  )

  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    return [pscustomobject]@{
      Id = $ProcessId
      Name = $process.ProcessName
      Path = $process.Path
      CommandLine = $cim.CommandLine
    }
  } catch {
    return $null
  }
}

function Test-IsLikelyRepoAppProcess {
  param(
    [pscustomobject]$ProcessInfo
  )

  if (-not $ProcessInfo) {
    return $false
  }

  $name = [string]$ProcessInfo.Name
  $commandLine = [string]$ProcessInfo.CommandLine
  $path = [string]$ProcessInfo.Path
  $name = $name.ToLowerInvariant()

  if ($name -notin @("node", "powershell", "pwsh", "cmd")) {
    return $false
  }

  if ($commandLine -like "*$root*" -or $path -like "*$root*") {
    return $true
  }

  if ($commandLine -match "multi-agent-group-chat" -or $commandLine -match "vite" -or $commandLine -match "tsx watch src/index.ts") {
    return $true
  }

  return $false
}

function Stop-StaleRepoAppProcesses {
  param(
    [int[]]$Ports
  )

  $processIds = Get-ListeningProcessIds -Ports $Ports
  if (-not $processIds -or $processIds.Count -eq 0) {
    return $false
  }

  $processes = @($processIds | ForEach-Object { Get-ProcessInfoSafe -ProcessId $_ } | Where-Object { $_ })
  if ($processes.Count -eq 0) {
    return $false
  }

  $foreign = @($processes | Where-Object { -not (Test-IsLikelyRepoAppProcess -ProcessInfo $_) })
  if ($foreign.Count -gt 0) {
    $details = $foreign | ForEach-Object { "$($_.Name)#$($_.Id)" }
    throw "Port 3030 or 5173 is occupied by another process: $($details -join ', ')."
  }

  foreach ($processInfo in $processes) {
    try {
      Stop-Process -Id $processInfo.Id -Force -ErrorAction Stop
      Write-Host "Stopped stale process $($processInfo.Name) ($($processInfo.Id))"
    } catch {
    }
  }

  Start-Sleep -Milliseconds 600
  return $true
}

function Start-LocalProcess {
  param(
    [string]$ScriptPath,
    [string]$Name
  )

  $windowStyle = if ($Background) { "Hidden" } else { "Normal" }
  $stdoutLog = Join-Path $logDir "$Name.stdout.log"
  $stderrLog = Join-Path $logDir "$Name.stderr.log"

  return Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"' + $ScriptPath + '"')) `
    -WorkingDirectory $root `
    -WindowStyle $windowStyle `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
}

Set-Location $root
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if ((Test-TcpPort -HostName "127.0.0.1" -Port 3030) -and (Test-TcpPort -HostName "127.0.0.1" -Port 5173)) {
  if (-not (Test-Path $runtimeFile)) {
    [void](Stop-StaleRepoAppProcesses -Ports @(3030, 5173))
  }

  if (-not ((Test-TcpPort -HostName "127.0.0.1" -Port 3030) -and (Test-TcpPort -HostName "127.0.0.1" -Port 5173))) {
    # Stale processes were cleared, continue to start a fresh instance.
  } elseif (-not $Background) {
    Start-Process "http://127.0.0.1:5173" | Out-Null
    Write-Host "App is already running. Browser opened."
    exit 0
  } else {
    Write-Host "App is already running."
    exit 0
  }
}

if ((Test-TcpPort -HostName "127.0.0.1" -Port 3030) -or (Test-TcpPort -HostName "127.0.0.1" -Port 5173)) {
  [void](Stop-StaleRepoAppProcesses -Ports @(3030, 5173))
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

$backendProcess = Start-LocalProcess -ScriptPath $backendScript -Name "backend"
$frontendProcess = Start-LocalProcess -ScriptPath $frontendScript -Name "frontend"

$backendReady = Wait-TcpPort -HostName "127.0.0.1" -Port 3030 -TimeoutSeconds 120
$frontendReady = Wait-TcpPort -HostName "127.0.0.1" -Port 5173 -TimeoutSeconds 120

if (-not ($backendReady -and $frontendReady)) {
  foreach ($processId in @($backendProcess.Id, $frontendProcess.Id)) {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
    }
  }

  throw "Startup timeout: frontend or backend did not become ready in time. Check tmp\\logs\\backend.stderr.log and tmp\\logs\\frontend.stderr.log."
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
