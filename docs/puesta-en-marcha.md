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

**Revisa la configuración con la que se lo invoca.** En un portátil, con la de
desarrollo, siempre saldrán al menos dos críticos —`DEBUG` encendido y las
cuentas de demostración— y está bien que salgan: es lo que pasaría si *esa*
configuración se desplegara. Para la puerta de verdad, contra la máquina que va
a producción:

```bash
python manage.py verificar_despliegue --settings=config.settings.production
```

El comando lo avisa solo cuando no se está mirando producción, para que nadie
aprenda a ignorar dos críticos que salen siempre.

## 0. Empresa

**El sistema trabaja con una sola empresa** (`MULTIEMPRESA=False`, el valor
por defecto). La migración la creó con el nombre del sistema; complete sus
datos en **Configuración → Empresa** (`/admin/empresas`, permiso
`empresas.editar`). No se pueden crear otras, y cada cuenta nueva entra sola a
esta empresa y recibe el rol de su cargo: no hay que asignarle empresa.

Si algún día el despliegue debe atender a varias empresas del grupo, ponga
`MULTIEMPRESA=True` en el `.env`, reinicie y créelas en **Configuración →
Empresas**. Desde que exista la segunda, **la asignación es obligatoria**:
quien no tenga ninguna asignada deja de ver información, así que repase los
usuarios en ese mismo momento. Ver `docs/multiempresa.md`.

## 0 bis. Parque de demostración (retirar antes de producción)

Mientras se revisa el sistema conviene tener datos dentro: una pantalla vacía no
deja ver si un listado ordena bien, si un filtro combina o si el panel cuenta lo
que debe.

```bash
python manage.py sembrar_datos_demo
```

Siembra 10 equipos, 8 mantenimientos, 6 personas y sus catálogos en
LaarCourier y crea las cuentas con su rol. Si existe una segunda empresa
(LaarSeguridad, solo con `MULTIEMPRESA=True`), siembra también sus 5 equipos y
3 mantenimientos; si no existe, la omite y lo avisa.

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

Crea el catálogo general de roles —los cinco del documento funcional y los dos
de cumplimiento de la Matriz— con sus permisos. Es una **plantilla**: se
ejecuta una vez y a partir de ahí se ajustan desde *Usuarios y roles → Roles*.
Volver a ejecutarlo no pisa lo que se haya cambiado (`--actualizar` sí).

| Rol | Qué puede | Qué no, y por qué |
| --- | --- | --- |
| **Administrador** | Todo el catálogo | — Existe para no depender de una cuenta de superusuario en el día a día: el superusuario se salta el catálogo entero y no deja ver qué puede hacer |
| **Soporte TI** | Registra activos, asigna, repara, adjunta | **No da de baja** (el §13 pone la aprobación en el supervisor) ni **borra adjuntos** (son evidencia) |
| **Supervisor TI** | Aprueba bajas, define reglas de reemplazo, exporta reportes | **No crea ni edita fichas**: la separación es lo que hace que la aprobación signifique algo |
| **Consulta / Auditoría** | Ve y exporta todo el histórico | **No modifica nada** ni ve la ubicación de la auditoría, que es un dato personal y se concede aparte |
| **Usuario final** | Consulta los equipos que tiene a su cargo | **No ve el inventario**: ni el parque, ni los custodios de los demás, ni los costos |
| **Responsable de cumplimiento** | Prepara las obligaciones a su cargo: crea, carga evidencia, envía y reenvía recordatorios | **No ve las ajenas** ni valida: ve y actúa solo sobre lo suyo |
| **Supervisor de cumplimiento** | Ve todas las obligaciones, valida o devuelve los cierres, cambia fechas, exporta | **No carga ni envía**: la separación de funciones es la que da valor a la validación |

Los roles son **generales del sistema**: el Administrador tiene también toda la
Matriz y Consulta / Auditoría la ve toda.

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

Con varias empresas (`MULTIEMPRESA=True`), la ficha pertenece a una de ellas:
quien trabaje en dos y tenga ficha en una sola verá sus equipos al cambiar a
esa empresa en el selector de la barra superior.

Después: cree una cuenta por persona con su rol y **deje el superusuario solo
para emergencias**.

## 2. Correo

Sin esto, el aviso de alertas se da por enviado y el mensaje se imprime en el
log del servidor: la bitácora dirá que salió y nadie lo habrá recibido.

En `backend/.env`. Los valores de Laar, salvo la clave, que se pide a Sistemas
y **no se escribe en ningún archivo versionado**:

```bash
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=inboundlaarcouriernew.alphaside.com
EMAIL_PORT=2524
EMAIL_HOST_USER=notificacioneslce@laarcourierdocs.com
EMAIL_HOST_PASSWORD=<clave-del-buzon>
EMAIL_USE_TLS=True
DEFAULT_FROM_EMAIL=notificacioneslce@laarcourierdocs.com
```

**El puerto es el 2524**, que no es uno de submission habitual; el servidor
anuncia `STARTTLS`, así que la conexión se abre en claro y se cifra antes de
autenticar. Por eso `EMAIL_USE_TLS=True` y no SSL: SSL cifraría desde el primer
byte y en ese puerto no hay nadie escuchando así.

`DEFAULT_FROM_EMAIL` importa: el valor por defecto se deriva del nombre del
sistema y es un dominio `.local` inexistente. Un remitente que no resuelve
termina en la carpeta de correo no deseado, donde un aviso no avisa a nadie.

Para comprobar el servidor sin enviar nada —útil si cambian el puerto o la
clave— basta con conectar y autenticar:

```bash
python -c "import smtplib,ssl,os; s=smtplib.SMTP(os.environ['EMAIL_HOST'],int(os.environ['EMAIL_PORT']),timeout=20); s.ehlo(); s.starttls(context=ssl.create_default_context()); s.ehlo(); s.login(os.environ['EMAIL_HOST_USER'],os.environ['EMAIL_HOST_PASSWORD']); print('autentica')"
```

Compruébelo antes de activarlo, desde *Configuración → Notificaciones → Correo
del sistema → Enviar una prueba a mi correo*: escribe solo a quien lo pide y
dice el motivo si falla. Esa pantalla muestra también por dónde sale el correo
(servidor, puerto, cifrado, remitente, espera máxima y la dirección a la que
llevan los botones de los avisos), sin la clave.

Para revisar **cómo se ven** los avisos de mantenimiento al llegar —los
clientes de correo corporativos descartan hojas de estilo y tratan las tablas a
su manera, así que lo que se ve bien en el navegador puede llegar ilegible—:

```bash
python manage.py enviar_avisos_de_muestra --a alguien@empresa.com
```

Manda una muestra de cada situación que el sistema puede avisar, marcada como
tal en el asunto. No toca la base: arma los equipos en memoria y los pasa por
la misma plantilla que usa el envío real, así que revisar un texto no ensucia
el inventario con equipos de prueba.

## 3. Tareas programadas

Tres. Las dos primeras, **diarias**; la del respaldo, **horaria** (ver el
punto 4). Sin ellas el sistema no falla: deja de avisar —o de respaldar— en
silencio, que es peor.

| Comando | Qué pasa si no corre |
| --- | --- |
| `python manage.py recalcular_indicadores` | Un equipo que nadie toca **nunca** aparecerá como próximo a reemplazo: ese criterio se cumple por el paso del tiempo y ningún evento lo dispara |
| `python manage.py enviar_alertas` | Nadie recibe el resumen. La frecuencia real (diaria o semanal) la decide la configuración, no el crontab: por eso este comando se programa todos los días |
| `python manage.py respaldar --si-toca` | No hay copias. Igual que el resumen de alertas, el horario lo decide la configuración y no el crontab: por eso se programa **cada cinco minutos** y el comando decide si toca |

En Linux (`crontab -e`):

```cron
0 5 * * * cd /ruta/backend && ./.venv/bin/python manage.py recalcular_indicadores
0 7 * * * cd /ruta/backend && ./.venv/bin/python manage.py enviar_alertas
*/5 * * * * cd /ruta/backend && ./.venv/bin/python manage.py respaldar --si-toca
```

En Windows, Programador de tareas: una tarea diaria por comando, apuntando a
`backend\.venv\Scripts\python.exe` con el directorio de trabajo en `backend\`.

`verificar_despliegue` detecta si alguna no está corriendo: mira la fecha de la
última evaluación de indicadores y la última fila de la bitácora de envíos.

## 4. Copias de seguridad

**El cuándo se configura en la aplicación**, en *Configuración → Respaldos*:
si está encendido, qué días, a qué horas (una o varias, en hora local), en qué
carpeta y cuántos conservar; y desde ahí mismo, **Respaldar ahora**. La tarea
del sistema corre **cada cinco minutos, siempre igual**, y el comando decide si
toca:

```cron
*/5 * * * * cd /ruta/backend && ./.venv/bin/python manage.py respaldar --si-toca
```

Cada cinco minutos y no una vez al día: es lo que permite que la hora se elija
desde la pantalla, al minuto, sin tocar el programador de tareas. Sin `--si-toca` el comando respalda
siempre —que es lo que se quiere al lanzarlo a mano—, así que programarlo así
ignoraría la política, haría copias incluso con el respaldo apagado y no
dejaría constancia de que fue el programado. En Windows, la tarea equivalente
se registra una vez, cada cinco minutos y con `pythonw.exe` para que no abra
una consola en cada pasada (ver `docs/respaldos.md`).

Respalda la base **y los adjuntos** —las facturas y actas firmadas no se
regeneran—, verifica que el archivo se escribió y deja un manifiesto con los
conteos para comparar después de restaurar. Con la base en Docker, el
`docker-compose.yml` monta la carpeta donde SQL Server escribe el `.bak` para
que salga del contenedor.

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
- Decidir el **plazo de inactividad** de la sesión
  (`SESSION_IDLE_TIMEOUT_MINUTES`, cuatro horas por defecto). Es deslizante:
  cuenta desde la última petición, así que mide inactividad y no duración. En
  equipos compartidos conviene bajarlo.
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
- **Concurrencia medida contra producción**, no contra el servidor de
  desarrollo.

## Instalarla en el teléfono

La aplicación es instalable: quien hace el inventario físico se la lleva en el
bolsillo, con el escáner en la mano y sin un escritorio cerca.

**Hace falta HTTPS.** Es un requisito del navegador, no de este sistema: sobre
`http://` no ofrece instalarla y el service worker ni siquiera se registra. En
`localhost` sí funciona, que es como se prueba.

Desde el teléfono, con el sistema abierto: en Android, el menú del navegador
ofrece *Instalar aplicación* o *Añadir a la pantalla de inicio*; en iPhone,
*Compartir → Añadir a pantalla de inicio*. Queda con su icono, abre sin barra de
direcciones y entra directamente al panel. Manteniendo pulsado el icono
aparecen dos atajos: la consulta por escáner y «mis equipos».

**Sigue necesitando red para consultar.** Se guarda el armazón de la aplicación
—para que arranque y para poder decir qué pasa cuando no hay señal—, pero
**ningún dato del inventario**: enseñar el de ayer sería peor que no enseñar
nada, porque un dato viejo no se nota y un error sí. Trabajar sin conexión
—capturar lecturas en una bodega sin señal y subirlas después— es una decisión
pendiente, no un olvido: exige acordar antes qué pasa cuando dos personas
inventarían el mismo equipo.

Para comprobar que todo eso quedó bien tras un despliegue:

```bash
cd frontend
npm run build
npm run preview -- --port 4179 --strictPort   # en otra terminal
npm run pwa:verificar
```
