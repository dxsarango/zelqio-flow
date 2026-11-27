# S00-T06 — Protecciones de rama y auto-merge en un repositorio público desechable

Fecha: 2026-11-27. Resultado: **PASS** para la capacidad efectiva de protecciones y auto-merge. **BLOCKED** para la cola de merge en repositorios de usuario.

El sandbox privado anterior no permitía protecciones por el plan ([POC-15](S00-T06-git-publication.md)). El propietario autorizó un repositorio **público, desechable y separado** con datos sintéticos. Se creó `zelqio-flow-s00-public-sandbox` con la fixture de `poc/s00-t06/github-fixture/`, sin secretos ni código del producto. La protección de `main` del repositorio del producto no se tocó: una instantánea de solo lectura de sus protecciones, ajustes y rulesets quedó idéntica antes y después.

## Configuración probada en el sandbox

Check obligatorio `fixture-check`, rama al día (`strict`), `enforce_admins`, sin force push ni borrado, auto-merge permitido. En la segunda fase se añadió una revisión aprobatoria obligatoria con descarte de revisiones obsoletas y aprobación de la última subida.

## Resultados

| Prueba | Estado | Evidencia |
|---|---|---|
| Push directo a `main` por el administrador | PASS | `protected branch hook declined`: «Required status check "fixture-check" is expected». |
| Merge de un PR cuyo check falla | PASS | `gh pr merge` sin bandera y con `--admin` rechazados («Required status check "fixture-check" is failing»). El PR queda abierto. |
| Auto-merge con check correcto | PASS | El PR #2 se fusionó solo al pasar `fixture-check`, con commit de merge registrado. |
| Auto-merge con check fallido | PASS | El PR #1 conservó `autoMergeRequest` y permaneció abierto. |
| Revisión obligatoria sin aprobación | PASS | PR con check verde y auto-merge armado: `BLOCKED` / `REVIEW_REQUIRED`. `--admin` rechazado. |
| Autoaprobación | PASS | `Review Can not approve your own pull request`. |
| Aprobación humana de un actor distinto | PASS | Un workflow con `GITHUB_TOKEN` abrió el PR #5 (autor `github-actions`). El propietario lo aprobó, el check de la ejecución `workflow_dispatch` pasó y el auto-merge lo fusionó. |
| Invalidación al cambiar el SHA | PASS | PR #6: una aprobación sobre `5cecd5e` pasó a `DISMISSED` al subir `6972b70`. Una segunda aprobación del último que subió no cuenta (`REVIEW_REQUIRED`, `BLOCKED`). |
| Candidato obsoleto por SHA | PASS | Cubierto en POC-15 (HTTP 409). No se repitió. |
| Cola de merge | BLOCKED | `POST /rulesets` con la regla `merge_queue` devuelve HTTP 422 en un repositorio de usuario. Solo estaría disponible en repositorios de organización. |

## Hallazgos para el diseño

- **Una identidad de máquina distinta hace posible una aprobación humana verificable.** GitHub impide la autoaprobación, así que un PR creado por la identidad del propietario no puede aprobar el propio propietario. Si el agente abre los PR con otra identidad (aquí el `GITHUB_TOKEN` del workflow; en producción, una GitHub App o cuenta de máquina), la aprobación del propietario queda registrada por GitHub, ligada al SHA y descartada si el SHA cambia. Es una alternativa externa soportada para S00-T07; ver [ADR](../adr/S00-T07-human-approval-alternative.md).
- Los PR creados con `GITHUB_TOKEN` no disparan el workflow `pull_request` de forma útil: la ejecución queda en `action_required` hasta aprobarla (`POST /actions/runs/{id}/approve`) y el check obligatorio debe publicarse con `workflow_dispatch` sobre la rama. Hay que diseñarlo antes de depender de este camino.
- La cola de merge no es una dependencia viable en repositorios de usuario; el MVP debe apoyarse en protecciones, auto-merge y `--match-head-commit`.
- El auto-merge nativo y `gh pr merge --squash --match-head-commit` coexisten: el primero espera los checks, el segundo valida el SHA exacto. Ambos respetan `enforce_admins`.

## Límites

Una sola cuenta humana: la aprobación positiva se probó entre el propietario y una identidad de máquina, no entre dos personas. No se verificaron Environments con revisores requeridos ni firmas de commits. El sandbox permanece público y abierto como evidencia; los PR #1, #4 y #6 quedan abiertos. La poca representatividad de un repositorio de usuario frente a una organización queda anotada.
