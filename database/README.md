# database/

Este directorio no contiene datos ni volcados de base de datos (deliberado:
ver `docs/database.md`, sección "Semillas de datos" — no se versiona
ningún dato productivo).

Se mantiene como punto de referencia para scripts de administración de la
base de datos que un proyecto concreto quiera sumar (por ejemplo, scripts
de respaldo/restauración específicos de su infraestructura). Las
migraciones de esquema y de siembra viven donde Django las espera, dentro
de cada app (`backend/apps/*/migrations/`).
