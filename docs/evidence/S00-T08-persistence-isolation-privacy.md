# S00-T08 — Persistencia, aislamiento y privacidad

Paseo 0.17.4 en Windows. El ensayo usa un home nuevo del daemon en `127.0.0.1:16800` con relay desactivado, un repositorio desechable y un servicio de workspace en `:16801`. El plugin S00-T07 guarda un registro pendiente en memoria. El plugin S00-T02 sirve como control independiente. Las sondas utilizan el cliente incluido en la instalación. El daemon de uso habitual queda fuera del ensayo.

## Resultados del 26 de noviembre

| Prueba | Resultado | Evidencia |
|---|---|---|
| POC-12 · Reinicio con operación pendiente | FAIL en la sonda | `daemon stop` seguido de `daemon start` cambió el PID. Antes había un servicio `running` y una solicitud de aprobación pendiente vinculada a HEAD. Tras reiniciar, el servicio quedó `stopped` y el RPC de listado ya no devolvió la solicitud. El estado del repositorio y su rama de control se preservaron. Una primera llamada a `daemon restart` había devuelto el mismo PID y se descartó como prueba de reinicio. |
| POC-13 · Aislamiento | PASS en el fixture | Desactivar el plugin T07 bloqueó su RPC, y el control T02 siguió reportado como activo después de retirar T07. El servicio nativo del workspace siguió `running`. S00-T02 ya comprobó una sesión normal con el hook activo. La sesión de control nueva en T08 quedó fuera del ensayo al devolver el daemon `Provider 'opencode' is not available`. |
| POC-14 · Desactivación y retirada | PASS en el fixture | Los RPC de T07 quedaron inaccesibles tanto tras `plugin disable` como tras `plugin remove`. Se conservaron el otro plugin, el servicio independiente, la rama `test/preserved` en el SHA de control y el archivo sin seguimiento `sentinel.txt`. |
| POC-16 · Red y almacenamiento | BLOCKED para el criterio completo | Las primeras muestras por PID quedaron vacías. En una consulta posterior, `Get-NetTCPConnection` localizó el PID propietario del listener IPv4 `127.0.0.1:16800`, distinto del PID en `paseo.pid`. El propietario tenía listeners en loopback y una conexión TCP establecida con un par fuera de loopback. Se desconoce su origen. La evidencia versionada se limitó a estados, resultados y SHAs. Siguen pendientes la atribución del tráfico y una prueba de exportación saneada. |

La reconciliación de un turno activo, los permisos pendientes de un agente y la conservación de perfiles y memorias durante la retirada quedaron **NOT RUN**. La pérdida de la solicitud refleja el almacén en memoria de la sonda. Un mecanismo de persistencia y reconciliación sigue pendiente de validación para G0. El ensayo de ciclo de vida y retirada terminó con código 0 y no envió prompts.

## Reproducción

```powershell
.\poc\s00-t08\run.ps1 -Install '<paseo-install>' -Scratch '<sandbox>\t08-new'
```

La ruta de scratch debe empezar vacía y los dos puertos deben estar libres. El script crea un Git de prueba, registra un workspace local, instala los dos plugins del repositorio, crea una solicitud vinculada a HEAD y ejecuta el servicio. Reinicia el daemon, comprueba el estado del servicio y la solicitud, vuelve a arrancar el servicio y desactiva y retira el plugin S00-T07. El script toma instantáneas TCP del PID del daemon antes y después del reinicio y lo detiene al finalizar. El fixture queda disponible para inspección.

Para repetir la comprobación adicional, arrancar el mismo home aislado, localizar el listener con `Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort 16800` y consultar las conexiones con `Get-NetTCPConnection -OwningProcess <pid-del-listener>`. La inspección registró estado y alcance de la dirección. La parada final cerró ambos puertos del fixture.

## Comprobación adicional de POC-16

- **PASS en el fixture de exportación.** `node poc/s00-t08/export-probe.mjs` produjo un JSON con versión, ID de comprobación, veredicto y SHA. La prueba verificó que se omitieran ubicación, notas, mensajes y una credencial simulada. Rechazó valores inválidos en los campos permitidos. Solo usó datos sintéticos.
- El log del daemon aislado registra que Paseo intentó descargar modelos locales de voz en los tres arranques del ensayo, incluido el de la inspección TCP. Ese log identifica una fuente de tráfico de la plataforma. Falta correlacionar la conexión observada con una operación concreta y probar la exportación con estado persistido real. POC-16 sigue bloqueado para el criterio completo.

## Seguimiento de G0

- **POC-12, persistencia de aprobación.** La sonda posterior pasó 31 comprobaciones. Confirmó stop/start real, pendientes preservados por workspace y SHA, reintento idempotente e invalidación por cambios. La persistencia mantiene la decisión en el dominio del fixture. La autenticación humana, la caída abrupta y la recuperación de operaciones activas siguen pendientes. [Aprobación y persistencia](G0-approval-persistence.md)
- **POC-16, atribución controlada.** Cuatro controles, con y sin plugins y con dictado activado o desactivado, atribuyeron las conexiones reproducidas a descargas de voz de Paseo en GitHub Releases y su CDN. El destino histórico no se guardó. El criterio completo sigue abierto por cobertura y exportación de estado persistido real. [Red, limpieza y continuidad](G0-lifecycle-privacy.md)
