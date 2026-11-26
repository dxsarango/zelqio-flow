# Architecture proposal (subject to G0)

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
Settings (version, locale, strategy, mode); ProviderPolicy (id, funding, eligibility, reserve); Role (id, candidates, capabilities, permissions); ProjectPolicy (canonical identity, remotes, base, actions, mode); Run (id, rootAgentId, policyVersion, workspaceId); Task (id, runId, dependencies, state, attempts); Worker (agentId, roleId, worktree, baseSha); GitOperation (idempotencyKey, repoId, expectedRefs, status); Evidence (sha, check, outcome, time); Approval (actor, action, sha, policyVersion, timestamp); RoutingDecision (reason codes, data freshness). No prompt completo en logs adicionales.

## Estados
Run: configured → running → awaiting_validation / awaiting_permission / integrating / blocked → completed / cancelled / failed. Task: queued → assigned → running → awaiting_permission / blocked / succeeded / failed / cancelled. Delivery: candidate → checks_pending → ready_for_review / ready_to_merge → merging → merged / delivered_local / blocked. Reconciliar estados reales de Paseo y Git antes de reanudar; no repetir side effects por timeout. Aprobación invalidada por cambio de SHA o política relevante.

## Concurrencia
DAG acíclico; reservar slots antes de crear worker, releases idempotentes; leases recuperables. Lock por identidad canónica del repositorio común (no cwd por worktree); verificar refs y dirty state antes/después de operaciones. Lock propio no excluye procesos ajenos: revalidar y detener ante cambios externos. Un escritor por worktree; lectura concurrente solo si consistente. Git y runtime con journal de intención/resultado; estados desconocidos se reconcilian. Nunca borrar ramas o worktrees ajenos.

## Seguridad de arquitectura
Marca de metadata no es autenticación: verificar identidad real de caller y registro de sesión/rol en servidor. Herramientas propias autorizan cada llamada. No alterar instrucciones globales del usuario. Worktree no es sandbox. Definir capacidades verificadas por proveedor y degradación segura; ninguna promesa de aislamiento absoluto. Ver SECURITY.md.
