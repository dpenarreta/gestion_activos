# Revisión de protección de datos personales

Revisión técnica y funcional tomando como referencia la Ley Orgánica de
Protección de Datos Personales de Ecuador (LOPDP). **Esto no es un dictamen
legal** — es un inventario técnico de qué datos personales maneja el
sistema y qué controles existen; cualquier conclusión legal definitiva
debe validarla un asesor legal calificado.

## Datos personales identificados

| Dato | Modelo/campo | Finalidad |
| --- | --- | --- |
| Nombre de usuario | `User.username` | Identificación única para iniciar sesión |
| Nombre y apellido | `User.first_name`/`last_name` | Identificación legible en la interfaz |
| Correo electrónico | `User.email` | Identificación, recuperación de contraseña, notificaciones |
| Estado de la cuenta | `User.status` | Control de acceso |
| Roles y permisos | `Group`, `Permission` (vía `user.groups`/`user_permissions`) | Autorización |
| Fecha de creación/último acceso | `User.created_at`, `User.last_login` | Trazabilidad administrativa |
| Dirección IP | `Session.ip_address`, `LoginAttempt.ip_address`, `AuditLog.ip_address` | Seguridad (detección de anomalías), nunca mostrada sin el permiso correspondiente |
| Dispositivo/navegador/SO (heurística) | `Session`, `AuditLog` | Contexto de seguridad en el listado de sesiones y en auditoría |

### Empleados custodios de activos

`apps.organizacion.Empleado` es un catálogo de personas que **no** tienen
necesariamente cuenta en el sistema: existe para saber quién responde por cada
equipo (RF-01).

| Dato | Campo | Finalidad |
| --- | --- | --- |
| Nombres y apellidos | `nombres`, `apellidos` | Identificar al custodio en el inventario, el historial y las sugerencias de renovación |
| Código de empleado | `codigo_empleado` | Identificador interno único; es la referencia usada en la carga masiva |
| Correo | `correo` | Contacto del custodio, a solicitud del responsable del sistema |
| Teléfono | `telefono` | Contacto del custodio, a solicitud del responsable del sistema |
| Cargo | `cargo` | Contexto organizacional del custodio |
| Departamento | `departamento` | Adscripción del activo a un área |

**No se recolecta el número de cédula ni ningún documento de identidad.** El
sistema se identificaba originalmente con la cédula del empleado; se sustituyó
por un código interno (`EMP-0001`) el 2026-09-08. La razón es de minimización:
para saber quién custodia un equipo basta un identificador único y estable, y
la cédula introducía dos riesgos que el código no tiene:

1. Quedaba grabada en la bitácora de auditoría, que es *append-only* y por
   tanto fuera del alcance de un derecho de supresión.
2. Viajaba dentro de la plantilla de carga masiva, un `.xlsx` que se descarga y
   circula por correo o memoria USB.

La migración `organizacion.0002` eliminó la columna sin conservar los valores;
`manage.py purgar_datos_personales_auditoria` limpió los ya escritos en la
bitácora. Tampoco se recolecta domicilio, datos financieros ni de salud.

## Controles existentes

- **Finalidad**: cada dato tiene un propósito operativo concreto (arriba).
  No se recolecta nada "por si acaso".
- **Acceso restringido**: todo endpoint que devuelve datos de usuarios exige
  un permiso del catálogo (`usuarios.ver` como mínimo); ver
  `tests/qa/features/personal-data-protection.feature`.
- **Auditoría**: toda modificación de datos de usuario queda registrada con
  actor, fecha y el diff (valores anteriores/nuevos) — visible únicamente
  con `auditoria.ver_detalle`.
- **Enmascarado de campos sensibles**: `apps.core.sensitive_data` enmascara
  antes de persistir un evento de auditoría, sin excepción y sin depender de
  que cada `service.py` se acuerde de hacerlo, cualquier campo cuyo nombre
  sugiera (a) contraseña/token/secreto o (b) un dato personal de contacto o
  identificación: correo, email, teléfono, documento, cédula. Lo segundo se
  añadió el 2026-09-08, al detectar que la ficha completa del empleado —con
  su correo y su teléfono— se copiaba en claro a la bitácora.
- **Purga retroactiva de la bitácora**: `manage.py
  purgar_datos_personales_auditoria` enmascara los datos personales de eventos
  ya escritos. Es la única excepción explícita al carácter append-only de
  `AuditLog`, y existe porque el enmascarado se aplica al escribir: sin ella,
  todo lo anterior a que un campo entrara en la lista quedaría en claro para
  siempre, y un derecho de supresión sería imposible de atender. No borra
  eventos ni altera actor ni fecha: solo el valor del campo.
- **Modificación**: el propio usuario puede cambiar su contraseña
  (`POST /auth/password/change/`); un administrador con el permiso
  correspondiente puede editar el perfil de otro usuario.
- **Eliminación / baja lógica**: no existe eliminación física de usuarios
  (`UserAdminViewSet` no expone `DELETE`) — la baja es lógica
  (`disable`/`block`), preservando el historial de auditoría asociado. Esto
  es una decisión de diseño: favorece la trazabilidad sobre el "derecho al
  olvido" absoluto. Un proyecto concreto con una obligación legal de
  eliminación física completa (a diferencia de la desactivación) debe
  implementar ese flujo explícitamente, evaluando el impacto en la
  integridad del historial de auditoría.
- **Plantilla de empleados**: el archivo de carga baja con lo que ya está
  registrado —para poder añadir filas debajo sin duplicar nada— pero las
  columnas de **correo y teléfono salen vacías**. Existen para llenarlas al dar
  de alta, no para llevarse las de la nómina entera: el .xlsx se descarga y
  circula por correo o USB, fuera del alcance de los permisos del sistema. Lo
  que sí lleva —código, nombre y área— es lo mínimo para reconocer una fila que
  ya está.

- **Ubicación aproximada**: el campo `AuditLog.location` existe pero no se
  resuelve automáticamente (no se integra ningún proveedor de geo-IP ni un
  flujo de consentimiento) — queda para que un proyecto concreto lo
  complete si lo necesita, documentado explícitamente para no generar una
  falsa expectativa de que ya funciona.
- **Exportación**: `GET /admin/audit-logs/export/` (permiso
  `auditoria.exportar`) permite exportar el registro de auditoría en CSV,
  con un tope de 5000 filas por exportación.
- **Retención**: no hay una política de retención/purga automática de
  `AuditLog`/`LoginAttempt` implementada — es una decisión operativa que
  cada proyecto concreto debe tomar según su propia política.

## Salida de datos por correo (§19)

El aviso por correo del centro de alertas es el único punto en que el sistema
envía información del parque **fuera de su perímetro**, a buzones que no
controla: se reenvían, se archivan y se sincronizan con teléfonos, y allí no
rigen los permisos que protegen la pantalla. Los controles que lo acotan:

- **Minimización del contenido**: el correo lleva el recuento de cada alerta,
  su severidad y el enlace al listado. No lleva ningún equipo ni el nombre de
  ningún custodio, aunque la respuesta de la API sí incluya una muestra. Para
  saber que hay que actuar basta el número; el detalle está detrás del login.
  Verificado en `AC-NOT-009`.
- **Destinatarios limitados a quien ya puede ver esa información**: solo
  usuarios activos, con correo y con el permiso `alertas.ver`. El filtro se
  aplica **al enviar**, no al elegir, de modo que revocar el permiso o
  deshabilitar la cuenta basta para que alguien deje de recibir, sin que nadie
  tenga que acordarse de editar la lista (`AC-NOT-007`, `AC-NOT-008`).
- **Copia oculta**: las direcciones van en BCC. Quién más recibe los avisos del
  parque no es un dato que cada destinatario necesite (`AC-NOT-010`).
- **Correos enmascarados en la interfaz**: `GET /alertas/destinatarios/`
  devuelve `d****@empresa.com`. Quien configura las alertas necesita reconocer
  a la persona, no llevarse el directorio de correos del personal; por eso el
  endpoint exige `notificaciones.configurar` y no expone la dirección completa
  (`AC-NOT-020`).
- **Bitácora sin direcciones**: `EnvioAlertas` guarda identificadores de
  usuario, no correos. Es un registro append-only que no se purga, y una
  dirección escrita ahí quedaría fuera del alcance de un derecho de supresión
  —el mismo criterio por el que se retiró la cédula del empleado.
- **El envío de prueba escribe solo a quien lo pide**, con su propio límite de
  frecuencia: un endpoint que dispara correos a terceros es un remitente
  disponible para quien consiga una sesión (`AC-NOT-014`, `AC-NOT-016`).

## Notificaciones de la campana

Cada aviso por correo a alguien con cuenta deja también una notificación en el
sistema (`apps.notificaciones`), y algunos avisos solo existen ahí (el ticket
asignado a un técnico). A diferencia del correo, no salen del perímetro:

- **Solo las ve su destinatario**, y solo en la empresa activa: la API filtra
  por la cuenta que pide, y marcar como leída una ajena responde 404.
- **Contenido mínimo**: el nombre del aviso, su asunto y una ruta del sistema.
  El enlace se guarda como ruta interna y nunca apunta a otro sitio; abrirlo
  exige iniciar sesión y los permisos de siempre.
- **La recuperación de contraseña no se guarda**: su enlace es de un solo uso
  y no debe quedar en ningún otro lugar.
- **Retención**: las leídas se borran a los 90 días y las demás a los 180
  (`limpiar_notificaciones`, en la tarea programada).

## Escenarios Gherkin relacionados

Ver `tests/qa/features/personal-data-protection.feature`
(`AC-DP-001` a `AC-DP-006`) para los criterios verificables derivados de
esta revisión, y `tests/qa/acceptance-criteria-traceability.md` para su
estado de automatización.

## Recomendaciones

1. Definir una política de retención explícita para `AuditLog` y
   `LoginAttempt` antes de un despliegue productivo con datos reales.
2. Si el proyecto concreto requiere eliminación física de datos personales
   (no solo baja lógica), diseñar ese flujo evaluando el impacto sobre la
   integridad referencial del historial de auditoría.
3. Validar con un asesor legal si la finalidad y el plazo de conservación
   documentados aquí son suficientes para el caso de uso concreto del
   proyecto que se construya sobre esta base.

## Chat de la empresa

El chat (`apps.chat`) reemplaza, para lo interno, conversaciones que hoy van por
WhatsApp personal. Decisiones del 19/10/2026 y controles:

- **Quién lo usa**: toda cuenta con membresía en la empresa activa, en nómina o
  no, sin permisos especiales. Cada empresa tiene su propio chat.
- **Quién lee qué**: solo quienes participan en una conversación. Nadie, ni la
  administración, lee mensajes directos o grupos ajenos; la API responde 403.
- **Retención**: se guardan 12 meses (`limpiar_chat`, en la tarea programada,
  borra los mensajes y sus archivos). Cada persona ve los últimos 6 meses; con
  `chat.historial_completo`, hasta 12.
- **Archivos**: los mismos tipos y validación de contenido que los adjuntos,
  hasta 10 MB. Lo que pesa más se sugiere enviarlo por correo; la descarga
  exige sesión y ser participante.
- **Avisos**: la campana guarda solo el último mensaje resumido de cada
  conversación sin leer, y se marca leída al abrirla.

## Mesa de ayuda solo para personas registradas y «Mis datos»

Desde el 20/10/2026 no hay formulario público ni enlace de seguimiento sin
sesión: un ticket lo pide una persona con cuenta («Soporte TI») y solo ella ve
su ficha. Sus datos de contacto salen de «Mis datos» (`DatosDeContacto`):

- **Minimización**: se guardan teléfono, área y agencia por empresa, nada más.
  El nombre y el correo son los de la cuenta.
- **Quién los cambia**: la propia persona. La ficha de empleado de Talento
  Humano no se modifica; de ella salen los valores iniciales.
- **Alta interna**: quien atiende elige a una persona registrada; lo que le
  falte se completa solo en ese ticket, sin tocar «Mis datos» ajenos.

## Organigrama institucional y cargo de cada persona (19/10/2026)

- **Qué se guarda:** el cargo de cada persona, en su perfil de la empresa
  (`DatosDeContacto.cargo`). Es un solo dato: lo elige la persona en «Mi
  perfil» o lo asigna quien tiene `institucional.asignar`. Cada asignación
  queda en la auditoría con el cargo anterior y el nuevo.
- **Quién lo ve:** el organigrama con los nombres de quienes ocupan cada
  cargo lo ve quien tiene `institucional.ver`. No muestra correo ni
  teléfono: solo el nombre, que es lo que un organigrama publica.
- **Aislamiento:** niveles, unidades y cargos son de cada empresa
  (`ModeloDeEmpresa`); asignar solo acepta personas con membresía en la
  empresa activa.

## Códigos de conducta y reglamentos (19/10/2026)

- **Qué se guarda:** los documentos (PDF o Word, hasta 20 MB) con nombre
  generado, fuera de lo público; el nombre original es solo un dato. Se
  comprueba la firma del contenido, no solo la extensión.
- **Quién los ve:** toda persona con sesión, los vigentes de su empresa; los
  retirados, solo quien tiene `codigos.publicar`. El archivo se
  entrega por una vista con sesión, como adjunto y con `nosniff`.
- **Constancia de lectura:** abrir un documento queda en la auditoría
  (`institucional.documento.abierto`), con quién y cuándo.
- **Visor:** el PDF se muestra desde una dirección `blob:` local. Si el
  servidor que publica el frontend define una CSP, debe permitir
  `frame-src blob:`; si no, el visor queda en blanco.

## Acuerdo de confidencialidad de los códigos de conducta (19/10/2026)

- **Qué se guarda:** cada aceptación, con la persona, la fecha y hora, la
  versión de los documentos para la que valió y el título y texto aceptados.
  No se sobrescribe: queda como constancia.
- **Cuándo se pide:** al entrar a «Códigos de conducta», a quien no lo tenga
  aceptado para los documentos vigentes. Vale hasta que se agregue, modifique
  o borre cualquier documento; entonces se pide de nuevo.
- **Control:** sin aceptarlo, el servidor no entrega el contenido de ningún
  documento (`acuerdo_pendiente`), aunque se pida directo a la API.
- **Quién lo ve:** el título y el texto los configura quien tiene
  `codigos.acuerdo`; la lista de aceptaciones la ve quien tiene
  `codigos.ver_aceptaciones`.

## Carrusel de noticias de Inicio (19/10/2026)

- **Qué se guarda:** imágenes (JPG, PNG o WebP, hasta 5 MB) con nombre
  generado, fuera de lo público, y sus fechas de publicación. Se comprueba la
  firma del contenido.
- **Quién lo ve:** toda persona con sesión, solo las vigentes ese día; las
  programadas y vencidas, solo quien tiene `noticias.gestionar`. Las imágenes
  se entregan por una vista con sesión, con `nosniff`.
- **Cuidado:** las imágenes las ve toda la empresa; no deben llevar datos
  personales que no se quieran difundir (cédulas, teléfonos).

## Calendario de Inicio (19/10/2026)

- **Qué se guarda:** título, tipo (evento, cumpleaños, feriado), fechas,
  descripción y si se repite cada año. Los cumpleaños se cargan a mano: no se
  toma la fecha de nacimiento de ninguna ficha.
- **Quién lo ve:** toda persona con sesión de la empresa. Un cumpleaños es un
  dato personal: se publica solo el día y el mes que se escriban, nunca el año
  de nacimiento, y conviene cargar solo los de quienes estén de acuerdo.
- **Desde «Mi perfil» (2026-10-20):** cada persona decide si muestra su
  cumpleaños. Activarlo pide aceptar en una ventana que sea público y la fecha;
  se guardan solo día y mes y la fecha de la aceptación
  (`DatosDeContacto.cumpleanos_aceptado_en`). Desactivarlo lo retira del
  calendario y borra día, mes y aceptación. Cada cambio queda en la auditoría.
- **Quién lo gestiona:** quien tiene `calendario.gestionar`; cada cambio
  queda en la auditoría.

## Aviso al iniciar sesión (19/10/2026)

- **Qué es:** una ventana con título, imagen opcional y contenido que ve
  toda persona de la empresa al entrar al sistema, una vez por sesión (se
  recuerda en el navegador hasta cerrar sesión; si el aviso cambia, se
  vuelve a mostrar).
- **Quién lo configura:** quien tiene `configuracion.aviso_inicio`, en
  Configuración → Aviso al iniciar sesión. Cada cambio queda en la auditoría.
- **Cuidado:** lo ve toda la empresa; no debe llevar datos personales.

## Mis vacaciones (19/10/2026)

- **Qué se guarda:** por persona, sus períodos de vacaciones (años de
  servicio) con los días que le corresponden, y cada goce (fechas, días y un
  detalle). Por ahora se cargan desde Talento Humano; más adelante, desde la
  nómina.
- **Quién lo ve:** cada persona, solo las suyas («Mis vacaciones», sin
  permiso). Las de otras personas son un dato personal: solo quien tiene
  `vacaciones.ver_todas` (Talento Humano).

## Solicitud de permisos (19/10/2026)

- **Qué se guarda:** cada solicitud (tipo, fechas, motivo, documento de
  respaldo opcional — PDF o imagen, hasta 10 MB, con firma comprobada) y su
  historial: quién aprobó, rechazó o escaló, cuándo y con qué comentario.
- **Quién la ve:** quien la pidió, quienes la tienen o la tuvieron pendiente
  (sus aprobadores) y quien tiene `licencias.ver_todas`. Un permiso médico
  puede llevar un certificado: es un dato de salud; por eso el documento se
  entrega solo a esas personas, como adjunto y con `nosniff`.
- **Avisos:** van a la campana de cada destinatario configurado en el flujo.
- **Quién configura los flujos:** quien tiene `licencias.configurar`.
