# Matriz de trazabilidad de criterios de aceptación

Convención de la columna **Automatizado**:

- **Sí (pytest-bdd)**: el escenario Gherkin exacto está conectado a un step
  definition real bajo `tests/qa/step_definitions/`, ejecutado con
  `pytest-bdd` contra el backend (ver comando en `docs/qa-strategy.md`).
- **Sí (pytest)**: el comportamiento está cubierto por una prueba
  automatizada `pytest` "clásica" dentro de `backend/apps/*/tests/`, pero el
  escenario Gherkin en sí no está conectado mediante `pytest-bdd` (no se
  duplicó el esfuerzo de wiring para todo el catálogo).
- **Sí (Vitest)**: cubierto por una prueba de frontend en `frontend/tests/`.
- **No**: no existe automatización — el criterio se verifica por inspección
  manual (documentado en `test-execution-report.md`), típicamente porque es
  un hecho sobre el propio repositorio, no sobre el comportamiento en tiempo
  de ejecución de la aplicación.

No se marca ningún escenario como "Aprobado" sin haberlo ejecutado — ver
`test-execution-report.md` para el resultado real de cada ejecución.

## Inventario de activos (RF-01, RF-02)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-ACT-001 | Expediente con ficha, responsable y área | inventario-activos.feature | El expediente captura ficha técnica, responsable y área | Sí (pytest) |
| AC-ACT-002 | Código de barras único automático | inventario-activos.feature | El alta genera un código de barras único automáticamente | **Sí (pytest-bdd)** |
| AC-ACT-003 | Correlativo independiente por tipo | inventario-activos.feature | La numeración es correlativa e independiente por tipo de dispositivo | Sí (pytest) |
| AC-ACT-004 | Número de serie no duplicable | inventario-activos.feature | El número de serie no se puede duplicar | Sí (pytest) |
| AC-ACT-005 | Asignación deja traza | inventario-activos.feature | Asignar un custodio deja traza en el historial | Sí (pytest) |
| AC-ACT-006 | Devolución conserva el custodio anterior | inventario-activos.feature | Devolver un equipo conserva el rastro de quién lo tenía | Sí (pytest) |
| AC-ACT-007 | Baja lógica, nunca eliminación | inventario-activos.feature | Un activo se da de baja, nunca se elimina | Sí (pytest) |
| AC-ACT-008 | La baja exige motivo | inventario-activos.feature | Dar de baja exige un motivo | Sí (pytest) |
| AC-ACT-009 | La edición no cambia al custodio | inventario-activos.feature | La edición de la ficha no puede cambiar al responsable | Sí (pytest) |
| AC-ACT-010 | Empleado con activos no se desactiva | inventario-activos.feature | No se puede desactivar a un empleado que aún custodia equipos | Sí (pytest) |

## Carga masiva de activos

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-IMP-001 | Plantilla descargable | carga-masiva-activos.feature | El sistema entrega una plantilla lista para llenar | Sí (pytest) |
| AC-IMP-002 | Hoja de captura sin filas que borrar | carga-masiva-activos.feature | La hoja de captura no exige borrar nada antes de usarla | Sí (pytest) |
| AC-IMP-003 | La plantilla se carga sin ajustes | carga-masiva-activos.feature | La plantilla descargada se puede llenar y cargar sin ajustes | Sí (pytest) |
| AC-IMP-004 | Validación previa sin escribir | carga-masiva-activos.feature | Subir el archivo no guarda nada todavía | Sí (pytest) |
| AC-IMP-005 | Errores con fila y columna | carga-masiva-activos.feature | Los errores se informan con su fila y su columna | Sí (pytest) |
| AC-IMP-006 | Importación todo o nada | carga-masiva-activos.feature | Un archivo con errores no importa ninguna fila | Sí (pytest) |
| AC-IMP-007 | Series duplicadas detectadas | carga-masiva-activos.feature | Un número de serie repetido se detecta antes de importar | Sí (pytest) |
| AC-IMP-008 | Código de barras y movimiento de alta | carga-masiva-activos.feature | Los activos importados reciben su código de barras | Sí (pytest) |
| AC-IMP-009 | Importación auditada | carga-masiva-activos.feature | La carga masiva queda auditada | Sí (pytest) |
| AC-IMP-010 | Permiso de creación exigido | carga-masiva-activos.feature | Cargar masivamente exige el permiso de registrar activos | Sí (pytest) |
| AC-IMP-011 | Columnas configurables | carga-masiva-activos.feature | Las columnas de la plantilla se configuran desde el panel | Sí (pytest) |
| AC-IMP-012 | Obligatoriedad configurable | carga-masiva-activos.feature | Una columna opcional se puede volver obligatoria | Sí (pytest) |
| AC-IMP-013 | Renombrar sincroniza plantilla y lector | carga-masiva-activos.feature | Renombrar una columna cambia el encabezado y lo que se lee | Sí (pytest) |
| AC-IMP-014 | Columnas propias sin migrar | carga-masiva-activos.feature | Se pueden pedir datos propios sin cambiar la base de datos | Sí (pytest) |
| AC-IMP-015 | Columnas imprescindibles protegidas | carga-masiva-activos.feature | Las columnas imprescindibles no se pueden quitar | Sí (pytest) |
| AC-IMP-016 | Configurar exige activos.editar | carga-masiva-activos.feature | Configurar la plantilla exige permiso de edición | Sí (pytest) |

## Captura por escáner (RF-03)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-ESC-001 | Escaneo devuelve ficha, custodio e historial | escaner-activos.feature | Escanear un código muestra ficha, responsable e historial completo | Sí (pytest) |
| AC-ESC-002 | Resuelve también por número de serie | escaner-activos.feature | El escáner también resuelve por número de serie | **Sí (pytest-bdd)** |
| AC-ESC-003 | Código inexistente informa con claridad | escaner-activos.feature | Un código inexistente informa con claridad | Sí (pytest) |

## Panel principal y exportación (§15, §16)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-DSH-001 | Resumen por estado | dashboard-y-reportes.feature | El panel resume el inventario por estado | Sí (pytest) |
| AC-DSH-002 | Indicadores enlazados al listado | dashboard-y-reportes.feature | Cada indicador lleva al listado correspondiente | No (verificado en navegador) |
| AC-DSH-003 | Costos de mantenimiento | dashboard-y-reportes.feature | El panel informa el costo de mantenimiento | Sí (pytest) |
| AC-DSH-004 | Ranking sin activos de baja | dashboard-y-reportes.feature | El ranking señala los equipos problemáticos | Sí (pytest) |
| AC-DSH-005 | Indicadores ausentes declarados | dashboard-y-reportes.feature | Los indicadores que no se pueden calcular se declaran | Sí (pytest) |
| AC-DSH-006 | Garantías vencidas y por vencer | garantias.feature | El panel principal separa lo vencido de lo no capturado | Sí (pytest) |
| AC-DSH-007 | Tiempo fuera de operación acumulado | mantenimientos.feature | El panel acumula el tiempo fuera de operación del parque | Sí (pytest) |
| AC-EXP-001 | Exportación del inventario | dashboard-y-reportes.feature | El inventario se exporta a Excel | Sí (pytest) |
| AC-EXP-002 | La exportación respeta filtros | dashboard-y-reportes.feature | La exportación respeta los filtros de la pantalla | Sí (pytest) |
| AC-EXP-003 | Exportación de la bitácora | dashboard-y-reportes.feature | La bitácora de mantenimientos se exporta a Excel | Sí (pytest) |
| AC-EXP-004 | Permiso propio de exportación | dashboard-y-reportes.feature | Exportar exige un permiso propio | Sí (pytest) |
| AC-EXP-005 | Exportación auditada | dashboard-y-reportes.feature | Cada exportación queda auditada | Sí (pytest) |

## Mantenimientos (RF-04, RF-05)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-MNT-001 | Bitácora con desglose de componentes | mantenimientos.feature | Registrar una intervención con todos sus datos | Sí (pytest) |
| AC-MNT-002 | Contador automático de intervenciones | mantenimientos.feature | El contador de intervenciones se incrementa automáticamente | **Sí (pytest-bdd)** |
| AC-MNT-003 | Solo las piezas críticas cuentan como tales | mantenimientos.feature | Solo las piezas marcadas como críticas alimentan el conteo de críticas | Sí (pytest) |
| AC-MNT-004 | Corregir el historial ajusta los contadores | mantenimientos.feature | Corregir el historial deja los contadores consistentes | Sí (pytest) |
| AC-MNT-005 | El catálogo no reescribe el pasado | mantenimientos.feature | Cambiar la criticidad del catálogo no reescribe el historial | Sí (pytest) |
| AC-MNT-006 | Sin intervenciones futuras | mantenimientos.feature | No se registran intervenciones futuras | Sí (pytest) |
| AC-MNT-007 | Sin intervenciones previas a la compra | mantenimientos.feature | No se registran intervenciones anteriores a la compra del equipo | Sí (pytest) |
| AC-MNT-008 | Sin mantenimientos sobre activos de baja | mantenimientos.feature | No se registran mantenimientos sobre un activo dado de baja | Sí (pytest) |
| AC-MNT-009 | Costo acumulado de sostenimiento | mantenimientos.feature | El sistema informa cuánto se ha invertido en sostener un equipo | Sí (pytest) |
| AC-MNT-010 | Reparación abierta sin días calculados | mantenimientos.feature | Una reparación sin cerrar no reporta días fuera de operación | Sí (pytest) |
| AC-MNT-011 | Días fuera de operación al cerrar | mantenimientos.feature | Al cerrar la reparación se calculan los días fuera de operación | Sí (pytest) |
| AC-MNT-012 | Salida posterior al ingreso | mantenimientos.feature | La salida no puede ser anterior al ingreso | Sí (pytest) |
| AC-MNT-013 | Causa, solución y desenlace | mantenimientos.feature | La bitácora registra causa, solución y desenlace | Sí (pytest) |
| AC-MNT-014 | Tiempo fuera acumulado del parque | mantenimientos.feature | El panel acumula el tiempo fuera de operación del parque | Sí (pytest) |

## Garantías (§4.1)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-GAR-001 | Proveedor y fin de garantía en la ficha | garantias.feature | La ficha registra proveedor y fin de garantía | Sí (pytest) |
| AC-GAR-002 | Sin fecha no es lo mismo que vencida | garantias.feature | Un equipo sin fecha capturada no se cuenta como descubierto | Sí (pytest) |
| AC-GAR-003 | Garantía vencida con días transcurridos | garantias.feature | Una fecha ya pasada deja la garantía vencida | Sí (pytest) |
| AC-GAR-004 | Ventana de aviso de 30 días | garantias.feature | La ventana de aviso avisa antes de perder la cobertura | Sí (pytest) |
| AC-GAR-005 | Filtro por situación de garantía | garantias.feature | El inventario se puede filtrar por situación de garantía | Sí (pytest) |
| AC-GAR-006 | El filtro se resuelve en SQL | garantias.feature | El filtro de garantía se resuelve en la base de datos | Sí (pytest) |
| AC-GAR-007 | Filtro desconocido no vacía el listado | garantias.feature | Un valor de filtro desconocido no vacía el inventario | Sí (pytest) |
| AC-GAR-008 | El panel separa vencido de no capturado | garantias.feature | El panel principal separa lo vencido de lo no capturado | Sí (pytest) |

## Políticas de renovación (RF-06, RF-07)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-POL-001 | Umbrales configurables sin tocar código | politicas-renovacion.feature | Los umbrales se configuran sin tocar el código fuente | Sí (pytest) |
| AC-POL-002 | Política específica gana sobre la global | politicas-renovacion.feature | Cada tipo de dispositivo puede tener sus propios límites | Sí (pytest) |
| AC-POL-003 | Sin política propia, rige la global | politicas-renovacion.feature | Un tipo sin política propia se rige por la global | Sí (pytest) |
| AC-POL-004 | Política desactivada no cae en la global | politicas-renovacion.feature | Una política desactivada no cae de vuelta en la global | Sí (pytest) |
| AC-POL-005 | Exceso de mantenimientos alerta | politicas-renovacion.feature | Exceder el límite de mantenimientos sugiere la renovación | Sí (pytest) |
| AC-POL-006 | El límite exacto no alerta | politicas-renovacion.feature | Estar justo en el límite todavía no dispara la alerta | Sí (pytest) |
| AC-POL-007 | Exceso de piezas críticas alerta | politicas-renovacion.feature | Exceder el límite de piezas críticas sugiere la renovación | Sí (pytest) |
| AC-POL-008 | Longevidad alerta sin intervenciones | politicas-renovacion.feature | Cumplir la vida útil sugiere la renovación sin ninguna intervención | Sí (pytest) |
| AC-POL-009 | Umbral vacío desactiva el criterio | politicas-renovacion.feature | Un umbral vacío desactiva ese criterio, no lo pone en cero | Sí (pytest) |
| AC-POL-010 | Un motivo por criterio superado | politicas-renovacion.feature | Los tres criterios se informan por separado | **Sí (pytest-bdd)** |
| AC-POL-011 | Reconfigurar reevalúa los activos | politicas-renovacion.feature | Ajustar un umbral reevalúa los activos alcanzados | Sí (pytest) |
| AC-POL-012 | Un activo de baja no sugiere renovación | politicas-renovacion.feature | Un activo dado de baja deja de sugerir renovación | Sí (pytest) |
| AC-POL-013 | Política sin umbrales rechazada | politicas-renovacion.feature | Una política sin ningún umbral es rechazada | Sí (pytest) |

## Etiquetas de activos (RF-08)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-ETI-001 | Etiqueta con código, nombre y área | etiquetas-termicas.feature | La etiqueta contiene código de barras, nombre del activo y área | **Sí (pytest-bdd)** |
| AC-ETI-002 | ZPL y TSPL soportados | etiquetas-termicas.feature | Se admiten los dos lenguajes de impresión térmica directa | Sí (pytest) |
| AC-ETI-003 | Formato desconocido rechazado | etiquetas-termicas.feature | Un lenguaje no soportado se rechaza con un mensaje claro | Sí (pytest) |
| AC-ETI-004 | Sin inyección de comandos | etiquetas-termicas.feature | Los datos del activo no pueden inyectar comandos de impresión | Sí (pytest) |
| AC-ETI-005 | Impresión por lotes | etiquetas-termicas.feature | Se pueden imprimir etiquetas de varios activos en un solo trabajo | Sí (pytest) |
| AC-ETI-006 | Descarga para la cola de impresión | etiquetas-termicas.feature | La etiqueta se puede descargar como archivo para la cola de impresión | Sí (pytest) |
| AC-ETI-007 | Permiso propio de impresión | etiquetas-termicas.feature | Imprimir etiquetas exige su propio permiso | Sí (pytest) |
| AC-ETI-008 | Descarga en PDF | etiquetas-termicas.feature | La etiqueta se descarga en PDF | **Sí (pytest-bdd)** |
| AC-ETI-009 | PDF a tamaño físico real | etiquetas-termicas.feature | El PDF conserva el tamaño físico de la etiqueta | Sí (pytest) |
| AC-ETI-010 | Vista previa antes de imprimir | etiquetas-termicas.feature | La etiqueta se puede revisar antes de imprimirla | Sí (pytest) |

## Arquitectura

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-008 | Backend y frontend separados | acceptance-criteria.feature | Backend y frontend están separados | No |
| AC-009 | Backend usa Python y Django | acceptance-criteria.feature | El backend usa Python y Django | No |
| AC-010 | Usa SQL Server | acceptance-criteria.feature | El proyecto usa SQL Server | Sí (pytest, ver AC-040) |
| AC-011 | Patrón MVT | acceptance-criteria.feature | El backend mantiene el patrón Modelo Vista Template | No |
| AC-012 | Frontend usa React | acceptance-criteria.feature | El frontend usa React | No |
| AC-013 | Node.js gestiona deps frontend | acceptance-criteria.feature | Node.js administra las dependencias del frontend | No |
| AC-014 | Bootstrap framework visual | acceptance-criteria.feature | Bootstrap es el framework visual principal | No |
| AC-015 | Templates y estilos separados | acceptance-criteria.feature | Templates y estilos están separados | No |

## Autenticación y seguridad

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-016 | Login valida credenciales | authentication.feature | Inicio de sesión exitoso | **Sí (pytest-bdd)** |
| AC-016 | Login valida credenciales | authentication.feature | Rechazo de credenciales inválidas | Sí (pytest) |
| AC-016 | Login valida credenciales | authentication.feature | Un identificador inexistente recibe la misma respuesta | Sí (pytest) |
| AC-016 | Login valida credenciales | authentication.feature | Un usuario deshabilitado no puede iniciar sesión | **Sí (pytest-bdd)** |
| AC-016 | Login valida credenciales | authentication.feature | Deshabilitar un usuario revoca sus sesiones activas | Sí (pytest) |
| AC-017 | Hash seguro de Django | password-security.feature | La contraseña se almacena únicamente como hash Argon2 | **Sí (pytest-bdd)** |
| AC-018 | No contraseñas en texto plano | password-security.feature | La API nunca devuelve la contraseña ni su hash | Sí (pytest) |
| AC-019 | JWT firmado con secreto de entorno | jwt-security.feature | El token se firma con un secreto configurado por variable de entorno | No (verificación de configuración, no de comportamiento) |
| AC-020 | Expiración configurable | jwt-security.feature | El access token tiene una expiración configurable | Sí (pytest, vía settings) |
| AC-020 | Expiración configurable | jwt-security.feature | Un access token expirado es rechazado | **Sí (pytest-bdd)** |
| AC-020 | Expiración configurable | jwt-security.feature | Renovación de tokens con un refresh token vigente | Sí (pytest) |
| AC-021 | Rutas protegidas rechazan no autenticados | authentication.feature | Un usuario no autenticado no puede consultar su perfil | Sí (pytest) |
| AC-022 | Operaciones protegidas rechazan sin permiso | authorization.feature | Un usuario sin el permiso requerido recibe 403 y queda auditado | **Sí (pytest-bdd)** |
| AC-023 | Tokens completos no en logs | jwt-security.feature | El registro de auditoría nunca contiene tokens completos | Sí (pytest) |
| AC-024 | Contraseñas no en logs | password-security.feature | Un fallo de validación con datos de contraseña no filtra el valor | Sí (pytest) |
| AC-025 | Sin credenciales reales versionadas | repository-hygiene.feature | No existen credenciales reales versionadas | No |
| AC-026 | `.env.example` seguro existe | repository-hygiene.feature | Existen archivos .env.example seguros | No |

## Usuarios, roles y permisos

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-027 | Crear usuarios | users.feature | Crear un usuario correctamente | Sí (pytest) |
| AC-027 | Crear usuarios | users.feature | No se puede crear un usuario con un correo ya registrado | Sí (pytest) |
| AC-028 | Editar usuarios | users.feature | Editar los datos de perfil de un usuario | Sí (pytest) |
| AC-029 | Activar/desactivar usuarios | users.feature | Deshabilitar un usuario activo | Sí (pytest) |
| AC-029 | Activar/desactivar usuarios | users.feature | Habilitar un usuario deshabilitado | Sí (pytest) |
| AC-030 | Crear roles | roles.feature | Crear un rol con una selección parcial de permisos | **Sí (pytest-bdd)** |
| AC-030 | Crear roles | roles.feature | Un rol puede contener todos los permisos de un módulo | Sí (pytest) |
| AC-030 | Crear roles | roles.feature | No se pueden crear dos roles con el mismo nombre | Sí (pytest) |
| AC-031 | Editar roles | roles.feature | Editar el nombre y los permisos de un rol | Sí (pytest) |
| AC-032 | Asignar roles a usuarios | roles.feature | Asignar un rol a un usuario | Sí (pytest, capa de servicio) |
| AC-033 | Retirar roles | roles.feature | Retirar un rol de un usuario | Sí (pytest, capa de servicio) |
| AC-034 | Asignar permisos a roles/usuarios | roles.feature | Asignar permisos individuales a un usuario | Sí (pytest, capa de servicio) |
| AC-035 | Retirar permisos | roles.feature | Retirar permisos individuales de un usuario | Sí (pytest, capa de servicio) |
| AC-036 | Permisos validados en backend | authorization.feature | Un usuario con el permiso adecuado accede correctamente | **Sí (pytest-bdd)** |
| AC-036 | Permisos validados en backend | authorization.feature | Revocar un permiso surte efecto en la siguiente petición | Sí (pytest) |
| AC-036 | Permisos validados en backend | authorization.feature | Un superusuario tiene acceso total sin depender del catálogo | Sí (pytest) |
| AC-036 | Permisos validados en backend | permissions.feature | Consultar el catálogo completo de permisos | **Sí (pytest-bdd)** |
| AC-036 | Permisos validados en backend | permissions.feature | Un usuario sin permiso no puede consultar el catálogo | **Sí (pytest-bdd)** |
| AC-037 | Menú admin muestra solo lo autorizado | authorization.feature | El menú administrativo del frontend solo muestra las opciones autorizadas | Sí (Vitest, componente estático filtrado por permiso) |
| AC-037 | Menú admin muestra solo lo autorizado | authorization.feature | Acceder directamente a una URL sin el permiso redirige a 403 | Sí (Vitest, `RequirePermission.test.jsx`) |
| AC-038 | Evita quedar sin administrador activo | users.feature | No se puede deshabilitar al último administrador activo | **Sí (pytest-bdd)** |
| AC-038 | Evita quedar sin administrador activo | users.feature | No se puede bloquear al último administrador activo | Sí (pytest) |
| AC-038 | Evita quedar sin administrador activo | users.feature | Sí se puede deshabilitar a un administrador si existe otro activo | **Sí (pytest-bdd)** |
| AC-038 | Evita quedar sin administrador activo | users.feature | Un usuario sin privilegios de administrador se puede deshabilitar libremente | Sí (pytest) |
| AC-039 | Sin hashes/tokens/secretos en interfaces | users.feature | El listado de usuarios nunca expone hashes ni tokens | Sí (pytest, por inspección de serializers) |

## Base de datos

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-040 | Migraciones funcionan con SQL Server | acceptance-criteria.feature | Las migraciones funcionan con SQL Server | Sí (ejecución real, ver test-execution-report.md) |
| AC-041 | Relaciones válidas usuarios/roles/permisos | acceptance-criteria.feature | Existen relaciones válidas entre usuarios, roles y permisos | Sí (implícito: toda la suite pytest usa estas relaciones) |
| AC-042 | Restricciones de unicidad | acceptance-criteria.feature | Se aplican restricciones de unicidad | Sí (pytest: `test_admin_cannot_create_user_with_duplicate_email`) |
| AC-043 | Sin datos productivos en el repo | acceptance-criteria.feature | No existen datos productivos dentro del repositorio | No |
| AC-044 | Admin sin contraseña fija | acceptance-criteria.feature | La creación del administrador no usa una contraseña fija | No (verificación de proceso, ver test-execution-report.md) |

## Calidad y documentación

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-045 | Backend inicia correctamente | acceptance-criteria.feature | El backend inicia correctamente | Sí (pytest: `test_health_check_reports_ok_without_secrets`) |
| AC-046 | Frontend inicia correctamente | acceptance-criteria.feature | El frontend inicia correctamente | Sí (verificación manual en navegador, ver reporte) |
| AC-047 | Frontend genera build correctamente | acceptance-criteria.feature | El frontend genera un build de producción correctamente | Sí (ejecución real `npm run build`) |
| AC-048 | Pruebas backend documentadas | acceptance-criteria.feature | Las pruebas de backend están documentadas | Sí (83 pruebas pytest, ver reporte) |
| AC-049 | Pruebas frontend documentadas | acceptance-criteria.feature | Las pruebas de frontend están documentadas | Sí (10 pruebas Vitest, ver reporte) |
| AC-050 | Pruebas de integración documentadas | acceptance-criteria.feature | Las pruebas de integración están documentadas | Sí (13 escenarios pytest-bdd, ver reporte) |
| AC-051 | Cada AC tiene escenario Gherkin | acceptance-criteria.feature | Cada criterio de aceptación tiene un escenario Gherkin | Sí (esta misma matriz) |
| AC-052 | Cada escenario tiene trazabilidad | acceptance-criteria.feature | Cada escenario Gherkin tiene trazabilidad | Sí (esta misma matriz) |
| AC-053 | Resultados de ejecución documentados | acceptance-criteria.feature | Los resultados de ejecución están documentados | Sí (test-execution-report.md) |
| AC-054 | README refleja estructura final | acceptance-criteria.feature | El README refleja la estructura final | No (revisión manual) |
| AC-055 | Documentación técnica en docs/ | acceptance-criteria.feature | Existe documentación técnica en docs/ | No (revisión manual) |
| AC-056 | Sin imports/rutas huérfanas | acceptance-criteria.feature | No existen imports ni rutas huérfanas | Sí (ejecución real de ruff/eslint) |
| AC-057 | Sin dependencias innecesarias | acceptance-criteria.feature | No existen dependencias innecesarias confirmadas | No (revisión manual) |

## Autenticación — criterios adicionales descubiertos (AC-AUTH-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-AUTH-001 | Registro público de usuario | authentication.feature | Registro público de un nuevo usuario | Sí (pytest) |
| AC-AUTH-002 | Cierre de sesión individual | authentication.feature | Cierre de sesión individual | Sí (pytest, endpoint `/auth/logout/`) |
| AC-AUTH-003 | Protección contra fuerza bruta | authentication.feature | Protección contra fuerza bruta | Sí (pytest) |

## JWT — criterios adicionales (AC-JWT-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-JWT-001 | Reutilización de refresh token revoca la sesión | jwt-security.feature | Reutilización de un refresh token ya rotado revoca la sesión | Sí (pytest) |

## Contraseñas — criterios adicionales (AC-PWD-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-PWD-001 | Solicitud de recuperación (cuenta existente) | password-security.feature | Solicitud de recuperación de contraseña para una cuenta existente | Sí (pytest) |
| AC-PWD-002 | Solicitud de recuperación (cuenta inexistente) | password-security.feature | Solicitud de recuperación para una cuenta inexistente no genera rastro | Sí (pytest) |
| AC-PWD-003 | Confirmación exitosa de recuperación | password-security.feature | Confirmación exitosa de recuperación de contraseña | Sí (pytest) |
| AC-PWD-004 | Token de recuperación ya usado rechazado | password-security.feature | Un token de recuperación ya usado es rechazado | Sí (pytest) |
| AC-PWD-005 | Token de recuperación expirado rechazado | password-security.feature | Un token de recuperación expirado es rechazado | Sí (pytest) |
| AC-PWD-006 | Contraseña débil rechazada | password-security.feature | Una contraseña que no cumple la política es rechazada | Sí (pytest) |
| AC-PWD-007 | Restablecimiento administrativo sin exponer contraseña | password-security.feature | Restablecimiento administrativo sin exponer la nueva contraseña | Sí (pytest) |
| AC-PWD-008 | Restablecimiento administrativo exige una acción | password-security.feature | El restablecimiento administrativo exige al menos una acción | Sí (pytest) |
| AC-PWD-009 | Cambio de contraseña obligatorio bloquea la app | password-security.feature | Un cambio de contraseña obligatorio bloquea el resto de la aplicación | Sí (pytest) |

## Usuarios — criterios adicionales (AC-USR-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-USR-001 | Acceso sin permiso no persiste cambios | users.feature | Acceso sin permiso no persiste cambios | Sí (pytest) |
| AC-USR-002 | Búsqueda y paginación | users.feature | Búsqueda y paginación del listado de usuarios | Sí (pytest) |

## Roles — criterios adicionales (AC-ROL-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-ROL-001 | Eliminación física de un rol | roles.feature | Eliminación física de un rol | Sí (pytest) |
| AC-ROL-002 | Catálogo de permisos para el formulario de rol | roles.feature | Acceso al catálogo de permisos para construir el formulario de rol | Sí (pytest) |
| AC-ROL-003 | Acceso sin permiso de roles rechazado | roles.feature | Un usuario sin permiso de roles no puede administrar roles | Sí (pytest) |

## Permisos — criterios adicionales (AC-PERM-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-PERM-001 | Catálogo de solo lectura | permissions.feature | El catálogo es de solo lectura | No (verificación de diseño: no existe endpoint de escritura) |
| AC-PERM-002 | Página de Permisos es de solo consulta | permissions.feature | La página de Permisos del panel administrativo es de solo consulta | Sí (Vitest: `PermissionsPage.test.jsx`) |

## Branding — módulo adicional (AC-BR-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-BR-001 | Cambiar nombre del sitio | branding.feature | Cambiar el nombre del sitio | **Sí (pytest-bdd)** |
| AC-BR-002 | Color hexadecimal válido | branding.feature | Ingresar un color hexadecimal válido | Sí (pytest) |
| AC-BR-003 | Color hexadecimal inválido rechazado | branding.feature | Ingresar un color hexadecimal inválido | **Sí (pytest-bdd)** |
| AC-BR-004 | Advertencia de contraste no bloquea guardado | branding.feature | Advertencia de contraste insuficiente sin bloquear el guardado | Sí (pytest) |
| AC-BR-005 | Catálogo de fuentes/radios de borde | branding.feature | Catálogo de tipografías y radios de borde disponible | Sí (pytest) |
| AC-BR-006 | Restaurar valores por defecto | branding.feature | Restaurar los valores por defecto del tema | Sí (pytest) |
| AC-BR-007 | Tema público sin autenticación | branding.feature | El tema vigente se puede leer sin autenticación | Sí (pytest) |
| AC-BR-008 | Editar sin permiso rechazado | branding.feature | Editar la configuración sin el permiso correspondiente | Sí (pytest) |
| AC-BR-009 | Logo/favicon como URL, sin biblioteca de medios | branding.feature | El logo y el favicon se administran como URL de texto | Sí (verificación de diseño + pytest de guardado) |
| AC-BR-010 | Apariencia es preferencia local | branding.feature | La apariencia claro/oscuro es una preferencia local | Sí (Vitest: `AparienciaTab`, verificado también en navegador real) |

## Protección de datos personales (AC-DP-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-DP-001 | Sin permiso no accede a datos personales | personal-data-protection.feature | Un usuario sin permisos intenta consultar datos personales | Sí (pytest, mismo caso que AC-022) |
| AC-DP-002 | Datos personales nunca en logs | personal-data-protection.feature | Los datos personales nunca se registran en logs de acceso | No (revisión manual de logging, ver reporte) |
| AC-DP-003 | Auditoría enmascara campos sensibles | personal-data-protection.feature | El registro de auditoría enmascara campos sensibles | Sí (pytest: `test_sensitive_fields_are_masked_regardless_of_caller`) |
| AC-DP-004 | Detalle de auditoría requiere permiso adicional | personal-data-protection.feature | Acceso a auditoría con datos personales requiere permiso adicional | Sí (pytest: `test_detail_diff_hidden_without_ver_detalle_permission`) |
| AC-DP-005 | Usuario consulta sus propios datos | personal-data-protection.feature | Un usuario puede consultar cuáles son sus propios permisos y datos | Sí (pytest) |
| AC-DP-006 | Baja lógica conserva historial | personal-data-protection.feature | Deshabilitar una cuenta no elimina físicamente sus datos | Sí (pytest, por diseño: `UserAdminViewSet` sin `destroy`) |
