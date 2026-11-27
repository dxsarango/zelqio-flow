# S04 — Políticas de financiación para la selección automática

> **Actualización del 27 de noviembre de 2026.** [R1](R1-orchestration-plugin-on-paseo.md) simplifica la arquitectura: la verificación exhaustiva que describe este documento pasa a ser opcional (modo Estricto) y deja de bloquear el producto. El contenido sigue como referencia.

**Estado: propuesto.** No está aprobado ni implementado. La política **Estricta** sigue siendo la única vigente y por defecto, con todas sus restricciones, hasta que el propietario valide y apruebe este ADR. Ningún efecto cambia con este documento. Complementa [S04 · Autoridad para seleccionar modelos](S04-routing-authority.md) y la [matriz de adaptadores](../evidence/S04-funding-adapters.md). Fuentes, fechas y resultados en la [evidencia](../evidence/S04-funding-policies.md).

## Contexto

`assessFunding` solo acepta `verified_no_additional_charges`: grant exacto vigente, observación `observed` y `additionalCharges: "blocked"`. Con Paseo 0.17.4 ningún adaptador puede producir `blocked` para Claude o Codex. Los proveedores documentan que, al agotar el límite del plan, el uso puede continuar con cargo si hay créditos o uso adicional activados, y que usar una API key factura por consumo. Ninguna señal local prueba que ese cambio no ocurrirá. La ruta de suscripción permanece bloqueada aunque el propietario la haya autorizado, y la selección automática del MVP (FR-03, FR-04) queda sin ruta habilitable. NFR-05 y FR-12 se mantienen: sin consumo no autorizado ni cambios silenciosos.

## Vocabulario de evidencia

| Término | Quién | Qué es | Autoridad |
|---|---|---|---|
| **Declarada** | Solicitante (RPC, borrador) | Clasificación propuesta | Ninguna; consultiva |
| **Observada** | Adaptador del daemon | Hecho leído de una fuente nativa para la ruta efectiva, con hora y referencia | Prueba solo el hecho, su origen y su antigüedad |
| **Atestada** | Propietario, mediante un canal con actor humano verificable (FR-12) | Condición que ninguna señal local puede comprobar | Solo dentro del alcance, texto y caducidad exactos que aceptó |

La atestación no sustituye a la observación ni prueba que el propietario configurara la facturación: es una declaración de responsabilidad registrada. Un agente, un archivo del repositorio o un RPC sin procedencia humana no pueden atestar.

## Opciones

- **A. Estricta (actual, por defecto).** Financiación técnicamente verificada: observación `observed` que bloquea cargos adicionales. No cambia.
- **B. Suscripción de confianza (`trusted_subscription`).** Cuenta, endpoint y modelo exactos autorizados expresamente por el propietario, que acepta con conocimiento los límites de la verificación (texto TS-1). El adaptador observa señales de riesgo y cualquiera que indique riesgo, falte o sea ambigua bloquea. **No es una garantía de ausencia de cargos y nunca se presenta como tal.**
- **C. Personalizada (`custom`).** Autorizaciones por cuenta (binding opaco), endpoint, modelo y proyecto. Cada entrada fija su nivel base (A o B) y puede acotarlo. No añade un nivel de garantía: estrecha el alcance y puede endurecer.
- **D. Sin cambios.** Deja bloqueados S04-T02, S04-T06, S04-T03 y G4 para suscripciones y reduce de hecho el MVP. Es el estado actual hasta la aprobación, no el estado final.

## Recomendación

A como predeterminada y techo inicial; B y C habilitables por el propietario por alcance exacto, en fases, con efectos deshabilitados hasta aprobación. Barreras comunes a las tres: nunca activar créditos, uso adicional, API keys ni consumo, y nunca cambiar cuenta o endpoint sin avisar.

**Aprobar este ADR enmienda, solo para B y para C con base B, el requisito de [S04-routing-authority](S04-routing-authority.md) «verificar que la ruta no pase automáticamente a consumo»**: para ese alcance se sustituye por señales de riesgo despejadas más la atestación TS-1, que declara desactivados los mecanismos de cargo. Para A el requisito sigue íntegro. La aprobación no reemplaza ninguno de los demás controles de ese ADR: procedencia de la autoridad, señales de cuota, identidad y financiación de la ruta, y preservación de la elección explícita y de las opciones efectivas del borrador. Todos siguen exigibles para cada efecto.

## Criterios

1. No introduce consumo no autorizado ni lo presenta como imposible.
2. La aceptación es informada, durable, exacta, verificable e invalidable.
3. Cualquier cambio de cuenta, endpoint, credencial, plan, modelo, proyecto, host o revisión invalida la autorización.
4. Cambio mínimo en `assessFunding` y `selection-authority`, con pruebas de fixtures.
5. Estricta no se debilita; la más restrictiva prevalece.
6. Lo no verificable queda enumerado y visible.

## Contrato de evidencia por política

| Elemento | Estricta | Suscripción de confianza | Personalizada |
|---|---|---|---|
| Clase autorizada | `free`, `local` o `subscription` | Solo `subscription` | Por entrada; `consumption` nunca |
| Atestación | Grant vigente | Grant más **registro de aceptación TS-1** emitido por el canal humano | Grant por entrada; TS-1 si el nivel base es B |
| Observada (obligatoria) | `observed` y `additionalCharges: "blocked"` | `observed`, con cuenta identificada por la misma fuente que las señales, y **todas** las señales `clear`, frescas y atribuibles | La de su nivel base |
| Declarada | Consultiva | Igual | Igual |
| Vínculos | host, proyecto, proveedor, modelo, `binding`, `policyRevision` | Igual. `binding` incorpora identidad opaca de cuenta, endpoint, método de autenticación y plan | Igual; modelo exacto, sin comodines |
| Caducidad (`validUntil`) | mínimo de grant, observación y `observedAt + maxAge` | además mínimo de `acceptance.expiresAt` y de la antigüedad de **cada** señal | Por entrada, nunca más que el techo |
| Revocación | Subir `policyRevision` | Subir `policyRevision` y marcar el registro como revocado (tombstone) | Igual, por entrada |
| Resultado | `verified_no_additional_charges` | `verified_trusted_signals` (`assurance: "trusted"`) | El del nivel efectivo |
| Etiqueta en la interfaz | «Financiación verificada: sin cargos adicionales» | «Suscripción autorizada por ti · **Puede haber cargos adicionales**» y banda permanente | Etiqueta del nivel efectivo por modelo; con base B, la misma de B |

### Señales de cargo (política B)

Cada señal es `clear`, `risk` o `unknown`. **La ausencia de un dato nunca es `clear`.** Solo `clear` en todas permite `verified_trusted_signals`; `risk` bloquea con `charge_signal_risk` y `unknown` con `charge_signal_unknown`. No se leen archivos de credenciales ni de configuración de proveedores (SECURITY).

| Señal | Observable por el adaptador | Fuente | Efecto |
|---|---|---|---|
| Método de autenticación | Sí | `claude auth status`; `account/read` (`refreshToken: false`) de Codex | Suscripción ⇒ `clear`; API key, gateway u otro ⇒ `risk`; ilegible ⇒ `unknown` |
| Identidad de cuenta | Solo si la misma fuente la aporta junto a plan y saldo | Informe de cuenta con alcance por cuenta | Dos cuentas del mismo plan se distinguen únicamente por esta identidad; sin ella ⇒ `unknown` |
| Plan | Sí | Etiqueta del mismo informe de cuenta | Cambio ⇒ `binding` cambia |
| Uso adicional (Claude) | Sí, texto de detalle, **frágil** | Detalle del informe de la fuente de Claude | `Disabled` exacto ⇒ `clear`; activo ⇒ `risk`; otro texto o ausente ⇒ `unknown` |
| Saldo de créditos (Codex) | Sí, balance con unidad | Balance del informe de la fuente de Codex | 0 con unidad reconocida ⇒ `clear`; > 0 ⇒ `risk`; ausente o unidad desconocida ⇒ `unknown` |
| Variables de entorno que cambian la facturación | Parcial: solo el entorno del daemon y el `env` que recibe el hook | Presencia por nombre (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `CODEX_API_KEY`, selección de proveedor de nube) | Presente ⇒ `risk`; nunca se registra el valor |
| Endpoint distinto del predeterminado | Parcial: variables conocidas (`ANTHROPIC_BASE_URL`) en esos mismos entornos | Mismos entornos | Presente ⇒ `risk` |
| Antigüedad y origen del informe | Sí | Hora de observación por informe | Futura, ausente o ≥ `maxAge` ⇒ `unknown` |
| Recarga automática, límites de gasto, configuración local de herramientas, helpers de credenciales, entorno solo del proceso hijo, política de organización | **No** | — | Solo atestable (TS-1, punto 2) |

**Procedencia y frescura de la proyección de uso.** En Paseo 0.17.4 los IDs de fuente pueden repetirse y el `fetchedAt` global mide intentos, no observación por cuenta. Por eso:

1. Las señales de cargo se leen del **informe de cuenta con hora de observación por informe**, no de la proyección SDK aplanada. Si solo existe la proyección, todas las señales son `unknown`.
2. Se rechaza evidencia ambigua (varias filas de la misma fuente sin identidad de cuenta distinguible), vencida o con hora futura.
3. Una fila solo cuenta para el proveedor al que su fuente está asociada: Claude no hereda el saldo de Codex ni al revés, aunque compartan harness. La fila debe tener unidad y etiqueta reconocidas para ese proveedor.
4. La normalización a `Signal` ocurre **en el daemon**. El RPC solo expone el vocabulario cerrado, con hora y referencia. No expone el texto libre de `details` ni URLs de endpoint, solo «predeterminado» o «distinto».

## Resolución de la política efectiva

La política **efectiva** la resuelve el daemon, nunca la trae el grant ni el llamador, **para todos los caminos** (A, B directo y C):

```ts
resolveEffectivePolicy(scope) -> { level: "blocked" | "strict" | "trusted_subscription"; digest: string }
// level = mínimo de: techo global (inicial: strict), habilitación de la fase, restricciones del
// repositorio o la organización, entradas deny de C, nivel del grant y registro de aceptación vigente
```

- `assessFunding` ejecuta la rama de B **solo** si `effective.level === "trusted_subscription"` **y** el grant lo pide. Un grant B bajo el techo `strict` termina en `policy_not_enabled` sin leer al proveedor. Sin `effective`, el nivel es `strict`.
- El `digest` forma parte de `FundingScope`: `currentScope()` lo vuelve a resolver tras la lectura del proveedor, y `selectionInvalidation` lo compara en el punto de aplicación. Una revocación, un cambio de techo o una entrada `deny` posteriores invalidan las propuestas ya emitidas.
- Una revisión revocada deja un **tombstone** (`acceptanceId`, `policyRevision`). Reactivar B tras desactivarlo exige una aceptación nueva; los registros antiguos no reaparecen.
- La habilitación de una fase no sustituye la procedencia, la cuota ni la preservación del borrador exigidas por S04-routing-authority.

## Aceptación informada (política B)

Texto **TS-1**, versión 1. Se renderiza con el alcance y la caducidad concretos y se registra el hash SHA-256 del texto renderizado.

> **Suscripción de confianza: lo que aceptas**
>
> Autorizo a Zelqio Flow a seleccionar automáticamente el modelo **{modelo}** de **{proveedor}** con la suscripción **{plan}** (cuenta **{referencia opaca}**), endpoint **{endpoint}**, para el proyecto **{proyecto}** en este equipo, hasta **{fecha}**.
>
> 1. **Puede haber cargos adicionales.** Zelqio Flow no garantiza lo contrario. Solo comprueba señales visibles y bloquea la selección si alguna indica riesgo, falta o no es atribuible a esta cuenta.
> 2. **Declaro que, en esta cuenta, el uso adicional, los créditos de uso, la recarga automática, el pago por uso y cualquier clave de API o ruta de consumo están desactivados** para este alcance. Zelqio Flow no los activa, no los configura y no autoriza ningún gasto.
> 3. Las señales pueden estar desactualizadas, incompletas o corresponder a otra cuenta. Un saldo de cero puede preceder a una recarga.
> 4. El proveedor controla la facturación y puede cambiar sus reglas o sus valores iniciales sin que Zelqio Flow lo sepa a tiempo.
> 5. Una sesión ya iniciada no se puede frenar. Si el límite se agota durante una tarea y el proveedor continúa con cargo, Zelqio Flow no puede impedirlo ni detectarlo antes del hecho.
> 6. Esta autorización no cubre otra cuenta, plan, endpoint, modelo, proyecto ni equipo. Zelqio Flow bloquea la selección cuando detecta un cambio en ellos, pero no puede detectar todos. Puedo revocarla cuando quiera; caduca en la fecha indicada. Revisaré mi factura del proveedor.

Flujo:

1. El propietario abre la política desde la configuración (acción humana, FR-12), nunca desde un agente o archivo.
2. La interfaz muestra las señales observadas, con hora. Si alguna es `risk` o `unknown`, **no ofrece aceptar** y dice cuál. No existe opción de ignorar una señal.
3. Muestra TS-1 completo y exige confirmar cada punto y el alcance.
4. El canal humano **emite un registro de aceptación** con `acceptanceId`, `textId`, `textSha256`, `scopeSha256`, `acceptedAt`, `expiresAt`, referencia opaca del actor verificado y las señales vistas. Se guarda en el almacén del daemon, sin secretos ni datos personales.
5. Revisable: cambiar alcance, caducidad o texto crea una aceptación nueva. Revocar sube `policyRevision` y deja tombstone.
6. Una selección rutinaria dentro de una aceptación vigente no pide aprobación nueva. Crear, ampliar o renovar sí.

**Verificación en el daemon** (no confiar en lo que traiga el llamador): buscar el registro por `acceptanceId` en el almacén; comprobar que no está revocado ni caducado; **recomputar** el hash del texto renderizado con el alcance y la caducidad actuales y el hash del alcance canónico, e igualarlos a los registrados. «Hash conocido» no basta.

**Diferencias respecto a Estricta.** En la interfaz: etiqueta «Puede haber cargos adicionales», banda permanente y las señales con su hora junto a cada decisión. En el enrutamiento: ver desempate. En el registro: cada decisión conserva política, `acceptanceId` y hash.

**Pasa a bloqueado de inmediato:** uso adicional activado; saldo > 0; autenticación distinta de suscripción; variable de API key o de nube presente; endpoint distinto; cuenta, plan o credencial distintos (`binding`); evidencia ambigua, vencida, futura o de otra fuente; informe ilegible; revisión cambiada; aceptación ausente, caducada, revocada o con hash que no coincide; modelo fuera del alcance.

## Personalizada y composición

Cada entrada: `{ host, proyecto, proveedor, bindingRef, endpointRef, modelo exacto, nivel base, caducidad, aceptación?, deny? }`.

- **La más restrictiva prevalece:** `bloqueado < estricta < suscripción de confianza`; el nivel efectivo es el mínimo entre techo global, entrada y restricciones del repositorio.
- **La exclusión prevalece sobre el permiso.**
- Sin comodines de modelo ni de cuenta; alias sin resolver rechazados.
- Sin entrada para el alcance exacto: `policy_missing`.
- Bajar el techo a Estricta invalida de inmediato las entradas de nivel B.

## Delta mínimo del contrato (propuesta, sin implementar)

```ts
type FundingPolicy = { kind: "strict" } | { kind: "trusted_subscription"; acceptanceId: string };
interface AcceptanceRecord {            // emitido y guardado por el canal humano, no aportado por el llamador
  acceptanceId: string; textId: "TS-1"; textSha256: string; scopeSha256: string;
  acceptedAt: number; expiresAt: number; actorRef: string; revoked: boolean;
}
interface FundingGrant { /* actual */ policy?: FundingPolicy }          // ausente = strict
interface FundingScope { /* actual */ effectiveDigest?: string }        // lo resuelve el daemon
type Signal = "clear" | "risk" | "unknown";
interface ChargeSignals { authMode: Signal; accountBound: Signal; overage: Signal; credits: Signal;
  apiKeyEnv: Signal; endpoint: Signal; observedAt: number }
interface FundingObservation { /* actual */ chargeSignals?: ChargeSignals }
// Razones nuevas: verified_trusted_signals, policy_not_enabled, policy_unresolved,
// acceptance_missing, acceptance_invalid, acceptance_expired, acceptance_revoked,
// charge_signal_risk, charge_signal_unknown
```

Cambios de comportamiento:

1. `assessFunding` resuelve el nivel efectivo (arriba) antes de cualquier lectura. Sin `policy` o con `strict`: la ruta actual, sin cambios.
2. Rama B: `grant.funding === "subscription"`; registro de aceptación localizado en el almacén y verificado (hashes recomputados, no revocado); observación `observed`; `chargeSignals` todas `clear`. No usa ni exige `blocked`. **`validUntil` = mínimo de grant, `acceptance.expiresAt`, observación, `observedAt + maxAge` y `chargeSignals.observedAt + maxAge`.**
3. `consumption` sigue excluido antes de cualquier lectura.
4. `shared/selection-authority.ts`: el esquema estricto de `selectionSnapshot` debe poder representar `grant.policy`, la referencia de aceptación, el `effectiveDigest` y `retry.originalPolicy`. `SelectionProposal` añade `assurance` y `acceptanceId`.
5. `selection-authority.ts`: en un reintento, la política efectiva debe ser igual o más estricta que la original (`retry_policy_weakened`); la financiación original se mantiene. **`selectionInvalidation` en el punto de aplicación vuelve a resolver la política y vuelve a observar al proveedor** (hoy solo compara instantáneas y tiempo): ver «Binding y punto de efecto».
6. `server/usage.ts` y `shared/usage.ts`: leer del informe de cuenta con hora por informe, ampliar con plan, saldos y detalles normalizados en el daemon según las reglas de procedencia, y exponer por RPC solo el vocabulario cerrado.
7. `router.ts`: ver desempate.

**Desempate (regla única).** Con puntuación igual, una candidata Estricta precede a una de confianza. Lo comprueba `route()` en `router.ts`, como un componente adicional de la puntuación, antes de `lastSelectedAt`. El hecho `assurance` falta ⇒ se trata como «confianza» (falla cerrado). `selection-authority` evalúa una sola candidata y no ordena.

## Binding y punto de efecto

Un método de autenticación y una etiqueta de plan **no identifican la cuenta**: dos cuentas del mismo plan se ven igual. Un helper de credenciales, un endpoint configurado o una variable presente solo en el proceso hijo pueden cambiar la ruta **después** de la lectura. Por tanto:

- **El efecto de B permanece deshabilitado** hasta que la evidencia y la cuota puedan vincularse a la cuenta, plan, endpoint, credencial y modelo exactos del contexto de lanzamiento, desde la misma fuente de observación.
- El punto de efecto **fija o revalida** ese contexto: el entorno que recibirá la sesión se fija por el daemon y se vuelve a observar inmediatamente antes de aplicar. Si el plugin no puede fijar el entorno del hijo, B no se habilita.
- Casos de prueba obligatorios: cambio **entre lectura y aplicación**; caducidad de la credencial con **fallback a otra credencial guardada** (Claude Code documenta que, si el inicio de sesión caduca y hay otra credencial guardada, las peticiones pueden usarla y facturarse en su organización); cuenta distinta con el mismo plan; saldo de otra fuente.

## Modos de fallo

| Fallo | Detección | Resultado |
|---|---|---|
| Cambio de cuenta | identidad en `binding` y re-observación | `scope_changed`; nueva aceptación |
| Credencial caducada con fallback | señales y re-observación en el punto de efecto | Bloqueo; no es detectable si ocurre tras iniciar la sesión |
| Endpoint o API key aparecen | señales `endpoint`/`apiKeyEnv` | Bloqueo |
| Plan cambiado | `binding` | `scope_changed` |
| Uso adicional o créditos activados | `overage`/`credits` | Bloqueo en la siguiente evaluación |
| Informe viejo, futuro, ambiguo o ilegible | reglas de procedencia | `unknown`, bloqueo |
| Agotamiento a mitad de tarea | cuota `exhausted`/`reset` sin confirmar | Se excluye la ruta; el reintento conserva política y financiación originales, nunca pasa a consumo ni a una política más débil |
| Cambio entre lectura y aplicación | re-resolución y re-observación | Bloqueo |
| Cambio fuera del daemon durante una sesión | **No detectable** | Residual declarado (TS-1, punto 5) |

## Lo que sigue sin poder verificarse

- Recarga automática y límites de gasto del proveedor.
- Configuración local de las herramientas, helpers de credenciales y entorno solo del proceso hijo, salvo que el daemon lo fije.
- Qué cuenta y endpoint usará una sesión lanzada por otra vía.
- Transición a cargo después de iniciar la sesión.
- Estabilidad del texto de detalle y de las unidades entre versiones de Paseo; falla cerrado.
- Cambios de política, precios o valores iniciales del proveedor.
- **OpenCode Go queda fuera de B** mientras no exista una señal efectiva del interruptor «Extra Usage». Go Teams empieza con «Extra Usage» activado. Los medidores y reinicios están en `/inference/go/v1/usage`, no en la lista de modelos. Los modelos gratuitos de OpenCode son por tiempo limitado y con tratamiento de datos propio.
- La garantía de ausencia de cargos: ninguna política la ofrece salvo Estricta con evidencia que hoy ningún adaptador puede producir.

## Riesgos residuales

| Riesgo | Mitigación |
|---|---|
| Aceptación sin leer | Confirmación punto por punto, caducidad corta, banda permanente |
| Cargo real tras señales limpias | Declarado en TS-1; sin promesa de garantía; falla cerrado ante duda |
| Fragilidad del texto de detalle | Lista cerrada por versión; `unknown` por defecto |
| Aceptación sin actor verificable | El canal no se habilita hasta cumplir FR-12 |
| Extender B a otros proveedores | Cada adaptador exige su prueba de conformidad antes de entrar |
| Que la fase habilitada sustituya otros controles | Declarado: no sustituye procedencia, cuota ni preservación del borrador |

## Despliegue por fases

Estricta permanece predeterminada y los efectos deshabilitados hasta la aprobación expresa de cada fase.

1. **F0.** Este ADR y su evidencia; aprobación del propietario o cambios.
2. **F1. Contrato y fixtures** sin efectos: resolución de política, rama B, esquema de selección, aceptación, proyección de uso con procedencia, pruebas del delta. Techo global fijo en Estricta.
3. **F2. Adaptadores de solo lectura** de Claude y Codex que producen `chargeSignals`, con pruebas reales autorizadas por el propietario sobre cuentas propias y registro agregado sin datos personales.
4. **F3. Canal de aceptación** con actor humano verificable y almacén duradero (FR-12, S04-T02).
5. **F4. Primera activación** de B, limitada al proveedor nativo del borrador, **solo si** se demuestra la vinculación a cuenta, plan, endpoint, credencial y modelo y el entorno fijado o revalidado en el punto de efecto; con validación del propietario.
6. **F5. Personalizada**, tras F4 estable.

**Qué desbloquea (tras aprobación y F1–F4).** S04-T02: el bloqueo «exact-model billing and usable quota, including no paid fallback» se sustituye, solo para B, por «señales despejadas más aceptación vigente» (la reformulación la hace el orquestador); la política permanente con procedencia confiable se cubre con F3; la preservación de la elección explícita en los flujos nativos **no se desbloquea**. S04-T06: se desbloquea el requisito de ruta de financiación; permanece el de preservar elecciones y opciones del borrador. S04-T03 y G4 (S04-T04) solo en cascada. Este ADR no modifica ninguna tarea ni alcance del MVP.

## Decisiones pendientes del propietario

1. Aprobar el principio y la enmienda acotada a B y C con base B del requisito de no fallback a consumo.
2. Aprobar o ajustar TS-1 y la caducidad máxima propuesta de 30 días.
3. Confirmar el alcance de F4: un proveedor, el nativo.
4. Mantener OpenCode Go fuera de B hasta que exista la señal.
