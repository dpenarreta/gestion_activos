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

El quinto rol del §13, «Usuario final» (consulta los equipos asignados a sí
mismo), **no se crea**: necesitaría una pantalla que muestre solo lo propio, y
esa vista no existe. Darle `activos.ver` le mostraría el parque entero.

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

1. Cree departamentos, ubicaciones y empleados (o cárguelos y luego corrija).
2. Descargue la plantilla desde *Activos → Carga masiva* y complétela. La
   plantilla trae los catálogos vigentes en hojas aparte, incluidas las
   ubicaciones con el valor exacto que hay que copiar.
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
