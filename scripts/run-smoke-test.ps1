$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root
. (Join-Path $PSScriptRoot "common.ps1")
Invoke-RepoPython (Join-Path $root "tests\smoke_test.py")
