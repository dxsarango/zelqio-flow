# Bootstrap — primera acción de desarrollo

Este paquete no creó repositorio remoto ni archivos en el equipo del propietario. Nombre propuesto `zelqio-flow`, carpeta sugerida C:\dev\zelqio-flow. Verificar disponibilidad, titular MIT y destino remoto antes de publicar. Crear repo público solo mediante autorización explícita y verificar owner/destino. Copiar documentos, revisar datos públicos, iniciar Git si no existe, configurar CI inicial y protección compatible con plan/permiso de GitHub (no asumir que se puede crear rulesets). Si protección no verificable, no autorizar merge automático. Mantener Zelqio independiente.

## Primera sesión sugerida
Paseo: orquestador actual (Claude o Codex si configurado y validado), razonamiento High, conversación nueva, workspace del proyecto. Primera tarea S00-T01; paralelizar S00-T02/03/04/05/06/07/08 cuando sus dependencias estén listas, no crear todos los agentes simultáneamente. No instalar plugin en daemon de uso diario. No implementar MVP hasta G0. Registrar evidencias saneadas y decisiones; mantener control de cuota.

## Instrucción inicial para el orquestador (cuando propietario inicie)
Lee README, PRD, TECHNICAL-FEASIBILITY, DEVELOPMENT-WORKFLOW y tasks.json. Ejecuta solo el lote listo de S00 tras comprobar el entorno, con workers independientes cuando aporten valor. Usa un daemon/fixtures aislados, APIs oficiales y versiones fijadas. No alteres proyectos reales, perfiles ni configuración habitual. No publiques sin autorización ni consumas cuota en E2E sin aprobar alcance. Registra PASS/FAIL/BLOCKED/NOT RUN con evidencia, reporta limitaciones y presenta gate G0 para aprobación. No avances al producto hasta G0 aprobado.
