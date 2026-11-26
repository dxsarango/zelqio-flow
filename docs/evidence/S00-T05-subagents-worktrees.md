# S00-T05 — Subagentes y worktrees

**Avance.** Pruebas terminadas y daemon aislado detenido. POC-07 PASS en la configuración probada. POC-08 FAIL por pérdida de cambios sin confirmar al archivar.

Windows, PowerShell 5.1.26100.9818, Git 2.50.1.windows.1, Paseo CLI y daemon 0.17.4, Node 24.20.0 integrado. Fuentes locales de interfaz: `@getpaseo/client`, `@getpaseo/server` y `@getpaseo/cli` distribuidos en `app.asar`, consultados con Electron como Node. Los veredictos se basan en ejecuciones.

Daemon de prueba en `<sandbox>/home-t05`, `127.0.0.1:16790`, relay desactivado. Frontend de la misma instalación servido en `16791`, Chrome headless con perfil nuevo y CDP en `16792`. La configuración del daemon de prueba añadió el origen web local del POC. Se clonó el remoto bare local en `<sandbox>/t05-fixture`. Los worktrees del fixture se registraron bajo el home aislado. El daemon habitual y su home quedaron fuera de las comprobaciones. La sonda no contiene telemetría ni dependencias nuevas.

## POC-07

| Comprobación | Estado | Evidencia |
|---|---|---|
| Crear hijo desde plugin servidor | PASS | `paseo.agents.create({cwd, workspaceId, callerAgentId, config})` creó `T05 plugin probe` sin prompt inicial. `agent inspect` devolvió `ParentAgentId: <root>`. |
| Crear hijo en el mismo workspace desde el cliente servidor | PASS | `createHostClient(...).createAgent({cwd, workspaceId, callerAgentId, config})` devolvió `T05 same` en `<local>` con `labels["paseo.parent-agent-id"] = <root>` y `metadata: {}`. |
| Crear hijo en otro workspace | PASS | El mismo método con `workspaceId: <worktree-a>` y su cwd devolvió `T05 cross`. El hijo conservó el mismo padre y se ejecutó en el checkout A. |
| Visibilidad de la relación | PASS | Frontend nativo de Paseo 0.17.4: en `main`, la raíz mostró `3 subagents`. El panel `subagents-track-header-panel` listó `T05 same`, `T05 cross` y `T05 plugin probe`. |
| Distinguir los agentes Paseo del registro de subagentes del proveedor | PASS | `listProviderSubagents(<root>)` devolvió `subagents: []` mientras el frontend mostraba los tres agentes Paseo. Los hijos de Paseo se recuperan de las sesiones y su parent label nativo. |
| Recoger respuesta | PASS | `agent send <same> "Reply OK"` devolvió `completed`; `fetchAgentTimeline(<same>)` devolvió `agent.status: idle` y un `assistant_message` con texto `OK`. |
| Cancelar al hijo | PASS | En el hijo de plugin, `sendAgentMessage("Reply OK")`, lectura de timeline, `cancelAgent`, nueva lectura. Transición observada `running → idle`; el último turno quedó con el mensaje de usuario y sin respuesta del asistente en esa captura. |
| Permiso nativo del hijo | PASS | El hijo cross generó `permit ls: {agentId: <cross>, name: "bash", description: "Scope: echo OK"}`. `permit deny <cross> <request>` devolvió `denied`; lista posterior vacía y timeline con `tool_call.status: failed` y `The user rejected permission to use this specific tool call.` Se usó Plan y el snapshot marcó `auto_accept: false`. |
| Persistencia y archivado | PASS | Tras archivar el hijo del plugin, `agent inspect` conservó `ParentAgentId` y devolvió `Archived: true`. Tras reiniciar, los tres hijos conservaban el padre. Archivar el workspace A archivó `T05 cross` conservando su padre. Al final, el carril activo mostró únicamente `T05 same` y `1 subagent`. |
| Aprobar un permiso del hijo | NOT RUN | Se probó la respuesta manual de denegación. |
| Permisos de hijos en Claude y Codex | NOT RUN | Las pruebas activas usaron OpenCode Iceman Free. |

La relación la deriva el daemon de `callerAgentId`. El plugin y el cliente enviaron ese campo sin escribir etiquetas de parentesco. Paseo proyectó su etiqueta reservada como `ParentAgentId` en la CLI y la usó en su carril de subagentes. `workspaceId` selecciona el checkout independientemente del padre. El vínculo es topología, según los límites de identidad de S00-T04. Si una versión o modo pierde la relación, los resultados, la cancelación o los permisos supervisados, POC-07 bloquea la experiencia prometida.

## POC-08

| Comprobación | Estado | Evidencia |
|---|---|---|
| Branch-off desde SHA exacto | PASS | Se resolvió el HEAD del clon a `967b615d6c34dad2b2ebe99001023980e51138f8` y se pasó literalmente a `--base` para A y B. Ambos `git rev-parse HEAD` devolvieron ese SHA antes de editar. El registro persistido `<home>/projects/workspaces.json` guardó el SHA literal en `baseBranch` para ambos IDs. |
| Mismo repositorio | PASS | `git rev-parse --path-format=absolute --git-common-dir` devolvió `<sandbox>/t05-fixture/.git` desde el clon, A y B. |
| Checkouts separados | PASS | Tras escribir `a.ts` en ambos, el clon conservó `export const a = 1;`, A leyó `a-edit` y B `b-edit`. Solo A y B mostraron ` M a.ts`. |
| Workspace padre/hijo nativo | PASS | A, creado sin caller, quedó sin `parentWorkspaceId`. B, creado con `PASEO_AGENT_ID=<root>`, persistió `parentWorkspaceId=<local>` en `projects/workspaces.json`. Ambos son worktrees del mismo proyecto. |
| Ubicación administrada | PASS | Ambos cwd devueltos por la CLI estaban en `<sandbox>/home-t05/worktrees/<project>/` y figuraban como tales en el listado Git del fixture. |
| Archivado limpio y rama con commit | PASS | A estaba limpio. `workspace archive <worktree-a>` devolvió `archived` y eliminó su checkout. Se conservaron B, el clon y `refs/heads/poc/t05-a` en `3926e640615cce883692d49f09414854ecfe2f40`. |
| Archivado con cambios sin confirmar | FAIL | B tenía ` M a.ts` y `?? untracked-t05.txt`. El comando devolvió `archived` y eliminó el checkout y ambos archivos de trabajo. La rama B quedó en el SHA base, `git stash list` quedó vacío y `git worktree list --porcelain` solo mostró el clon limpio en `main`. |

**Decisión para G0.** POC-08 queda en FAIL bajo el requisito de teardown seguro. Aplicar la alternativa de TECHNICAL-FEASIBILITY, ejecución secuencial hasta un rediseño aprobado. El archivado nativo de 0.17.4 no aplica la protección contra eliminar cambios sin confirmar que exige GIT-POLICY. `baseBranch` es la referencia persistida elegida, que en este ensayo fue un SHA literal. `git rev-parse HEAD` confirma el punto de partida antes de que el worker confirme cambios.

## Reproducción y comandos ejecutados

PowerShell. Resolver `<paseo-install>`, `<sandbox>` y `<repo>` antes de ejecutar. Usar un home y clon nuevos para cada ensayo. La CLI 0.17.4 rechazó combinar `--home` y `--host` con `TARGET_AMBIGUOUS`. La receta usa `--home` para la CLI y loopback fijo para el cliente. La clave válida fue `daemon.relay.enabled` tras un intento con `relay.enabled`.

```powershell
$I = '<paseo-install>'
$S = '<sandbox>'
$Source = '<repo>'
$P = Join-Path $I 'resources/bin/paseo.cmd'
$H = Join-Path $S 'home-t05'
$R = Join-Path $S 't05-fixture'
$D = Join-Path $Source 'poc/s00-t05/driver.mjs'
$Plugin = Join-Path $Source 'poc/s00-t05/plugin'
Remove-Item Env:PASEO_AGENT_ID -ErrorAction SilentlyContinue
& $P --version
git clone --no-local (Join-Path $S 'fixtures/remote.git') $R
$sha = git -C $R rev-parse HEAD
& $P daemon config set --home $H daemon.listen 127.0.0.1:16790
& $P daemon config set --home $H pluginsEnabled true
& $P daemon config set --home $H daemon.relay.enabled false
& $P daemon start --home $H
& $P daemon status --home $H
& $P provider models opencode --home $H --json
& $P plugin install $Plugin --home $H
# La primera instalación requirió corregir el callback de limpieza antes de recargar.
& $P plugin reload zf-poc-t05 --home $H

$L = & $P workspace create --home $H --isolation local --path $R --json | Out-String | ConvertFrom-Json
$A = & $P workspace create --home $H --isolation worktree --path $R --mode branch-off --new-branch poc/t05-a --base $sha --json | Out-String | ConvertFrom-Json
$env:ELECTRON_RUN_AS_NODE = '1'
function Invoke-T05 { & "$I/Paseo.exe" $D @args | Out-String | ConvertFrom-Json }
$root = (Invoke-T05 create $R $L.workspaceId 'T05 root').id
$same = (Invoke-T05 create $R $L.workspaceId 'T05 same' $root).id
$cross = (Invoke-T05 create $A.cwd $A.workspaceId 'T05 cross' $root).id
$pluginChild = (Invoke-T05 plugin $R $L.workspaceId $root).id
Invoke-T05 provider-subagents $root
& $P agent inspect $pluginChild --home $H --json
$env:PASEO_AGENT_ID = $root
try {
  $B = & $P workspace create --home $H --isolation worktree --path $R --mode branch-off --new-branch poc/t05-b --base $sha --json | Out-String | ConvertFrom-Json
} finally {
  Remove-Item Env:PASEO_AGENT_ID
}
Get-Content "$H/projects/workspaces.json" -Raw | ConvertFrom-Json |
  Select-Object workspaceId, kind, baseBranch, parentWorkspaceId
& $P workspace ls --home $H --json

& $P agent send $same 'Reply OK' --home $H --json
Invoke-T05 timeline $same
& $P agent send $cross 'Call the bash tool once with this read-only command: echo OK. Then reply OK.' --no-wait --home $H --json
& $P permit ls --home $H --json
# Cuando aparezca el permiso bash de $cross, copiar su ID en $request.
& $P permit deny $cross $request --home $H --json
& $P permit ls --home $H --json
Invoke-T05 timeline $cross
Invoke-T05 cancel $pluginChild
```

La reproducción de UI reutiliza `poc/s00-t02/scripts/serve-app.mjs` y `cdp.mjs`. Servir `<paseo-install>/resources/app-dist` en `16791` y lanzar Chrome headless con `--remote-debugging-port=16792`, un `--user-data-dir` nuevo en el sandbox y `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"`. En PowerShell 5.1:

```powershell
& $P daemon config set --home $H daemon.cors.allowedOrigins '[\"http://127.0.0.1:16791\"]'
$CDP = Join-Path $Source 'poc/s00-t02/scripts/cdp.mjs'
node $CDP 16792 nav 'http://127.0.0.1:16791/' '127.0.0.1:16790'
```

En Direct connection, introducir host `127.0.0.1` y puerto `16790`. Abrir `main` y desplegar `3 subagents`. En la ejecución se usaron `cdp.mjs click`, `type` y `eval` para leer los nombres y los atributos `data-testid` del DOM. Un origen web sin habilitar devolvió cierre 1006, con `Rejected connection from origin` en el log aislado. La primera llamada que intentó cancelar por CLI, `agent stop <cross>`, encontró un hijo ya inactivo y devolvió `stoppedCount: 0`. El cliente de la receta sí observó `running → idle`.

```powershell
foreach ($cwd in @($R, $A.cwd, $B.cwd)) {
  git -C $cwd rev-parse --path-format=absolute --git-common-dir
  git -C $cwd rev-parse HEAD
}
'a-edit' | Set-Content "$($A.cwd)/a.ts" -Encoding ascii
'b-edit' | Set-Content "$($B.cwd)/a.ts" -Encoding ascii
foreach ($cwd in @($R, $A.cwd, $B.cwd)) {
  Get-Content "$cwd/a.ts"
  git -C $cwd status --porcelain
}
git -C $A.cwd -c user.name='POC Fixture' -c user.email='<fixture-email>' -c commit.gpgsign=false commit -am 'test: preserve fixture branch'
'dirty-sentinel' | Set-Content "$($B.cwd)/untracked-t05.txt" -Encoding ascii
git -C $R worktree list --porcelain

& $P agent archive $pluginChild --home $H --json
& $P agent inspect $pluginChild --home $H --json
& $P daemon stop --home $H
& $P daemon start --home $H
foreach ($agent in @($pluginChild, $same, $cross)) {
  & $P agent inspect $agent --home $H --json
}

git -C $A.cwd status --porcelain
& $P workspace archive $A.workspaceId --home $H --json
Test-Path $A.cwd
Test-Path $B.cwd
Test-Path $R
git -C $R rev-parse refs/heads/poc/t05-a
& $P agent inspect $cross --home $H --json

# Prueba destructiva en el worktree B desechable.
git -C $B.cwd status --porcelain
& $P workspace archive $B.workspaceId --home $H --json
Test-Path $B.cwd
Test-Path "$($B.cwd)/a.ts"
Test-Path "$($B.cwd)/untracked-t05.txt"
git -C $R worktree list --porcelain
git -C $R for-each-ref --format='%(refname:short) %(objectname)' refs/heads
git -C $R status --porcelain
git -C $R stash list
& $P daemon stop --home $H
& $P daemon status --home $H
```

Detener también el servidor estático y Chrome del POC. El estado final observado fue `localDaemon: stopped`. Las ramas de prueba quedaron en el clon local.

## Inferencia y límites

Se enviaron seis turnos al modelo OpenCode Iceman Free, incluido el turno interrumpido. El log registra los intentos adicionales para provocar un permiso y cancelar. Cero envíos a Claude y Codex, cero créditos pagados y cero aprobaciones automáticas. [Registro](../../poc/s00-t05/results/inference-log.txt).

El archivado y reinicio se comprobaron con agentes ya inactivos. Quedan fuera la recuperación de turnos activos tras reinicio, la aprobación positiva, otros proveedores y otros sistemas operativos. El archivado sucio se probó con una edición en un archivo rastreado y un archivo sin seguimiento en un worktree del fixture.

## Continuidad observada al retomar G0

Al consultar las sesiones existentes, el orquestador anterior ya figuraba archivado. Dos sesiones cerradas de otros workspaces seguían disponibles y conservaban sus etiquetas de tarea S00-T03 y S00-T05. Su etiqueta de padre nativo había desaparecido. Se consultó el estado sin ejecutar archivado ni eliminar worktrees durante esta comprobación.

Las etiquetas ayudan a localizar una sesión, pero su ausencia o modificación debe tolerarse. El vínculo autoritativo propuesto es un registro local que conserva el ID estable de ejecución, el ID de tarea, el intento, el agente y la época de coordinación. La prueba de sucesión, exclusión de la época anterior y conciliación de resultados tardíos forma parte de S05-T04.
