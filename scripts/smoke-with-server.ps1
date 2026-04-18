$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

& "E:\Anaconda3\python.exe" "C:\Users\DuanChuan\.agents\skills\webapp-testing\scripts\with_server.py" `
  --server "powershell -NoProfile -File .\scripts\dev-root.ps1" `
  --port 5173 `
  -- powershell -NoProfile -File .\scripts\run-smoke-test.ps1
