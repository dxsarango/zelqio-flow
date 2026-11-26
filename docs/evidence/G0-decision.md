# Gate G0 — Evidencia y propuesta de decisión

Fecha 2026-11-26. Entorno principal de prueba Windows y Paseo 0.17.4. El alcance usa fixtures desechables, un daemon aislado para las sondas locales y un sandbox privado para la sonda de GitHub. Las conclusiones se limitan a las condiciones indicadas por cada prueba.

## Capacidades comprobadas y límites

| POC | Resultado | Límite y decisión requerida |
|---|---|---|
| 01–02 · Compositor y routing | PASS en los casos probados | Opt-in y configuración antes del primer mensaje. Validar propagación entre New Workspace y agente inicial. [S00-T02](S00-T02-composer-routing.md) |
| 03 · Catálogo y cuotas | PASS con catálogo y cifras sintéticas | Usar desconocido si faltan datos o caducan. Confirmación explícita o señal verificable habilita reincorporación. [S00-T03](S00-T03-catalog-usage.md) |
| 04–06 · Agentes, identidad y límites | PASS parcial | Agentes sin perfiles y herramientas propias con autenticación de sesión en los casos probados. Excluir modos/proveedores sin límites efectivos e impedir efectos cuando falte identidad. [S00-T04](S00-T04-roles-tools-permissions.md) |
| 07–08 · Vínculo nativo y worktrees | PASS para vínculo activo, base y separación. FAIL para retiro de worktree administrado sucio | Las etiquetas de tarea sobrevivieron al desprenderse la raíz. La retirada sin fuerza se probó en fixtures de propiedad externa. Conservar los checkouts administrados y usar ejecución secuencial cuando falte una alternativa aprobada. [S00-T05](S00-T05-subagents-worktrees.md) · [Red, limpieza y continuidad](G0-lifecycle-privacy.md) |
| 09–10 · Git local | PASS para las sondas de integración, conflicto y reintento | Recuperación del estado de Git entre procesos. Sigue por validar el journal del producto con operaciones activas. [S00-T06](S00-T06-git-publication.md) |
| 11 · Servicio y candidato | PASS local | La respuesta HTTP directa y por proxy confirmó el SHA de la fixture. SDK de plugins para arranque y host remoto real siguen sin validar. [S00-T07](S00-T07-services-approval.md) |
| 12 · Reinicio y estado | PASS para archivo de fixture tras stop/start. FAIL del almacén volátil original | El archivo conserva el pendiente con su identidad, SHA y política. Faltan caída abrupta, concurrencia entre procesos y reconciliación de agentes, permisos y efectos en curso. [Aprobación y persistencia](G0-approval-persistence.md) |
| 13–14 · Aislamiento y retirada de plugin | PASS en fixture | Un plugin de control, un servicio y los archivos Git quedaron intactos. [S00-T08](S00-T08-persistence-isolation-privacy.md) |
| 15 · GitHub privado | PASS parcial | Ramas, PR, CI por SHA y rechazos HTTP verificados. Protecciones y auto-merge indisponibles en este sandbox. No autorizar merge automatizado si faltan las reglas exigidas. [S00-T06](S00-T06-git-publication.md) |
| 16 · Privacidad | PASS en la atribución reproducida y exportación sintética. BLOCKED para el criterio completo | Controles con y sin plugin atribuyeron las conexiones reproducidas a descargas de voz de Paseo. El endpoint histórico no se conservó. Falta cobertura de otras operaciones, IPv6, procesos hijos y exportación real. [Red, limpieza y continuidad](G0-lifecycle-privacy.md) · [S00-T08](S00-T08-persistence-isolation-privacy.md) |
| 17 · Aprobación humana | FAIL para procedencia nativa | Las sondas confirman acción y SHA, además del vínculo a tarea en el almacén. La superficie disponible carece de identidad humana verificable. Para un efecto sensible hace falta una autoridad verificable o ejecución manual. [Aprobación y persistencia](G0-approval-persistence.md) |

## Propuesta para el propietario

- **Base:** 0.17.4 en Windows como referencia comprobada para S00. Fijar superficies soportadas. Añadir pruebas por versión y plataforma antes de ampliar compatibilidad.
- **Modo inicial acotado:** coordinación local supervisada, checkout conservado, un escritor cuando el aislamiento o ciclo de vida no estén validados y PRs con evidencia donde estén autorizados. Si una acción exige aprobación que el plugin no puede autenticar, entregar la evidencia y dejar la acción final al propietario.
- **Automatización condicionada:** identidad verificable de agentes, permisos por capacidad, journal recuperable y protecciones reales por repositorio. La aprobación autenticada y ligada al candidato, el cierre seguro del checkout y la ausencia de tráfico propio necesitan evidencia antes de habilitar las operaciones correspondientes.

**Decisión propuesta:** el núcleo local y supervisado tiene viabilidad técnica condicionada. El alcance completo de automatización del MVP sigue bloqueado. El propietario debe decidir si acepta una fase inicial acotada o mantiene bloqueado G0 hasta resolver los requisitos críticos. La aprobación de arquitectura, alcance y arranque de S01 corresponde al propietario.

## Candidato de publicación

Publicar mediante PR autorizado contra `main` las instrucciones del proyecto, las propuestas de PRD y arquitectura, los criterios de planificación, las evidencias saneadas y las sondas reproducibles con datos sintéticos. Someter los cambios técnicos de alto riesgo a revisión independiente y respetar `planning-integrity`, SHA y reglas del destino. La decisión de G0 se mantiene explícitamente pendiente en la documentación.

Conservar localmente el snapshot original `00e60e0`, las ramas de investigación, los registros brutos, los directorios de fixture y los datos operativos. El sandbox privado conserva la fixture GitHub. El historial de la rama de coordinación conserva `2b2c8ea`, `d0ae9ea` y `b7e3eff`.
