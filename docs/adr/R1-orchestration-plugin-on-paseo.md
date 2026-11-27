# R1 — Zelqio Flow como plugin de orquestación sobre Paseo

**Estado: adoptado por directiva del propietario (27 de noviembre de 2026).** Sustituye el enfoque de verificación exhaustiva como precondición universal. Los ADR [S04 · Compositor nativo](S04-native-composer-routing.md) y [S04 · Financiación](S04-funding-policies.md) quedan como material de referencia: sus partes de verificación estricta pasan a ser una **opción** (modo Estricto), no un requisito del producto.

## Principio

Zelqio Flow coordina agentes nativos de Paseo. No reconstruye autenticación, ejecución, facturación, contabilidad de cuotas ni permisos. Usa los proveedores, cuentas, suscripciones y modelos que el usuario ya configuró en Paseo, elige entre los que el usuario autorizó, lee las cuotas que Paseo informa y usa los mecanismos soportados de reanudación.

## Reparto de responsabilidades

| Responsabilidad | Quién | Mecanismo |
|---|---|---|
| Cuentas, autenticación, facturación y planes | Paseo y el proveedor | Configuración existente del usuario. Zelqio Flow no la lee ni la cambia. |
| Catálogo de proveedores y modelos | Paseo | `providers.snapshot()` |
| Cuota y fecha de reinicio | Paseo | `providers.listUsage()` (`remainingPct`, `resetsAt`) |
| Ejecución, permisos y sesión del agente | Paseo | `agents.create/ref/send`, hooks de ciclo de vida |
| Reanudar un agente | Paseo | `agents.ref(id).send(texto, { messageId })`; el `messageId` deduplica reenvíos |
| Evitar duplicar agentes | Paseo | `idempotencyKey` en `agents.create` |
| Autorización de modelos y consumo | El usuario, en los ajustes de Zelqio Flow | Proveedor en uso, financiación declarada y opt-in de consumo |
| Roles y perfiles, estrategia y esfuerzo | Zelqio Flow | `router.ts`, roles, estrategias Balanced, Economy, Quality First y Custom |
| Decidir reasignar o esperar | Zelqio Flow | `RunManager` |
| Orquestación multiagente, DAG, concurrencia | Zelqio Flow | `RunManager` y `task-graph` |
| Git, PR, worktrees, modos de entrega y revisión diferida | Zelqio Flow | Módulos Git y de entrega existentes |
| Power Management, privacidad, almacenamiento local | Zelqio Flow | Sin telemetría; estado local |

## Financiación simplificada

- El usuario declara por proveedor su uso (principal, auxiliar o apagado) y su financiación (suscripción, gratuito, local o consumo). Eso **es** la autorización. Zelqio Flow no intenta acreditar la facturación de cada modelo.
- Nunca habilita créditos adicionales ni servicios de pago, ni cambia cuentas, endpoints o configuraciones de facturación. El consumo exige el opt-in explícito que ya existe y nunca se elige por defecto ni como reasignación.
- La interfaz informa de la limitación: una suscripción o una etiqueta de gratuito **no garantiza** la ausencia de cargos. Cuando Paseo expone una señal (por ejemplo, el detalle de uso adicional o el saldo de créditos), se muestra; cuando no, se dice que no se puede verificar.
- El modo **Estricto** (financiación técnicamente verificada, [`funding-verification.ts`](../../server/funding-verification.ts) y [`selection-authority.ts`](../../server/selection-authority.ts)) se conserva como opción para quien la necesite. No es precondición de ninguna otra función.

## Experiencia nativa

El usuario abre New Agent o New Workspace, activa **Automatic** y escribe. Activar Automatic es el consentimiento para que Zelqio Flow elija el modelo, así que no hace falta saber si el valor anterior era un valor por defecto o una elección: con Automatic apagado Zelqio Flow no toca nada. El hook `agent.create.before` reescribe proveedor y modelo, descarta modo, razonamiento y opciones que no valen para el nuevo proveedor, y deja constancia en la metadata. `agent.create.after` adopta la sesión en el mismo bucle de cuotas. Si un caso concreto exigiera procedencia, la petición mínima a Paseo sigue en el ADR del compositor, pero **ya no bloquea** el producto.

## Código existente

| Componente | Decisión |
|---|---|
| `router.ts`, roles, ajustes y estrategias | Conservar. Es el núcleo de la selección. |
| `usage.ts`, `shared/usage.ts` | Conservar. Lectura de cuotas de Paseo. |
| `attempt-journal.ts` | Conservar. Reservas idempotentes y ambigüedad tras reinicio. |
| `run-manager.ts`, `model-facts.ts`, `quota-signal.ts`, `automatic-routing.ts`, `paseo-agent-port.ts` | Nuevos. Son el bucle real. |
| `task-graph.ts`, `git-*`, `github-evidence.ts`, `worktree-retirement.ts`, `power-policy.ts`, `delivery-decision.ts`, `evidence-preview.ts`, `export-retention.ts`, `activity-projection.ts`, `agent-lifecycle.ts` | Conservar. Se integran en el runtime cuando sus tareas lleguen. |
| `fallback.ts` | Simplificar: la reasignación y la espera viven en `RunManager`. Eliminar el diario de propuestas cuando nadie lo use. |
| `funding-verification.ts`, `selection-authority.ts` | Conservar como modo Estricto opcional, fuera del camino crítico. |
| `coordination-journal.ts`, `watchdog.ts` | Conservar para continuidad del coordinador, fuera del camino crítico. |
| `approval-requests.ts` | Conservar para los modos de entrega. La aprobación humana usa los permisos nativos de Paseo y la revisión de PR de GitHub; no se exige un verificador propio de identidad. |

## Condiciones de aceptación revisadas

| Tarea | Condición anterior | Cambio y justificación |
|---|---|---|
| S04-T02 | Elección explícita preservada con procedencia verificable | Con Automatic activado el usuario delega la elección; con Automatic apagado no se toca. Paseo no necesita exponer procedencia. |
| S04-T06 | Aplicación visible y envío separado, sin escribir en el borrador sin procedencia | No se escribe en el borrador: se decide al crear. El interruptor Automatic es visible. |
| S04-T03 | Registro autoritativo de identidad gestionada | Basta el registro propio de ejecuciones (`runs`) y la metadata `zelqio.run`. Solo se actúa sobre sesiones creadas o adoptadas por Automatic. |
| S04-T04 (G4) | Prueba mínima con garantías de verificación | Se cumple con la prueba extremo a extremo real de la sección siguiente. |
| S07-T01 | Actor humano verificable ligado a SHA y política | Se usan los permisos nativos de Paseo y la revisión de GitHub cuando existe. No se construye un verificador propio de identidad. |
| S00-T07, S00-T08 | Cierre de validaciones de aprobación y de estado real como prerequisito de G9 | Se cierran con la evidencia obtenida; las limitaciones de Paseo (permisos pendientes que se pierden al reiniciar) se cubren con el estado propio de Zelqio Flow. |
| Financiación en general | Financiación verificada por modelo antes de cualquier efecto | Declarada por el usuario, con aviso de las limitaciones. Estricta es opcional. |

Se mantienen sin cambios las protecciones contra pérdida de datos, ejecuciones duplicadas, gasto no autorizado y operaciones sensibles.

## Bloqueos externos reales

- Paseo no ofrece adquisición exclusiva ni época para transferir la coordinación entre agentes: Zelqio Flow usa su propio árbitro.
- El archivado nativo de un worktree sigue retirándolo con fuerza: Zelqio Flow conserva los worktrees de tarea y los retira solo con su comprobación previa.
- Un plugin no recibe eventos mientras el daemon está parado: la reanudación ocurre al primer evento o llamada tras reiniciar, y se documenta.

## Flujo extremo a extremo

1. El usuario envía una tarea (`runs.submit`) o crea un agente con Automatic activado.
2. Zelqio Flow elige un modelo autorizado y crea el agente nativo (o reescribe el modelo al crearlo).
3. Paseo ejecuta el agente. Zelqio Flow observa el fin de turno.
4. Si el proveedor llega a su límite, conserva el trabajo y decide: reasignarlo a otro proveedor autorizado, con un resumen sin credenciales, o esperar a que Paseo informe cuota recuperada.
5. Al recuperarse, reanuda el mismo agente una sola vez. Si el usuario escribió entretanto, deja de actuar.
6. Entrega la respuesta final.
