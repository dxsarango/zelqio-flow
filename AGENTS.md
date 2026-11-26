# Agent instructions — Zelqio Flow

Leer README, PRD y planning/tasks.json antes de trabajar. Seguir DEVELOPMENT-WORKFLOW, SECURITY y GIT-POLICY. Ejecutar solo tareas asignadas y listas; no cambiar alcance, política de usuario ni dependencias sin aprobación. No instalar en daemon habitual, no leer proyectos privados, no usar telemetría. No inventar APIs, cuotas ni resultados. No delegar recursivamente si eres worker. No publicar ni fusionar sin autorización y checks. Registrar evidencia y limitaciones. Conventional Commits, ramas type/description, no secretos ni atribuciones IA en commits/PR/comentarios. No incluir rutas personales en código/documentos públicos. G0 bloquea implementación del MVP. Roles/perfiles de desarrollo no son dependencia del producto.

## Continuidad
Orden "Continúa con el desarrollo de Zelqio Flow" (o similar): usar la skill `zelqio-flow-development` (`.agents/skills/zelqio-flow-development/SKILL.md`; `.claude/skills/` contiene solo un puntero). Si no se descubre como skill, leer ese archivo y seguirlo. El estado persistente es `planning/tasks.json` (reflejado en `planning/PLAN.md`); solo el orquestador raíz lo escribe.
