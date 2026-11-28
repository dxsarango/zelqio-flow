# S11 · Bloqueo de agentes, entrega de sesiones adoptadas y Smart Review

Tres comportamientos del producto, con pruebas. `npm run check` pasa con 469 pruebas y 7 omitidas por defecto (la prueba GitHub optativa anterior y las seis del sandbox de Smart Review).

## 1. Detección de bloqueo

Un agente en estado `running` sin ninguna actualización durante más de 45 minutos se marca como bloqueado. El umbral se configura con `stallMs` en `RunManagerDeps` (cero lo desactiva) y, en la instalación, con `ZELQIO_STALL_MS` para pruebas.

- La instantánea del agente trae `updatedAt` y el inicio del turno activo (`activeTurn.startedAt`) de Paseo. El último progreso es el mayor de ambos. Sin ninguno de los dos, el producto no puede afirmar nada y no marca.
- No se marca si hay un permiso pendiente (espera al usuario), si el agente no está en `running` o si la ejecución espera cuota (`waiting_quota`). Entrar en `waiting_quota`, entregar, fallar o cancelar borra la marca.
- Al marcar se fija `run.attention`, `run.stall.lastProgressAt` y una sola nota `stalled` en el historial. Si el agente progresa de nuevo se borra todo y se añade una nota `progress`. Nunca se cancela, reenvía ni reemplaza al agente.
- La lista de ejecuciones muestra «No progress for N minutes: check this agent in Paseo» / «Sin progreso desde hace N minutos: revisa este agente en Paseo». N se calcula en el cliente a partir de `lastProgressAt`.
- Los campos del esquema son aditivos y opcionales; las ejecuciones guardadas antes se leen igual.

Pruebas: ocho casos en `test/run-manager.test.ts` con el fake de Paseo y un reloj controlable (umbral, una sola nota, progreso, permiso, cuota, sin hora de actualización, desactivado, entrega).

**Límite.** El umbral solo es tan bueno como `updatedAt` de Paseo. No se pudo ejecutar un daemon en esta tarea, así que no se verificó que `updatedAt` avance con cada mensaje del agente durante un turno largo. Si Paseo solo lo actualiza al cambiar de estado, un turno legítimo de más de 45 minutos se marcaría como bloqueado (solo se avisa; nunca se actúa).

## 2. Entrega Git de sesiones adoptadas

`RunManager.adopt` guarda ahora la línea base del checkout del agente: SHA de `HEAD`, rama y lista de archivos ya modificados o sin seguimiento (`run.adopted`). No mueve el checkout. Cuando la ejecución se entrega, `GitDelivery.adopt` decide:

| Situación | Resultado |
|---|---|
| Sin cambios ni commits nuevos | `no_changes` |
| Checkout principal del usuario (el directorio Git es el común) | `manual` con motivo `main_checkout`. No se hace commit, rama ni push. Se muestra el siguiente paso exacto, por ejemplo `git switch -c feat/… && git add -A && git commit -m "feat: …"`, o solo `git branch feat/…` si ya hay commits |
| Worktree enlazado (incluidos los de Paseo) con la línea base limpia y el historial intacto | Commit Conventional Commit en una rama nueva `type/descripcion-id`, y entrega por los mismos modos (`local_only`, `pull_request`, `direct`; `review_first`, `auto_merge`, `smart_review`) |
| La línea base ya tenía archivos modificados | `manual`, `baseline_dirty`. No se pueden atribuir al agente |
| `HEAD` ya no desciende de la línea base o es otro repositorio | `manual`, `checkout_moved` |
| Archivos de credenciales, operación Git en curso | `blocked` (`sensitive_content`, o `operation_in_progress` con reintento) |

Cómo no mueve ni pierde nada:

- El árbol se construye con un índice privado (`GIT_INDEX_FILE` dentro del directorio Git del worktree, borrado al terminar). El índice real, la rama y `HEAD` del agente no cambian, y no hay `stash`, `reset`, `checkout` ni fuerza.
- El commit se crea con `commit-tree` sobre el `HEAD` del agente, así que conserva los commits que el agente ya hizo y añade los cambios sin confirmar. La rama nueva se crea con `update-ref` esperando que no exista, dentro del journal de operaciones (idempotente tras un reinicio).
- Para publicar se añade un worktree propio en el directorio de estado del plugin (`adopted/<run>`) que apunta a esa rama. Desde ahí corre el mismo `deliver` de las ejecuciones gestionadas. Al terminar se retira con `git worktree remove` sin fuerza; la rama se conserva y el checkout del agente sigue intacto con sus cambios.
- Una ejecución adoptada que termina en `failed` o `cancelled` sin entregar queda `unmanaged`.

Pruebas (`test/adopted-delivery.test.ts`, 17, con repositorios Git temporales reales, worktrees enlazados y un remoto bare): línea base, commit sin tocar el checkout (rama, `HEAD`, índice y archivos iguales), repetición idempotente, `direct` hasta el remoto, commits propios del agente, sin cambios, checkout principal limpio o con commits, línea base sucia, historial movido, credenciales, operación en curso, y el `RunManager` completo con un agente adoptado.

**Límites.** El agente puede haber editado antes de que se registre la línea base (se registra al crear el agente): en ese caso la entrega pasa a `manual`, que es el lado seguro. Un checkout principal siempre es manual, aunque esté en una rama de trabajo. Un worktree enlazado es la condición, no que sea de Paseo: no se detecta si lo creó Paseo. La publicación por PR exige que la base remota coincida con el `HEAD` de la línea base, como en las ejecuciones gestionadas. La retirada del worktree de entrega no pasa por Paseo, porque ese worktree no es un workspace de Paseo. Si el checkout del agente se borra antes, la retirada se deja pendiente y se conserva.

## 3. Smart Review y revisión diferida en GitHub

Repositorio usado: `dxsarango/zelqio-flow-s00-public-sandbox`, el único. Las pruebas están en `test/smart-review-sandbox.test.ts`, solo se ejecutan con `ZELQIO_SMART_REVIEW_SANDBOX=<escenario>` y llaman a `GitDelivery.deliver` con `mode: smart_review` y `workflow: pull_request`. No se tocó `dxsarango/zelqio-flow` ni otro repositorio, ni se usó `--admin`.

**Protección de `main`.** Estado inicial: `fixture-check` (app 15368) estricto, `enforce_admins`, una aprobación con descarte de obsoletas y aprobación del último push, historial lineal desactivado, sin force push ni borrado. Con una aprobación requerida el producto responde `review / human_approval_required` y no fusiona; lo confirmó el escenario `protected` (PR [#9](https://github.com/dxsarango/zelqio-flow-s00-public-sandbox/pull/9) y [#10](https://github.com/dxsarango/zelqio-flow-s00-public-sandbox/pull/10), cerrados). Además el producto exige historial lineal activo para dar por verificadas las protecciones. Para probar la integración automática fue necesario, solo durante la prueba y solo con la propia configuración del repositorio (`gh api -X PUT repos/<sandbox>/branches/main/protection`): quitar el requisito de revisión y activar el historial lineal. Después se restauró con los mismos valores.

Verificación con `gh api` antes y después: el JSON de protección, sin las URL, es idéntico (`diff` sin diferencias). `required_signatures`, auto-merge, squash y borrado de ramas al fusionar no cambiaron.

| Escenario | Cambio | Resultado del producto | PR | SHA |
|---|---|---|---|---|
| Docs | `docs/smart-review-*.md` | `merged` tras `fixture-check` verde en el SHA exacto | [#11](https://github.com/dxsarango/zelqio-flow-s00-public-sandbox/pull/11) | `c19538ab939871ae04bc0b4fe84996ea0aaa111d` |
| Solo pruebas | `test/smart-review-*.test.js` | `merged` | [#12](https://github.com/dxsarango/zelqio-flow-s00-public-sandbox/pull/12) | `cde3533ad84d905a907e160e30cf5d06caee3748` |
| Riesgo desconocido | `src/*.js` | `review / unknown_risk`, PR abierto y sin fusionar | [#13](https://github.com/dxsarango/zelqio-flow-s00-public-sandbox/pull/13) | `bf468a622ac6045f66a604be9e7c846ace67772b` |
| Sensible | `package.json` | `review / human_approval_required`, sin fusionar | [#14](https://github.com/dxsarango/zelqio-flow-s00-public-sandbox/pull/14) | `5fbd136ec6f689eec134bc07057ef711d64a326d` |
| Interfaz reversible, sin ventana | `client/*.css` | `review / validation_environment_required` | [#15](https://github.com/dxsarango/zelqio-flow-s00-public-sandbox/pull/15) | `e164bcb87ac8383c513cf54f6febb41b1ac66857` |
| Interfaz reversible, con ventana ligada | el mismo PR | `merged` con `reason: review_deferred` | [#15](https://github.com/dxsarango/zelqio-flow-s00-public-sandbox/pull/15) | `e164bcb87ac8383c513cf54f6febb41b1ac66857` |

`gh api repos/<sandbox>/commits/<sha>/check-runs` confirmó `fixture-check` de la app 15368 completado con éxito en los SHA de #11, #12 y #15, y `gh api …/pulls/<n>` confirmó `merged: true` y `head` igual al SHA verificado. Las fusiones usaron `gh pr merge --squash --match-head-commit`. Los PR #13 y #14 se cerraron sin fusionar y los PR #9 y #10 también. Las ramas de prueba ya no existen en el remoto. Los PR abiertos #1, #3, #4 y #6 existían antes y no se tocaron. `main` del sandbox conserva los archivos que añadieron #11, #12 y #15.

### Revisión diferida: qué hace y qué no

Hace (validado en #15):

- Solo en `smart_review`, solo para cambios reversibles de interfaz (`client/`, `ui/`, `frontend/`, `.css`). Sin ventana, el PR espera con `validation_environment_required`.
- Una ventana se declara en `git-projects.json` (estado del plugin, nunca desde el checkout ni el agente) con `taskId`, `sha`, `destination`, `expiresAt` y las dos confirmaciones. Si está caducada, o el SHA o la tarea no coinciden, el resultado sigue siendo `review`. Se probaron la ventana caducada y el SHA distinto, ambos sin fusión.
- Con la ventana vigente y ligada se fusiona solo si siguen válidos los checks del SHA exacto y las protecciones; un cambio de evidencia o el vencimiento durante la operación lo detiene.
- El resultado queda como `merged` con `reason: review_deferred`, el cliente muestra «Pull request merged. Deferred review is pending.» y el worktree se conserva (`retire` devuelve `false`), de modo que el propietario puede revisar el candidato.
- No concede nada fuera de eso: una aprobación requerida por la protección sigue bloqueando (escenario `protected`), y lo sensible o desconocido sigue esperando a una persona.

No hace:

- No verifica la revisión independiente ni el entorno de validación: son confirmaciones escritas en la política local (`independentReview`, `validationEnvironment`). Quien edita ese archivo las atestigua.
- No guarda ni lista las revisiones diferidas pendientes con el PR, el SHA, las pruebas, el entorno y qué comprobar, ni las agrupa por flujo. Solo queda el estado de la ejecución. Ese registro sigue siendo manual, según `planning/DEVELOPMENT-WORKFLOW.md`.
- No aplica la instrucción «hasta el final de esta ejecución» ni «hasta que regrese»: la ventana termina únicamente por `expiresAt` o porque se quite la entrada.
- No distingue «pendiente de revisión diferida» después de reiniciar salvo por `reason` y el worktree retenido.

## Verificación

- `npm run check`: typecheck, lint y 469 pruebas pasadas, 7 omitidas.
- Los escenarios del sandbox se ejecutaron uno por uno con `ZELQIO_SMART_REVIEW_SANDBOX=<escenario>`. Sus recibos se guardan en el fichero que indique `ZELQIO_SMART_REVIEW_EVIDENCE`.
