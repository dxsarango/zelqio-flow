# S00-T06 — Integración Git y publicación de prueba

Windows, Git 2.50.1. Se ejecutó `node poc/s00-t06/local-git.mjs` en un repositorio temporal local creado por la sonda. Cada invocación usa un proceso Git nuevo. Las ramas y los archivos del fixture quedan disponibles para inspección.

| Prueba | Resultado | Evidencia |
|---|---|---|
| POC-09 · Integración de dos ramas | PASS | Dos worktrees parten del SHA exacto `e997b69b1902a83af98e2e7b0b0f77c4a7ee1e17`. El candidato `e7122c889fb3ee20d946ca58af7cce270280eae1` contiene ambos commits subordinados y sus archivos verificados. El checkout consolidado termina limpio. |
| POC-10 · Conflicto y recuperación Git | PASS | Un proceso nuevo reconoce `MERGE_HEAD` y el estado `UU`. `git merge --abort` devuelve el checkout al SHA anterior y preserva ambas ramas. Se reprodujo el conflicto y se resolvió en `8593220e109869029c4c3b114f1a244afda26906`. Se verificaron los dos padres, el contenido resuelto y que reintentar con el mismo SHA no cambia HEAD. |
| POC-15 · PR en GitHub sandbox | BLOCKED | Falta un repositorio sandbox identificado y autorizado para publicar ramas, abrir un PR y probar rechazos, checks y el SHA de integración. El repositorio de Zelqio Flow se consultó en lectura para verificar su protección. |

POC-10 demuestra recuperación del estado persistido de Git entre procesos. La recuperación de un daemon durante trabajo activo y un journal de producto quedan fuera de esta sonda. POC-09 usa Git local con worktrees desechables. Sigue pendiente la decisión de G0 sobre worktrees de Paseo de escritura paralela debido al hallazgo de POC-08.
