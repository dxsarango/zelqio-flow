# S00-T07 — Alternativa verificable para la aprobación humana

**Estado: propuesta.** Requiere la aprobación del propietario del alcance antes de usarla como fuente de autoridad. No habilita ningún efecto por sí sola.

## Problema

El RPC de plugins de Paseo 0.17.4 no entrega una identidad humana autenticada. El panel de T07 y un cliente genérico producen la misma petición, así que una aprobación registrada por el plugin es informativa. FR-12 exige aprobación humana verificable ligada al alcance, la revisión de política y el SHA exacto para los efectos que la requieren.

## Alternativas consideradas

| Alternativa | Procedencia | Ligada al SHA | Estado |
|---|---|---|---|
| Acción del usuario en la UI de Paseo y registro del plugin | No verificable: el RPC no distingue al humano de un cliente. | Solo por convención del plugin. | Descartada como autoridad. Útil como señal informativa. |
| **Revisión de PR en GitHub por una cuenta distinta del autor** | Verificable por GitHub: identidad autenticada y registro del revisor. | Sí: la revisión apunta a un commit, se descarta al cambiar el SHA y puede exigirse la aprobación de la última subida. | **Probada** en el [sandbox público](../evidence/S00-T06-public-sandbox.md): aprobación, invalidación y auto-merge protegido. |
| Environments de GitHub con revisores requeridos | Verificable por GitHub. | Ligada a la ejecución del workflow. | No probada; útil para servicios y despliegues. |
| Commits o tags firmados por el propietario | Verificable criptográficamente. | Sí. | No probada; no representa una aprobación de un cambio ajeno. |
| Confirmación fuera de banda (por ejemplo, un token firmado) | Depende del mecanismo. | Depende. | Fuera de alcance del MVP sin una fuente soportada. |

## Propuesta

Usar la aprobación de PR de GitHub como única fuente de aprobación humana verificable para integrar cambios. Los PR deben abrirse con una **identidad de máquina distinta** de la cuenta del propietario, porque GitHub impide la autoaprobación. Protección de `main` con revisión aprobatoria obligatoria, descarte de revisiones obsoletas y aprobación de la última subida. El orquestador no aprueba ni se hace pasar por el propietario.

Las operaciones sensibles que no pasan por un PR (por ejemplo, arrancar un servicio ligado a un SHA) siguen siendo **manuales** hasta que exista una fuente soportada.

## Condiciones y riesgos

- Elegir y proteger la identidad de máquina (GitHub App o cuenta de máquina). Un token de esa identidad con permisos de aprobación anularía la garantía: no debe poder aprobar.
- El flujo con `GITHUB_TOKEN` exige aprobar la ejecución del workflow y publicar el check por `workflow_dispatch`; un PR abierto por esa identidad no dispara `pull_request` de forma útil.
- Se probó con una cuenta humana y una identidad de máquina, no con dos personas. La cola de merge no está disponible en repositorios de usuario.
- La aprobación en GitHub valida un cambio, no una acción arbitraria del agente.

## Decisión pendiente del propietario

Aprobar o rechazar el uso de esta alternativa y el alcance (solo integración de PR). Con su aprobación, S00-T07 puede cerrarse con la operación manual para el resto de efectos.
