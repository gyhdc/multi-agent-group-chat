$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root
& "D:\nodejs\npm.cmd" run dev:backend
