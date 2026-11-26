# Product requirements — Zelqio Flow

## Visión y público
Desarrolladores individuales con uno o varios proveedores, gratuitos, por suscripción, locales o por consumo; usuarios que desean controlar cada PR o únicamente recibir un resultado funcional. Sin monetización inicial. Distribución pública MIT, EN/ES, Windows/macOS/Linux sujetos a validación. Paseo como única dependencia de plataforma; Git y gh son prerrequisitos condicionales, no requisitos para chat general. Autenticación y acceso a modelos pertenecen a Paseo/proveedor.

## Requisitos de producto
| ID | Requisito | Aceptación observable |
|---|---|---|
| FR-01 | Onboarding local, detectar catálogo de proveedores y capacidades; clasificar fuentes y configurar autorizaciones | Instalación limpia permite configurar un proveedor sin plugins externos |
| FR-02 | Activar orquestación desde compositor nativo de New Agent y New Workspace | Sesión marcada explícitamente; sesiones normales no se alteran |
| FR-03 | Router determinista sin LLM adicional | Selección explicable antes de primera inferencia, respeta preferencias y elegibilidad |
| FR-04 | Cuotas, fallback y reincorporación | Distinguir disponible, agotado, vencido y desconocido. Excluir al proveedor agotado, recuperar trabajo con un sucesor elegible y reincorporarlo tras confirmación del propietario o una señal verificable. Mantener una sola coordinación activa por ejecución. |
| FR-05 | Roles internos: Orchestrator, Senior Developer, Developer, UI Developer, Reviewer, QA, Assistant | Roles independientes de Agent Profiles; modelos configurables; roles personalizados básicos |
| FR-06 | Delegación bajo demanda, ejecución directa, dependencias, concurrencia limitada | Mostrar workers nativos mientras Paseo conserva el vínculo. El historial local conecta ejecución, tarea, intentos y sesiones después de sustituir o archivar la raíz. Las herramientas propias impiden delegación recursiva. |
| FR-07 | Aislamiento y retirada segura de worktrees | Checkout separado y base exacta para escrituras paralelas. Retirar solo checkouts inactivos, limpios y con referencias recuperables mediante una operación segura y autorizada. Si la capacidad falta, conservar los checkouts y permitir un único escritor secuencial. |
| FR-08 | Git local y remoto | Verificar repositorio y base, recuperar conflictos y vincular PR, checks y operación al SHA. Si faltan protecciones exigidas o un control exacto del candidato, bloquear la automatización afectada. |
| FR-09 | Cuatro modos | Review First, Auto Merge, Smart Review, Autopilot, con criterios verificables |
| FR-10 | Política Git independiente | Local only, Pull request, Fork contribution, Direct integration; sin Git para tareas no relacionadas |
| FR-11 | Validación y entrega | Evidencia de checks, revisión cruzada proporcional, preview local verificable cuando aplique |
| FR-12 | Seguridad y aprobación humana | Una acción explícita con actor verificable vincula tarea, proyecto, operación, destino, SHA exacto y política. Texto de agentes o archivos, metadata y RPC sin procedencia humana dejan la solicitud pendiente. Si falta la capacidad, detener el efecto y ofrecer ejecución manual. |
| FR-13 | Persistencia y recuperación | Una solicitud pendiente conserva su identidad y estado al reiniciar el daemon. Revalidar actor, política y SHA antes de aplicar decisiones. Distinguir turnos activos, sesiones inactivas, interrumpidas y registros obsoletos mediante señales de ejecución y progreso verificables. Caducar y recuperar la propiedad de coordinación de forma atómica. Rechazar efectos de la época anterior. Un componente local sin inferencia consulta señales de cuota verificables y reintenta relevos fallidos con límites y espera progresiva. Una comprobación fallida deja un próximo intento o un bloqueo recuperable. |
| FR-14 | Privacidad | Sin telemetría, servidor externo propio, copias de chats ni secretos. La exportación manual limita los campos y una prueba separa tráfico propio del tráfico atribuible al host, proveedores y forja. |
| FR-15 | UI local de configuración y actividad | EN/ES; decisiones y bloqueos comprensibles, configuración global/proyecto/sesión |
| FR-16 | Ciclo de vida | Instalación, actualización y desinstalación reversibles; no borrar código, ramas ni perfiles ajenos |
| FR-17 | Power Management | Opción para impedir temporalmente la suspensión del equipo mientras una ejecución elegible de Zelqio Flow progresa, con apagado normal de pantalla y sin cambios permanentes al plan de energía. Liberar la prevención al terminar o quedar sin recuperación automática. Suspensión automática opcional, explícitamente autorizada y cancelable. Ante otros proyectos, agentes activos, procesos de usuario protegidos o evidencia insuficiente sobre ellos, omitir la suspensión. Windows primero y compatibilidad progresiva con macOS y Linux tras validación. |

## Requisitos no funcionales
NFR-01: No fork, parche de app.asar, API privada ni dependencia obligatoria de otro plugin. NFR-02: compatibilidad validada por versión, plataforma y proveedor. NFR-03: cambios atómicos, idempotencia y recuperación de operaciones. NFR-04: accesibilidad, tema nativo y traducciones completas. NFR-05: sin costes adicionales de inferencia para routing; APIs de consumo solo opt-in explícito. NFR-06: logs locales minimizados y redactados. NFR-07: no degradar permisos ni interferir con sesiones ajenas. NFR-08: pruebas unitarias sin cuotas y E2E reales mínimos autorizados.

## Alcance MVP
Todos los FR anteriores; GitHub como primer adaptador remoto; Claude, Codex y OpenCode como matriz inicial, no lista rígida. Default propuesto: Review First + Balanced; autorización de publicación denegada hasta configurar. No crear perfiles, importar perfiles ni modificar perfiles nativos. No obligar a crear repositorios remotos. No dependencia ni integración específica inicial con Engram, Memorise, Quick Chat, Context Mode, Observatory, Playbooks o Ensemble. Compatibilidad de coexistencia sin administrar esos plugins. No memoria semántica propia, chat paralelo, editor, motor de agentes, cliente Git completo, SaaS, despliegue automático de producción ni soporte específico GitLab/Bitbucket en MVP.

## Niveles de madurez

| Nivel | Capacidades y autorización |
|---|---|
| **Foundation** | Inicio de S01 aprobado condicionalmente para Windows y Paseo 0.17.4. Implementación local supervisada, un escritor por unidad de ejecución, recuperación manual y acciones sensibles a cargo del propietario. [Decisión G0](adr/G0-supervised-scope.md) |
| **Advanced Orchestration** | Concurrencia segura, fallback automático, recuperación del orquestador, persistencia robusta, limpieza segura y Smart Review. Habilitación condicionada a evidencia verificable, permisos y gates por capacidad. |
| **Complete MVP** | Cumplimiento de todos los FR/NFR originales, incluidos routing inteligente, orquestación multiagente, paralelismo, los cuatro modos, coordinación Git, privacidad y compatibilidad validada en Windows, macOS y Linux. |

Los pendientes tienen evidencia, alternativas, riesgos, pruebas y fase responsable en la [matriz de validación](VALIDATION-BACKLOG.md). La distribución pública exige completar el alcance del MVP, verificar compatibilidad, instalación, retirada, privacidad y seguridad, obtener los checks requeridos y aprobar G9, G10 y la publicación. El PR autorizado de evidencias S00 es una operación de desarrollo separada.

## Éxito
Instalar sobre Paseo limpio, configurar, iniciar sesión nativa, seleccionar automáticamente proveedor, delegar solo cuando aporta valor, recuperar resultados, integrar cambios verificables y entregar según modo. Usuario puede desactivar el plugin y seguir usando Paseo. Bloqueo explícito si permisos, capacidades o evidencias no bastan.
