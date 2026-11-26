# S00-T06 — Integración Git y publicación de prueba

Windows, Git 2.50.1. Se ejecutó `node poc/s00-t06/local-git.mjs` en un repositorio temporal local creado por la sonda. Cada invocación usa un proceso Git nuevo. Las ramas y los archivos del fixture quedan disponibles para inspección.

| Prueba | Resultado | Evidencia |
|---|---|---|
| POC-09 · Integración de dos ramas | PASS | Dos worktrees parten del SHA exacto `e997b69b1902a83af98e2e7b0b0f77c4a7ee1e17`. El candidato `e7122c889fb3ee20d946ca58af7cce270280eae1` contiene ambos commits subordinados y sus archivos verificados. El checkout consolidado termina limpio. |
| POC-10 · Conflicto y recuperación Git | PASS | Un proceso nuevo reconoce `MERGE_HEAD` y el estado `UU`. `git merge --abort` devuelve el checkout al SHA anterior y preserva ambas ramas. Se reprodujo el conflicto y se resolvió en `8593220e109869029c4c3b114f1a244afda26906`. Se verificaron los dos padres, el contenido resuelto y que reintentar con el mismo SHA no cambia HEAD. |
| POC-15 · PR en GitHub sandbox | Parcial | Se verificaron ramas, publicación, PR, CI por SHA y rechazos API. Las protecciones, su cumplimiento y auto-merge quedaron bloqueados por las capacidades del repositorio privado. |

POC-10 demuestra recuperación del estado persistido de Git entre procesos. La recuperación de un daemon durante trabajo activo y un journal de producto quedan fuera de esta sonda. POC-09 usa Git local con worktrees desechables. Sigue pendiente la decisión de G0 sobre worktrees de Paseo de escritura paralela debido al hallazgo de POC-08.

## POC-15 · Ejecución remota del 26 de noviembre de 2026

Se creó el sandbox privado autorizado, con identidad administrativa verificada. Se publicó únicamente `poc/s00-t06/github-fixture/` en un Git init independiente. Se conservó el sandbox y el PR de prueba. La rama `main` del repositorio de producto solo se consultó en lectura.

| Comprobación | Estado | Evidencia |
|---|---|---|
| Rama, push y PR | PASS | Push inicial de `main` en `b00b1bd58177da9bd48392f9ec0e6749a6a07aeb`. Push de `test/poc15-candidate` y PR #1 a `main`. |
| CI positivo y negativo ligado a SHA | PASS | `fixture-check` falló en `3568c91ccdbd3b33cdb9db37a5ecb43749caa9a3` (run 45773073711) y pasó en `5ae109bce5f8559a530b6ab7beba9e2cd9d67845` (run 45773390633). El segundo SHA coincide en el Git local, ref remoto, PR y metadatos del run. |
| Rechazo de candidato obsoleto | PASS | `PUT /pulls/1/merge` con el primer `sha` tras el segundo push devolvió HTTP 409. Se verificaron el PR abierto, `mergedAt=null` y la base en el SHA inicial. |
| Escritura sin autorización y autoaprobación | PASS | `POST /issues` sin autenticación devolvió HTTP 401. El autor del PR intentó `POST /pulls/1/reviews` con `event=APPROVE` y GitHub devolvió HTTP 422 por autoaprobación. Esto ejercita la denegación, no una aprobación positiva de un actor distinto. |
| Protecciones y reglas aplicables | BLOCKED | `PUT /branches/main/protection` y `GET /rules/branches/main` devolvieron HTTP 403, con mensaje que exige GitHub Pro o un repositorio público. `GET /branches/main` confirmó `protected=false`. |
| Auto-merge | BLOCKED | `PATCH /repos/<sandbox>` con `allow_auto_merge=true` devolvió `false` y la verificación posterior volvió a devolver `false`. El PR mantuvo `autoMergeRequest=null`. La visibilidad siguió siendo privada. |
| Cola de merge | NOT RUN | La fixture carecía de protecciones efectivas. No se configuró ni se ingresó en una cola. |
| Rechazo de push/merge por una regla activa | NOT RUN | El plan del sandbox impide aplicar la regla. Se conservó el PR abierto y no se ejecutó un merge con el candidato correcto sin protecciones. |

Un check verde y una capacidad de escritura sirven para preparar un PR. Los requisitos de la política de entrega siguen condicionados a reglas verificables en cada destino. El sandbox permanece privado. [GitHub Docs sobre protecciones de rama](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches).
