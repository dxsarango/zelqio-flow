# S00-T08 — Persistencia, aislamiento y privacidad

Paseo 0.17.4 en Windows. El ensayo usa un home nuevo del daemon en `127.0.0.1:16800` con relay desactivado, un repositorio desechable y un servicio de workspace en `:16801`. El plugin S00-T07 guarda un registro pendiente en memoria. El plugin S00-T02 sirve como control independiente. Las sondas utilizan el cliente incluido en la instalación. El daemon de uso habitual queda fuera del ensayo.

## Resultados del 26 de noviembre

| Prueba | Resultado | Evidencia |
|---|---|---|
| POC-12 · Reinicio con operación pendiente | FAIL en la sonda | `daemon stop` seguido de `daemon start` cambió el PID. Antes había un servicio `running` y una solicitud de aprobación pendiente vinculada a HEAD. Tras reiniciar, el servicio quedó `stopped` y el RPC de listado ya no devolvió la solicitud. El estado del repositorio y su rama de control se preservaron. Una primera llamada a `daemon restart` había devuelto el mismo PID y se descartó como prueba de reinicio. |
| POC-13 · Aislamiento | PASS en el fixture | Desactivar el plugin T07 bloqueó su RPC, y el control T02 siguió reportado como activo después de retirar T07. El servicio nativo del workspace siguió `running`. S00-T02 ya comprobó una sesión normal con el hook activo. La sesión de control nueva en T08 quedó fuera del ensayo al devolver el daemon `Provider 'opencode' is not available`. |
| POC-14 · Desactivación y retirada | PASS en el fixture | Los RPC de T07 quedaron inaccesibles tanto tras `plugin disable` como tras `plugin remove`. Se conservaron el otro plugin, el servicio independiente, la rama `test/preserved` en el SHA de control y el archivo sin seguimiento `sentinel.txt`. |
| POC-16 · Red y almacenamiento | BLOCKED para el criterio completo | Las primeras muestras por PID quedaron vacías. En una consulta posterior, `Get-NetTCPConnection` localizó el PID propietario del listener IPv4 `127.0.0.1:16800`, distinto del PID en `paseo.pid`. El propietario tenía listeners en loopback y una conexión TCP establecida con un par fuera de loopback. Se desconoce su origen. La evidencia versionada se limitó a estados, resultados y SHAs. Siguen pendientes la atribución del tráfico y una prueba de exportación saneada. |

La reconciliación de un turno activo, los permisos pendientes de un agente y la conservación de perfiles y memorias durante la retirada quedaron **NOT RUN**. La pérdida de la solicitud refleja el almacén en memoria de la sonda. Un mecanismo de persistencia y reconciliación sigue pendiente de validación para G0. El ensayo de ciclo de vida y retirada terminó con código 0 y no envió prompts.

## Reproducción

```powershell
.\poc\s00-t08\run.ps1 -Install '<paseo-install>' -Scratch '<sandbox>\t08-new'
```

La ruta de scratch debe empezar vacía y los dos puertos deben estar libres. El script crea un Git de prueba, registra un workspace local, instala los dos plugins del repositorio, crea una solicitud vinculada a HEAD y ejecuta el servicio. Reinicia el daemon, comprueba el estado del servicio y la solicitud, vuelve a arrancar el servicio y desactiva y retira el plugin S00-T07. El script toma instantáneas TCP del PID del daemon antes y después del reinicio y lo detiene al finalizar. El fixture queda disponible para inspección.

Para repetir la comprobación adicional, arrancar el mismo home aislado, localizar el listener con `Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort 16800` y consultar las conexiones con `Get-NetTCPConnection -OwningProcess <pid-del-listener>`. La inspección registró estado y alcance de la dirección. La parada final cerró ambos puertos del fixture.

## Comprobación adicional de POC-16

- **PASS en el fixture de exportación.** `node poc/s00-t08/export-probe.mjs` produjo un JSON con versión, ID de comprobación, veredicto y SHA. La prueba verificó que se omitieran ubicación, notas, mensajes y una credencial simulada. Rechazó valores inválidos en los campos permitidos. Solo usó datos sintéticos.
- El log del daemon aislado registra que Paseo intentó descargar modelos locales de voz en los tres arranques del ensayo, incluido el de la inspección TCP. Ese log identifica una fuente de tráfico de la plataforma. Falta correlacionar la conexión observada con una operación concreta y probar la exportación con estado persistido real. POC-16 sigue bloqueado para el criterio completo.

## Seguimiento de G0

- **POC-12, persistencia de aprobación.** La sonda posterior pasó 31 comprobaciones. Confirmó stop/start real, pendientes preservados por workspace y SHA, reintento idempotente e invalidación por cambios. La persistencia mantiene la decisión en el dominio del fixture. La autenticación humana, la caída abrupta y la recuperación de operaciones activas siguen pendientes. [Aprobación y persistencia](G0-approval-persistence.md)
- **POC-16, atribución controlada.** Cuatro controles, con y sin plugins y con dictado activado o desactivado, atribuyeron las conexiones reproducidas a descargas de voz de Paseo en GitHub Releases y su CDN. El destino histórico no se guardó. El criterio completo sigue abierto por cobertura y exportación de estado persistido real. [Red, limpieza y continuidad](G0-lifecycle-privacy.md)

## 26 de noviembre de 2026 — Paseo 0.17.5, estado real aislado

Windows, Node.js 24.21.0 y CLI y SDK de Paseo 0.17.5. Cada ejecución creó un home nuevo bajo `<sandbox>/home-0175/`, con relay desactivado y un único listener en `127.0.0.1:16775`. La tabla TCP mostró el mismo PID del listener habitual en `127.0.0.1:6767` antes y después. El runner se conectó exclusivamente al daemon de prueba y verificó el cierre de su listener. Todos los mensajes y datos fueron sintéticos y se enviaron cero prompts a proveedores externos.

| Validación | Resultado | Comando | Observación y límite |
|---|---|---|---|
| A · POC-12 · Parada ordenada y terminación forzada durante un turno | **FAIL** en ambos reinicios | `run.mjs … state`, SDK `fetchAgent` y `fetchAgentTimeline`, `daemon stop/start`, `taskkill /T /F` sobre el supervisor aislado verificado | Antes de cada parada, el agente estaba `running`, con turno activo, un permiso pendiente y dos entradas de historial. Después de arrancar con el mismo serverId y otro PID, `fetchAgent` devolvió la misma sesión con su workspace, metadata y handle de persistencia, en `closed`, sin turno y con cero permisos pendientes. En los tres segundos de observación inicial y durante la lectura exacta no hubo apertura, prompt ni decisión. La consulta explícita de historial abrió el proveedor y devolvió `idle` con historial vacío. El cierre ordenado registró un cierre de sesión y el forzado, ninguno. El contador volátil del plugin volvió a cero al recargar y marcó uno tras la apertura por historial. El archivo del plugin sobrevivió. El ensayo cubre el proveedor de prueba y no demuestra que otros proveedores con su propia persistencia pierdan el historial. |
| A · POC-12 · Decisiones concurrentes y repetición | **FAIL** para exactamente una entrega | `run.mjs … state`, dos clientes SDK con `respondToPermission` y el RPC del plugin contendiente | Dos clientes enviaron la misma decisión y un segundo plugin compitió durante la ventana de procesamiento de 600 ms. Una entrega llegó al proveedor y hubo un evento de resolución en cada ronda. Los envíos simultáneos fueron `allow/allow/allow` y `deny/deny/allow`. Después de cerrar el permiso, un cliente volvió a enviar el mismo ID con la decisión opuesta y el proveedor recibió una segunda entrega en las dos rondas. El proveedor del fixture evitó ejecutar dos veces su finalización. El resultado de envío del SDK acredita transporte, no una segunda aceptación ni un efecto del permiso. |
| B · POC-12 · Efecto interrumpido y reconciliación | **PASS** con journal propio. El estado nativo fue insuficiente | `run.mjs … state`, `fixture.effect`, `AttemptJournal.recoverAfterRestart` y `GitOperationJournal.reconcile` | El RPC del plugin escribió un archivo y actualizó una ref del clon local con el SHA anterior como condición. El daemon cayó después de observar los efectos y antes de recibir un acuse del RPC. El intento reabierto quedó `ambiguous` y conservó su único cupo. Leer el archivo y verificar ref, repositorio y objeto Git permitió clasificar la ref como `applied`. La consulta nativa del agente tras el reinicio no mostró el archivo ni el SHA aplicado. La observación Git describe el estado de la ref. El RPC se dejó abierto de forma deliberada y la caída ocurrió con ambos efectos ya visibles, sin simular corrupción a mitad de escritura o pérdida de energía. |
| C · POC-13/14 · Retirada y preservación | **PASS** en el fixture | `run.mjs … state`, `stopWorkspaceScript`, `patchDaemonConfig`, `plugin disable/remove` | Se retiraron un servicio nativo, un perfil sintético, el plugin contendiente y su archivo auxiliar. Otro servicio continuó `running`. Se verificaron el perfil de control, el RPC y estado del plugin de control, su archivo de memoria sintética, HEAD y los archivos tracked modificados y untracked. La memoria fue un archivo de fixture. Se reutilizó el hallazgo sobre retirada forzada de worktrees sucios y se omitió repetir ese archivado. [Evidencia de POC-08](S00-T05-subagents-worktrees.md#poc-08) |
| D · POC-16 · Atribución del tráfico actual | **PASS** en las cuatro ventanas observadas | `run.mjs … network`, `netstat -ano`, `Win32_Process` y diagnóstico de sockets de Node | Con dictado y modo de voz apagados, cero conexiones TCP externas. Con ambos encendidos, todo TCP externo observado se correlacionó con descargas de voz de Paseo por PID, extremos del socket y tiempo. Los dos destinos fueron GitHub Releases y su CDN. Se verificaron loopback IPv4 e IPv6 en un servicio hijo y se ejercieron tres RPC de Zelqio Flow en los casos con el plugin. No se observó tráfico atribuible al plugin, a la inferencia ni al adaptador de forja. |
| D · POC-16 · Destino histórico y cobertura exhaustiva | **BLOCKED** | Comparación con [Red, limpieza y continuidad](G0-lifecycle-privacy.md) y alcance de `run.mjs … network` | La conexión original de 0.17.4 quedó sin dirección registrada. Las conexiones actuales identifican una fuente reproducible. El muestreo periódico de Windows puede perder sockets nativos breves. El diagnóstico de inicio cubre procesos Node instrumentados. Se muestrearon enlaces UDP locales y no se observaron filas, pero quedaron fuera los pares remotos UDP, incluidos datagramas DNS nativos, y la actividad posterior a las ventanas. |
| E · POC-16 · Exportación y retención de estado real | **PASS** en el fixture | `run.mjs … state`, `exportFixtures` y `evaluateRetention` | La exportación combinó una sesión persistida leída tras el reinicio con permiso e historial leídos durante el turno real, un veredicto calculado y un SHA del clon de prueba. Emitió exclusivamente `id`, `verdict` y `sha` por registro. Descartó ruta, notas, mensajes y la credencial sintética. Rechazó un ID, un veredicto y un SHA inválidos y un ID duplicado. La retención preservó los tres registros conectados con el turno activo, incluidos permiso y workspace, y declaró elegible el control vencido sin referencia. La prueba construyó la proyección de referencias y ejerció una evaluación sin borrado. |

### Ventanas de red

Hora UTC del 27 de noviembre, noche del 26 en Ecuador. Cada ventana de 21 a 22 segundos incluyó 19 o 20 muestras del sistema sin errores, 7 u 8 PID atribuidos y conexiones de control del servicio sintético a `127.0.0.1` y `::1`. El PID del servicio se verificó mediante un archivo de señalización del fixture porque Windows lo lanzó a través de una pseudoconsola. El diagnóstico de Node comenzó antes de arrancar. El muestreo de Windows comenzó tras verificar el PID de escucha.

| Dictado y voz | Zelqio Flow | Ventana UTC | TCP no loopback |
|---|---|---|---|
| Apagados | Ausente | 04:28:43.579–04:29:04.596 | Cero |
| Apagados | Activo | 04:29:22.574–04:29:43.164 | Cero |
| Encendidos | Ausente | 04:29:49.036–04:30:09.865 | PID 28740 a `140.82.112.3:443` (`github.com`) y `185.199.111.133:443` (`release-assets.githubusercontent.com`). |
| Encendidos | Activo | 04:30:28.338–04:30:49.906 | PID 5996 a `140.82.113.3:443` (`github.com`) y `185.199.111.133:443` (`release-assets.githubusercontent.com`). |

Ambos PID externos eran del daemon aislado. El diagnóstico de Undici vinculó los sockets de GitHub a la solicitud del release de Sherpa ONNX y los del CDN al mismo flujo de descarga. Las conexiones externas observadas fueron IPv4. Con el plugin activo respondieron `zelqio.status`, `zelqio.roles.list` y `zelqio.providers.list`. La prueba cubre arranque y estas lecturas. Las solicitudes de voz se observaron durante la ventana y la finalización de la descarga quedó fuera del criterio.

### Reproducción

```powershell
$Sandbox = '<sandbox>'
$Git = (Get-Command git.exe).Source
$Suffix = Get-Date -Format 'yyyyMMdd-HHmmss'
node --experimental-transform-types poc/s00-t08-0.17.5/run.mjs $Sandbox "run-t08-state-$Suffix" $Git state
node poc/s00-t08-0.17.5/run.mjs $Sandbox "run-t08-network-$Suffix" $Git network
npm run check
```

`<sandbox>` debe contener la instalación npm 0.17.5 y el directorio `home-0175`. Usar un nombre nuevo y ejecutar una sonda a la vez. El estado exportado y los registros diagnósticos quedan en el home del fixture. `npm run check` pasó typecheck, lint y 383 pruebas en 33 archivos.
