# S04-T02 — Autoridad en el hook de creación de Paseo 0.17.4

El hook de creación espera la decisión del plugin antes de abrir la sesión. La sonda verificó esa propiedad y la aplicación de una selección en Windows con un proveedor sintético. Una política permanente verificable puede cubrir la selección rutinaria. En producción quedan pendientes el canal de esa política, la financiación ligada a la ruta efectiva y la preservación de elecciones explícitas en el compositor. [Decisión de arquitectura](../adr/S04-routing-authority.md)

| Comprobación | Resultado | Evidencia |
|---|---|---|
| Espera del hook antes de abrir una sesión | PASS | La prueba inicial rechazó dos solicitudes. La nueva sonda rechazó tres solicitudes antes de abrir una sesión. Ambas ejecuciones dejaron cero agentes. |
| Intención del borrador | PASS | Un cliente SDK pudo enviar la marca de S04-T01 o prescindir de ella. La marca no aporta una identidad verificable. |
| Actor verificable recibido por la superficie de creación | BLOCKED | Las ejecuciones recibieron `config`, `env` y `metadata`. El contexto expuso `paseo` y `signal`. La superficie carece de identidad del actor y de la fuente de autorización. El tipo del SDK coincide con lo observado. |
| Sustitución con política sintética y modelo ausente | PASS | El `HostClient` enviado con Paseo 0.17.4 admitió una configuración sin modelo. El segundo hook recibió `fixture-model` y `modeId: review` antes de detener la solicitud. |
| Ruta ordinaria y modelo presente | PASS | La solicitud ordinaria y la solicitud marcada con `fixture-manual` conservaron modelo y modo. Un segundo hook detuvo ambas solicitudes antes de abrir una sesión. |
| Selección implícita en el SDK de alto nivel | BLOCKED | `api.agents.create` rechazó la configuración que indicaba solo el proveedor. Exige el formato `provider/model`. Queda por verificar si las rutas nativas preservan una distinción confiable entre un modelo explícito y un valor predeterminado. |
| Financiación verificada por destino | BLOCKED | El catálogo público de la versión instalada carece de un campo uniforme y verificable de financiación por modelo. La proyección de cuotas identifica fuentes, que pueden repetirse y carecer de asociación verificable con cuenta y modelo. [Contrato y evidencia de cuotas](S00-T03-catalog-usage.md) |
| Enrutamiento de producción y primer mensaje | NOT RUN | La sonda detiene ambas solicitudes. El plugin de producto conserva la selección automática deshabilitada. |

Los campos del borrador carecen de autoridad. Antes de aplicar una sustitución automática, comprobar la política de proyecto, los permisos efectivos y la financiación del par exacto. La captura de una autorización nueva y las operaciones sensibles conservan sus requisitos de identidad. La recomendación puede trabajar con declaraciones sin autoridad y cuota sin vincular. [Política de seguridad](../SECURITY.md) · [Prueba inicial del compositor y hook](S00-T02-composer-routing.md)

## Reproducción

Usar Paseo 0.17.4 con un home nuevo, escucha exclusiva en `127.0.0.1:16893`, sin relay, voz ni dictado y con perfil de proveedores vacío. Instalar solo `poc/s04-t02/guard` y `poc/s00-t03/local-source`. El segundo plugin proporciona un catálogo sintético. Crear un directorio desechable dentro de ese home. Ejecutar el driver con el Electron de Paseo y consultar los logs y los agentes exclusivamente en ese endpoint.

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& (Join-Path $install 'Paseo.exe') poc/s04-t02/driver.mjs $install 127.0.0.1:16893 $fixture | Out-String
Remove-Item Env:ELECTRON_RUN_AS_NODE
paseo plugin logs zelqio-probe-s04-t02 --host 127.0.0.1:16893 --json
paseo ls --host 127.0.0.1:16893 --global --json
paseo daemon stop --home $probeHome
```

Las trazas se limitan a los nombres de los campos, la presencia del marcador, el modelo sintético y el modo. El orden esperado es `fixture-manual`, `fixture-model` y `fixture-manual`. El driver espera al catálogo y requiere el rechazo de cada creación. Verificar además que la lista final esté vacía. El fixture omite autenticación de políticas, entitlements y sesiones reales de proveedor.

## Revisión independiente

La revisión estática de otro proveedor sobre `ad681ea` confirmó que la recomendación y la selección acotada por una autorización vigente se pueden evaluar por separado. Identificó como pendientes la procedencia de la autorización, el vínculo con la ruta de facturación y la preservación del modelo explícito. Requirió probar que un hook posterior recibe la configuración cambiada. La sonda de esta revisión cubre esa propagación con el catálogo sintético.

La revisión del RPC consultivo corroboró la exclusión de consumo y la separación de autoridad. A partir de sus observaciones, cada recomendación incluye el estado de cuota sin vincular. Las fechas indican la vigencia declarada por el solicitante y se cubren entradas extra de autoridad, IDs ambiguos y discrepancias de financiación.

## RPC consultivo en el daemon aislado

Instalar también Zelqio Flow en el daemon desechable indicado arriba. `preview.mjs` usa el cliente de Paseo 0.17.4 y el RPC de ajustes para habilitar temporalmente el proveedor sintético. A continuación verifica `zelqio.routing.preview`, la exclusión del modelo por consumo, la respuesta estable al invertir el orden de las declaraciones y la conservación de la revisión de ajustes tras la consulta.

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& (Join-Path $install 'Paseo.exe') poc/s04-t02/preview.mjs $install 127.0.0.1:16893 | Out-String
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

PASS en Windows con catálogo y financiación sintéticos. La sonda usó tres solicitudes rechazadas por el guard y cero sesiones. La recomendación carece de validación visual en New Agent o New Workspace. CI multiplataforma pendiente sobre el candidato publicado.
