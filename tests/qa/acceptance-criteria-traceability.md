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

## Ficha completa del activo (§4.1, §12, §14)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-EST-001 | Los nueve estados | ficha-completa-activo.feature | El activo tiene los nueve estados del documento | Sí (pytest) |
| AC-EST-002 | Disponible ≠ en bodega | ficha-completa-activo.feature | Disponible y en bodega son estados distintos | Sí (pytest) |
| AC-EST-003 | Salida exige motivo | ficha-completa-activo.feature | Sacar un equipo del inventario exige decir por qué | Sí (pytest + Vitest) |
| AC-EST-004 | La salida libera al custodio | ficha-completa-activo.feature | Un equipo que sale del inventario deja de estar a nombre de nadie | Sí (pytest) |
| AC-EST-005 | Reingreso de lo perdido | ficha-completa-activo.feature | Un equipo perdido que aparece vuelve al inventario | Sí (pytest) |
| AC-EST-006 | La baja es definitiva | ficha-completa-activo.feature | Un equipo dado de baja no vuelve | Sí (pytest + Vitest) |
| AC-EST-007 | No se asigna lo que salió | ficha-completa-activo.feature | No se asigna un equipo que ya no está | Sí (pytest) |
| AC-EST-008 | Tránsito y garantía son parque | ficha-completa-activo.feature | En tránsito y en reclamación de garantía siguen siendo parque | Sí (pytest) |
| AC-EST-009 | Lo que salió no alerta | ficha-completa-activo.feature | Lo que salió del parque deja de generar alertas | Sí (pytest) |
| AC-EST-010 | Lo que salió no se renueva | ficha-completa-activo.feature | Lo que salió del parque no se sugiere renovar | Sí (pytest) |
| AC-EST-011 | Lo que salió no se repara | ficha-completa-activo.feature | No se registran reparaciones sobre un equipo que no está | Sí (pytest) |
| AC-EST-012 | Pérdidas separadas de bajas | ficha-completa-activo.feature | El panel separa las pérdidas de las bajas | Sí (pytest) |
| AC-EST-013 | El expediente se conserva | ficha-completa-activo.feature | El expediente de lo que salió sigue siendo consultable | Sí (pytest) |
| AC-UBI-001 | Ubicación de catálogo | ficha-completa-activo.feature | La ubicación es un catálogo, no un texto escrito a mano | Sí (pytest) |
| AC-UBI-002 | Ubicación ≠ departamento | ficha-completa-activo.feature | La ubicación se separa del departamento | Sí (pytest) |
| AC-UBI-003 | Sin duplicados por sede | ficha-completa-activo.feature | No se repite una ubicación dentro de la misma sede | Sí (pytest) |
| AC-UBI-004 | Mismo nombre en otra sede | ficha-completa-activo.feature | El mismo nombre en otra sede sí es válido | Sí (pytest) |
| AC-UBI-005 | No se cierra con equipos | ficha-completa-activo.feature | No se cierra una ubicación que todavía tiene equipos | Sí (pytest) |
| AC-UBI-006 | No se usa una cerrada | ficha-completa-activo.feature | No se pone un equipo en una ubicación cerrada | Sí (pytest) |
| AC-UBI-007 | Migración sin pérdida | ficha-completa-activo.feature | Las ubicaciones escritas antes no se pierden | No (verificado al migrar la base real) |
| AC-UBI-008 | Carga masiva contra catálogo | ficha-completa-activo.feature | La carga masiva exige una ubicación que exista | Sí (pytest) |
| AC-UBI-009 | Nombre ambiguo entre sedes | ficha-completa-activo.feature | Un nombre de ubicación repetido en dos sedes se debe desambiguar | Sí (pytest) |
| AC-CLA-001 | Cuatro niveles de criticidad | ficha-completa-activo.feature | La criticidad tiene los cuatro niveles del documento | Sí (pytest) |
| AC-CLA-002 | El uso es la función | ficha-completa-activo.feature | El uso describe la función del equipo, no cuánto se usa | Sí (pytest) |
| AC-CLA-003 | Valor por defecto neutro | ficha-completa-activo.feature | La clasificación arranca en el valor más neutro | Sí (pytest) |
| AC-CLA-004 | Ingreso ≠ compra | ficha-completa-activo.feature | La fecha de ingreso se separa de la de compra | Sí (pytest) |
| AC-CLA-005 | Ingreso posterior a la compra | ficha-completa-activo.feature | El ingreso no puede ser anterior a la compra | Sí (pytest) |
| AC-FIL-001 | Filtro por ubicación y sede | ficha-completa-activo.feature | Se filtra el inventario por ubicación y por sede | Sí (pytest) |
| AC-FIL-002 | Filtro por antigüedad | ficha-completa-activo.feature | Se filtra el inventario por antigüedad | Sí (pytest) |
| AC-FIL-003 | Filtro por criticidad y uso | ficha-completa-activo.feature | Se filtra por criticidad y por uso | Sí (pytest) |
| AC-FIL-004 | Exportación completa | ficha-completa-activo.feature | La exportación arrastra los campos nuevos | Sí (pytest) |

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
| AC-DSH-002 | Indicadores enlazados al listado | dashboard-y-reportes.feature | Cada indicador lleva al listado correspondiente | Sí (Vitest: `cada indicador lleva al listado que lo explica`) |
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

## Reportes y exportación (§16)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-REP-001 | Los trece reportes | reportes.feature | Están los trece reportes del documento | Sí (pytest) |
| AC-REP-002 | Excel, CSV y PDF | reportes.feature | Cada reporte se puede sacar en los tres formatos | Sí (pytest, los 39 cruces) |
| AC-REP-003 | Catálogo autodescriptivo | reportes.feature | El catálogo dice qué se puede filtrar en cada reporte | Sí (pytest + Vitest) |
| AC-REP-004 | Lo que salió no ensucia | reportes.feature | Lo que salió del parque no ensucia los reportes operativos | Sí (pytest) |
| AC-REP-005 | El censo sí lo incluye | reportes.feature | El inventario general sí es el censo completo | Sí (pytest) |
| AC-REP-006 | Las tres salidas juntas | reportes.feature | El reporte de bajas reúne las tres salidas | Sí (pytest) |
| AC-REP-007 | Por usuario, solo asignados | reportes.feature | El reporte por usuario excluye lo que no está asignado | Sí (pytest) |
| AC-REP-008 | Período respetado | reportes.feature | Los reportes de período respetan las fechas pedidas | Sí (pytest) |
| AC-REP-009 | Parámetro ilegible tolerado | reportes.feature | Un parámetro ilegible no rompe el reporte | Sí (pytest) |
| AC-REP-010 | Totales al pie | reportes.feature | El reporte de costos trae el total del período | Sí (pytest) |
| AC-REP-011 | Contexto en el archivo | reportes.feature | Cada archivo dice de qué período es y con qué filtros se sacó | Sí (pytest) |
| AC-REP-012 | El corte se avisa | reportes.feature | Un reporte demasiado largo avisa de que se cortó | Sí (pytest) |
| AC-REP-013 | PDF con menos columnas | reportes.feature | El PDF lleva menos columnas que el Excel | Sí (pytest) |
| AC-REP-014 | Descargar exige permiso propio | reportes.feature | Ver un reporte no habilita a descargarlo | Sí (pytest + Vitest) |
| AC-REP-015 | Descarga auditada | reportes.feature | Cada descarga queda auditada | Sí (pytest) |
| AC-REP-016 | CSV con BOM | reportes.feature | El CSV se abre sin destrozar los acentos | Sí (pytest) |

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

## Cálculo de tiempos (§10)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-TIE-001 | Los siete tiempos | tiempos-del-activo.feature | El sistema calcula los siete tiempos del documento | Sí (pytest + Vitest) |
| AC-TIE-002 | Compra e ingreso por separado | tiempos-del-activo.feature | El tiempo desde la compra y desde el ingreso se cuentan por separado | Sí (pytest) |
| AC-TIE-003 | Se declara la base del cálculo | tiempos-del-activo.feature | Sin fecha de ingreso, el cálculo se mide desde la compra y lo declara | Sí (pytest + Vitest) |
| AC-TIE-004 | Custodio actual sin períodos ajenos | tiempos-del-activo.feature | El tiempo con el custodio actual no incluye los períodos ajenos | Sí (pytest) |
| AC-TIE-005 | Sin custodio, sin tiempo | tiempos-del-activo.feature | Un equipo sin custodio no tiene tiempo con el custodio actual | Sí (pytest + Vitest) |
| AC-TIE-006 | Reparación abierta aparte | tiempos-del-activo.feature | La reparación abierta se informa aparte de la acumulada | Sí (pytest + Vitest) |
| AC-TIE-007 | Tiempo guardado sin uso | tiempos-del-activo.feature | El tiempo sin uso suma lo que el equipo estuvo guardado | Sí (pytest) |
| AC-TIE-008 | Lo que salió deja de contar | tiempos-del-activo.feature | Un equipo que salió del inventario deja de acumular tiempo | Sí (pytest) |
| AC-TIE-009 | Tiempo activo real | tiempos-del-activo.feature | El tiempo activo real descuenta lo guardado y lo reparado | Sí (pytest) |
| AC-TIE-010 | Nunca negativo | tiempos-del-activo.feature | El tiempo activo real nunca es negativo | Sí (pytest) |
| AC-TIE-011 | Sin multiplicar consultas | tiempos-del-activo.feature | Calcular los tiempos no multiplica las consultas | Sí (pytest) |

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
| AC-POL-014 | Dos niveles por antigüedad | politicas-renovacion.feature | La antigüedad escala de «evaluar» a «reemplazo recomendado» | Sí (pytest) |
| AC-POL-015 | Un solo motivo de antigüedad | politicas-renovacion.feature | La antigüedad no se informa dos veces al cruzar los dos umbrales | Sí (pytest) |
| AC-POL-016 | Política de un solo nivel intacta | politicas-renovacion.feature | Una política sin segundo nivel se comporta como antes | Sí (pytest) |
| AC-POL-017 | El veredicto toma el nivel más severo | politicas-renovacion.feature | El nivel reportado es el más severo de los criterios superados | Sí (pytest) |
| AC-POL-018 | Segundo nivel posterior al primero | politicas-renovacion.feature | El segundo nivel debe ser posterior al primero | Sí (pytest) |
| AC-POL-019 | Ventana móvil de reparaciones | politicas-renovacion.feature | Las reparaciones se cuentan dentro de una ventana móvil | Sí (pytest) |
| AC-POL-020 | Reparaciones recientes sí alertan | politicas-renovacion.feature | Cuatro reparaciones dentro de la ventana sí disparan el aviso | Sí (pytest) |
| AC-POL-021 | Sin ventana, historial completo | politicas-renovacion.feature | Sin ventana configurada se cuenta todo el historial | Sí (pytest) |
| AC-POL-022 | Una ventana por tipo de dispositivo | politicas-renovacion.feature | Cada tipo de dispositivo cuenta su propia ventana | Sí (pytest) |
| AC-POL-023 | Ventana sin máximo rechazada | politicas-renovacion.feature | La ventana exige un máximo de reparaciones | Sí (pytest) |
| AC-POL-024 | Ventana resuelta en una consulta | politicas-renovacion.feature | La ventana se resuelve en una sola consulta agregada | Sí (pytest) |
| AC-POL-025 | Panel e inventario por nivel | politicas-renovacion.feature | El inventario y el panel distinguen los dos niveles | Sí (pytest) |

## Adjuntos, evidencias y actas (§18, §6)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-ADJ-001 | Adjuntar documentos al activo | adjuntos-y-actas.feature | Se adjunta un documento a un activo | Sí (pytest) |
| AC-ADJ-002 | Nombre de archivo generado | adjuntos-y-actas.feature | El archivo se guarda con un nombre generado | Sí (pytest) |
| AC-ADJ-003 | Nombres repetidos no se pisan | adjuntos-y-actas.feature | Dos archivos con el mismo nombre no se pisan | Sí (pytest) |
| AC-ADJ-004 | Lista cerrada de formatos | adjuntos-y-actas.feature | Solo se admiten los formatos previstos | Sí (pytest) |
| AC-ADJ-005 | Se verifica la firma del contenido | adjuntos-y-actas.feature | Un ejecutable renombrado a PDF también se rechaza | Sí (pytest) |
| AC-ADJ-006 | Tamaño máximo | adjuntos-y-actas.feature | Hay un tamaño máximo | Sí (pytest) |
| AC-ADJ-007 | El archivo se guarda íntegro | adjuntos-y-actas.feature | El archivo se guarda íntegro | Sí (pytest) |
| AC-ADJ-008 | Descarga con permiso y auditada | adjuntos-y-actas.feature | La descarga pasa por el sistema, no por una URL pública | Sí (pytest) |
| AC-ADJ-009 | Descarga sin ejecución en el navegador | adjuntos-y-actas.feature | La descarga no permite que el navegador ejecute el archivo | Sí (pytest) |
| AC-ADJ-010 | Fichero ausente informado | adjuntos-y-actas.feature | Un archivo que ya no está en el servidor se informa | Sí (pytest) |
| AC-ADJ-011 | Intervención de otro activo rechazada | adjuntos-y-actas.feature | Una intervención de otro equipo no se puede colgar de este activo | Sí (pytest) |
| AC-ADJ-012 | Eliminar borra el archivo | adjuntos-y-actas.feature | Eliminar un adjunto borra también el archivo | Sí (pytest) |
| AC-ADJ-013 | Eliminar exige permiso propio | adjuntos-y-actas.feature | Eliminar exige un permiso distinto de subir | Sí (pytest) |
| AC-ADJ-014 | La baja conserva los documentos | adjuntos-y-actas.feature | Dar de baja un activo no borra sus documentos | Sí (pytest) |
| AC-ACT-001 | Acta de entrega en PDF | adjuntos-y-actas.feature | La entrega de un equipo genera su acta en PDF | Sí (pytest) |
| AC-ACT-002 | Acta de devolución | adjuntos-y-actas.feature | La devolución genera un acta de devolución | Sí (pytest) |
| AC-ACT-003 | El acta parte del movimiento | adjuntos-y-actas.feature | El acta se construye desde el movimiento, no desde la ficha | Sí (pytest) |
| AC-ACT-004 | Solo entregas y devoluciones | adjuntos-y-actas.feature | Solo las entregas y devoluciones tienen acta | Sí (pytest) |
| AC-ACT-005 | Revisar sin archivar | adjuntos-y-actas.feature | El acta se puede revisar antes de archivarla | Sí (pytest) |
| AC-ACT-006 | Acta archivada en la ficha | adjuntos-y-actas.feature | El acta se archiva entre los documentos del equipo | Sí (pytest) |
| AC-ACT-007 | No se duplica el acta | adjuntos-y-actas.feature | Archivar dos veces no duplica el acta | Sí (pytest) |

## Centro de alertas (§19)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-ALE-001 | Alertas calculadas al vuelo | alertas.feature | Las alertas se calculan al consultarlas, no se almacenan | Sí (pytest) |
| AC-ALE-002 | Funciona sin configurar | alertas.feature | El centro responde aunque nadie lo haya configurado | Sí (pytest) |
| AC-ALE-003 | Umbrales únicos para la empresa | alertas.feature | Los umbrales son una decisión de la empresa, no de cada usuario | Sí (pytest) |
| AC-ALE-004 | Garantías por vencer | alertas.feature | Avisa de las garantías próximas a vencer | Sí (pytest) |
| AC-ALE-005 | Vencida no es «por vencer» | alertas.feature | Una garantía ya vencida no es un aviso con plazo | Sí (pytest) |
| AC-ALE-006 | Reparaciones sin cerrar | alertas.feature | Avisa de las reparaciones que llevan demasiado sin cerrar | Sí (pytest) |
| AC-ALE-007 | Custodio inactivo | alertas.feature | Avisa de los equipos cuyo responsable ya no está activo | Sí (pytest) |
| AC-ALE-008 | Activos parados en bodega | alertas.feature | Avisa de los activos parados en bodega | Sí (pytest) |
| AC-ALE-009 | Fichas sin actualizar | alertas.feature | Avisa de las fichas que nadie ha tocado en mucho tiempo | Sí (pytest) |
| AC-ALE-010 | Próximos a reemplazo por nivel | alertas.feature | Avisa de los equipos próximos a reemplazo, separando los niveles | Sí (pytest) |
| AC-ALE-011 | Demasiadas reparaciones aparte | alertas.feature | Avisa aparte de los equipos que se reparan demasiado | Sí (pytest) |
| AC-ALE-012 | Los de baja no alertan | alertas.feature | Un activo dado de baja no genera alertas | Sí (pytest) |
| AC-ALE-013 | Umbrales configurables | alertas.feature | Los umbrales son configurables | Sí (pytest) |
| AC-ALE-014 | Umbral en cero rechazado | alertas.feature | Un umbral en cero es rechazado | Sí (pytest) |
| AC-ALE-015 | Cada alerta se puede apagar | alertas.feature | Cada alerta se puede apagar | Sí (pytest) |
| AC-ALE-016 | Alerta en cero se reporta | alertas.feature | Una alerta sin pendientes se reporta igual | Sí (pytest) |
| AC-ALE-017 | Orden por gravedad | alertas.feature | Las alertas se ordenan por gravedad | Sí (pytest) |
| AC-ALE-018 | Muestra, no listado completo | alertas.feature | El resumen trae una muestra, no el listado completo | Sí (pytest) |
| AC-ALE-019 | Muestra sin repetidos | alertas.feature | La muestra no repite el mismo equipo | Sí (pytest) |
| AC-ALE-020 | Dos reparaciones, dos filas | alertas.feature | Dos reparaciones abiertas del mismo equipo son dos filas | Sí (pytest) |
| AC-ALE-021 | Enlaces al listado filtrado | alertas.feature | Los enlaces de cada alerta llevan al listado filtrado | No (verificado en navegador) |
| AC-ALE-022 | Ver exige permiso | alertas.feature | Ver las alertas exige permiso | Sí (pytest) |
| AC-ALE-023 | Configurar exige otro permiso | alertas.feature | Configurar exige un permiso distinto de ver | Sí (pytest) |
| AC-ALE-024 | Configuración auditada | alertas.feature | Cambiar la configuración queda auditado | Sí (pytest) |

## Notificaciones por correo (§19)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-NOT-001 | Envío apagado de fábrica | notificaciones-correo.feature | El envío llega apagado de fábrica | Sí (pytest) |
| AC-NOT-002 | Envía a los destinatarios | notificaciones-correo.feature | Envía el resumen a los destinatarios elegidos | Sí (pytest) |
| AC-NOT-003 | No duplica el mismo día | notificaciones-correo.feature | Dos pasadas el mismo día no duplican el correo | Sí (pytest) |
| AC-NOT-004 | Frecuencia semanal | notificaciones-correo.feature | La frecuencia semanal solo envía su día | Sí (pytest) |
| AC-NOT-005 | Día tranquilo sin correo | notificaciones-correo.feature | Un día sin nada pendiente no genera correo | Sí (pytest) |
| AC-NOT-006 | «Nada pendiente» opcional | notificaciones-correo.feature | Se puede pedir el correo aunque no haya pendientes | Sí (pytest) |
| AC-NOT-007 | Permiso revocado deja de recibir | notificaciones-correo.feature | Deja de recibir quien pierde el permiso de ver las alertas | Sí (pytest) |
| AC-NOT-008 | Cuenta de baja deja de recibir | notificaciones-correo.feature | Deja de recibir una cuenta dada de baja | Sí (pytest) |
| AC-NOT-009 | Sin datos de equipos ni personas | notificaciones-correo.feature | El correo no lleva datos de los equipos ni de las personas | Sí (pytest) |
| AC-NOT-010 | Direcciones en copia oculta | notificaciones-correo.feature | Las direcciones viajan en copia oculta | Sí (pytest) |
| AC-NOT-011 | Versión en texto plano | notificaciones-correo.feature | El correo tiene versión en texto plano | Sí (pytest) |
| AC-NOT-012 | Fallo registrado, se reintenta | notificaciones-correo.feature | Un envío fallido queda registrado y se reintenta mañana | Sí (pytest) |
| AC-NOT-013 | Cada pasada deja constancia | notificaciones-correo.feature | Cada pasada de la tarea deja constancia | Sí (pytest) |
| AC-NOT-014 | Prueba solo a quien la pide | notificaciones-correo.feature | El correo de prueba va solo a quien lo pide | Sí (pytest) |
| AC-NOT-015 | La prueba no sustituye el envío | notificaciones-correo.feature | La prueba no sustituye al envío del día | Sí (pytest) |
| AC-NOT-016 | Enviar exige configurar | notificaciones-correo.feature | Enviar correo exige el permiso de configurar | Sí (pytest) |
| AC-NOT-017 | No se activa sin destinatarios | notificaciones-correo.feature | No se activa el envío sin destinatarios | Sí (pytest) |
| AC-NOT-018 | Destinatario debe ver alertas | notificaciones-correo.feature | No se puede elegir como destinatario a quien no ve las alertas | Sí (pytest) |
| AC-NOT-019 | Último envío no editable | notificaciones-correo.feature | La fecha del último envío no se edita | Sí (pytest) |
| AC-NOT-020 | Candidatos con correo enmascarado | notificaciones-correo.feature | Los posibles destinatarios llegan con el correo enmascarado | Sí (pytest + Vitest) |
| AC-NOT-021 | Historial con omitidos y fallidos | notificaciones-correo.feature | El historial muestra también lo que no se envió | Sí (pytest + Vitest) |
| AC-NOT-022 | Prueba auditada | notificaciones-correo.feature | El envío de prueba queda auditado | Sí (pytest) |
| AC-NOT-023 | Avisa si el correo no sale | notificaciones-correo.feature | El sistema avisa cuando el correo no sale | Sí (pytest + Vitest) |
| AC-NOT-024 | El cron corre a diario | notificaciones-correo.feature | La tarea corre a diario y la configuración decide | Sí (pytest) |

## Legibilidad de los códigos (RF-08, §5)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-COD-001 | Code 128, no QR | legibilidad-etiquetas.feature | El identificador es un código de barras 1D, no un QR | Sí (pytest) |
| AC-COD-002 | Módulo mínimo legible | legibilidad-etiquetas.feature | La barra más fina no baja del mínimo legible | Sí (pytest) |
| AC-COD-003 | Módulo múltiplo del punto | legibilidad-etiquetas.feature | El ancho de módulo es múltiplo del punto de impresora | Sí (pytest) |
| AC-COD-004 | Zona muda | legibilidad-etiquetas.feature | El símbolo lleva zona muda a los lados | Sí (pytest) |
| AC-COD-005 | El código cabe | legibilidad-etiquetas.feature | El código del sistema cabe en la etiqueta que se usa | Sí (pytest) |
| AC-COD-006 | Aviso si no cabe | legibilidad-etiquetas.feature | Un código más largo avisa antes de imprimir el lote | Sí (pytest) |
| AC-COD-007 | PDF a tamaño real | legibilidad-etiquetas.feature | El PDF se emite a tamaño físico real | Sí (pytest) |
| AC-COD-008 | Texto bajo las barras | legibilidad-etiquetas.feature | El valor va también en texto bajo las barras | Sí (pytest, ver etiquetas-térmicas) |
| AC-COD-009 | Lectura con pistola HID | legibilidad-etiquetas.feature | La lectura funciona con cualquier pistola de teclado | No (verificado con lector real) |
| AC-COD-010 | Búsqueda por serie | legibilidad-etiquetas.feature | También se puede buscar por número de serie | Sí (pytest) |
| AC-COD-011 | Repara la distribución de teclado | legibilidad-etiquetas.feature | Un código escaneado con otra distribución de teclado se resuelve igual | Sí (pytest) |
| AC-COD-012 | Avisa de la mala configuración | legibilidad-etiquetas.feature | Y avisa de que la pistola está mal configurada | Sí (pytest) |
| AC-COD-013 | No toca los números de serie | legibilidad-etiquetas.feature | La reparación no toca los números de serie | Sí (pytest) |

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
| AC-ETI-008 | La etiqueta se emite en QR | etiquetas-termicas.feature | La etiqueta se emite en QR cuando se pide | Sí (pytest: `test_zpl_emite_un_qr_cuando_se_pide`, `test_tspl_emite_un_qr_cuando_se_pide`, `test_el_pdf_sale_en_las_dos_simbologias`, `test_el_codigo_legible_sigue_debajo_en_ambas`; Vitest: `la etiqueta se puede emitir en QR`) |
| AC-ETI-009 | Por defecto, Code 128 | etiquetas-termicas.feature | Sin elegir nada se imprime el código de barras | Sí (pytest: `test_zpl_sigue_emitiendo_code128_por_defecto`, `test_tspl_sigue_emitiendo_code128_por_defecto`) |
| AC-ETI-010 | Se avisa del lector que hace falta | etiquetas-termicas.feature | Se avisa de que una pistola láser no lee un QR | Sí (Vitest: `avisa de que una pistola láser no lee un QR`) |
| AC-ETI-011 | Sin medición en QR | etiquetas-termicas.feature | Con QR no se ofrece la comprobación de legibilidad | Sí (Vitest: `con QR no se enseña la medición, que es de barras`) |
| AC-ETI-008 | Descarga en PDF | etiquetas-termicas.feature | La etiqueta se descarga en PDF | **Sí (pytest-bdd)** |
| AC-ETI-009 | PDF a tamaño físico real | etiquetas-termicas.feature | El PDF conserva el tamaño físico de la etiqueta | Sí (pytest) |
| AC-ETI-010 | Vista previa antes de imprimir | etiquetas-termicas.feature | La etiqueta se puede revisar antes de imprimirla | Sí (pytest) |

## Rendimiento (§21)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-PERF-001 | Inventario rápido con filtros | rendimiento.feature | El inventario responde rápido con filtros combinados | Medido (`manage.py medir_rendimiento`) |
| AC-PERF-002 | Sin consulta por activo | rendimiento.feature | Evaluar el parque no cuesta una consulta por activo | Sí (pytest) |
| AC-PERF-003 | Políticas en dos consultas | rendimiento.feature | Las políticas de todos los tipos se resuelven juntas | Sí (pytest) |
| AC-PERF-004 | El prefiltro no esconde nada | rendimiento.feature | El prefiltro no esconde equipos que sí hay que renovar | Sí (pytest) |
| AC-PERF-005 | Resumen cacheado | rendimiento.feature | El resumen del parque se cachea | Sí (pytest) |
| AC-PERF-006 | Configuración inmediata | rendimiento.feature | Cambiar la configuración se ve de inmediato | Sí (pytest) |

## Arquitectura

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-008 | Backend y frontend separados | acceptance-criteria.feature | Backend y frontend están separados | Sí (pytest: `test_backend_y_frontend_son_proyectos_independientes`, `test_el_backend_no_sirve_la_interfaz`) |
| AC-009 | Backend usa Python y Django | acceptance-criteria.feature | El backend usa Python y Django | Sí (pytest: `test_el_backend_usa_django`) |
| AC-010 | Usa SQL Server | acceptance-criteria.feature | El proyecto usa SQL Server | Sí (pytest, ver AC-040) |
| AC-011 | Patrón MVT | acceptance-criteria.feature | El backend mantiene el patrón Modelo Vista Template | Sí (pytest: `test_cada_app_separa_el_modelo_de_la_vista`, `test_las_reglas_de_negocio_viven_en_su_capa`, `test_las_vistas_no_escriben_en_la_base_directamente`) |
| AC-012 | Frontend usa React | acceptance-criteria.feature | El frontend usa React | Sí (pytest: `test_el_frontend_usa_react`) |
| AC-013 | Node.js gestiona deps frontend | acceptance-criteria.feature | Node.js administra las dependencias del frontend | Sí (pytest: `test_node_administra_las_dependencias`) |
| AC-014 | Bootstrap framework visual | acceptance-criteria.feature | Bootstrap es el framework visual principal | Sí (pytest: `test_bootstrap_es_el_framework_visual`) |
| AC-015 | Templates y estilos separados | acceptance-criteria.feature | Templates y estilos están separados | Sí (pytest: `test_ningun_componente_lleva_estilos_embebidos_extensos`, `test_no_hay_hojas_de_estilo_dentro_del_jsx`, `test_los_componentes_con_estilos_los_tienen_al_lado`) |

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
| AC-025 | Sin credenciales reales versionadas | repository-hygiene.feature | No existen credenciales reales versionadas | Sí (pytest: `test_ningun_archivo_versionado_lleva_un_secreto_real`, `test_los_env_estan_excluidos_del_control_de_versiones`) |
| AC-026 | `.env.example` seguro existe | repository-hygiene.feature | Existen archivos .env.example seguros | Sí (pytest: `test_existe_el_ejemplo_de_entorno`, `test_el_ejemplo_solo_lleva_marcadores`) |

## Copias de seguridad (§21)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-BAK-001 | Respalda también los adjuntos | respaldos.feature | El respaldo incluye los adjuntos, no solo la base | Sí (pytest) |
| AC-BAK-002 | No informa lo que no se escribió | respaldos.feature | Un respaldo que no se escribió no se informa como correcto | Sí (pytest) |
| AC-BAK-003 | Verificación de integridad | respaldos.feature | El respaldo se verifica antes de darlo por bueno | Sí (verificado contra SQL Server real) |
| AC-BAK-004 | Manifiesto del contenido | respaldos.feature | Cada respaldo lleva un manifiesto de lo que contenía | Sí (pytest) |
| AC-BAK-009 | El cuándo se configura en la aplicación | respaldos.feature | El cuándo se decide en la aplicación, no en el servidor | Sí (pytest: `test_la_politica_se_lee_y_se_corrige`, `test_semanal_solo_su_dia`; Vitest: `guarda la frecuencia, la hora y la carpeta`) |
| AC-BAK-010 | Solo cuando toca | respaldos.feature | Solo respalda cuando toca | Sí (pytest: `test_diaria_toca_pasada_la_hora`, `test_no_se_repite_el_mismo_dia`, `test_si_toca_dice_por_que_no_toca`, `test_cuando_toca_respalda_y_lo_anota`) |
| AC-BAK-011 | Apagado no respalda | respaldos.feature | Apagado no respalda nada | Sí (pytest: `test_apagado_no_toca_nunca`, `test_si_toca_no_hace_nada_con_el_respaldo_apagado`; Vitest: `apagado, lo dice en vez de anunciar un próximo que no ocurrirá`) |
| AC-BAK-012 | Retención | respaldos.feature | Los respaldos viejos se retiran | Sí (pytest: `test_se_retiran_los_respaldos_viejos`) |
| AC-BAK-013 | A mano no cuenta | respaldos.feature | Un respaldo a mano no cuenta como el programado | Sí (pytest: `test_a_mano_no_cuenta_como_el_programado`) |
| AC-BAK-014 | Último y próximo a la vista | respaldos.feature | La pantalla dice cuándo fue el último y cuándo es el próximo | Sí (pytest: `test_la_pantalla_dice_cuando_sera_el_proximo`; Vitest: `muestra cuándo fue el último y cuándo toca el próximo, en hora del sistema`) |
| AC-BAK-015 | La política queda auditada | respaldos.feature | Cambiar la política queda auditado | Sí (pytest: `test_el_cambio_queda_auditado`) |
| AC-BAK-016 | Configurar el respaldo es su propio permiso | respaldos.feature | Configurar el respaldo es su propio permiso | Sí (pytest: `test_configurar_la_apariencia_no_habilita_a_cambiar_el_respaldo`, `test_pero_sí_a_leerla`, `test_con_el_permiso_propio_se_cambia`; Vitest: `configurar la apariencia no habilita a cambiar el respaldo`) |
| AC-BAK-017 | La hora es la local | respaldos.feature | La hora configurada es la hora local | Sí (pytest: `test_la_hora_es_la_local_y_no_utc`, `test_la_pantalla_dice_cuando_sera_el_proximo`; Vitest: `muestra cuándo fue el último y cuándo toca el próximo, en hora del sistema`) |
| AC-BAK-018 | Varios días y varias horas | respaldos.feature | Varios días y varias horas | Sí (pytest: `test_varias_horas_al_dia_hacen_varios_respaldos`, `test_turnos_perdidos_se_cubren_con_uno_solo`, `test_solo_los_dias_elegidos`, `test_el_proximo_salta_los_dias_no_elegidos`; Vitest: `guarda los días y varias horas`) |
| AC-BAK-019 | Respaldar ahora | respaldos.feature | Respaldar ahora desde la pantalla | Sí (pytest: `test_respaldar_ahora_deja_la_orden_y_queda_auditado`, `test_pedirlo_dos_veces_no_hace_dos`, `test_lo_pedido_desde_la_pantalla_se_hace_aunque_este_apagado`, `test_respaldar_ahora_exige_el_permiso_de_respaldos`; Vitest: `deja la orden y dice cuánto tarda en empezar`, `avisa cuando la tarea lo terminó`) |
| AC-BAK-020 | El fallo se ve | respaldos.feature | Un respaldo fallido se ve en la pantalla | Sí (pytest: `test_un_fallo_queda_anotado`; Vitest: `si el último falló, lo dice con el motivo`) |
| AC-BAK-021 | Horario imposible | respaldos.feature | Un horario imposible se rechaza | Sí (pytest: `test_un_horario_imposible_se_rechaza`) |
| AC-BAK-022 | Los respaldos en disco a la vista | respaldos.feature | Los respaldos en disco se ven en la pantalla | Sí (pytest: `test_lista_los_respaldos_del_mas_reciente_al_mas_antiguo`, `test_un_bak_sin_manifiesto_tambien_se_lista`, `test_sin_la_carpeta_de_la_base_se_dice`; Vitest: `lista los respaldos con su tamaño y lo que incluyen`, `sin la carpeta de la base montada, avisa que la copia queda en el servidor`) |
| AC-BAK-023 | Borrar un respaldo entero | respaldos.feature | Borrar un respaldo lo quita entero y queda auditado | Sí (pytest: `test_borrar_quita_todos_sus_archivos_y_queda_auditado`, `test_una_marca_rara_no_borra_nada`, `test_ver_la_configuracion_no_basta_para_borrar`; Vitest: `borrar pide confirmación y después borra ese respaldo`) |
| AC-BAK-024 | El más reciente se conserva | respaldos.feature | El respaldo más reciente no se puede borrar | Sí (pytest: `test_el_mas_reciente_no_se_borra`; Vitest: `el más reciente no se puede borrar, y dice por qué`) |
| AC-BAK-005 | Detecta restauración incompleta | respaldos.feature | La comparación detecta una restauración incompleta | Sí (pytest) |
| AC-BAK-006 | Ruta validada | respaldos.feature | La ruta del respaldo se valida antes de usarla | Sí (pytest) |
| AC-BAK-007 | Avisa si no hay respaldos | respaldos.feature | La revisión de despliegue avisa si no hay respaldos | Sí (pytest) |
| AC-BAK-008 | Manifiesto corrupto tolerado | respaldos.feature | Un manifiesto corrupto no rompe la revisión | Sí (pytest) |

## Puesta en marcha (§13, §21)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-PUE-001 | Los cuatro roles del §13 | puesta-en-marcha.feature | El sistema trae los cuatro roles del documento | Sí (pytest) |
| AC-PUE-002 | Soporte no da de baja | puesta-en-marcha.feature | Soporte no puede dar de baja un activo | Sí (pytest) |
| AC-PUE-003 | Soporte no borra evidencia | puesta-en-marcha.feature | Soporte no puede borrar evidencia | Sí (pytest) |
| AC-PUE-004 | El supervisor no opera | puesta-en-marcha.feature | El supervisor aprueba pero no opera | Sí (pytest) |
| AC-PUE-005 | Consulta es de solo lectura | puesta-en-marcha.feature | El rol de consulta no modifica nada | Sí (pytest) |
| AC-PUE-006 | Plantilla, no imposición | puesta-en-marcha.feature | Los roles son una plantilla, no una imposición | Sí (pytest) |
| AC-PUE-007 | Detecta DEBUG | puesta-en-marcha.feature | La revisión previa detecta DEBUG encendido | Sí (pytest) |
| AC-PUE-008 | Detecta el correo falso | puesta-en-marcha.feature | La revisión avisa de que el correo no sale de verdad | Sí (pytest) |
| AC-PUE-009 | Detecta cron caído | puesta-en-marcha.feature | La revisión detecta tareas programadas que no corren | No (verificado a mano) |
| AC-PUE-010 | Recuerda el inventario | puesta-en-marcha.feature | La revisión recuerda el inventario inicial | Sí (pytest) |

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

## Registro de auditoría (AC-AUD-xxx)

Leerlo desde el panel. Que cada operación quede registrada y no se pueda
alterar se cubre en la sección de autorización.

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-AUD-001 | El registro se lee desde el panel | auditoria.feature | El registro se lee desde el panel | Sí (Vitest: `lista qué se hizo, quién lo hizo y con qué resultado`) |
| AC-AUD-002 | Se busca por la persona | auditoria.feature | Se busca por la persona, no por su número | Sí (pytest: `test_se_filtra_por_el_nombre_de_quien_lo_hizo`, `test_el_nombre_parcial_basta`, `test_sin_el_filtro_salen_todos`; Vitest: `los filtros se envían al confirmar, no en cada tecla`) |
| AC-AUD-003 | Sin autor es el sistema | auditoria.feature | Un evento sin autor se atribuye al sistema | Sí (Vitest: `un evento sin autor se atribuye al sistema, no se deja en blanco`) |
| AC-AUD-004 | El detalle enseña el cambio | auditoria.feature | El detalle enseña el antes y el después | Sí (Vitest: `el detalle enseña el antes y el después del cambio`) |
| AC-AUD-005 | Sin permiso de detalle no se ofrece | auditoria.feature | Sin permiso de detalle no se ofrece abrirlo | Sí (Vitest: `sin permiso de detalle no se ofrece abrirlo`; en el servidor, `AuditLogSerializer` ya retira esos campos) |
| AC-AUD-006 | Sin permiso de exportar no se ofrece | auditoria.feature | Sin permiso de exportar no se ofrece exportar | Sí (Vitest: `sin permiso de exportar no se ofrece el botón`) |
| AC-AUD-007 | Lo exportado es lo que se ve | auditoria.feature | Lo exportado es lo que se está viendo | Sí (Vitest: `lo que se exporta es lo que se está viendo`) |
| AC-AUD-008 | El auditor llega a la pantalla | auditoria.feature | Un auditor sin acceso a usuarios llega igual a la pantalla | Sí (Vitest: `un auditor sin acceso a usuarios igual llega a Auditoría`, `quien administra usuarios pero no audita no ve Auditoría`) |

## Base de datos

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-040 | Migraciones funcionan con SQL Server | acceptance-criteria.feature | Las migraciones funcionan con SQL Server | Sí (ejecución real, ver test-execution-report.md) |
| AC-041 | Relaciones válidas usuarios/roles/permisos | acceptance-criteria.feature | Existen relaciones válidas entre usuarios, roles y permisos | Sí (implícito: toda la suite pytest usa estas relaciones) |
| AC-042 | Restricciones de unicidad | acceptance-criteria.feature | Se aplican restricciones de unicidad | Sí (pytest: `test_admin_cannot_create_user_with_duplicate_email`) |
| AC-043 | Sin datos productivos en el repo | acceptance-criteria.feature | No existen datos productivos dentro del repositorio | Sí (pytest: `test_ninguna_migracion_siembra_personas_ni_equipos`, `test_ninguna_migracion_fija_una_contrasena`) |
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
| AC-JWT-002 | Se cierra tras cuatro horas sin usarla | jwt-security.feature | La sesión se cierra tras cuatro horas sin usarla | Sí (pytest: `test_a_las_cuatro_horas_sin_usarla_se_cierra`, `test_el_plazo_es_configurable`; Vitest: `la sesión cerrada por inactividad va al login diciendo por qué`, `dice cuándo la sesión se cerró por inactividad`) |
| AC-JWT-003 | Volver antes del plazo lo reinicia | jwt-security.feature | Volver antes del plazo lo reinicia | Sí (pytest: `test_justo_antes_del_plazo_sigue_viva`, `test_usarla_reinicia_la_cuenta`, `test_no_se_escribe_en_cada_peticion`, `test_pero_sí_pasado_el_margen`) |
| AC-JWT-004 | Renovar no es actividad | jwt-security.feature | Renovar el token no cuenta como actividad | Sí (pytest: `test_renovar_el_token_no_cuenta_como_actividad`; Vitest: `y no intenta renovar antes: el servidor ya la cerró`) |
| AC-JWT-005 | La vencida se cierra, no solo se rechaza | jwt-security.feature | La sesión vencida se cierra, no solo se rechaza | Sí (pytest: `test_y_se_cierra_de_verdad_no_solo_se_rechaza`, `test_pasado_el_plazo_tampoco_se_renueva`) |

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
| AC-USR-010 | El usuario sale del nombre | users.feature | El nombre de usuario se compone del nombre de la persona | Sí (pytest: `test_la_base_sale_del_nombre_sin_tildes_ni_enies`, `test_admin_creates_user_successfully`) |
| AC-USR-011 | Sin tildes ni eñes | users.feature | Sin tildes ni eñes | Sí (pytest: `test_la_base_sale_del_nombre_sin_tildes_ni_enies`) |
| AC-USR-012 | El repetido lleva número | users.feature | El segundo con el mismo nombre lleva número | Sí (pytest: `test_el_segundo_con_el_mismo_nombre_lleva_numero`) |
| AC-USR-013 | El usuario no se escribe | users.feature | El nombre de usuario no se escribe | Sí (Vitest: `muestra el nombre de usuario que le va a tocar`, `no manda el nombre de usuario`; por diseño en `UserAdminCreateSerializer`, sin campo `username`) |
| AC-USR-014 | El listado dice cuándo entró cada cuenta | users.feature | El listado dice cuándo entró cada cuenta | Sí (pytest: `test_el_inicio_de_sesion_anota_la_ultima_conexion`, `test_el_listado_dice_cuando_entro_cada_cuenta`; Vitest: `dice cuándo entró cada cuenta por última vez`) |
| AC-USR-015 | La que nunca entró lo dice | users.feature | La cuenta que nunca entró lo dice | Sí (pytest: `test_la_cuenta_que_nunca_entro_lo_dice_con_un_nulo`, `test_el_intento_fallido_no_cuenta_como_conexion`; Vitest: `la cuenta que nunca entró lo dice, en vez de dejarlo en blanco`) |
| AC-USR-016 | Renovar no es volver a entrar | users.feature | Renovar la sesión no cuenta como volver a entrar | Sí (pytest: `test_renovar_el_token_no_mueve_la_ultima_conexion`) |

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

## Separación por empresas (AC-EMP-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-EMP-001 | Una empresa no ve el inventario de otra | multiempresa.feature | Una empresa no ve el inventario de otra | Sí (pytest: `test_aislamiento.py`) |
| AC-EMP-002 | Los catálogos también están separados | multiempresa.feature | Los catálogos también están separados | Sí (pytest: `test_aislamiento.py`) |
| AC-EMP-003 | Lo registrado nace en la empresa activa | multiempresa.feature | Lo que se registra nace en la empresa activa | Sí (pytest: `test_aislamiento.py`) |
| AC-EMP-004 | Pedir una empresa ajena no muestra nada | multiempresa.feature | Pedir una empresa ajena no muestra nada | Sí (pytest: `test_aislamiento.py`) |
| AC-EMP-005 | Unicidad dentro de cada empresa | multiempresa.feature | Los identificadores únicos lo son dentro de cada empresa | Sí (pytest: `test_aislamiento.py`) |
| AC-EMP-006 | Ver empresas exige permiso | multiempresa.feature | Ver las empresas exige un permiso del catálogo | Sí (pytest: `test_sin_permiso_no_se_listan_las_empresas`) |
| AC-EMP-007 | Ver no alcanza para crear | multiempresa.feature | Ver no alcanza para crear | Sí (pytest: `test_ver_no_alcanza_para_crear`) |
| AC-EMP-008 | El alta queda auditada | multiempresa.feature | El alta de una empresa queda auditada | Sí (pytest: `test_se_crea_la_empresa_y_queda_auditada`) |
| AC-EMP-009 | La empresa se desactiva, no se elimina | multiempresa.feature | Una empresa no se elimina, se desactiva | Sí (pytest: `test_la_empresa_no_se_puede_eliminar`, `test_desactivar_la_saca_del_selector_sin_borrar_nada`) |
| AC-EMP-010 | Asignar empresas es un permiso aparte | multiempresa.feature | Asignar empresas no es administrar usuarios | Sí (pytest: `test_administrar_usuarios_no_alcanza_para_asignar_empresas`) |
| AC-EMP-011 | La asignación reemplaza la lista | multiempresa.feature | La asignación reemplaza la lista completa | Sí (pytest: `test_la_asignacion_reemplaza_la_lista_entera`) |
| AC-EMP-012 | Solo una empresa predeterminada | multiempresa.feature | Solo una empresa puede ser la predeterminada | Sí (pytest: `test_solo_una_empresa_puede_ser_la_predeterminada`, `test_una_empresa_repetida_en_la_asignacion_se_rechaza`) |
| AC-EMP-013 | Nadie se deja a sí mismo sin empresas | multiempresa.feature | Nadie puede dejarse a sí mismo sin empresas | Sí (pytest: `test_nadie_puede_dejarse_a_si_mismo_sin_empresas`) |
| AC-EMP-014 | El reparto de accesos queda auditado | multiempresa.feature | El reparto de accesos queda auditado | Sí (pytest: `test_se_asignan_las_dos_empresas_y_queda_auditado`) |
| AC-EMP-015 | El selector no exige permisos | multiempresa.feature | Saber en qué empresa se está no exige permisos | Sí (pytest: `test_el_selector_no_exige_permisos_del_catalogo`) |
| AC-EMP-016 | Con una sola empresa no hay desplegable | multiempresa.feature | Con una sola empresa el selector no estorba | Sí (Vitest: `SelectorEmpresa`) |
| AC-EMP-017 | Membresía obligatoria desde la segunda empresa | multiempresa.feature | Mientras hay una sola empresa la membresía no es obligatoria | Sí (pytest: `test_aislamiento.py`, `test_a_otro_si_se_le_pueden_quitar_todas`) |
| AC-EMP-018 | Un rol vale solo en su empresa | multiempresa.feature | Un rol vale solo en la empresa donde se dio | Sí (pytest: `test_un_rol_vale_solo_en_la_empresa_donde_se_dio`) |
| AC-EMP-019 | Cada empresa con su propio rol | multiempresa.feature | Cada empresa puede tener su propio rol | Sí (pytest: `test_cada_empresa_puede_tener_su_propio_rol`; Vitest: `AsignacionEmpresas`) |
| AC-EMP-020 | Los roles globales valen en todas | multiempresa.feature | Los roles globales valen en todas las empresas | Sí (pytest: `test_los_roles_globales_valen_en_todas_las_empresas`) |
| AC-EMP-021 | Quitar la empresa se lleva sus roles | multiempresa.feature | Quitar la empresa se lleva sus roles | Sí (pytest: `test_quitar_la_empresa_se_lleva_sus_roles`) |
| AC-EMP-022 | Empresa sin rol no da acceso | multiempresa.feature | Una empresa asignada sin rol no da acceso a nada | Sí (pytest: `test_un_rol_vale_solo_en_la_empresa_donde_se_dio`; Vitest: `avisa si una empresa queda asignada sin ningún rol`) |
| AC-EMP-023 | El historial nombra rol y empresa | multiempresa.feature | El historial dice qué rol se quitó y en qué empresa | Sí (pytest: `test_la_auditoria_registra_el_rol_y_la_empresa`) |
| AC-EMP-024 | El alta pide empresa y rol | multiempresa.feature | El alta pregunta con qué empresa y qué rol entra la cuenta | Sí (pytest: `test_el_alta_deja_al_usuario_dentro_de_su_empresa_con_su_rol`; Vitest: `UserFormAlta`) |
| AC-EMP-025 | Crear no alcanza para dar empresa | multiempresa.feature | Crear usuarios no alcanza para darles empresa | Sí (pytest: `test_crear_usuarios_no_alcanza_para_darles_empresa`; Vitest: `sin el permiso de asignar no se pregunta empresa ni rol`) |
| AC-EMP-026 | Lo que cuelga de un activo tampoco cruza | multiempresa.feature | Lo que cuelga de un activo tampoco cruza empresas | Sí (pytest: `test_la_bitacora_de_mantenimientos_no_cruza_empresas`, `test_el_historial_de_movimientos_no_cruza_empresas`) |
| AC-TMP-010 | Hasta un mes, en días | tiempos-del-activo.feature | Hasta un mes, la duración se dice en días | Sí (pytest: `test_duracion.py`; Vitest: `formatearDias`) |
| AC-TMP-011 | Pasado el mes, en meses y días | tiempos-del-activo.feature | Pasado el mes, en meses y días | Sí (pytest: `test_duracion.py`; Vitest: `formatearDias`) |
| AC-TMP-012 | Pasado el año, en años, meses y días | tiempos-del-activo.feature | Pasado el año, en años, meses y días | Sí (pytest: `test_duracion.py`; Vitest: `formatearDias`, `TiemposDelActivo`) |
| AC-TMP-013 | La antigüedad sigue la misma regla | tiempos-del-activo.feature | La antigüedad sigue la misma regla | Sí (pytest: `test_la_antiguedad_se_dice_en_anios_pasado_el_ano`; Vitest: `formatearMeses`) |

## Hallazgos de seguridad, 10 de septiembre de 2026 (AC-SEC-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-SEC-001 | La clave de demostración no está en el código | hallazgos-de-seguridad.feature | La clave de las cuentas de demostración no vive en el código | Sí (pytest: `test_sembrar_datos_demo.py`; por diseño en `clave_demo()`) |
| AC-SEC-002 | Las cuentas de demostración cambian la clave al entrar | hallazgos-de-seguridad.feature | Las cuentas de demostración obligan a cambiar la contraseña | Sí (pytest: `test_sembrar_datos_demo.py`) |
| AC-SEC-003 | El despliegue se detiene si quedan | hallazgos-de-seguridad.feature | El despliegue se detiene si quedan cuentas de demostración | Sí (pytest: `verificar_despliegue`, comprobado en la base real) |
| AC-SEC-004 | Sin registro público | hallazgos-de-seguridad.feature | Nadie se da de alta a sí mismo | Sí (pytest: `test_el_registro_publico_ya_no_existe`) |
| AC-SEC-005 | Alertas en todas las empresas | hallazgos-de-seguridad.feature | El centro de alertas responde en todas las empresas | Sí (pytest: `test_el_centro_de_alertas_responde_en_las_dos_empresas`) |
| AC-SEC-006 | Un resumen por empresa | hallazgos-de-seguridad.feature | El resumen diario sale una vez por empresa | Sí (pytest: `test_el_resumen_diario_sale_una_vez_por_empresa`) |
| AC-SEC-007 | La auditoría no cruza empresas | hallazgos-de-seguridad.feature | La auditoría no cruza empresas | Sí (pytest: `test_la_auditoria_no_muestra_lo_de_la_otra_empresa`) |
| AC-SEC-008 | Los huérfanos no se cuelan | hallazgos-de-seguridad.feature | Un evento huérfano no se cuela por la puerta de atrás | Sí (pytest: `test_un_evento_huerfano_de_otro_modulo_no_se_cuela`) |
| AC-SEC-009 | Usuarios acotados por empresa | hallazgos-de-seguridad.feature | El listado de usuarios no muestra al personal de la otra empresa | Sí (pytest: `test_el_listado_de_usuarios_no_muestra_los_de_la_otra_empresa`) |
| AC-SEC-010 | Nadie concede lo que no tiene | hallazgos-de-seguridad.feature | Nadie concede un permiso que no tiene | Sí (pytest: `test_no_se_puede_conceder_un_permiso_que_no_se_tiene`, `test_el_superusuario_no_tiene_ese_tope`) |
| AC-SEC-011 | Exportaciones sin fórmulas | hallazgos-de-seguridad.feature | Un valor del inventario no se vuelve fórmula al abrir el archivo | Sí (pytest: `test_hojas_de_calculo.py`, 11 casos) |
| AC-SEC-012 | Content-Security-Policy en toda respuesta | hallazgos-de-seguridad.feature | Toda respuesta declara su política de contenido | Sí (pytest: `test_csp.py`) |
| AC-SEC-013 | Ruta de respaldo por forma admitida | hallazgos-de-seguridad.feature | La ruta de respaldo se valida por forma admitida | Sí (pytest: `test_respaldos.py`) |

## Corrección de intervenciones (AC-MNT-020 a AC-MNT-029)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-MNT-020 | Corregir un dato no toca los demás | mantenimientos.feature | Corregir un dato no toca los demás | Sí (pytest: `test_corregir_un_campo_deja_los_demas_intactos`) |
| AC-MNT-021 | Guardar sin cambios no audita | mantenimientos.feature | Guardar sin cambiar nada no escribe en la bitácora | Sí (pytest: `test_guardar_sin_cambiar_nada_no_escribe_en_la_bitacora`) |
| AC-MNT-022 | La intervención no cambia de equipo | mantenimientos.feature | Una intervención no cambia de equipo | Sí (pytest: `test_el_mantenimiento_no_cambia_de_activo`) |
| AC-MNT-023 | Los repuestos reemplazan, no suman | mantenimientos.feature | Los repuestos enviados reemplazan el desglose entero | Sí (pytest: `test_enviar_componentes_reemplaza_el_desglose_entero`, `test_el_desglose_se_puede_vaciar`) |
| AC-MNT-024 | Corregir repuestos recalcula el contador | mantenimientos.feature | Corregir los repuestos recalcula el contador de piezas críticas | Sí (pytest: `test_quitar_la_pieza_critica_baja_el_contador_del_activo`, `test_anadir_una_pieza_critica_sube_el_contador`) |
| AC-MNT-025 | La línea nueva fotografía la criticidad vigente | mantenimientos.feature | La línea nueva fotografía la criticidad vigente | Sí (pytest: `test_la_linea_nueva_fotografia_la_criticidad_de_hoy`) |
| AC-MNT-026 | Cerrar al corregir calcula los días fuera | mantenimientos.feature | Cerrar la reparación al corregir calcula los días fuera | Sí (pytest: `test_poner_la_fecha_de_salida_cierra_la_reparacion`) |
| AC-MNT-027 | Las validaciones valen al corregir | mantenimientos.feature | Las validaciones siguen valiendo al corregir | Sí (pytest: tres casos de fecha más `test_un_componente_inexistente_no_borra_el_desglose`) |
| AC-MNT-028 | Registrar no alcanza para corregir | mantenimientos.feature | Registrar no alcanza para corregir | Sí (pytest: `test_registrar_no_alcanza_para_corregir`, `test_con_el_permiso_de_editar_si_se_corrige`) |
| AC-MNT-029 | Eliminar deja constancia | mantenimientos.feature | Eliminar deja constancia de lo que había | Sí (pytest: `test_eliminar_deja_constancia_de_lo_que_habia`, `test_al_eliminar_se_van_tambien_sus_repuestos`, `test_los_indicadores_del_activo_quedan_al_dia_en_la_misma_operacion`) |
| AC-EMP-027 | Todo modelo declara cómo se acota | multiempresa.feature | Todo modelo de negocio declara cómo se acota | Sí (pytest: `test_todo_modelo_de_negocio_se_acota_por_empresa`, parametrizado sobre cada modelo) |
| AC-EMP-028 | La ruta llega hasta la empresa | multiempresa.feature | La ruta declarada llega de verdad hasta la empresa | Sí (pytest: `test_la_ruta_declarada_llega_de_verdad_hasta_la_empresa`) |
| AC-EMP-029 | La lista de excepciones no envejece | multiempresa.feature | La lista de excepciones no envejece | Sí (pytest: `test_la_lista_de_excepciones_no_envejece`, `test_cada_excepcion_dice_por_que`) |

## Características por tipo de dispositivo (AC-CAR-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-CAR-001 | Cada tipo declara las suyas | ficha-completa-activo.feature | Cada tipo declara lo que se describe de sus equipos | Sí (pytest: `test_cada_tipo_declara_las_suyas`) |
| AC-CAR-002 | Sin repetidas dentro del tipo | ficha-completa-activo.feature | No se repite una característica dentro del mismo tipo | Sí (pytest: `test_no_se_repite_una_caracteristica_dentro_del_mismo_tipo`) |
| AC-CAR-003 | El mismo nombre vale en dos tipos | ficha-completa-activo.feature | El mismo nombre vale en dos tipos distintos | Sí (pytest: `test_el_mismo_nombre_si_vale_en_dos_tipos`) |
| AC-CAR-004 | Cada dato se pide como lo que es | ficha-completa-activo.feature | Cada dato se pide como lo que es | Sí (pytest: `test_el_valor_se_normaliza_al_tipo_declarado`, `test_el_si_o_no_acepta_como_lo_escribe_la_gente`; Vitest: `EspecificacionesDelTipo`) |
| AC-CAR-005 | Una lista necesita opciones | ficha-completa-activo.feature | Una lista de opciones necesita opciones | Sí (pytest: `test_una_lista_de_opciones_necesita_opciones`) |
| AC-CAR-006 | Las opciones se limpian | ficha-completa-activo.feature | Las opciones se limpian al guardarlas | Sí (pytest: `test_las_opciones_se_limpian_al_guardarlas`) |
| AC-CAR-007 | Renombrar arrastra lo guardado | ficha-completa-activo.feature | Renombrar una característica arrastra lo ya guardado | Sí (pytest: `test_renombrarla_arrastra_lo_ya_guardado`) |
| AC-CAR-008 | Sin características, pares libres | ficha-completa-activo.feature | Un tipo sin características admite pares libres | Sí (pytest: `test_un_tipo_sin_caracteristicas_admite_pares_libres`) |
| AC-CAR-009 | Lo no declarado se rechaza | ficha-completa-activo.feature | Lo que el tipo no describe se rechaza | Sí (pytest: `test_lo_que_el_tipo_no_describe_se_rechaza`) |
| AC-CAR-010 | La obligatoria se exige, con el mensaje útil | ficha-completa-activo.feature | Una característica obligatoria se exige | Sí (pytest: `test_la_caracteristica_obligatoria_se_exige`, `test_un_valor_invalido_en_una_obligatoria_dice_qué_tiene_de_malo`) |
| AC-CAR-011 | Desactivarla no borra lo capturado | ficha-completa-activo.feature | Una característica que se deja de pedir no borra lo capturado | Sí (pytest: `test_una_caracteristica_desactivada_deja_de_pedirse`) |
| AC-CAR-012 | El equipo antiguo conserva lo suyo | ficha-completa-activo.feature | Un equipo antiguo conserva lo que traía | Sí (pytest: `test_el_equipo_antiguo_conserva_lo_que_ya_tenia`; Vitest: `muestra aparte lo que el equipo traía de antes`) |
| AC-CAR-013 | El tipo se crea ya descrito | ficha-completa-activo.feature | El tipo se crea ya descrito | Sí (pytest: `test_el_tipo_se_crea_ya_descrito`, `test_las_declaradas_en_el_alta_dejan_el_mismo_rastro`; Vitest: `un tipo nuevo se describe en el mismo formulario`, `las características declaradas en el alta viajan con el tipo`) |
| AC-CAR-014 | El alta es atómica | ficha-completa-activo.feature | El tipo y lo que describe entran juntos o no entra ninguno | Sí (pytest: `test_una_caracteristica_rechazada_no_deja_el_tipo_a_medias`) |
| AC-CAR-015 | Sin repetidas en el mismo formulario | ficha-completa-activo.feature | Dos características del mismo formulario no pueden llamarse igual | Sí (pytest: `test_dos_del_mismo_lote_no_pueden_llamarse_igual`; Vitest: `dos declaradas con el mismo nombre se avisan al momento`) |
| AC-CAR-016 | Un tipo existente se describe de a una | ficha-completa-activo.feature | Describir un tipo que ya existe se hace de a una | Sí (pytest: `test_describir_un_tipo_que_ya_existe_se_hace_de_a_una`) |
| AC-CAR-017 | Texto ampliado | ficha-completa-activo.feature | Una característica puede pedirse como texto ampliado | Sí (pytest: `test_el_texto_ampliado_conserva_los_renglones`; Vitest: `el texto ampliado se escribe en varios renglones`) |
| AC-CAR-018 | El texto ampliado tiene tope | ficha-completa-activo.feature | El texto ampliado tiene un tope y lo dice | Sí (pytest: `test_el_texto_ampliado_tiene_un_tope_y_lo_dice`) |
| AC-CAR-019 | Corregir una ya creada | ficha-completa-activo.feature | Una característica ya creada se corrige sin volver a declararla | Sí (Vitest: `una característica ya creada se corrige en su sitio`, `cancelar la corrección deja la característica como estaba`, `una declarada en el alta también se corrige antes de guardar`; pytest: `test_renombrarla_arrastra_lo_ya_guardado`) |
| AC-CAR-020 | El duplicado se avisa en el acto | ficha-completa-activo.feature | Repetir una que el tipo ya declara se avisa sin ir al servidor | Sí (Vitest: `repetir una que el tipo ya declara se avisa sin ir al servidor`) |

## Cliente HTTP del navegador (AC-CLI-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-CLI-001 | Cada petición lleva sesión y empresa | authentication.feature | Cada petición dice quién pregunta y desde qué empresa | Sí (Vitest: `apiClient`, 4 casos) |
| AC-CLI-002 | El token vencido se renueva y reintenta | authentication.feature | Un token vencido se renueva y la petición se reintenta | Sí (Vitest: `renueva y reintenta la petición con el token nuevo`) |
| AC-CLI-003 | La renovación se intenta una sola vez | authentication.feature | La renovación se intenta una sola vez | Sí (Vitest: `solo lo intenta una vez`, con tope que hace fallar el bucle en vez de colgar) |
| AC-CLI-004 | Una sola renovación para varias peticiones | authentication.feature | Varias peticiones que vencen a la vez comparten una renovación | Sí (Vitest: `dos peticiones que vencen a la vez comparten un solo refresco`) |
| AC-CLI-005 | El login rechazado no renueva | authentication.feature | Un login rechazado no dispara una renovación | Sí (Vitest: `un login rechazado no intenta renovar ni redirige`) |
| AC-CLI-006 | Un fallo de red no cierra la sesión | authentication.feature | Un fallo de red no cierra la sesión | Sí (Vitest: `un error de red no toca la sesión`) |
| AC-CLI-007 | El cambio obligatorio lleva a su pantalla | authentication.feature | El cambio de contraseña obligatorio lleva a su pantalla | Sí (Vitest: `el cambio de contraseña obligatorio lleva a su pantalla, no al login`) |
| AC-CLI-008 | Sin almacenamiento la aplicación abre | authentication.feature | Sin almacenamiento la aplicación sigue abriendo | Sí (Vitest: `leer la empresa activa no revienta`) |
| AC-EMP-030 | Ninguna vista congela su consulta | multiempresa.feature | Ninguna vista congela su consulta al importar | Sí (pytest: `test_ninguna_vista_congela_su_consulta_al_importar`, sobre cada vista enrutada) |
| AC-EMP-031 | Ningún desplegable congela el suyo | multiempresa.feature | Ningún desplegable de formulario congela el suyo | Sí (pytest: `test_ningun_serializador_congela_su_desplegable`) |
| AC-EMP-032 | Con una sola empresa no se crea otra | multiempresa.feature | Con una sola empresa no se crea otra | Sí (pytest: `test_no_se_crea_una_segunda_empresa`) |
| AC-EMP-033 | La cuenta nueva entra sola a la única empresa | multiempresa.feature | La cuenta nueva entra sola a la única empresa | Sí (pytest: `test_la_cuenta_nueva_entra_a_la_unica_empresa`, `test_no_duplica_si_quien_la_crea_ya_la_puso`) |
| AC-EMP-034 | La pantalla no muestra ni elige empresa | multiempresa.feature | La pantalla no muestra ni elige empresa | Sí (pytest: `test_la_pantalla_sabe_que_es_una_sola`; vitest: `Empresas.test.jsx`, `UsersList.test.jsx`, `AsignacionEmpresas.test.jsx`) |
| AC-EMP-035 | Volver a varias empresas es un ajuste | multiempresa.feature | Volver a varias empresas es un ajuste | Sí (pytest: `test_con_varias_empresas_no_se_une_sola`) |

## Mis equipos y el rol «Usuario final» (AC-MIS-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-MIS-001 | Ver lo propio no es ver el inventario | mis-equipos.feature | Ver lo propio no es ver el inventario | Sí (pytest: `test_devuelve_solo_los_equipos_de_quien_pregunta`) |
| AC-MIS-002 | El rol no abre el inventario | mis-equipos.feature | El rol no abre el inventario | Sí (pytest: `test_el_usuario_final_no_puede_ver_el_inventario`) |
| AC-MIS-003 | Sin el permiso no se ve ni lo propio | mis-equipos.feature | Sin el permiso no se ve ni lo propio | Sí (pytest: `test_sin_el_permiso_no_se_ve_ni_lo_propio`) |
| AC-MIS-004 | Sin costo, proveedor ni veredicto de renovación | mis-equipos.feature | No se exponen costo, proveedor ni el veredicto de renovación | Sí (pytest y Vitest: `test_no_expone_costos_ni_proveedor_ni_el_veredicto_de_renovacion`, `ni costo, ni proveedor, ni el veredicto de renovación`) |
| AC-MIS-005 | Desde cuándo lo tiene esta persona | mis-equipos.feature | Dice desde cuándo lo tiene esta persona | Sí (pytest: `test_dice_desde_cuando_lo_tengo_yo`) |
| AC-MIS-006 | Un equipo dado de baja deja de aparecer | mis-equipos.feature | Un equipo dado de baja deja de aparecer | Sí (pytest: `test_un_equipo_dado_de_baja_deja_de_aparecer`) |
| AC-MIS-007 | Sin equipos no se advierte nada | mis-equipos.feature | Sin equipos a cargo no se advierte nada | Sí (pytest: `test_sin_equipos_no_hay_aviso`) |
| AC-MIS-008 | La cuenta sin ficha lo dice | mis-equipos.feature | Una cuenta sin ficha de empleado lo dice | Sí (pytest y Vitest: `test_una_cuenta_sin_ficha_de_empleado_lo_dice`, `sin ficha de empleado es otra cosa`) |
| AC-MIS-009 | Con la ficha en otra empresa, se dice cuál | mis-equipos.feature | Con la ficha en otra empresa, se dice en cuál | Sí (pytest y Vitest: `test_la_ficha_en_otra_empresa_se_dice_en_vez_de_devolver_nada`, `con la ficha en otra empresa, el aviso dice cuál`) |
| AC-MIS-010 | El panel lleva a la primera pantalla abrible | mis-equipos.feature | Entrar al panel lleva a la primera pantalla que se puede abrir | Sí (Vitest: `a quien solo ve lo suyo lo deja en su pantalla, no en un 403`) |

## Valor en libros y depreciación (AC-DEP-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-DEP-001 | El costo se reparte en partes iguales | depreciacion.feature | El costo se reparte en partes iguales entre los meses de vida contable | Sí (pytest: `test_reparte_el_costo_en_partes_iguales`) |
| AC-DEP-002 | Meses de calendario, no de treinta días | depreciacion.feature | Los meses se cuentan por calendario | Sí (pytest: `test_cuenta_meses_de_calendario_y_no_de_treinta_dias`) |
| AC-DEP-003 | Un equipo pasado de vida no vale negativo | depreciacion.feature | Un equipo pasado de vida no vale menos que cero | Sí (pytest: `test_un_equipo_pasado_de_vida_no_vale_negativo`) |
| AC-DEP-004 | El valor residual es el piso | depreciacion.feature | El valor residual es el piso | Sí (pytest: `test_el_valor_residual_es_el_piso`) |
| AC-DEP-005 | Se deprecia desde la puesta en servicio | depreciacion.feature | Se deprecia desde que entró en servicio, no desde la factura | Sí (pytest: `fecha_en_servicio`, cubierta en `test_el_reporte_de_valor_trae_la_cuenta_completa`) |
| AC-DEP-006 | Sin costo no se inventa un valor | depreciacion.feature | Un equipo sin costo capturado no muestra un valor inventado | Sí (pytest y Vitest: `test_sin_costo_no_se_inventa_un_valor`, `sin política ni costo no se inventa un cero`) |
| AC-DEP-007 | Sin política tampoco | depreciacion.feature | Sin política configurada tampoco | Sí (pytest: `test_sin_politica_no_se_deprecia`, `test_sin_politica_el_reporte_sigue_saliendo`) |
| AC-DEP-008 | La del tipo gana sobre la global | depreciacion.feature | La política del tipo gana sobre la global | Sí (pytest: `test_la_del_tipo_gana_sobre_la_global`) |
| AC-DEP-009 | Una desactivada no cae en la global | depreciacion.feature | Una política desactivada no cae de vuelta a la global | Sí (pytest: `test_una_politica_desactivada_no_cae_de_vuelta_a_la_global`) |
| AC-DEP-010 | Solo una política global | depreciacion.feature | Solo puede haber una política global | Sí (pytest y Vitest: `test_solo_puede_haber_una_politica_global`, `no ofrece crear una segunda política global`) |
| AC-DEP-011 | Vida contable de cero meses rechazada | depreciacion.feature | Una vida contable de cero meses se rechaza | Sí (pytest y Vitest: `test_una_vida_de_cero_meses_se_rechaza`, `una vida de cero meses no se puede guardar`) |
| AC-DEP-012 | El valor en libros va junto al costo | depreciacion.feature | La ficha del activo muestra el valor en libros junto al costo | Sí (Vitest: `va junto al costo`) |
| AC-DEP-013 | Totalmente depreciado no es una alerta | depreciacion.feature | Un equipo totalmente depreciado se marca sin tratarlo como un problema | Sí (Vitest: `un equipo ya depreciado se marca, sin tratarlo como un problema`) |
| AC-DEP-014 | El reporte totaliza el parque | depreciacion.feature | El reporte totaliza el parque | Sí (pytest: `test_el_parque_se_totaliza_al_pie`) |
| AC-DEP-015 | Vida contable ≠ vida útil de renovación | depreciacion.feature | La vida contable no es la vida útil de la política de renovación | Sí (pytest y Vitest: `test_la_vida_contable_no_es_la_vida_util_de_renovacion`, `advierte que la vida contable no es la de renovación`) |
| AC-POL-026 | Una segunda política global responde 400, no 500 | politicas-renovacion.feature | Una segunda política global se rechaza con un error útil | Sí (pytest: `test_una_segunda_politica_global_se_rechaza_con_un_error_util`) |

## Seguridad del módulo de solicitudes (AC-SEC-014 a 022)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-SEC-014 | Sin sesión no se entra | hallazgos-de-seguridad.feature | Ningún endpoint de solicitudes responde sin sesión | Sí (pytest: `test_sin_autenticar_no_se_ve_nada`, `test_sin_el_permiso_de_ver_no_se_entra`) |
| AC-SEC-015 | Lo ajeno no existe | hallazgos-de-seguridad.feature | Lo que no es de uno no existe | Sí (pytest: `test_la_solicitud_ajena_responde_que_no_existe`, `test_el_listado_no_filtra_por_id_lo_ajeno`, `test_el_recorrido_ajeno_tampoco_se_lee`) |
| AC-SEC-016 | Gestionar es lo propio | hallazgos-de-seguridad.feature | Gestionar no es gestionar lo de cualquiera | Sí (pytest: `test_no_se_mueve_una_solicitud_que_no_se_tiene_asignada`, `test_quien_pide_no_se_aprueba_lo_suyo`, `test_no_se_corrige_lo_que_pidio_otro`) |
| AC-SEC-017 | Sin campos de servidor desde el cliente | hallazgos-de-seguridad.feature | Los campos que decide el servidor no viajan desde el cliente | Sí (pytest: `test_no_se_pide_en_nombre_de_otro`, `test_no_se_nace_ya_aprobada`, `test_no_se_elige_la_empresa_desde_el_cliente`) |
| AC-SEC-018 | El aviso no se dirige a cualquiera | hallazgos-de-seguridad.feature | El aviso no se puede dirigir a cualquiera | Sí (pytest: `test_no_se_asigna_a_quien_no_puede_atenderla`) |
| AC-SEC-019 | Aislamiento entre empresas | hallazgos-de-seguridad.feature | Lo de otra empresa no se ve ni se mueve desde la propia | Sí (pytest: `test_la_cabecera_de_otra_empresa_no_abre_nada`, `test_lo_de_otra_empresa_no_se_gestiona_desde_la_propia`) |
| AC-SEC-020 | Entradas hostiles | hallazgos-de-seguridad.feature | Las entradas hostiles no rompen ni se ejecutan | Sí (pytest: `test_la_busqueda_no_se_rompe_con_caracteres_de_inyeccion`, `test_un_estado_inventado_no_pasa`, `test_el_texto_hostil_se_guarda_tal_cual_y_no_se_interpreta`) |
| AC-SEC-021 | Sin correos en la lista de encargados | hallazgos-de-seguridad.feature | La lista de encargados no reparte correos | Sí (pytest: `test_la_lista_de_encargados_no_reparte_correos`) |
| AC-SEC-022 | Rastro de lo hecho y lo intentado | hallazgos-de-seguridad.feature | Cada paso y cada intento quedan registrados | Sí (pytest: `test_cada_paso_deja_rastro_en_la_auditoria`, `test_el_intento_no_autorizado_queda_registrado`) |

## Solicitudes de compra (AC-SOL-xxx)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-SOL-001 | Nace con encargado | solicitudes-de-compra.feature | Una solicitud nace con encargado | Sí (pytest: `test_se_pide_y_queda_asignada_a_quien_comprara`) |
| AC-SOL-002 | El solicitante es quien entra | solicitudes-de-compra.feature | El solicitante es quien está autenticado | Sí (pytest: `test_el_solicitante_es_quien_esta_autenticado`) |
| AC-SOL-003 | Se pide del catálogo | solicitudes-de-compra.feature | Lo que se pide se elige del catálogo | Sí (pytest: `test_se_puede_pedir_del_catalogo`, `test_se_puede_pedir_lo_que_el_catalogo_no_tiene` —la API conserva `detalle`—; Vitest: `lo que se pide se elige del catálogo, no se escribe`, `al cambiar a componente se ofrecen los del catálogo de repuestos`) |
| AC-SOL-004 | Sin objeto se rechaza | solicitudes-de-compra.feature | Una solicitud sin objeto se rechaza | Sí (pytest: `test_una_solicitud_sin_objeto_se_rechaza`) |
| AC-SOL-005 | Una cosa por solicitud | solicitudes-de-compra.feature | No se piden un dispositivo y un componente a la vez | Sí (pytest: `test_no_se_piden_un_dispositivo_y_un_componente_a_la_vez`) |
| AC-SOL-006 | Solo a quien puede atenderla | solicitudes-de-compra.feature | Solo se asigna a quien puede atenderla | Sí (pytest: `test_solo_se_asigna_a_quien_puede_gestionarlas`, `test_los_encargados_posibles_son_los_que_pueden_atenderla`; Vitest: `solo ofrece como encargado a quien puede atenderla`) |
| AC-SOL-007 | Pedir no exige ver el parque | solicitudes-de-compra.feature | El catálogo para pedir no exige ver el inventario | Sí (Vitest: `el catálogo sale de solicitudes, no del inventario`) |
| AC-SOL-008 | Mis solicitudes | solicitudes-de-compra.feature | Mis solicitudes son las que yo pedí | Sí (pytest: `test_mis_solicitudes_son_las_que_yo_pedi`; Vitest: `pide lo que registré yo, y lo abierto primero`) |
| AC-SOL-009 | Solicitudes recibidas | solicitudes-de-compra.feature | Las recibidas son las que me asignaron | Sí (pytest: `test_las_recibidas_son_las_que_me_asignaron`, `test_quien_administra_ve_las_de_todos`; Vitest: `pide lo que me asignaron y dice quién lo pidió`) |
| AC-SOL-010 | La ajena no existe | solicitudes-de-compra.feature | La solicitud de otro no se ve ni existe | Sí (pytest: `test_la_solicitud_de_otro_no_se_ve_ni_existe`) |
| AC-SOL-011 | Aislamiento por empresa | solicitudes-de-compra.feature | Las solicitudes no cruzan empresas | Sí (pytest: `test_las_solicitudes_no_cruzan_empresas`) |
| AC-SOL-012 | El recorrido completo | solicitudes-de-compra.feature | El recorrido va de pendiente a entregada | Sí (pytest: `test_el_encargado_la_toma_la_compra_y_la_entrega`) |
| AC-SOL-013 | Quién dio cada paso | solicitudes-de-compra.feature | Cada paso queda escrito con quién lo dio | Sí (pytest: `test_cada_paso_queda_escrito_con_quien_lo_dio`; Vitest: `muestra el recorrido con quién dio cada paso`) |
| AC-SOL-014 | Gestionar es lo propio | solicitudes-de-compra.feature | Gestionar es gestionar lo propio | Sí (pytest: `test_una_solicitud_ajena_no_la_mueve_quien_no_la_tiene`) |
| AC-SOL-015 | Pedir no es aprobar | solicitudes-de-compra.feature | Quien pide no aprueba lo suyo, pero sí lo retira | Sí (pytest: `test_quien_pide_no_aprueba_lo_suyo`, `test_quien_pide_si_cancela_lo_suyo`; Vitest: `quien la pidió no ve los pasos de quien la gestiona`, `pero sí puede retirarla`) |
| AC-SOL-016 | El rechazo lleva motivo | solicitudes-de-compra.feature | Un rechazo lleva motivo | Sí (pytest: `test_un_rechazo_lleva_motivo`; Vitest: `rechazar sin motivo se ataja antes de enviarlo`) |
| AC-SOL-017 | Ni se reabre ni se salta | solicitudes-de-compra.feature | Una solicitud cerrada no se reabre ni se salta pasos | Sí (pytest: `test_una_entregada_ya_no_se_mueve`, `test_no_se_salta_pasos`; Vitest: `una cerrada no ofrece nada y dice por qué`) |
| AC-SOL-018 | Corregir mientras esté pendiente | solicitudes-de-compra.feature | Lo que se pidió se corrige mientras nadie la haya tomado | Sí (pytest: `test_se_corrige_mientras_nadie_la_haya_tomado`, `test_ya_tomada_no_se_cambia_lo_que_se_pide`, `test_la_solicitud_de_otro_no_se_corrige`) |
| AC-SOL-019 | Aviso al encargado | solicitudes-de-compra.feature | Al encargado se le avisa de lo que le asignaron | Sí (pytest: `test_al_encargado_se_le_avisa_de_lo_que_le_asignaron`, `test_si_el_encargado_no_tiene_correo_se_dice_en_el_acto`; Vitest: `si al encargado no se le pudo avisar, se dice antes de salir`) |
| AC-SOL-020 | Aviso al solicitante | solicitudes-de-compra.feature | A quien pidió se le avisa de cada paso | Sí (pytest: `test_a_quien_pidio_se_le_avisa_de_cada_paso`, `test_cancelar_lo_propio_no_se_avisa_a_uno_mismo`) |
| AC-SOL-021 | No se borra, se cancela | solicitudes-de-compra.feature | Una solicitud no se borra | Sí (pytest: `test_una_solicitud_no_se_borra`) |
| AC-SOL-022 | Se pide con las características del tipo | solicitudes-de-compra.feature | Se pide con las características que el tipo declara | Sí (pytest: `test_el_catalogo_trae_las_caracteristicas_de_cada_tipo`, `test_se_pide_con_las_caracteristicas_del_tipo`, `test_lo_pedido_se_corrige_como_el_resto`; Vitest: `elegir un tipo carga sus características, y no antes`, `las características viajan con la solicitud`, `enseña con qué características se pidió`) |
| AC-SOL-023 | Al pedir se exige lo obligatorio | solicitudes-de-compra.feature | Lo que el tipo marca obligatorio se exige también al pedir | Sí (pytest: `test_pedir_exige_las_obligatorias_del_tipo`, `test_lo_que_no_es_obligatorio_se_puede_dejar_en_blanco`; Vitest: `las que el tipo marca obligatorias hay que llenarlas`) |
| AC-SOL-024 | Lo pedido se comprueba | solicitudes-de-compra.feature | Lo pedido se comprueba contra lo declarado | Sí (pytest: `test_una_caracteristica_que_el_tipo_no_declara_se_rechaza`, `test_el_valor_se_comprueba_contra_el_dato_declarado`, `test_una_solicitud_escrita_a_mano_no_lleva_caracteristicas`; Vitest: `cambiar de tipo no arrastra las características del anterior`) |

## Recorridos de extremo a extremo (AC-E2E-xxx)

Se ejecutan con `npm run e2e` desde `frontend/`, contra el navegador y el
backend reales (ver `docs/qa-strategy.md`). No sustituyen a los criterios de
arriba: comprueban que las piezas que cada uno prueba por separado funcionen
juntas.

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-E2E-001 | Se entra y la sesión aguanta el recorrido | authentication.feature | Iniciar sesión y navegar por el panel | Sí (Playwright: `entrar-y-mirar.spec.js`) |
| AC-E2E-002 | Sin sesión, el panel manda al login | authentication.feature | Una ruta protegida sin sesión lleva al login | Sí (Playwright: `sin sesión, el panel manda al login`) |
| AC-E2E-003 | El login no delata qué cuentas existen | authentication.feature | Un intento fallido responde siempre lo mismo | Sí (Playwright: `una contraseña equivocada no dice si la cuenta existe`) |
| AC-E2E-004 | Un equipo se registra y recibe su código | inventario-activos.feature | El alta genera un código de barras único automáticamente | Sí (Playwright: `vida-de-un-equipo.spec.js`) |
| AC-E2E-005 | Se entrega, se repara y se da de baja | ficha-completa-activo.feature | El ciclo completo del equipo | Sí (Playwright: `vida-de-un-equipo.spec.js`, cinco pasos en serie) |
| AC-E2E-006 | Cambiar de empresa cambia los datos | multiempresa.feature | Un equipo de una empresa no existe en la otra | Sí (Playwright: `cambiar-de-empresa.spec.js`) |
| AC-E2E-007 | La empresa elegida sobrevive a navegar | multiempresa.feature | La elección de empresa se conserva entre pantallas | Sí (Playwright: `la elección sobrevive a abrir otra pantalla`) |
| AC-E2E-009 | Entrar deja al usuario en el panel | authentication.feature | Iniciar sesión lleva a la primera pantalla que se puede abrir | Sí (Playwright y Vitest: `entrar deja al usuario trabajando, no en una portada`, `con sesión abierta pasa de largo hacia el panel`) |
| AC-ACT-030 | Nuevo o usado al registrarlo | inventario-activos.feature | Se registra si el equipo se compró nuevo o usado | Sí (pytest y Vitest y Playwright: `test_se_registra_si_el_equipo_se_compro_nuevo_o_usado`, `se elige nuevo o usado y viaja al guardar`, `la ficha recuerda que se compró usado`) |
| AC-ACT-031 | No decirlo es válido | inventario-activos.feature | No decirlo es una respuesta válida | Sí (pytest y Vitest: `test_no_decirlo_es_una_respuesta_valida`, `sin anotar dice «sin especificar»`) |
| AC-ACT-032 | La condición no es el estado | inventario-activos.feature | La condición no se confunde con el estado | Sí (pytest: `test_no_se_mezcla_con_el_estado_del_equipo`) |
| AC-ACT-040 | Varios responsables en igualdad | inventario-activos.feature | De un equipo de turno responde más de una persona | Sí (pytest y Playwright: `test_un_equipo_compartido_responde_ante_varias_personas`, `equipo-compartido.spec.js`) |
| AC-ACT-041 | Lo personal no se reparte | inventario-activos.feature | La responsabilidad de un equipo personal no se reparte | Sí (pytest: `test_un_equipo_normal_no_reparte_la_responsabilidad`) |
| AC-ACT-042 | Cada quien firma la suya | inventario-activos.feature | Cada responsable firma su propia acta | Sí (pytest y Playwright: `test_cada_responsable_deja_su_propio_movimiento`, `cada entrega dejó su propio movimiento, que es su acta`) |
| AC-ACT-043 | Quitar a uno no vacía el equipo | inventario-activos.feature | Que se vaya uno del turno no devuelve el equipo a bodega | Sí (pytest y Vitest: `test_quitar_a_uno_deja_al_resto_respondiendo`, `se quita a una persona sin tocar a las demás`) |
| AC-ACT-044 | En «mis equipos» de cada uno | inventario-activos.feature | El equipo aparece en la pantalla de cada uno de sus responsables | Sí (pytest y Vitest: `test_un_equipo_compartido_aparece_en_la_lista_de_cada_uno`, `dice con quién más se responde por él`) |
| AC-ACT-045 | En el informe, bajo cada uno | inventario-activos.feature | El informe por usuario lista el equipo bajo cada responsable | Sí (pytest: `test_activos_por_usuario_lista_el_equipo_compartido_bajo_cada_uno`) |
| AC-AVI-010 | Un alta normal no avisa | notificaciones-correo.feature | Un equipo que nadie pidió no avisa a nadie | Sí (pytest y Vitest: `test_un_alta_sin_solicitante_no_avisa_a_nadie`, `test_ni_siquiera_avisa_a_quien_lo_registro`, `por delante viene «nadie», que es lo normal`) |
| AC-AVI-011 | Se avisa a quien lo pidió | notificaciones-correo.feature | Si lo pidió alguien, se le avisa de que llegó | Sí (pytest: `test_avisa_a_quien_lo_pidio`, `test_el_correo_dice_que_equipo_llego`, `test_dice_que_todavia_no_esta_entregado`) |
| AC-AVI-012 | El pedido de un área, a su nombre | notificaciones-correo.feature | Un pedido de un área se anota a nombre de quien lo pidió | Sí (pytest: `test_el_alta_desde_la_api_acepta_quien_lo_pidio`; el área viaja en la ficha del empleado) |
| AC-AVI-014 | Se anota aunque conste inactivo | notificaciones-correo.feature | Se puede anotar a alguien marcado como inactivo | Sí (pytest y Vitest: `test_se_puede_anotar_a_alguien_marcado_como_inactivo`, `test_y_si_esa_ficha_no_tiene_correo_el_aviso_cae_en_el_respaldo`, `los empleados llegan todos, y el custodio se acota en pantalla`) |
| AC-AVI-013 | Quién lo pidió no se edita | notificaciones-correo.feature | Quien pidió el equipo no se cambia al editar la ficha | Sí (pytest y Vitest: `test_quien_lo_pidio_no_se_cambia_al_editar`, `al editar no se puede cambiar: es un hecho del alta`) |
| AC-MNT-040 | El equipo pasa a «En reparación» | mantenimientos.feature | Registrar una reparación abierta pone el equipo en reparación | Sí (pytest: `test_registrar_una_reparacion_abierta_lo_pone_en_reparacion`, `test_el_cambio_de_estado_queda_en_el_historial`) |
| AC-MNT-041 | Vuelve a donde entró | mantenimientos.feature | Al cerrarla, el equipo vuelve al estado en que entró | Sí (pytest: `test_al_cerrarla_vuelve_al_estado_en_que_entro`, `test_un_equipo_de_bodega_vuelve_a_bodega`) |
| AC-MNT-042 | Registrada ya cerrada no mueve nada | mantenimientos.feature | Una reparación que se registra ya cerrada no mueve el estado | Sí (pytest: `test_una_reparacion_registrada_ya_cerrada_no_mueve_el_estado`) |
| AC-MNT-043 | Sin arreglo se queda en el taller | mantenimientos.feature | Una reparación sin arreglo deja el equipo en el taller | Sí (pytest: `test_no_reparable_deja_el_equipo_en_el_taller`) |
| AC-MNT-044 | No se pisa lo que otro decidió | mantenimientos.feature | Lo que alguien decidió mientras estaba fuera no se pisa | Sí (pytest: `test_si_alguien_lo_movio_mientras_estaba_fuera_no_se_le_pisa`, `test_no_se_lleva_al_taller_lo_que_ya_salio_del_parque`) |
| AC-AVI-009 | Muestras de cada aviso | notificaciones-correo.feature | Se puede ver cómo se ve cada aviso sin tocar el inventario | Sí (pytest: `test_manda_una_por_cada_muestra`, `test_no_deja_nada_en_la_base`, `test_todas_las_plantillas_se_dibujan`) |
| AC-AVI-001 | Aviso al entrar al taller | notificaciones-correo.feature | Un equipo que entra al taller avisa a quien responde por él | Sí (pytest: `test_avisa_a_quien_responde_por_el_equipo`, `test_el_correo_dice_qué_equipo_es_y_por_qué_entró`) |
| AC-AVI-002 | Aviso al volver | notificaciones-correo.feature | Y otro cuando vuelve | Sí (pytest: `test_avisa_cuando_el_equipo_vuelve`, `test_una_reparacion_registrada_ya_cerrada_avisa_una_sola_vez`) |
| AC-AVI-003 | Sin correo, avisa a quien actuó | notificaciones-correo.feature | Sin correo en la ficha, el aviso va a quien registró la acción | Sí (pytest: `test_sin_correo_el_aviso_va_a_quien_registro_la_reparacion`, `test_y_se_dice_a_quién_no_se_le_avisó`, `test_la_respuesta_dice_a_quien_no_se_le_avisara`) |
| AC-AVI-004 | El respaldo no se suma siempre | notificaciones-correo.feature | Con uno sin correo y otro con él, no se suma al técnico | Sí (pytest: `test_con_uno_sin_correo_y_otro_con_el_no_se_suma_al_tecnico`) |
| AC-AVI-005 | Se dice antes de guardar | notificaciones-correo.feature | Se dice antes de guardar, no después | Sí (Vitest: `dice a quién se le avisará`, `y a quién no, porque no tiene correo en su ficha`) |
| AC-AVI-006 | Sin repartir direcciones | notificaciones-correo.feature | La pantalla no reparte direcciones de correo | Sí (Vitest: `no enseña la dirección de nadie`; pytest: las direcciones viajan en copia oculta, `test_las_direcciones_van_en_copia_oculta`) |
| AC-AVI-007 | El correo caído no bloquea | notificaciones-correo.feature | Un servidor de correo caído no impide registrar la reparación | Sí (pytest: `test_un_correo_que_falla_no_impide_registrar_la_reparacion`) |
| AC-AVI-008 | Corregir no reavisa | notificaciones-correo.feature | Corregir una reparación ya cerrada no vuelve a avisar | Sí (pytest: `test_corregir_una_reparacion_ya_cerrada_no_vuelve_a_avisar`) |
| AC-PUE-020 | El verificador dice qué mide | puesta-en-marcha.feature | El verificador dice qué configuración está midiendo | Sí (pytest: `test_el_verificador_avisa_cuando_no_es_produccion`, `test_el_verificador_no_avisa_cuando_si_lo_es`) |
| AC-PUE-021 | Producción no se afloja | puesta-en-marcha.feature | La configuración de producción no se puede aflojar sin que salte | Sí (pytest: `test_debug_esta_apagado`, `test_no_depende_del_entorno_para_apagarlo`, `test_las_cookies_solo_viajan_por_https`, `test_hsts_dura_lo_suficiente_para_la_lista_precargada`) |
| AC-PWA-001 | El teléfono ofrece instalarla | aplicacion-instalable.feature | El teléfono ofrece instalarla | Sí (Vitest y `npm run pwa:verificar`: `declara lo que un teléfono exige para ofrecer la instalación`, `trae un icono recortable`) |
| AC-PWA-002 | Abre en el panel | aplicacion-instalable.feature | Abre donde se trabaja, no en la portada | Sí (Vitest y `npm run pwa:verificar`: `arranca en el panel y no en la raíz`) |
| AC-PWA-003 | Atajos al escáner y a lo propio | aplicacion-instalable.feature | Los atajos llevan a lo que se hace con el teléfono en la mano | Sí (Vitest: `los atajos llevan a donde se usa el teléfono`) |
| AC-PWA-004 | Sin conexión lo dice | aplicacion-instalable.feature | Sin conexión lo dice con sus palabras | Sí (Vitest y `npm run pwa:verificar`: `dice qué pasa y por qué no se enseña el inventario guardado`, `vuelve sola en cuanto regresa la red`) |
| AC-PWA-005 | La API nunca sale de la caché | aplicacion-instalable.feature | El inventario nunca se sirve de la caché | Sí (Vitest y `npm run pwa:verificar`: `no guarda ni responde nada de la API`, comprobado sin red en un navegador real) |
| AC-PWA-006 | El despliegue nuevo se ve | aplicacion-instalable.feature | Un despliegue nuevo se ve al instante | Sí (Vitest: `va a la red primero al navegar`, `borra las versiones anteriores del armazón al activarse`) |
| AC-PWA-007 | En desarrollo no se instala | aplicacion-instalable.feature | En desarrollo no se instala nada | Sí (Vitest: `en desarrollo no, o se serviría el armazón de la sesión anterior`) |
| AC-POL-030 | La sugerencia se enciende sola | politicas-renovacion.feature | La sugerencia se enciende sola cuando pasa el tiempo | Sí (pytest: `test_enciende_la_sugerencia_que_el_tiempo_encendio_solo`) |
| AC-POL-031 | Y se apaga | politicas-renovacion.feature | Y se apaga cuando deja de corresponder | Sí (pytest: `test_tambien_la_apaga_cuando_deja_de_corresponder`) |
| AC-POL-032 | El cron recorre todas las empresas | politicas-renovacion.feature | El recálculo recorre todas las empresas | Sí (pytest: `test_recorre_el_sistema_entero_y_no_una_sola_empresa`) |
| AC-POL-033 | El cron no ensucia la ficha | politicas-renovacion.feature | El recálculo no ensucia la ficha ni el historial | Sí (pytest: `test_la_fecha_de_la_ficha_no_se_toca`, `test_no_deja_rastro_en_la_bitacora`) |
| AC-ESC-020 | La etiqueta mal leída, desde el inventario | escaner-activos.feature | La etiqueta mal leída se encuentra también desde el inventario | Sí (pytest, Vitest y Playwright: `test_el_inventario_encuentra_el_equipo_con_el_codigo_mal_leido`, `avisa de que hay que reconfigurar la pistola`, `el inventario encuentra el equipo con el guion mal leído`) |
| AC-ESC-021 | Y desde el activo intervenido | escaner-activos.feature | Y desde el «Activo intervenido» del mantenimiento | Sí (pytest, Vitest y Playwright: `test_el_buscador_del_mantenimiento_tambien_lo_encuentra`, `el aviso también se ve con el equipo ya elegido`, `y el «activo intervenido» del mantenimiento, también`) |
| AC-ESC-022 | Sin falsos avisos | escaner-activos.feature | No se avisa de una pistola que nadie usó | Sí (pytest: `test_no_avisa_de_una_pistola_que_no_se_uso`, `test_no_se_toca_una_serie_que_lleva_apostrofe_de_verdad`) |
| AC-ESC-023 | La serie, de las dos formas | escaner-activos.feature | El número de serie del fabricante también se acepta de las dos formas | Sí (pytest: `test_la_serie_del_fabricante_se_encuentra_de_las_dos_formas`, `test_y_la_lectura_por_codigo_tambien_las_acepta`) |
| AC-ESC-024 | Lo recibido manda | escaner-activos.feature | Lo recibido manda sobre lo reparado | Sí (pytest: `test_lo_recibido_manda_sobre_lo_reparado`) |
| AC-ESC-025 | Y la bitácora de mantenimientos | escaner-activos.feature | La bitácora de mantenimientos también acepta la etiqueta mal leída | Sí (pytest: `test_la_bitacora_encuentra_el_equipo_con_la_etiqueta_mal_leida`, `test_la_bitacora_avisa_de_la_pistola_mal_configurada`, `test_la_bitacora_por_codigo_de_barras_acepta_las_dos_formas`; Vitest: `avisa de la pistola mal configurada`) |
| AC-ESC-026 | Leer con la cámara | escaner-activos.feature | Leer una etiqueta con la cámara del teléfono | Sí (Vitest: `lo que lee se entrega tal cual a quien lo pidió`, `lo que lee la cámara se consulta igual que un disparo de pistola`, `busca QR y código de barras, no todo lo que la librería sabe leer`) |
| AC-ESC-027 | La cámara no se abre sola | escaner-activos.feature | La cámara no se abre sola | Sí (Vitest: `la cámara no se abre sola`, `ofrece leer con la cámara, para las etiquetas en QR`) |
| AC-ESC-028 | Se suelta al terminar | escaner-activos.feature | La cámara se suelta al terminar | Sí (Vitest: `suelta la cámara al cerrarla`, `y también al desmontarse sin pasar por el botón`) |
| AC-ESC-029 | Sin cámara se dice por qué | escaner-activos.feature | Sin cámara disponible se dice por qué | Sí (Vitest: `sin acceso a la cámara explica el motivo más probable`, `sin permiso dice qué hacer, no «error»`, `si la cámara falla, recuerda que la pistola sigue sirviendo`) |
| AC-MIS-011 | Fuera del menú lateral | mis-equipos.feature | La pantalla no ocupa sitio en el menú de quien administra | Sí (Vitest: `no está en el menú: es una vista personal, no una de operación`) |
| AC-ACT-047 | La entrega lleva la sede | inventario-activos.feature | La entrega deja el equipo donde se lo entregó | Sí (pytest, Vitest y Playwright: `test_la_entrega_desde_la_api_lleva_responsable_y_sede`, `la entrega lleva la sede: se entrega donde el equipo se queda`, `se entrega a un responsable y queda en su historial`) |
| AC-ACT-048 | Aviso al quedarse sin nadie | inventario-activos.feature | Dejar el equipo sin responsable se avisa antes de confirmar | Sí (Vitest: `devolver a bodega avisa de que nadie responderá por él`, `quitar a todos avisa de que el equipo vuelve a bodega`) |
| AC-ACT-049 | El área se dice, no se pregunta | inventario-activos.feature | El área no se pregunta en la entrega, pero se dice cuál será | Sí (Vitest: `el área no se pregunta, pero se dice a cuál queda adscrito`, `y el área sigue viajando al guardar, aunque no se pregunte`) |
| AC-ACT-050 | Buscar desde cualquier pantalla | inventario-activos.feature | Buscar un equipo desde cualquier pantalla | Sí (Vitest: `una etiqueta conocida abre la ficha de ese equipo`) |
| AC-ACT-051 | Lo que no es etiqueta lleva al listado | inventario-activos.feature | Lo que no es una etiqueta lleva al listado | Sí (Vitest: `lo que no es una etiqueta lleva al inventario buscando ese texto`, `la búsqueda de la cabecera llega con su texto ya aplicado`) |
| AC-ACT-052 | Acciones rápidas en la fila | inventario-activos.feature | Actuar sobre un equipo sin entrar en su ficha | Sí (Vitest: `quien asigna puede hacerlo desde el listado, en un clic`, `el nombre del equipo lleva a su ficha`, `sin permisos no aparece ninguna acción rápida`) |
| AC-ACT-053 | Nada que mover fuera del parque | inventario-activos.feature | No se ofrece mover lo que ya salió del parque | Sí (Vitest: `no se ofrece asignar un equipo que ya salió del parque`; el dato lo calcula el servidor, `ActivoListSerializer.esta_operativo`) |
| AC-ACT-054 | Los filtros no tapan la tabla | inventario-activos.feature | Los filtros no tapan la tabla | Sí (Vitest: `arrancan plegados: la tabla es a lo que se viene`, `se abren al pedirlo`) |
| AC-ACT-055 | Se ve qué se filtró y se quita suelto | inventario-activos.feature | Se ve qué se está filtrando y se quita de uno en uno | Sí (Vitest: `cada filtro aplicado se nombra y se puede quitar solo`, `«limpiar todo» deja el listado sin filtros`, `sin filtros no hay nada que explicar`) |
| AC-ACT-056 | Llegar filtrado abre los filtros | inventario-activos.feature | Llegar filtrado desde otra pantalla abre los filtros | Sí (Vitest: `si se llega ya filtrado desde otra pantalla, se abren solos`) |
| AC-ACT-057 | Categorías de partida | inventario-activos.feature | Lo que se inventaría se clasifica por su naturaleza | Sí (pytest: `test_las_tres_categorias_vienen_sembradas`, `test_lo_que_ya_estaba_quedo_en_hardware`) |
| AC-ACT-058 | Se personalizan | inventario-activos.feature | Las categorías se personalizan | Sí (pytest: `test_se_crea_una_categoria_propia`, `test_no_se_repite_el_nombre_aunque_cambie_la_caja`; Vitest: `se crea una categoría propia: eso es poder personalizarlo`) |
| AC-ACT-059 | No se borran, se desactivan | inventario-activos.feature | Una categoría no se borra, se desactiva | Sí (pytest: `test_no_se_borra_una_categoria`, `test_desactivarla_la_saca_del_desplegable`; Vitest: `desactivar una categoría no la borra`) |
| AC-ACT-060 | El equipo la hereda del tipo | inventario-activos.feature | El equipo hereda la categoría de su tipo | Sí (pytest: `test_el_listado_dice_la_categoria_de_cada_equipo`, `test_un_tipo_se_mueve_de_categoria`) |
| AC-ACT-061 | Se filtra por categoría | inventario-activos.feature | El inventario se filtra por categoría | Sí (pytest: `test_el_inventario_se_filtra_por_categoria`; Vitest: `el conteo de tipos lleva al inventario de esa categoría`) |
| AC-IMP-019 | Varios códigos en una celda | carga-masiva-activos.feature | Varios responsables en una celda, separados por punto y coma | Sí (pytest: `test_varios_codigos_separados_por_punto_y_coma`) |
| AC-EST-014 | La ficha no ofrece lo rechazable | ficha-completa-activo.feature | La ficha no ofrece lo que el servidor va a rechazar | Sí (Vitest, los tres estados: `no se puede asignar ni editar: ya no está`, `tampoco se registran mantenimientos sobre él`) |
| AC-EST-015 | Cuándo y por qué salió | ficha-completa-activo.feature | La ficha dice cuándo y por qué salió, sea cual sea la salida | Sí (Vitest y Playwright: `dice cuándo y por qué salió`, `se da de baja con su motivo y sale del parque`) |
| AC-IMP-017 | El partner se nombra en la plantilla | carga-masiva-activos.feature | Nombrar al partner basta para que el equipo sea suyo | Sí (pytest: `test_nombrar_al_dueno_basta_para_que_el_equipo_sea_suyo`) |
| AC-IMP-018 | La contradicción se señala | carga-masiva-activos.feature | Decir las dos cosas a la vez se señala en vez de resolverse solo | Sí (pytest: `test_decir_las_dos_cosas_a_la_vez_se_señala_en_vez_de_resolverlo_solo`) |
| AC-ACT-033 | Propio o en concesión | inventario-activos.feature | Se distingue lo que compró la empresa de lo que pone un partner | Sí (pytest, Vitest y Playwright: `test_un_equipo_se_registra_como_puesto_por_un_partner`, `en concesión dice de qué partner es`, `equipo-en-concesion.spec.js`) |
| AC-ACT-034 | En concesión sin dueño se rechaza | inventario-activos.feature | «En concesión» sin decir de quién no se acepta | Sí (pytest: `test_en_concesion_sin_decir_de_quien_no_se_acepta`, y en la carga masiva `test_en_concesion_sin_dueno_se_rechaza`) |
| AC-ACT-035 | Lo ajeno no deprecia | inventario-activos.feature | Un equipo en concesión no deprecia contra el patrimonio propio | Sí (pytest y Playwright: `test_un_equipo_en_concesion_no_deprecia_contra_nuestro_patrimonio`, `no se le calcula valor en libros`) |
| AC-ACT-036 | Filtrar por de quién es | inventario-activos.feature | El inventario responde qué hay que devolverle a cada partner | Sí (pytest y Vitest: `test_el_inventario_se_filtra_por_de_quien_es`, `se filtra por de quién es el equipo`) |
| AC-MNT-030 | El equipo se elige con la pistola | mantenimientos.feature | El equipo intervenido se elige disparando la pistola | Sí (Playwright y Vitest: `en el formulario, el equipo también se elige con la pistola`, `el Enter de la pistola no envía el formulario a medio llenar`) |
| AC-MNT-031 | O escribiendo, con filtrado | mantenimientos.feature | O escribiendo unas letras, que van filtrando | Sí (Playwright y Vitest: `y escribiendo unas letras se filtra la lista`, `filtra contra el servidor y muestra las coincidencias`) |
| AC-MNT-032 | Sin tope de trescientos equipos | mantenimientos.feature | Se busca contra el inventario completo, sin tope | Sí (Vitest: la búsqueda viaja al servidor con `q`, ver `BuscadorDeActivo.test.jsx`) |
| AC-E2E-011 | No se registra sobre lo que salió del parque | escaner-activos.feature | No se ofrece registrar sobre un equipo que salió del parque | Sí (Vitest: `sobre un equipo que ya salió del parque tampoco`) |
| AC-E2E-010 | El escáner ofrece ver la ficha o registrar | escaner-activos.feature | Una lectura ofrece las dos cosas que se hacen con el equipo en la mano | Sí (Playwright y Vitest: `consulta-por-escaner.spec.js`, `ofrece las dos cosas que se hacen con el equipo en la mano`) |
| AC-E2E-008 | Un reporte se descarga con contenido | dashboard-y-reportes.feature | El archivo se descarga con su nombre y no llega vacío | Sí (Playwright: `descargar-un-reporte.spec.js`) |

## Matriz de obligaciones, fase 1: base y acceso (AC-MTZ-001 a AC-MTZ-010)

Especificación: `matriz_admin/docs/modulo/MODULO-MATRIZ-OBLIGACIONES.md`. Plan y
estado del módulo en `docs/matriz-obligaciones.md`.

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-MTZ-001 | Un rol global da la Matriz | matriz-obligaciones.feature | Un rol global da los permisos de la Matriz como los de cualquier módulo | Sí (pytest: `test_un_rol_global_da_permisos_de_la_matriz_como_los_demas`) |
| AC-MTZ-002 | El rol vale solo en su empresa | matriz-obligaciones.feature | El rol de la membresía vale solo en su empresa | Sí (pytest: `test_el_rol_de_la_membresia_vale_solo_en_su_empresa`, `test_el_superusuario_tiene_toda_la_matriz`) |
| AC-MTZ-003 | Solo sus empresas, con su rol | matriz-obligaciones.feature | Solo ve sus empresas, con su rol | Sí (pytest: `test_solo_ve_sus_empresas_con_su_rol`, `test_una_empresa_inactiva_no_da_acceso`, `test_el_selector_de_empresa_dice_el_rol_en_cada_una`) |
| AC-MTZ-004 | La entrada dice dónde y con qué rol | matriz-obligaciones.feature | La entrada de la Matriz dice dónde se está y con qué rol | Sí (Vitest: `dice la empresa, su zona horaria, el rol y qué permite`, `sin rol de la Matriz en la empresa activa, lo dice y cómo resolverlo`) |
| AC-MTZ-005 | Roles sembrados | matriz-obligaciones.feature | Los roles de la Matriz vienen sembrados y son editables | Sí (pytest: `test_los_roles_sembrados_son_los_de_la_especificacion`) |
| AC-MTZ-006 | Catálogos compartidos | matriz-obligaciones.feature | Áreas y entidades de control compartidas | Sí (pytest: `test_los_catalogos_vienen_sembrados`, `test_ver_los_catalogos_exige_su_permiso`, `test_editarlos_exige_el_suyo_y_queda_auditado`; Vitest: `se consultan sin el permiso de editar, pero no se cambian`, `con permiso se crea una nueva`, `cada apartado se filtra por su permiso`) |
| AC-MTZ-007 | La empresa para la Matriz | matriz-obligaciones.feature | La empresa tiene lo que la Matriz necesita | Sí (pytest: `test_la_empresa_tiene_zona_color_y_base_de_cumplimiento`, `test_el_gerente_general_debe_trabajar_en_la_empresa`, `test_las_personas_de_la_empresa_para_elegir_gerente`; Vitest: `guarda lo que pide la Matriz: zona, color, gerente y base de cumplimiento`) |
| AC-MTZ-008 | Selector de módulos | matriz-obligaciones.feature | El selector de módulos ofrece los módulos con algo que abrir | Sí (Vitest: `dice en qué módulo se está y ofrece los demás`, `elegir otro lleva a su inicio`, `con un solo módulo no se dibuja`) |
| AC-MTZ-009 | Un menú por módulo | matriz-obligaciones.feature | Cada módulo trae su menú; Configuración es común | Sí (Vitest: `el inventario no muestra la Matriz, ni la Matriz el inventario`, `Configuración aparece en los dos`) |
| AC-MTZ-010 | Configuración conserva el módulo | matriz-obligaciones.feature | Configuración conserva el módulo desde el que se llegó | Sí (Vitest: `en Configuración conserva el módulo desde el que se llegó`) |

## Matriz de obligaciones, fase 2: obligaciones y matriz (AC-MTZ-011 a AC-MTZ-025)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-MTZ-011 | Estado calculado | matriz-obligaciones.feature | El estado se calcula, no se guarda | Sí (pytest: `test_cerrado_a_tiempo_es_finalizado`, `test_cerrado_tarde_conserva_el_atraso`, `test_abierto_y_vencido_es_incumplido_justo_despues_de_la_hora`, `test_vence_hoy_es_una_marca_y_no_borra_la_etapa`, `test_dentro_del_plazo_muestra_la_etapa_y_los_dias`) |
| AC-MTZ-012 | Zona de la empresa | matriz-obligaciones.feature | Los días se cuentan en la zona horaria de la empresa | Sí (pytest: `test_el_dia_se_cuenta_en_la_zona_de_la_empresa_no_en_la_del_servidor`) |
| AC-MTZ-013 | Alta con primer período | matriz-obligaciones.feature | El alta crea la obligación y su primer período | Sí (pytest: `test_el_alta_crea_la_obligacion_y_su_primer_periodo`; Vitest: `manda lo escrito, sin los campos vacíos`) |
| AC-MTZ-014 | Códigos correlativos | matriz-obligaciones.feature | Los códigos son correlativos | Sí (pytest: `test_los_codigos_son_correlativos`) |
| AC-MTZ-015 | Nombre único | matriz-obligaciones.feature | El nombre de una obligación no se repite en la empresa | Sí (pytest: `test_el_nombre_no_se_repite_en_la_empresa_sin_distinguir_mayusculas`; Vitest: `los errores del servidor se muestran junto a su campo`) |
| AC-MTZ-016 | Responsables de la empresa | matriz-obligaciones.feature | Los responsables trabajan en la empresa | Sí (pytest: `test_el_responsable_debe_trabajar_en_la_empresa`) |
| AC-MTZ-017 | Crear exige permiso | matriz-obligaciones.feature | Crear exige su permiso | Sí (pytest: `test_sin_permiso_de_crear_es_403_y_queda_auditado`; Vitest: `sin permiso de crear, no ofrece «Nueva obligación»`) |
| AC-MTZ-018 | Crear en sus áreas | matriz-obligaciones.feature | Quien no ve toda la empresa crea solo en sus áreas | Sí (pytest: `test_quien_no_ve_toda_la_empresa_crea_solo_en_sus_areas`) |
| AC-MTZ-019 | Solo lo propio | matriz-obligaciones.feature | Sin «ver_todas», solo lo propio | Sí (pytest: `test_sin_ver_todas_solo_ve_lo_suyo_y_lo_ajeno_es_404`) |
| AC-MTZ-020 | Sin rol, 404 | matriz-obligaciones.feature | Sin rol de la Matriz, nada existe | Sí (pytest: `test_sin_rol_de_la_matriz_en_la_empresa_todo_es_404`) |
| AC-MTZ-021 | Acciones del servidor | matriz-obligaciones.feature | Los botones del detalle los decide el servidor | Sí (pytest: `test_el_detalle_ofrece_solo_las_acciones_permitidas`; Vitest: `ofrece solo las acciones que manda el servidor`) |
| AC-MTZ-022 | Seguimiento con historial | matriz-obligaciones.feature | Editar el seguimiento deja historial campo por campo | Sí (pytest: `test_editar_el_seguimiento_deja_un_evento_por_campo`, `test_un_periodo_cerrado_no_se_edita`, `test_el_responsable_no_se_puede_quitar`; Vitest: `editar el seguimiento guarda y recarga el detalle`, `el historial muestra quién cambió qué, con el valor anterior`) |
| AC-MTZ-023 | La matriz | matriz-obligaciones.feature | La matriz ordena por urgencia, filtra, busca y agrupa | Sí (pytest: `test_la_matriz_ordena_por_urgencia_y_filtra`; Vitest: `lista los períodos con su estado y los días de atraso`, `filtrar por estado viaja a la API y queda en la dirección`, `la búsqueda de la barra superior llega por ?q=`, `las columnas se ordenan; el segundo clic invierte`, `se agrupa por área, con su conteo`, `una fila abre el detalle en el panel lateral`, `dice el atraso, si vence hoy o cuánto falta`) |
| AC-MTZ-024 | El tablero | matriz-obligaciones.feature | El tablero dice lo que pide atención | Sí (pytest: `test_el_resumen_cuenta_lo_que_pide_atencion`; Vitest: `muestra los cuatro indicadores, el rol y los próximos vencimientos`, `cada indicador abre la matriz filtrada`) |
| AC-MTZ-025 | Fechas | matriz-obligaciones.feature | Las fechas de los períodos | Sí (pytest: `test_etiquetas_por_periodicidad`, `test_el_primer_vencimiento_sale_de_la_regla`, `test_el_siguiente_vencimiento_respeta_el_fin_de_mes`) |

## Matriz de obligaciones, fase 3: evidencias y cierre (AC-MTZ-026 a AC-MTZ-036)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-MTZ-026 | Solo PDF con tope | matriz-obligaciones.feature | Solo se aceptan PDF, con tope de tamaño | Sí (pytest: `test_lo_que_no_es_un_pdf_se_rechaza_en_el_servidor`, `test_el_tamano_tiene_tope`; Vitest: `la validación previa rechaza lo que no es PDF y lo que pesa demasiado`) |
| AC-MTZ-027 | Carga y versiones | matriz-obligaciones.feature | Cargar evidencia versiona y pone en marcha el período | Sí (pytest: `test_la_primera_evidencia_saca_al_periodo_de_sin_iniciar`, `test_el_mismo_nombre_es_una_version_nueva`; Vitest: `sube los válidos uno a uno y muestra el error del que falla`) |
| AC-MTZ-028 | Archivo auditado | matriz-obligaciones.feature | El archivo se sirve con la sesión y cada acceso queda auditado | Sí (pytest: `test_el_archivo_se_sirve_por_su_endpoint_y_cada_acceso_queda_auditado`, `test_el_archivo_de_un_periodo_ajeno_es_404`; Vitest: `el visor muestra el PDF pedido con la sesión`) |
| AC-MTZ-029 | Rechazar y eliminar | matriz-obligaciones.feature | Rechazar una evidencia exige motivo; eliminar es lógico | Sí (pytest: `test_rechazar_exige_motivo_y_eliminar_es_logico`, `test_una_evidencia_rechazada_no_cuenta`; Vitest: `lista los válidos y los rechazados con su motivo`, `rechazar una evidencia pide el motivo y la manda`, `sin permiso de rechazar, no ofrece el botón`, `eliminar un rechazado pide confirmación`) |
| AC-MTZ-030 | Enviar exige evidencia | matriz-obligaciones.feature | Sin evidencia válida no se envía | Sí (pytest: `test_sin_evidencia_valida_no_se_envia`; Vitest: `el error del servidor se muestra en el panel`) |
| AC-MTZ-031 | Enviar y validar | matriz-obligaciones.feature | Enviar y validar cierran el período | Sí (pytest: `test_enviar_y_validar_por_otra_persona_cierra_el_periodo`; Vitest: `enviar pide confirmación, llama al servidor y avisa`, `validar pide confirmación antes de cerrar`, `muestra solo los botones que el servidor permite`) |
| AC-MTZ-032 | Separación de funciones | matriz-obligaciones.feature | Separación de funciones | Sí (pytest: `test_quien_envio_o_cargo_no_puede_validar`) |
| AC-MTZ-033 | Base de cumplimiento | matriz-obligaciones.feature | El cumplimiento sigue la base de la empresa | Sí (pytest: `test_un_cierre_tarde_queda_fuera_de_plazo`, `test_si_la_empresa_cuenta_el_envio_el_cumplimiento_es_esa_fecha`) |
| AC-MTZ-034 | Devolver | matriz-obligaciones.feature | Devolver exige motivo | Sí (pytest: `test_devolver_exige_motivo_y_vuelve_a_preparacion`; Vitest: `devolver exige un motivo de al menos 10 caracteres`) |
| AC-MTZ-035 | Cambio de fecha | matriz-obligaciones.feature | Cambiar la fecha exige permiso y justificación | Sí (pytest: `test_cambiar_la_fecha_exige_justificacion_y_queda_en_el_historial`, `test_cambiar_la_fecha_exige_su_permiso`, `test_un_periodo_cerrado_no_cambia_de_fecha`; Vitest: `exige justificación y manda fecha, hora y motivo`) |
| AC-MTZ-036 | Vista Documentos | matriz-obligaciones.feature | La vista Documentos | Sí (pytest: `test_documentos_separa_los_expedientes_con_evidencia_de_los_pendientes`; Vitest: `separa los expedientes con evidencia de los pendientes`, `una fila abre el período en el panel lateral`) |

## Matriz de obligaciones, fase 4: recordatorios (AC-MTZ-037 a AC-MTZ-046)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-MTZ-037 | Anticipaciones | matriz-obligaciones.feature | Los recordatorios llegan en cada anticipación, una sola vez | Sí (pytest: `test_llega_en_cada_anticipacion_al_responsable_y_al_suplente`, `test_fuera_de_las_anticipaciones_no_se_envia`, `test_sin_copia_al_suplente_solo_el_responsable`, `test_quien_no_tiene_correo_se_omite_y_no_se_repite`, `test_las_anticipaciones_de_la_empresa_mandan`) |
| AC-MTZ-038 | Hora de envío | matriz-obligaciones.feature | A la hora de envío de la empresa, en su zona horaria | Sí (pytest: `test_antes_de_la_hora_de_envio_no_sale`, `test_la_hora_es_la_local_de_la_empresa`) |
| AC-MTZ-039 | Sin duplicados | matriz-obligaciones.feature | Correr el programador dos veces no duplica nada | Sí (pytest: `test_correr_dos_veces_no_duplica`, `test_si_cambia_el_vencimiento_se_reprograman`, `test_el_comando_corre_el_ciclo_y_es_idempotente`) |
| AC-MTZ-040 | Suspensión | matriz-obligaciones.feature | Al validar, dejan de enviarse | Sí (pytest: `test_al_validar_dejan_de_enviarse`; Vitest: `un período cerrado dice que sus recordatorios están suspendidos`) |
| AC-MTZ-041 | Escalamiento | matriz-obligaciones.feature | El escalamiento llega al supervisor o al aprobador | Sí (pytest: `test_con_dos_dias_de_atraso_se_escala_al_supervisor_una_vez`, `test_sin_supervisor_se_escala_al_aprobador`, `test_el_escalamiento_se_repite_cada_n_dias`, `test_el_escalamiento_desactivado_no_sale`) |
| AC-MTZ-042 | Reintentos | matriz-obligaciones.feature | Un envío fallido se reintenta sin duplicar | Sí (pytest: `test_un_fallo_queda_registrado_y_se_reintenta_hasta_el_maximo`, `test_un_reintento_no_reenvia_el_original`, `test_reintentar_a_mano`, `test_el_aviso_de_otra_empresa_no_existe`; Vitest: `reintentar un aviso fallido llama al servidor y recarga`, `el historial de la empresa filtra por estado y reintenta`) |
| AC-MTZ-043 | Configuración | matriz-obligaciones.feature | La configuración de recordatorios por empresa | Sí (pytest: `test_la_configuracion_nace_con_los_valores_por_defecto`, `test_configurar_exige_permiso_y_el_dia_del_vencimiento_es_fijo`; Vitest: `guarda las anticipaciones, la hora y el escalamiento`, `una anticipación fuera de rango no se agrega`, `sin «configurar» se consulta pero no se cambia`) |
| AC-MTZ-044 | Vista previa | matriz-obligaciones.feature | Vista previa del correo | Sí (pytest: `test_la_vista_previa_no_envia_nada`; Vitest: `la vista previa muestra para, asunto y el cuerpo aislado`, `cambia a la empresa del aviso y se quita de la dirección`) |
| AC-MTZ-045 | Reenvío | matriz-obligaciones.feature | Reenviar un recordatorio | Sí (pytest: `test_reenviar_siempre_sale_y_queda_en_el_historial`, `test_reenviar_exige_permiso`, `test_el_detalle_ofrece_reenviar_solo_a_quien_puede`; Vitest: `reenviar pide confirmación, envía y avisa`, `sin permiso de recordar no ofrece reenviar ni reintentar`) |
| AC-MTZ-046 | Programación e historial | matriz-obligaciones.feature | La programación y el historial de avisos | Sí (pytest: `test_la_programacion_dice_que_salio_y_que_falta`, `test_las_notificaciones_de_la_empresa_exigen_ver_auditoria`; Vitest: `muestra la programación con su estado y el historial de avisos`, `sin «ver_auditoria» no pide el historial`) |

## Matriz de obligaciones, fase 5: reportes y configuración (AC-MTZ-047 a AC-MTZ-056)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-MTZ-047 | Generación | matriz-obligaciones.feature | Los períodos siguientes se generan solos | Sí (pytest: `test_genera_el_siguiente_y_hereda_del_ultimo`, `test_cada_periodicidad_suma_sus_meses`, `test_la_unica_y_la_inactiva_no_generan`, `test_lejos_del_vencimiento_no_genera`, `test_el_ciclo_genera_antes_de_avisar`) |
| AC-MTZ-048 | Generación idempotente | matriz-obligaciones.feature | Generar es idempotente y tiene tope | Sí (pytest: `test_generar_es_idempotente`, `test_no_crea_mas_de_24_por_pasada`) |
| AC-MTZ-049 | Calendario | matriz-obligaciones.feature | El calendario del mes | Sí (pytest: `test_el_calendario_trae_lo_que_vence_en_el_mes`; Vitest: `arma las semanas de domingo a sábado`, `pone cada vencimiento en su día, con «+N más» y el panel al hacer clic`, `navega entre meses y vuelve a hoy`) |
| AC-MTZ-050 | Reporte | matriz-obligaciones.feature | El reporte de cumplimiento | Sí (pytest: `test_el_reporte_calcula_los_porcentajes_y_agrupa`, `test_el_reporte_respeta_el_rango_y_el_alcance`, `test_sin_cerrados_el_porcentaje_es_cero`; Vitest: `muestra los indicadores y las barras, y filtra por rango`) |
| AC-MTZ-051 | Exportaciones | matriz-obligaciones.feature | Exportar a Excel y PDF | Sí (pytest: `test_exportar_exige_permiso_y_queda_auditado`, `test_la_matriz_exportada_tiene_las_filas_de_la_pantalla`; Vitest: `exporta con los mismos filtros`, `sin «exportar» no ofrece los archivos`) |
| AC-MTZ-052 | Auditoría | matriz-obligaciones.feature | La auditoría de la empresa | Sí (pytest: `test_la_auditoria_exige_ver_auditoria_y_filtra`, `test_la_auditoria_de_otra_empresa_no_se_ve`; Vitest: `lista quién hizo qué y filtra por acción`) |
| AC-MTZ-053 | Áreas en la ficha | matriz-obligaciones.feature | Las áreas de la Matriz en la ficha del usuario | Sí (pytest: `test_guardar_la_ficha_conserva_las_areas_de_la_matriz`, `test_las_areas_viajan_por_la_api_de_usuarios`; Vitest: `se marcan por empresa y viajan al guardar`, `sin el catálogo de áreas no se envían y el servidor conserva las que había`) |
| AC-MTZ-054 | Último gestor | matriz-obligaciones.feature | Una empresa no se queda sin quien gestione sus miembros | Sí (pytest: `test_una_empresa_no_se_queda_sin_quien_gestione_sus_miembros`, `test_una_empresa_sin_gestores_no_bloquea_a_nadie` y los 9 casos de `apps/empresas/tests/test_ultimo_gestor.py`: rol, borrado, rol general, permiso directo, deshabilitar, bloquear) |
| AC-MTZ-055 | Acción `remind` | matriz-obligaciones.feature | La acción «Reenviar recordatorio» sigue a la especificación | Sí (pytest: `test_el_detalle_ofrece_reenviar_solo_a_quien_puede`; Vitest: `reenviar pide confirmación, envía y avisa`) |
| AC-MTZ-056 | Menú y Configuración | matriz-obligaciones.feature | El menú y Configuración del módulo | Parcial (revisión manual en el navegador; las rutas las cubren las pruebas de cada pantalla) |

## Matriz de obligaciones: reglas añadidas tras las pruebas funcionales

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-MTZ-057 | Crear para otros | matriz-obligaciones.feature | Crear sin «ver todas» exige figurar, salvo que la empresa lo permita | Sí (pytest: `test_sin_ver_todas_no_se_crea_lo_que_no_se_podria_ver`, `test_la_empresa_puede_permitir_crear_para_otros`, `test_el_ajuste_se_cambia_desde_la_ficha_de_la_empresa`; Vitest: `se explica en el alta y propone a uno mismo como responsable`, `sin la regla, no hay nota ni responsable propuesto`) |

## Lo general del sistema (AC-GEN-001 y AC-GEN-002)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-GEN-001 | Reportes y Configuración generales | matriz-obligaciones.feature | Reportes y Configuración son generales, no de un módulo | Sí (Vitest: `NavegacionGeneral.test.jsx`, 8 casos) |
| AC-GEN-002 | Catálogo único de roles | matriz-obligaciones.feature | Un solo catálogo de roles para todo el sistema | Sí (pytest: `test_un_rol_global_da_permisos_de_la_matriz_como_los_demas`, `test_roles_iniciales.py`, `test_los_roles_generales_traen_la_matriz`) |
| AC-GEN-003 | Notificaciones en Configuración | matriz-obligaciones.feature | Configuración → Notificaciones reúne todos los avisos | Sí (pytest: `apps/core/tests/test_correo_del_sistema.py`, 6 casos; Vitest: `NotificacionesConfiguracion.test.jsx`, `AlertasNotificaciones.test.jsx`, `ConfiguracionMarco.test.jsx`) |
