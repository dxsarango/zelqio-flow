# Plan detallado — Zelqio Flow
63 tareas en 11 fases. El estado operativo vive en tasks.json (esta tabla no lo duplica); dependencias verificadas por `tools/check-planning.mjs`. Roles son capacidades sugeridas, no asignaciones rígidas. Las fases S01–S10 dependen del gate previo; se puede preparar documentación independiente sin iniciar implementación bloqueada. Los criterios se amplían en PRD, POC y políticas. No estimaciones temporales sin calibración de S00.
## Reglas de ejecución
Ver DEVELOPMENT-WORKFLOW.md y TEST-STRATEGY.md. Los gates requieren evidencia y aprobación según riesgo; G0, G9, G10 explícita del propietario. Un lote contiene solo tareas listas e independientes, con integración serial. No usar el plugin en construcción como dependencia del desarrollo.

## S00 — Definition & Feasibility
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S00-T01 | Baseline de producto y entorno | — | Orchestrator | medium | PRD y versiones fijadas; revisar alcance y preparar daemon/fixtures aislados; ningún proyecto real alterado |
| S00-T02 | Contrato del compositor y routing inicial | S00-T01 | UI Developer | high | POC-01/02: control nativo, opt-in, metadata, proveedor correcto antes de inferencia y sesión normal intacta |
| S00-T03 | Catálogo y cuotas | S00-T01 | Developer | medium | POC-03: captura saneada de API pública real, freshness, reset, unknown y compatibilidad 0.17.4 |
| S00-T04 | Roles, herramientas y permisos | S00-T01 | Senior Developer | high | POC-04/05/06: agente directo, caller identity, MCP on/off y matriz de restricciones reales |
| S00-T05 | Subagentes y worktrees | S00-T04 | Developer | high | POC-07/08: relación padre-hijo visible, checkout separado y base exacta |
| S00-T06 | Git y publicación de prueba | S00-T05 | Senior Developer | high | POC-09/10/15: dos ramas integradas, conflicto recuperado, PR sandbox, SHA y rechazo por reglas |
| S00-T07 | Servicios y aprobación | S00-T02 | UI Developer | high | POC-11/17: servicio ligado a versión y actor de aprobación verificable; alternativa UI si chat no prueba actor |
| S00-T08 | Persistencia, aislamiento y privacidad | S00-T04, S00-T05 | QA | high | POC-12/13/14/16: reinicio, desactivación, desinstalación, inspección de tráfico y estado saneado |
| S00-T09 | ADR y gate G0 | S00-T02, S00-T03, S00-T06, S00-T07, S00-T08 | Reviewer | high | Revisión independiente de evidencia y decisión de viabilidad; aprobación humana de versión y arquitectura |

## S01 — Foundation
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S01-T01 | Scaffold y manifest | S00-T09 | Developer | medium | Plugin mínimo instala y carga cliente/servidor en versión validada; sin hooks invasivos |
| S01-T02 | CI y harness | S01-T01 | QA | medium | Typecheck lint unit tests en matriz Windows/macOS/Linux; sin secretos o inferencia en CI |
| S01-T03 | Persistencia y migraciones | S01-T01 | Senior Developer | high | Settings versionados, almacenamiento atómico, backup y recuperación ante corrupción probados |
| S01-T04 | RPC y contratos core | S01-T01 | Developer | medium | Tipos/validación runtime, errores normalizados, mocks SDK; contratos aprobados |
| S01-T05 | UI base e internacionalización | S01-T01 | UI Developer | low | Componentes nativos, EN/ES y temas; no traducciones faltantes |
| S01-T06 | Gate G1 | S01-T02, S01-T03, S01-T04, S01-T05 | Reviewer | medium | Plugin instalable limpio, CI y documentación verificados |

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
| S03-T03 | Fallback y registro local | S03-T02 | Developer | high | Retry acotado, razones, preservación de estado y bloqueo cuando no hay candidato |
| S03-T04 | UI de recursos y disponibilidad | S03-T01 | UI Developer | low | Cuotas reales con freshness y unknown, preferencias editables y razón de selección |
| S03-T05 | Gate G3 | S03-T03, S03-T04 | QA | medium | Pruebas deterministas de cuota/empate/concurrencia/funding y selección explicable |

## S04 — Native Integration
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S04-T01 | Control nativo y metadata | S03-T05 | UI Developer | high | New Agent/New Workspace, disabled/automatic y persistencia del opt-in; no chat separado |
| S04-T02 | Hook de creación y configuración | S04-T01 | Developer | high | Proveedor/modelo/permiso antes de primer mensaje; respeta selección explícita y errores |
| S04-T03 | Identidad de sesiones gestionadas | S04-T02 | Senior Developer | high | Registro autoritativo de raíz/worker y no intervención en sesiones ajenas |
| S04-T04 | Gate G4 | S04-T03 | QA | high | E2E mínimo de sesión nativa y opt-out, sin cambios globales ni perfiles |

## S05 — Agent Orchestration
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S05-T01 | DAG y runtime de tareas | S04-T04 | Senior Developer | high | Dependencias acíclicas, estados, leases, idempotencia y límites de concurrencia |
| S05-T02 | Herramientas de orquestador | S05-T01 | Developer | high | Delegar/consultar/cancelar/recolectar con caller identity y deny por rol |
| S05-T03 | Workers nativos y mensajes | S05-T02 | Developer | high | Crear con rol/proveedor, parent-child, resultados y permisos visibles en Paseo |
| S05-T04 | Recuperación y handoff | S05-T03 | Senior Developer | high | Reinicio y cuota agotada recuperan estado sin duplicar trabajo ni perder resultados |
| S05-T05 | Actividad local y estado | S05-T03 | UI Developer | medium | Mostrar decisiones, tareas, bloqueos; sin copiar conversaciones ni dashboard redundante |
| S05-T06 | Gate G5 | S05-T04, S05-T05 | Reviewer | high | Delegación bajo demanda, cancelación, recursión negativa y reconciliación demostradas |

## S06 — Git Coordinator
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S06-T01 | Preflight y workflows Git | S05-T06 | Senior Developer | high | Repo/remotos/base/dirty/permissions; Git local, PR, fork, direct y no-Git diferenciados |
| S06-T02 | Ramas, worktrees y commits | S06-T01 | Developer | high | Paseo worktrees, base SHA, nomenclatura configurable, staging seguro y preservación de cambios |
| S06-T03 | Integración y conflictos | S06-T02 | Senior Developer | high | Lock común, CAS/revalidación, integración serial, journal y recuperación sin pérdida |
| S06-T04 | Adaptador GitHub | S06-T01 | Developer | high | gh autenticado, destino explícito, repo/PR/push/checks/merge autorizados; sin tokens propios |
| S06-T05 | UI Git y evidencia | S06-T02, S06-T04 | UI Developer | medium | Mostrar workflow, ramas, SHA, permisos y bloqueos; cambios de configuración confirmados |
| S06-T06 | Gate G6 | S06-T03, S06-T05 | Reviewer | high | Fixtures Git y sandbox remoto; pruebas negativas, conflictos y rechazo por rulesets |

## S07 — Work Modes
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S07-T01 | Delivery gates y aprobación | S06-T06 | Senior Developer | high | Actor/acción/SHA/política verificables; revalidar ante cambios, estado durable |
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
| S08-T05 | Gate G8 | S08-T02, S08-T04 | QA | high | Escenarios end-to-end docs, UI iterativa, backend, landing local y CI fallido |

## S09 — Hardening
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S09-T01 | Auditoría de seguridad | S08-T05 | Reviewer | high | Amenazas, symlink/junctions, inyección, permisos, rutas, secretos y recursión; hallazgos resueltos |
| S09-T02 | Fault injection y recuperación | S08-T05 | QA | high | Crash/restart/timeouts/external edits; no duplicación ni pérdida; journal reconciliado |
| S09-T03 | Privacidad y retención | S08-T05 | Developer | high | Redacción, expiración segura, export manual y zero telemetry verificado |
| S09-T04 | Matriz real multiplataforma | S09-T01, S09-T02, S09-T03 | QA | high | Versiones/OS/proveedores con evidencia; desconocidos explícitos y mínimo soportado |
| S09-T05 | Actualización y desinstalación | S09-T02, S09-T03 | Developer | high | Migraciones rollback y recursos ajenos intactos; clean install sin terceros |
| S09-T06 | Gate G9 | S09-T04, S09-T05 | Reviewer | high | Revisión independiente, sin blockers críticos, aceptación de propietario |

## S10 — Public Release
| ID | Tarea | Depende de | Rol | Riesgo | Entregable y aceptación |
|---|---|---|---|---|---|
| S10-T01 | Documentación pública EN/ES | S09-T06 | Assistant | low | Install, setup, modos, Git, permisos, troubleshooting, límites y uninstall |
| S10-T02 | Packaging y licencias | S09-T06 | Developer | medium | Manifest, SemVer, LICENSE titular confirmado, avisos terceros, paquete sin datos privados |
| S10-T03 | Release candidate y validación | S10-T01, S10-T02 | QA | high | Instalación desde tag/candidato limpio, upgrade/rollback, matriz y CI reales |
| S10-T04 | Gate G10 y publicación | S10-T03 | Orchestrator | high | Aprobación explícita, requisitos actuales catálogo verificados, tag/release/publicación autorizados |
