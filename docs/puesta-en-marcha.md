# Puesta en marcha

El sistema está completo como software. Lo que queda para que **sirva a
alguien** no es programación: es configuración del entorno y carga de datos
reales. Esta guía es esa lista, en el orden en que conviene hacerla.

Todo lo verificable se comprueba con un comando:

```bash
python manage.py verificar_despliegue
```

Devuelve código 1 si encuentra algo crítico, así que puede encadenarse en un
script de despliegue. Cada hallazgo dice **qué pasa si no se atiende**, no solo
que está mal.

## 0. Empresas

Todo lo que se registra pertenece a una empresa. La migración creó la primera
con el nombre del sistema y le asignó lo que ya había, así que un despliegue de
una sola empresa funciona sin tocar nada.

Para atender a varias, créelas en **Empresas** (`/admin/empresas`, permiso
`empresas.editar`) y asigne a cada cuenta las suyas desde la ficha del usuario
(permiso `empresas.asignar`).

**En cuanto exista la segunda empresa, la asignación es obligatoria**: mientras
hay una sola, todas las cuentas trabajan en ella sin que nadie marque nada; con
dos, quien no tenga ninguna asignada deja de ver información. Repase los
usuarios en el mismo momento en que cree la segunda, no después. Ver
`docs/multiempresa.md`.

## 0 bis. Parque de demostración (retirar antes de producción)

Mientras se revisa el sistema conviene tener datos dentro: una pantalla vacía no
deja ver si un listado ordena bien, si un filtro combina o si el panel cuenta lo
que debe.

```bash
python manage.py sembrar_datos_demo
```

Siembra en **las dos empresas** —10 equipos, 8 mantenimientos, 6 personas y sus
catálogos en LaarCourier; 5 equipos y 3 mantenimientos en LaarSeguridad— y crea
las cuentas con su empresa y su rol.

La contraseña se genera al azar y **se imprime una sola vez** al terminar; para
fijar una conocida, `DEMO_PASSWORD=...`. Las cuentas nacen obligadas a cambiarla
al entrar: la clave sale por una consola, y una consola se comparte. Todo pasa por los servicios de negocio, así
que los equipos quedan con su código de barras, su movimiento de alta y sus
contadores de renovación calculados. Volver a correrlo no duplica nada.

**Antes de pasar a producción hay que retirarlo:**

```bash
python manage.py sembrar_datos_demo --eliminar
```

`verificar_despliegue` lo comprueba: mientras quede alguna de esas cuentas, el
resultado es **crítico** y el despliegue no está listo. No depende de que nadie
se acuerde.

Retira equipos, mantenimientos, repuestos consumidos, movimientos, adjuntos,
empleados y cuentas de demostración. Los catálogos —áreas, sedes, proveedores,
tipos— solo se van si nadie los usa: si mientras tanto se cargó un equipo real
en «Tecnología», el área ya dejó de ser de demostración. Las empresas nunca se
tocan: son configuración.

## 1. Roles (§13)

```bash
python manage.py crear_roles_iniciales
```

Crea los cuatro roles del documento con sus permisos. Es una **plantilla**: se
ejecuta una vez y a partir de ahí se ajustan desde *Usuarios y roles → Roles*.
Volver a ejecutarlo no pisa lo que se haya cambiado (`--actualizar` sí).

| Rol | Qué puede | Qué no, y por qué |
| --- | --- | --- |
| **Administrador** | Todo el catálogo | — Existe para no depender de una cuenta de superusuario en el día a día: el superusuario se salta el catálogo entero y no deja ver qué puede hacer |
| **Soporte TI** | Registra activos, asigna, repara, adjunta | **No da de baja** (el §13 pone la aprobación en el supervisor) ni **borra adjuntos** (son evidencia) |
| **Supervisor TI** | Aprueba bajas, define reglas de reemplazo, exporta reportes | **No crea ni edita fichas**: la separación es lo que hace que la aprobación signifique algo |
| **Consulta / Auditoría** | Ve y exporta todo el histórico | **No modifica nada** ni ve la ubicación de la auditoría, que es un dato personal y se concede aparte |
| **Usuario final** | Consulta los equipos que tiene a su cargo | **No ve el inventario**: ni el parque, ni los custodios de los demás, ni los costos |

El quinto rol, **«Usuario final»**, lleva un único permiso
—`activos.ver_asignados`— y ahí está todo su sentido: abre *Mis equipos*, que
muestra los equipos de quien pregunta, y nada más. Con `activos.ver`, que es el
permiso que parece el equivalente, vería el parque entero.

*Mis equipos* **no aparece en el menú lateral**: es una vista personal y no una
de operación, y en la barra de quien administra el parque solo estorbaba. Quien
tiene ese rol entra directamente a ella al abrir el sistema, y cualquiera puede
llegar por `/admin/mis-equipos`.

Para que sirva, **cada cuenta debe estar enlazada a su ficha de empleado**
desde *Organización → Empleados*: es ese vínculo el que dice qué equipos son
suyos. Sin él, la pantalla lo dice en vez de mostrarse vacía.

La ficha pertenece a una empresa. Quien trabaje en dos y tenga ficha en una
sola verá sus equipos al cambiar a esa empresa en el selector del menú; la
pantalla dice en cuál está, para no tener que adivinarlo.

Después: cree una cuenta por persona con su rol y **deje el superusuario solo
para emergencias**.

## 2. Correo

Sin esto, el aviso de alertas se da por enviado y el mensaje se imprime en el
log del servidor: la bitácora dirá que salió y nadie lo habrá recibido.

En `backend/.env`:

```bash
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.empresa.com
EMAIL_PORT=587
EMAIL_HOST_USER=avisos@empresa.com
EMAIL_HOST_PASSWORD=...
EMAIL_USE_TLS=True
DEFAULT_FROM_EMAIL=avisos@empresa.com
```

`DEFAULT_FROM_EMAIL` importa: el valor por defecto se deriva del nombre del
sistema y es un dominio `.local` inexistente. Un remitente que no resuelve
termina en la carpeta de correo no deseado, donde un aviso no avisa a nadie.

Compruébelo antes de activarlo, desde *Alertas → Configurar alertas → Enviar
una prueba a mi correo*: escribe solo a quien lo pide.

## 3. Tareas programadas

Dos, ambas **diarias**. Sin ellas el sistema no falla: deja de avisar en
silencio, que es peor.

| Comando | Qué pasa si no corre |
| --- | --- |
| `python manage.py recalcular_indicadores` | Un equipo que nadie toca **nunca** aparecerá como próximo a reemplazo: ese criterio se cumple por el paso del tiempo y ningún evento lo dispara |
| `python manage.py enviar_alertas` | Nadie recibe el resumen. La frecuencia real (diaria o semanal) la decide la configuración, no el crontab: por eso este comando se programa todos los días |

En Linux (`crontab -e`):

```cron
0 5 * * * cd /ruta/backend && ./.venv/bin/python manage.py recalcular_indicadores
0 7 * * * cd /ruta/backend && ./.venv/bin/python manage.py enviar_alertas
```

En Windows, Programador de tareas: una tarea diaria por comando, apuntando a
`backend\.venv\Scripts\python.exe` con el directorio de trabajo en `backend\`.

`verificar_despliegue` detecta si alguna no está corriendo: mira la fecha de la
última evaluación de indicadores y la última fila de la bitácora de envíos.

## 4. Copias de seguridad

```cron
0 2 * * * cd /ruta/backend && ./.venv/bin/python manage.py respaldar --destino /respaldos
```

Respalda la base **y los adjuntos** —las facturas y actas firmadas no se
regeneran—, verifica que el archivo se escribió y deja un manifiesto con los
conteos para comparar después de restaurar.

Un respaldo que nunca se ha restaurado no es un respaldo: el procedimiento de
restauración, probado, está en `docs/respaldos.md`. Léalo antes de necesitarlo.

## 5. Despliegue

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Levanta SQL Server, el backend con Gunicorn (migraciones automáticas al
arrancar) y el frontend servido por nginx. Antes:

- `DEBUG=False` — con DEBUG, cualquier error muestra la traza completa, con
  rutas y fragmentos de configuración, a quien lo provoque.
- `SECRET_KEY` propia y larga: con ella se firman los tokens de sesión.
- `ALLOWED_HOSTS` acotado a los dominios reales.
- Repetir la **medición de concurrencia** contra este stack: las cifras de
  `docs/rendimiento.md` se tomaron con el servidor de desarrollo, que es
  monoproceso (`manage.py prueba_de_carga --url https://...`).

## 6. Carga del inventario real

Es el **riesgo número uno** del §26 del documento funcional, y el que decide si
el sistema se usa o se abandona.

1. Cree los catálogos desde *Organización*: sedes, departamentos, proveedores,
   concesionarios y empleados. Si son muchos, use *Organización → Carga de
   catálogos*: cada uno tiene su propio archivo, que se descarga con lo que ya
   está registrado dentro y se sube con las filas nuevas añadidas debajo.

   Los **concesionarios** solo hacen falta si algún partner pone equipos para
   operar con ustedes. No es lo mismo que un proveedor: al proveedor se le
   compró el equipo, y el concesionario es su dueño —la compra corre por su
   cuenta y el mantenimiento por la de ustedes—.

   Rellene la **ciudad** de cada sede. No es un dato de adorno: es lo que se
   lee al preguntar dónde está un equipo —«está en Quito»— y lo que aparece en
   la ficha, en el traslado y en los reportes. Una sede sin ciudad responde con
   su nombre interno, que a quien tiene que ir a buscar el equipo no le dice
   nada.
2. Descargue la plantilla desde *Activos → Carga masiva* y complétela. La
   plantilla trae los catálogos vigentes en hojas aparte, incluidas las sedes
   con el nombre exacto que hay que copiar.
3. Suba el archivo: el sistema **valida todo antes de guardar nada** y muestra
   los errores fila por fila.
4. Imprima y pegue las etiquetas. Es el riesgo número siete del documento: sin
   etiqueta física, el escáner no sirve y el inventario se hace a mano otra vez.
   Ver `docs/codigos-de-barras.md` — imprimir a **tamaño real**, nunca
   «ajustar a la página».

Un consejo sobre el orden: cargue primero un lote pequeño y recórralo con la
pistola antes de etiquetar cientos de equipos. Los problemas de impresión se
descubren con el lector en la mano, no en la pantalla.

## Lo que sigue sin estar

- **Integraciones** del §20 (Active Directory, RRHH, tickets, ERP). El §25 las
  clasifica como prioridad baja.
- **Rol «Usuario final»**, que necesita una pantalla de «mis equipos».
- **Concurrencia medida contra producción**, no contra el servidor de
  desarrollo.
