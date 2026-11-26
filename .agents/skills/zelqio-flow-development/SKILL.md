---
name: zelqio-flow-development
description: Inicia, recupera y coordina el ciclo continuo de desarrollo de Zelqio Flow siguiendo planning/tasks.json. Úsala en cada inicio o relevo de coordinación y para tareas S00–S10 o gates G0–G10.
---

# Zelqio Flow — desarrollo continuo

Fuente de verdad: archivos del repositorio. `planning/tasks.json` = estado de ejecución; `planning/PLAN.md` = vista legible; ambos coherentes. Engram (si existe) solo ayuda a la continuidad. No crear otro mecanismo de planificación. Solo el orquestador raíz escribe tasks.json/PLAN.md.

Si eres worker (briefing delegado): ejecuta solo tu tarea, reporta y no uses esta skill para delegar.

La continuidad es el comportamiento predeterminado de cualquier orquestador autorizado, también tras reinicio, conversación nueva o relevo. Aplicar el [ciclo continuo](../../../planning/DEVELOPMENT-WORKFLOW.md#ciclo-continuo), los umbrales de cuota y el relevo seguro. Preparar un punto de recuperación antes del relevo, preservar workers y sesiones, y mantener un solo coordinador autorizado.

## Ciclo

1. **Leer**: `AGENTS.md`, `README.md`, `docs/PRD.md`, `planning/DEVELOPMENT-WORKFLOW.md`, `docs/GIT-POLICY.md`, `docs/SECURITY.md`, `planning/tasks.json`; el resto de `docs/` según la tarea. Consultar Engram (`zelqio-flow`) solo por lo necesario.
2. **Evidencia real**: `git status`, `git branch -a`, `git worktree list`, `git log --oneline -15`; `gh pr list` y `gh run list` del repo; agentes/workspaces de Paseo activos (si hay herramientas Paseo).
3. **Reconciliar**: contrastar tasks.json con la evidencia. Corregir discrepancias (tarea `in_progress` sin rama/agente vivo, PR fusionado no registrado, etc.) y anotar la corrección. La evidencia real prevalece.
4. **Clasificar** cada tarea: `done`, `in_progress`, `awaiting_validation`, `blocked`, `todo` elegible (todas sus dependencias `done` y la fase autorizada) o `todo` no elegible. Estados válidos: `todo`, `in_progress`, `awaiting_validation`, `blocked`, `done`.
5. **Recuperar** trabajo incompleto antes de iniciar nuevo: revisar ramas/worktrees/agentes huérfanos, `git diff`, `get_agent_activity`; continuar desde el último estado verificable. Nunca borrar trabajo ajeno.
6. **Seleccionar** el lote: tareas elegibles independientes (archivos no solapados), máx. 3 concurrentes salvo ajuste documentado. Distinguir implementación, integración y habilitación. Preparar contratos, simulaciones y fixtures con dependencias de implementación satisfechas. Mantener gates y autorizaciones de integración y habilitación. G0 autoriza Foundation. G9 y G10 conservan las validaciones y aprobación explícita.
7. **Antes de iniciar cada tarea**: verificar dependencias, que nadie más la ejecute, alcance, criterios, archivos afectados, rol/proveedor, aislamiento. Marcar `in_progress` (owner, branch) y commitear ese estado junto con el trabajo, no por separado salvo que sea necesario.
8. **Delegar** solo si aporta valor (tareas independientes, escritura en worktree propio, revisión cruzada según riesgo). Ejecutar directamente si es más barato que el briefing. Con herramientas Paseo, aplicar la política global de orquestación del entorno (perfiles, proveedores, cuotas, worktrees); sin ellas, trabajar directamente. Briefing: ID, objetivo, dependencias aceptadas, archivos permitidos, non-goals, aceptación, comandos de verificación, riesgo, formato de entrega. Los workers no delegan, no hacen push/merge.
9. **Integrar y validar**: revisar el diff real; ejecutar las comprobaciones; integrar en serie; verificar el resultado consolidado. Nunca marcar `done` por el relato de un worker.
10. **Registrar** en tasks.json: `status`, `owner`, `branch`, `pr`, `blockers`, `evidence` (lista de objetos: `{kind, command, result: PASS|FAIL|BLOCKED|NOT_RUN, sha, date, notes, limitations}`; local y CI separados, sin secretos ni rutas personales). Reflejar en PLAN.md si cambia algo visible. Guardar en Engram solo decisiones/aprendizajes durables.
11. **Limpieza segura**: al cerrar una tarea, aplicar la política de `planning/DEVELOPMENT-WORKFLOW.md#limpieza-segura-de-worktrees`. Archivar workspaces solo tras verificar preservación, actividad y validaciones; excluir el checkout principal.
12. **Repetir** después de registrar y verificar cada tarea o lote. Consultar cuota y turnos activos, preservar asignaciones y tomar el siguiente trabajo elegible. Investigar bloqueos con alternativas soportadas y registrar qué evidencia permitiría retomarlos. Continuar con trabajo independiente mientras no cambien las condiciones. Completar una tarea, integrar un PR, recibir un informe o cerrar una fase sin aprobación explícita inicia otro ciclo.

## Git y entrega (Smart Review)

Seguir `docs/GIT-POLICY.md`: Conventional Commits, ramas `type/description`, sin trailers Co-Authored-By, sin menciones de IA, sin secretos, sin force push ni reset destructivo ni bypass. Un PR por unidad coherente. Antes de fusionar: verificar SHA, diff, protecciones y CI real (`gh pr merge --match-head-commit`).
- Docs, investigación, mantenimiento o cambios verificables por tests, de bajo riesgo, con protecciones y checks satisfechos: integrar automáticamente y continuar. Autorización permanente del propietario solo para `dxsarango/zelqio-flow`: ver [Integración automática autorizada](../../../planning/DEVELOPMENT-WORKFLOW.md#integración-automática-autorizada) (checks obligatorios en verde sobre el SHA exacto, `--squash --match-head-commit`, sin bypass ni cambios de protección). Sin la regla de permisos instalada por el propietario, solicitar la aprobación individual en cada fusión.
- Scaffolding técnico e interfaces provisionales: sin validación individual; verificar técnicamente e integrar con los checks. Funcionalidad visual o interactiva relevante: aplicar [Validación visual y funcional del propietario](../../../planning/DEVELOPMENT-WORKFLOW.md#validación-visual-y-funcional-del-propietario). El orquestador prepara y mantiene el entorno aislado (worktree, dependencias, daemon, plugin, enlace verificado), entrega enlace, SHA y qué comprobar, actualiza el entorno ante correcciones y lo limpia al cerrar. No pedir al propietario comandos ni preparación; escalar solo limitaciones reales de permisos, acceso o interacción humana. Agrupar validaciones relacionadas; la aprobación sigue ligada al SHA probado y un cambio material la invalida. Mientras tanto, continuar con tareas independientes sin integrar dependencias no aprobadas.
- Si una protección no puede verificarse, registrar el bloqueo del PR y continuar con trabajo independiente. Escalar la decisión solo cuando resulte necesaria.

## Fase S00 (hasta G0)

No implementar el producto. POCs en daemon aislado y fixtures desechables, con versiones fijadas, APIs oficiales y SDK de la versión instalada; no tocar la instalación habitual ni proyectos reales. Cada POC: evidencia reproducible y conclusión PASS/FAIL/BLOCKED/NOT RUN; no validar por documentación. Referencia técnica: DueGin/paseo-ensemble (MIT, no dependencia; conservar avisos si se reutiliza código). Las pruebas que consumen cuota requieren aprobación de alcance. Al llegar a G0: consolidar evidencia, revisión independiente de otro proveedor si es posible, actualizar arquitectura, proponer ajustes de plan, concluir viabilidad y esperar aprobación del propietario antes de S01.

## Condiciones de parada válidas

Verificar las [condiciones de parada](../../../planning/DEVELOPMENT-WORKFLOW.md#condiciones-de-parada) antes de cerrar el turno. Una validación humana o un gate pendiente solo detiene la ejecución completa si no queda trabajo útil e independiente. Un informe de progreso se entrega durante el trabajo.

## Cierre de cada sesión

Cuando se cumpla una condición de parada, informar en español la causa concreta, los controles pendientes, lo verificado y el punto de recuperación. Si se requiere una decisión del propietario, presentar evidencia, alternativas, recomendación, decisión exacta y trabajo independiente disponible.
