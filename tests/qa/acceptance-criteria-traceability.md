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

## Copias de seguridad (§21)

| ID | Criterio | Archivo `.feature` | Escenario | Automatizado |
| --- | --- | --- | --- | --- |
| AC-BAK-001 | Respalda también los adjuntos | respaldos.feature | El respaldo incluye los adjuntos, no solo la base | Sí (pytest) |
| AC-BAK-002 | No informa lo que no se escribió | respaldos.feature | Un respaldo que no se escribió no se informa como correcto | Sí (pytest) |
| AC-BAK-003 | Verificación de integridad | respaldos.feature | El respaldo se verifica antes de darlo por bueno | Sí (verificado contra SQL Server real) |
| AC-BAK-004 | Manifiesto del contenido | respaldos.feature | Cada respaldo lleva un manifiesto de lo que contenía | Sí (pytest) |
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
