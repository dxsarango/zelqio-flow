# S04-T06 — Selección supervisada en Paseo 0.17.4

Prueba ejecutada en Windows con un home de daemon nuevo, relay deshabilitado y conexiones en loopback. El navegador usó un perfil desechable. El daemon cargó el catálogo de S00-T03, el guard de S04-T02 y el control de `poc/s04-t06/supervised`. El control solo propone el segundo modelo del proveedor sintético cuando ese proveedor ya está seleccionado en un borrador. Su única mutación es `setModel`.

| Flujo | Resultado | Evidencia |
|---|---|---|
| New Workspace | PASS | `fixture-model` → aplicar recomendación → `fixture-manual`. El modelo cambió y `review` se conservó. La lista de sesiones siguió vacía. Después, el selector nativo devolvió el borrador a `fixture-model` y el guard recibió ese modelo en el envío nativo. |
| New Agent | PASS | En un workspace local del fixture, el control cambió el borrador a `fixture-manual`. Tras elegir `fixture-model` manualmente, el guard recibió el modelo final con `modeId: review`. El ensayo también observó un envío supervisado que conservó `fixture-manual`. |
| Sesiones e inferencia | PASS | El guard rechazó las tres solicitudes de creación y el daemon terminó con cero sesiones. El catálogo sintético carece de transporte de inferencia. |
| Elección explícita y valor predeterminado | BLOCKED | Ambos compositores enviaron un valor de modelo en `config`. La interfaz del guard carece de un campo que diferencie si ese valor lo puso el selector nativo o un plugin. |
| Validación de producto | NOT RUN | El modelo, la autorización y el catálogo son sintéticos. Quedan por preparar el control final, la revalidación al cambiar de borrador y el manejo de opciones dependientes del modelo. |

Algunos elementos del compositor aparecen en el panel nativo **Features** tras seleccionar un modelo. En New Workspace fue necesario abrirlo para pulsar el botón de la sonda. El navegador comprobó que el botón recibía el clic antes de enviar una acción. Los dos modelos de prueba tenían opciones de razonamiento diferentes, por lo que el control nativo actualizó la disponibilidad de la opción Low al cambiar de modelo. Preservar opciones de ejecución verificadas sigue siendo una condición para cualquier automatismo.

## Reproducción

Usar un daemon de Paseo 0.17.4 con perfil desechable y los tres plugins de prueba. Servir el web build de esa versión con `tools/serve-app.mjs`, en loopback y con CORS limitado al origen de prueba. Crear un workspace local sobre un directorio nuevo dentro del home de prueba. Abrir New Workspace y New Agent, elegir **Fixture model**, aplicar **Apply fixture recommendation**, comprobar **Fixture explicit model** y **Review**. Elegir **Fixture model** manualmente y enviar solo un texto sintético al guard. El guard debe registrar `fixture-model` y `review`. Verificar cero agentes y detener el daemon aislado.

El ensayo cubre una acción explícita seguida de un envío separado. La selección supervisada de producción aún requiere que el modelo cumpla una política vigente, con financiación verificada, antes de ofrecer la acción. [Referencia de compositor Paseo](https://paseo.sh/docs/plugins/reference#composer-items)
