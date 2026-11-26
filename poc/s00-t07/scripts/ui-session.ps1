# Disposable POC (S00-T07): fresh headless Chrome (own empty profile) on the web build, connected ONLY to the isolated daemon.
# Reuses the T02 helpers (serve-app.mjs, cdp.mjs) unchanged. Ports must stay in 16780-16789.
param(
  [Parameter(Mandatory)] [string] $Scratch,
  [int] $ListenPort = 16780, [int] $AppPort = 16783, [int] $CdpPort = 16784,
  [string] $Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)
$cdp = Join-Path $PSScriptRoot "..\..\s00-t02\scripts\cdp.mjs"
$profileDir = Join-Path $Scratch "chrome-profile-$([guid]::NewGuid())"
$existing = Get-NetTCPConnection -State Listen -LocalPort $CdpPort -ErrorAction SilentlyContinue
if ($existing) { throw "CDP port $CdpPort is in use. Choose a free port in the isolated range." }
$a = @('--headless=new', "--remote-debugging-port=$CdpPort", "--user-data-dir=$profileDir", '"--host-resolver-rules=MAP localhost ~NOTFOUND"', '--window-size=1400,900', '--no-first-run', 'about:blank')
Start-Process -FilePath $Chrome -ArgumentList $a -WindowStyle Hidden; Start-Sleep 4
node $cdp $CdpPort nav "http://127.0.0.1:$AppPort/"; Start-Sleep 8
node $cdp $CdpPort click "Direct connection"; Start-Sleep 2
node $cdp $CdpPort eval "(() => { const i=document.querySelectorAll('input'); i[0].focus(); return document.activeElement===i[0] })()"
node $cdp $CdpPort type "127.0.0.1"
node $cdp $CdpPort eval "(() => { const i=document.querySelectorAll('input'); i[1].focus(); i[1].select(); return document.activeElement===i[1] })()"
node $cdp $CdpPort type "$ListenPort"
node $cdp $CdpPort click "Connect"; Start-Sleep 10
node $cdp $CdpPort eval "document.body.innerText.slice(0,400)"
