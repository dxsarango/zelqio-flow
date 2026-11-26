# Plan detallado — Zelqio Flow
65 tareas en 11 fases. El estado operativo vive en tasks.json (esta tabla no lo duplica); dependencias verificadas por `tools/check-planning.mjs`. Roles son capacidades sugeridas, no asignaciones rígidas. Las fases S01–S10 dependen del gate previo; se puede preparar documentación independiente sin iniciar implementación bloqueada. Los criterios se amplían en PRD, POC y políticas. No estimaciones temporales sin calibración de S00.
## Reglas de ejecución
Ver DEVELOPMENT-WORKFLOW.md y TEST-STRATEGY.md. Los gates requieren evidencia y aprobación según riesgo; G0, G9, G10 explícita del propietario. Un lote contiene solo tareas listas e independientes, con integración serial. No usar el plugin en construcción como dependencia del desarrollo.

Foundation corresponde a S01 y G1. Advanced Orchestration corresponde a S02–S08 y se habilita por capacidad y gate. Complete MVP corresponde a S09–S10 y conserva todos los requisitos originales.

## Punto de recuperación

Verificado el 2026-11-26. G0 aprobado condicionalmente y G1 cerrado. S01 y S02 completas. El [PR #24](https://github.com/dxsarango/zelqio-flow/pull/24) integró S02-T04 en `8afd8f4`. El [PR #25](https://github.com/dxsarango/zelqio-flow/pull/25) cerró G2 en `8dcc063` y habilitó S03. S00-T06–T08 conservan sus bloqueos.

**S02-T04 (onboarding y ajustes).** El worktree del worker conserva los commits `fbf0125` y `6771ff7`. El árbol de `8afd8f4` coincide con `542b1747691c10044ce80f815740368360d81c57`, verificado en [Paseo aislado](http://127.0.0.1:16875/). Pasaron tipos, lint, 105 tests en 8 archivos e integridad de la planificación en Windows local. GitHub confirmó los cuatro checks obligatorios en el SHA aprobado. La verificación EN/ES con uno y varios proveedores y la revisión de permisos de G2 constan en `tasks.json`.

**Reglas que se aplicaron y siguen vigentes.** No apilar PRs: tras cada squash crear la rama desde `origin/main`. Integrar automáticamente solo lo que cumple la autorización permanente (checks verdes sobre el SHA exacto, `--squash --match-head-commit`). Cada tarea de riesgo alto lleva revisión independiente de otro proveedor cuando está disponible. Worktrees conservados, no archivar ni eliminar: `g0-approval`, `g0-lifecycle`, `s00-t03`, `s00-t05`, `foundation-validation-backlog` y `s02-t04`.

**Aprobación del propietario.** Funcionalidad de S02-T04 aprobada para `542b1747691c10044ce80f815740368360d81c57`. El diseño visual definitivo queda pendiente. El [PR #24](https://github.com/dxsarango/zelqio-flow/pull/24) usa ese SHA. G2 verifica el flujo EN/ES con uno y varios proveedores y que el asistente mantenga los permisos existentes. Smart Review conserva sus condiciones vigentes.

### Revisión posterior de onboarding y ajustes

- Agrupar proveedores disponibles y no disponibles. Ocultar por defecto los no disponibles y los detalles técnicos de errores.
- Mejorar la jerarquía visual, el aprovechamiento del espacio y el indicador de progreso. Eliminar información redundante entre pasos.
- Explicar las estrategias y modos de trabajo, y permitir editar secciones desde el resumen.
- Unificar los accesos permanentes a Zelqio Flow y su configuración inicial. Convertir el diagnóstico en un dashboard funcional.
- Mantener coherencia con la interfaz nativa de Paseo y verificar los temas Light y Dark.

La revisión de recursos de S03-T04 recoge la organización de proveedores y el diagnóstico de disponibilidad. S08-T04 recoge la revisión integrada de navegación, onboarding y temas. La aprobación visual se hará sobre el candidato de esa revisión.

**Condición funcional de la selección de modelos.** S03-T02 y G3 deben verificar que una política de financiación solo gratuita excluye modelos de pago y modelos cuya financiación sea desconocida, incluso al aplicar un modelo predeterminado o un fallback de S03-T03. La elección en S02-T04 solo guarda la preferencia del proveedor. El candidato aprobado no selecciona modelos ni inicia sesiones, y el estado del plugin mantiene los efectos deshabilitados. La capacidad de selección queda condicionada a evidencia del tipo de financiación por modelo y a pruebas negativas sin consumo de pago.

**Trabajo independiente.** Las investigaciones y pruebas preparatorias pueden avanzar con contratos estables, fixtures propios y sin depender del resultado que espera validación. La implementación, integración y habilitación de capacidades conservan las dependencias y gates aplicables. S03-T02 y S03-T04 comparten el contrato de S03-T01. Una vez integrado ese contrato, la revisión de la interfaz de recursos puede continuar en paralelo con el routing si sus archivos son independientes.

**S03 (cuotas y selección).** G3 completó las verificaciones técnicas de cuota, concurrencia, financiación y selección explicable mediante candidatos ordenados y motivos de exclusión. El journal conserva la financiación original y la suspensión de cuota entre intentos. El dashboard quedó integrado con revisión humana diferida. G3 habilita el desarrollo de S04 y la selección real de modelos sigue deshabilitada. [Dashboard de recursos](https://github.com/dxsarango/zelqio-flow/pull/27) · [Router](https://github.com/dxsarango/zelqio-flow/pull/28) · [Journal local](https://github.com/dxsarango/zelqio-flow/pull/29)

**Revisiones del propietario pendientes.**

La autorización temporal de revisión diferida terminó al regresar el propietario. El dashboard integrado conserva su revisión pendiente y las nuevas interfaces siguen la validación ordinaria.

| Flujo | SHA | Qué revisar |
|---|---|---|
| S02-T04, onboarding y ajustes | `542b1747691c10044ce80f815740368360d81c57` | Diseño visual definitivo y mejoras de la lista anterior. La funcionalidad de este SHA tiene aprobación humana. |
| S03-T04, dashboard de recursos | `1d010b3c3b34d301fa2357e49dd512e01a4c4492` | Presentación funcional aprobada. El diseño visual definitivo se agrupa con onboarding y compositor. |
| S04-T01, compositor nativo | `4002d3e8b973c322fb70880ff461cb66c90031b7` | Integración observada por el propietario en New Workspace y aceptada para el SHA indicado. El diseño visual definitivo sigue pendiente. [PR #31](https://github.com/dxsarango/zelqio-flow/pull/31) |

**Revisión integral de UI/UX (S08-T04).**

- Mostrar indicadores visuales de cuotas y agrupar proveedores y ventanas de consumo en una vista compacta. Distinguir proveedores principales, auxiliares y desactivados. Mantener plegados por defecto los proveedores no disponibles y los detalles técnicos.
- Mejorar jerarquía, espaciado y aprovechamiento del espacio. Unificar la navegación del setup y el dashboard.
- Mantener estable el tamaño del compositor al activar Automática. Evaluar un menú contextual compacto para elegir el estado, explicar su alcance y recordar preferencias.
- Reutilizar componentes nativos de Paseo y comprobar Light y Dark. Representar las cuotas según la procedencia verificada y dejar sin asociación las fuentes que no puedan vincularse con certeza a proveedores o modelos.

**S04.** S04-T01 quedó integrado con aprobación funcional y revisión visual integral pendiente. S04-T05 conserva la recomendación consultiva en el candidato local `9abda07`, con 137 tests y prueba del RPC en el daemon aislado. Publicación, CI y entrega están pendientes. S04-T06 prepara la selección supervisada y puede probar el compositor con fixtures antes de integrar la recomendación. La sonda de S04-T02 aplicó una selección sintética antes de abrir la sesión y preservó un modelo explícito. La selección automática espera autorización permanente verificable, financiación ligada al destino y evidencia de preservación del modelo en ambos flujos nativos. S04-T03 y G4 conservan sus dependencias de producción. [Evidencia del hook](../docs/evidence/S04-T02-creation-authority.md) · [ADR](../docs/adr/S04-routing-authority.md)

**Relevo.** Un solo coordinador con permiso de escribir `tasks.json` y `PLAN.md`: el vigente se identifica por el agente raíz activo en Paseo y el registro de Engram (`coordination/lease`). Un sucesor sin historial lee `AGENTS.md`, esta sección, `tasks.json`, `git worktree list`, `gh pr list`, la lista de agentes de Paseo y `paseo usage ls`, confirma que no hay otro coordinador activo y entonces escribe. Procedimiento completo en [Relevo de coordinación](DEVELOPMENT-WORKFLOW.md#relevo-de-coordinación).

## S00 — Definition & Feasibility
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S00-T01 | Baseline de producto y entorno | — | Orchestrator | medium | PRD y versiones fijadas; revisar alcance y preparar daemon/fixtures aislados; ningún proyecto real alterado |
| S00-T02 | Contrato del compositor y routing inicial | S00-T01 | UI Developer | high | POC-01/02: control nativo, opt-in, metadata, proveedor correcto antes de inferencia y sesión normal intacta |
| S00-T03 | Catálogo y cuotas | S00-T01 | Developer | medium | POC-03: captura saneada de API pública real, freshness, reset, unknown y compatibilidad 0.17.4 |
| S00-T04 | Roles, herramientas y permisos | S00-T01 | Senior Developer | high | POC-04/05/06: agente directo, caller identity, MCP on/off y matriz de restricciones reales |
| S00-T05 | Subagentes y worktrees | S00-T04 | Developer | high | POC-07/08: relación padre-hijo visible, checkout separado y base exacta |
| S00-T06 | Git y publicación de prueba | S00-T05 | Senior Developer | high | POC-09/10/15: integración, recuperación de conflictos, PR privado, checks por SHA, rechazos y capacidad efectiva de protecciones/auto-merge |
| S00-T07 | Servicios y aprobación | S00-T02 | UI Developer | high | POC-11/17: servicio ligado a versión y aprobación de tarea/SHA por actor autenticado; operación manual si la UI carece de procedencia verificable |
| S00-T08 | Persistencia, aislamiento y privacidad | S00-T04, S00-T05 | QA | high | POC-12/13/14/16: recuperar pendientes al reiniciar sin otorgar permisos, preservar el entorno al retirar y atribuir tráfico y estado exportado |
| S00-T09 | ADR y gate G0 | S00-T02, S00-T03, S00-T04, S00-T05 | Reviewer | high | Revisión independiente y aprobación condicionada de Foundation; validaciones del MVP completo siguen como prerequisitos de G9. |

[G0 aprobado condicionalmente](../docs/adr/G0-supervised-scope.md) para S01 local supervisado en Windows y Paseo 0.17.4. S00-T06, S00-T07 y S00-T08 conservan sus bloqueos para el MVP completo y son prerequisitos de G9. Consultar el [dictamen](../docs/evidence/G0-decision.md) y la [matriz de validación](../docs/VALIDATION-BACKLOG.md).

## S01 — Foundation
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S01-T01 | Scaffold y manifest | S00-T09 | Developer | medium | Plugin mínimo instala y carga cliente/servidor en versión validada; sin hooks invasivos |
| S01-T02 | CI y harness | S01-T01 | QA | medium | Typecheck lint unit tests en matriz Windows/macOS/Linux; sin secretos o inferencia en CI |
| S01-T03 | Persistencia y migraciones | S01-T01 | Senior Developer | high | Settings versionados, almacenamiento atómico, backup y recuperación ante corrupción probados |
| S01-T04 | RPC y contratos core | S01-T01 | Developer | medium | Tipos/validación runtime, errores normalizados, mocks SDK; contratos aprobados |
| S01-T05 | UI base e internacionalización | S01-T01 | UI Developer | low | Componentes nativos, EN/ES y temas; no traducciones faltantes |
| S01-T06 | Gate G1 | S01-T02, S01-T03, S01-T04, S01-T05 | Reviewer | medium | Instalación aislada Windows/Paseo 0.17.4, CI y documentación verificados, Smart Review para cambios visuales y efectos avanzados inactivos. |
| S01-T07 | Revisión independiente de persistencia y limpieza de temporales | S01-T03 | Reviewer | medium | Revisión independiente por Codex de server/store.ts, server/policy.ts y sus tests cuando su cuota esté disponible; hallazgos corregidos o registrados. Decidir y probar la limpieza segura de temporales .tmp-* y .bak.tmp-* tras cierres abruptos. No bloquea G1 ni tareas independientes. |

## S02 — Providers & Roles
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S02-T01 | Provider catalog | S01-T06 | Developer | medium | Detectar catálogo y estado con adapter; no hardcode de modelos; errores visibles |
| S02-T02 | Policy engine y autorizaciones | S01-T06 | Senior Developer | high | Precedencia global/proyecto/sesión y deny, acciones remotas separadas, pruebas negativas |
| S02-T03 | Roles internos y personalizados | S02-T01, S02-T02 | Developer | medium | Siete roles y candidatos editables; validación de permisos/capacidades; cero Agent Profiles |
| S02-T04 | Onboarding y settings | S02-T03 | UI Developer | medium | Instalación limpia, uno o más proveedores, funding, estrategia, modo, Git y resumen |
| S02-T05 | Gate G2 | S02-T04 | Reviewer | medium | Flujo EN/ES validado con proveedor único y múltiples; permisos no elevados |

## S03 — Smart Router
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S03-T01 | Usage adapter y caché | S02-T05 | Developer | medium | Fresh/stale/unknown/exhausted/reset diferenciados; API soportada y backoff probado |
| S03-T02 | Router determinista | S03-T01 | Senior Developer | medium | Elegibilidad y estrategias, empate y reservas, sin tokens adicionales ni sustitución de funding |
| S03-T03 | Fallback y registro local | S03-T02 | Developer | high | Reintento acotado, exclusión por agotamiento, preservación de trabajo y reincorporación verificable para nuevas tareas |
| S03-T04 | UI de recursos y disponibilidad | S03-T01 | UI Developer | low | Cuotas reales con freshness y unknown, preferencias editables y razón de selección |
| S03-T05 | Gate G3 | S03-T03, S03-T04 | QA | medium | Pruebas deterministas de cuota/empate/concurrencia/funding y selección explicable |

## S04 — Native Integration
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S04-T01 | Control nativo y metadata | S03-T05 | UI Developer | high | New Agent/New Workspace, disabled/automatic y persistencia del opt-in; no chat separado |
| S04-T05 | Recomendación determinista de routing | S04-T01 | Developer | low | RPC de solo lectura sobre pares exactos, con financiación declarada y cuota sin vincular; excluye consumo |
| S04-T06 | Selección supervisada en el compositor | S04-T05 | UI Developer | high | Aplicación visible al borrador nativo y envío separado; preserva modelo y modo en New Agent y New Workspace |
| S04-T02 | Hook de creación y configuración | S04-T05, S04-T06 | Developer | high | Proveedor/modelo/permiso antes de primer mensaje; respeta selección explícita y errores |
| S04-T03 | Identidad de sesiones gestionadas | S04-T02 | Senior Developer | high | Registro autoritativo de raíz/worker y no intervención en sesiones ajenas |
| S04-T04 | Gate G4 | S04-T03 | QA | high | E2E mínimo de sesión nativa y opt-out, sin cambios globales ni perfiles |

## S05 — Agent Orchestration
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S05-T01 | DAG y runtime de tareas | S04-T04 | Senior Developer | high | Dependencias acíclicas, estados, leases, idempotencia y límites de concurrencia |
| S05-T02 | Herramientas de orquestador | S05-T01 | Developer | high | Delegar/consultar/cancelar/recolectar con caller identity y deny por rol |
| S05-T03 | Workers nativos y mensajes | S05-T02 | Developer | high | Crear con rol/proveedor, parent-child, resultados y permisos visibles en Paseo |
| S05-T04 | Recuperación y handoff | S05-T03 | Senior Developer | high | Progreso real y lease con caducidad y exclusión por época. Supervisor local sin inferencia, reintentos acotados y reanudación tras cuota verificada. Conservar intentos y sesiones |
| S05-T05 | Actividad local y estado | S05-T03 | UI Developer | medium | Mostrar decisiones, tareas, bloqueos; sin copiar conversaciones ni dashboard redundante |
| S05-T06 | Gate G5 | S05-T04, S05-T05 | Reviewer | high | Delegación bajo demanda, cancelación, recursión negativa y reconciliación demostradas |

## S06 — Git Coordinator
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S06-T01 | Preflight y workflows Git | S05-T06 | Senior Developer | high | Repo/remotos/base/dirty/permissions; Git local, PR, fork, direct y no-Git diferenciados |
| S06-T02 | Ramas, worktrees y commits | S06-T01 | Developer | high | Base exacta, staging seguro y retirada verificable sin fuerza, solo con checkout limpio, refs preservadas y sin trabajo ni validaciones pendientes |
| S06-T03 | Integración y conflictos | S06-T02 | Senior Developer | high | Lock común, CAS/revalidación, integración serial, journal y recuperación sin pérdida |
| S06-T04 | Adaptador GitHub | S06-T01 | Developer | high | gh autenticado y destino explícito; checks/protecciones por SHA; denegación si falta capacidad para aplicar la política |
| S06-T05 | UI Git y evidencia | S06-T02, S06-T04 | UI Developer | medium | Mostrar workflow, ramas, SHA, permisos y bloqueos; cambios de configuración confirmados |
| S06-T06 | Gate G6 | S06-T03, S06-T05 | Reviewer | high | Fixtures Git y sandbox remoto; pruebas negativas, conflictos y rechazo por rulesets |

## S07 — Work Modes
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S07-T01 | Delivery gates y aprobación | S06-T06 | Senior Developer | high | Actor humano verificable y tarea/acción/SHA/política ligados; pendientes se recuperan tras reinicio y efectos revalidan y deduplican |
| S07-T02 | Review First y Auto Merge | S07-T01 | Developer | high | Aprobación explícita o merge autorizado tras checks; no bypass, pending bloquea |
| S07-T03 | Clasificador Smart Review | S07-T01 | Developer | high | Diff real e impacto, docs/UI/backend/riesgo/unknown; sin depender de prefijo |
| S07-T04 | Iteraciones Smart Review | S07-T03 | UI Developer | high | Request changes y approve sobre misma rama/PR; invalidación SHA y estado de prueba |
| S07-T05 | Autopilot | S07-T01 | Developer | high | Flujo resultado-first y mínimos bloqueos autorizados; no publicación o gasto implícito |
| S07-T06 | Selector y overrides de modo | S07-T02, S07-T04, S07-T05 | UI Developer | medium | Global/proyecto/sesión visibles; políticas superiores prevalecen |
| S07-T07 | Gate G7 | S07-T06 | Reviewer | high | Cuatro modos con escenarios locales y PR; pruebas de aprobación obsoleta y restricciones |

## S08 — Validation & Delivery
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S08-T01 | Checks y evidencia | S07-T07 | Developer | high | Plan proporcional, local vs CI, N/A/pending/fail; evidencia ligada a candidato |
| S08-T02 | Revisión independiente | S08-T01 | Senior Developer | high | Selección cross-provider cuando viable; sin falsa independencia; bloqueos de riesgo |
| S08-T03 | Servicios y preview | S07-T07 | Developer | high | Servicio nativo, puertos/health/version, host remoto y parada verificados |
| S08-T04 | Entrega y UX final | S08-T01, S08-T03 | UI Developer | medium | Resultado funcional o bloqueo honesto, preview/PR/diff según modo |
| S08-T06 | Power Management | S08-T03 | Senior Developer | high | Prevención temporal de suspensión y liberación. Suspensión opcional cancelable solo con autorización y ausencia verificable de trabajo protegido. Windows primero |
| S08-T05 | Gate G8 | S08-T02, S08-T04, S08-T06 | QA | high | Escenarios end-to-end de entrega y ciclo de vida de Power Management. Efectos de energía sujetos a evidencia y autorización |

## S09 — Hardening
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S09-T01 | Auditoría de seguridad | S08-T05 | Reviewer | high | Amenazas, symlink/junctions, inyección, permisos, rutas, secretos y recursión; hallazgos resueltos |
| S09-T02 | Fault injection y recuperación | S08-T05 | QA | high | Relevos fallidos, reset, suspensión, reinicio y carreras; no duplicación ni pérdida; journal reconciliado |
| S09-T03 | Privacidad y retención | S08-T05 | Developer | high | Redacción, expiración segura, export manual y zero telemetry verificado |
| S09-T04 | Matriz real multiplataforma | S09-T01, S09-T02, S09-T03 | QA | high | Versiones, proveedores y Power Management en Windows, macOS y Linux. Capacidades sin verificar deshabilitadas |
| S09-T05 | Actualización y desinstalación | S09-T02, S09-T03 | Developer | high | Migraciones rollback y recursos ajenos intactos; clean install sin terceros |
| S09-T06 | Gate G9 | S09-T04, S09-T05, S00-T06, S00-T07, S00-T08 | Reviewer | high | Revisión independiente, cierre de validaciones del MVP completo, compatibilidad y aceptación del propietario. |

## S10 — Public Release
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S10-T01 | Documentación pública EN/ES | S09-T06 | Assistant | low | Install, setup, modos, Git, permisos, troubleshooting, límites y uninstall |
| S10-T02 | Packaging y licencias | S09-T06 | Developer | medium | Manifest, SemVer, LICENSE titular confirmado, avisos terceros, paquete sin datos privados |
| S10-T03 | Release candidate y validación | S10-T01, S10-T02 | QA | high | Instalación desde tag/candidato limpio, upgrade/rollback, matriz y CI reales |
| S10-T04 | Gate G10 y publicación | S10-T03 | Orchestrator | high | Aprobación explícita, requisitos actuales catálogo verificados, tag/release/publicación autorizados |
