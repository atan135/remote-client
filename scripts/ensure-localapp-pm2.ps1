param(
  [string]$ProcessName = "localapp",
  [string]$RepoRoot = "",
  [string]$Pm2Command = "pm2",
  [string]$NodeEntry = "",
  [int]$StartupWaitSeconds = 15
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
  $RepoRoot = Resolve-Path $RepoRoot
}

if ([string]::IsNullOrWhiteSpace($NodeEntry)) {
  $NodeEntry = Join-Path $RepoRoot "localapp\src\index.js"
} else {
  $NodeEntry = Resolve-Path $NodeEntry
}

if ($ProcessName -notmatch "^[A-Za-z0-9_.-]+$") {
  throw "Unsafe PM2 process name: $ProcessName"
}

$LogDir = Join-Path $RepoRoot "localapp\logs"
$LogPath = Join-Path $LogDir "ensure-localapp-pm2.log"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-EnsureLog {
  param([string]$Message)

  $Line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $LogPath -Value $Line -Encoding UTF8
  Write-Host $Line
}

function Invoke-CheckedCommand {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList
  )

  $Result = Invoke-NativeCommand -FilePath $FilePath -ArgumentList $ArgumentList

  if ($Result.ExitCode -ne 0) {
    throw "Command failed: $FilePath $($ArgumentList -join ' ')`n$($Result.Output | Out-String)"
  }

  return $Result.Output
}

function Invoke-NativeCommand {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList
  )

  $PreviousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $Output = & $FilePath @ArgumentList 2>&1
    $ExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }

  if ($null -eq $ExitCode) {
    $ExitCode = 0
  }

  return [pscustomobject]@{
    ExitCode = $ExitCode
    Output = $Output
  }
}

function Get-Pm2Process {
  param([string]$Name)

  $ListOutput = Invoke-CheckedCommand -FilePath $Pm2Command -ArgumentList @("list")
  $EscapedName = [regex]::Escape($Name)

  foreach ($Line in $ListOutput) {
    $Text = [string]$Line

    if ($Text -notmatch "(^|[^A-Za-z0-9_.-])$EscapedName([^A-Za-z0-9_.-]|$)") {
      continue
    }

    if ($Text -match "\b(?<Status>online|stopped|errored|stopping|launching|one-launch-status)\b") {
      return [pscustomobject]@{
        name = $Name
        status = $Matches.Status
      }
    }
  }

  return $null
}

function Wait-Pm2Process {
  param(
    [string]$Name,
    [int]$TimeoutSeconds
  )

  $Deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))

  do {
    $Process = Get-Pm2Process -Name $Name

    if ($null -ne $Process) {
      return $Process
    }

    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $Deadline)

  return $null
}

try {
  Set-Location $RepoRoot
  Write-EnsureLog "Checking PM2 process `"$ProcessName`" from $RepoRoot"

  Invoke-CheckedCommand -FilePath $Pm2Command -ArgumentList @("list") | Out-Null
  Write-EnsureLog "pm2 list completed"

  $Before = Get-Pm2Process -Name $ProcessName

  if ($null -ne $Before -and $Before.status -eq "online") {
    Write-EnsureLog "PM2 process `"$ProcessName`" is already online"
    exit 0
  }

  if ($null -ne $Before) {
    Write-EnsureLog "PM2 process `"$ProcessName`" exists with status `"$($Before.status)`", restarting"
    Invoke-CheckedCommand -FilePath $Pm2Command -ArgumentList @("restart", $ProcessName, "--update-env") | Out-Null
  } else {
    Write-EnsureLog "PM2 process `"$ProcessName`" is missing, starting localapp"
    Invoke-CheckedCommand -FilePath $Pm2Command -ArgumentList @(
      "start",
      $NodeEntry,
      "--name",
      $ProcessName
    ) | Out-Null
  }

  $After = Wait-Pm2Process -Name $ProcessName -TimeoutSeconds $StartupWaitSeconds

  if ($null -eq $After -or $After.status -ne "online") {
    $Status = if ($null -eq $After) { "missing" } else { $After.status }
    throw "PM2 process `"$ProcessName`" is not online after ensure, status: $Status"
  }

  Write-EnsureLog "PM2 process `"$ProcessName`" is online"
  exit 0
} catch {
  Write-EnsureLog "ERROR $($_.Exception.Message)"
  exit 1
}
