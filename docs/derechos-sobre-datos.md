# Derechos sobre datos personales (LOPDP)

Portado de las «Solicitudes LOPD» de Nexo (`apps.data_requests`) el 09/11/2026
y ampliado a **toda la intranet**: cualquier persona con cuenta, desde «Mi
perfil» («Mis derechos sobre mis datos»), pide acceso, rectificación o
eliminación de lo que la intranet guarda de ella en cualquier módulo, y
descarga sus datos al instante. Lo atiende quien tiene el permiso de
protección de datos. Código: `backend/apps/privacidad`.

**Esto no es un dictamen legal.** Es la implementación técnica; el plazo, los
tipos de derecho y los textos deben validarlos el asesor legal.

## Qué se guarda

- `SolicitudDerechos` (de una empresa): el titular, el tipo (ACCESO,
  RECTIFICACION, ELIMINACION), la descripción, el estado (PENDIENTE,
  EN_PROCESO, RESUELTA, RECHAZADA), la fecha límite y el plazo con que se
  calculó, la última respuesta al titular, quién la resolvió y cuándo, y el id
  de Nexo si vino de allí.
- `MovimientoSolicitud`: cada cambio de estado con quién lo hizo y la respuesta
  al titular. No se edita ni se borra.
- Auditoría común (módulo `privacidad`): `privacidad.solicitud.creada`,
  `privacidad.solicitud.estado` y `privacidad.datos.descargados`, **sin la
  descripción ni la respuesta** (la auditoría no se borra, y una rectificación
  o una eliminación suele traer justo el dato en cuestión). Por lo mismo, los
  400 de este módulo no copian el cuerpo de la petición a la auditoría.

## Plazo legal

La LOPDP de Ecuador (Registro Oficial Suplemento 459, 26/05/2021) fija en sus
artículos 13 (acceso), 14 (rectificación y actualización) y 15 (eliminación)
que el responsable atienda la solicitud en **quince (15) días**. El repositorio
no tenía esta cifra: sale de la lectura del texto de la ley y **debe
confirmarla el asesor legal**, en particular si el Reglamento o la autoridad
los cuentan como hábiles.

- Se configura con `PRIVACIDAD_PLAZO_DIAS` (15 por defecto) y se cuenta en
  **días corridos** desde la fecha local de la solicitud. 15 corridos cumplen
  también si fueran hábiles.
- Cada solicitud guarda su `fecha_limite` y su `plazo_dias`: cambiar el ajuste
  no mueve las ya recibidas.
- Vencida = abierta y con la fecha límite ya pasada (el último día todavía
  está a tiempo). La bandeja la filtra (`vencidas=1`) y la cuenta.

## Estados

| Desde | Puede pasar a | Respuesta |
| --- | --- | --- |
| PENDIENTE | EN_PROCESO, RESUELTA, RECHAZADA | Obligatoria al cerrar |
| EN_PROCESO | RESUELTA, RECHAZADA | Obligatoria |
| RESUELTA / RECHAZADA | EN_PROCESO (reabrir) | Obligatoria (el motivo) |

RECHAZADA no existía en Nexo: hay datos que la empresa debe conservar por ley
(el rol de pagos, la auditoría), y una eliminación que no procede debe
responderse con su motivo, no marcarse «resuelta».

**Nada irreversible es automático**, como en Nexo: una ELIMINACION no borra
nada. Quien atiende la gestiona a mano (baja lógica de la cuenta, purgas con
sus comandos, `purgar_datos_personales_auditoria`) y lo cuenta en la respuesta.

## Empresas

La solicitud se dirige a la **empresa activa** de quien la pide: cada empresa
del grupo es un responsable del tratamiento distinto (su propio RUC) y responde
por lo que guarda. La atiende quien tiene el permiso en esa empresa, y la
descarga de datos trae lo de esa empresa más lo que es de la cuenta (sesiones,
inicios de sesión, empresas y roles). Quien trabaja en varias empresas pide en
cada una. Hoy el sistema tiene una sola empresa (`MULTIEMPRESA=False`), así que
en la práctica es una solicitud por persona.

## Permisos

| Permiso | Qué habilita | Roles (migración) |
| --- | --- | --- |
| (ninguno) | Pedir, seguir las propias y descargar «mis datos» | Toda cuenta con sesión |
| `privacidad.ver` | Bandeja y detalle, solo lectura | Administrador de Gestión Humana, Superusuario (`privacidad/0002`) |
| `privacidad.atender` | Cambiar el estado con la respuesta y descargar los datos del titular de un ACCESO abierto | Administrador de Gestión Humana, Superusuario (`privacidad/0002`) |

El rol «Administrador» (TI) no los tiene (`privacidad/0003`; también excluido
en `crear_roles_iniciales`): atender abre los datos de cualquier persona y
administrar el sistema no lo requiere. Están en el grupo «Auditoría» del
catálogo. Las rutas no se apagan con ningún módulo.

## Avisos

- **Solicitud nueva** → campana de quienes tienen `privacidad.atender` en la
  empresa (activos; la cuenta de emergencia sin rol no), con el nombre del
  titular, el tipo, el número y la fecha límite. Nunca la descripción.
- **Cambio de estado** → campana del titular y correo
  (`privacidad.solicitud_actualizada`, editable en Configuración → Plantillas
  de correo) con el número, el tipo y el estado. **El correo no lleva la
  respuesta**: sale del perímetro; la respuesta se lee en la intranet. Si el
  correo falla, la respuesta no se deshace.

## «Mis datos»: qué incluye la descarga

`GET /privacidad/mis-datos/?formato=json|xlsx`. El Excel tiene una hoja
«Resumen» (secciones, registros y lo que no va) y una por sección; todo texto
pasa por `neutralizar`. La definición está en
`backend/apps/privacidad/mis_datos.py` (`SECCIONES`, `EXCLUIDO`,
`APPS_REVISADAS`); una prueba exige que toda app de `backend/apps` figure en
`APPS_REVISADAS`, para que una app nueva obligue a decidir.

| Sección | Qué incluye |
| --- | --- |
| Cuenta | Usuario, nombres, correo, estado, código de empleado, alta y último acceso |
| Empresas y roles | Empresas en que trabaja y sus roles en cada una, y los globales |
| Permisos | Lo que la cuenta puede hacer en la empresa |
| Perfil y contacto | Teléfono, correo personal, área, agencia, cumpleaños y aniversario, con cuándo y desde qué IP autorizó |
| Ficha de empleado | Código, nombres, correo, teléfono, cargo y área de Talento Humano |
| Cargo y organigrama | Cargo, nivel, unidad y cargo del que depende (sin el nombre de quien lo ocupa) |
| Herramientas | Herramientas que usa, con su cuenta |
| Acuerdos aceptados | Cada aceptación del acuerdo de confidencialidad |
| Vacaciones | Períodos y goces |
| Solicitudes de permiso | Cada solicitud con su historial; el documento, por su nombre |
| Ausencias | Ausencias y estados especiales, con el detalle que la persona ve en pantalla |
| Tareas / Horas registradas / Comentarios | Lo asignado, cada registro de horas y sus comentarios en tareas, horas y proyectos |
| KPI | Desde cuándo se le mide (el KPI mensual se baja en «Mis KPI») |
| Proyectos | Proyectos de Gestión Humana de los que es responsable o participante |
| Reuniones | Las que organizó o a las que la invitaron, con su asistencia |
| Escritorio | Notas enviadas y recibidas, respuestas y recordatorios (**solo el titular**) |
| Mejora continua | Ideas y votos |
| Onboarding y capacitación | Onboarding, materiales abiertos y evaluaciones |
| Novedades de Gestión Humana | Si es colaborador: ficha (cédula enmascarada), estados, días laborados y horas extras |
| Mesa de ayuda | Sus tickets con su contacto, los mensajes que ve y su encuesta |
| Órdenes de trabajo / Solicitudes de equipos / Solicitudes de proyectos / Sugerencias | Lo que pidió o reportó |
| Equipos | Los equipos a su cargo y los que pidió |
| Matriz de obligaciones | Períodos donde es responsable, suplente, supervisor o aprobador |
| Chat | Su estado y los mensajes que envió, hasta 5000 (**solo el titular**) |
| Notificaciones / Descargas | Avisos recibidos y archivos descargados (hasta 2000 cada uno) |
| Sesiones | Sesiones (dispositivo, navegador, IP) e intentos de inicio de sesión (hasta 500) |
| Actividad | Lo que hizo según la auditoría, sin valores (hasta 2000) |
| Solicitudes de derechos | Sus solicitudes con la respuesta |

### Qué no se incluye y por qué

| Qué | Por qué |
| --- | --- |
| Rol de pagos (consultas, documentos, observaciones) | Tiene su propia descarga, protegida con la contraseña, en Institucional → Rol de pagos |
| Contraseña, códigos de inicio de sesión y de recuperación, código de seguimiento de tickets, enlace y clave de reuniones | Son llaves de acceso: abren la cuenta, un ticket o una sala; no describen a la persona |
| Notas internas de la Mesa de ayuda | Son del equipo de soporte; si la persona las pide, se revisan en una solicitud de ACCESO |
| Contenido de los archivos | Se listan por nombre; se ven en su módulo |
| Valores anteriores y nuevos de la auditoría | Llevan datos de terceros; la actividad va resumida |
| Registros de trabajo sobre otras personas o bienes | Son de terceros o de la operación |
| Cédula completa | Va enmascarada: el archivo sale del sistema |
| Datos de otras empresas del grupo | Cada empresa responde por lo suyo |

### Quien atiende un ACCESO

`GET /privacidad/solicitudes/<id>/datos/` (`privacidad.atender`), solo para una
solicitud de ACCESO abierta: lo que justifica abrir los datos de otra persona
es tener que responderle. Diferencias con la descarga propia:

- Sin el **chat** ni el **Escritorio**: en la intranet nadie, ni la
  administración, lee los mensajes ni las notas de otra persona. El archivo lo
  dice (`secciones_omitidas`) y el titular los descarga él mismo.
- **Datos de salud** con la regla de su módulo: el tipo y la observación de las
  ausencias y los estados especiales solo con `ausencias.medicas_ver`; el
  detalle de los permisos con `licencias.ver_todas` o `ausencias.medicas_ver`.
  Si no, enmascarados como en pantalla («AUSENCIA», «(reservado)»).

### Registro

Toda descarga (propia o de un titular) queda en la auditoría
(`privacidad.datos.descargados`: quién, de quién, formato y solicitud) y en el
registro de descargas (`apps.descargas`, módulo «Protección de datos
personales») **sin copia**: guardar un año una copia de los datos completos de
alguien, abierta a quien audita descargas, sería lo que esta función existe
para controlar. Se limita a 20 descargas por hora por persona
(`PRIVACIDAD_DATOS_THROTTLE_RATE`).

## API (`/api/v1/privacidad/`)

| Método y ruta | Permiso | Qué hace |
| --- | --- | --- |
| `GET me/` | Sesión | `{puede_ver_bandeja, puede_atender, plazo_dias, tipos[], estados[]}` |
| `GET mis-solicitudes/` | Sesión | Las propias en la empresa activa |
| `POST mis-solicitudes/` | Sesión | `{tipo, descripcion}` → 201 (o 200 con la misma si ya había una abierta idéntica) |
| `GET mis-solicitudes/<id>/` | Sesión (propia; si no, 404) | Con `historial` |
| `GET mis-datos/?formato=json\|xlsx` | Sesión | El archivo |
| `GET mis-datos/secciones/` | Sesión | Qué incluye y qué no |
| `GET solicitudes/?estado=&tipo=&vencidas=1&q=&page=&page_size=` | `ver` o `atender` | Paginada, abiertas primero por fecha límite; con `totales` |
| `GET solicitudes/<id>/` | `ver` o `atender` | Con `historial` (con quién) y `puede_descargar_datos` |
| `POST solicitudes/<id>/estado/` | `atender` | `{estado, respuesta, estado_esperado}` |
| `GET solicitudes/<id>/datos/?formato=json\|xlsx` | `atender` | Datos del titular de un ACCESO abierto |

Errores con el contrato `{"error": {"code", "message", "details"}}`:
`validation_error` (400, `details` por campo), `permission_denied` (403),
`not_found` (404, también la ajena), `conflicto` (409, `estado_esperado` no
coincide; `details.estado_actual`), `transicion_invalida` (409),
`no_es_de_acceso` / `solicitud_cerrada` (409, descarga del titular), 429 por el
límite de descargas.

Una solicitud para el titular:

```json
{"id": 12, "numero": "LOPDP-00012", "tipo": "RECTIFICACION",
 "tipo_label": "Corrección de datos", "descripcion": "…",
 "estado": "EN_PROCESO", "estado_label": "En proceso",
 "creada_en": "2026-11-09T10:15:00-05:00", "fecha_limite": "2026-11-24",
 "plazo_dias": 15, "dias_restantes": 15, "vencida": false,
 "respuesta": "", "resuelta_en": null,
 "historial": [{"estado_anterior": null, "estado_nuevo": "PENDIENTE",
   "estado_nuevo_label": "Pendiente", "respuesta": "", "fecha": "…"}]}
```

En la bandeja suma `titular {id, nombre, usuario, correo}`, `resuelta_por
{id, nombre}`, `importada_de_nexo` y, en el historial, `actor {id, nombre}`.

Rutas del frontend que usan los avisos: `/admin/privacidad/solicitudes/<id>`
(bandeja) y `/admin/perfil?seccion=mis-derechos` (titular).

## Importar desde Nexo

```
manage.py importar_nexo_privacidad --empresa <id> [--aplicar] [--informe <ruta fuera del repo.csv>] [--excluir-usuario <correo> ...]
```

Lee `data_requests_datasubjectrequest` por el alias `nexo` (solo SELECT),
cruza las cuentas por correo (aborta si falta alguna; no crea cuentas) y, sin
`--aplicar`, es un simulacro. Es repetible: lo ya importado (`id_nexo`) se
salta. Crea el movimiento de recepción y el del estado final (Nexo no guardaba
historial ni respuesta), calcula la fecha límite con el plazo vigente y no
avisa a nadie. Las ACCESO resueltas sin resolutor son las descargas de «mis
datos» de Nexo: se importan como constancia y se cuentan en el informe.

## Pendiente

- Un recordatorio a quienes atienden cuando una solicitud se acerca a su fecha
  límite (iría en la tarea programada).
- Validar con el asesor legal el plazo, los tipos (la LOPDP reconoce además
  oposición, portabilidad y suspensión) y los textos de la pantalla.

## Consentimiento del tratamiento de datos (09/11/2026)

Portado del consentimiento de Nexo. Detalle y decisiones en
`backend/apps/privacidad/consentimiento.py`.

- **Pantalla obligatoria.** Al entrar a la intranet, quien no aceptó el aviso
  vigente de la empresa activa ve solo el aviso: lo acepta o cierra sesión.
  `GET /api/v1/auth/me/` trae `consentimiento: {pendiente, version, texto}`.
  Sin aviso en la empresa no se exige nada.
- **Aviso por empresa, con versión.** Lo edita quien tiene `privacidad.atender`
  en Protección de datos → Consentimiento. Editar no cambia la versión;
  «pedir que todas las personas lo acepten de nuevo» la sube. `privacidad/0005`
  siembra el aviso inicial (menciona que algunas funciones usan un proveedor
  externo de IA, Google (Gemini), decisión del 09/11/2026, al que solo se envían
  seudónimos). Si el proveedor cambia, se edita el aviso y se pide aceptarlo de
  nuevo.
- **Constancia.** Cada aceptación guarda la versión, la fecha, la IP y el texto
  exacto (`AceptacionAviso`). Restablecer (una persona o todas, con
  `privacidad.atender`) la marca sin borrarla. Todo queda en la auditoría
  (`privacidad.consentimiento.*`).
- **Nexo.** `manage.py importar_nexo_consentimiento --empresa N [--aplicar]`
  registra los consentimientos dados en Nexo con la versión «Nexo» y su fecha
  original. Son constancia previa: no cuentan como aceptación del aviso
  vigente, que cada persona acepta una vez.

| Método | Ruta (`/api/v1/privacidad/…`) | Permiso |
| --- | --- | --- |
| GET, POST | `consentimiento/` | sesión |
| GET / PUT | `consentimiento/aviso/` | ver o atender / atender |
| GET | `consentimiento/personas/`, `consentimiento/personas/<id>/` | ver o atender |
| POST | `consentimiento/personas/<id>/restablecer/` | atender |
| POST | `consentimiento/restablecer-todos/` (`{"confirmar": true}`) | atender |

## Nova (IA): qué se envía y la regla de salud (09/11/2026)

Detalle en `backend/apps/nova/seudonimos.py`, `nucleo.py` y `chat.py`. Todo lo
que va a la IA pasa por el núcleo de Nova, que limpia y verifica el texto
exacto antes de enviarlo.

- **Siempre, en todas las funciones:** las personas van con seudónimo
  («Persona A»), nunca con su nombre, usuario ni correo; se ocultan correos,
  cédulas/RUC y teléfonos; la verificación final bloquea el envío si aún queda
  alguno de esos datos.
- **Salud.** En el análisis de KPI, la narrativa de los informes, la frase del
  inicio y los modos «Mis tareas» y «Mi equipo» del chat nunca sale nada de
  salud (maternidad, lactancia, permisos médicos, enfermedades…): un mensaje
  del chat que la menciona no se envía y se le sugiere a la persona hacer la
  pregunta en el modo General si es sobre políticas; los fragmentos de la base
  de conocimiento pierden las oraciones de salud.
- **Excepción: modo General del chat.** No lleva datos de personas (solo la
  pregunta, el historial de ese modo y los fragmentos de la base de
  conocimiento), así que se permiten las menciones de salud como tema general
  («¿Cuántos días de licencia por maternidad da la empresa?») y los fragmentos
  van completos: son políticas, no datos de personas. Se activa con
  `Pedido.permitir_salud_general`, que solo pide el modo General del chat; el
  núcleo lo ignora en cualquier otra función, modo o contexto con datos de
  personas (una prueba lo asegura). La pantalla avisa: «Puede preguntar por
  políticas sobre licencias o permisos médicos, pero no escriba datos de salud
  suyos ni de otras personas.»

### Nova responde solo con sus fuentes (09/11/2026)

Detalle en `backend/apps/nova/ajustes.py` y `chat.py`. Ajuste por empresa
«Responder solo con las fuentes», **activado por defecto**: Nova responde
siempre con sus fuentes (los documentos de la base de conocimiento y, según
el modo, los datos que se le entregan), nunca con conocimiento general.

- **Dónde vive.** En `novedades.SettingHistory` (clave `nova_solo_fuentes`,
  la tabla de ajustes con vigencia de Gestión Humana, por empresa). Lo cambia
  quien tiene `nova.conocimiento_gestionar` con el interruptor de Nova › Base
  de conocimiento (`PUT /api/v1/nova/conocimiento/ajustes/`; 403 a quien no
  gestiona). Cada cambio queda en la auditoría como
  `nova.configuracion.cambiada`, con el valor anterior y el nuevo.
- **Modo General.** Si la búsqueda en la base (BM25, en el servidor) no
  encuentra fragmentos por encima del umbral, **no se llama a la IA**: se
  responde «No encontré esa información en los documentos de la base de
  conocimiento. Pruebe con otras palabras o consulte a Gestión Humana.»
  (`motivo: "sin_fuentes"`). Queda el metadato en `UsoNova`
  (`resultado=sin_fuentes`, `llamada=False`) y no cuenta para el límite
  diario. Con fragmentos, la instrucción del sistema exige responder solo con
  ellos, citar «[Título del documento, pág. N]» y decir explícitamente que
  la respuesta no está en los documentos cuando no aparece; prohíbe completar
  con conocimiento general.
- **Mis tareas y Mi equipo.** No se cortan por falta de fragmentos: las
  tareas o las cifras del equipo son fuente. La instrucción exige responder
  solo con esos datos y los fragmentos, y decir si con eso no se puede
  responder.
- **Temperatura baja** (0,2) con el ajuste activo; Gemini la usa, Anthropic
  no la admite.
- **Desactivado**, vuelve el comportamiento anterior: si los documentos no
  cubren la pregunta, Nova puede responder con buenas prácticas generales y
  lo dice; siempre cita los documentos que usa.
- **Pantalla.** `GET /api/v1/nova/me/` trae `solo_fuentes` y
  `hay_documentos`. Con el ajuste activo el modo General dice «Nova responde
  solo con los documentos de la base de conocimiento.» y, si la base está
  vacía, lo avisa antes de escribir (con enlace a la base para quien la
  gestiona). «sin_fuentes» se muestra como aviso informativo: el mensaje no
  queda «No se envió» ni vuelve a la caja. Cada fuente de la respuesta (las
  citadas, `citada: true`, o si no cita ninguna, las consultadas) abre el PDF
  en el visor del sistema en la página indicada, para quien puede ver la base.
