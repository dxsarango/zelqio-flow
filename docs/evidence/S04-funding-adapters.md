# S04 — Verificación de financiación por proveedor

## Qué decide cada fuente

- **Declarada.** La clasificación que acompaña a una propuesta. Se conserva como dato consultivo, con su vigencia declarada.
- **Autorizada.** La clase que una política existente y vigente permite para el destino exacto. Solo un canal autenticado de política puede concederla, revocarla o ampliarla.
- **Verificada.** La que un adaptador puede acreditar para la ruta efectiva y el modelo exacto. Para una selección sin costos adicionales también debe acreditar que la ruta impide el sobreconsumo facturable o el fallback de pago.

`FundingAdapter` normaliza las observaciones a host, proyecto, proveedor, modelo y una identidad opaca de ruta. El adaptador deriva la identidad de la cuenta y endpoint efectivos o del contexto local o anónimo, según el proveedor. Usa las fuentes nativas disponibles y proyecta solo los atributos necesarios. El contrato carece de acceso a archivos de autenticación. Una declaración se mantiene separada de la autorización y de la observación. Un adaptador sin evidencia suficiente devuelve desconocido y el candidato queda excluido de la selección del producto.

## Observaciones por proveedor

| Proveedor | Señales soportadas | Prueba realizada y resultado |
|---|---|---|
| Claude Code | `claude auth status` distingue autenticación nativa, API y terceros. La documentación contempla precedencia de una API key y uso facturable al llegar al límite. Cruzar el método y proveedor de API efectivos, la identidad de la suscripción, el modelo exacto y el estado de créditos de uso en el contexto de lanzamiento. [CLI](https://code.claude.com/docs/en/cli-reference) · [Precedencia](https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code) · [Créditos de uso](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans) | **PASS** de lectura. CLI 2.1.331 devolvió `claude.ai`, `firstParty` y suscripción. Paseo enumeró IDs de modelo. **BLOCKED** para selección. La lectura del CLI y la fuente de cuota aún carecen de vínculo verificable con la configuración efectiva de un nuevo agente. |
| Codex | `account/read` con `refreshToken: false` distingue ChatGPT, API key y otros runtimes. `account/rateLimits/read` aporta ventanas. El proveedor y la URL pueden variar por configuración, incluido un gateway. Verificar la ruta efectiva con una proyección no sensible del mismo contexto, el modelo exacto y la restricción de créditos. [App Server oficial](https://learn.chatgpt.com/docs/app-server) · [Configuración efectiva](https://learn.chatgpt.com/docs/config-file/config-reference) | **PASS** de lectura. El App Server local 0.172.0 informó `chatgpt` y Plus. `model/list` coincidió en 10 de 10 IDs con Paseo. **BLOCKED** para selección. La cuenta observada, los modelos y el saldo visible no prueban el endpoint de la futura sesión ni un control efectivo de sobreconsumo. |
| OpenCode | Su catálogo y API de modelos resuelven integraciones y modelos exactos. Console puede servir un mismo nombre por una conexión con ID y endpoint propios. Verificar integración y conexión efectivas, variante, tarifa aplicable y ausencia de ruta facturable alternativa o recarga. [Modelos](https://opencode.ai/docs/models) · [API de modelos](https://opencode.ai/docs/console/api/models) · [Conexiones y endpoints](https://opencode.ai/docs/console/api/providers/) | **PASS** de lectura. `opencode models opencode --pure` 1.19.6 y Paseo coincidieron en los 11 IDs exactos. **BLOCKED** para selección. La coincidencia de catálogo y un sufijo Free no acreditan el costo de la ruta efectiva. |

Las lecturas reales no enviaron prompts ni solicitaron créditos. Paseo mostró uso adicional deshabilitado en la fuente de Claude y saldo cero en la fuente de Codex. Un saldo cero describe el estado observado y carece de garantía sobre su recarga futura. Omitimos la lectura completa de configuración del App Server y diagnósticos de entorno que podrían contener credenciales. La unión de esas observaciones con la ruta efectiva y el modelo sigue pendiente para los tres proveedores.

La revisión independiente corroboró los riesgos de precedencia de autenticación, endpoints configurables, alias y tarifas editables. El adaptador debe comprobar las opciones y rutas efectivas y rechazar los alias sin resolver. No debe consumir superficies de diagnóstico que devuelvan secretos.

El contrato simulado revalida la revisión de política y la identidad de ruta al volver de la lectura del proveedor. La evidencia debe tener una referencia, procedencia observada y una antigüedad dentro del límite del adaptador. Una observación válida devuelve alcance, vencimiento y referencia. El llamador acota la espera y señala cancelación al adaptador. La prueba de conformidad de cada proveedor debe demostrar que su implementación atiende la cancelación, acredita la ruta y preserva los controles de tratamiento de datos antes de conectar el contrato a un efecto.

## Verificaciones antes de habilitar un efecto

- Confirmar que la observación proviene del contexto exacto de lanzamiento. Un ID de modelo, una cuenta activa o una fuente de cuota compartida no bastan por separado.
- Renovar la observación ante cambios de cuenta, configuración, endpoint, política o catálogo. Comprobar alcance y vigencia de nuevo en el punto del efecto. Si el host no puede impedir o detectar una carrera de configuración fuera de la prueba, conservar el efecto deshabilitado.
- Conservar la financiación de la solicitud y la restricción vigente durante fallback. La ruta que genera una propuesta queda separada de la que autorizaría ejecutarla.
- Probar con fixtures la ausencia o revocación de política, el cambio de ruta, datos vencidos, consumo explícito fuera de alcance y sobreconsumo incierto. Para probar inferencia real, primero se debe verificar el destino y su límite efectivo de costos.
