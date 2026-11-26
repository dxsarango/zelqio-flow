# S00-T07 — Servicios y aprobación

Paseo 0.17.4 en Windows, daemon con home propio en loopback `:16780`, servicio del fixture en `:16781`, frontend web de esa misma versión en Chrome headless. Se recuperaron la sonda, el cliente y el registro de eventos del ensayo interrumpido. La comprobación adicional de servicio, proxy y túnel no usó inferencia.

## POC-11 — Servicio local

| Comprobación | Resultado | Evidencia |
|---|---|---|
| Arranque, salud, URL y parada | PASS | El cliente de la instalación arrancó `preview` por ID de workspace. La lista pasó de `running/health:null` a `running/healthy`. El fixture respondió HTTP en `127.0.0.1:16781/health` y por el proxy de Paseo `http://<preview>.localhost:16780/health`. Tras parar, `lifecycle=stopped` y HTTP `000` directo. El campo de salud todavía decía `healthy` en la primera consulta posterior. |
| Identificación de versión | PASS | Git HEAD, respuesta directa y respuesta por proxy devolvieron `e5c8933a39113a69a1ba54d42b8b920233186ba5`. El fixture lee HEAD al iniciarse. El ensayo recuperado observó que un servicio iniciado sigue sirviendo el SHA previo cuando cambia HEAD. Hace falta comprobar SHA y ciclo de vida en la entrega. |
| Conexión al mismo daemon por otra dirección | PASS | Una conexión directa a `:16780` y un forward TCP local a `:16786` devolvieron el mismo `serverId` y versión. En ambas, `localProxyUrl` siguió en `:16780` y `publicProxyUrl=null`. La dirección del cliente y la URL del preview pueden diferir. |
| SDK de plugin y host remoto real | NOT RUN | El cliente del daemon ejercitó scripts. La inspección de superficies del plugin no mostró métodos de scripts en el workspace handle. No se validó la operación desde el SDK de plugins ni el alcance por relay, pairing o una máquina remota. |

**Resultado local PASS.** La alternativa si el cliente carece de una URL alcanzable es identificar explícitamente el host y entregar evidencia del build o del servicio con el SHA.

## POC-17 — Actor humano y SHA

| Comprobación | Resultado | Evidencia |
|---|---|---|
| Panel de aprobación y SHA exacto | PASS | El frontend abrió `T07 approval` desde el workspace de prueba. Un clic generó `approved` sobre `df33d4de87b1013202a85999d7ff2d65f1dbc16d`. Después de cambiar HEAD a `e5c8933a39113a69a1ba54d42b8b920233186ba5`, un clic sobre una solicitud pendiente anterior quedó rechazado con `status:stale`. Una nueva solicitud pudo registrar `changes_requested` en el nuevo SHA. |
| Validación del contenido visible | PASS | El servidor vincula acción, proyecto, workspace, SHA y versión de política. El log registra el rechazo de un SHA distinto (`mismatch:["sha"]`) y de una segunda decisión (`status:approved`). El cambio de contenido de la fixture dejó pendiente la solicitud hasta llamar al RPC. |
| Identidad del aprobador | FAIL | El contexto de `poc.approval.decide` fue `ctxKeys:["paseo"]` tanto en el flujo UI como en el ensayo con un cliente de daemon sin UI. Los eventos `ui:ui.decide.ok` provienen del cliente y carecen de valor como prueba de identidad. `requestedBy` es un campo declarativo de la solicitud. |
| Canal alternativo con política verificable | BLOCKED | Hace falta validar una frontera con identidad separada, por ejemplo una revisión GitHub requerida asociada al SHA, o una capacidad soportada de Paseo que exponga un actor verificable. No se verificó una aprobación auténtica por chat o desde la UI nativa. |

**Resultado FAIL.** La sonda cambia un registro en memoria y carece de efectos Git. La decisión sobre un mecanismo de aprobación verificable queda para G0. Una aprobación de esta sonda no habilita acciones del producto.

## Reproducción aislada

1. Preparar un home nuevo de Paseo 0.17.4 en loopback `:16780` con relay desactivado y plugins habilitados. Crear un Git desechable con los archivos de [fixture](../../poc/s00-t07/fixture/) y registrar un workspace. Para ensayar cambio de SHA, usar un branch-off desechable.
2. Instalar [el plugin de prueba](../../poc/s00-t07/plugin/) en ese daemon. Usar [rpc.mjs](../../poc/s00-t07/scripts/rpc.mjs) con Electron en modo Node para `scripts <workspaceId>`, `start <workspaceId> preview` y `stop <workspaceId> preview`. Comparar `git rev-parse HEAD` con `/health` directo y a través de `localProxyUrl`. Forzar el host de esa URL a `127.0.0.1` con `curl --resolve` si el resolver no maneja `*.localhost`.
3. Si `:16786` está libre, usar [tcp-forward.mjs](../../poc/s00-t07/scripts/tcp-forward.mjs) para comparar el `serverId` de `perms` y `localProxyUrl` de `scripts` por ambos endpoints.
4. Servir el frontend con [serve-app.mjs](../../poc/s00-t02/scripts/serve-app.mjs) en `:16783` y habilitar ese origen en el daemon aislado. Abrir [ui-session.ps1](../../poc/s00-t07/scripts/ui-session.ps1) con un `-Scratch` de prueba. Entrar al panel, solicitar y aprobar sobre el SHA actual. Para el caso obsoleto, solicitar otra aprobación, hacer un commit en el fixture y pulsar **Approve**. Usar los eventos `approval.decided`, `approval.stale` y `approval.decide.rejected` para verificar el resultado.
