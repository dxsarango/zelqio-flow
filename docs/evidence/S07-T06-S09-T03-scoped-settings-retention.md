# S07-T06 / S09-T03 — Ajustes por ámbito y retención de datos locales

Dos funciones del plugin sobre Paseo: (A) modo de trabajo y enrutamiento configurables en tres ámbitos, con valores efectivos visibles; (B) retención y privacidad del estado local de las ejecuciones. No cambia planificación ni ADR.

## Qué se construyó

### A. Ajustes en tres ámbitos (global, proyecto, sesión)

- **Clave de proyecto.** Es el directorio de trabajo del workspace tal como lo informa Paseo, normalizado por `normalizeProjectKey` (`shared/scoped-settings.ts`): barras `/`, sin barra final ni duplicadas y, en rutas de Windows, en minúsculas. Se eligió esa clave y no la raíz de Git porque la raíz exige acceso al sistema de archivos y difiere entre un checkout y sus worktrees. Un directorio dentro de un proyecto pertenece a él; si hay proyectos anidados gana la clave más larga. Las tareas delegadas heredan el proyecto y los ajustes de su coordinador.
- **Esquema (aditivo).** `projects` (por clave: `strategy`, `mode`, `git.workflow`, `remoteAuthorization`, `elevatedConfirmed`) y `retention` en los ajustes. En la ejecución: `projectKey`, `overrides` (estrategia y modo de sesión) y `effective`. Todo es opcional o tiene valor por defecto, así que el estado anterior se sigue leyendo. Los esquemas son estrictos: un proyecto no puede llevar `consumptionOptIn`.
- **Resolución pura** (`resolveSettings`): sesión > proyecto > global, con límites de seguridad que solo restringen:
  - `remoteAuthorization: denied` en cualquier ámbito gana. Un proyecto que pide `per_project` bajo un global `denied` queda denegado, con una nota.
  - La aceptación de pago por uso (`consumptionOptIn`) es solo global.
  - Un modo elevado (`auto_merge`, `autopilot`) en un proyecto cuenta solo con su confirmación explícita (`elevatedConfirmed`). Una sesión no puede superar el modo de su proyecto (o del global si el proyecto no define uno).
  - Cada valor indica el ámbito de origen y las notas explican qué se ignoró.
- **Uso.** `RunManager` (selección de modelo, nivel de razonamiento y entrega Git), `GitDelivery` (también al revalidar antes de publicar) y el enrutamiento automático de las creaciones nativas usan `settingsForRun` o `settingsForDirectory`. La ejecución registra los valores efectivos con los que empezó (`effective`). `runs.submit` acepta `strategy` y `mode` de sesión.
- **Interfaz (EN/ES, compacta).** En Ajustes, la sección «Ajustes por proyecto» muestra los valores globales, permite añadir y quitar proyectos conocidos (los de Paseo y los de ejecuciones anteriores, vía `zelqio.projects.list`), editar cada campo con «Igual que el global» y ver los valores efectivos con su origen y las notas. La lista de ejecuciones muestra el modo y la estrategia efectivos de cada una.

### B. Retención y privacidad

- **Política** (`retention`): conservar ejecuciones terminadas 30 días, conservar resultados 30 días (0 = borrar el texto en cuanto se entrega), máximo 200 ejecuciones terminadas. Ajustable en Ajustes.
- **Depuración** (`server/retention.ts`): `planRetention` es pura y reutiliza `evaluateRetention`. Nunca borra una ejecución activa, una con operación pendiente, con entrega pendiente o con `nextAt`, ni con un intento sin cerrar o ambiguo en el journal. Tampoco borra un hijo entregado mientras su coordinador está activo, ni un coordinador mientras un hijo está activo. El tope de 200 elimina antes las más antiguas sin referencias. `purgeFinished` borra ejecuciones completas y sus entradas del journal de intentos. Nunca toca agentes de Paseo, worktrees ni ramas Git. Se ejecuta con la primera actividad tras arrancar y después cada 6 horas (`ZELQIO_PURGE_MS` para pruebas), o a petición con «Limpiar ahora», siempre dentro de la cola de `RunManager` (`maintain`).
- **Atomicidad e idempotencia.** El archivo `runs.json` se reemplaza en un solo paso (temporal y renombrado). Después se limpia el journal, y cada pasada elimina también las entradas huérfanas de ejecuciones que ya no existen, así que una caída entre ambos pasos se repara en la siguiente pasada. Una segunda pasada sin trabajo no escribe nada. Tras depurar se reescribe una vez el archivo para que la copia `.bak` no conserve prompts ni resultados borrados.
- **Exportación manual**: `exportFixtures` con id, veredicto y SHA. Las ejecuciones sin commit se cuentan como omitidas. El JSON se muestra para copiarlo; no se guarda ni se envía.
- **Borrar todo el estado local**: elimina `runs`, `attempts`, los journals de Git y de enrutamiento, las aprobaciones y la coordinación, con sus copias `.bak`, temporales y corruptas. Se rechaza (`disabled`) mientras exista una ejecución activa, una entrega pendiente o un intento sin cerrar. Conserva `git-projects.json` (autorizaciones del usuario), la configuración (la guarda Paseo) y cualquier archivo ajeno. En la interfaz pide una segunda pulsación.
- **Privacidad.** Los mensajes de error y los avisos de historial de una ejecución se guardan con `redactSecrets`. La comparación de «el mismo error ya procesado» usa el texto redactado. Pruebas estáticas comprueban que el código no importa módulos de red, que solo `git-runner` y `power-manager` lanzan procesos, que solo `store` y `retention` escriben archivos y que no hay telemetría.

## Cómo se verificó

`npm run check` en el worktree: tipos, lint y 511 pruebas (antes 444; 1 omitida como antes). Nuevas pruebas:

- `test/scoped-settings.test.ts` (24): compatibilidad del estado anterior, clave de proyecto, precedencia, `denied` en cualquier ámbito, ausencia de vías para conceder publicación o pago por uso, confirmación de modos elevados, sesión sin elevar sobre su proyecto, pureza. También integración con `RunManager`: valores registrados, nivel de razonamiento por proyecto y por sesión, entrega con los valores resueltos, herencia en tareas delegadas y enrutamiento automático.
- `test/retention.test.ts` (32): cada regla de retención y referencia, tope, borrado de resultados, atomicidad con fallo inyectado, reparación tras caída entre pasos, idempotencia sin escrituras, la copia `.bak` sin datos borrados, exportación, borrado total con sus rechazos, privacidad (estática y con un flujo real con `fetch` bloqueado) y redacción de credenciales.
- `test/local-state-rpc.test.ts` (7): RPC a través de la entrada del plugin.
- Paridad EN/ES y estados nuevos en `i18n-states`.

## Límites

- La interfaz se verificó con tipos, lint y paridad de traducciones. No se abrió en una app de Paseo ni se hizo revisión visual móvil: no se ejecutaron daemons, como se pidió.
- La entrega usa los valores resueltos con la configuración actual, no los registrados al empezar. Si el usuario restringe la publicación con una entrega en curso, se aplica; `effective` es un registro de lo que la ejecución usó al empezar. Una ejecución en cola aún no lo tiene.
- Un override de sesión solo se pasa por `runs.submit`. Las creaciones nativas con Automático usan global y proyecto, y no hay selector de sesión en la interfaz.
- `redactSecrets` es heurística. Solo cubre mensajes de error y avisos. El texto del resultado del agente se guarda tal cual, porque es contenido del usuario. Los prompts y resultados están en texto plano en el directorio de estado, protegido solo por los permisos del sistema.
- Una ejecución bloqueada con worktree retenido se purga al cumplir el plazo: se pierde su registro, no la rama ni el worktree.
- Entre la depuración del archivo de ejecuciones y la reescritura de su copia `.bak` hay una ventana mínima en la que una caída deja los datos borrados en la copia hasta la siguiente escritura.
- Las pruebas de privacidad estáticas son heurísticas por patrones, no una prueba formal. La entrega remota por Git que ya existía (acción del usuario) usa red a través de `git` y `gh`.
- Ediciones en `run-manager.ts` y `git-delivery.ts`: el parámetro `run` de `revalidate` y de `readSettings`, las llamadas a la resolución, `maintain` y la redacción de errores. Pueden chocar con los cambios paralelos de esos archivos.
