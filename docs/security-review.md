# Revisión de seguridad

Checklist de los controles de seguridad del sistema, con el estado real de
cada punto verificado en este repositorio. **Este documento es el criterio de seguridad del proyecto:**
todo módulo de negocio nuevo debe cumplirlo, y cualquier control que se
relaje debe quedar registrado aquí como limitación, no omitido.

Última verificación: 2026-09-10 (revisión a fondo tras la separación por
empresas: nueve hallazgos, todos corregidos — ver «Revisión del 10 de
septiembre» más abajo).

| Control | Estado | Detalle |
| --- | --- | --- |
| Hash seguro de contraseñas | ✅ | Argon2 (`PASSWORD_HASHERS`), PBKDF2 solo como fallback de lectura |
| JWT firmado con secreto de entorno | ✅ | `JWT_SECRET_KEY` obligatorio, valida al arranque (`_fail_fast_on_missing_env`) |
| Expiración de tokens | ✅ | `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` / `JWT_REFRESH_TOKEN_LIFETIME_DAYS`, configurables |
| Validación de permisos en backend | ✅ | `HasModulePermission` en toda vista administrativa; el frontend nunca es la única barrera |
| Validación de entradas | ✅ | Serializers DRF en cada endpoint de escritura |
| Manejo seguro de errores | ✅ | `api_exception_handler` uniforme, nunca expone detalles internos en un 500 |
| Protección CSRF | ✅ (donde aplica) | La API usa JWT Bearer sin cookies de sesión (no aplica); el admin de Django sí usa `CsrfViewMiddleware` |
| CORS restrictivo | ✅ | `CORS_ALLOWED_ORIGINS` explícito por entorno, sin comodín |
| Cookies seguras | ✅ (producción) | `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE` forzados en `production.py` |
| Sin credenciales en código | ✅ | Todo secreto por variable de entorno; verificado con `grep` manual (ver limitación abajo) |
| Sin datos personales en logs | ✅ | `AccessLogMiddleware` solo registra método/ruta/estado/duración |
| Sin tokens completos en logs | ✅ | Igual que arriba; auditoría enmascara campos sensibles (`mask_sensitive_fields`) |
| Protección contra fuerza bruta | ✅ | `BruteForceProtectionService`, bloqueo por identificador + throttle por IP (`login` scope) |
| Encabezados de seguridad | ✅ | `SECURE_CONTENT_TYPE_NOSNIFF`, `X_FRAME_OPTIONS=DENY`, `SECURE_REFERRER_POLICY`, HSTS en producción |
| Dependencias sin vulnerabilidades críticas conocidas | ✅ | `pip-audit` y `npm audit` ejecutados el 2026-09-08 con corrección de todos los hallazgos: **0 vulnerabilidades conocidas** en backend y frontend (ver "Correcciones aplicadas" abajo) |
| Secretos del `.env` no truncados al parsearse | ✅ | `django-environ` corta el valor en `#`: los secretos generados excluyen ese carácter. Un `DB_PASSWORD` con `#` produce un "Login failed" difícil de diagnosticar |
| Auditoría de acciones administrativas | ✅ | `AuditLog` append-only, cubre creación/edición/activación/asignación de roles y permisos, cambios de tema |
| Protección del último administrador | ✅ | AC-038: el sistema nunca queda sin un administrador activo |
| Baja lógica en vez de eliminación física | ✅ | `UserAdminViewSet` sin `DELETE`; roles sí se eliminan físicamente (son configuración, no cuentas con historial) |

## Correcciones aplicadas (2026-09-08)

Auditoría completa de dependencias, con corrección de todo lo encontrado:

| Hallazgo | Severidad | Acción |
| --- | --- | --- |
| `Django 5.1.15` — 7 CVE, rama sin soporte (los parches salen en 5.2.x/6.0.x) | Alta | Actualizado a **5.2.17 LTS** |
| `djangorestframework 3.15.2` — CVE-2026-73228, CVE-2026-73229 | Alta | Actualizado a **3.17.2** |
| `mssql-django 1.7.4` — sin soporte declarado para Django 5.2 | — | Actualizado a **1.8.0** |
| `react-router 6.28` — open redirect vía backslash en `<Link>`/`useNavigate` (GHSA-wrjc-x8rr-h8h6) | Moderada, **runtime** | Actualizado a **react-router-dom 7.18.3** (el proyecto solo usa el modo declarativo, migración sin cambios de código) |
| `brace-expansion`, `js-yaml`, `nanoid` — DoS/consumo de CPU | Alta, solo tooling | Resueltos con `npm audit fix` |

Verificación posterior: `pip-audit` y `npm audit` reportan **0
vulnerabilidades**; las 83 pruebas del backend, los 13 escenarios Gherkin,
las 10 pruebas del frontend, el lint y el build de producción siguen en
verde.

También se corrigió un defecto que impedía instalar el proyecto desde
cero: `roles/0001_initial` daba por existente el `ContentType` de
`permissions.ModulePermission`, que Django recién crea en `post_migrate`
(al final de todo el `migrate`). Sobre una base de datos vacía la migración
fallaba; ahora materializa el ContentType y los permisos desde el catálogo
de forma idempotente.

## Correo saliente (§19, 2026-09-09)

El aviso por correo del centro de alertas es la única funcionalidad que hace
que el sistema escriba fuera de sí mismo. Los controles que la acotan:

- **Contenido mínimo**: recuentos y enlaces; ni equipos ni nombres de
  personas. Un buzón no aplica los permisos que protegen la pantalla.
- **Destinatarios cerrados**: solo usuarios activos, con correo y con
  `alertas.ver`, verificado **en el momento del envío**. No se pueden
  escribir direcciones libres: un campo de texto libre convertiría el
  sistema en un remitente hacia cualquier buzón.
- **El envío de prueba escribe solo a quien lo pide**, con su propio límite
  de frecuencia (`ALERTAS_PRUEBA_THROTTLE_RATE`), y queda auditado.
- **Bitácora de envíos** append-only con el resultado y el motivo, también
  cuando no se envió: un envío que falla en silencio hace creer que alguien
  fue advertido.

## Revisión del 10 de septiembre de 2026

Revisión de código y comprobación contra la API en ejecución, con las dos
empresas cargadas. Nueve hallazgos —tres altos, cuatro medios, dos bajos—,
todos corregidos en la misma tanda. El informe completo, con la evidencia de
cada uno, se publicó como página aparte; esto es el resumen que queda en el
repositorio.

| # | Hallazgo | Severidad | Corrección |
| --- | --- | --- | --- |
| H-01 | Nueve cuentas de demostración con la contraseña escrita en el código versionado, dos de ellas administradoras | Alta | La clave se genera al azar o se toma de `DEMO_PASSWORD` y se imprime una sola vez; las cuentas nacen con cambio obligatorio; `verificar_despliegue` marca como **crítico** que alguna sobreviva |
| H-02 | El centro de alertas devolvía 500 en la segunda empresa, y el envío por cron calculaba el resumen sobre el parque de todas | Alta | Una configuración por empresa (se retiró el singleton `pk=1`) y un envío por empresa dentro de `usando_empresa`; el asunto del correo nombra la empresa |
| H-03 | Registro público abierto que además emitía tokens en el acto | Alta | Ruta, vista, serializador y pantalla retirados. Las cuentas las crea un administrador desde Usuarios |
| H-04 | `auditoria.ver` en una empresa daba el historial de todo el despliegue | Media | `AuditLog` lleva empresa, poblada desde el contexto; el listado y la exportación filtran; una migración atribuyó los eventos anteriores y los huérfanos de módulos por empresa no se muestran |
| H-05 | El listado de usuarios mostraba al personal de todas las empresas, y `roles.editar` permitía autoconcederse el catálogo entero | Media | El conjunto de trabajo se acota a quien comparte empresa (más las cuentas sin ninguna, que hay que poder asignar); nadie concede un permiso que no tiene, salvo el superusuario |
| H-06 | Las cuatro exportaciones escribían los valores tal cual: un activo llamado `=HYPERLINK(...)` se ejecutaba al abrir el archivo | Media | `apps.core.hojas_de_calculo.neutralizar` antepone un apóstrofo a lo que la hoja tomaría por fórmula, en los cuatro exportadores |
| H-07 | Sin `Content-Security-Policy`, con los tokens en `localStorage` | Media | Middleware propio con `default-src 'none'`; respeta la cabecera que ya venga puesta, para que un proxy imponga la suya |
| H-08 | Tres vulnerabilidades conocidas en herramientas de desarrollo | Baja | `pytest` 9.0.3, `black` 26.3.1, `vitest` 5. `pip-audit` y `npm audit`: **cero** en ambos lados |
| H-09 | HSTS de una semana sin `preload`; ruta de respaldo validada por lista negra | Baja | HSTS de un año con `preload`; la ruta se valida por forma admitida (absoluta, sin tramos relativos) en vez de por caracteres prohibidos |

Trece criterios de aceptación nuevos (`AC-SEC-001` a `AC-SEC-013`) en
`tests/qa/features/hallazgos-de-seguridad.feature`, todos automatizados.

### Decisiones que conviene no revertir sin pensarlo

- **Quien administra roles necesita los permisos que reparte.** Cerrar la
  escalada tiene ese precio: un administrador de roles «pelado» no puede crear
  ninguno útil. Es el mismo modelo que usan los proveedores de nube, y la
  alternativa es que `roles.editar` sea en la práctica el permiso máximo.
- **Las cuentas sin ninguna empresa se ven desde todas.** No pertenecen a nadie,
  así que mostrarlas no cruza ningún límite, y esconderlas las volvería
  inadministrables: para asignarles una empresa hay que poder abrirlas.
- **Los eventos de auditoría sin empresa de un módulo por empresa no se
  muestran.** Son huérfanos —el objeto que describían ya no existe— y no se les
  puede atribuir dueño; mostrarlos sería exponer el rastro de la otra compañía
  por la puerta de los registros sin dueño.

## Revisión del 17 de septiembre de 2026 (módulo de solicitudes y entorno)

Motivo: el módulo de solicitudes de compra es código nuevo que mueve datos de
personas —quién pidió qué y para qué— y una bandeja de tareas ajena. Se revisó
también lo que rodea al despliegue local.

**Lo que se probó y aguanta.** 19 pruebas en
`apps/solicitudes/tests/test_seguridad_solicitudes.py` (AC-SEC-014 a 022):
acceso sin sesión, lectura y escritura de lo ajeno —responde 404, no 403—,
escalada horizontal entre encargados, suplantación del solicitante, nacer ya
aprobada, elegir empresa desde el cliente, dirigir el aviso a una cuenta
cualquiera, cruce entre empresas, inyección en la búsqueda, estados inventados y
texto con etiquetas. Además, `pip-audit` y `npm audit` no reportan
vulnerabilidades conocidas, y `check --deploy` con la configuración de
producción no levanta ningún aviso de la familia `security.*`.

**Corregido en esta revisión.**

- *La lista de encargados devolvía el correo de cada persona* a cualquiera con
  `solicitudes.ver` —incluido el rol «Usuario final», que existe justamente para
  no ver nada más que lo suyo—. El desplegable solo usa el nombre. Se retiró el
  campo (`EncargadoSerializer`).
- *El SQL Server de desarrollo se publicaba en todas las interfaces*
  (`0.0.0.0:14331`), de modo que el motor quedaba al alcance de un escaneo de
  puertos en la red de la oficina, con la contraseña de `sa` viviendo en un
  `.env` de desarrollo. El `docker-compose.yml` ahora lo ata a `127.0.0.1`. El
  compose de producción nunca publicó ese puerto: los contenedores se alcanzan
  por la red interna de Compose.

**Cerrado el 17 de septiembre, en la misma revisión.**

- *El puerto de la base quedó atado al loopback* y se recreó el contenedor para
  que surtiera efecto: `netstat` ya no lo muestra en `0.0.0.0`. Al aplicarlo
  apareció algo que conviene dejar escrito, porque parece un fallo de la base y
  no lo es: publicar solo en `127.0.0.1` **rompe la conexión si `DB_HOST` es
  `localhost`**, porque en Windows eso resuelve primero a `::1` y el proxy de
  Docker acepta ahí la conexión sin entregarla. `DB_HOST=127.0.0.1` en el `.env`
  y el motivo escrito en `docker-compose.yml` y en `.env.example`.
- *`RefreshView` tiene su propio cupo* (`refresh`, 60/min por IP). Es el otro
  endpoint público que acepta un secreto y contesta distinto según acierte, así
  que servía igual que el login para probar a ciegas; caía en el de anónimos,
  que es compartido, de modo que gastarlo ahí dejaba sin margen al login de la
  misma salida a internet.
- *Primer respaldo hecho y verificado*, con los adjuntos y su manifiesto.
- *`respaldos/` y `*.bak` entran en `.gitignore`.* El comando escribe ahí por
  defecto y la carpeta no estaba ignorada: un `git add .` distraído habría
  publicado la base entera —datos reales, facturas y actas— en el repositorio.
  Es el hallazgo que apareció **por corregir otro**, y de los que no se ven
  hasta que alguien ejecuta el comando sin `--destino`.

**Pendiente, y depende de la infraestructura de despliegue.**

- **Terminación TLS y cabecera de proxy.** Producción exige HTTPS
  (`SECURE_SSL_REDIRECT`, cookies seguras, HSTS de un año con `preload`), pero no
  define `SECURE_PROXY_SSL_HEADER`. Detrás de un proxy que termina TLS y reenvía
  en HTTP, Django no sabrá que la petición original era segura: redirigirá en
  bucle. Al configurarlo hay que asegurarse de que el proxy **borra** esa
  cabecera si viene del cliente; si no, cualquiera puede afirmar que su petición
  era HTTPS.
- **El backend publica el 8000 al exterior** en `docker-compose.prod.yml`, además
  del frontend en el 80. Si delante hay un proxy inverso, conviene dejar el
  backend solo en la red interna (`expose`) para no mantener dos puertas donde
  basta una.
- **Cuentas de demostración.** El 17 de septiembre se les **rotó la
  contraseña**: la que se imprimió en consola ya no vale y las nueve siguen
  activas para probar roles. Es una mitigación, no el cierre: `verificar_despliegue`
  las seguirá marcando como crítico, y con razón —siguen siendo cuentas
  compartidas con una clave común—. Antes de abrir el sistema a nadie hay que
  retirarlas con `manage.py sembrar_datos_demo --eliminar`, que se lleva también
  el parque de demostración entero: los 21 activos, sus mantenimientos,
  adjuntos, movimientos y empleados. Por eso no se hizo mientras el sistema está
  en pruebas.
- ~~**Programar el respaldo.**~~ Hecho el 17 de septiembre: la tarea
  `GestionActivos-Respaldo` corre cada hora y respalda cuando lo dice la
  política configurada en *Configuración → Respaldos*; el `.bak` ya sale del
  contenedor al disco del host. **Queda lo que de verdad protege**: que esa
  carpeta se copie fuera de esta máquina. Un respaldo que vive junto a lo que
  protege no protege de perderla.

## Limitaciones conocidas (no ocultas)

- La búsqueda de secretos fue un `grep` manual de patrones obvios
  (`password=`, `SECRET`, `-----BEGIN`), no una herramienta dedicada como
  `gitleaks`/`truffleHog`.
- `pip-audit` y `npm audit` solo detectan vulnerabilidades **publicadas**:
  hay que volver a ejecutarlos antes de cada release, no una sola vez.
- La revisión del 10 de septiembre no incluyó pruebas de penetración activas,
  infraestructura (servidor, red, TLS, permisos de archivos, configuración de
  SQL Server) ni búsqueda de secretos sobre todo el historial de Git.
- El token de sesión sigue en `localStorage`. La CSP lo cubre en profundidad,
  pero mover el refresh a una cookie `HttpOnly` cambiaría el modelo de CSRF y es
  una decisión pendiente, no un olvido.
- La entrega del correo depende de un servidor SMTP externo. Con el backend
  de consola que trae la configuración por defecto, el envío se da por
  exitoso sin que nadie reciba nada: la bitácora de `/alertas/envios/` dice
  que salió porque, para el sistema, salió.

## Recomendaciones para un despliegue productivo real

1. Ejecutar `pip-audit` y `npm audit` (con revisión manual de cada
   corrección propuesta) antes de cada release.
2. Rotar `SECRET_KEY`/`JWT_SECRET_KEY` si alguna vez se sospecha una
   filtración, y forzar `logout-all` de todos los usuarios (revocar todas
   las `Session`).
3. Configurar un proveedor de correo real (`EMAIL_BACKEND`) — por defecto
   usa el backend de consola, adecuado solo para desarrollo — y fijar
   `DEFAULT_FROM_EMAIL` a una dirección del dominio de la empresa: la
   derivada del nombre del sistema es un `.local` inexistente, y un
   remitente que no resuelve termina en la carpeta de correo no deseado,
   donde un aviso no avisa a nadie.
4. Configurar `CSRF_TRUSTED_ORIGINS` si el admin de Django se sirve detrás
   de un dominio/proxy distinto al de origen.
