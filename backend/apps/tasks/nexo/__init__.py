"""Migración única de Tareas (Gestión Humana) desde Nexo.

- `lector`: lee las tablas de Tareas de Nexo con SQL crudo (solo SELECT).
- `importador`: las crea en una empresa de la intranet, remapea ids, renombra
  el rol ADMINISTRADOR y verifica conteos y sumas. Lo usa
  `manage.py importar_nexo_tareas`.

Lo común con la importación de Novedades vive en `apps.novedades.nexo.comun`.
"""
