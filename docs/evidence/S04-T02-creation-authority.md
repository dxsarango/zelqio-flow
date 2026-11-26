# S04-T02 — Autoridad en el hook de creación de Paseo 0.17.4

El hook de creación espera la decisión del plugin antes de abrir la sesión. La sonda verificó esa propiedad en Windows sin usar proveedores reales ni enviar prompts. La selección automática de producción queda bloqueada por falta de evidencia de autoridad y financiación vinculada al destino exacto.

| Comprobación | Resultado | Evidencia |
|---|---|---|
| Espera del hook antes de abrir una sesión | PASS | Dos llamadas a `api.agents.create` devolvieron el rechazo de la sonda. El daemon aislado terminó con cero agentes. |
| Intención del borrador | PASS | La solicitud sin marca llegó sin ella. La solicitud con el marcador de S04-T01 llegó con él. Ambas procedían del cliente SDK del fixture. |
| Actor verificable recibido por la superficie de creación | BLOCKED | Las dos ejecuciones recibieron `config`, `env` y `metadata`. El contexto expuso `paseo` y `signal`. Ningún campo de la superficie identifica el actor ni la fuente que autorizó la solicitud. El tipo público del SDK coincide con lo observado. |
| Financiación verificada por destino | BLOCKED | El catálogo público de la versión instalada carece de un campo uniforme y verificable de financiación por modelo. La proyección de cuotas identifica fuentes, que pueden repetirse y carecer de asociación verificable con cuenta y modelo. [Contrato y evidencia de cuotas](S00-T03-catalog-usage.md) |
| Enrutamiento de producción y primer mensaje | NOT RUN | La sonda detiene ambas solicitudes. El plugin de producto conserva la selección automática deshabilitada. |

No inferir autorización del marcador, las opciones de `config`, el nombre del modelo o el estado de una fuente de cuota. La política de proyecto, el permiso efectivo y la financiación deben acompañar al par exacto proveedor/modelo antes de proponer una sustitución. Una elección manual en Paseo sigue bajo los controles del host. Mantener la ruta supervisada mientras el SDK carezca de autoridad verificable para el automatismo. [Política de seguridad](../SECURITY.md) · [Prueba inicial del compositor y hook](S00-T02-composer-routing.md)

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

Las trazas muestran únicamente los nombres de campos y la presencia del marcador. El primer intento consultó el catálogo demasiado pronto. La ejecución registrada esperó a que el proveedor sintético estuviera listo y completó ambas comprobaciones.
