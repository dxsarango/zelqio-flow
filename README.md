# Zelqio Flow — planning baseline

Estado (27 de noviembre de 2026): plugin de orquestación **sobre Paseo**, no una reconstrucción de su infraestructura ([ADR R1](docs/adr/R1-orchestration-plugin-on-paseo.md)). Con **Automatic** activado en New Agent o New Workspace, Zelqio Flow elige un modelo entre los que autorizaste, crea y coordina agentes nativos, y si un proveedor llega a su límite conserva el trabajo y lo reasigna a otro proveedor autorizado o espera a que Paseo informe cuota recuperada y reanuda el mismo agente una sola vez. Verificado de extremo a extremo en daemons aislados de Paseo 0.17.5 y 0.17.6 con proveedores sintéticos ([evidencia](docs/evidence/S11-e2e-run-flow.md)). Zelqio Flow usa las cuentas y proveedores que configuraste en Paseo: una suscripción o una etiqueta Free no garantiza la ausencia de cargos, no verifica la facturación y nunca habilita créditos ni cambia de cuenta.

Plugin independiente, licencia MIT, interfaz EN/ES, distribución objetivo en el catálogo de Paseo. La publicación de evidencias de desarrollo y la distribución del plugin siguen sus autorizaciones respectivas.

## Lectura
- [PRD](docs/PRD.md): requisitos y límites.
- [Viabilidad](docs/TECHNICAL-FEASIBILITY.md): pruebas bloqueantes y alternativas.
- [G0 condicionado](docs/adr/G0-supervised-scope.md) y [validaciones pendientes](docs/VALIDATION-BACKLOG.md).
- [Arquitectura](docs/ARCHITECTURE.md), [UX](docs/UX-SPEC.md), [modos](docs/WORK-MODES.md).
- [Routing](docs/ROUTING-POLICY.md), [Git](docs/GIT-POLICY.md), [seguridad](docs/SECURITY.md), [privacidad](docs/PRIVACY.md).
- [Pruebas](docs/TEST-STRATEGY.md), [release](docs/RELEASE.md).
- [Plan detallado](planning/PLAN.md), [tareas JSON](planning/tasks.json), [flujo de desarrollo](planning/DEVELOPMENT-WORKFLOW.md), [bootstrap](planning/BOOTSTRAP.md).

La fuente de verdad de alcance es PRD; las decisiones técnicas aprobadas se registran en ADR; el estado operativo se registra en tasks.json. No marcar una capacidad como validada por documentación únicamente. Las propuestas no aprobadas se identifican como tales. No publicar datos privados ni configuraciones de desarrollo personales.

## Desarrollo local (Foundation)
El repositorio raíz es el plugin de Paseo (`paseo-plugin.json`, `index.client.tsx`, `index.server.ts`, `client/`, `server/`, `shared/`). Requisitos: Node.js 24, Paseo 0.17.4 (el manifest limita a `>=0.17.4 <0.18.0`) y Windows para Foundation.
- `npm ci` instala dependencias fijadas; `npm run check` ejecuta typecheck, lint y pruebas unitarias. CI ejecuta lo mismo en Linux, Windows y macOS.
- Probar el plugin siempre en un daemon aislado: `paseo daemon config set daemon.listen 127.0.0.1:<puerto> --home <carpeta>`, `daemon.relay.enabled false`, `pluginsEnabled true`; `paseo daemon start --home <carpeta>` y `paseo plugin install <ruta-del-repo> --home <carpeta>`. No instalar en el daemon habitual.
- `node tools/serve-app.mjs <app-dist> <puerto> <host:puerto-daemon>` sirve la app web preconectada al daemon aislado para validar la interfaz.
- El plugin ofrece: ejecuciones con reasignación y reanudación por cuota (`zelqio.runs.submit/list/cancel`), enrutado automático al crear, delegación a agentes nativos con dependencias, esfuerzo de razonamiento, roles propios, panel de ejecuciones, Power Management opcional y ajustes globales. La prueba extremo a extremo se reproduce con `node poc/e2e/run.mjs` (ver la evidencia). Git, PR y modos de entrega sobre ejecuciones están en curso (S11-T07).

