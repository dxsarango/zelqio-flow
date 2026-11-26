---
name: zelqio-flow-development
description: Inicia, continúa y coordina el desarrollo de Zelqio Flow siguiendo planning/tasks.json. Úsala cuando el usuario diga "Continúa con el desarrollo de Zelqio Flow", pida el siguiente paso, retomar trabajo, o coordinar tareas S00–S10 o gates G0–G10.
---

# Zelqio Flow — desarrollo continuo

Fuente de verdad: archivos del repositorio. `planning/tasks.json` = estado de ejecución; `planning/PLAN.md` = vista legible; ambos coherentes. Engram (si existe) solo ayuda a la continuidad. No crear otro mecanismo de planificación. Solo el orquestador raíz escribe tasks.json/PLAN.md.

Si eres worker (briefing delegado): ejecuta solo tu tarea, reporta y no uses esta skill para delegar.

## Ciclo

1. **Leer**: `AGENTS.md`, `README.md`, `docs/PRD.md`, `planning/DEVELOPMENT-WORKFLOW.md`, `docs/GIT-POLICY.md`, `docs/SECURITY.md`, `planning/tasks.json`; el resto de `docs/` según la tarea. Consultar Engram (`zelqio-flow`) solo por lo necesario.
2. **Evidencia real**: `git status`, `git branch -a`, `git worktree list`, `git log --oneline -15`; `gh pr list` y `gh run list` del repo; agentes/workspaces de Paseo activos (si hay herramientas Paseo).
3. **Reconciliar**: contrastar tasks.json con la evidencia. Corregir discrepancias (tarea `in_progress` sin rama/agente vivo, PR fusionado no registrado, etc.) y anotar la corrección. La evidencia real prevalece.
4. **Clasificar** cada tarea: `done`, `in_progress`, `awaiting_validation`, `blocked`, `todo` elegible (todas sus dependencias `done` y la fase autorizada) o `todo` no elegible. Estados válidos: `todo`, `in_progress`, `awaiting_validation`, `blocked`, `done`.
5. **Recuperar** trabajo incompleto antes de iniciar nuevo: revisar ramas/worktrees/agentes huérfanos, `git diff`, `get_agent_activity`; continuar desde el último estado verificable. Nunca borrar trabajo ajeno.
6. **Seleccionar** el lote: tareas elegibles independientes (archivos no solapados), máx. 3 concurrentes salvo ajuste documentado. Gates solo en serie. Fase S(n+1) requiere gate aprobado; G0, G9, G10 requieren aprobación explícita del propietario.
7. **Antes de iniciar cada tarea**: verificar dependencias, que nadie más la ejecute, alcance, criterios, archivos afectados, rol/proveedor, aislamiento. Marcar `in_progress` (owner, branch) y commitear ese estado junto con el trabajo, no por separado salvo que sea necesario.
8. **Delegar** solo si aporta valor (tareas independientes, escritura en worktree propio, revisión cruzada según riesgo). Ejecutar directamente si es más barato que el briefing. Con herramientas Paseo, aplicar la política global de orquestación del entorno (perfiles, proveedores, cuotas, worktrees); sin ellas, trabajar directamente. Briefing: ID, objetivo, dependencias aceptadas, archivos permitidos, non-goals, aceptación, comandos de verificación, riesgo, formato de entrega. Los workers no delegan, no hacen push/merge.
9. **Integrar y validar**: revisar el diff real; ejecutar las comprobaciones; integrar en serie; verificar el resultado consolidado. Nunca marcar `done` por el relato de un worker.
10. **Registrar** en tasks.json: `status`, `owner`, `branch`, `pr`, `blockers`, `evidence` (lista de objetos: `{kind, command, result: PASS|FAIL|BLOCKED|NOT_RUN, sha, date, notes, limitations}`; local y CI separados, sin secretos ni rutas personales). Reflejar en PLAN.md si cambia algo visible. Guardar en Engram solo decisiones/aprendizajes durables.
11. **Continuar** automáticamente con la siguiente tarea elegible.

## Git y entrega (Smart Review)

Seguir `docs/GIT-POLICY.md`: Conventional Commits, ramas `type/description`, sin trailers Co-Authored-By, sin menciones de IA, sin secretos, sin force push ni reset destructivo ni bypass. Un PR por unidad coherente. Antes de fusionar: verificar SHA, diff, protecciones y CI real (`gh pr merge --match-head-commit`).
- Docs, investigación, mantenimiento o cambios verificables por tests, de bajo riesgo, con protecciones y checks satisfechos: integrar automáticamente y continuar.
- Cambios visuales/interactivos: preparar entorno de prueba, indicar al propietario exactamente qué comprobar y cómo reproducirlo, esperar aprobación del SHA probado; ajustes sobre la misma tarea/rama/PR; un cambio material invalida la aprobación. Mientras tanto, continuar con tareas independientes.
- Si una protección no puede verificarse: no fusionar automáticamente; registrar bloqueo y pedir decisión.

## Fase S00 (hasta G0)

No implementar el producto. POCs en daemon aislado y fixtures desechables, con versiones fijadas, APIs oficiales y SDK de la versión instalada; no tocar la instalación habitual ni proyectos reales. Cada POC: evidencia reproducible y conclusión PASS/FAIL/BLOCKED/NOT RUN; no validar por documentación. Referencia técnica: DueGin/paseo-ensemble (MIT, no dependencia; conservar avisos si se reutiliza código). Las pruebas que consumen cuota requieren aprobación de alcance. Al llegar a G0: consolidar evidencia, revisión independiente de otro proveedor si es posible, actualizar arquitectura, proponer ajustes de plan, concluir viabilidad y esperar aprobación del propietario antes de S01.

## Condiciones de parada válidas

Validación humana requerida; decisión de producto no documentada; riesgo de seguridad relevante; operación fuera de lo autorizado; protección del repositorio que impide continuar; recursos agotados; bloqueo técnico sin alternativa soportada; gate obligatorio; ampliación sustancial de alcance. No detenerse solo para informar de una tarea rutinaria terminada ni repetir aprobaciones ya resueltas.

## Cierre de cada sesión

Resumen breve al usuario (en español): tareas avanzadas, checks realmente ejecutados, bloqueos, qué espera de él. Asegurar que el estado persistido permita retomar desde cero.
