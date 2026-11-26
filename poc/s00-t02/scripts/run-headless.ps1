# Disposable POC (S00-T02): runs the daemon-side scenarios (POC-02) against the ISOLATED daemon and prints the
# driver output plus the plugin trace. Only OpenCode free models receive a prompt (one trivial "Reply OK").
# Parameters: -Install <paseo install dir> -Sandbox <sandbox dir> -Port <isolated daemon port>
param(
  [Parameter(Mandatory)] [string] $Install,
  [Parameter(Mandatory)] [string] $Sandbox,
  [int] $Port = 16772
)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cli = Join-Path $Install "resources\bin\paseo.cmd"
$home_ = Join-Path $Sandbox "home-t02"
$fixture = Join-Path $Sandbox "fixtures\app"
$driver = Join-Path $here "driver.mjs"
$env:ELECTRON_RUN_AS_NODE = "1"
foreach ($s in 'normal', 'optin_applied', 'optin_rewrite', 'optin_manual', 'fail_closed', 'bad_decision', 'workspace', 'first_prompt') {
  "=== scenario: $s"
  # Paseo.exe is a GUI-subsystem binary: PowerShell only waits for it (and captures stdout) when its output is piped.
  & (Join-Path $Install "Paseo.exe") $driver $Install "127.0.0.1:$Port" $fixture $s 2>&1 | Out-String
}
Remove-Item Env:ELECTRON_RUN_AS_NODE
"=== agents (provider/model as stored)"
& $cli ls --home $home_ 2>&1
"=== plugin trace (ZQT lines)"
& $cli plugin logs zelqio-poc-t02 --home $home_ 2>&1 | Select-String "ZQT"
