# Test strategy

Unit: router puro (unknown/stale/reset/tie/funding/eligibility), DAG, state machine, policy, approvals SHA, retention, i18n. Property/negative: no rutas no autorizadas, no recursión propia, no ciclos, no duplicados, no publicación sin gate. Contract: SDK fijado, metadata, hooks, tool identity, cross-workspace parent, Usage, services, cleanup. Integration: Git fixture local con conflictos, dirty state, divergencia, hooks, concurrent processes, reinicio y journal; GitHub sandbox opt-in para CI/PR/queue. UI: New Agent/New Workspace, opt-out, errores, permisos, modos, EN/ES y tema. E2E real mínimo por proveedor y OS, presupuestado y autorizado; CI de unit/contract sin cuotas, Windows/macOS/Linux; no credenciales en PR públicos. No marcar compatibilidad OS/proveedor sin evidencia. Pruebas de red: ninguna telemetría propia, distinguir tráfico autorizado de Paseo/proveedores/GitHub.

Definition of Done: alcance y criterios satisfechos, pruebas reales registradas, typecheck/lint, revisión proporcional, sin secretos ni cambios ajenos, documentación/ADR actualizados, CI requerido realmente verde, política de entrega cumplida. Missing checks identificados; no fabricar resultados. Para cambios de alto riesgo, independiente del autor y evidencia de pruebas negativas. Gate de release incluye instalación limpia sin plugins de terceros, rollback y migración.

## Escenarios de aceptación derivados de S00

- Agotar la sesión de coordinación con intentos activos. Reincorporar el proveedor tras confirmación y verificar que hay un único coordinador vigente, los intentos conservan identidad y los efectos rechazan la época anterior.
- Archivar o sustituir la raíz en un fixture. Comprobar enlace lógico tarea–intento–sesión incluso si el árbol nativo cambia. Mantener cada agente y worktree con trabajo pendiente.
- Dejar una aprobación pendiente, reiniciar y comprobar su recuperación. Rechazar texto de agentes, un actor sin procedencia verificable, cambios de SHA/política y efectos repetidos.
- Comprobar retirada con archivos modificados, sin seguimiento o ignorados, operaciones Git activas, validaciones pendientes y referencias concurrentes. Una capacidad de retirada forzada debe bloquear la automatización. Tras una retirada autorizada, verificar lista Git, ruta, refs y evidencia.
- Usar un repositorio que carezca de reglas exigidas y otro con reglas efectivas cuando estén autorizados. Comprobar denegación ante el SHA incorrecto, checks faltantes y permisos insuficientes. Verificar la identidad del check y su SHA antes de merge.
- Capturar un control del daemon sin plugin y otro con plugin, con proceso y destinos atribuidos. Probar exportación con datos persistidos y entradas sintéticas que contienen valores que se deben excluir.
