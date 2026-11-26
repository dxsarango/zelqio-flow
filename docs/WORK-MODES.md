# Work modes

Modo de entrega independiente de estrategia de recursos y Git workflow. Los cuatro modos respetan permisos, políticas de repositorio y checks requeridos. No se cambian reglas para satisfacer automatización. Default propuesto: Review First.

| Modo | Gate humano | Entrega |
|---|---|---|
| Review First | Cada integración/publicación final según workflow; PR si corresponde, diff local si no | Evidencia + aprobación exacta |
| Auto Merge | No revisión humana del plugin, salvo autorización o política externa | Integración automática autorizada tras checks |
| Smart Review | Si el impacto exige prueba humana o el usuario lo pide | Preview/diff, iteraciones en misma rama/PR |
| Autopilot | Solo bloqueos de seguridad, permisos o requisitos externos | Resultado funcional, Git discreto; preview si aplica |

Smart Review: clasificar diff real, impacto en comportamiento, pruebas, riesgo e instrucciones. Docs-only genuino con comprobaciones puede integrar automático; UI/formularios/navegación normalmente solicitan prueba; backend con evidencia suficiente puede automatizar; auth, migraciones, pagos o incertidumbre aplican reglas de riesgo y pueden exigir aprobación. No confiar en prefijo de rama. Sin evidencia suficiente, bloquear o solicitar validación; no asumir éxito. Usuario puede solicitar prueba en cualquier cambio.

Aprobación: acción explícita de actor verificable y vínculo a tarea, acción, proyecto, destino, SHA, evidencia y política relevante. Una solicitud pendiente se recupera como pendiente después de reiniciar. Rechazo o cambios conserva ejecución, rama, PR y workspace. Nuevo SHA o política relevante invalida la aprobación. Si la superficie disponible carece de procedencia humana, ofrecer entrega para que el propietario ejecute la acción manualmente. Si GitHub usa cola o auto-merge, exigir protecciones y una garantía verificable sobre el candidato final.

Autopilot no significa acceso ilimitado, publicación pública, gastos, despliegue a producción o eliminación de Git. Para tarea no Git, no iniciar repositorio por obligación. Si local preview procede, verificar URL, servicio, health, versión y cómo detenerlo. Si no puede completarse, entregar estado parcial honesto.
