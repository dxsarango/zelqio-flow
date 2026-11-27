# S04 — Compositor nativo y lanzador: evidencia de la propuesta de routing automático

Sustenta la [propuesta de ADR](../adr/S04-native-composer-routing.md). Alcance: tipos y referencia del SDK 0.17.5, modelos ejecutables de dos diseños (C: escribir en el borrador nativo; D: lanzador de Zelqio) y lectura de la documentación pública de la etiqueta `v0.17.5`. No se ejecutó ningún daemon, no se tocó la instalación habitual de Paseo y no se envió inferencia. `<sandbox>` designa el directorio fuera del repositorio con el SDK 0.17.5 y 0.17.4 instalados sin conexión.

## Resultados

La columna **Base** separa lo que prueban los tipos de lo que solo describe la documentación del host.

| ID | Comprobación | Base | Resultado |
|---|---|---|---|
| E1 | `PluginComposer` no tiene envío, bloqueo previo, identidad de borrador ni procedencia. Los pills exigen `agentId`. Los slash commands existen solo para `workspace` y `agent`. | Tipos | PASS (`contract-check.mjs`) |
| E2 | `agent.create.before` es `{ config, env?, metadata?, workspaceId }`: sin prompt ni procedencia. `agent.turn.before` es un evento. 0.17.4 carece de `workspaceId`. | Tipos | PASS |
| E3 | El cliente del compositor es idéntico entre 0.17.4 y 0.17.5. | Tipos | PASS (hashes iguales) |
| E4 | Un plugin puede crear agentes con `config` (`provider/model`, `modeId`, `thinkingOptionId`, `options`, `toolPolicy`, `mcpServers`), `prompt` opcional, `metadata`, `idempotencyKey` y `agentId`. El handle expone `send`, `options`, `runtimeInfo`, `metadata`, `availableModes` y `refresh`. `workspaces.create` admite un primer agente. | Tipos | PASS |
| E5 | Existen `addScreen`, `addWorkspacePanel` y `addCommandCenterItem` para un formulario propio, y el compositor nativo queda intacto. | Tipos | PASS |
| E6 | Un plugin que usa `usePaseo()` toma prestada la conexión autenticada de la app. Los plugins son «código de confianza sin sandbox» y no hay una concesión de permisos que solicitar. | Documentación | Documentado |
| E7 | La creación por SDK pasa por `agent.create.before`. | Documentación y [S04-T02](S04-T02-creation-authority.md) (0.17.4) | Reproducido en 0.17.4, no en 0.17.5 |
| E8 | `FirstAgentContextSchema.prompt` es opcional en `workspace.create.before`. | Tipos | PASS (tipo). **NOT RUN** (valor) |
| E9 | La metadata del borrador viaja a la creación y se limpia al enviar. El compositor se bloquea al crear en New Workspace. En teléfono el item solo está montado con el menú abierto y puede montarse dos veces. | Documentación | **NOT RUN** |
| E10 | El snapshot del agente (`provider`, `model`, `options`, `thinkingOptionId`, `currentModeId`) refleja la configuración final tras todos los hooks. | Tipos del snapshot | **NOT RUN**. `toolPolicy`, `mcpServers` y `env` no figuran en el snapshot: sin cubrir. |
| E11 | Orden entre hooks de plugins distintos y veto posterior a todos los hooks. | Documentación (orden por ID de plugin) | **NOT RUN** / BLOCKED sin solicitud a Paseo |
| E12 | Comportamiento real de New Agent y New Workspace con registros y transiciones de modelo en 0.17.5. | — | **NOT RUN** (sonda de otro agente) |
| E13 | Harness React con `PluginComposerProvider` y `useComposer`. | — | **NOT RUN**: no hay `react-dom` ni `react-test-renderer`; añadirlos sería una dependencia nueva. |
| E14 | Slash command en el compositor de un borrador y acción dentro del compositor leyendo prompt, modo y opciones. | — | **NOT RUN** |
| E15 | Procedencia explícito-vs-predeterminado en el servidor y actor humano verificable. | — | **BLOCKED** (requiere la solicitud a Paseo y [S04-T02](S04-T02-creation-authority.md)) |

## Modelos ejecutables (`simulate.mjs`)

28 de 28 escenarios se comportan como el diseño. Son **reglas codificadas desde la documentación**, no una medición de Paseo: sirven para detectar contradicciones.

**Opción C (escribir en el borrador).** G0 muestra el estado propuesto, con las escrituras deshabilitadas: no se escribe nada y el hook conserva la elección. Los escenarios S1 a R3 habilitan las escrituras solo para demostrar el diseño, y F1 a F4 reproducen la revisión independiente:

| Escenario | Resultado |
|---|---|
| S1 predeterminado observado y sin tocar | aplica y pasa (la instantánea no prueba que sea el predeterminado de Paseo) |
| S2, S3, S3b, S6, S10, S12 elección manual vista | se conserva |
| S4 el usuario elige el valor predeterminado | indistinguible del predeterminado |
| S5 cambia y vuelve sin item montado | parece gestionado |
| S7 cuota o política obsoletas | restaura la base guardada en el servidor |
| S8, S9 registro falsificado o nonce reutilizado | no se bendice |
| S11 reinicio | registro no verificable |
| S13, S14 creación por SDK y aplicación supervisada | se conserva |
| R3 edición entre la última comprobación y `setModel` | **se sobrescribe** |
| **F1** el usuario vuelve a elegir el modelo aplicado (sin transición) y la revalidación falla | **se reemplaza una elección explícita** |
| **F2** un nonce copiado se usa primero | el envío real queda sin verificar |
| **F3** `setModel` funciona y `setMetadata` falla | la escritura llega a Send sin registro |
| **F4** un hook posterior cambia el modelo | Zelqio no se entera |

Conclusión: la sustitución automática sobre el borrador nativo **no es segura** con las interfaces actuales y se mantiene deshabilitada.

**Opción D (lanzador).**

| Escenario | Resultado |
|---|---|
| D1 Automatic | el servidor crea, el hook consume el nonce, se verifica el agente inactivo y se envía el prompt |
| D2 un hook posterior cambia el modelo | se detiene antes del primer mensaje (0 prompts) |
| D3 política o cuota vencidas | se bloquea antes de crear (0 agentes) |
| D4 modelo elegido en el formulario | se crea exactamente como se eligió, sin enrutar |
| D5 creación nativa, con o sin registro falsificado | nativa, se conserva |
| D6 nonce reutilizado | no se bendice |
| D7 clic frente a código que llama al mismo punto | **indistinguibles** (brecha de identidad humana) |

El snapshot que usa D2 es el de un modelo de la plataforma. Que el snapshot real refleje la configuración final es E10.

## Reproducción

```powershell
node poc/s04-native-composer/contract-check.mjs <sandbox>/v0.17.5 <sandbox>/v0.17.4
node poc/s04-native-composer/simulate.mjs
```

Ninguno necesita dependencias, red ni daemon. `contract-check.mjs` lee los `.d.ts` y falla si cambia alguna premisa (26 de 26). La referencia pública se leyó de la etiqueta `v0.17.5` de `getpaseo/paseo`, carpeta `public-docs`.

## Limitaciones

- Los modelos no miden Paseo.
- La atestación del cliente es falsificable por cualquier plugin del mismo borrador. El lanzador no depende de ella.
- El clic en el formulario de Zelqio no tiene procedencia humana verificable. El ADR propone aceptarlo como capacidad de lanzamiento autorizada por separado y lo deja a decisión del propietario.
- Nada de esto habilita un efecto.
- Pendiente de la sonda 0.17.5: E8 a E12 y E14.
