# S11-T06 · Delegación en un daemon Paseo aislado

Prueba en Windows con Node.js 24.21.0, el SDK de desarrollo de plugins 0.17.4 y los paquetes del daemon, cliente y CLI de Paseo 0.17.6 y 0.17.5. La rama del ensayo parte de `c09cc30`. Se aplicaron a la copia de trabajo los cinco archivos de delegación del commit local `923156b` (PR #70) para probar la implementación que describe S11-T06. La base con esos archivos pasó `npm.cmd run check` con 427 pruebas en 38 archivos.

## Reproducción

Desde la raíz del worktree, con los paquetes de Paseo instalados en `<sandbox>/v0.17.6/node_modules` y `<sandbox>/v0.17.5/node_modules`, y permiso de escritura en `<sandbox>/home-deleg`.

```powershell
$delegSandbox = '<sandbox>'
$delegRun = 'run-deleg-' + [guid]::NewGuid().ToString('N')
$git = (Get-Command git.exe).Source
if (!(Test-Path node_modules)) {
  Copy-Item -LiteralPath '<checkout-preparado>/node_modules' -Destination ./node_modules -Recurse -Force
}
node poc/e2e/delegation.mjs $delegSandbox $delegRun $git 0.17.6
$delegRun = 'run-deleg-compat-' + [guid]::NewGuid().ToString('N')
node poc/e2e/delegation.mjs $delegSandbox $delegRun $git 0.17.5
$delegRun = 'run-deleg-regression-' + [guid]::NewGuid().ToString('N')
node poc/e2e/run.mjs $delegSandbox $delegRun $git 0.17.6 --delegation-isolation
npm.cmd run check
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler poc/e2e/fixture/index.server.ts
```

Para seleccionar escenarios, añadir sus IDs al comando y usar un identificador nuevo. El runner imprime el veredicto y los milisegundos por escenario. Las trazas sintéticas quedan bajo `<sandbox>/home-deleg/<run-id>/fixture`. El arnés comprueba con `netstat` el PID del listener habitual en el puerto 6767 antes y después. Inicia su propio daemon en loopback, en un puerto libre entre 16801 y 16810, y lo detiene en `finally`.

## Transporte de las herramientas

`timeline.item` con `tool_call` en la API de proveedores representa actividad para mostrar en el transcript. El fixture usa la URL HTTP del servidor MCP `paseo` entregada en `session.open.config.mcpServers`, acotada al loopback y puerto de esta corrida. Envía `tools/list` y `tools/call` con el protocolo MCP 2025-06-18. El daemon usa el llamante de la sesión para resolver los tools registrados por `agent.open.before` y ejecutar su handler. El fixture invoca únicamente tools `zelqio_*`; el daemon crea los hijos por la API nativa desde Zelqio.

## Escenarios

| Comando (argumento) | Paseo 0.17.6 | Paseo 0.17.5 | Observación |
| --- | --- | --- | --- |
| `D1` | PASS (1,224 s) | PASS (1,232 s) | MCP listó cuatro tools para el coordinador y para Automatic, cero para el hijo y para el agente ordinario. La guía siguió el mismo criterio. |
| `D2` | PASS (4,013 s) | PASS (4,219 s) | Cuatro hijos nativos con el mismo `ParentAgentId` y modelo `fixture-a/fixture-a-model`. El segundo escritor y el dependiente estaban en cola hasta la entrega del primero. |
| `D3` | PASS (0,014 s de comprobación) | PASS (0,012 s de comprobación) | `zelqio_wait` devolvió cuatro entregas con los mismos IDs de `zelqio_status`. El coordinador recibió un informe y terminó en el segundo turno. D1–D3 comparten ejecución y el trabajo de D3 ya había terminado durante D2. |
| `D4` | PASS (3,356 s) | PASS (3,380 s) | Solo el hijo que recibió `usage_limit_exceeded` tuvo dos intentos, uno en cada proveedor. El otro hijo entregó en su único intento. El reemplazo retuvo el padre nativo. |
| `D5` | PASS (3,324 s) | PASS (3,245 s) | Ocho delegaciones entregaron en un intento cada una. El noveno encargo y el argumento `provider` se rechazaron. Ningún hijo recibió tools de delegación. |
| `D6` | PASS (1,654 s) | PASS (1,712 s) | `zelqio_cancel` detuvo un hijo. `runs.cancel` detuvo otro hijo que seguía activo y canceló un escritor en cola que nunca arrancó. El fixture observó la detención de los dos turnos nativos. |
| `D7` | PASS (14,942 s) | PASS (13,999 s) | El primer RPC `zelqio.runs.list` recuperó el estado. Tras recuperar cuota se restauró la sesión, se reanudó el mismo hijo una sola vez y el coordinador recibió un informe. El tiempo incluye el reinicio. |

Las corridas completas `run-deleg-real-35d206aa` y `run-deleg-compat-5c30bbc1` salieron con código 0. Paseo 0.17.6 pasó de PID 27876 a 23156 al reiniciar. Paseo 0.17.5 pasó de PID 34360 a 9004. Ambas corridas liberaron su listener de 16802 y confirmaron que el habitual conservaba el PID 26612. Las temporizaciones del arnés fueron 1000 ms para `ZELQIO_TICK_MS`, 500 ms para `ZELQIO_RECHECK_MS` y 1000 ms para `ZELQIO_DEFAULT_WAIT_MS`.

La regresión `run-deleg-sreg-06110777` pasó S1–S8 en 0.17.6 y salió con código 0. Tiempos en orden de ejecución de 1,003 s, 1,413 s, 92,375 s, 1,368 s, 2,046 s, 93,134 s, 94,237 s y 2,119 s. La corrida liberó 16801 y confirmó el mismo PID habitual.

## Hallazgos en el código

- Cancelar un hijo solo marcaba su fila como `cancelled`. Un escritor nativo podía continuar después de que el planificador liberara su plaza. El adaptador usa `agents.ref(id).reload()`, la operación del SDK de plugins que interrumpe el turno activo y vuelve a abrir la sesión. El gestor cancela la fila y libera la reserva del intento después del acuse del host. La regresión simula un fallo de la detención y comprueba que el segundo escritor permanece en cola hasta que se puede detener al primero.
- El envío del informe guardaba un marcador `resume` antes de recibir el acuse. Si fallaba el envío, el reintento enviaba el texto de recuperación de cuota. El marcador `report` conserva un ID estable y reenvía el mismo informe. El gestor reconoce el marcador anterior con sufijo `-c`. La regresión comprueba el texto, el ID y el único envío aceptado.
- El gestor trataba cualquier coordinador `closed` como perdido. Cuando Paseo conserva la sesión y el informe sigue pendiente, el coordinador espera a sus hijos y se restaura cuando el gestor le envía el informe. La regresión simula el cierre restaurable.
- `zelqio_status` y `zelqio_wait` entregaban un array directo, que Paseo normalizaba en MCP como `structuredContent.result`. Los dos tools devuelven ahora un objeto explícito con `children`. El fixture compara los IDs de ambas respuestas y comprueba los estados y resultados finales.

La primera corrida agotó el tiempo de arranque antes de que el runner pudiera comprobar el puerto. La limpieza inicial también agotó el tiempo. Se confirmó después la detención del supervisor de ese home con el CLI del sandbox y el PID del listener habitual siguió en 26612. El arnés amplía los plazos de arranque y parada en `home-deleg` y dispone de parada forzada por ese home después de un fallo de parada normal.

Los dos daemons siguientes arrancaron en los puertos 16802 y 16801. Paseo rechazó la instalación del fixture por la ubicación del módulo auxiliar de MCP. Su constructor exige que esté bajo `server/`, `client/` o `shared/`. Se movió a `fixture/server/` y ambos intentos anteriores confirmaron el mismo PID habitual y sus puertos aislados liberados.

La primera ejecución de D1 confirmó que Paseo 0.17.6 desactiva por defecto `daemon.mcp.injectIntoAgents`. El hook entregó la guía, pero el proveedor sintético quedó sin servidor MCP. El arnés habilita esa opción solo en el home de la prueba de delegación. El producto deja la configuración del daemon en manos del propietario.

El contador inicial de la duración de los casos PASS se evaluaba antes del escenario. Se corrigió el runner para medir después de esperar su resultado. La tabla registra las corridas completas posteriores.

`npm.cmd run check` pasó con 431 pruebas en 38 archivos. El fixture pasó también la verificación independiente con TypeScript.

## Límites

Los dos proveedores y sus cuotas son sintéticos. La prueba cubre Windows por el SDK de proveedores y MCP HTTP. Los proveedores comerciales, sus mecanismos nativos de subagentes, la interfaz Desktop y la escritura simultánea en worktrees requieren validación separada. D2 comprueba los estados del planificador y del daemon mediante gates del fixture. D7 deja el coordinador en reposo durante el reinicio y simula una cuota sin fecha de restablecimiento.

## Punto de recuperación

D1–D7 en ambas versiones, S1–S8 en 0.17.6, las correcciones y `npm.cmd run check` están completos. Los cambios quedan sin commit en el worktree.
