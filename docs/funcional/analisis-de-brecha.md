# Análisis de brecha: documento funcional vs. sistema construido

Compara `Sistema_Gestion_Activos_TI.docx` (Documento Funcional v1.0) con el
estado del sistema. Actualizado el 2026-09-08.

El documento es más amplio que los ocho requerimientos con los que arrancó el
desarrollo: cubre 27 secciones e incluye garantías, adjuntos, notificaciones,
dashboard y reportes que no estaban en el alcance inicial.

## Resumen

| Bloque | Estado |
| --- | --- |
| Inventario, código de barras, escáner | Implementado |
| Asignaciones e histórico | Implementado |
| Reparaciones e histórico | Implementado con vacíos (ver abajo) |
| Reglas de reemplazo | Implementado, más simple que lo pedido |
| Usuarios, roles, auditoría | Implementado |
| Dashboard | Implementado |
| Reportes | Exportación a Excel lista; reportes formales pendientes |
| Garantías, adjuntos, notificaciones | No implementado |

## Sección por sección

| § | Requerimiento | Estado | Dónde |
| --- | --- | --- | --- |
| 3 | Tipos de activos configurables | ✅ | `apps.activos.TipoDispositivo` |
| 4.1 | Datos generales del activo | ⚠️ Parcial | Faltan categoría, proveedor, fecha de ingreso y ubicación estructurada |
| 4.2 | Características técnicas | ✅ | Campo `especificaciones`, libre por tipo de equipo |
| 5 | Código de barras + etiqueta + escaneo | ✅ | `barcode.py`, `etiquetas_pdf.py`, `/activos/por-codigo/` |
| 5 | Código QR opcional | ❌ | Solo Code 128 |
| 6 | Asignación y devolución | ⚠️ Parcial | Falta el acta de entrega |
| 7 | Histórico de asignaciones | ✅ | `MovimientoActivo`, append-only |
| 8 | Registro de reparaciones | ⚠️ Parcial | Ver «Vacíos» |
| 9 | Histórico de reparaciones | ⚠️ Parcial | Falta tiempo fuera de operación |
| 10 | Cálculo de tiempos | ⚠️ Parcial | Solo antigüedad desde la compra |
| 11 | Reglas de reemplazo | ⚠️ Parcial | Un solo nivel de alerta, sin ventana temporal |
| 12 | Categorización (criticidad, uso) | ❌ | Solo hay tipo de dispositivo |
| 13 | Usuarios y roles | ✅ | Roles configurables, 28 permisos |
| 14 | Buscador y filtros | ⚠️ Parcial | Faltan filtros de garantía, ubicación y antigüedad |
| 15 | Dashboard | ✅ | `apps/activos/dashboard.py`, `/admin/dashboard` |
| 16 | Reportes y exportación | ⚠️ Parcial | Exportación a Excel del inventario y la bitácora; faltan los 13 reportes y CSV/PDF |
| 17 | Auditoría | ✅ | `AuditLog`, append-only |
| 18 | Adjuntos y evidencias | ❌ | — |
| 19 | Notificaciones y alertas | ❌ | — |
| 20 | Integraciones | ❌ | Fase 3 del propio documento |
| 21 | No funcionales | ⚠️ | Ver «Rendimiento» |

## Vacíos en lo que parece cubierto

Estos importan más que lo directamente ausente, porque a primera vista dan la
impresión de estar resueltos.

**Garantía.** El documento la menciona en seis secciones —campos del activo,
filtros, dashboard, alertas y reportes— y no existe ningún campo de garantía en
el sistema.

**Tiempo fuera de operación.** `Mantenimiento` guarda una sola
`fecha_intervencion`. El documento pide fecha de ingreso *y* de salida, que es
lo que permite calcular los días fuera de operación (§9) y el tiempo acumulado
en reparación (§10).

**Reglas de reemplazo, más finas de lo implementado.** El documento pide dos
niveles —«Evaluar reemplazo» a los 48 meses y «Reemplazo recomendado» a los
60— y una regla con ventana móvil: «más de 3 reparaciones **en 12 meses**». El
motor actual da una alerta binaria y cuenta el acumulado histórico, que nunca
baja aunque el equipo lleve años sin fallar.

**Estados del activo.** Hay 4 (en uso, en bodega, en mantenimiento, dado de
baja); el documento pide 9, sumando en garantía, en tránsito, perdido y robado.

**Campos de la reparación.** Causa y solución van hoy dentro de la descripción;
faltan «garantía usada» y «estado final» (reparado / no reparable / baja).

## Rendimiento

El documento dimensiona entre 5.000 y 10.000 activos. Hay índices en las
columnas por las que se filtra, pero **no se ha probado con ese volumen**:
antes de darlo por válido conviene cargar 10.000 registros y medir el listado
con filtros combinados.

## Diferencia de nomenclatura

El documento propone el código interno como `LAP-000458`; el sistema genera
`GA-LAP-000001`, con un prefijo de empresa por delante. Es una diferencia
cosmética y se puede alinear cambiando `PREFIJO` en `apps/activos/barcode.py`,
pero renumeraría solo los activos nuevos: los ya etiquetados conservan su
código, porque las etiquetas están pegadas en equipos físicos.

## Estado del MVP (§22.1)

**Los 15 puntos de la Fase 1 están implementados** desde el 2026-09-08, con el
dashboard y la exportación a Excel.

De los 10 indicadores del dashboard (§15) se muestran 9. «Garantías vencidas»
queda pendiente hasta que exista el campo de garantía, y el panel lo declara
explícitamente en vez de mostrar un cero que se leería como «ninguna vencida».
