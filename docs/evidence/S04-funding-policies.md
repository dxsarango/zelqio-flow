# S04 — Evidencia para las políticas de financiación

Respalda el [ADR propuesto](../adr/S04-funding-policies.md). Investigación de solo lectura el 2026-11-26, revisada tras una revisión independiente. No se ejecutó código de producto ni se envió ningún prompt. No se leyeron archivos de autenticación ni configuración de proveedores, ni el home habitual de Paseo.

## Fuentes oficiales consultadas

Texto de cada página descargado y filtrado por palabras clave; se registran solo los hechos leídos, con su alcance exacto.

| Fuente | Hecho verificado |
|---|---|
| [Créditos de uso de planes de pago de Claude](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans) | Pro, Max y Ultra **pueden activar** créditos de uso. Con ellos activados, al agotar un límite las peticiones pasan a precios de API y continúan, con cargo aparte. Hay límite mensual de gasto configurable (o ilimitado) y recarga automática solo en la web. Se pueden desactivar en cualquier momento; entonces solo rige el uso incluido. Aplican a Claude y Claude Code. |
| [API key en Claude Code (Centro de ayuda)](https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code) | Una `ANTHROPIC_API_KEY` en el entorno se prioriza sobre la suscripción y se factura por API. `/status` muestra el método activo y hay aviso de conflicto al iniciar sesión. |
| [Autenticación de Claude Code](https://code.claude.com/docs/en/authentication) | Con varias credenciales presentes, Claude Code elige por un orden: credenciales de proveedor de nube, token de portador, API key y otras por encima de la suscripción, que es el valor por defecto. **En modo interactivo se pide aprobar o rechazar la API key una vez** (interruptor «Use custom API key»); **en modo no interactivo (`-p`) la clave se usa siempre si está presente**. Una sesión de gateway tiene prioridad. Si el inicio de sesión caduca y no se puede renovar, las peticiones **fallan o usan otra credencial guardada, facturada a su organización**. `claude auth status` informa el estado. |
| [Referencia del CLI de Claude Code](https://code.claude.com/docs/en/cli-reference) | `claude auth status` devuelve JSON o texto; el código de salida indica si hay sesión. |
| [Costes de Claude Code](https://code.claude.com/docs/en/costs) | Los créditos de uso se activan o desactivan en la cuenta, con saldo, gasto del mes y límite visibles. |
| [Variables de entorno de Claude Code](https://code.claude.com/docs/en/env-vars) | Existen `ANTHROPIC_BASE_URL` y `CLAUDE_CODE_OAUTH_TOKEN` entre las variables que cambian la ruta o la credencial. |
| [Créditos en ChatGPT (planes personales)](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-freegopluspro) | Los créditos son un complemento de pago por uso: el uso incluido se gasta primero y después el saldo. Una instrucción guardada tipo «pregunta antes de usar créditos» **no añade un paso de aprobación de facturación**: si se sigue usando Codex tras agotar la asignación, los créditos disponibles pueden usarse automáticamente. La recarga automática compra créditos al bajar de un mínimo. El uso compartido de la suscripción con herramientas asociadas está desactivado por defecto. |
| [Codex con el plan de ChatGPT](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) | Al acercarse o llegar al límite, Plus y Pro elegibles pueden añadir créditos, usar un reinicio o esperar. `/status` en el CLI muestra límites y saldo. |
| [Precios de Codex](https://developers.openai.com/codex/pricing) | Los créditos permiten seguir tras el límite incluido en planes elegibles. Ciertas ampliaciones pagadas con créditos cuestan un múltiplo de la tarifa estándar. |
| [Autenticación de Codex](https://developers.openai.com/codex/auth) | **Cuando se inicia sesión con una API key**, Codex usa precios de API estándar facturados en la cuenta de plataforma, en lugar de los créditos del plan. El inicio de sesión (ChatGPT o API key) se guarda en caché local y lo comparten CLI y extensión. **No** documenta que una variable de entorno genérica desplace una sesión de ChatGPT. |
| [App Server de Codex](https://learn.chatgpt.com/docs/app-server) | Existen `account/rateLimits/read` y sus actualizaciones. `account/sendAddCreditsNudgeEmail` pide a ChatGPT que **envíe un correo** a un propietario del espacio de trabajo cuando se agotaron los créditos o se alcanzó un límite; **no es un evento automático de créditos agotados** ni una aprobación. |
| [Configuración de Codex](https://learn.chatgpt.com/docs/config-file/config-reference) | Cada proveedor de modelos configurado en `model_providers.<id>` puede definir `base_url`, `env_key` y un comando de autenticación propios. Aplica a proveedores personalizados, por lo que el endpoint y la credencial efectivos pueden depender de la configuración. |
| [OpenCode Zen](https://opencode.ai/docs/zen) | Console es de pago por petición con créditos prepagados. Los modelos gratuitos son «por tiempo limitado», con tratamiento de datos variable por modelo y restricciones regionales; los de nivel gratuito requieren el cliente OpenCode. La lista de modelos está en `/inference/v1/models`. |
| [OpenCode Go](https://opencode.ai/docs/go) | Suscripción con límites mensuales. «Extra Usage» hace que Go recurra al saldo de pago por uso en lugar de bloquear. **Go Teams empieza con «Extra Usage» activado**, y se puede desactivar en la página de Go. Los medidores y reinicios se consultan en `/inference/go/v1/usage`; no están en la lista de modelos. |
| [Proveedores de OpenCode](https://opencode.ai/docs/providers) | Credenciales por variables de entorno ordenadas y `OPENCODE_DISABLE_FREE_MODELS` para desactivar los modelos gratuitos. |

Las fuentes de la [matriz de adaptadores](S04-funding-adapters.md) (CLI de Claude, Precedencia, App Server de Codex, Modelos de OpenCode) se tomaron de ella cuando se indica.

## Resultados

| Comprobación | Resultado | Cómo |
|---|---|---|
| Documentación oficial de uso adicional, créditos y fallback de pago de los tres proveedores | PASS | Lectura de las páginas anteriores |
| Claude: la suscripción por sí sola impide el cargo al agotar el límite | **FAIL** como garantía | Depende del interruptor de créditos de la cuenta, documentado como activable |
| Codex: la suscripción por sí sola impide el cargo al agotar el límite | **FAIL** como garantía | Con saldo, el uso puede continuar automáticamente; con recarga automática se pueden comprar créditos |
| Una API key factura por consumo cuando se usa como método | PASS (hecho documentado) | Claude y Codex lo documentan. La prioridad sobre la suscripción está documentada para Claude; para Codex solo la facturación del método de inicio de sesión |
| El contrato actual **rechaza** una ruta de suscripción sin `additionalCharges: "blocked"` | PASS (análisis estático) | `assessFunding` exige `blocked`; ningún adaptador puede hoy producirlo para Claude o Codex |
| La proyección de uso del plugin conserva las señales de cargo | **FAIL** | `server/usage.ts` valida solo `windows` y descarta `planLabel`, `balances` y `details` |
| La proyección SDK prueba procedencia y frescura por cuenta | **FAIL** | Según [S00-T03](S00-T03-catalog-usage.md), el ID de fuente puede repetirse y el `fetchedAt` global mide el intento más antiguo; el informe de cuenta del CLI sí incluye hora por informe |
| Señal «Extra usage: Disabled» y saldo de créditos de Codex como señales de adaptador | NOT RUN | Hechos tomados de [S04-funding-adapters](S04-funding-adapters.md) y del encargo; no se repitió la lectura |
| `paseo usage ls --json` de solo lectura | NOT RUN | El CLI no está en el PATH del worker; no se buscó la instalación para no tocar el home habitual |
| Vincular evidencia y cuota a cuenta, plan, endpoint, credencial y modelo del contexto de lanzamiento | NOT RUN | Diseño en el ADR; sin implementar ni probar |
| Fijar o revalidar el entorno del proceso hijo en el punto de efecto | NOT RUN | No se verificó que el hook permita fijar el entorno que recibe la sesión |
| Estabilidad del texto de detalle y de las unidades entre versiones de Paseo | NOT RUN | Solo se conocen 0.17.4 y 0.17.5 por el encargo |
| Recarga automática de Codex y configuración local de Claude como señales | BLOCKED | No hay señal pública; obtenerla exigiría leer configuración o credenciales (SECURITY) |
| Canal de aceptación con actor humano verificable | BLOCKED | S04-T02 documenta la ausencia de actor verificable en la superficie de creación |
| `npm run check` | PASS | Typecheck, lint y 383 pruebas en 33 archivos, ejecutados tras esta revisión. Solo se modificaron documentos |

## Hechos agregados no personales

- Según [S04-funding-adapters](S04-funding-adapters.md), una lectura registrada mostró «Extra usage: Disabled» en la fuente de Claude y saldo de créditos en cero en la de Codex. Describen un instante, no una garantía futura.
- OpenCode publica precios cero para ciertos modelos gratuitos, con acceso restringido al cliente y a regiones, y por tiempo limitado.

## Conclusión

Ningún proveedor documenta un interruptor externo que **garantice** que no habrá cargos al agotar el límite. La documentación oficial indica que el cargo continuo depende de configuraciones de la cuenta (créditos de uso, saldo y recarga, uso adicional, una API key en uso) que el propietario controla, y que algunos planes pueden iniciar con ellas activadas (Go Teams). Esta evidencia **no demuestra** que el propietario las haya dejado desactivadas, ni que aceptar TS-1 configure la facturación: TS-1 es una declaración registrada, no una verificación. Por eso la política de Suscripción de confianza exige señales de riesgo despejadas y atribuibles a la cuenta, más la responsabilidad explícita del propietario sobre lo no observable, y se muestra siempre como «Puede haber cargos adicionales». Mientras no se pruebe la vinculación al contexto de lanzamiento (cuenta, plan, endpoint, credencial y modelo), el efecto permanece deshabilitado.
