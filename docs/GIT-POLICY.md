# Git policy

Adaptación de las skills engram-commit-hygiene y engram-branch-pr proporcionadas por el propietario. No se copian reglas de contribución específicas de Engram como requisitos universales. Conventional Commits y `type/description` recomendados y personalizables. Un cambio lógico por commit, motivo claro, diff/staging revisado, sin secretos ni archivos transitorios, Co-Authored-By configurable (preferencia del propietario: sin trailers); sin atribuciones engañosas.

## Workflows
Local only (sin push ni PR); Pull request (rama autorizada, PR al remoto/base explícitos); Fork contribution (origin/upstream verificados, reglas externas); Direct integration (sin PR solo si autorizado y permitido). No Git obligatorio para chat/investigación. Repositorio nuevo: git init solo autorizado, remoto solo autorización separada. GitHub adaptador `gh` autenticado, sin leer tokens. Issues aprobados, labels y templates se respetan cuando repositorio los exige, no se inventan ni se generalizan.

## Preflight
Identidad canónica repo y common git dir, remotos y URL, rama base real, permisos, protección, estado dirty/untracked, refs y SHA. No limpiar, stash, rebase o sobrescribir trabajo del usuario automáticamente. Fetch cuando autorizado; no pull ciego: fast-forward only cuando proceda, detener ante divergencia. Detectar reglas inaccesibles; no interpretar 403 como ausencia de protección. Respetar restricciones de rama, nombre y método de merge.

## Integración
Rama de tarea desde base registrada; worktree Paseo por unidad de escritura concurrente. Base exacta registrada; archivos/rutas y dependencias planificadas; commits de worker verificables. Coordinador único integra secuencialmente en worktree de integración; verificar ancestry y diffs, usar merge/cherry-pick según política y evidencia. Preferir integración no destructiva; conflictos preservan ramas y trabajo, resolución en entorno controlado, repetir pruebas. Comprobar resultado consolidado, no sumar checks independientes como evidencia final. Lock común y CAS/revalidación de refs; journal de operaciones. Sin borrar worktrees/ramas con cambios sin confirmar, sin force push ni reset hard por defecto.

## Publicación
Autorizaciones separadas: fetch, crear rama, commit, push (destino), crear repo/fork, PR, merge, cleanup. Modo automático no concede autorizaciones implícitas. Publicar solo al destino autorizado, verificar PR base/head, SHA, estado y checks reales. Usar `gh pr merge --match-head-commit` si compatible, sin admin bypass; auto-merge/queue solo si política y garantía de aprobación lo permiten. Revalidar antes de efectos; no prometer merge hasta confirmado por servidor. Si required checks/reviews pendientes, bloquear o esperar sin bucle. Rechazo de permisos: no retry ni cambiar destino. Si rama base cambia, actualizar candidato con autorización y repetir validación. Logs locales saneados. Rollback de cambios publicados mediante revert autorizado, no reescritura de historial.

Verificar las capacidades efectivas por repositorio, plan y rama. Si la forja no ofrece las protecciones exigidas por el proyecto, conservar el PR y la evidencia del SHA y bloquear el merge automatizado. Una respuesta de escritura exitosa, un check verde o un estado mergeable no acreditan reglas ni aprobación. [Evidencia de POC-15](evidence/S00-T06-git-publication.md).

## Evidencia
Comandos reales y resultados, SHA, checks locales vs CI separados, N/A justificado, missing/pending explícitos. No afirmar pass por ausencia de checks; requerir política local y detección del repositorio. Tests proporcionales. No guardar secretos o prompts en commits/PRs. Reglas específicas de Engram (issue aprobado, type:* labels, fork obligatorio, checks Go) solo si el repo correspondiente las exige.
