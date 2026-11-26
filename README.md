# Zelqio Flow — planning baseline

Estado: G0 aprobado de forma condicionada para Foundation local supervisado en Windows con Paseo 0.17.4. MVP completo y distribución pública sujetos a sus validaciones y gates.

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
- Los efectos avanzados permanecen desactivados en Foundation; la interfaz actual es una pantalla de estado de solo lectura.

