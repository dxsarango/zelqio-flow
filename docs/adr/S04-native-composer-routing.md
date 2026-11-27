# S04 — Routing automático y compositor nativo (propuesta)

> **Actualización del 27 de noviembre de 2026.** [R1](R1-orchestration-plugin-on-paseo.md) simplifica la arquitectura: la verificación exhaustiva que describe este documento pasa a ser opcional (modo Estricto) y deja de bloquear el producto. El contenido sigue como referencia.

**Estado:** propuesta, revisada tras una revisión independiente. No sustituye ni modifica [S04 · Autoridad para seleccionar modelos](S04-routing-authority.md). Todos los efectos siguen deshabilitados hasta que el propietario apruebe. Evidencia: [S04 · Compositor nativo](../evidence/S04-native-composer-routing.md).

## Contexto

El propietario exige conservar *activar Automatic y escribir el prompt*, no reducir el alcance del MVP (FR-02, FR-03) y no sobrescribir nunca una elección explícita ([ADR S04](S04-routing-authority.md)).

El hook `agent.create.before` es el único punto soportado que espera a Zelqio antes de abrir la sesión. Recibe `config`, `env`, `metadata` y, desde 0.17.5, `workspaceId` de solo lectura. No recibe la procedencia de cada valor. En los flujos nativos observados ([S04-T02](../evidence/S04-T02-creation-authority.md), [S04-T06](../evidence/S04-T06-supervised-selection.md)) el compositor envió siempre un modelo, así que el hook no distingue una elección explícita de un valor predeterminado.

## Qué prueban los tipos y qué falta por medir

| Afirmación | Base |
|---|---|
| `PluginComposer` no tiene envío, bloqueo previo, identidad de borrador ni procedencia. Los pills exigen `agentId`. Los slash commands solo existen para `workspace` y `agent`. `agent.turn.before` es un evento. `agent.create.before` no recibe el prompt. | **Tipos 0.17.5** (`contract-check.mjs`). |
| Un plugin puede crear agentes: `config` con `provider/model`, `modeId`, `thinkingOptionId`, `options`, `toolPolicy`, `mcpServers`; `prompt` opcional, `metadata`, `labels`, `idempotencyKey`, `agentId`. El handle expone `send`, `options`, `runtimeInfo`, `metadata` y `availableModes`. | **Tipos 0.17.5** (cliente del SDK). |
| La metadata de un borrador viaja a la creación y se limpia al enviar. El item no está montado en teléfono con el menú cerrado. Los comandos actúan sobre el estado vigente. El compositor se bloquea al crear en New Workspace. | **Documentación del host**, sin verificar en ejecución. |
| Que el snapshot de un agente refleje la configuración final, el orden de los hooks entre plugins y el relleno de `firstAgentContext.prompt`. | **No verificado.** Lo cubre la sonda del daemon 0.17.5. |

## Revisión independiente: qué cambia

| Hallazgo | Resolución |
|---|---|
| 1. La instantánea de montaje no establece el predeterminado de Paseo. | Se clasifica como **desconocida**. Las escrituras automáticas en el borrador quedan deshabilitadas. |
| 2. Un registro coincidente no prueba que Zelqio sea el autor. Un nonce copiado puede usarse antes. | Se retira la sustitución sobre el borrador nativo. En el lanzador el nonce no sale del servidor (D). |
| 3. `setModel`, opciones y `setMetadata` son operaciones separadas y pueden llegar a Send sin su registro. | Sin escritura automática en el borrador no hay ventana. Lo cierra la solicitud a Paseo (E). |
| 4. La propuesta persistida no pasa `selectionInvalidation` (requiere el objeto original, local al proceso). | Se retira la persistencia. Tras un reinicio se reevalúa con `evaluateSelection` y alcance confiable. Sin base reconstruible, no hay escritura. |
| 5. El hook no ve la ruta efectiva final ni restaura opciones. | En D se crea el agente inactivo y se verifica la configuración efectiva **antes del primer mensaje**. No se restaura nada parcialmente. |
| 6. Faltan criterios de entrada por fase. G4 depende de S04-T03. Teléfono. | Ver fases e impacto. |
| 7. Acotar afirmaciones del SDK. | Tabla anterior. |

## Opciones

| Opción | Cumple *activar y escribir* | Elección explícita preservada | Autor del modelo | Veredicto |
|---|---|---|---|---|
| A. Solo hook de creación | Sí | No: sin procedencia sustituye todo o nada | Ambiguo | Descartada como único mecanismo. |
| B. Observar sin escribir | Sí, sin efecto | Sí | — | Útil como diagnóstico y para probar la matriz. Equivale a recomendador: no cumple el MVP. |
| C. Híbrida: escribir en el borrador y atestar | Sí, en el compositor nativo | **No demostrable** hoy (hallazgos 1 a 5) | Ambiguo | Escrituras bloqueadas. Solo se mantiene la aplicación **supervisada**: el clic explícito del usuario es una elección explícita. |
| **D. Lanzador de Zelqio** | Sí, **en el formulario de Zelqio** | Sí, por construcción | Zelqio, único autor | **Recomendada** para el efecto automático. |
| E. Solicitud a Paseo | Sí, en el compositor nativo | Sí, con procedencia del host | Atestado por el host | Se solicita en paralelo. Al llegar, permite volver a C sin riesgo. |

Criterios: conservar la experiencia, no sobrescribir elecciones explícitas, revalidar en el efecto, solo interfaces soportadas y sin dependencias, efectos deshabilitados hasta cada gate, degradar a la ruta nativa.

**Recomendación:** D como vía automática del MVP, B y la aplicación supervisada como etapas de verificación, y E en paralelo. El costo para el usuario es una superficie distinta: *activar Automatic y escribir el prompt* ocurre en un formulario de Zelqio y no en el compositor nativo, que sigue intacto para el uso manual. **Decisión del propietario:** aceptar D como vía automática o esperar a E.

## Opción D en detalle

### Qué puede hacer un plugin (tipos y documentación de 0.17.5)

| Capacidad | Resultado |
|---|---|
| Pantalla o panel con un campo de prompt | Sí: `addScreen`, `addWorkspacePanel`, `addCommandCenterItem`, `addHeaderButton`, componentes de `react-native`. |
| Elegir workspace o proyecto | Sí: `useWorkspaces` y `useProjects`. Un panel de workspace conoce el contexto sin selector. |
| Crear el agente con modelo, modo, opciones y metadata exactos | Sí: `workspace.agents.create({ config, metadata, … })`, desde el cliente o desde un handler del servidor. |
| Adjuntar el prompt | Sí (`prompt`, `send`). Se recomienda crear **sin** prompt, verificar y enviar con `send`. |
| Dejar intacto el compositor nativo | Sí: es una superficie aparte. |
| Crear también el workspace (New Workspace) | Posible con `workspaces.create`, pero hay que reproducir aislamiento, base y rama. Queda para una fase posterior. |

### Flujo

1. El usuario activa Automatic, escribe el prompt, elige workspace y pulsa **Iniciar**. El formulario muestra el modelo recomendado y el motivo antes del clic. Un selector permite fijar un modelo exacto: esa elección se respeta y no se enruta.
2. El RPC `zelqio.launch.start` resuelve el alcance confiable (host, proyecto, workspace) y evalúa la selección con `evaluateSelection` y su evidencia de financiación. Si falla, no se crea nada.
3. El **servidor** registra en memoria un nonce con la configuración prevista y crea el agente inactivo con `metadata["zelqio-flow.launch"] = { version, nonce, origin, requestedAt }`.
4. `agent.create.before` consume el nonce de forma atómica y exige igualdad exacta de proveedor, modelo, modo y opciones. Sin registro o con nonce desconocido o consumido: **nativo, se conserva** y nunca se bendice.
5. Con el agente creado, el servidor lee su snapshot y verifica proveedor, modelo, modo, razonamiento y opciones efectivas. Si difiere, se detiene **antes del primer mensaje**.
6. Solo entonces envía el prompt y registra el resultado.

La procedencia es de primera mano: el nonce nace y muere en el servidor y la solicitud la escribe Zelqio. No hay ambigüedad explícito/predeterminado, ni carrera con el selector nativo, ni ventana entre aplicar y enviar.

### Autoridad y brecha de identidad

La tabla de [S04-routing-authority](S04-routing-authority.md) exige para iniciar una sesión una acción nativa de Paseo o una capacidad de lanzamiento autorizada por separado. Un clic en un formulario de plugin **no es una acción nativa de Paseo**. Propuesta: tratarlo como esa capacidad de lanzamiento, cuya autorización es la aprobación de este ADR más la política permanente vigente para la ruta exacta. El clic es la intención (necesaria, no suficiente) y no concede autoridad.

Brecha que permanece: el RPC del plugin no lleva procedencia humana autenticada (el hook tampoco, [S04-T02](../evidence/S04-T02-creation-authority.md)). Código que llame al mismo punto de entrada es indistinguible de un clic. Está acotada porque los plugins son código de confianza sin sandbox según la documentación, porque la política limita el efecto a la ruta exacta sin costos adicionales y porque crear una sesión es lo que ese código ya podría hacer con el SDK. Las operaciones que requieren aprobación humana (FR-12) no se ven afectadas. Requiere la aprobación explícita del propietario.

### Qué se pierde frente al compositor nativo y cómo mitigarlo

| Pérdida | Mitigación |
|---|---|
| Adjuntos, imágenes, `@` y dictado nativos. | Fase inicial sin adjuntos y aviso visible. La acción *Iniciar con Zelqio* dentro del compositor (leer prompt, modo y opciones) se evalúa tras una sonda, pero no ve los adjuntos de Paseo y no puede avisar de ellos. |
| Slash commands y borradores persistentes. | Entradas rápidas (Command Center, botón de cabecera, panel). Un slash `/auto` (contexto `workspace`) queda como variante a verificar en el compositor de borrador. |
| Controles nativos de modo, razonamiento y opciones. | Reproducir los del catálogo del proveedor. Pendiente comprobar que el catálogo expone todo lo necesario. |
| Aislamiento y rama de New Workspace. | Fase posterior. Brecha de aceptación para FR-02 hasta entonces. |
| Si el usuario pulsa el Send nativo con Automatic activo en el compositor nativo. | El control nativo de Automatic no escribe nada y muestra «inicie desde Zelqio». El hook trata la sesión como nativa. |

### Fallos

| Caso | Comportamiento |
|---|---|
| Política, cuota o financiación vencidas | Se bloquea antes de crear. No existe agente. |
| Un hook posterior cambia la configuración | Detectado por la verificación previa al primer mensaje. El agente inactivo queda para el usuario y se informa. |
| Reinicio durante la creación | El nonce se pierde: el agente queda como nativo, inactivo y sin mensajes. El diario de lanzamientos lo marca para reconciliar. |
| Reclamo repetido, copiado o falsificado | No se bendice. |
| Dos lanzamientos simultáneos | Cada uno tiene su nonce. |
| Plugin deshabilitado | Las sesiones ya creadas conservan su configuración. |

### Interacción con el hook y con la autoridad de selección

El hook solo **verifica** (no escribe en sesiones nativas): lo creado por Zelqio coincide con lo previsto, y lo demás es nativo. `selection-authority` modela hoy un borrador nativo con `nativeChoice.provenance`. El lanzador necesita una variante con origen `launcher`, sin elección nativa, que conserve las comprobaciones de alcance, financiación, mismo proveedor y opciones efectivas. Es una tarea de seguimiento, no se implementa aquí.

## Opción C: qué se conserva

- **Observación** (sin escribir): el item clasifica localmente y alimenta la matriz de pruebas. Una elección manual es pegajosa. La instantánea inicial es *desconocida*, no *predeterminada*.
- **Aplicación supervisada**: botón visible, origen `supervised`, tratada como elección explícita y nunca sobrescrita. En producción exige financiación verificada, política vigente y la aprobación aplicable. No sustituye nada de forma automática.

### Qué se distingue hoy en el compositor nativo

| Clase | ¿Distinguible? |
|---|---|
| Gestionado por Zelqio | No en el compositor nativo. Sí en D (nonce de servidor). |
| Selección manual | Solo por observación continua con el item montado. Elegir otra vez el valor vigente no genera transición. |
| Cambio manual tras una recomendación | Se detecta que difiere, no quién lo hizo. |
| Valor predeterminado de Paseo | **No** (ni cliente ni servidor). |
| Cualquier otra | Desconocida: se conserva. |

## Solicitud mínima a Paseo (E)

1. **Procedencia atestada por el host** en `agent.create.before`: `request.provenance` con, para `provider`, `model`, `modeId`, `thinkingOptionId` y `providerOptions`, un `source` de `"default" | "user" | "api" | { plugin: string }`. El host la mantiene como último escritor: cualquier acción de un selector nativo cuenta como `user` **aunque repita el valor vigente**, y una escritura de plugin vuelve a `user` si el usuario actúa después.
2. **Validación final de solo lectura**: un hook (o la garantía de que el hook del plugin corre el último) que ve la configuración efectiva tras todos los hooks y puede vetar la creación.
3. Opcional: condición de revisión en los setters (`setModel(id, { ifRevision })`) para cerrar la carrera entre comprobar y escribir.

Con 1 y 2, la ruta nativa puede ser automática sin riesgo y D deja de ser la única vía.

## Fases y criterios de entrada

| Fase | Contenido | Criterio de entrada | Efecto |
|---|---|---|---|
| 0 | Esta propuesta y los modelos. | — | Ninguno. |
| 1 | Item que solo observa (B). Matriz de pruebas en un daemon aislado 0.17.5: snapshot final, orden de hooks, `firstAgentContext.prompt`, metadata, teléfono. | Aprobación del propietario de esta propuesta. | Sin escritura. |
| 2 | Lanzador en seco: formulario, RPC y evaluación. Muestra la propuesta y no crea. Variante `launcher` de `selection-authority`. | Fase 1 superada y diseño del formulario validado. | Ninguno. |
| 3 | Lanzador con creación inactiva y envío tras verificar, en un mismo proveedor. | Política permanente con canal autenticado (S04-T02), financiación de la ruta exacta sin pago automático (S04-T02/T07), registro mínimo de sesiones gestionadas (S04-T03), aprobación del propietario de la capacidad de lanzamiento, snapshot final verificado. | **Primer efecto.** |
| 4 | Aplicación supervisada en el compositor nativo. | Las de la fase 3 y la aprobación aplicable. | Escritura por acción explícita. |
| 5 | New Workspace en el lanzador y entradas adicionales. | Fase 3 superada. | Ídem. |
| 6 | Ruta nativa automática con E. | Funcionalidad de Paseo disponible y verificada. | Ídem. |
| 7 | Otros proveedores, delegación y orquestación. | Gates propios. | Ídem. |

## Impacto en S04

Propuesta, sin modificar `planning/`.

- **S04-T06.** Pasa a describir la fase 4. El bloqueo sobre preservar elecciones explícitas se resuelve por definición (el clic es explícito). Siguen vigentes financiación y política.
- **S04-T02.** El hook pasa de aplicar a *proteger y verificar*. Su tercer bloqueo se sustituye por: demostrar el snapshot final y el orden de hooks, y clasificar las creaciones nativas como nativas. Los bloqueos de política y financiación no cambian. Exige 0.17.5.
- **S04-T03.** Se adelanta: el registro mínimo de sesiones gestionadas (agente y nonce consumido, a partir de `agent.create.after`) es criterio de entrada de la fase 3, porque G4 depende de él. La metadata por sí sola es forjable.
- **G4 (S04-T04).** El E2E mínimo añade: creación nativa conservada, lanzamiento con configuración verificada, nonce de un solo uso, bloqueo previo ante política o cuota vencidas y desactivación del plugin.
- **S04-T05 y S04-T07.** Sin cambios.

## Riesgos residuales

| ID | Riesgo | Estado |
|---|---|---|
| R1 | Brecha de identidad humana: el clic no es verificable. | Aceptada con aprobación del propietario. |
| R2 | El snapshot puede no reflejar `toolPolicy`, `mcpServers` ni `env`. | Verificar en la sonda. Sin evidencia, no cubrirlos. |
| R3 | Pérdida de funciones del compositor nativo y de New Workspace. | Mitigaciones y fases. |
| R4 | La experiencia deja de ser la nativa hasta que llegue E. | Decisión del propietario. |
| R5 | Teléfono: el item del compositor desaparece al cerrar el menú. | Brecha de aceptación para C. D no depende del item. |
| R6 | Un plugin o código malicioso con acceso al daemon (fuera del alcance de la confianza declarada). | Sin mitigación en este diseño. |

## Consecuencias

Se obtiene el primer camino automático sin ambigüedad de procedencia usando solo interfaces soportadas. Se paga con una superficie distinta. Nada se habilita hasta la fase 3 y la aprobación del propietario.
