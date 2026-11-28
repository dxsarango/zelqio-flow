# S11-T08 — Zelqio Flow en el daemon habitual con proveedores reales

Fecha: 27 y 28 de noviembre de 2026 (hora UTC). Estado: **en curso**. Las pruebas automáticas con proveedores reales pasaron; falta la validación visual en iOS por el propietario.

## Instalación (modo desarrollo)

- **Versión efectiva.** El daemon habitual informa `daemonVersion 0.17.4` (aunque la aplicación de escritorio pueda estar en otra). El plugin declara `>=0.17.4 <0.18.0`. Antes de instalar se ejecutaron en aislamiento, sobre 0.17.4, los escenarios S1, S2, S5, D1, D2, D3 y D5: todos PASS. La batería completa ya había pasado en 0.17.5 y 0.17.6.
- **Estado previo.** Se guardó la lista de plugins (diez, con su estado) y los datos del daemon (PID, inicio, versión). Tras instalar, los otros plugins quedaron idénticos y el daemon conservó PID e inicio: no se reinició ni se detuvo.
- **Mecanismo.** `paseo plugin install <directorio>` (instalación desde directorio de confianza), con el plugin en un checkout dedicado y fijado a un commit (`<live>`), separado del checkout de desarrollo. Se actualiza con `git checkout --detach <commit>` en ese directorio y `paseo plugin reload zelqio-flow`, que recarga solo el plugin.
- **Estado del plugin.** Se guarda en el directorio local `~/.zelqio-flow` (o el de `ZELQIO_FLOW_HOME`). No sale de la máquina.

## Desactivación y rollback

| Acción | Comando | Efecto |
|---|---|---|
| Desactivar sin perder datos | `paseo plugin disable zelqio-flow` | Deja de actuar. Los agentes de Paseo y el estado local se conservan. |
| Reactivar | `paseo plugin enable zelqio-flow` | Retoma las ejecuciones guardadas. |
| Recargar tras actualizar | `paseo plugin reload zelqio-flow` | Solo el plugin; el daemon no se reinicia. |
| Retirar | `paseo plugin remove zelqio-flow` | Quita la configuración del plugin. El estado local queda en `~/.zelqio-flow` hasta borrarlo desde los ajustes o a mano. |

Ningún comando reinicia el daemon ni toca la conectividad, el relay o el cortafuegos.

## Configuración usada

Claude y Codex principales, OpenCode auxiliar, Grok sin uso, estrategia Balanced, modo Smart Review, flujo Git local, publicación remota denegada, sin consumo de pago y sin la prevención de suspensión. Modelos autorizados: Claude Sonnet 5.5 y Haiku 5.5 (en ese orden), Codex gpt-6.2-sol y OpenCode deepseek-v4.1-flash-free y hy4-flash-free. No se autorizó Opus.

## Pruebas reales

| Prueba | Resultado | Observación |
|---|---|---|
| T1 · Selección, creación y esfuerzo | PASS | Eligió Claude Sonnet 5.5 (autorizado y preferido), esfuerzo `low` por la complejidad baja, creó el agente nativo y entregó «zelqio ok» en 24 s, con la metadata de la ejecución. |
| T2 · Delegación multiagente | **Pendiente de aprobación del propietario** | El coordinador pidió permiso para `zelqio_delegate`. Paseo exige esa aprobación en el modo por defecto y la ejecución se señala correctamente («requiere tu atención»). Por política, un agente no aprueba permisos por programa. |
| T3 · Automatic al crear | PASS | Con el marcador y una petición explícita a Codex, pasó por el enrutado, quedó registrado el motivo y la sesión se adoptó en una ejecución entregada. Con ambos proveedores bajo presión de cuota se mantuvo Codex por continuidad. |
| T4 · Sesión normal no gestionada | PASS | Una sesión sin marcador en OpenCode conservó su proveedor y modelo, sin metadata de Zelqio y sin adoptarse. |
| T5 · Persistencia ante interrupción | PASS | Recargar el plugin con una ejecución en curso no la perdió: mismo agente, un solo intento, entregada. |
| T6 · Consulta de cuotas | PASS | `usage.list` devolvió las ventanas reales de Claude, Codex y Grok. |

## Problemas encontrados

1. **Modelos autorizados.** El router trataba todos los modelos de un proveedor como autorizados (19 en Claude) y el modelo por defecto de Claude es Opus. Corregido: lista de modelos autorizados por proveedor con orden de preferencia.
2. **Primer mensaje de las sesiones adoptadas.** No estaba disponible en el momento de adoptar. Corregido: se captura en cuanto existe.
3. **Fechas en motores móviles.** `Intl.DateTimeFormat` con `dateStyle` no está garantizado. Corregido con una alternativa progresiva.
4. **Permisos de herramientas.** Cada herramienta `zelqio_*` pide aprobación en el modo por defecto. Es el comportamiento seguro de Paseo; la ejecución lo muestra.
5. **Descripción del manifiesto** obsoleta. Corregida.

## Pendiente

- Validación visual en iOS por el propietario (dónde abrir, controles, solicitud y comportamiento esperado se le indican por separado).
- La ubicación del control Automatic en el compositor del teléfono no se pudo comprobar desde aquí: en pantallas compactas puede estar en el menú de opciones.
- Agotamiento natural de cuota con una ejecución de Zelqio: no se ha dado todavía; se aprovechará cuando ocurra.
