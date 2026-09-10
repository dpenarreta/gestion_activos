# Copias de seguridad y recuperación (§21, «Disponibilidad»)

Hay **dos cosas** que respaldar, y solo una es la base de datos. Los adjuntos
—facturas, actas firmadas, evidencias fotográficas— viven en el sistema de
archivos y **no se regeneran**: un respaldo que solo lleve la base deja el
inventario intacto y todos sus papeles perdidos, que es la mitad de lo que el
§18 pedía conservar.

```bash
python manage.py respaldar --destino /ruta/de/respaldos
```

Hace tres cosas: ordena a SQL Server que escriba el `.bak`, **verifica que se
escribió**, empaqueta los adjuntos y deja un **manifiesto** con lo que había
dentro.

## Por qué el comando verifica

En la primera versión la ruta del archivo iba como parámetro
(`TO DISK = %s`). SQL Server **no admite parámetros ahí**: la sentencia no
escribía nada *y no lanzaba ningún error*. El comando informaba «respaldo
completado» y el archivo no existía.

Un respaldo así no se descubre roto hasta el día que hace falta. Por eso ahora
la verificación (`RESTORE VERIFYONLY`) es parte del respaldo, no un paso
opcional: si el archivo no está o está truncado, el comando falla.

## Dónde queda el `.bak`

Quien escribe ese archivo no es el comando sino **el propio SQL Server**, en su
sistema de archivos. Con la base en un contenedor, eso significa *dentro del
contenedor*:

```
/var/opt/mssql/backup/gestion_activos-20260909-1901.bak
```

Ahí sobrevive a un reinicio del contenedor, pero **no a perder la máquina**,
que es el caso del que un respaldo debe proteger. Dos formas de sacarlo:

```bash
# Puntual
docker cp gestion_activos-mssql-1:/var/opt/mssql/backup/<archivo>.bak .
```

O —mejor para producción— montar un volumen del host en el contenedor y
apuntar ahí:

```yaml
services:
  mssql:
    volumes:
      - mssql_data:/var/opt/mssql
      - /respaldos/sql:/var/opt/mssql/backup   # <- fuera de la máquina virtual
```

```bash
python manage.py respaldar --ruta-servidor /var/opt/mssql/backup
```

Los adjuntos y el manifiesto sí los escribe el comando, así que van
directamente a `--destino`.

## Programarlo

```cron
0 2 * * * cd /ruta/backend && ./.venv/bin/python manage.py respaldar --destino /respaldos
```

`verificar_despliegue` avisa si no consta ningún respaldo o si el último tiene
más de una semana.

## Restaurar

**Este es el procedimiento que casi nadie prueba, y el único que convierte un
archivo en un respaldo.** Restaure siempre en una base **aparte** primero:
sobrescribir la de trabajo para «comprobar» es la forma más rápida de convertir
un simulacro en un incidente.

```sql
-- 1. ¿El archivo está íntegro?
RESTORE VERIFYONLY FROM DISK = '/var/opt/mssql/backup/gestion_activos-20260909-1901.bak';

-- 2. ¿Qué ficheros lógicos contiene?
RESTORE FILELISTONLY FROM DISK = '/var/opt/mssql/backup/gestion_activos-20260909-1901.bak';

-- 3. Restaurar con otro nombre, moviendo los ficheros a rutas nuevas.
RESTORE DATABASE gestion_activos_restaurada
FROM DISK = '/var/opt/mssql/backup/gestion_activos-20260909-1901.bak'
WITH MOVE 'gestion_activos'     TO '/var/opt/mssql/data/restaurada.mdf',
     MOVE 'gestion_activos_log' TO '/var/opt/mssql/data/restaurada.ldf',
     REPLACE;
```

Los adjuntos se restauran descomprimiendo el paquete sobre `MEDIA_ROOT`:

```bash
tar -xzf adjuntos-20260909-1901.tar.gz -C /ruta/backend/media
```

### Y después, comparar

Restaurar sin comparar contra algo es confiar en que el archivo estaba
completo. Para eso está el manifiesto:

```json
"contenido": {
  "activos": 6, "movimientos": 7, "mantenimientos": 9,
  "adjuntos": 1, "empleados": 1, "usuarios": 1
}
```

```sql
SELECT COUNT(*) FROM gestion_activos_restaurada.dbo.activos_activo;      -- 6
SELECT COUNT(*) FROM gestion_activos_restaurada.dbo.adjuntos_adjunto;    -- 1
```

Si los números no coinciden, el respaldo estaba incompleto. Un respaldo
truncado se restaura sin ruido y el hueco se descubre meses después, cuando
alguien busca un acta que no está.

> **Verificado el 2026-09-09** sobre la base de desarrollo: respaldo de 13,1 MB,
> restaurado como `gestion_activos_restaurada`, seis conteos comparados contra
> el manifiesto, todos coincidentes.

## Qué no cubre esto

- **La retención**: el comando no borra respaldos viejos. Con `INIT` cada
  archivo se sobrescribe a sí mismo, pero los de días distintos se acumulan;
  decidir cuántos conservar es una política de cada empresa.
- **El cifrado del respaldo**. El `.bak` contiene todo el inventario y los
  datos de contacto de los empleados: si sale de la red de la empresa, debe ir
  cifrado.
- **La restauración automática.** Es deliberado: restaurar es una decisión que
  se toma con contexto, no algo que un script deba hacer solo.
