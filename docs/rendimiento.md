# Rendimiento con el parque completo (§21)

El documento funcional dimensiona entre **5.000 y 10.000 activos**. Hasta el
2026-09-09 el sistema solo se había probado con decenas: los índices estaban
puestos, pero «los índices están puestos» y «la pantalla abre rápido con 10.000
filas» son afirmaciones distintas, y la segunda no se deduce de la primera.

Esta es la medición, lo que encontró y lo que se corrigió.

## Cómo reproducirla

Todo corre contra una **base separada**, nunca contra la de trabajo: sembrar
diez mil equipos falsos sobre el inventario real lo dejaría inservible, y
borrarlos después no es trivial porque cada activo arrastra movimientos,
mantenimientos y auditoría. El comando de siembra se niega a ejecutarse si el
nombre de la base no termina en `_perf`.

```bash
# 1. Base de pruebas (una vez)
#    CREATE DATABASE gestion_activos_perf;  + permisos al usuario de la app
DB_NAME=gestion_activos_perf python manage.py migrate

# 2. Parque sintético: 10.000 activos, sus movimientos y su bitácora
DB_NAME=gestion_activos_perf python manage.py sembrar_datos_rendimiento --activos 10000

# 3. Medición de una petición a la vez
DB_NAME=gestion_activos_perf python manage.py medir_rendimiento --repeticiones 3

# 4. Concurrencia: contra un servidor levantado sobre esa misma base
DB_NAME=gestion_activos_perf python manage.py runserver 8011 --noreload
DB_NAME=gestion_activos_perf python manage.py prueba_de_carga --usuarios 20 --rondas 5
```

La siembra usa una semilla fija: dos corridas producen el mismo parque, así que
dos mediciones son comparables entre sí.

## Qué se midió

10.000 activos (9.175 operativos), 12.713 movimientos, 11.214 intervenciones y
tres políticas de renovación activas. Máquina de desarrollo, SQL Server 2022 en
Docker, servidor de desarrollo de Django.

`medir_rendimiento` informa **tiempo y número de consultas**. Lo segundo
importa tanto como lo primero: un tiempo alto puede deberse a una máquina
lenta, pero doscientas consultas para pintar veinte filas son siempre el mismo
defecto y se ven igual en cualquier hardware.

## Resultados

| Operación | Antes | Después |
| --- | --- | --- |
| Inventario, primera página | 24 ms · 2 consultas | igual |
| Inventario, página 50 | 43 ms · 2 consultas | igual |
| Inventario, filtros combinados | 18 ms · 2 consultas | igual |
| Inventario, búsqueda por texto | 85 ms · 2 consultas | igual |
| Escáner por código de barras | 31 ms | igual |
| Bitácora de mantenimientos | 40 ms · 3 consultas | igual |
| **Panel principal** | **55.213 ms · 8.972 consultas** | **365 ms · 31 consultas** |
| **Centro de alertas** | **61.128 ms** | **741 ms · 23 consultas** |
| **Sugerencias de renovación** | **55.687 ms** | **1.081 ms · 11 consultas** |
| Exportación del inventario a Excel | 7,7 s · 1,3 MB | igual |

**El inventario nunca fue el problema**: con filtros combinados responde en 18
ms y dos consultas, exactamente lo que el §21 pedía asegurar. Lo que estaba mal
eran las tres pantallas que agregan el parque entero.

## Los dos defectos que encontró

### 1. Una consulta de política por activo

`evaluar_lote` resolvía la política de cada tipo y se la pasaba a
`evaluar_activo`. Pero cuando un tipo **no tiene política**, le pasaba `None`, y
`evaluar_activo` interpretaba `None` como «no me la pasaron, la busco yo». Con
9.175 activos operativos: **9.000 consultas** y 55 segundos.

El defecto era invisible con pocos datos —con veinte activos, mil consultas
tardan lo mismo que dos— y también invisible en un sistema con políticas para
todos los tipos. Bastaba un tipo sin política para que todos sus activos
pagaran una consulta cada uno.

Se corrigió con un centinela (`SIN_RESOLVER`) que distingue «no me pasaron
política» de «este tipo no tiene». Fijado en
`apps/politicas/tests/test_rendimiento.py`.

### 2. Traer el parque entero para descartar el 95 %

Las tres pantallas evaluaban los 9.175 activos en Python para quedarse con unos
pocos cientos. Ahora `candidatos_a_renovacion` prefiltra en SQL a los que
superan algún umbral.

El prefiltro es **deliberadamente más ancho que el criterio final**: usa el
total histórico de mantenimientos aunque la política cuente una ventana móvil.
El total siempre es mayor o igual que el de la ventana, así que ningún
candidato se pierde; a lo sumo entran algunos que la evaluación descarta
después. Al revés —un filtro más estrecho que el criterio— escondería equipos
que sí hay que reemplazar, y el panel diría que el parque está mejor de lo que
está. Hay una prueba que verifica justamente esa relación de contención.

Los endpoints de reevaluación **no** usan el prefiltro: ellos recorren el parque
completo porque además de encender la marca deben apagarla en los que dejaron
de calificar.

## Concurrencia

`prueba_de_carga` lanza peticiones simultáneas contra un servidor real.

| Operación | 5 simultáneas | 20 simultáneas |
| --- | --- | --- |
| Inventario | 129 ms | 666 ms |
| Inventario filtrado | 118 ms | 692 ms |
| Búsqueda | 223 ms | 785 ms |
| Bitácora | 131 ms | 695 ms |
| Panel principal (caché fría) | 5.689 ms | 17.591 ms |
| Centro de alertas (caché fría) | 7.626 ms | 22.863 ms |

Dos lecturas, y conviene no confundirlas:

- **El inventario aguanta.** A 20 simultáneas se degrada a 666 ms, que es
  aceptable para un pico.
- **El panel y las alertas son CPU de Python.** Aunque cada uno cueste 365 y
  741 ms en solitario, cinco a la vez se acumulan porque el intérprete los
  serializa. Por eso ambos se cachean (`CACHE_AGREGADOS_SEGUNDOS`, 120 s por
  defecto): con la caché caliente responden en **18–31 ms**. Un cambio en la
  configuración de alertas la invalida de inmediato — si alguien apaga una
  alerta y sigue apareciendo, el sistema parece roto.

**Estas cifras miden el servidor de desarrollo**, que es monoproceso: la
degradación casi lineal con la concurrencia lo delata. El despliegue real usa
Gunicorn con varios workers (`docker-compose.prod.yml`), donde el trabajo se
reparte entre procesos y estos números mejoran de forma proporcional a los
workers. **La medición de concurrencia debe repetirse contra ese stack antes de
salir a producción**; lo que sí es independiente del servidor es el número de
consultas, y eso ya está fijado por pruebas.

## Lo que queda como límite conocido

- **Sugerencias de renovación: ~1 segundo.** El recuento exacto por nivel
  obliga a evaluar todos los candidatos, y con la mitad del parque pasada de
  vida útil son unos miles. La respuesta se acota a 200 filas (el recuento
  sigue siendo el total); para llevárselas todas está el reporte «Activos
  próximos a reemplazo» del §16.
- **Exportación del inventario completo: ~8 segundos** para 10.000 filas y 1,3
  MB. Es una descarga, no una pantalla, y el archivo se genera en streaming.
  Si llegara a molestar, el camino es generarla en segundo plano y avisar
  cuando esté lista.
- **La caché es por proceso** (`LocMemCache`): con varios workers cada uno
  tendrá el suyo, lo que multiplica el trabajo por el número de workers pero no
  produce datos incoherentes. Un despliegue con Redis solo cambia el bloque
  `CACHES` de la configuración.
