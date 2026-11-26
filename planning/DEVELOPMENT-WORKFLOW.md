# Development workflow — usar Paseo para construir Zelqio Flow

El propietario desarrollará desde su Paseo actual, con Claude y Codex principales y OpenCode gratuito auxiliar. Esta configuración es exclusivamente del entorno de desarrollo personal, no una dependencia de Zelqio Flow ni un requisito para colaboradores. No publicar configuraciones privadas, rutas, memorias ni instrucciones globales. Engram/Context Mode/Observatory pueden ayudar al propietario, pero el producto y sus pruebas de aceptación no dependen de ellos.

## Operación
Un orquestador raíz autorizado por lote. El repositorio y la planificación contienen lo necesario para continuar desde un contexto nuevo. El orquestador decide dentro del alcance aprobado, investiga alternativas con documentación oficial y pruebas, usa revisión independiente según el riesgo y registra decisiones arquitectónicas en ADR. Puede ajustar el plan con justificación técnica y trazabilidad, preservando el alcance funcional. Continúa con trabajo independiente mientras haya tareas bloqueadas y resuelve las instrucciones disponibles antes de escalar.

Escalar al propietario cambios sustanciales de alcance, riesgos de seguridad o privacidad, costos adicionales, autorizaciones nuevas, operaciones irreversibles, validaciones humanas y gates obligatorios. Presentar en la sesión de Paseo el problema, las alternativas, sus riesgos, la recomendación sustentada y la autorización exacta que se necesita. La decisión pertenece al propietario.

Esta política rige el entorno de desarrollo. Las restricciones verificadas y aprobadas del producto se definen en el PRD y el ADR de G0. El equipo puede trabajar con Claude, Codex y worktrees independientes mientras Foundation mantiene sus efectos locales y supervisados.

## Proveedores y cuotas

Claude y Codex son principales con igual prioridad. Elegir por especialización, complejidad, disponibilidad y continuidad. OpenCode Free es apoyo oportunista para trabajo acotado. Grok queda reservado a Agent Observatory. Usar perfiles de desarrollo según disponibilidad, mantener workers sin recursión y buscar revisión de otro proveedor cuando el riesgo lo justifique.

Consultar cuota mediante mecanismos soportados cuando existan y distinguir datos desconocidos, vencidos, agotados y verificados. Los umbrales son orientativos y se aplican a la ventana relevante de cada proveedor con datos confiables. Con datos desconocidos o vencidos, usar evidencia operativa y el fallback documentado.

| Cuota restante verificada | Acción |
|---|---|
| Más de 30 % | Operar normalmente. |
| De 15 % a 30 % | Priorizar tareas acotadas. |
| Desde 5 % y menos de 15 % | Preparar transferencia preventiva. |
| Mayor de 0 % y menor de 5 % | Consolidar estado y ceder la coordinación. |
| Agotada | Excluir temporalmente al proveedor de nuevas asignaciones. |
| Restablecida | Reincorporar automáticamente a la elegibilidad si una señal soportada lo confirma. Aceptar confirmación explícita del propietario si falta esa señal. |

Mantener el orquestador vigente mientras pueda continuar de forma eficiente. La reincorporación habilita tareas futuras y conserva las asignaciones en curso. El registro temporal de agotamiento sigue la política de la sesión de Paseo. Evitar reintentos repetidos o estimaciones sin evidencia.

## Relevo de coordinación

Ante agotamiento próximo, interrupción o límite de contexto, preparar un punto de recuperación antes de transferir:

1. Reconciliar `planning/tasks.json` con Git, Paseo y CI. Registrar tareas, agentes activos, asignaciones, bloqueos, operaciones remotas y aprobaciones pendientes.
2. Preservar cambios, ramas, commits, worktrees, evidencias y sesiones. Identificar trabajo aún sin commit, el SHA integrado o revisado y el destino previsto. Mantener a los workers independientes en curso.
3. Guardar en Engram las decisiones duraderas y las referencias necesarias para recuperar la rama, los worktrees, la evidencia y el siguiente paso. Mantener el estado de ejecución en la planificación versionada y evitar copiar chats completos o secretos.
4. Entregar una instrucción breve que permita recuperar el contexto sin la conversación anterior. Confirmar la autoridad del sucesor y asegurar que exista un solo orquestador con permiso de escribir planificación, integrar o publicar. Conservar el linaje y las sesiones anteriores.

Usar transferencia automática únicamente si el entorno ofrece una operación soportada y verificada de cesión de autoridad. En Paseo, una sesión creada por el orquestador sigue en su árbol. Prepararla sin autorizar efectos mientras sea subagente. La separación del árbol requiere la acción del propietario. Tras esa acción, el sucesor confirma el punto de recuperación antes de coordinar. Mantener la transferencia manual mientras falte una operación segura.

**Capacidades de Paseo 0.17.4 verificadas (2026-11-26).** *Schedules*: el CLI ofrece `paseo schedule create|ls|inspect|logs|pause|resume|delete` y el entorno expone las herramientas nativas equivalentes. Opciones observadas: `--every` o `--cron` con `--timezone`, `--provider` (proveedor o proveedor/modelo), `--mode`, `--thinking`, `--cwd`, `--run-now`, `--max-runs` y `--expires-in`; cada ejecución crea un agente nuevo. *Heartbeats*: `paseo heartbeat create|update|…` y herramientas nativas envían un prompt recurrente (cron, `--max-runs`, `--expires-in`) al propio agente. El entorno puede bloquear su creación a ciertos proveedores; no asumir que un sucesor puede crear schedules y comprobarlo antes de depender de ellos. La verificación se hizo por la ayuda del CLI, el listado de herramientas y una ejecución real descrita abajo; no se midió el consumo de cuota de las ejecuciones.

**Relevo automático con schedule (procedimiento aprobado por el propietario para ausencias).** Con el punto de recuperación ya integrado en `main`: (1) registrar el relevo en Engram (`coordination/lease`: coordinador, época, hora, motivo) y dejar de escribir en la planificación; (2) crear un schedule de una sola ejecución (`--max-runs 1`, `--expires-in` corto, `--run-now`) con proveedor del sucesor y un prompt breve que le ordene recuperar el contexto desde el punto de recuperación, confirmar que no hay otro coordinador activo y asumir la coordinación; (3) verificar que el agente sucesor existe y ejecuta; si no arranca, el coordinador actual conserva la coordinación y lo registra; (4) no interrumpir ni archivar a los workers ni los worktrees: el sucesor lee sus informes con `get_agent_activity` y sus commits con Git. Un schedule de una sola ejecución a la hora de restablecimiento de cuota del proveedor saliente permite el relevo de vuelta con la misma comprobación de coordinador único. No crear schedules recurrentes ni sondeos de cuota.

## Paralelismo y Git del proyecto
Cada tarea tiene ID, dependencia, salida, criterio y riesgo. Solo ejecutar cuando dependencias aceptadas. Propuesta: hasta 3 workers concurrentes como punto de partida ajustable, con un responsable de integración. Tareas que escriben archivos solapados se serializan o tienen contrato previo; usar worktrees nativos de Paseo para escrituras independientes. No implementar contra contratos todavía no aprobados. Una rama/PR por unidad lógica (puede agrupar tareas inseparables con trazabilidad), no un PR por cada subagente obligatoriamente. Conventional Commits, ramas `type/description`, sin secretos, sin atribuciones de IA en commits/PR/comentarios como preferencia del propietario para este proyecto. No imponer reglas Engram específicas. No fusionar sin verificar protecciones, SHA y CI; si no se pueden verificar, detener y pedir decisión, no saltar reglas.

## Modo del propietario para desarrollo
Smart Review: docs y cambios verificables automáticamente se integran solo si autorización y protecciones lo permiten. Cambios de seguridad/arquitectura y gates requieren aprobación explícita. No habilitar Auto Merge por inferencia. POC en daemon aislado, sin tocar instalación habitual ni proyectos reales. Tests reales que consumen cuotas se ejecutan con aprobación de alcance; no duplicar pruebas innecesariamente.

### Validación visual y funcional del propietario

El propietario valida el resultado visual y funcional del producto. El orquestador prepara y mantiene el entorno de validación y no pide al propietario comandos Git, npm, Paseo CLI ni preparación de entornos.

**Cuándo se pide.** Distinguir tres clases de cambio:
- *Scaffolding técnico e interfaces provisionales* (estructura, contratos, pantallas de estado o marcadores sin valor de producto): sin validación individual. Basta la verificación técnica (typecheck, tests, evidencia de carga) y la integración normal con los checks requeridos.
- *Funcionalidad visual o interactiva relevante para el producto*: requiere validación humana.
- *Seguridad, arquitectura y gates*: aprobación explícita según las reglas existentes.

Agrupar validaciones relacionadas en un solo lote cuando sea razonable. La aprobación queda asociada al SHA exacto que se probó, o al SHA de integración del lote. Un cambio material posterior la invalida. Una aprobación nunca habilita dependencias aún no aprobadas.

**Preparación (a cargo del orquestador).** Crear un worktree dedicado fuera del checkout principal en el SHA exacto, instalar dependencias, compilar o verificar tipos, y levantar un daemon de Paseo aislado (home propio, solo loopback, relay desactivado, puertos de un rango reservado a validación) con el plugin instalado desde ese worktree. Servir la app web con `tools/serve-app.mjs`, que preconecta el navegador al daemon aislado, y comprobar de extremo a extremo que el enlace abre una interfaz funcional. No modificar el daemon habitual ni usar proyectos reales, credenciales o prompts a proveedores.

**Entrega.** Informar el enlace directo, el SHA exacto, las funcionalidades a comprobar y cómo aprobar o pedir cambios. Mantener el entorno activo mientras la aprobación esté pendiente. Si el propietario pide correcciones, aplicarlas en la misma rama/PR, actualizar el entorno al nuevo SHA y repetir la entrega.

**Cierre.** Tras la decisión, detener procesos, daemon, servidor y navegador propios, eliminar el home y el worktree de validación con las comprobaciones de la limpieza segura, y verificar que el daemon habitual sigue intacto.

**Continuidad.** Mientras la aprobación está pendiente, continuar con tareas independientes que puedan ejecutarse de forma segura, sin integrar dependencias no aprobadas ni bloquear la fase completa.

**Escalada.** Pedir intervención técnica solo ante una limitación real de permisos, acceso o interacción humana obligatoria, y explicarla.

### Integración automática autorizada

El propietario autoriza de forma permanente, solo en `dxsarango/zelqio-flow`, integrar un PR sin pedir aprobación individual cuando se cumplan todas estas condiciones: Smart Review lo clasifica como apto para integración automática; se satisfacen los criterios de aceptación; hay revisión independiente cuando corresponda; todos los checks obligatorios de `main` están en verde sobre el SHA a integrar; no hay conflictos ni validación humana pendiente; el PR se integra con `gh pr merge <n> --squash --match-head-commit <SHA verificado>` sin bypass administrativo ni desactivación de protecciones. Quedan fuera de esta autorización las validaciones visuales relevantes, los gates con aprobación explícita, los cambios de seguridad o arquitectura, los de protecciones del repositorio y cualquier otro repositorio.

La barrera técnica es la protección de `main` (checks obligatorios `planning-integrity` y `check (ubuntu-latest|windows-latest|macos-latest)`, rama al día, historial lineal, aplicación a administradores). Los pasos previos son un procedimiento del orquestador: verificar con `gh api repos/dxsarango/zelqio-flow/commits/<SHA>/check-runs` que los cuatro checks terminaron con éxito sobre el SHA exacto, comparar el alcance con la clasificación y no combinar la fusión con otros comandos.

**Representación en permisos (Claude Code).** El sistema soporta reglas `permissions` por proyecto. El modo automático las evalúa antes del clasificador y su `autoMode` solo se lee de la configuración de usuario o gestionada, nunca de la del proyecto. La regla puede limitarse a este proyecto colocándola en `.claude/settings.local.json` (ignorado por Git), con una excepción por prioridad de `deny`:

```json
{
  "permissions": {
    "allow": ["Bash(gh pr merge * --squash --match-head-commit *)"],
    "deny": [
      "Bash(gh pr merge *--admin*)", "Bash(gh pr merge *--repo*)", "Bash(gh pr merge * -R *)",
      "Bash(gh pr merge *--auto*)", "Bash(gh pr merge *--merge*)", "Bash(gh pr merge *--rebase*)",
      "Bash(gh pr merge *--delete-branch*)", "Bash(gh pr merge *-d *)"
    ]
  }
}
```

Limitaciones: una regla de permisos no puede comprobar checks, SHA ni clasificación, y no fija el repositorio salvo por la ausencia de `--repo`/`-R` y por el remoto del proyecto. Claude Code no permite que el agente escriba esa configuración (ruta protegida): la instala el propietario una sola vez. Mientras no esté instalada, o con un proveedor cuyo sistema de permisos no pueda acotarla, el orquestador cumple las condiciones y solicita la aprobación individual. Esta autorización no crea permisos globales ni modifica otros proyectos.

## Brief por tarea
ID + objetivo + dependencias aceptadas + archivos/contratos permitidos + non-goals + aceptación + comandos de verificación + riesgo/permiso + entrega. Worker reporta cambios, commits/SHA, checks realmente ejecutados, limitaciones y blockers. Orquestador revisa, integra secuencialmente y actualiza tasks.json con evidencia. No marcar Done por relato del worker sin verificación. Mismo chat si contexto relevante; nuevo chat para tarea independiente, handoff con estado. Modelo/razonamiento según complejidad (Medium normal, High complejo), verificar modelos disponibles. No fijar modelos en instrucciones públicas.

## Rondas y control
Antes de cada lote: identificar ready tasks, contratos y archivos; reservar worktrees, asignar roles y límites. Después: recoger evidencia, revisar cross-provider según riesgo, integrar y ejecutar checks consolidados. Gates G0–G10 seriales como condición de salida, no impiden preparación documental independiente. No avanzar con blocker crítico. El plan puede refinarse mediante ADR/PR sin ocultar cambios de alcance.

## Limpieza segura de worktrees

El orquestador aplica esta política solo a Zelqio Flow después de completar, integrar y verificar una tarea. El checkout principal queda fuera de la limpieza de worktrees de tarea. En Paseo 0.17.4, el archivado nativo de un workspace administrado invoca internamente `git worktree remove --force`. El [hallazgo de S00-T05](../docs/evidence/S00-T05-subagents-worktrees.md#poc-08) documenta la pérdida de archivos que produjo en un fixture sucio. Conservar los worktrees de tarea en esa versión.

1. Identificar el workspace de Paseo y verificar la ruta, la rama, el SHA, el Git común y la pertenencia a Zelqio Flow con `git worktree list --porcelain`. Confirmar que los commits están integrados en el destino autorizado y que el trabajo y las evidencias tienen referencias recuperables.
2. Comprobar que el workspace no tiene agentes activos, trabajo en cola, terminales o servicios en uso, solicitudes de permiso, aprobaciones ni pruebas funcionales pendientes. El archivado de una sesión padre puede afectar a sus descendientes. Inspeccionar ese alcance antes de archivar sesiones.
3. Inspeccionar el estado del índice y del checkout con `git status --porcelain=v1 --untracked-files=all --ignored=matching`. Verificar también que no haya conflictos ni una operación Git en curso. Conservar el workspace si hay trabajo incompleto, errores de cuota, cambios sin preservar, validaciones pendientes o un alcance que no se pueda comprobar.
4. Repetir la comprobación de actividad, SHA y estado justo antes de archivar. Archivar un solo workspace a la vez con la operación nativa de Paseo que corresponda al ID verificado. Usarla cuando la versión instalada permita retirar el checkout sin eliminación forzada. Si no hay un mecanismo nativo seguro, conservar el workspace. No usar borrado manual, comandos destructivos ni opciones de fuerza.
5. Verificar después que Paseo ya no lista el workspace como activo, que Git ya no lista el worktree, que la ruta exacta dejó de existir y que las referencias y evidencias siguen accesibles. Registrar el resultado y cualquier discrepancia. Si la retirada no se confirma, conservar el estado para revisión.
