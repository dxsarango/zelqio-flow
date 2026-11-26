# S00 — Technical feasibility / decision gate

Baseline de investigación: se han observado mecanismos en Ensemble v0.6.5 (SDK 0.16.0) y documentación pública de Paseo. Paseo 0.17.4 es la referencia de las pruebas locales. La versión mínima se decide en G0. Las APIs documentadas en versiones nuevas requieren verificación en 0.17.4.

Referencias para verificar y fijar por tag/SHA: https://paseo.sh/ ; https://github.com/DueGin/paseo-ensemble (MIT, ver LICENSE); https://cli.github.com/manual/gh_pr_merge ; https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request ; https://git-scm.com/docs/git-worktree . Ensemble demuestra patrones de compositor, metadatos, creación y hooks; no demuestra aislamiento de worktrees, cuotas ni seguridad integral. No copiar código sin conservar avisos de licencia.

## Entorno de prueba
Daemon separado con home, puertos y directorios independientes; fixture git local y remoto de prueba autorizado; sin datos de proyectos reales. SDK/versiones fijados. Usar mocks primero y pruebas de inferencia mínimas solo con aprobación; no cambiar daemon habitual. Registrar versión, OS, API pública, comando, resultado real, evidencia saneada y limitación. No guardar credenciales en evidencias.

| POC | Prueba / resultado necesario | Si falla |
|---|---|---|
| 01 | Control compositor New Agent/New Workspace; metadatos de borrador y opt-in persistente | Acción nativa alternativa solo con aprobación del cambio UX |
| 02 | Hook de creación aplica proveedor/modelo/modo antes del primer prompt; cambio manual posterior y fallo de selección no envían al proveedor incorrecto | Resolver en borrador y comprobar al crear; bloquear si no es fiable |
| 03 | Verificar `providers.snapshot()` y `providers.listUsage()` o CLI pública equivalente en versión instalada; timestamps, ventanas, errores y datos ausentes | Compatibilidad de versión o routing con datos desconocidos explícitos; no inventar cuota |
| 04 | Crear agente con configuración directa, roles sin Agent Profiles | Bloqueante si no hay API soportada |
| 05 | Herramientas propias por identidad, inyección antes de primera tarea, autorización por llamada | Bloqueante si orquestador no puede delegar de manera segura |
| 06 | Comprobar MCP nativo on/off, overrides por sesión, subagentes nativos, shell, permisos; no afectar sesiones ajenas | Documentar límites; excluir proveedores/modos incapaces o requerir consentimiento para mecanismo soportado |
| 07 | Relación padre-hijo visible, resultados, cancelación y permisos nativos | Bloqueante para experiencia prometida; no simular árbol como sustituto silencioso |
| 08 | Worktrees por worker, Git común, base exacta, relación entre workspaces y retirada sin fuerza | Conservar checkouts; ejecución secuencial si no se garantizan aislamiento y retirada segura |
| 09 | Integrar dos ramas limpias desde base común con pruebas sobre resultado | Bloqueante para paralelismo con escritura |
| 10 | Conflicto y reinicio a mitad de operación; preservar cambios y evitar merge duplicado | Bloqueante para integración automática |
| 11 | Servicio local ligado a workspace/SHA, URL real, puerto y parada; host remoto distinguido | Entrega alternativa explícita; no afirmar preview si no disponible |
| 12 | Reiniciar daemon durante tareas; recuperar aprobaciones pendientes y reconciliar permisos, agentes, referencias Git y efectos | Bloqueante para automatización desatendida |
| 13 | Sesiones nativas y plugins ajenos no se interceptan; sin modificaciones globales inesperadas | Bloqueante |
| 14 | Disable/uninstall sin pérdida de repositorios, ramas, perfiles, memorias ni procesos ajenos | Bloqueante |
| 15 | GitHub sandbox: PR, checks, SHA exacto, rechazo por política, auto-merge/cola cuando disponibles | Restringir capacidades según acceso real; no bypass |
| 16 | Inspección de red y almacenamiento; ninguna telemetría propia; exportación saneada | Bloqueante |
| 17 | Acción explícita de actor humano autenticado con tarea, SHA y política; texto y RPC sin procedencia dejan pendiente | Evaluar fuente independiente verificable o entregar para ejecución manual sin autorización delegada |

## Gate G0
Matriz PASS / FAIL / BLOCKED / NOT RUN con evidencia. No declarar PASS sin prueba. Antes de iniciar S01, aprobar ADR de versión mínima, superficie UI, modelo de permisos, topología de worktrees, almacenamiento y alternativas. Si alguna capacidad crítica falla, presentar el alcance ajustado y la decisión al propietario. POC desechable; reutilizar código solo tras revisión. Consultar los resultados por tarea en [tasks.json](../planning/tasks.json) y los informes reproducibles en [evidence](evidence/).
