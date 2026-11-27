# S11-T07 · Entrega Git de ejecuciones

Las ejecuciones de escritura gestionadas por `runs.submit` usan un workspace nativo de Paseo y una rama `type/description`. El plugin comprueba el repositorio, la rama y el SHA base antes de iniciar el agente. El listado muestra la rama, el estado y el enlace del PR cuando existe. Los hijos de escritura parten de la rama del coordinador. Su integración se hace en serie y conserva ambas ramas si encuentra un conflicto.

## Configuración y recuperación

Para publicar, selecciona `per_project` y configura `git-projects.json` en el directorio de estado de Zelqio Flow. Cada entrada del array vincula `commonDir` a la salida canónica de `git rev-parse --path-format=absolute --git-common-dir`, `origin` a `propietario/repositorio` y `base` a la rama de destino. Para un fork existente, especifica también `upstream`. El objeto `policy` usa las capas existentes. Concede por separado `git.push` para la rama de origen, `pr.create` para la base y `pr.merge` si se permite integrar. Los recursos tienen la forma `propietario/repositorio:refs/heads/rama`. En un destino bare local para `direct`, configura `localDirect: true` y usa la ruta canónica como `origin` y en el recurso del permiso.

Smart Review usa los archivos del diff para distinguir cambios de bajo riesgo, interfaz y cambios sensibles o desconocidos. La revisión diferida requiere `deferred` en la política local con `taskId`, `sha`, `destination`, `expiresAt` en milisegundos Unix y las confirmaciones `independentReview: true` y `validationEnvironment: true`. Conserva el worktree para que el propietario revise el candidato.

El journal guarda la transición antes de actualizar una referencia, publicar o retirar un worktree. Después de un reinicio se comprueba el efecto observado. Si el resultado sigue indeterminado, el plugin conserva el trabajo y deja la operación pendiente de revisión manual. La retirada comprueba que el árbol esté limpio, que los commits sigan referenciados y que el workspace esté inactivo. Usa `git worktree remove` sin fuerza.

## Verificación

- `npm run check` pasó con 433 pruebas y una prueba GitHub optativa omitida por defecto. Las pruebas con Git real cubren commit local, remoto bare, autorización denegada, fork simulado con dos remotos bare, conflicto, recuperación de push y rechazo de retirada si hay cambios.
- `node test/git-delivery-native.mjs <sandbox> <run-id> <git.exe>` verificó Paseo 0.17.6 en un daemon aislado con proveedor sintético. Se creó una rama `docs/…` desde `6c33091611dc83103ee31de77386d980a1e5ed74`, se obtuvo `no_changes` y se retiró el worktree manteniendo la rama y el checkout principal.
- `ZELQIO_GITHUB_SANDBOX_TEST=review_first` con Vitest abrió el PR [#7](https://github.com/dxsarango/zelqio-flow-s00-public-sandbox/pull/7) con candidato `b9d76bd40816bf113ab96890836a09e43d020567`. El estado de entrega fue `review`. Se cerró el PR durante la limpieza y GitHub confirmó `merged: false`.
- `ZELQIO_GITHUB_SANDBOX_TEST=auto_merge` abrió el PR [#8](https://github.com/dxsarango/zelqio-flow-s00-public-sandbox/pull/8). `gh api repos/<sandbox>/commits/<sha>/check-runs` confirmó `fixture-check` de la app 15368, completado con éxito sobre `ec9f382595e94952e96697def794eb73032563c7`. `gh pr merge --squash --match-head-commit` integró ese candidato. GitHub devolvió el SHA de fusión `00808243613052b8edb76a46f0d8a641e80314bb`.
- La variante retiró temporalmente el requisito de revisión y activó el historial lineal. Una lectura final de `branches/main/protection` confirmó la restauración de una aprobación, descarte de revisiones obsoletas, aprobación del último push, historial lineal desactivado, `fixture-check` estricto, aplicación a administradores y force push desactivado. GitHub mantuvo habilitados auto-merge y squash. `git ls-remote --heads` confirmó que las dos ramas temporales se eliminaron.

Durante la verificación se recuperó un fallo de red al aplicar la variante del sandbox. La prueba de integración local también detectó una aserción dependiente de CRLF en Windows. El repositorio temporal ahora fija el comportamiento de fin de línea.

## Límites

La adopción de un agente creado desde Automatic mantiene el checkout que recibió de Paseo. El hook `agent.create.before` de esta versión admite cambios de configuración y metadata y carece de un campo de placement. Las instrucciones de solo lectura para agentes delegados dependen de los permisos nativos del proveedor. El journal coordina las operaciones dentro de un proceso del plugin. Las reglas efectivas que el adaptador deja sin verificar y las colas de integración quedan en revisión manual. La aportación por fork se verificó con Git real y un adaptador de GitHub simulado. La revisión diferida queda pendiente de validación en GitHub.
