# G0 — Propuesta de alcance local supervisado

**Estado propuesto.** El propietario debe aprobar el alcance y la arquitectura para abrir S01. La evidencia actual no admite aprobar la automatización completa del MVP. [Dictamen de G0](../evidence/G0-decision.md)

## Alcance propuesto

- Windows y Paseo 0.17.4 para desarrollo de la fase acotada. Usar superficies soportadas y opt-in explícito.
- Ejecución directa o workers supervisados con herramientas y permisos efectivos verificados. Un solo escritor cada vez. Ante interrupción o pérdida del coordinador, pausar y reconciliar cambios, intentos y referencias de forma supervisada. La sucesión automática, el archivado de agentes activos y la retirada de worktrees administrados quedan deshabilitados.
- Entrega de evidencia local y traspaso al propietario. Los registros de aprobación del plugin son informativos mientras falte una fuente humana verificable. El propietario puede realizar una acción sensible por su cuenta tras comprobar el SHA. El plugin carece de autoridad para push, PR, merge, cola, auto-merge y limpieza automática en este alcance.

## Condiciones de aceptación

Antes de abrir S01, registrar la aprobación explícita y actualizar la aceptación y dependencias del plan para el alcance elegido. Mantener documentadas las dependencias bloqueadas del MVP completo.

Antes de entregar la fase acotada, probar la activación explícita, la ejecución supervisada con un escritor, el bloqueo ante permisos desconocidos y la recuperación manual tras interrupción sin duplicar efectos. Verificar la privacidad y retirada de los componentes realmente habilitados, incluida la exportación saneada de estado persistido. GitHub protegido, aprobación autenticada, recuperación desatendida y limpieza automática requieren validaciones propias antes de habilitarse.
