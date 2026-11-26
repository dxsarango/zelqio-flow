# Product requirements — Zelqio Flow

## Visión y público
Desarrolladores individuales con uno o varios proveedores, gratuitos, por suscripción, locales o por consumo; usuarios que desean controlar cada PR o únicamente recibir un resultado funcional. Sin monetización inicial. Distribución pública MIT, EN/ES, Windows/macOS/Linux sujetos a validación. Paseo como única dependencia de plataforma; Git y gh son prerrequisitos condicionales, no requisitos para chat general. Autenticación y acceso a modelos pertenecen a Paseo/proveedor.

## Requisitos de producto
| ID | Requisito | Aceptación observable |
|---|---|---|
| FR-01 | Onboarding local, detectar catálogo de proveedores y capacidades; clasificar fuentes y configurar autorizaciones | Instalación limpia permite configurar un proveedor sin plugins externos |
| FR-02 | Activar orquestación desde compositor nativo de New Agent y New Workspace | Sesión marcada explícitamente; sesiones normales no se alteran |
| FR-03 | Router determinista sin LLM adicional | Selección explicable antes de primera inferencia, respeta preferencias y elegibilidad |
| FR-04 | Cuotas y fallback | Métricas verificadas, desconocidas o vencidas diferenciadas; no reintentos en bucle |
| FR-05 | Roles internos: Orchestrator, Senior Developer, Developer, UI Developer, Reviewer, QA, Assistant | Roles independientes de Agent Profiles; modelos configurables; roles personalizados básicos |
| FR-06 | Delegación bajo demanda, ejecución directa, dependencias, concurrencia limitada | Workers nativos visibles y vinculados a la raíz; sin delegación recursiva por herramientas propias |
| FR-07 | Aislamiento de escrituras concurrentes | Worktrees nativos cuando corresponda; lectura/secuencial sin worktrees redundantes |
| FR-08 | Git local y remoto | Ramas/commits, verificación de base, integración segura, conflictos recuperables, PRs GitHub |
| FR-09 | Cuatro modos | Review First, Auto Merge, Smart Review, Autopilot, con criterios verificables |
| FR-10 | Política Git independiente | Local only, Pull request, Fork contribution, Direct integration; sin Git para tareas no relacionadas |
| FR-11 | Validación y entrega | Evidencia de checks, revisión cruzada proporcional, preview local verificable cuando aplique |
| FR-12 | Seguridad | Permisos por operación y proyecto; sin bypass de protecciones; fail closed ante autorización desconocida |
| FR-13 | Persistencia | Recuperar estado tras interrupciones; no duplicar operaciones externas |
| FR-14 | Privacidad | Sin telemetría, sin servidor externo propio, sin copiar chats o secretos |
| FR-15 | UI local de configuración y actividad | EN/ES; decisiones y bloqueos comprensibles, configuración global/proyecto/sesión |
| FR-16 | Ciclo de vida | Instalación, actualización y desinstalación reversibles; no borrar código, ramas ni perfiles ajenos |

## Requisitos no funcionales
NFR-01: No fork, parche de app.asar, API privada ni dependencia obligatoria de otro plugin. NFR-02: compatibilidad validada por versión, plataforma y proveedor. NFR-03: cambios atómicos, idempotencia y recuperación de operaciones. NFR-04: accesibilidad, tema nativo y traducciones completas. NFR-05: sin costes adicionales de inferencia para routing; APIs de consumo solo opt-in explícito. NFR-06: logs locales minimizados y redactados. NFR-07: no degradar permisos ni interferir con sesiones ajenas. NFR-08: pruebas unitarias sin cuotas y E2E reales mínimos autorizados.

## Alcance MVP
Todos los FR anteriores; GitHub como primer adaptador remoto; Claude, Codex y OpenCode como matriz inicial, no lista rígida. Default propuesto: Review First + Balanced; autorización de publicación denegada hasta configurar. No crear perfiles, importar perfiles ni modificar perfiles nativos. No obligar a crear repositorios remotos. No dependencia ni integración específica inicial con Engram, Memorise, Quick Chat, Context Mode, Observatory, Playbooks o Ensemble. Compatibilidad de coexistencia sin administrar esos plugins. No memoria semántica propia, chat paralelo, editor, motor de agentes, cliente Git completo, SaaS, despliegue automático de producción ni soporte específico GitLab/Bitbucket en MVP.

## Éxito
Instalar sobre Paseo limpio, configurar, iniciar sesión nativa, seleccionar automáticamente proveedor, delegar solo cuando aporta valor, recuperar resultados, integrar cambios verificables y entregar según modo. Usuario puede desactivar el plugin y seguir usando Paseo. Bloqueo explícito si permisos, capacidades o evidencias no bastan.
