$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root
. (Join-Path $PSScriptRoot "common.ps1")
Invoke-RepoNpm run dev:frontend
