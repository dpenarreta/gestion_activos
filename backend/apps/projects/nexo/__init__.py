"""Migración única de lo que queda de Gestión Humana en Nexo (fase 2b).

- `lector`: lee de Nexo, con SQL crudo y solo SELECT, Proyectos (con su
  papelera), Ausencias (`LeaveRecord`, `SpecialStatus`) y lo que persiste el
  motor de KPI (`AnalyticsAuditLog`, `User.kpi_start_date` y sus ajustes).
- `importador`: lo crea en una empresa de la intranet, remapea ids, renombra
  el rol ADMINISTRADOR, guarda los documentos como archivo y verifica conteos
  y sumas. Lo usa `manage.py importar_nexo_gh`.

Vive en `apps.projects` porque Proyectos es el grueso y lo único que escribe
archivos; Ausencias y KPI van en la misma pasada porque comparten usuarios,
ajustes y la misma verificación. Lo común con las otras importaciones está en
`apps.novedades.nexo.comun`.
"""
