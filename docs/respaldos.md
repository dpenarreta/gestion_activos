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

**El cuándo se configura en la aplicación**, en *Configuración → Respaldos*,
como un horario:

- **qué días** de la semana (todos, de lunes a viernes, o los que se marquen);
- **a qué horas** de cada uno de esos días —una o varias, hasta ocho—, en
  **hora local** (`TIME_ZONE`, por defecto `America/Guayaquil`);
- en qué carpeta y cuántos conservar.

De fábrica viene **encendido, todos los días a las 17:00**. La tarea del
sistema corre **cada cinco minutos, siempre igual**, y el comando decide si
toca. Cambiar la hora o los días no necesita un administrador de
servidores: el programador de tareas no se vuelve a tocar.

```bash
# Lo que ejecuta la tarea. Sin --si-toca respalda siempre, que es lo que se
# quiere al lanzarlo a mano desde la terminal.
python manage.py respaldar --si-toca
```

### Cómo decide si toca

Cada hora configurada es un **turno**. En cada pasada, el comando busca el
último turno de hoy que ya pasó y lo cubre si no estaba cubierto
(`ultimo_programado`). Con «13:00 y 22:00»:

| La tarea pasa a las… | Hace |
| --- | --- |
| 12:55 | Nada: todavía no es la hora (y lo escribe) |
| 13:00 | El respaldo de las 13:00 |
| 13:05 … 21:55 | Nada: el turno de las 13:00 ya está cubierto |
| 22:00 | El respaldo de las 22:00 |

Si el equipo estuvo apagado en los dos turnos, al encenderse hace **uno**, no
dos seguidos con el mismo contenido. Los turnos de días anteriores no se
recuperan: el siguiente cubre lo mismo y más.

Un respaldo lanzado **a mano** desde la terminal no cuenta como turno, para que
probar el comando un martes no salte el programado.

### Respaldar ahora

El botón **Respaldar ahora** de la pantalla no respalda dentro de la petición
web: un respaldo tarda minutos y bloquea, y una petición que espera tanto acaba
cortada por el navegador o el proxy con el respaldo a medias. Deja la orden
(`solicitado_en`) y la tarea la cumple en su siguiente pasada, como mucho cinco
minutos después; la pantalla avisa cuando termina. Vale también con el respaldo
automático apagado, y pedirlo dos veces no hace dos.

### El resultado queda a la vista

Cada ejecución anota cuándo fue y, si falló, por qué (`ultima_ejecucion`,
`ultimo_error`). La pantalla lo muestra: un respaldo que falla todas las noches
—Docker apagado, disco lleno— no puede quedar solo en una salida que nadie
mira.

### La tarea en Windows

Se registra **una vez**, cada cinco minutos y con `pythonw.exe` para que no
abra una ventana de consola en cada pasada:

```powershell
$b = 'C:\ruta\backend'
$accion  = New-ScheduledTaskAction -Execute "$b\.venv\Scripts\pythonw.exe" -Argument 'scripts\tarea_respaldo.py' -WorkingDirectory $b
$disparo = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -Hidden -Priority 7
Register-ScheduledTask -TaskName 'GestionActivos-Respaldo' -Action $accion -Trigger $disparo -Settings $ajustes -Force
```

**Nunca interrumpe a quien trabaja en el equipo**, cambie como cambie el
horario: los días y las horas se deciden en la aplicación y no tocan la tarea,
que sigue siendo la misma —sin ventana (`pythonw.exe`), oculta (`-Hidden`) y
de prioridad baja (`-Priority 7`)—. El script, además, se suelta de la consola
y baja su propia prioridad si alguien lo lanza con `python.exe`. En la
interfaz web un respaldo automático no muestra nada; solo la pantalla de
Respaldos avisa, y solo de un «Respaldar ahora» que pidió quien la está mirando.
Con permisos de administrador puede registrarse además con
`New-ScheduledTaskPrincipal -LogonType S4U` («ejecutar tanto si el usuario
inició sesión como si no»), que la saca del escritorio del todo.

`scripts/tarea_respaldo.py` existe porque bajo `pythonw.exe` no hay consola
donde escribir: manda la salida a `backend/logs/tarea-respaldo.log` (se recorta
pasado 1 MB). `MultipleInstances IgnoreNew` evita que una pasada empiece
mientras la anterior sigue respaldando.

La misma pasada corre después el ciclo de la Matriz de obligaciones
(`manage.py ciclo_matriz`: recordatorios, escalamientos y reintentos; ver
`docs/matriz-obligaciones.md`). Cada trabajo va por su lado: si el respaldo
falla, los avisos salen igual.

Si se registra con otro intervalo, cambiar también `TAREA_CADA_MINUTOS` en
`apps/core/respaldos_views.py`: la pantalla lo usa para decir cuánto tarda en
empezar un «Respaldar ahora».

### La tarea en Linux

```cron
*/5 * * * * cd /ruta/backend && ./.venv/bin/python manage.py respaldar --si-toca >> logs/tarea-respaldo.log 2>&1
*/5 * * * * cd /ruta/backend && ./.venv/bin/python manage.py ciclo_matriz >> logs/tarea-respaldo.log 2>&1
```

Dos cosas la protegen de repetirse: la marca del último turno cubierto y que
un respaldo lanzado a mano no cuenta como el programado.

### Que el `.bak` salga del contenedor

Con la base en Docker, SQL Server escribe el `.bak` dentro del contenedor. Para
que el respaldo automático lo deje en el disco del host, el `docker-compose.yml`
monta la carpeta:

```yaml
    volumes:
      - mssql_data:/var/opt/mssql
      - ./backend/respaldos/sql:/var/opt/mssql/backup
```

Sin ese montaje el respaldo automático funciona, pero deja la mitad importante
donde no protege: en el mismo sitio que la base.

`verificar_despliegue` avisa si no consta ningún respaldo o si el último tiene
más de una semana.

## Borrar respaldos

*Configuración → Respaldos → Respaldos guardados* lista lo que hay en disco, del
más reciente al más antiguo, con su fecha, si incluye la base y los adjuntos,
qué contenía (según su manifiesto) y cuánto pesa. Cada uno tiene su botón
**Borrar**, que pide confirmación.

- **Se borra entero**: la copia de la base (`.bak`), los adjuntos y el
  manifiesto. Dejar una parte haría creer que hay de dónde volver.
- **El más reciente no se puede borrar.** Su botón aparece deshabilitado con el
  motivo al lado, y el servidor rechaza el borrado (`409`) aunque se pida sin
  pasar por la pantalla.
- **Queda auditado** (`respaldo.borrado`) con quién lo borró, qué archivos eran
  y qué contenía.
- Exige el permiso `configuracion.respaldos`, el mismo que cambiar el horario.

El `.bak` lo escribe SQL Server en su propio sistema de archivos. Para que la
pantalla pueda borrarlo, el backend tiene que ver esa carpeta:
`RESPALDOS_SQL_LOCAL` en el `.env` (con Docker, el volumen de
`docker-compose.yml`: `respaldos/sql`). Sin ella, la lista no muestra la copia
de la base y la pantalla avisa que borrar la deja en el servidor.

La fecha de cada respaldo sale de la marca de su nombre (`AAAAMMDD-HHMM`). Los
anteriores al 14 de octubre de 2026 se nombraron con la hora UTC: aparecen
cinco horas más tarde de lo que fueron.

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

- **La retención de los `.bak`**: «cuántos conservar» retira los adjuntos y
  los manifiestos viejos, no la copia de la base; esa se borra desde la pantalla
  (ver «Borrar respaldos»). Con `INIT` cada
  archivo se sobrescribe a sí mismo, pero los de días distintos se acumulan;
  decidir cuántos conservar es una política de cada empresa.
- **El cifrado del respaldo**. El `.bak` contiene todo el inventario y los
  datos de contacto de los empleados: si sale de la red de la empresa, debe ir
  cifrado.
- **La restauración automática.** Es deliberado: restaurar es una decisión que
  se toma con contexto, no algo que un script deba hacer solo.
