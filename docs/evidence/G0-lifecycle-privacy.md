# G0 — Red, limpieza y continuidad de agentes

Seguimiento del 26 de noviembre de 2026 de [S00-T05](S00-T05-subagents-worktrees.md) y [S00-T08](S00-T08-persistence-isolation-privacy.md). Windows, Paseo CLI y daemon 0.17.4, Electron con Node 24.20.0, Node 24.21.0 para el runner y Git 2.50.1.windows.1. Las pruebas usaron repositorios sintéticos, perfiles y homes desechables, y listeners de loopback con relay desactivado.

## C3 · Conexión TCP observada en S00-T08

La conexión histórica queda **sin atribución única**. T08 registró el alcance de las direcciones y el estado TCP del propietario del listener, sin guardar el par remoto ni un identificador que enlazara el socket con una descarga. El log registra intentos de descargar modelos de voz durante los arranques. El paquete 0.17.4 confirma la ruta `speech-runtime.js` → `model-library.js` → `sherpa/model-downloader.js`. El catálogo construye URLs de GitHub Releases para sherpa-onnx y el descargador usa `fetch`.

| Fixture en loopback | Dictado | Plugins T02 y T07, RPC de listado T07 | TCP no loopback establecido, propietario del listener | Log de descarga |
|---|---|---|---|---|
| `16830` | Desactivado | Ausentes | 0 | Sin inicio |
| `16831` | Desactivado | Instalados, RPC devuelve `[]` | 0 | Sin inicio |
| `16832` | Activado | Ausentes | 2, ambos atribuidos a voz | Inicio observado |
| `16833` | Activado | Instalados, RPC devuelve `[]` | 2, ambos atribuidos a voz | Inicio observado |

En ambos controles con dictado, el PID dueño de `127.0.0.1` registró una petición de un archivo sherpa-onnx en GitHub Releases y otra en la CDN de releases. La sonda de diagnóstico de Undici vinculó cada petición con su socket. `netstat -ano -p tcp` confirmó ambas conexiones `ESTABLISHED` cruzando PID, puerto local y puerto remoto `443`. El conteo se limitó al propietario del listener IPv4. La salida de la sonda se limita a categorías de destino, PID y puertos en scratch. El resultado conserva categorías, conteos y puerto remoto de servicio.

**G0.** Se atribuyó el tráfico repetido a voz de Paseo y se aisló el RPC de lectura de T07 mediante controles. POC-16 completo sigue pendiente por el alcance de la muestra. Quedaron fuera procesos hijos, IPv6, conexiones breves que el muestreo TCP pudiera perder, otras operaciones del plugin y la exportación saneada de estado persistido real. El modo de voz permaneció desactivado en las cuatro celdas. Los cuatro listeners cerraron.

## C4 · Archivado y limpieza

`paseo workspace archive --help` en 0.17.4 expone el ID, selector de daemon y formato de salida. El archivado de worktrees propiedad de Paseo sigue sujeto al fallo de T05. `workspace-archive-service.js` omite la retirada del directorio para registros sin propiedad de Paseo.

La vía `git worktree add --orphan` seguida de `paseo workspace create --isolation local --path <checkout>` registró el checkout exacto como `kind: worktree`, `isPaseoOwnedWorktree: false`. La primera ejecución esperaba `kind: local` y se detuvo antes del archivado. El reintento verificó la propiedad externa antes de proceder.

| Fixture | `paseo workspace archive <workspace>` | `git worktree remove <checkout>` |
|---|---|---|
| Worktree externo con archivo en el índice, archivo sin seguimiento y archivo ignorado | Archivó el registro. Se conservaron el directorio y la entrada Git. | Git rechazó la operación sin fuerza con código 128 y conservó los tres archivos, su estado en Git y la entrada del worktree. |
| Worktree externo limpio | Archivó el registro. Se conservaron el directorio y la entrada Git. | Git retiró el checkout sin fuerza y desapareció la entrada correspondiente. Se conservaron el repositorio base, el worktree con cambios y el tag sintético a un blob. |

**G0.** La separación entre archivado externo en Paseo y retirada sin fuerza en Git es una alternativa para evaluar. POC-08 sigue fallando para el teardown de worktrees administrados en 0.17.4. El ensayo usa ramas sin commit inicial. Quedan por verificar ramas con historial integrado, servicios o agentes activos, carreras y fallos entre el archivado y la retirada. El archivo ignorado se comprobó con `--ignored=matching` junto a otros cambios. El caso con solo archivos ignorados queda fuera. La política vigente de Zelqio Flow conserva los worktrees administrados mientras falte una retirada nativa segura. [Limpieza segura](../../planning/DEVELOPMENT-WORKFLOW.md#limpieza-segura-de-worktrees)

## C5 · Continuidad del vínculo entre agentes

T05 observó un vínculo nativo entre workspaces derivado de `callerAgentId` y persistido en la etiqueta reservada `paseo.parent-agent-id`. También observó que archivar un hijo conservaba su vínculo histórico. El seguimiento reprodujo el detach nativo mediante `agent detach` y comprobó además el detach que resulta de archivar la raíz. `agent-manager.js` distingue hijos entre workspaces e hijos con pestaña abierta al decidir si desvincula o archiva. La prueba cubrió los dos workspaces con agentes simulados, inactivos y sin pestañas abiertas. Cada uno de los seis timelines devueltos estaba vacío.

| Operación | Resultado observado |
|---|---|
| Crear raíz de reemplazo y un nuevo hijo en el otro workspace | El nuevo hijo apuntó a la raíz de reemplazo. Los hijos ya creados conservaron el padre anterior. |
| Actualizar la metadata del hijo existente con `setAgentMetadata` | La metadata indicó raíz anterior, raíz de reemplazo, tarea y ejecución. Su padre nativo siguió siendo la raíz anterior. |
| Ejecutar `agent detach` para el hijo de control en el otro workspace | El hijo quedó activo en su workspace original, sin padre nativo y con su metadata. |
| Ejecutar `agent archive` para la raíz anterior | El hijo en su mismo workspace se archivó y conservó su vínculo histórico. El hijo en el otro workspace quedó activo en su workspace original y se desvinculó. La raíz de reemplazo y su hijo siguieron activos con el vínculo que se creó entre ellos. |
| Detener e iniciar por separado el daemon | El historial local se pudo leer durante la parada. El cliente reconstruyó la misma vista después del arranque, con metadata, estados y vínculos nativos idénticos. |

La sonda escribió un historial local NDJSON con ID de tarea, ejecución y agente, el workspace, la relación original y un evento de relevo. Usó append y `fsync` tras cada evento. El historial y la metadata contienen identificadores sintéticos, y la vista exportada por la sonda usa alias. El historial conservó la relación original del hijo entre workspaces después de perderse el padre nativo.

**G0.** `callerAgentId` sirve para crear el vínculo inicial. La CLI y el SDK examinados exponen detach y metadata de agente. Sigue pendiente una vía soportada para reasignar un hijo existente a una nueva raíz en la vista nativa. La metadata y el historial local dan continuidad lógica para evaluar en G0. Los campos son trazabilidad, según los límites de identidad de S00-T04. Quedan fuera la vista nativa tras el relevo, workspaces administrados, turnos activos, proveedores reales y un fallo de proceso entre guardar la metadata y guardar el evento. El reinicio ordenado aporta evidencia al fallback de POC-12. La reconciliación de operaciones activas sigue pendiente.

## Reproducción

En PowerShell, definir `$install` con la instalación 0.17.4 y elegir dos destinos temporales nuevos. El primer comando puede iniciar una descarga pública de voz en los dos controles con dictado. El segundo usa el proveedor `mock` empaquetado, habilitado en el entorno de desarrollo del fixture, con sesiones sin prompt.

```powershell
node poc/s00-t08/lifecycle/run.cjs $install '<sandbox>\network' network
node poc/s00-t08/lifecycle/run.cjs $install '<sandbox>\workspace' workspace (Get-Command git.exe).Source
node --check poc/s00-t08/lifecycle/run.cjs
node --check poc/s00-t08/lifecycle/network.cjs
node --check poc/s00-t08/lifecycle/agents.mjs
```

El runner ejecuta el punto de entrada del CLI de la instalación. Usa `daemon config set` y `daemon start/stop` con `--home <home-del-fixture>`. Las consultas usan `--host 127.0.0.1:<puerto>`. Para C4 ejecuta `workspace create --isolation local`, `workspace ls`, `workspace archive`, `git worktree list --porcelain`, `git status --porcelain=v1 --untracked-files=all --ignored=matching` y `git worktree remove` sin fuerza. Para C5 combina `createAgent`, `setAgentMetadata` y `fetchAgentTimeline` del cliente con `agent detach` y `agent archive` del CLI. Ambos modos comprueban que los listeners propios cerraron antes de salir. [Runner](../../poc/s00-t08/lifecycle/run.cjs) · [Sonda de red](../../poc/s00-t08/lifecycle/network.cjs) · [Sonda de agentes](../../poc/s00-t08/lifecycle/agents.mjs)
