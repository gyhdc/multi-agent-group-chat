function Get-NpmCommand {
  foreach ($name in @("npm.cmd", "npm")) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  throw "npm was not found in PATH. Install Node.js and ensure npm is available."
}

function Invoke-RepoNpm {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  $npmCommand = Get-NpmCommand
  & $npmCommand @Arguments
}

function Get-PythonLaunch {
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return @{
      Command = $python.Source
      PrefixArgs = @()
    }
  }

  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    return @{
      Command = $py.Source
      PrefixArgs = @("-3")
    }
  }

  throw "Python was not found in PATH. Install Python 3 and ensure `py` or `python` is available."
}

function Invoke-RepoPython {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  $launch = Get-PythonLaunch
  & $launch.Command @($launch.PrefixArgs + $Arguments)
}
