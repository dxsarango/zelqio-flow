# G0 — Aprobación condicionada de Foundation

**Aprobado por el propietario el 26 de noviembre de 2026 para iniciar S01.** La autorización cubre Foundation local y supervisado en Windows con Paseo 0.17.4. El MVP completo conserva sus requisitos y sus validaciones abiertas. [Dictamen de G0](../evidence/G0-decision.md)

## Implementación autorizada

- Windows y Paseo 0.17.4 para desarrollo de la fase acotada. Usar superficies soportadas y opt-in explícito.
- Ejecución directa o workers supervisados con herramientas y permisos efectivos verificados. Un solo escritor por unidad de ejecución. Ante interrupción o pérdida del coordinador, pausar y reconciliar cambios, intentos y referencias de forma supervisada. La sucesión automática, el archivado de agentes activos y la retirada de worktrees administrados quedan deshabilitados.
- Entrega de evidencia local y traspaso al propietario. Los registros de aprobación del plugin son informativos mientras falte una fuente humana verificable. El propietario puede realizar una acción sensible por su cuenta tras comprobar el SHA. El plugin carece de autoridad para push, PR, merge, cola, auto-merge y limpieza automática en este alcance.

## Condiciones de aceptación

S00-T09 registra la decisión condicionada y abre S01. S00-T06, S00-T07 y S00-T08 conservan sus bloqueos para el alcance completo. Cada ampliación requiere evidencia por capacidad y los gates posteriores al alcance autorizado.

Antes de entregar la fase acotada, probar la activación explícita, la ejecución supervisada con un escritor, el bloqueo ante permisos desconocidos y la recuperación manual tras interrupción sin duplicar efectos. Verificar la privacidad y retirada de los componentes realmente habilitados, incluida la exportación saneada de estado persistido. GitHub protegido, aprobación autenticada, recuperación desatendida y limpieza automática requieren validaciones propias antes de habilitarse.

## Desarrollo y publicación

Foundation limita al producto. El equipo conserva Smart Review, su entorno multiagente y sus proveedores autorizados para desarrollar y validar cambios. La publicación del paquete saneado de S00 en el repositorio público está autorizada mediante PR con protecciones y checks en el SHA candidato. La distribución pública del plugin requiere las pruebas de Complete MVP, G9, G10 y autorización de release.
