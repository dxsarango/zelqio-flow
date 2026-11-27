# Referencias técnicas: Quota Relay y Usage Auto Resume

**Progreso.** Análisis estático de dos plugins de Paseo con licencia MIT sobre agotamiento de cuota y reanudación automática. Se contrastó cada afirmación con el código fuente y con los tipos instalados del SDK en 0.17.4 y 0.17.5. No se ejecutó ningún código de los plugins ni se arrancó un daemon.

## Alcance y método

| Elemento | Valor |
|---|---|
| Plugin 1 | `quota-relay` 0.1.0, fuente `github.com/Pertical/quota-relay`, commit `e6eda8b`, MIT. En adelante **QR**. |
| Plugin 2 | `usage-auto-resume` 1.4.1, fuente `github.com/babo-jeonguk/paseo-usage-auto-resume`, commit `a264271`, MIT. En adelante **UAR**. |
| Clones (solo lectura, fuera del repositorio) | `<refs>/quota-relay` y `<refs>/usage-auto-resume`, clon superficial. No se instalaron ni se copió su código. |
| SDK de contraste | `@getpaseo/plugin`, `@getpaseo/client` y `@getpaseo/protocol` 0.17.4 y 0.17.5 en `<sandbox>/v0.17.4` y `<sandbox>/v0.17.5`. |
| Citas | `plugin: ruta:línea`, con la línea contada dentro de su fichero en el commit indicado. |
| Documentación en línea | `paseo.sh/docs` respondió, pero su contenido se renderiza en cliente. Se usó solo como contexto. La verdad de referencia son los tipos instalados. |
| Fuera de alcance | Comportamiento en ejecución, cuentas reales, versiones distintas de 0.17.4 y 0.17.5. |

## Resumen y recomendación

1. **Ninguno de los dos usa los schedules ni los heartbeats nativos de Paseo.** Ambos mantienen un `setInterval` de 30 s y un JSON propio en el home de Paseo (QR `index.server.ts:87`, UAR `index.server.ts:118`; QR `server/jobs.ts:42`, UAR `server/store.ts:67`). La API de plugin (`paseo.agents`, `paseo.providers`, `paseo.workspaces`, `paseo.config`) no expone schedules. Estos solo existen en el cliente del daemon (`scheduleCreate` en `daemon-client.d.ts:1579`).
2. **Ambos dependen del mismo hueco tras reiniciar el daemon.** El temporizador no actúa hasta que un hook o un RPC entrega la API a la instancia (QR `index.server.ts:32,87-89`; UAR `server/resumer.ts:628`). QR lo declara en su README, sección Limits.
3. **La detección fiable es el fallo estructurado del turno.** Ambos leen `outcome.error.{message,code}` en `agent.turn.after`. Para Claude el aviso suele llegar como último mensaje del asistente con el turno completado. UAR lo trata como límite y QR solo como propuesta sin acción (ver A).
4. **UAR hace llamadas de red, lanza CLI y lee credenciales de los proveedores.** Duplica lo que ya hacen las fuentes de uso integradas de Paseo. No es adoptable bajo el principio de no reconstruir autenticación ni facturación.
5. **QR es el patrón útil para el traspaso** (agente nuevo en el mismo workspace con un brief acotado y redactado). Viene apagado por defecto y no archiva el agente original.

**Recomendación.** Escribir un módulo propio y pequeño que combine: la detección de QR (solo fallos estructurados), el reclamo antes de enviar de UAR (como máximo una entrega), la lectura de cuota con `providers.listUsage()` que Zelqio ya tiene y el router que ya exige una observación fresca posterior a la suspensión. No importar ninguno de los dos plugins. Copiar solo patrones y reescribir el código. Camino mínimo al final del documento.

## Comparación

| Aspecto | QR | UAR |
|---|---|---|
| Hook de detección | `addHook("agent.turn.after")` (vigente), `index.server.ts:41` | `server.on("agent.turn_ended")` (alias obsoleto), `index.server.ts:66` |
| Origen del aviso | `failed.error` con código/mensaje; ítems `error` del turno; texto del asistente solo como propuesta | `failed.error`; ítems `error` y `notification`; último mensaje del asistente cuenta como límite |
| Escaneo de paradas perdidas | No | Sí: 200 agentes `idle`/`error` de las últimas 12 h (`server/resumer.ts:366-395`) |
| Hora de reinicio | Texto del aviso; si falta: espera propia (2 min si 429, cooldown de cuenta o 15 min) | Texto del aviso; si falta: consulta ventanas de uso por red/CLI; si falla: reintentos a 15/30/60 min |
| Lectura de cuota | Solo `providers.listUsage()` para ordenar destinos | Propia: HTTPS a Anthropic, ChatGPT y OpenCode; app-server de Codex; `agy /usage`; SQLite |
| Reanudar | `agents.ref(id).send(prompt)` en el mismo agente | Igual, con `activeTurnBehavior: "steer"` |
| Evitar doble envío | Cola serializada, `ticking`, fila vigente, tope de 3 intentos; marca `sent` después del envío | Reclamo persistido `sending` antes del envío; `recover()` descarta lo que quedó a medias |
| Traspaso entre cuentas | Sí, opcional (`autoSwitch` apagado), agente nuevo en el mismo workspace | No |
| Estado persistente | `jobs.json`, `accounts.json` (cooldowns), `history.json`, escritura atómica y propietario único | `jobs.json`, historial |
| Versión declarada | `paseo >=0.17.0` | `paseo >=0.16.0` |
| Superficie sensible | Ninguna fuera de la API de Paseo | Credenciales, procesos, red, SQLite local, Keychain |
| Tamaño aproximado (servidor y compartido, sin pruebas) | ~1.600 líneas | ~3.500 líneas |

## A. Detección del agotamiento

**QR.**
- El hook recibe `event.outcome` (`completed`, `failed` con `{message, code?}`, `canceled`). Tipos: `lifecycle.d.ts:157-166`, 0.17.5.
- `engine.ts:354-357` define `structured`: `failed.error` que cumple `isStructuredLimit`, o un ítem `error` de la línea de tiempo del turno. El turno se lee con `timeline.refetch({direction:"tail", limit:1, wholeTurns:true})` (`engine.ts:213`) y descarta ítems de otro `turnId`.
- `isStructuredLimit` (`shared/limit.ts:71`) confía en códigos `rate_limit*`, `usage_limit_*` (`limit.ts:59`) y descarta contexto/facturación aunque haya código. Sin código exige un aviso corto de ≤400 caracteres (`limit.ts:10`), sin comillas, bloques de código ni citas (`limit.ts:35`) y que coincida con un patrón de proveedor (`limit.ts:12`).
- Un 429 sin ventana ni reinicio es transitorio (`engine.ts:406`, `limit.ts:91`) y solo espera 2 min en el mismo agente (`engine.ts:93`).
- Texto del asistente que parece un límite (`heuristic`, `engine.ts:358`) crea una fila `confirm` que espera al usuario (`engine.ts:381-402`) y no envía nada.
- Ignora agentes en segundo plano (`engine.ts:346`). Un subagente se reanuda en el sitio y nunca se sustituye (`engine.ts:410`).
- No consulta cuota para detectar. `providers.listUsage()` solo ordena destinos (`shared/usage.ts:23,57`).
- No escanea paradas ocurridas con el plugin parado.

**UAR.**
- `detectLimitStop` (`server/limit.ts:74`). Excluye turnos cancelados y códigos de facturación o contexto (`limit.ts:80`). Un aviso de créditos o tope de gasto cuenta como límite (`limit.ts:30`). Un código de la lista `LIMIT_CODES` (`limit.ts:36`) es autoritativo. En otro caso busca patrones (`limit.ts:9`, ≤800 caracteres, `limit.ts:33`) en: mensaje de error, ítems `error`, `notification` no informativas y el último mensaje del asistente (`limit.ts:61-72`).
- El turno se reconstruye con las últimas 20 entradas (`resumer.ts:25,343`). El evento no trae línea de tiempo.
- Según su propio comentario (`resumer.ts:361-365`), Codex deja el agente en `error` con `lastError`, y Claude y Antigravity por ACP terminan `idle` con el aviso como cierre. Por eso trata el cierre como señal. Admite que no hay guarda sobre salida o herramientas en Antigravity (`docs/behavior.md:86`).
- Detección de sobrecarga (capacidad, no cuota) por CLI en `server/overload.ts:6-30`, desactivada por defecto (`shared/settings.ts:63`).
- Escaneo al arrancar (`resumer.ts:366-395`): agentes `idle`/`error` de las últimas 12 h. Los agentes cerrados no se buscan, y tras un reinicio del daemon todos están cerrados (`docs/behavior.md:132`).

**Fiabilidad.** QR minimiza falsos positivos y acepta falsos negativos en Claude. UAR cubre más casos y asume el riesgo de que un mensaje de cierre corto cite un límite. Ninguno distingue de forma nativa cuota de 5 horas, semanal y de modelo salvo QR con `limitScope` (`limit.ts:100`), que no usa para decidir. La cobertura es por cuenta de proveedor, no por proveedor genérico: QR trata cada ID de proveedor de Paseo como una cuenta (`shared/accounts.ts`, comentario inicial).

## B. Hora de reinicio y programación

- **Texto del aviso.** QR (`limit.ts:218`): ISO, epoch en rango 2024–2032, relativo (`in 2 hours 10 minutes`), reloj con zona IANA (`limit.ts:191`), horizonte máximo de 7 días (`limit.ts:38`). UAR (`server/limit.ts:124`): epoch heredado `|ts` (`limit.ts:129`), relativo, ISO, reloj con zona (`limit.ts:171`) y fechas con sufijo ordinal ("Oct 9th, 2026 4:13 AM").
- **Sin hora en el aviso.** QR usa el cooldown de la cuenta o 15 min (`engine.ts:53`) y 2 min en un 429 (`engine.ts:93`). UAR consulta las ventanas de uso del proveedor (`server/subscription.ts`, `exhaustedReset`, `resumer.ts:36`) y, si no puede, reintenta a 15/30/60 min (`shared/schedule.ts:10`), con tope de 24 intentos (`schedule.ts:12`).
- **Margen.** QR añade hasta 60 s de jitter (`engine.ts:95`) y limita 2 envíos por cuenta y ciclo (`engine.ts:55`). UAR añade 2 min de gracia (`schedule.ts:2`).
- **Programación.** Ambos usan un `setInterval` de 30 s y trabajos persistidos. QR: `plugin-data/quota-relay/jobs.json`, `accounts.json`, `history.json` (`server/jobs.ts:42`, `accounts-store.ts:21`), escritura atómica con permisos 0600 (`jobs.ts:101`). UAR: `plugin-data/usage-auto-resume/jobs.json` (`server/store.ts:67`), escritura por rename (`store.ts:110`).
- **Reinicio del daemon.** Sobreviven los trabajos y, en QR, los cooldowns de cuenta. No sobreviven el temporizador ni la API: se reanudan en el primer hook o RPC (QR `index.server.ts:32,87-89`; UAR `resumer.ts:628`, `attach`). UAR descarta lo que estaba en `sending` (`resumer.ts:655`). Un plugin que no recibe ningún evento no reanuda. QR reconoce el límite en su README ("After a daemon restart, scheduled resumes start once a Paseo app is connected").

## C. Reanudación y control de duplicados

- **Mecanismo.** Mensaje al mismo agente con `paseo.agents.ref(id).send(text, opciones?)`. No crean agente nuevo para reanudar. QR `engine.ts:544` (mensaje fijo `DEFAULT_PROMPT`, `shared/settings.ts:42`). UAR `resumer.ts:547` con `activeTurnBehavior: "steer"`, valor válido de `interrupt|steer|queue` (`protocol/dist/messages.d.ts:1342`).
- **Comprobaciones previas.** QR: agente existente y no archivado (`engine.ts:525`), no en curso (`engine.ts:530`), sin mensaje de usuario posterior a la parada (`baseline` frente a `lastUserMessageAt`, `engine.ts:532`), fila aún vigente (`engine.ts:538`). UAR: `agentGate` (`server/decisions.ts:99`): ausente, archivado, proveedor o modelo cambiados, mensaje nuevo, permiso pendiente, turno activo.
- **Doble ejecución.** QR cierra la ventana con una cola serializada y `ticking` (`engine.ts:491`), pero marca `sent` después de enviar (`engine.ts:569`): una caída entre el envío y la escritura puede repetir la entrega. Es una deducción del código, no se probó. Reintenta hasta 3 veces (`engine.ts:51`), y un fallo de envío cuenta como intento con espera creciente. UAR reclama antes de enviar (`resumer.ts:520`, estado `sending`, `store.ts:30`) y `recover()` descarta cualquier `sending` huérfano (`resumer.ts:655`). Garantiza como máximo una entrega y puede perder un envío que sí llegó.
- **Cancelaciones automáticas.** Ambos cancelan si el usuario escribió después de la parada, si el agente se archiva (UAR escucha `agent.archived`, `index.server.ts:70`) o si cambia el modelo/proveedor (solo UAR).

## D. Traspaso entre cuentas (solo QR)

- **Condiciones** (`engine.ts:410`): `autoSwitch` activo (apagado por defecto, `shared/settings.ts:12`), límite de suscripción y no un 429 transitorio, no es un subagente, no se movió antes y `hop < maxHops` (por defecto 1, `settings.ts:21`).
- **Destino.** Cadena de ajustes `provider` o `provider/model` en orden (`shared/handoff.ts:38`), omitiendo cuentas en cooldown. `rebalance` (apagado, `settings.ts:19`) reordena por margen de `listUsage` (`shared/usage.ts:57`); sin dato conserva el orden de la cadena.
- **Ejecución.** `workspaces.ref(workspaceId).agents.create({idempotencyKey, config:{provider}, prompt, title, metadata})` (`engine.ts:301-312`). La clave `quota-relay:<agente>:<turno>` evita duplicados por reintento (`engine.ts:303`). Si no devuelve id, marca ambiguo y no programa nada más (`engine.ts:324`).
- **Contexto transferido** (`shared/handoff.ts:149`): hasta 3 peticiones recientes del usuario (≤700 caracteres, ≤2000 en total) redactadas (`handoff.ts:88`), directorio de trabajo, hasta 20 rutas editadas (solo rutas), nota del usuario y, solo si se activa (`settings.ts:28`), el último mensaje del asistente. Indica al agente nuevo que lea `git status` y `git diff` antes de seguir. Metadatos de linaje: `quota-relay.origin` y `quota-relay.hop` (`engine.ts:60`, `308-309`).
- **Agente original.** No se archiva ni se cancela: no hay llamada de archivado en `engine.ts`. Su fila queda `kind: "handoff"`, `status: "sent"` (`engine.ts:423`). Misma carpeta de trabajo, así que los cambios sin confirmar siguen ahí.
- **Se pierde.** La sesión del proveedor y la transcripción (el agente nuevo parte del brief), el modo de permisos del original (usa el valor por defecto del destino), el punto exacto de razonamiento, y empieza en la raíz del workspace (README, sección Limits). Al compartir directorio, el original y la sustitución pueden escribir los mismos ficheros si alguien reactiva el original.

## E. APIs, permisos y versiones

| Uso | QR | UAR |
|---|---|---|
| Superficies | Servidor + cliente (pantalla y ajustes). `registerSettings` ámbito `host`, RPC con `defineRpc`, hook | Servidor + cliente, `registerSettings`, RPC y suscripción de cambios |
| Hooks | `agent.turn.after` | `agent.turn_started`, `agent.turn_ended`, `agent.archived`, `agent.created`, `agent.closed`, `agent.permission_requested` y `before("agent.session_open")` |
| API de Paseo | `agents.ref().refresh/send/timeline.refetch`, `providers.listUsage/listAvailable`, `workspaces.ref().agents.create` | `agents.list/ref`, `config.get`, `providers.snapshot`, `workspaces.ref().refresh` |
| Acceso externo | Ninguno | `fetch` HTTPS, procesos hijos, SQLite local, Keychain de macOS, ficheros de credenciales |
| Herramientas MCP / schedules | No | No |
| Manifiesto | `paseo >=0.17.0` (`paseo-plugin.json`) | `paseo >=0.16.0` (`paseo-plugin.json:6`) |
| SDK de desarrollo | `@getpaseo/plugin` 0.17.1 | `@getpaseo/plugin`, `client` y `protocol` 0.17.1 |

**Compatibilidad estática con 0.17.4 y 0.17.5.**
- Los hooks `agent.turn.after`, `agent.create.after`, `agent.close.after`, `agent.archive.after`, `agent.turn.before`, `agent.permission.before` y `agent.open.before` existen en ambas versiones. Los alias `on`/`before` que usa UAR están marcados como obsoletos y se eliminarán después del 2027-04-30 (`lifecycle.d.ts:254-256`, 0.17.5). QR usa `addHook`, que es el vigente.
- Los símbolos que ambos consumen tienen el mismo recuento de declaraciones en 0.17.4 y 0.17.5: `listUsage`, `listAvailable`, `snapshot`, `includeBackground`, `idempotencyKey`, `activeTurnBehavior`, `wholeTurns`, `lastUserMessageAt`, `pendingPermissions`, `attentionReason`, `lastError`, `archivedAt`. `workspaces.ref().agents.create` existe (`client/dist/index.d.ts`, `PaseoWorkspaceHandle`).
- Las diferencias entre 0.17.4 y 0.17.5 son aditivas: `terminal.create.before`, `command.run.before`, `wrap`/`launchWrap`, `parentWorkspace`, `livenessHeartbeat`, `includeProviders`. Ninguna toca lo que usan.
- **Conclusión estática:** ambos deberían cargar y funcionar en 0.17.4 y 0.17.5 (QR por manifiesto `>=0.17.0`, UAR por `>=0.16.0`). **No se verificó en ejecución.** No se compiló ninguno contra los tipos instalados porque requeriría instalar sus dependencias. Quedan sin comprobar el comportamiento real de los hooks y de `send`.

## F. Lo que no cubren o arriesgan

- **QR.** No detecta paradas perdidas y no actúa en Claude sin confirmación del usuario (A). La marca `sent` posterior al envío puede duplicar tras una caída. El agente original sigue vivo tras el traspaso. El traspaso envía a otro proveedor contenido del usuario (redactado de forma heurística: `handoff.ts:88` cubre claves y tokens con patrones conocidos). Un destino de la cadena puede ser de facturación por consumo: QR no distingue suscripción de API, así que **el consentimiento queda en manos de la cadena que escribe el usuario**. Cuota no se comprueba de antemano: una reanudación puede llegar antes de que el límite se levante y consume un intento (README, Limits).
- **UAR.** Lee credenciales OAuth de Claude (Keychain y `.credentials.json`, `server/claude-credentials.ts:55,64`), correos de las cuentas (`server/usage.ts:79,84`), llama a `api.anthropic.com/api/oauth/usage` y `/profile` (`subscription.ts:218,228`) y a `chatgpt.com/backend-api/wham/usage` (`subscription.ts:201`), a `opencode.ai/zen/go/v1/usage` (`opencode-usage.ts:9`), lanza `claude auth status`, `codex app-server` y `agy -p /usage` y abre una base SQLite local (`opencode-usage.ts:4`). Documenta que no guarda tokens, pero el acceso existe. Reproduce lo que hacen las fuentes de uso integradas de Paseo (cita explícita en `claude-credentials.ts` a un plugin de Paseo 0.12). Opera solo con Claude, Codex, Antigravity y OpenCode. No transfiere entre cuentas. Las notas de terceros cubren partes de su análisis de avisos (`THIRD_PARTY_NOTICES.md:5,35`).
- **Consentimiento.** QR: activo por defecto para reanudar (`enabled: true`), traspaso apagado por defecto y con tope de saltos. UAR: activo para todos los proveedores salvo los que el usuario desactive (`disabledProviders`, `settings.ts:9`), agentes en segundo plano apagados (`settings.ts:11`).
- **Ninguno** consulta presupuesto, aprobación humana por tarea, ni distingue financiación (suscripción, créditos, consumo). Para Zelqio esto es la diferencia principal: el router y el control de gasto ya existen en el repositorio.
- **Limitaciones comunes.** Los mensajes de reanudación son fijos ("Continue the unfinished work…"), sin conocimiento de la tarea de Zelqio. QR solo trae pruebas unitarias (`test/*.test.ts`); UAR trae una prueba de integración nativa de CLI (`server/native-cli.integration.ts`) que no se ejecutó.

## G. Qué puede adoptar Zelqio Flow

Convención: **PASEO NATIVO** (usar la capacidad tal cual), **REUTILIZAR PATRÓN** (misma idea, código propio reescrito sin copiar), **ESCRIBIR PROPIO** (pequeño).

| Capacidad | Decisión | Mecanismo exacto | Tamaño estimado |
|---|---|---|---|
| Leer cuota y fecha de reinicio | PASEO NATIVO | `paseo.providers.listUsage()` (ya en `server/usage.ts`). Las fuentes integradas (Claude, Codex, OpenCode Go, Copilot, Cursor, Kimi…) hacen la lectura con las credenciales de Paseo | 0 líneas nuevas |
| Cuentas y proveedores disponibles | PASEO NATIVO | `providers.snapshot()` y `providers.listAvailable()` (catálogo ya en `server/providers.ts`) | 0 |
| Detectar agotamiento en un turno | ESCRIBIR PROPIO (patrón de QR) | `addHook("agent.turn.after")`. Solo `outcome.kind === "failed"` con código/mensaje estructurado, más ítems `error` del turno (`timeline.refetch`, `wholeTurns`). El texto del asistente es una pista que exige confirmación del usuario o confirmación por `listUsage` | ~120 líneas + fixtures |
| Clasificar límite frente a facturación/contexto/429 | REUTILIZAR PATRÓN | Listas de exclusión y de códigos, límite de longitud, descarte de texto citado. Reescribir las expresiones con pruebas propias | ~80 líneas |
| Hora de reinicio | PASEO NATIVO primero, texto como respaldo | Preferir `resetsAt` de la ventana de `listUsage`. Si no hay, analizar el aviso (relativo, ISO, epoch, reloj con zona) con tope de 7 días | ~60 líneas |
| Decidir cuándo hay cuota de nuevo | YA EXISTE | `route()` marca `quota_reset_unconfirmed` hasta que una observación fresca posterior a la suspensión muestre cuota (`server/router.ts:126-128`). Es más estricto que la espera por reloj de QR y UAR | 0 |
| Programar la reanudación | PASEO NATIVO (coordinador) o ESCRIBIR PROPIO | El coordinador es un agente con herramientas MCP: `create_heartbeat` o `create_schedule` dirigido a un agente existente (`target.type = "agent"`) con `maxRuns: 1` (campo presente en `CreateScheduleOptions`, `daemon-client.d.ts:573`; la cadencia de un solo disparo no se probó). El daemon concilia las ejecuciones interrumpidas al arrancar (`docs/evidence/S00-paseo-0.17.5-probes.md`). Dentro del plugin no hay API de schedules: el respaldo es un `setInterval` de 30 s con trabajos persistidos y un chequeo al arrancar | 0 con MCP; ~60 con respaldo propio |
| Reanudar el mismo agente | PASEO NATIVO | `paseo.agents.ref(id).send(texto, {activeTurnBehavior:"queue"\|"steer"})`; el heartbeat equivale por MCP | ~20 |
| Evitar doble envío | REUTILIZAR PATRÓN (UAR) | Reclamar antes de enviar con estado persistido y descartar lo huérfano al arrancar. `server/attempt-journal.ts` ya implementa reservas idempotentes con `ambiguous` tras reinicio | ~30 de adaptación |
| Cancelar si el usuario intervino | REUTILIZAR PATRÓN (ambos) | Guardar `lastUserMessageAt` al parar y comparar antes de enviar; cancelar si el agente está archivado, cambió el modelo o hay permiso pendiente | ~40 |
| Traspaso a otro proveedor | REUTILIZAR PATRÓN (QR) | `workspaces.ref(id).agents.create({idempotencyKey, config:{provider}, prompt, metadata})` en el mismo workspace. Destino elegido por `route()` entre modelos autorizados, no por cadena de texto | ~100 + brief |
| Brief de traspaso | REUTILIZAR PATRÓN | Instrucción de la tarea de Zelqio, rutas editadas, checkpoint y orden de leer `git status`/`git diff`. Redacción de secretos y tope de tamaño | ~80 |
| Archivar el agente original | ESCRIBIR PROPIO | Tras confirmar que el agente nuevo corre, archivar o dejar en pausa el original según política, para no tener dos escritores en el mismo árbol | ~20 |
| Pantalla y ajustes | ESCRIBIR PROPIO (fuera del primer ciclo) | Reutilizar las vistas de estado existentes. No copiar las pantallas de los plugins | n/a |

**Licencia.**
- Ambos son MIT. La licencia obliga a conservar el aviso de copyright y el texto de licencia **si se copia código o una parte sustancial**. Ideas, mecanismos y estructura general no están sujetos a esa obligación.
- Recomendación: reescribir sin copiar y no incorporar expresiones regulares ni funciones literales. Si en algún momento se copia código de forma literal, añadir un `THIRD_PARTY_NOTICES.md` con el aviso del plugin de origen (el repositorio ya contempla conservar avisos en `LICENSE-NOTE.md`).
- UAR declara que su análisis de avisos se apoya en `panrafal/paseo-plugins` y `keefeere/paseo-continuity`. Quien copie de UAR hereda también esos avisos (`THIRD_PARTY_NOTICES.md:5,35`).
- Dependencia en ejecución: ninguna. No se instalan ni se importan.

## Solapamiento con el código actual de Zelqio Flow

`index.server.ts` no registra ningún hook y no hay temporizador: **hoy Zelqio no detecta, no programa y no reanuda nada.** Lo existente es política y prueba de contratos.

| Fichero | Hace hoy | Decisión |
|---|---|---|
| `server/usage.ts`, `shared/usage.ts` | Caché de `listUsage` con clasificación `fresh/stale/exhausted/reset/unknown`, antigüedad máxima de 5 min y reintento exponencial. Solo lectura | **Conservar.** Coincide con el patrón nativo de QR (`parseUsage`) y es más estricto (solo `remainingPct === 0` es agotado) |
| `server/fallback.ts` | Diario de propuestas: suspensión por modelo o proveedor al registrar `quota_exhausted`, un único reintento (intento 0→1), sin ejecutar nada | **Conservar el núcleo, simplificar la entrada.** Alimentarlo desde el nuevo hook. Añadir el `resetsAt` observado como dato de espera, no solo `observedAt` |
| `server/router.ts` | Selección por rol, financiación, permisos y cuota; exige observación fresca posterior a la suspensión (`router.ts:126-128`) | **Conservar.** Es el sustituto de la cadena de texto de QR y evita gasto no autorizado |
| `server/attempt-journal.ts` | Reservas idempotentes, una sola activa por tarea, `ambiguous` tras reinicio | **Conservar y reutilizar** como "reclamar antes de enviar" para la reanudación y el traspaso |
| `server/watchdog.ts` | Clasifica la actividad de un coordinador y planifica relevo con epoch y cuota. Solo sobre fixtures normalizadas | **Simplificar o aplazar.** Es relevo de coordinación, no reanudación de tareas. No es necesario para el primer flujo extremo a extremo |
| `server/activity-projection.ts` | Proyecta actividad por proveedor y bloqueadores de cuota para la vista | **Conservar** como vista. Reutiliza `displayedUsageStatus`. No añadir lógica de reanudación aquí |

**Brecha real a cubrir:** hook de detección, trabajo persistido con vencimiento, tic de reanudación, ejecución de `send`/`create` y su evidencia. Todo lo demás ya está.

## Camino más corto a un bucle consciente de cuota

Los pasos 1 a 3 cubren la parada y la reanudación en el mismo agente. Los pasos 4 y 5 añaden el traspaso y el cierre.

1. **Detector.** Un módulo `server/quota-stop.ts` con `addHook("agent.turn.after")`: clasifica solo fallos estructurados y escribe una parada (`agente`, `proveedor`, `modelo`, `resetsAt?`, `turnId`) en el diario con una clave idempotente.
2. **Suspensión.** Alimentar `FallbackJournal.recordFailure({cause:"quota_exhausted", quotaScope})`. El router ya impide reutilizar el destino hasta ver cuota fresca.
3. **Reanudación.** Dos opciones equivalentes: (a) el coordinador crea un schedule o heartbeat `maxRuns: 1` hacia el agente, con `every` igual al tiempo hasta `resetsAt` más un margen y un jitter (disparo único por verificar en 0.17.4 y 0.17.5); (b) un tic de 30 s en el plugin que, con la reserva del `AttemptJournal`, comprueba agente no archivado, sin mensaje nuevo del usuario y cuota fresca, y envía con `send`. Preferir (a) cuando el coordinador está activo y usar (b) como respaldo tras un reinicio.
4. **Traspaso** (opcional, tras aprobación del propietario): `route()` elige entre modelos autorizados; `agents.create` en el mismo workspace con brief acotado; archivar o pausar el original al confirmar el nuevo.
5. **Cierre.** Registrar el resultado (reanudado, traspasado, abandonado tras N intentos) como evidencia y devolver el control al flujo de entrega.

**Hueco compartido que hay que cerrar en el diseño.** Ni QR ni UAR reanudan tras reiniciar el daemon hasta que llega un evento. Zelqio debe, al cargar, leer el diario pendiente y, si hay paradas vencidas, ejecutarlas en el primer hook o RPC recibido, y documentar que sin ninguna conexión de la app no hay ejecución.

## Limitaciones de este informe

- Análisis estático. No se ejecutó ningún plugin ni se arrancó un daemon, así que el comportamiento real de `agent.turn.after`, de `send` con `activeTurnBehavior` y de `agents.create` con `idempotencyKey` no está verificado aquí.
- Las afirmaciones sobre Claude (aviso como cierre con turno completado) provienen del código de UAR (`resumer.ts:361-365`) y de su documentación. No se reprodujo con una cuenta real.
- La duplicación posible en QR es una deducción del orden de operaciones, no una reproducción.
- Los números de línea corresponden a los commits `e6eda8b` (QR) y `a264271` (UAR) y pueden cambiar con versiones posteriores.
- No se comprobó la política de compatibilidad futura de Paseo más allá de los tipos de 0.17.4 y 0.17.5.
