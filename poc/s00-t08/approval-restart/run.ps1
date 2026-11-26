param(
  [Parameter(Mandatory)] [string] $Install,
  [Parameter(Mandatory)] [string] $Scratch,
  [ValidateRange(16820, 16829)] [int] $Port = 16820
)
# Disposable G0 experiment: pending approval durability across real daemon stop/start.
# Fresh daemon home, loopback port 16820-16829 only, relay disabled, synthetic Git fixture, no inference, no real effects.

$ErrorActionPreference = 'Stop'
$Scratch = [IO.Path]::GetFullPath($Scratch)
if (Test-Path -LiteralPath $Scratch) { throw 'Use a fresh scratch directory.' }
if (Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue) { throw 'Port is not free.' }
$homePath = Join-Path $Scratch 'daemon'
$fixture = Join-Path $Scratch 'fixture'
$storeDir = Join-Path $Scratch 'store'
$store = Join-Path $storeDir 'approvals.json'
$cli = Join-Path $Install 'resources/bin/paseo.cmd'
$exe = Join-Path $Install 'Paseo.exe'
$here = $PSScriptRoot
$callScript = Join-Path $here 'call.mjs'
$plugin = Join-Path $here 'plugin'
$results = New-Object System.Collections.Generic.List[object]

function Invoke-Paseo([string[]] $Arguments) {
  $output = & $cli @Arguments --home $homePath
  if ($LASTEXITCODE -ne 0) { throw ($output -join "`n") }
  return $output
}
function Invoke-FixtureGit([string[]] $Arguments, [string] $Repo = $fixture) {
  $output = & git -C $Repo -c user.name='POC Fixture' -c user.email='fixture@example.invalid' -c commit.gpgsign=false @Arguments
  if ($LASTEXITCODE -ne 0) { throw ($output -join "`n") }
  return $output
}
function Call([string] $Method, $Body) {
  $json = ($Body | ConvertTo-Json -Compress -Depth 6)
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
  $previous = $env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $out = & $exe $callScript $Install $Port $Method $b64 | Out-String
  } finally { $env:ELECTRON_RUN_AS_NODE = $previous }
  if (-not $out.Trim()) { throw "No JSON from $Method" }
  return ($out | ConvertFrom-Json)
}
function Check([string] $Name, [bool] $Pass, [string] $Detail = '') {
  $results.Add([pscustomobject]@{ check = $Name; pass = $Pass; detail = $Detail })
  Write-Output ("{0} {1} {2}" -f ($(if ($Pass) { 'PASS' } else { 'FAIL' }), $Name, $Detail))
}
function Shown($r) { @{ taskId = $r.taskId; action = $r.action; workspaceId = $r.workspaceId; sha = $r.sha; policyVersion = $r.policyVersion } }
function Find-Rec($list, [string] $id) { $list.output | Where-Object { $_.id -eq $id } | Select-Object -First 1 }
function Start-Daemon([string] $Policy) {
  $env:ZQ_G0_APPROVAL_STORE = $store
  if ($Policy) { $env:ZQ_G0_POLICY_VERSION = $Policy } else { Remove-Item Env:ZQ_G0_POLICY_VERSION -ErrorAction SilentlyContinue }
  Invoke-Paseo @('daemon', 'start') | Out-Null
  Get-Content -Raw -LiteralPath (Join-Path $homePath 'paseo.pid') | ConvertFrom-Json | ForEach-Object { $_.pid }
}
function Stop-Daemon { Invoke-Paseo @('daemon', 'stop') | Out-Null }
function Git-State { (@((Invoke-FixtureGit @('rev-parse', 'HEAD')), (Invoke-FixtureGit @('branch', '--list')), (Invoke-FixtureGit @('status', '--porcelain'))) | Out-String).Trim() }

New-Item -ItemType Directory -Path $fixture | Out-Null
'synthetic fixture' | Set-Content (Join-Path $fixture 'README.txt') -Encoding ascii
Invoke-FixtureGit @('init', '-b', 'main') | Out-Null
Invoke-FixtureGit @('add', '--', 'README.txt') | Out-Null
Invoke-FixtureGit @('commit', '-m', 'test: create disposable fixture') | Out-Null
$sha1 = (Invoke-FixtureGit @('rev-parse', 'HEAD')) -join ''
$secondFixture = Join-Path $Scratch 'second-fixture'
New-Item -ItemType Directory -Path $secondFixture | Out-Null
'second synthetic workspace' | Set-Content (Join-Path $secondFixture 'README.txt') -Encoding ascii
Invoke-FixtureGit @('init', '-b', 'main') $secondFixture | Out-Null
Invoke-FixtureGit @('add', '--', 'README.txt') $secondFixture | Out-Null
Invoke-FixtureGit @('commit', '-m', 'test: create second disposable fixture') $secondFixture | Out-Null
$secondSha = (Invoke-FixtureGit @('rev-parse', 'HEAD') $secondFixture) -join ''

$savedStore = $env:ZQ_G0_APPROVAL_STORE; $savedPolicy = $env:ZQ_G0_POLICY_VERSION
try {
  Invoke-Paseo @('daemon', 'config', 'set', 'daemon.listen', "127.0.0.1:$Port") | Out-Null
  Invoke-Paseo @('daemon', 'config', 'set', 'daemon.relay.enabled', 'false') | Out-Null
  Invoke-Paseo @('daemon', 'config', 'set', 'pluginsEnabled', 'true') | Out-Null
  $pid1 = Start-Daemon ''
  Invoke-Paseo @('plugin', 'install', $plugin) | Out-Null
  $ws = Invoke-Paseo @('workspace', 'create', '--isolation', 'local', '--path', $fixture, '--json') | Out-String | ConvertFrom-Json
  $wsId = $ws.workspaceId
  if (-not $wsId) { throw 'No workspace ID.' }

  # A. Before restart
  $first = Call 'g0.approval.request' @{ taskId = 'task-1'; action = 'merge-preview'; workspaceId = $wsId }
  Check 'A1 request creates pending bound to HEAD' ($first.ok -and $first.output.status -eq 'pending' -and $first.output.sha -eq $sha1 -and $first.output.policyVersion -eq 'policy-v1' -and -not $first.output.duplicate)
  $P = $first.output
  $dup = Call 'g0.approval.request' @{ taskId = 'task-1'; action = 'merge-preview'; workspaceId = $wsId }
  Check 'A2 duplicate request returns same pending, no new record' ($dup.ok -and $dup.output.id -eq $P.id -and $dup.output.duplicate -and (Call 'g0.approval.list' @{}).output.Count -eq 1)
  $c = Call 'g0.approval.consume' @{ id = $P.id; shown = (Shown $P) }
  Check 'A3 consume of pending is rejected' (-not $c.ok -and $c.error -match 'not approved: pending') $c.error
  $bad = Shown $P; $bad.sha = ('0' * 40)
  $d = Call 'g0.approval.decide' @{ id = $P.id; decision = 'approve'; shown = $bad }
  Check 'A4 decide with different SHA rejected, stays pending' (-not $d.ok -and $d.error -match 'shown values differ' -and (Find-Rec (Call 'g0.approval.list' @{}) $P.id).status -eq 'pending') $d.error
  $bad = Shown $P; $bad.action = 'push-main'
  $d = Call 'g0.approval.decide' @{ id = $P.id; decision = 'approve'; shown = $bad }
  Check 'A5 decide with different action rejected' (-not $d.ok -and $d.error -match 'shown values differ') $d.error
  $q = (Call 'g0.approval.request' @{ taskId = 'task-2'; action = 'merge-preview'; workspaceId = $wsId }).output
  $d = Call 'g0.approval.decide' @{ id = $q.id; decision = 'approve'; shown = (Shown $q) }
  Check 'A6 matching decide approves; record carries no actor identity' ($d.ok -and $d.output.status -eq 'approved' -and $d.output.identity.provenance -eq 'none')
  $secondWorkspace = Invoke-Paseo @('workspace', 'create', '--isolation', 'local', '--path', $secondFixture, '--json') | Out-String | ConvertFrom-Json
  $other = (Call 'g0.approval.request' @{ taskId = 'task-1'; action = 'merge-preview'; workspaceId = $secondWorkspace.workspaceId }).output
  $list = Call 'g0.approval.list' @{}
  Check 'A7 second workspace retains its own SHA and leaves first requests untouched' ($other.sha -eq $secondSha -and $other.sha -ne $P.sha -and (Find-Rec $list $P.id).status -eq 'pending' -and (Find-Rec $list $q.id).status -eq 'approved')
  $gitBefore = Git-State

  # Real stop/start
  Stop-Daemon
  $closed = -not (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  Check 'R1 daemon stopped, port closed' $closed
  $pid2 = Start-Daemon ''
  Check 'R2 daemon restarted as a new process' ($pid1 -ne $pid2)

  # B. After restart
  $list = Call 'g0.approval.list' @{}
  $P2 = Find-Rec $list $P.id; $Q2 = Find-Rec $list $q.id
  Check 'B1 pending retained unchanged (same id, SHA, policy, createdAt)' ($P2.status -eq 'pending' -and $P2.sha -eq $P.sha -and $P2.policyVersion -eq $P.policyVersion -and $P2.createdAt -eq $P.createdAt)
  Check 'B2 prior approved decision retained' ($Q2.status -eq 'approved')
  $c = Call 'g0.approval.consume' @{ id = $P.id; shown = (Shown $P) }
  Check 'B3 retained pending is not granted' (-not $c.ok -and $c.error -match 'not approved: pending') $c.error
  $dup = Call 'g0.approval.request' @{ taskId = 'task-1'; action = 'merge-preview'; workspaceId = $wsId }
  Check 'B4 retry after restart returns same pending, no new record' ($dup.ok -and $dup.output.id -eq $P.id -and $dup.output.duplicate)
  $c = Call 'g0.approval.consume' @{ id = $q.id; shown = (Shown $q) }
  Check 'B5 approved binding consumed once; identity still unverified, no effect' ($c.ok -and $c.output.bindingValid -and -not $c.output.identityVerified -and $c.output.effect -eq 'none')
  $c = Call 'g0.approval.consume' @{ id = $q.id; shown = (Shown $q) }
  Check 'B6 second consume (retry) rejected' (-not $c.ok -and $c.error -match 'not approved: consumed') $c.error
  $d = Call 'g0.approval.decide' @{ id = $q.id; decision = 'approve'; shown = (Shown $q) }
  Check 'B7 decide on consumed rejected' (-not $d.ok -and $d.error -match 'not pending: consumed') $d.error

  Check 'B8 no Git change from any approval operation (HEAD, branches, status)' ((Git-State) -eq $gitBefore)
  $otherRestored = Find-Rec (Call 'g0.approval.list' @{}) $other.id
  Check 'B9 second workspace still pending after restart' ($otherRestored.status -eq 'pending' -and $otherRestored.workspaceId -eq $secondWorkspace.workspaceId -and $otherRestored.sha -eq $secondSha)

  # C. SHA change
  'second' | Set-Content (Join-Path $fixture 'README.txt') -Encoding ascii
  Invoke-FixtureGit @('commit', '-a', '-m', 'test: advance fixture HEAD') | Out-Null
  $sha2 = (Invoke-FixtureGit @('rev-parse', 'HEAD')) -join ''
  $list = Call 'g0.approval.list' @{}
  $P3 = Find-Rec $list $P.id
  Check 'C1 pending becomes stale after SHA change' ($P3.status -eq 'stale' -and $P3.reason -eq 'sha')
  $d = Call 'g0.approval.decide' @{ id = $P.id; decision = 'approve'; shown = (Shown $P) }
  Check 'C2 decide on stale rejected' (-not $d.ok -and $d.error -match 'not pending: stale') $d.error
  $n = (Call 'g0.approval.request' @{ taskId = 'task-1'; action = 'merge-preview'; workspaceId = $wsId }).output
  Check 'C3 new request binds to new SHA with a new id' ($n.id -ne $P.id -and $n.sha -eq $sha2 -and $n.status -eq 'pending')
  $d = Call 'g0.approval.decide' @{ id = $n.id; decision = 'approve'; shown = (Shown $n) }
  'third' | Set-Content (Join-Path $fixture 'README.txt') -Encoding ascii
  Invoke-FixtureGit @('commit', '-a', '-m', 'test: advance fixture HEAD again') | Out-Null
  $sha3 = (Invoke-FixtureGit @('rev-parse', 'HEAD')) -join ''
  $c = Call 'g0.approval.consume' @{ id = $n.id; shown = (Shown $n) }
  Check 'C4 approved grant invalid after SHA change' ($d.ok -and -not $c.ok -and $c.error -match 'not approved: stale \(sha\)') $c.error
  $m = (Call 'g0.approval.request' @{ taskId = 'task-1'; action = 'merge-preview'; workspaceId = $wsId }).output

  # D. Policy change across restart
  Stop-Daemon
  $pid3 = Start-Daemon 'policy-v2'
  $list = Call 'g0.approval.list' @{}
  $M2 = Find-Rec $list $m.id
  Check 'D1 pending from policy-v1 is stale under policy-v2 after restart' ($M2.status -eq 'stale' -and $M2.reason -eq 'policy')
  $d = Call 'g0.approval.decide' @{ id = $m.id; decision = 'approve'; shown = (Shown $m) }
  Check 'D2 decide on policy-stale rejected' (-not $d.ok -and $d.error -match 'not pending: stale') $d.error
  $k = (Call 'g0.approval.request' @{ taskId = 'task-1'; action = 'merge-preview'; workspaceId = $wsId }).output
  Check 'D3 new request binds to policy-v2' ($k.id -ne $m.id -and $k.policyVersion -eq 'policy-v2' -and $k.sha -eq $sha3)
  $d = Call 'g0.approval.decide' @{ id = $k.id; decision = 'approve'; shown = (Shown $m) }
  Check 'D4 decide showing the old policy rejected' (-not $d.ok -and $d.error -match 'shown values differ') $d.error

  # E. Tamper, then corrupt store (daemon stopped while editing)
  Stop-Daemon
  $doc = Get-Content -Raw -LiteralPath $store | ConvertFrom-Json
  $doc.approvals.($k.id).status = 'approved'
  ($doc | ConvertTo-Json -Depth 10 -Compress) | Set-Content -LiteralPath $store -Encoding ascii
  $pid4 = Start-Daemon 'policy-v2'
  $c = Call 'g0.approval.consume' @{ id = $k.id; shown = (Shown $k) }
  Check 'E1 naive edit of status without reseal is rejected (integrity)' (-not $c.ok -and $c.error -match 'invalid \(integrity\)') $c.error
  Stop-Daemon
  'not json' | Set-Content -LiteralPath $store -Encoding ascii
  $pid5 = Start-Daemon 'policy-v2'
  $r1 = Call 'g0.approval.request' @{ taskId = 'task-9'; action = 'merge-preview'; workspaceId = $wsId }
  $r2 = Call 'g0.approval.list' @{}
  $r3 = Call 'g0.approval.decide' @{ id = $k.id; decision = 'approve'; shown = (Shown $k) }
  $r4 = Call 'g0.approval.consume' @{ id = $k.id; shown = (Shown $k) }
  $allClosed = (-not $r1.ok) -and (-not $r2.ok) -and (-not $r3.ok) -and (-not $r4.ok) -and ($r1.error -match 'failing closed')
  Check 'E2 corrupt store: every RPC fails closed and store is not silently reset' ($allClosed -and (Get-Content -Raw -LiteralPath $store).Trim() -eq 'not json')

  # F. No real effects
  $gitAfter = Git-State
  Check 'F1 fixture refs/status: only the two deliberate commits, no other branch or change' ($gitAfter -match [regex]::Escape($sha3) -and $gitAfter -notmatch '\?\?' -and ((Invoke-FixtureGit @('branch', '--list')) -join '') -match '^\* main$')
  $leftovers = @(Get-ChildItem -LiteralPath $storeDir | Where-Object { $_.Name -ne 'approvals.json' })
  Check 'F2 no stray temp files beside the store' ($leftovers.Count -eq 0)
} finally {
  try { Stop-Daemon } catch {}
  if ($null -eq $savedStore) { Remove-Item Env:ZQ_G0_APPROVAL_STORE -ErrorAction SilentlyContinue } else { $env:ZQ_G0_APPROVAL_STORE = $savedStore }
  if ($null -eq $savedPolicy) { Remove-Item Env:ZQ_G0_POLICY_VERSION -ErrorAction SilentlyContinue } else { $env:ZQ_G0_POLICY_VERSION = $savedPolicy }
}
$stopped = -not (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
Check 'Z1 isolated daemon stopped at end' $stopped
$failed = @($results | Where-Object { -not $_.pass })
Write-Output ("TOTAL {0} checks, {1} failed" -f $results.Count, $failed.Count)
$results | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $Scratch 'results.json') -Encoding ascii
if ($failed.Count) { exit 1 }
