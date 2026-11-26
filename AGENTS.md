# Agent instructions — Zelqio Flow

Leer README, PRD y planning/tasks.json antes de trabajar. Seguir DEVELOPMENT-WORKFLOW, SECURITY y GIT-POLICY. Ejecutar tareas elegibles dentro del alcance autorizado. El orquestador puede justificar ajustes de planificación que preserven alcance, política del propietario y controles de integración y habilitación. No instalar en daemon habitual, no leer proyectos privados, no usar telemetría. No inventar APIs, cuotas ni resultados. No delegar recursivamente si eres worker. No publicar ni fusionar sin autorización y checks. Registrar evidencia y limitaciones. Conventional Commits, ramas type/description, no secretos ni atribuciones IA en commits/PR/comentarios. No incluir rutas personales en código/documentos públicos. G0 autoriza solo Foundation en las condiciones del ADR. Roles/perfiles de desarrollo no son dependencia del producto.

## Continuidad
Todo orquestador autorizado de Zelqio Flow continúa por defecto hasta que se cumpla una condición de parada comprobada. Esta política rige para cualquier proveedor y se recupera al cambiar de conversación, reiniciar o transferir la coordinación. Completar una tarea, integrar un PR o recibir un informe da paso a otro ciclo. Los informes de progreso acompañan el trabajo.

Usar la skill [`zelqio-flow-development`](.agents/skills/zelqio-flow-development/SKILL.md) al iniciar o recuperar la coordinación. Solo el orquestador raíz escribe el estado de ejecución en `planning/tasks.json` y su reflejo en `planning/PLAN.md`. Recuperar la evidencia desde el repositorio, Git, Paseo y Engram.

Ejecutar el [ciclo continuo](planning/DEVELOPMENT-WORKFLOW.md#ciclo-continuo) y comprobar las [condiciones de parada](planning/DEVELOPMENT-WORKFLOW.md#condiciones-de-parada). Un bloqueo se aplica a las tareas que dependen de él. Preparar contratos, simulaciones y fixtures independientes dentro del alcance. Aplicar los controles vigentes de [cuotas](planning/DEVELOPMENT-WORKFLOW.md#proveedores-y-cuotas), [relevo](planning/DEVELOPMENT-WORKFLOW.md#relevo-de-coordinación), [validación humana](planning/DEVELOPMENT-WORKFLOW.md#validación-visual-y-funcional-del-propietario) e [integración](planning/DEVELOPMENT-WORKFLOW.md#integración-automática-autorizada).

## Worktrees de Zelqio Flow
Aplicar la [limpieza segura](planning/DEVELOPMENT-WORKFLOW.md#limpieza-segura-de-worktrees) al cerrar tareas. Archivar individualmente una sesión y archivar su workspace son operaciones distintas. La política se limita a este repositorio.
