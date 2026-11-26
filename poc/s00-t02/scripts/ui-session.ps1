# Disposable POC (S00-T02): start a FRESH headless Chrome (own empty profile) on the web build of the app,
# connect it ONLY to the isolated daemon, and open the New workspace screen.
# Parameters: -Sandbox <dir> -ListenPort <isolated daemon port> -AppPort <static server port> -CdpPort <chrome debug port>
param(
  [Parameter(Mandatory)] [string] $Sandbox,
  [int] $ListenPort = 16772,
  [int] $AppPort = 16773,
  [int] $CdpPort = 9334,
  [string] $Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$profileDir = Join-Path $Sandbox "chrome-profile"
# Stop only the Chrome that uses OUR profile directory.
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*$profileDir*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep 2
Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue
# The resolver rule makes the app's built-in default host (localhost:6767, the regular daemon) unresolvable.
$chromeArgs = @('--headless=new', "--remote-debugging-port=$CdpPort", "--user-data-dir=$profileDir", '"--host-resolver-rules=MAP localhost ~NOTFOUND"', '--window-size=1400,900', '--no-first-run', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', 'about:blank')
Start-Process -FilePath $Chrome -ArgumentList $chromeArgs -WindowStyle Hidden
Start-Sleep 4
$cdp = Join-Path $here "cdp.mjs"
node $cdp $CdpPort nav "http://127.0.0.1:$AppPort/"; Start-Sleep 8
node $cdp $CdpPort click "Direct connection"; Start-Sleep 2
node $cdp $CdpPort eval "(() => { const i=document.querySelectorAll('input'); i[0].focus(); return document.activeElement===i[0] })()"
node $cdp $CdpPort type "127.0.0.1"
node $cdp $CdpPort eval "(() => { const i=document.querySelectorAll('input'); i[1].focus(); i[1].select(); return document.activeElement===i[1] })()"
node $cdp $CdpPort type "$ListenPort"
node $cdp $CdpPort eval "[...document.querySelectorAll('input')].map(x=>x.value).join(',')"
node $cdp $CdpPort click "Connect"; Start-Sleep 10
node $cdp $CdpPort click "New workspace"; Start-Sleep 8
node $cdp $CdpPort eval "document.body.innerText.split('\n').filter(l=>/Orchestration|Disabled|Automatic|Select model|Plan|Build|MiMo|Lightning/i.test(l)).join(' | ')"
