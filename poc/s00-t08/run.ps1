param(
  [Parameter(Mandatory)] [string] $Install,
  [Parameter(Mandatory)] [string] $Scratch
)

$ErrorActionPreference = 'Stop'
$Scratch = [IO.Path]::GetFullPath($Scratch)
if (Test-Path -LiteralPath $Scratch) { throw 'Use a fresh scratch directory.' }
$homePath = Join-Path $Scratch 'daemon'
$fixture = Join-Path $Scratch 'fixture'
$cli = Join-Path $Install 'resources/bin/paseo.cmd'
$exe = Join-Path $Install 'Paseo.exe'
$poc = Split-Path -Parent $PSScriptRoot
$probe = Join-Path $PSScriptRoot 'probe.mjs'
$t07 = 'zelqio-poc-t07'

function Invoke-Paseo([string[]] $Arguments) {
  $output = & $cli @Arguments --home $homePath
  if ($LASTEXITCODE -ne 0) { throw ($output -join '`n') }
  return $output
}

function Invoke-FixtureGit([string[]] $Arguments) {
  $output = & git -C $fixture -c user.name='POC Fixture' -c user.email='fixture@example.invalid' -c commit.gpgsign=false @Arguments
  if ($LASTEXITCODE -ne 0) { throw ($output -join '`n') }
  return $output
}

function Invoke-Probe([string] $Step, [string] $ApprovalId) {
  $previous = $env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $output = & $exe $probe $Install $workspace.workspaceId $Step $ApprovalId | Out-String
    if (-not $output.Trim()) { throw "Probe returned no JSON at $Step" }
    return ($output | ConvertFrom-Json)
  } finally {
    $env:ELECTRON_RUN_AS_NODE = $previous
  }
}

function Get-FixtureNetwork([int] $DaemonPid) {
  netstat -ano -p tcp | ForEach-Object {
    if ($_ -match ('^\s*TCP\s+(\S+):\d+\s+(\S+):\d+\s+(\S+)\s+' + $DaemonPid + '\s*$')) {
      [pscustomobject]@{
        loopbackLocal = $Matches[1] -eq '127.0.0.1'
        loopbackOrWildcardPeer = $Matches[2] -in @('127.0.0.1', '0.0.0.0')
        state = $Matches[3]
      }
    }
  }
}

$env:PASEO_AGENT_ID = $null
New-Item -ItemType Directory -Path $fixture | Out-Null
Copy-Item -LiteralPath (Join-Path $poc 's00-t07/fixture/serve.cjs') -Destination $fixture
$script = @{ scripts = @{ preview = @{ type = 'service'; command = 'node serve.cjs'; port = 16801 } } }
$script | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $fixture 'paseo.json') -Encoding ascii
Invoke-FixtureGit @('init', '-b', 'main') | Out-Null
Invoke-FixtureGit @('add', '--', 'paseo.json', 'serve.cjs') | Out-Null
Invoke-FixtureGit @('commit', '-m', 'test: create disposable lifecycle fixture') | Out-Null
$headSha = Invoke-FixtureGit @('rev-parse', 'HEAD')
Invoke-FixtureGit @('branch', 'test/preserved') | Out-Null
'keep this fixture edit' | Set-Content (Join-Path $fixture 'sentinel.txt') -Encoding ascii

Invoke-Paseo @('daemon', 'config', 'set', 'daemon.listen', '127.0.0.1:16800') | Out-Null
Invoke-Paseo @('daemon', 'config', 'set', 'daemon.relay.enabled', 'false') | Out-Null
Invoke-Paseo @('daemon', 'config', 'set', 'pluginsEnabled', 'true') | Out-Null
try {
  Invoke-Paseo @('daemon', 'start') | Out-Null
  Invoke-Paseo @('plugin', 'install', (Join-Path $poc 's00-t02/plugin')) | Out-Null
  Invoke-Paseo @('plugin', 'install', (Join-Path $poc 's00-t07/plugin')) | Out-Null
  $workspace = Invoke-Paseo @('workspace', 'create', '--isolation', 'local', '--path', $fixture, '--json') |
    Out-String | ConvertFrom-Json
  if (!$workspace.workspaceId) { throw 'Workspace registration returned no ID.' }
  $prepared = Invoke-Probe 'prepare'
  if ($prepared.sha -ne $headSha) { throw 'Approval must bind to the fixture HEAD.' }
  if ((Invoke-Probe 'start-service').lifecycle -ne 'running') { throw 'Expected active fixture service.' }
  $beforePid = (Get-Content -Raw -LiteralPath (Join-Path $homePath 'paseo.pid') | ConvertFrom-Json).pid
  $networkBefore = @(Get-FixtureNetwork $beforePid)

  Invoke-Paseo @('daemon', 'stop') | Out-Null
  Invoke-Paseo @('daemon', 'start') | Out-Null
  $afterPid = (Get-Content -Raw -LiteralPath (Join-Path $homePath 'paseo.pid') | ConvertFrom-Json).pid
  if ($beforePid -eq $afterPid) { throw 'Expected a new daemon process.' }
  $networkAfter = @(Get-FixtureNetwork $afterPid)
  $restart = Invoke-Probe 'after-restart' $prepared.approvalId
  $status = (Invoke-Probe 'service').lifecycle
  if ($status -ne 'stopped') { throw "Unexpected post-restart service state: $status" }
  Write-Output ("restart: service=$status pendingApprovalRecovered=" + $restart.pendingApprovalRecovered)

  Invoke-Probe 'start-service' | Out-Null
  Invoke-Paseo @('plugin', 'disable', $t07) | Out-Null
  Invoke-Probe 'disabled' | ConvertTo-Json -Compress
  Invoke-Paseo @('plugin', 'remove', $t07) | Out-Null
  Invoke-Probe 'disabled' | ConvertTo-Json -Compress
  $plugins = Invoke-Paseo @('plugin', 'ls', 'zelqio-poc-t02', '--json') | Out-String
  if ($plugins -notmatch 'running') { throw 'The unrelated control plugin is no longer running.' }
  if ((Invoke-Probe 'service').lifecycle -ne 'running') { throw 'The standalone workspace service was interrupted.' }
  if ((Invoke-FixtureGit @('rev-parse', 'test/preserved')) -ne $headSha) { throw 'Fixture branch changed.' }
  if ((Invoke-FixtureGit @('status', '--porcelain')) -ne '?? sentinel.txt') { throw 'Fixture contents changed.' }
  Write-Output 'remove: control plugin, workspace service, fixture branch and untracked sentinel preserved'
  [pscustomobject]@{ tcpRowsBefore = $networkBefore; tcpRowsAfter = $networkAfter } | ConvertTo-Json -Depth 5 -Compress
} finally {
  Invoke-Paseo @('daemon', 'stop') | Out-Null
}
