# S04 — Autoridad para seleccionar modelos

La recomendación determinista se puede desarrollar con Paseo 0.17.4. Las etapas que modifican un borrador o una solicitud requieren las verificaciones indicadas abajo. Se mantienen los requisitos de creación, permisos y registro de sesiones de G4.

## Autoridad por operación

| Operación | Autoridad y límites |
|---|---|
| Recomendar proveedor y modelo | Lecturas del catálogo y preferencias del host más declaraciones por par exacto. Devuelve información consultiva sin mutaciones ni aprobación humana por decisión. |
| Seleccionar un modelo previamente autorizado | Una política vigente puede cubrir selecciones repetidas dentro del alcance aprobado. Comprobar la revisión de la política, su procedencia y el destino efectivo antes del cambio. Conservar las elecciones explícitas, los permisos y las opciones efectivas. |
| Iniciar una sesión | Acción nativa de Paseo o capacidad de lanzamiento futura, autorizada por separado y verificada para la ejecución y el destino concretos. Una recomendación o un cambio en el borrador carece de autoridad de lanzamiento. |
| Delegar tareas | Coordinador autorizado, identidad registrada del worker, tarea elegible, lease vigente, permisos del rol y límites de recursos. |
| Ejecutar operaciones sensibles | Comprobar identidad, acción, proyecto y destino en el punto del efecto. Mantener la política de permisos, protección del repositorio y controles nativos de Paseo. |
| Aprobar cambios | Aplicar Smart Review en las condiciones aprobadas. Si requiere al propietario, conservar una decisión de origen verificable ligada al alcance, revisión de política y SHA exacto. |
| Autorizar costos adicionales | Permiso explícito independiente y verificable que cubra la operación y el modelo exacto. La recomendación actual excluye el consumo. Cualquier uso futuro seguirá sujeto al opt-in y al permiso de gasto. |

`Automatic` registra la intención del borrador. Otros clientes pueden reproducir el marcador. Su presencia carece de autoridad propia. Dentro de una política permanente que ya cubra la selección, el acto rutinario de routing no necesita capturar una aprobación humana nueva. Crear, ampliar o renovar ese permiso requiere una fuente de autoridad verificable.

## Evidencia de financiación

| Fuente | Uso |
|---|---|
| Catálogo y cuotas del SDK de Paseo | Verificar que exista el destino exacto y consultar informes de cuota donde haya una relación comprobable. Paseo 0.17.4 carece de una acreditación uniforme de la financiación efectiva por modelo. [SDK de Paseo](https://paseo.sh/docs/sdk/reference#client-providers) |
| Datos oficiales de una ruta de proveedor | Usar las garantías documentadas del modelo, cuenta o plan y endpoint, ligadas a la configuración efectiva. Por ejemplo, OpenCode expone precios por modelo y permite configurar proveedores. También documenta precios cero con cuotas de una suscripción. [Proveedores de OpenCode](https://opencode.ai/docs/providers) · [Modelos de OpenCode](https://opencode.ai/docs/models) |
| OpenCode Zen y Console | Zen publica IDs, endpoints y precios por modelo. Console documenta que ciertas rutas gratuitas solo funcionan desde el cliente OpenCode. Sirven para contrastar una ruta concreta y detectar restricciones de acceso. La correspondencia con el perfil efectivo de Paseo requiere evidencia adicional. [Zen](https://opencode.ai/docs/zen) · [API de inferencia](https://opencode.ai/docs/console/api/inference) |
| Catálogo revisado por el propietario | Registrar un alcance exacto y la procedencia de la autorización. La clasificación declarada ayuda a recomendar. Para un efecto, la entrada debe acompañarse de evidencia del destino y de sus condiciones vigentes de facturación y tratamiento de datos. |
| Precios públicos, etiquetas y sufijos | Sirven para investigar candidatos. Estos datos carecen de relación verificable con la cuenta, la ruta efectiva o el comportamiento al agotar la cuota. [Models.dev](https://models.dev/) |

Para efectos, una entrada autorizada debe vincular proyecto canónico, host o daemon, identidad estable del perfil o ruta de facturación sin secretos, proveedor, modelo, financiación, acción, revisión, caducidad y evidencia. Invalidar la entrada al cambiar cualquiera de esos vínculos. Verificar que la ruta no pase automáticamente a consumo, aplicar las restricciones de tratamiento de datos y excluir los destinos ambiguos y la financiación desconocida. La preferencia de proveedor establece la clase permitida. El modelo aporta su propia evidencia, que debe satisfacerla.

Mantener la financiación original y la restricción vigente en los reintentos. Reevaluar el destino y la vigencia antes de un efecto, incluso cuando el journal tenga una propuesta registrada. El agotamiento, una suspensión pendiente de confirmar o la falta de una alternativa elegible bloquean el reintento automático. La recuperación de cuota no concede permisos ni habilita créditos.

## Entrega progresiva

1. **Recomendación determinista.** `zelqio.routing.preview` evalúa declaraciones temporales del solicitante para pares exactos contra el catálogo, los roles incorporados y las preferencias actuales. Expone financiación declarada y cuota sin vincular, incluso junto al candidato individual. Una recomendación puede mostrar un candidato cuya cuota real esté agotada. Filtra los modelos sin declaración vigente y todos los de consumo. No instala hooks ni guarda la declaración como política.
2. **Selección supervisada.** Preparar un control que lleve la propuesta al compositor nativo mediante una acción visible y mantenga el envío como acción separada. Verificar los contratos de New Agent y New Workspace, el destino que se muestra tras editar la selección y los casos de cambios simultáneos y fallos. El código de referencia de [Paseo Ensemble](https://github.com/DueGin/paseo-ensemble/blob/8b3e4af57fa36ca4f7d1050571d3157179cd6840/client/DraftTeam.tsx) muestra `setProvider` y `setModel` tras una elección de preset. La validación nativa de Zelqio Flow sigue pendiente. [Referencia de plugins de Paseo](https://paseo.sh/docs/plugins/reference)
3. **Selección automática con política verificada.** Mantener el efecto deshabilitado hasta verificar la adquisición y revocación del permiso permanente, la identidad y financiación de la ruta, las señales utilizables de cuota y una superficie que preserve la selección explícita y las opciones efectivas. La primera activación debe limitarse a un mismo proveedor y a financiación sin costos adicionales verificados. Ante evidencia incierta, conservar la ruta nativa supervisada.
4. **Orquestación automática.** Habilitar lanzamiento, delegación y efectos posteriores solo cuando sus propios controles, registro, recuperación y gates estén validados.

La referencia actual de los hooks describe un identificador de workspace. La sonda de la versión fijada no lo recibió. Varios workspaces pueden compartir directorio, por lo que `config.cwd` por sí solo es insuficiente para autorizar una selección en uno de ellos. La configuración por modelo debe considerar las opciones efectivas que el proveedor aplica al modo. [Hooks de Paseo](https://paseo.sh/docs/plugins/hooks) · [Opciones de proveedor](https://paseo.sh/docs/sdk/provider-options)

La recomendación y las sondas o pruebas con efectos deshabilitados son independientes del bloqueo de activación. [Evidencia de autoridad y selección](../evidence/S04-T02-creation-authority.md)
