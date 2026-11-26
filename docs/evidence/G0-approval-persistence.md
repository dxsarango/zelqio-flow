# G0 — Aprobación: procedencia del actor y persistencia

Paseo 0.17.4 en Windows (Electron-Node v24.20.0 incluido en la instalación). Experimento de G0 S00; no abre S01 ni cambia planning ni el gate. Dos objetivos separados:

- **C1** — ¿Una superficie nativa soportada de Paseo 0.17.4 entrega procedencia de actor humano de confianza?
- **C2** — ¿Sobrevive una aprobación pendiente a un `stop`/`start` real del daemon, y falla cerrada ante cambios?

**Persistencia e identidad son propiedades distintas.** C2 puede aprobar la primera sin resolver la segunda.

Estado: C1 completo (FAIL de identidad en la superficie examinada). C2 completó 29 comprobaciones iniciales y 31 de 31 en la ejecución consolidada, con dos workspaces y sus SHA independientes.

## C1 — Procedencia del actor

Método: lectura de solo lectura de los paquetes públicos empaquetados en la instalación (`@getpaseo/plugin`, `@getpaseo/protocol`, `@getpaseo/server`), más las observaciones previas de [S00-T07](S00-T07-services-approval.md). Sin explotación, sin credenciales, sin red.

| Pregunta | Hallazgo (paquete, módulo) | Veredicto |
|---|---|---|
| ¿Qué recibe un handler de RPC de plugin? | `{ paseo, push, signal }` (`@getpaseo/server` `plugins/subscription-handlers.js`; `plugins/plugin-process.js`). Sin campo de llamador, sesión ni principal. | Sin actor |
| ¿Qué reenvía el daemon al plugin? | `session.dispatchPluginRpcMessage` llama `pluginRuntime.invokePluginRpc(pluginId, method, input)`: tres argumentos, sin sesión ni principal (`session.js`, `plugins/index.js`). | Se descarta antes del plugin |
| ¿Qué es un "usuario" para el daemon? | `resolveSessionAdmission` devuelve siempre `principalId: "owner"` con `OWNER_PERMISSIONS`, tanto sin contraseña, con contraseña correcta o con credencial local (`session-admission-auth.js`). Una sola identidad: quien conecte con la credencial del daemon es "owner". | Sin humano, solo titular de credencial |
| ¿Cuánta autoridad da una conexión admitida? | `plugin.rpc.invoke.request` exige `daemon.manage` (`authorization/operation-permissions.js`); el mismo permiso cubre instalar, activar, recargar y retirar plugins y cambiar la configuración del daemon. | Granularidad gruesa, mismo nivel que administrar el daemon |
| ¿`clientType` o `clientId` del `hello` identifican al humano? | `clientType` es `mobile \| browser \| cli \| mcp \| hub`, declarado por el cliente (`@getpaseo/protocol`). El ensayo T08 conectó con el cliente del paquete con `clientType:"cli"`. Una UI y un script son indistinguibles para el servidor. | Declarativo, no confiable |
| ¿Qué entrega el SDK de UI de plugin? | `PluginRpcProvider` expone solo `invoke`/`subscribe` y `PaseoApiProvider` el objeto `paseo`; `client-state`, `composer` y `new-workspace` no contienen usuario (`@getpaseo/plugin` `client/*`). Búsqueda de `actor`, `userId`, `identity`, `principal`, `caller`, `authenticat` en el SDK del plugin: solo coincidencias ajenas (identidad de timeline, comentarios). | Sin actor |
| ¿Hay principales distintos? | Existe `hubPrincipalId` (enrolamiento Hub) con permisos reducibles. Es identidad de un dispositivo/servicio enrolado, no de una persona, y requiere inscripción de red, fuera de alcance autorizado. | No verificado, no ejercitado |

**Conclusión C1: FAIL para "procedencia de actor humano verificable"** con las superficies soportadas de 0.17.4 que se inspeccionaron. Un clic real en el panel (T07) produce una llamada RPC idéntica a la de un script con la credencial del daemon. Lo que sí se puede demostrar es *vinculación de contenido* (acción, proyecto, workspace, SHA, política), no *quién* decidió.

Consecuencia de seguridad: un agente o proceso con acceso a la conexión local del daemon (misma credencial/cliente CLI) puede invocar `decide`. [SECURITY.md](../SECURITY.md) exige "actor real, no inferido"; el RPC de plugin no cumple esa condición. Esto no se demostró con una explotación; se deduce de las rutas de código citadas y de T07 (`ctxKeys:["paseo"]` para UI y para cliente sin UI).

### Alternativas (ninguna verificada de extremo a extremo)

| Alternativa | Qué aportaría | Sin probar |
|---|---|---|
| **Manual-only / fail closed** (recomendada como base de G0) | Ninguna acción sensible se ejecuta por una aprobación del plugin. El plugin muestra SHA/acción/política y el producto exige que la persona ejecute la operación por su cuenta (p. ej. en su propia terminal o UI externa) con comprobación del SHA actual. Una aprobación del plugin solo es un *recordatorio*. | La fricción real de usuario; que la verificación de SHA en el momento de la acción no se pueda evadir |
| **Revisión independiente autenticada** (p. ej. revisión requerida del host Git vinculada al SHA, con identidad separada de la credencial del daemon) | Identidad propia del proveedor Git, ligada al SHA y a reglas de la rama. | El sandbox de POC-15 rechazó la autoaprobación. Quedan por comprobar una aprobación positiva de un actor separado, la invalidación al cambiar el SHA y la protección efectiva. |
| **Confirmación fuera de banda con secreto del humano** (p. ej. el usuario introduce un código mostrado solo en su terminal) | Eleva la barrera frente a un agente que no ve ese canal. | Diseño ad hoc no auditado; un proceso del mismo usuario con acceso a la terminal sigue en el mismo dominio de confianza |
| **Capacidad futura de Paseo** que exponga principal por sesión | Resolvería C1 directamente. | No existe en 0.17.4; no se puede inventar ni asumir |

Mínimo que cualquier alternativa debe cumplir (heredado de [SECURITY.md](../SECURITY.md)): vinculación a tarea, proyecto, acción, SHA y versión de política; acción explícita de la persona; fallo cerrado si algo falta o cambia.

## C2 — Persistencia de la aprobación pendiente

Prototipo desechable en [poc/s00-t08/approval-restart](../../poc/s00-t08/approval-restart/): plugin con almacén en archivo JSON, un cliente RPC fino (`call.mjs`) y el escenario `run.ps1`. Daemon 0.17.4 nuevo con home propio en `127.0.0.1:16820`, relay desactivado, plugins habilitados, repositorio Git sintético, sin inferencia ni turnos de agente. Solo se ejercitó el RPC del plugin; no hay código que ejecute efectos Git.

### Elección de almacenamiento

| Opción | Resultado |
|---|---|
| Almacenamiento de ajustes del SDK (`registerSettings`, ámbito `host`, escritura atómica y revisión) | **Descartada.** El valor devuelto al plugin solo expone `read` y `subscribe`. La escritura existe solo como RPC `settings.<id>.write`, invocable por cualquier cliente con `daemon.manage`. Guardar ahí una aprobación permitiría a cualquier cliente local fabricar el estado `approved`. Sirve para preferencias del usuario, no para estado autorizante del servidor. |
| Archivo propio del plugin (prototipo) | Usado. El SDK no entrega un directorio de datos al plugin; el fixture pasa la ruta por una variable de entorno que el proceso del plugin heredó del daemon. Sin variable, todo RPC falla cerrado. Un producto necesita una convención de ubicación propia. |

### Modelo del prototipo

Cada registro vincula `taskId`, `action`, `projectId`, `workspaceId`, `sha` y `policyVersion`, más un sello SHA-256 sobre esos campos y el estado. Estados: `pending`, `approved`, `changes_requested`, `consumed`, `stale`, `invalid`. Cada llamada relee el archivo y reevalúa contra el SHA actual, proyecto y política. Escritura atómica (archivo temporal y `rename`) con cola serial en proceso. `consume` valida el vínculo y marca el registro usado; devuelve `identityVerified:false, effect:"none"`.

### Resultado (ejecución consolidada en Windows, Paseo 0.17.4, 31 comprobaciones)

| Bloque | Comprobaciones | Resultado |
|---|---|---|
| A. Antes del reinicio | Solicitud vinculada a HEAD y política; duplicado devuelve el mismo registro; consumir un pendiente es rechazado; decidir con otro SHA o acción es rechazado y el registro sigue pendiente; la decisión coincidente aprueba y el registro declara `provenance:"none"` | PASS |
| R. `daemon stop` / `daemon start` real | Puerto cerrado tras detener; PID distinto tras arrancar | PASS |
| B. Tras el reinicio | El pendiente conserva id, SHA, política y `createdAt` y **no está concedido** (consumir falla con `not approved: pending`); la decisión aprobada previa se conserva; el reintento de la solicitud no crea registro; un vínculo aprobado se consume una vez; el segundo consumo y una nueva decisión se rechazan; el estado Git (HEAD, ramas, estado) no cambió | PASS |
| A7/B9. Dos workspaces | Se incorporó una segunda solicitud con otro workspace y otro HEAD. No invalidó las primeras solicitudes. Tras reiniciar, recuperó su propio identificador, workspace, SHA y estado pendiente. | PASS |
| C. Cambio de SHA | El pendiente pasa a `stale (sha)`; decidir sobre él falla; una aprobación ya concedida deja de ser consumible; una nueva solicitud crea otro id ligado al nuevo SHA | PASS |
| D. Cambio de política con reinicio | Con `policy-v2` tras reiniciar, el pendiente de `policy-v1` queda `stale (policy)`; decidir falla; la nueva solicitud usa `policy-v2`; mostrar la política antigua se rechaza | PASS |
| E. Manipulación y corrupción | Cambiar `status` a `approved` en el archivo sin recalcular el sello → `invalid (integrity)`; archivo ilegible → solicitud, listado, decisión y consumo fallan cerrados y el archivo no se reinicia en silencio | PASS |
| F. Efectos | Solo existen los dos commits deliberados del fixture, una rama, sin archivos nuevos; no quedan temporales junto al almacén | PASS |
| Z. Limpieza | Daemon aislado detenido; 0 listeners en 16820–16829 tras la ejecución | PASS |

Reproducción: `powershell -File poc/s00-t08/approval-restart/run.ps1 -Install <paseo-install> -Scratch <directorio-nuevo> -Port 16821`. Usar un directorio nuevo y el puerto libre. El runner escribe `results.json` en el scratch y devuelve código 0 si pasan las 31 comprobaciones.

### Qué prueba y qué no

**Probado:** una aprobación pendiente y una concedida sobreviven a un `stop`/`start` real; un pendiente retenido no equivale a concedido; un cambio de SHA o de política invalida (también tras reiniciar); duplicado y reintento no crean ni reutilizan concesiones; un archivo corrupto o editado de forma ingenua falla cerrado; el prototipo no produce efectos.

**No probado:**

- **Identidad.** Todo lo anterior se ejecutó con el mismo cliente sin identidad. `decide` no sabe quién llama (ver C1). Persistencia no resuelve ni mitiga esto.
- **Integridad frente a un atacante.** El sello no es un MAC: quien pueda escribir el archivo puede recalcularlo. Solo detecta corrupción y ediciones ingenuas. El almacén comparte dominio de confianza con el proceso del daemon y el usuario del sistema.
- Caída abrupta (`kill`) durante la escritura, `fsync`, y concurrencia entre varios procesos o hosts. La cola serial es solo intra-proceso.
- Turnos de agente activos, permisos pendientes nativos de un agente y reconciliación de estado con una ejecución en curso (siguen **NOT RUN**, como en [S00-T08](S00-T08-persistence-isolation-privacy.md)).
- Entrega real de la decisión desde la UI del panel contra este almacén (T07 ya ligó un clic real a un SHA con otro almacén en memoria).
- Retirada del plugin: no se ejercitó qué ocurre con el archivo propio del plugin al desactivarlo o retirarlo. El código del daemon contiene una limpieza del directorio de ajustes por plugin, cuyo disparador exacto no se verificó; un archivo propio queda fuera de ese directorio.
- Otros sistemas operativos; Paseo distinto de 0.17.4.

## Implicaciones para G0

1. La persistencia de aprobaciones pendientes con vínculo a tarea, proyecto, acción, SHA y política es **viable** y falla cerrada con el diseño probado. Aun así, el diseño es de plugin, no un almacén de confianza.
2. La aprobación **de un humano real** no es verificable con RPC de plugin en 0.17.4. Hasta que exista una frontera con identidad separada, una aprobación persistida no debe disparar por sí sola ninguna acción de efectos remotos o destructivos (deny by default); la base conservadora es manual-only con verificación del SHA actual en el momento de actuar.
3. El estado `consumed` y el sello protegen contra reutilización accidental, no contra un cliente con credencial del daemon que decida por sí mismo.
