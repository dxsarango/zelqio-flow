# Architecture — Foundation y evolución del MVP

TypeScript, SDK oficial fijado por versión; UI React/componentes nativos según SDK. Plugin cliente para controles, onboarding y actividad; servidor en daemon para decisiones, estado y herramientas. Core puro sin dependencias de Paseo para test. Paseo adapter, Git adapter y GitHub adapter encapsulan efectos. No procesos de IA propios para routing.

## Componentes
- Provider catalog / Usage Manager: capacidades, auth disponible, ventanas, frescura, errores.
- Smart Router: filtro elegibilidad y ranking determinista; razón y snapshot de decisión.
- Role Engine: responsabilidades, candidatos, permisos y restricciones; no perfiles nativos.
- Policy Engine: autorización de proyecto/acción, estrategia, modo, riesgo; denegación prevalece.
- Task Coordinator: DAG, lease/concurrencia, worker identity, cancelación, handoff, recolección y recuperación.
- Git Coordinator: preflight, base SHA, worktree, commits, integración serializada, publicación y verificación.
- Delivery Engine: clasificación por impacto, checks, approvals, preview, estados de entrega.
- Persistence / Activity: datos versionados, operaciones idempotentes, journal y reconciliación.

## Interfaces conceptuales
`ProviderCatalog.snapshot()`, `UsageReader.read()`, `Router.select(role, candidates, context)`, `Policy.authorize(action, scope)`, `TaskService.delegate(rootId, role, spec)`, `GitService.integrate(taskId, expectedSha)`, `Delivery.evaluate(taskId, evidence)`. Nombres internos propuestos, no APIs reales de Paseo.

## Entidades
Settings (version, locale, strategy, mode); ProviderPolicy (id, funding, eligibility, reserve); Role (id, candidates, capabilities, permissions); ProjectPolicy (canonical identity, remotes, base, actions, mode); Run (id estable, raíz vigente, época y lease, historial de coordinadores, política, workspace); Task (id, runId, dependencies, state, attempts); WorkerAttempt (taskId, attemptId, agentId, coordinatorEpoch, roleId, workspaceId, baseSha); GitOperation (idempotencyKey, repoId, expectedRefs, status); Evidence (sha, check, outcome, time); ApprovalRequest (id, taskId, projectId, action, target, sha, policyVersion, state); ApprovalDecision (requestId, decisión, actor verificado, fuente de autoridad, tiempo); RoutingDecision (reason codes, data freshness). Conservar referencias y evidencia mínima, sin incorporar conversaciones completas.

## Estados
Run: configured → running → awaiting_validation / awaiting_permission / integrating / blocked → completed / cancelled / failed. Task: queued → assigned → running → awaiting_permission / blocked / succeeded / failed / cancelled. Delivery: candidate → checks_pending → ready_for_review / ready_to_merge → merging → merged / delivered_local / blocked. Reconciliar estados reales de Paseo y Git antes de reanudar; no repetir side effects por timeout. Aprobación invalidada por cambio de SHA o política relevante.

## Concurrencia
DAG acíclico; reservar slots antes de crear worker, releases idempotentes; leases recuperables. Lock por identidad canónica del repositorio común (no cwd por worktree); verificar refs y dirty state antes/después de operaciones. Lock propio no excluye procesos ajenos: revalidar y detener ante cambios externos. Un escritor por worktree; lectura concurrente solo si consistente. Git y runtime con journal de intención/resultado; estados desconocidos se reconcilian. Nunca borrar ramas o worktrees ajenos.

## Seguridad de arquitectura
La marca de metadata registra la intención. Cada efecto verifica su autoridad en el servidor. La selección de un modelo puede reutilizar una política vigente y acotada. Lanzamiento, delegación, operaciones sensibles, aprobación humana y gasto conservan sus controles propios. Las herramientas propias autorizan cada llamada y verifican el registro de sesión y rol cuando corresponda. Preservar las instrucciones globales del usuario. Los worktrees separan checkouts de Git. El aislamiento del sistema de archivos requiere una frontera verificada por separado. [Autoridad de routing](adr/S04-routing-authority.md) · [Política de seguridad](SECURITY.md)

## Continuidad, aprobación y retirada

- **Relevo del orquestador.** Ante agotamiento, detener nuevas asignaciones, registrar el cambio y reconciliar los intentos de la ejecución antes de transferir el lease a una nueva época. Los efectos rechazan una época antigua. Vincular cada sesión nativa a un intento estable incluso si Paseo desprende, archiva o reinicia la raíz. Reincorporar un proveedor al catálogo por una señal válida o confirmación explícita, sin reactivar la raíz anterior ni cambiar el dueño de trabajo en curso.
- **Aprobación durable.** Guardar la solicitud antes de mostrarla y la decisión verificada antes del efecto. Al reiniciar, reconciliar por ID e invalidar la solicitud o decisión ante cambios de SHA, alcance o política. Un registro pendiente o una fuente sin actor verificable carece de permisos. Una alternativa externa debe aportar autenticación independiente del agente y evidencia vinculada a la misma revisión. Si falta, la ejecución autorizada se deja al propietario fuera del automatismo.
- **Retirada segura.** Revalidar el Git común, refs, índice, archivos ignorados y sin seguimiento, tareas u operaciones activas y validaciones. Paseo 0.17.4 usa retirada forzada en worktrees administrados. Desactivar esa ruta y conservar los checkouts. La sonda de worktrees de propiedad externa separa archivado del registro y retirada sin fuerza por Git. Ampliar las pruebas antes de recomendarla para tareas normales. Si el aislamiento o la retirada segura no se pueden garantizar, preferir ejecución secuencial.
- **Capacidades por destino.** Verificar protecciones, checks y SHA efectivo antes de efectos GitHub. Auto-merge y cola necesitan reglas verificadas y un mecanismo que conserve la autorización por candidato durante la espera. La falta de capacidad restringe el modo aunque la API acepte una escritura.

## Habilitación por madurez y evidencia

Foundation opera en Windows con Paseo 0.17.4, un escritor supervisado por unidad de ejecución y recuperación manual. Las operaciones sensibles se entregan al propietario. Advanced Orchestration incorpora adaptadores y controles de concurrencia, relevo, persistencia, limpieza y Smart Review conforme a los gates existentes. Complete MVP exige todos los requisitos de producto y los gates de distribución.

El punto que produce cada efecto debe comprobar el nivel aprobado, compatibilidad real de plataforma y versión, evidencia vigente de la capacidad, autorización del proyecto y precondiciones del destino. Si falta una prueba, cambia el contexto o una fuente es inaccesible, mantener el efecto deshabilitado y exponer el motivo. Los controles de UI reflejan esa decisión. Un valor de configuración o una afirmación de sesión por sí sola carecen de autoridad. [Matriz de validación](VALIDATION-BACKLOG.md).

El RPC consultivo de routing combina catálogo, preferencias y declaraciones temporales por modelo. Preserva la separación entre recomendación, selección de borrador y creación de sesión. Los adaptadores que ejercen autoridad requieren evidencia vigente del ámbito, modelo, ruta de facturación y restricciones efectivas, también durante la recuperación.
