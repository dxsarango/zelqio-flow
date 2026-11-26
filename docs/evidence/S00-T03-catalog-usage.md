# S00-T03 — Catálogo y cuotas de Paseo 0.17.4

**Progreso.** Catálogo, diagnósticos y ausencia de cuotas verificados en el daemon aislado. Inspección de las fuentes integradas completada. Casos sintéticos de catálogo, ventanas, caché y errores verificados. Queda bloqueado el intento adicional de inspeccionar un reporte existente debido a que otro proceso ocupa el puerto fijo.

Entorno Windows x64. El CLI devolvió `0.17.4` y los manifiestos empaquetados de `@getpaseo/plugin`, `@getpaseo/client`, `@getpaseo/server`, `@getpaseo/protocol` y `@getpaseo/cli` declararon `0.17.4`. Electron 44.2.0 ejecutó los scripts como Node 24.20.0. Las capturas usan UTC.

## Reproducción

Desde la raíz del worktree, en PowerShell, definir `$install` como `<paseo-install>` y `$sandbox` como un directorio **nuevo** dentro de `<sandbox>`, reservado para S00-T03. Verificar que el puerto 16773 esté libre. El mismo directorio no se puede pasar dos veces.

```powershell
$cli = Join-Path $install 'resources/bin/paseo.cmd'
& $cli --version
& $cli provider --help
& $cli usage --help
& $cli usage ls --help
& $cli provider models --help
$env:ELECTRON_RUN_AS_NODE = '1'
$inspect = (Resolve-Path poc/s00-t03/inspect.cjs).Path
& (Join-Path $install Paseo.exe) $inspect | Out-String
& (Join-Path $install Paseo.exe) $inspect read app.asar/node_modules/@getpaseo/client/dist/index.js | Out-String
& (Join-Path $install Paseo.exe) $inspect read app.asar/node_modules/@getpaseo/protocol/dist/messages.js | Out-String
& (Join-Path $install Paseo.exe) $inspect search builtin-plugins 'registerUsageSource|providers:|readFile' | Out-String
node poc/s00-t03/probe.cjs $install $sandbox
node poc/s00-t03/probe.cjs $install (Join-Path $sandbox 'synthetic') synthetic
node --check poc/s00-t03/probe.cjs
node --check poc/s00-t03/sdk.cjs
node --check poc/s00-t03/inspect.cjs
```

El script invoca el mismo ejecutable y punto de entrada que `paseo.cmd`, con una lista explícita de variables. El perfil Windows y los directorios de AppData, XDG y temporales apuntan al sandbox. El PATH del proceso incluye únicamente directorios del sistema y el entorno del proceso no hereda variables de proveedores. La prueba usó un perfil sin archivos de autenticación. Hubo cero agentes y cero prompts. En las primeras ejecuciones Paseo intentó descargar en segundo plano un modelo local de voz y canceló la descarga al detenerse. El script actualizado desactiva dictado y modo de voz, además del relay. El log del daemon sintético confirmó cero inicios de descarga de voz.

El runner ejecuta el equivalente a `daemon config set --home <sandbox> daemon.listen 127.0.0.1:16773`, `daemon config set --home <sandbox> daemon.relay.enabled false`, `daemon start --home <sandbox> --timeout 45` y `daemon stop --home <sandbox>` dentro de `finally`. Las consultas usan `--host 127.0.0.1:16773`. La primera ejecución combinó los dos selectores y la consulta falló con `TARGET_AMBIGUOUS`. El rerun usó solo `--host` para consultas y solo `--home` para el ciclo de vida. [Captura del selector ambiguo](../../poc/s00-t03/fixtures/ambiguous-target.json)

## Contrato público en 0.17.4

El cliente público `@getpaseo/client` se abrió con `createPaseoClient({url: "ws://127.0.0.1:16773/ws"})`, `await client.connect()` y `await client.close()`. La API del plugin se documenta en `context.paseo.providers` para handlers de servidor y en `usePaseo().providers` en cliente. El runtime empaquetado entrega `{paseo, signal}` al handler. [Referencia SDK](https://paseo.sh/docs/sdk/reference#client-providers), [referencia de plugins](https://paseo.sh/docs/plugins/reference)

- `providers.snapshot(options?)` acepta `cwd`, `requestId` e `ifNoneMatch`. Devuelve `entries`, `generatedAt`, `requestId` y, cuando los sirve el daemon, `snapshotHash`, `fetchedAt` por proveedor, `notModified` y el catálogo compacto. Un `ifNoneMatch` igual al hash devolvió `notModified: true` y cero entradas. El consumidor debe conservar la versión anterior. `waitForReady({timeoutMs})` espera a que finalice el estado de carga.
- Cada entrada puede incluir `provider`, `status`, `enabled`, `source`, `error`, `models`, `modes`, `defaultModeId` y `fetchedAt`. Los modelos pueden incluir `id`, `provider`, `label`, `isDefault`, `metadata`, `contextWindowMaxTokens`, `thinkingOptions` y `defaultThinkingOptionId`. El SDK también exporta `listModels(provider, options?)`, `listModes(provider, options?)`, `listFeatures(draftConfig, options?)`, `listControls(draftConfig, options?)` y `diagnostic(provider, options?)`. La disponibilidad y el estado de autenticación dependen del proveedor. El snapshot no ofrece un campo uniforme de autenticación. El diagnóstico de OpenCode devolvió `Auth: Not checked` en esta prueba.
- `providers.listUsage(options?)` acepta `requestId` y devuelve `{requestId, fetchedAt, providers}`. El cliente requiere que el host anuncie `providerUsageList` y, si falta, rechaza con `Update the host to list provider usage.` El CLI `usage ls --refresh` usa la interfaz de reportes de cuenta y sí solicita refresco. El SDK `listUsage` usa la proyección de compatibilidad y no acepta esa opción.
- La proyección genera `providerId` a partir del **ID de la fuente** y puede incluir múltiples filas con el mismo ID. Cada fila incluye `status` (`available`, `unavailable`, `error`), `windows`, `balances`, `details`, `planLabel` y `error`. El `fetchedAt` global es el intento más antiguo de los reportes proyectados, o la hora de la respuesta cuando la lista está vacía. Aunque el esquema admite `fetchedAt` y `nextRefreshAt` por fila, la proyección de 0.17.4 no los asigna.
- Una ventana puede traer `usedPct`, `remainingPct`, `resetsAt` y `durationSeconds`. Ausencia y `null` son posibles. Los balances pueden tener `used`, `remaining`, `limit`, `resetsAt` y unidad `usd`, `credits`, `requests` o `tokens`. `resetsAt` describe cuándo reinicia la ventana. Para juzgar frescura se necesita la hora de observación o intento.
- El esquema de los reportes de cuenta que consulta el CLI admite `fetchedAt` por intento, `successfulAt`, `report.observedAt`, `lastSuccessful` y `loginErrors`. Distingue `unavailable` con problema tipado (`expired`, `rejected`, `no_quota`) de `error` con texto. La proyección del SDK aplana el problema en `error` y omite metadatos por cuenta. La documentación en línea coincide con las dos firmas principales. Validar campos por versión y capacidad del host, ya que el empaquetado anuncia una ruta de compatibilidad para `listUsage`. [Referencia SDK](https://paseo.sh/docs/sdk/reference#client-providers), [historial de Paseo](https://paseo.sh/changelog)

## Fuentes empaquetadas

`registerUsageSource({id, label, icon?, providers?, input, discover, fetch})` registra una contribución en el daemon. La fuente ofrece descubrimiento de cuentas y obtiene reportes; el consumidor lee la salida normalizada por SDK o CLI. El registro inspeccionado no publica RPCs específicos por fuente. La tabla indica las asociaciones declaradas en los puntos de entrada y el estado **observado** con el perfil vacío.

| Fuente `*-usage-source` | Asociación declarada | Cuota observada |
|---|---|---|
| `claude` | Claude, Pi, OMP | Desconocida |
| `codex` | Codex, OpenCode, Pi, OMP | Desconocida |
| `opencode-go` | OpenCode | Desconocida. Fuente específica de Go |
| `copilot` | Copilot | Desconocida |
| `cursor` | Cursor | Desconocida |
| `kimi` | Kimi | Desconocida |
| `grok` | Sin asociación de proveedor declarada | Desconocida |
| `minimax` | Sin asociación de proveedor declarada | Desconocida |
| `openrouter-host` | Sin asociación de proveedor declarada | Desconocida |
| `zai` | Sin asociación de proveedor declarada | Desconocida |

También registran fuentes los plugins de proveedor Antigravity y Muse. Ninguna fuente devolvió una fila de cuenta real en la prueba. Los reportes de Claude y Codex pueden servir a varios harnesses, y OpenCode Go solo cubre su producto homónimo. Para OpenCode Free u otros backends de OpenCode, la evidencia disponible deja la cuota desconocida. La mera existencia de una fuente instalada no permite afirmar que exista una cuota consultable.

## Resultados por comprobación

| Comprobación | Resultado | Comando y observación |
|---|---|---|
| Paquetes y CLI instalados | PASS | `paseo --version` y `inspect.cjs` verificaron 0.17.4 en el CLI y en los cinco manifiestos. Los manifiestos anuncian declaraciones `.d.ts` que el empaquetado local no incluyó para `plugin/server` y `plugin/server/usage`. Se inspeccionaron exportaciones JS, esquemas de protocolo y puntos de entrada integrados. |
| Catálogo y refresco condicional | PASS | `provider ls --host … --json`, `snapshot()`, `waitForReady({timeoutMs: 20000})` y `snapshot({ifNoneMatch: snapshotHash, requestId: "conditional"})`. Se observaron `loading`, `unavailable`, `error`, `ready` y `notModified: true`. |
| Modelos, modos y opciones | PASS | `provider models s00-t03-catalog --host … --thinking --json` devolvió `fixture-model` y la opción `low`. El snapshot devolvió modo `review`, `contextWindowMaxTokens: 8192` y `fetchedAt` del proveedor sintético. |
| Diagnóstico y proveedor ausente | PASS | `providers.diagnostic("claude" | "codex" | "opencode")` devolvió binario ausente. OpenCode indicó que no comprobó la autenticación. `provider models <provider> --host … --json` devolvió `PROVIDER_ERROR` y distinguió en el mensaje proveedor no disponible de ID desconocido. |
| Cuota real ausente | PASS | `providers.listUsage()`, `providers.listUsage({requestId: "repeat"})` y `usage ls --host … --json` con y sin `--refresh` devolvieron listas vacías con el perfil sin cuentas. La marca global cambiaba en respuestas vacías. |
| Inventario integrado | PASS | Lectura de `builtin-plugins/*-usage-source/index.server.ts` y de los eventos `Loaded plugin` del daemon aislado. El log confirmó las diez fuentes; el JSON conserva únicamente el ID público, las asociaciones y si se cargó la fuente. |
| Estados y ventanas de cuota | PASS | Instalar el plugin local con `plugin install <directorio-PoC> --host … --json` y consultar `usage ls` y `providers.listUsage()`. El daemon conservó `0`, `100`, `null` y campo omitido, y devolvió `resetsAt` y `durationSeconds: 18000`. El CLI conservó `problem.kind: "no_quota"`; el SDK devolvió texto de error. Todas las cifras son sintéticas. |
| Caché y frescura | PASS | `usage ls --refresh`, `usage ls`, `providers.listUsage()` y un segundo `usage ls --refresh`. El CLI mostró `fetchedAt`, `observedAt` y `successfulAt`. La consulta sin refresco repitió las marcas anteriores y la última las renovó. El SDK mostró solo la marca global. |
| Consulta de reporte desconocido | PASS | `usage inspect s00-t03-unknown --host … --json` devolvió `REPORT_NOT_FOUND` y código de salida 1. |
| Consulta de reporte existente | BLOCKED | La prueba adicional incluía `usage inspect s00-t03-fixture:available --host … --json`. El nuevo daemon no pudo enlazar el puerto 16773 y el preflight confirmó que otro proceso lo seguía ocupando. El contenido íntegro del reporte existente sí se observó en `usage ls --json`. |
| Catálogo y cuotas de cuentas reales autenticadas | NOT RUN | La prueba excluyó deliberadamente credenciales, configuración y binarios personales. Quedan sin medir cuotas reales, autenticación positiva, caducidad/rechazo reales y datos completos o parciales por cuenta. |
| Compatibilidad contra otras versiones | NOT RUN | Comparación documental e inspección del guard de capacidad en 0.17.4. Solo se ejecutó un daemon de esa versión. |

[Captura CLI y SDK del perfil vacío](../../poc/s00-t03/fixtures/isolated-cli.json), [extractos del daemon con datos sintéticos](../../poc/s00-t03/fixtures/synthetic-excerpts.json), [inventario integrado](../../poc/s00-t03/fixtures/builtin-sources.json)

Una primera instalación local devolvió `enabled: true` y `status: "disabled"` por el interruptor global. Se habilitó `pluginsEnabled` en la configuración del daemon desechable y se verificó `status: "running"`. Un arranque posterior falló con `EADDRINUSE`. Un listener ajeno al POC seguía ocupando el puerto al comprobarlo de nuevo. El daemon sintético previo había terminado y su log confirmó la salida del worker. El primer reintento fallido reemplazó la captura sintética completa en disco. El extracto conserva los valores del resultado exitoso que ya se habían leído. El runner actualizado escribe los fallos de arranque en un archivo separado. [Instalación inicialmente deshabilitada](../../poc/s00-t03/fixtures/plugin-disabled.json), [puerto ocupado](../../poc/s00-t03/fixtures/port-in-use.json)

### Campos que pueden producir las fuentes

Inspección estática del mapeo empaquetado. Estos campos dependen de la respuesta de cada servicio y quedaron sin validar con cuentas reales.

| Fuente | Mapeo inspeccionado |
|---|---|
| Claude | Ventanas de sesión de 5 horas, semana y ventanas con alcance específico si vienen en respuesta. |
| Codex | Ventanas de límite que entregue la cuenta, con posible revisión de código, límites adicionales y saldo de créditos. |
| OpenCode Go | Ventanas del plan Go con sus resets. |
| Copilot | Ventana de interacciones premium cuando el servicio la devuelve. |
| Cursor | Ventanas de plan y balances en USD con fin de ciclo cuando está disponible. |
| Grok | Ventana semanal o mensual y balance de créditos cuando la respuesta aporta esos datos. |
| Kimi y MiniMax | Ventanas con reset cuando el servicio aporta los campos necesarios. |
| OpenRouter host | Saldos en USD y detalles de gasto. |
| Z.ai | Información del plan y su estado, con `windows: []` y `balances: []` en el mapeo inspeccionado. Es una fuente de datos parciales para routing por cuota, incluso si devuelve `available`. |

## Implicaciones para ADR-007 y routing

- Validar por separado elegibilidad, catálogo, autenticación y cuotas. Un modelo listo y un proveedor habilitado pueden coexistir con cuota desconocida. El catálogo permite observar cambios y conservar un snapshot condicional. Usar `fetchedAt` del proveedor si existe y conservar la hora de lectura como metadato propio.
- Mapear fuentes a cuenta, harness y backend con evidencia. `providerId` en `listUsage` puede repetir el ID de la fuente y no identifica una cuenta o modelo de forma inequívoca. Si el alcance es ambiguo, dejar la cuota del candidato desconocida. No comparar porcentajes de ventanas no equivalentes.
- Una lista vacía, una ventana ausente y una medida `null` conservan cuota desconocida. Una medida presente puede ser 0 % o 100 %. Mantener agotado, vencido, error y desconocido como estados distintos. Un `reset` pasado requiere reevaluación con evidencia fresca antes de considerar recuperada la cuota.
- La proyección del SDK alcanza para datos normalizados cuando la identidad y frescura se pueden justificar. La CLI pública valida un contrato más rico por cuenta. Si la versión o el host carecen de una interfaz compatible, o faltan cobertura, identidad o frescura, aplicar el fallback de POC-03 previsto en [Technical feasibility](../TECHNICAL-FEASIBILITY.md) y [Routing policy](../ROUTING-POLICY.md). Registrar los datos desconocidos explícitamente y aplicar la política conservadora de elegibilidad, sin inferencia adicional ni lectura directa de credenciales.

El POC confirma la superficie pública de catálogo y uso en 0.17.4 y su comportamiento con ausencia de datos y reportes sintéticos. La llamada se ejecutó desde el SDK público y el CLI. El plugin desechable produjo los datos de prueba mediante las APIs públicas de registro. ADR-007 y G0 siguen pendientes de decisión.


