"""Migración única del Control Operativo de Novedades desde Nexo.

- `lector`: lee la base de Nexo con SQL crudo (solo SELECT), sin modelos.
- `importador`: crea los registros en una empresa de la intranet, remapea ids
  y verifica conteos y sumas. Lo usa `manage.py importar_nexo`.
"""
