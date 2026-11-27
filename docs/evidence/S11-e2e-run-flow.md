# S11 · Flujo de orquestación en un daemon Paseo aislado

Base del worktree `c3dbbce7ad91a311cb499bee3414fce2664c01ef`. Prueba en Windows con Node 24.21.0 y los paquetes de Paseo disponibles sin conexión.

## Reproducción

Desde la raíz del worktree, ejecutar en PowerShell. Sustituir `<sandbox>` por el directorio preparado con `v0.17.6/node_modules` y `v0.17.5/node_modules`. El runner necesita permiso de escritura en `<sandbox>/home-e2e` y un puerto libre entre 16791 y 16800. Si faltan dependencias locales, sustituir `<checkout-preparado>` por el checkout con la instalación de este repositorio.

```powershell
$sandbox = '<sandbox>'
$git = (Get-Command git.exe).Source
if (!(Test-Path node_modules)) {
  Copy-Item -LiteralPath '<checkout-preparado>/node_modules' -Destination ./node_modules -Recurse -Force
}
$run = 'run-e2e-' + [guid]::NewGuid().ToString('N')
node poc/e2e/run.mjs $sandbox $run $git 0.17.6
$run = 'run-e2e-' + [guid]::NewGuid().ToString('N')
node poc/e2e/run.mjs $sandbox $run $git 0.17.5 S1 S2 S3
npm.cmd run check
```

Para ejecutar un caso aislado, añadir su ID al final del comando con un home nuevo. El runner emite una línea JSON por escenario con veredicto y duración. El directorio `<sandbox>/home-e2e/<run-id>/fixture` guarda la traza de los proveedores y hooks, y `zelqio-state` guarda el estado observado tras el cierre.

## Escenarios

| Argumento y escenario | Paseo 0.17.6 | Paseo 0.17.5 | Observación |
| --- | --- | --- | --- |
| `S1` · Entrega | PASS (0,885 s) | PASS (0,915 s) | Zelqio creó un agente nativo en `fixture-a/fixture-a-model` y entregó `done by fixture-a`. |
| `S2` · Reasignación por cuota | PASS (1,387 s) | PASS (1,390 s) | El turno de `fixture-a` falló con `usage_limit_exceeded`. Un único agente de `fixture-b` recibió el encargo y el historial con el valor ficticio redactado. El original siguió disponible. |
| `S3` · Reanudación | PASS (93,010 s) | PASS (92,968 s) | Con el alternativo apagado, el gestor esperó, reanudó el mismo ID de agente una vez y entregó la respuesta. Antes de corregir el envío, el escenario falló por rechazo del modo `queue`. |
| `S4` · Aviso de cuota en la última respuesta | PASS (1,661 s) | Sin ejecutar | El turno original terminó como `completed` y sin error. Zelqio detectó el aviso y entregó el resultado de `fixture-b`. |
| `S5` · Automatic nativo | PASS (2,353 s) | Sin ejecutar | Con la marca, el SDK pidió `fixture-b` y el hook eligió `fixture-a`. Zelqio adoptó el agente, recibió el límite y reasignó el encargo. Sin la marca se respetó la elección explícita. |
| `S6` · Reinicio en espera | PASS (93,028 s) | Sin ejecutar | El estado de espera y el ID del agente sobrevivieron. `zelqio.runs.list` fue el primer RPC al plugin tras el reinicio y activó su recuperación. El proveedor reabrió la sesión persistida y recibió un solo mensaje de reanudación. |
| `S7` · Concurrencia | PASS (94,090 s) | Sin ejecutar | Las llamadas a `runs.list` concurrentes coincidieron con hooks de turno y ticks. Se observó un reemplazo y una reanudación, cada uno con un solo prompt al proveedor. |
| `S8` · Toma de control | PASS (2,208 s) | Sin ejecutar | Al recibir el turno manual, Zelqio marcó la ejecución como cancelada. La traza solo contiene el turno inicial y el manual. |

La corrida `run-e2e-verified` de Paseo 0.17.6 salió con código 0 y liberó el puerto 16793 tras pasar S1–S8. La corrida `run-e2e-verified-compat` de 0.17.5 salió con código 0 y liberó el puerto 16794 tras pasar S1–S3. El listener habitual de `127.0.0.1:6767` conservó el PID 3332 antes y después de ambas corridas.

`npm.cmd run check` pasó con 413 pruebas en 36 archivos. El fixture pasó una comprobación de TypeScript independiente. Entrega completa para el alcance descrito.

## Hallazgos y correcciones

- Paseo rechazaba `activeTurnBehavior: "queue"` porque un envío sin `sourceAgentId` no puede encolarse. El adaptador usa el envío nativo sin remitente y conserva el `messageId` estable.
- Tras reiniciar, Paseo representa al agente como `closed` y conserva su identificador de persistencia. La recuperación distingue el cierre restaurable de la desaparición o el archivado del agente.
- El flujo creó agentes con un prompt inicial sin `clientMessageId`. Paseo ejecutó el turno, pero la línea de usuario y `lastUserMessageAt` faltaban al leer el agente. El adaptador ahora pasa la clave estable del intento como ID del mensaje.
- Una ejecución que esperaba cuota y tenía `userBaseline: null` no podía detectar una toma de control. El gestor toma como referencia el evento de agotamiento en ese caso y verifica la toma de control al recibir un turno del agente en espera.
- Una reanudación aceptada quedaba pendiente hasta que un tick viera al agente en estado `running`. Una prueba con el adaptador simulado reproduce el turno que termina entre ticks. El gestor confirma la reanudación en cuanto Paseo acepta su mensaje y puede entregar la respuesta desde el hook de fin de turno.
- La consulta de cuota por agente devolvió cero informes en el entorno sintético. El runner descubre las fuentes registradas y fuerza una actualización de sus dos informes. La API legada que usa Zelqio fecha el conjunto con el informe más antiguo.

## Alcance y límites

- Los prompts ejecutados fueron sintéticos. El runner exige que solo `fixture-a` y `fixture-b` estén listos. Cada ejecución usa un perfil y estado de Zelqio desechables, un daemon con el relay desactivado y comprobaciones de PID antes y después. Paseo intentó descargar un modelo de dictado en un intento preliminar porque el supervisor descartaba los overrides de voz por entorno. El runner final desactiva dictado y voz en el home aislado mediante la configuración del CLI.
- La ventana de un minuto y el margen de 30 s se cumplen en tiempo real. El runner usa ticks de 1 s, reintentos de comprobación de 500 ms y un valor de 1 s para avisos sin fecha ni intervalo. S3 y S6 observan la traza del proveedor durante la espera y consultan el RPC de la ejecución después del turno reanudado.
- La prueba representa la recuperación de cuota publicando informes sintéticos nuevos mediante la API de uso del host. Quedan fuera la cadencia de informes de proveedores comerciales, la autenticación, la facturación y la interfaz Desktop.
- S6 reinicia mientras la ejecución está en espera. Quedan fuera un corte durante una creación o un envío en curso y la carrera exacta entre un envío humano y la entrega de otro mensaje nativo. S5 prueba los hooks del SDK con la marca de Automatic.
