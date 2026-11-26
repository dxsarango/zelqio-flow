# UX specification

## Principios
Nativo, mínimo, accesible, tema de Paseo, EN/ES. No chat paralelo. No depender de Quick Chat. No crear perfiles nativos. El selector solo aparece donde SDK lo soporte, preferentemente New Agent y New Workspace. Sesiones convencionales no se interceptan.

## Onboarding
1. Detectar proveedores/modelos, estado y capacidades. 2. Elegir fuentes principales/auxiliares, suscripción/gratuito/local/consumo (este último opt-in). 3. Estrategia Balanced/Economy/Quality First/Custom. 4. Modo de trabajo y política Git. 5. Autorizaciones por proyecto, acciones remotas y límites. 6. Resumen y confirmar. No pedir secretos ni instalar proveedores. Si solo existe uno compatible, permitir configuración válida con él.

## Compositor
Control `Orchestration: Disabled / Automatic` (ES: Orquestación: Desactivada / Automática). Preferencia recordable propuesta, con opt-out visible. Mostrar proveedor elegido y razón breve; cambios manuales explícitos prevalecen si son autorizados. No cambiar proveedor de sesión existente silenciosamente. Si el seleccionado no está disponible, informar antes de enviar o aplicar fallback autorizado. Modo global con override de proyecto/sesión visible, sin saturar compositor. Confirmación de UX exacta tras POC-01/02.

## Configuración
Secciones: General, Providers & Usage, Roles, Work Modes, Git, Projects & Permissions, Local Activity, About/Privacy. Cambios con validación y previsualización; permisos elevados requieren confirmación. Modelo desaparecido se marca inválido, no sustitución por API de pago.

## Sesión y entrega
Usar árbol de agentes, workspace, permisos y diffs nativos. Panel opcional mínimo: progreso, delegaciones, decisión de routing, bloqueos, evidencia, acciones. Review First: abrir PR/diff y aprobar; Smart Review: URL/versión, pasos de prueba, Request changes/Approve; Auto Merge: estado checks/merge; Autopilot: resultado y abrir servicio cuando exista. Las acciones de aprobación requieren un canal y un actor verificables. Si falta procedencia, ofrecer evidencia y ejecución manual. Mantener PR/rama durante iteraciones. Errores con causa y acción, sin declarar éxito ficticio.

## Estados vacíos y fallos
Sin proveedor, cuota desconocida, sin Git, permisos faltantes, CI pendiente, conflicto, agente detenido, preview no accesible desde cliente, almacenamiento corrupto. Cada uno tiene diagnóstico claro y recuperación sin pérdida. No mostrar localhost del daemon remoto como si fuera cliente local.
