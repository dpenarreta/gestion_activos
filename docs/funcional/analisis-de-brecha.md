# Análisis de brecha: documento funcional vs. sistema construido

Compara `Sistema_Gestion_Activos_TI.docx` (Documento Funcional v1.0) con el
estado del sistema. Actualizado el 2026-09-08 (garantías y reparación).

El documento es más amplio que los ocho requerimientos con los que arrancó el
desarrollo: cubre 27 secciones e incluye garantías, adjuntos, notificaciones,
dashboard y reportes que no estaban en el alcance inicial.

## Resumen

| Bloque | Estado |
| --- | --- |
| Inventario, código de barras, escáner | Implementado |
| Asignaciones e histórico | Implementado |
| Reparaciones e histórico | Implementado |
| Reglas de reemplazo | Implementado |
| Usuarios, roles, auditoría | Implementado |
| Dashboard | Implementado |
| Reportes | Exportación a Excel lista; reportes formales pendientes |
| Garantías | Implementado |
| Adjuntos, notificaciones | No implementado |

## Sección por sección

| § | Requerimiento | Estado | Dónde |
| --- | --- | --- | --- |
| 3 | Tipos de activos configurables | ✅ | `apps.activos.TipoDispositivo` |
| 4.1 | Datos generales del activo | ⚠️ Parcial | Proveedor y garantía ya se registran; faltan categoría, fecha de ingreso y ubicación estructurada |
| 4.2 | Características técnicas | ✅ | Campo `especificaciones`, libre por tipo de equipo |
| 5 | Código de barras + etiqueta + escaneo | ✅ | `barcode.py`, `etiquetas_pdf.py`, `/activos/por-codigo/` |
| 5 | Código QR opcional | ❌ | Solo Code 128 |
| 6 | Asignación y devolución | ⚠️ Parcial | Falta el acta de entrega |
| 7 | Histórico de asignaciones | ✅ | `MovimientoActivo`, append-only |
| 8 | Registro de reparaciones | ✅ | Causa, solución, estado final, garantía usada e ingreso/salida |
| 9 | Histórico de reparaciones | ✅ | Días fuera de operación por intervención y acumulados |
| 10 | Cálculo de tiempos | ⚠️ Parcial | Antigüedad y tiempo en reparación; falta tiempo de asignación por custodio |
| 11 | Reglas de reemplazo | ✅ | Dos niveles (evaluar / recomendado) y ventana móvil configurable |
| 12 | Categorización (criticidad, uso) | ❌ | Solo hay tipo de dispositivo |
| 13 | Usuarios y roles | ✅ | Roles configurables, 32 permisos |
| 14 | Buscador y filtros | ⚠️ Parcial | Filtro de garantía disponible; faltan ubicación y antigüedad |
| 15 | Dashboard | ✅ | `apps/activos/dashboard.py`, `/admin/dashboard` |
| 16 | Reportes y exportación | ⚠️ Parcial | Exportación a Excel del inventario y la bitácora; faltan los 13 reportes y CSV/PDF |
| 17 | Auditoría | ✅ | `AuditLog`, append-only |
| 18 | Adjuntos y evidencias | ❌ | — |
| 19 | Notificaciones y alertas | ⚠️ Parcial | Las siete alertas están en el sistema; falta el envío por correo |
| 20 | Integraciones | ❌ | Fase 3 del propio documento |
| 21 | No funcionales | ⚠️ | Ver «Rendimiento» |

## Vacíos en lo que parece cubierto

Estos importan más que lo directamente ausente, porque a primera vista dan la
impresión de estar resueltos.

**Estados del activo.** Hay 4 (en uso, en bodega, en mantenimiento, dado de
baja); el documento pide 9, sumando en garantía, en tránsito, perdido y robado.

**Notificación proactiva.** Las siete alertas del §19 se calculan y se
muestran en su propia pantalla, pero nadie recibe nada sin entrar a mirarla: el
envío por correo sigue pendiente y necesita un servidor SMTP configurado.

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

**Los 10 indicadores del dashboard (§15) se calculan**, incluidas las
garantías vencidas y por vencer, desde que se incorporó la fecha de fin de
garantía. El panel distingue «sin garantía registrada» de «vencida»: mezclarlas
haría que un inventario a medio capturar pareciera un parque sin cobertura.

### Fase 2 — centro de alertas (§19, §22.2)

- Las siete alertas del documento, calculadas al vuelo: próximos a reemplazo,
  garantías por vencer, demasiadas reparaciones, sin asignar, reparaciones sin
  cerrar, custodios inactivos y fichas sin actualizar.
- Umbrales en días configurables y cada alerta se puede apagar.
- Cada tarjeta enlaza al listado ya filtrado; para ello se sumaron los filtros
  de custodio inactivo, días sin actualizar y reparaciones pendientes.

### Fase 2 — reglas automáticas de reemplazo (§22.2)

- Dos niveles de sugerencia: «Evaluar reemplazo» y «Reemplazo recomendado»,
  con un umbral de antigüedad para cada uno.
- Ventana móvil configurable para el conteo de reparaciones («más de 3 en 12
  meses»). Vacía = todo el historial, que es el comportamiento anterior.
- El veredicto de un activo es el nivel más severo de sus motivos; el panel,
  el inventario y las sugerencias distinguen ambos niveles.

### Cerrado el 2026-09-08 (garantías y reparación)

- Proveedor y fecha de fin de garantía en la ficha, con estado derivado
  (vigente / por vencer a 30 días / vencida / sin registrar) y filtro en el
  inventario resuelto en SQL.
- Fecha de salida de la reparación, con los días fuera de operación por
  intervención, por activo y acumulados en el panel.
- Causa, solución, estado final y «cubierto por garantía» en la bitácora.
- Todo ello disponible también en la plantilla de carga masiva y en la
  exportación a Excel.
