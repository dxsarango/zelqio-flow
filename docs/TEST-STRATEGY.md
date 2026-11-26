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

## Recuperación desatendida

| Caso | Evidencia esperada | Fase |
|---|---|---|
| Sesión registrada sin turno, turno activo con progreso, interrupción y actividad obsoleta | Clasificaciones distintas basadas en identidad del turno, última señal y trabajo pendiente. Un estado `running` por sí solo no acredita progreso. | S05-T04 |
| Coordinador detenido con workers activos | Caducar el lease vencido, conservar workers y worktrees, adquirir una sola nueva época y rechazar efectos tardíos de la anterior. Si la autoridad es incierta, preservar y conciliar. | S05-T04, G5 |
| Primer relevo sin acceso a cuota, probe fallido, reset verificado después | Guardar el error y el próximo intento. Aplicar backoff acotado sin colas duplicadas. Reanudar una vez cuando la señal sea fresca y pueda adquirirse la propiedad. Un schedule completado solo acredita la ejecución del comando. | S03-T03, S05-T04, S09-T02 |
| Relevo rechaza la ejecución por un turno todavía activo; todos los modelos agotados y luego uno se recupera | El supervisor local puede leer la señal de recuperación y arbitrar sin generar inferencia. Ningún modelo es prerrequisito para recuperar la coordinación. Terminar con bloqueo recuperable si se agota el presupuesto de intentos. | S05-T04, S09-T02 |
| Caída entre adquisición, primer efecto o guardado; reloj alterado; wake y entrega duplicada | Reconciliar el intento y su evidencia, mantener la exclusión mutua, rechazar una época obsoleta y evitar repetir el efecto ante reinicio o cambio de reloj. | S09-T02 |

## Power Management

| Caso | Evidencia esperada | Fase |
|---|---|---|
| Prevención de suspensión activada durante trabajo elegible | Solicitud temporal y acotada al proceso. La pantalla se apaga normalmente. Se conserva la configuración de energía y operaciones de usuario existentes. | S08-T06, G8 |
| Fin, cancelación, fallo irrecuperable, caída o sustitución del coordinador | Liberar la prevención de suspensión. Reconciliar el estado al reiniciar. Una raíz sustituida no prolonga el bloqueo. | S08-T06, S09-T02 |
| Suspensión al terminar, opt-in desactivado o cancelado, otros proyectos, agentes o procesos protegidos | La suspensión se ejecuta solo con autorización explícita vigente, opción de cancelar y ausencia verificable de trabajo protegido. Si falla una comprobación o falta soporte para enumerarlo, omitir el efecto. Probar primero con adaptadores simulados. | S08-T06, G8 |
| Windows, macOS y Linux, capacidad parcial y desinstalación | Validar prevención de suspensión, apagado de pantalla y liberación por plataforma. Mantener deshabilitadas las operaciones no verificadas y comprobar que al retirar el plugin no quedan cambios de energía. | S09-T04, S09-T05 |
