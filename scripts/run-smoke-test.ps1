$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root
& "E:\Anaconda3\python.exe" (Join-Path $root "tests\smoke_test.py")
