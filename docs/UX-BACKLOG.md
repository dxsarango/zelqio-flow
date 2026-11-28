# Mejoras pendientes de UX/UI (S08-T04)

**Estado: propuesta sin aprobar.** Recoge lo observado en las pruebas reales en iOS y en escritorio. El diseño definitivo **no está aprobado**: primero se completan las funcionalidades pendientes y después se prepara una propuesta visual integral para la revisión del propietario. Las mejoras de abajo son una lista de trabajo, no un diseño.

## Navegación y estructura

- Navegación interna organizada en **Resumen, Ejecuciones, Agentes, Recursos y Ajustes** (propuesta sujeta a revisión de UX).
- Unificar el acceso al **setup** y al **dashboard**: hoy hay dos iconos en la barra lateral.
- Menos desplazamiento vertical, sobre todo en móvil: secciones plegables y resumen arriba.

## Dashboard y datos

- Dashboard compacto con jerarquía visual e indicadores de actividad (ejecuciones en curso, en espera, entregadas).
- Cuotas con indicadores visuales y ventanas de sesión y semanales, en lugar de solo texto.
- Historial de ejecuciones con detalles expandibles (proveedor, modelo, esfuerzo, reasignaciones, esperas, entrega).
- Estados de **error, bloqueo, atención requerida y entrega** claramente diferenciados, y la diferencia entre «sesión terminada» y «objetivo cumplido» ya recogida en el modelo (`outcome`).
- Renderizado correcto de **Markdown** en los resultados.

## Calidad

- Corrección de traducciones incompletas (EN y ES).
- Compatibilidad con tamaños compactos y de escritorio y con los temas nativos de Paseo.
- Validación visual del propietario en iOS y en escritorio antes de cerrar cada pantalla.

## Hallazgos de las pruebas en iOS ya corregidos

- El compositor decía que la selección automática seguía desactivada.
- Una ejecución con un fallo de delegación aparecía como «Entregada» sin más.
- Formato de fechas en motores móviles.

## Pendiente de verificar

- Ubicación del control Automatic en pantallas compactas: el propietario lo encontró dentro del selector de modelos.
