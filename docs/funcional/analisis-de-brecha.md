# Análisis de brecha: documento funcional vs. sistema construido

Compara `Sistema_Gestion_Activos_TI.docx` (Documento Funcional v1.0) con el
estado del sistema. Actualizado el 2026-09-25 (pantalla de auditoría).

El documento es más amplio que los ocho requerimientos con los que arrancó el
desarrollo: cubre 27 secciones e incluye garantías, adjuntos, notificaciones,
dashboard y reportes que no estaban en el alcance inicial.

## Resumen

| Bloque | Estado |
| --- | --- |
| Inventario, código de barras, escáner | Implementado |
| Asignaciones e histórico | Implementado |
| Reparaciones e histórico | Implementado |
| Reglas de reemplazo | Implementado |
| Usuarios, roles, auditoría | Implementado |
| Dashboard | Implementado |
| Reportes | Los trece del §16, en Excel, CSV y PDF |
| Garantías | Implementado |
| Adjuntos y actas | Implementado |
| Notificaciones por correo | Implementado |
| Catálogos (sedes, áreas, proveedores, empleados) | Implementado, administrables desde la aplicación |
| Solicitudes de compra | Implementado: se pide dentro del sistema, con bandeja y recorrido auditado |
| Integraciones (§20) | Solo las de hardware: lector y etiquetadora |

## Sección por sección

| § | Requerimiento | Estado | Dónde |
| --- | --- | --- | --- |
| 3 | Tipos de activos configurables | ✅ | `apps.activos.TipoDispositivo` |
| 4.1 | Datos generales del activo | ✅ | Los nueve estados, fecha de ingreso, sede de catálogo, proveedor de catálogo y condición al adquirirlo (nuevo/usado) |
| 4.2 | Características técnicas | ✅ | Cada tipo declara las suyas (`CaracteristicaTipo`), con su clase de dato —texto, texto ampliado, número, entero, sí/no, lista de opciones, fecha—, unidad, obligatoriedad y orden. El valor se guarda en `especificaciones` bajo el nombre declarado |
| 5 | Código de barras + etiqueta + escaneo | ✅ | `barcode.py`, `etiquetas_pdf.py`, `/activos/por-codigo/` |
| 5 | Código QR opcional | ⛔ Descartado | Decisión del 2026-09-09: el inventario se hace con pistola láser, no con cámara. Se refuerza el Code 128 (ver `docs/codigos-de-barras.md`) |
| 6 | Asignación y devolución | ✅ | Con acta de entrega y devolución en PDF |
| 7 | Histórico de asignaciones | ✅ | `MovimientoActivo`, append-only |
| 8 | Registro de reparaciones | ✅ | Causa, solución, estado final, garantía usada e ingreso/salida |
| 9 | Histórico de reparaciones | ✅ | Días fuera de operación por intervención y acumulados |
| 10 | Cálculo de tiempos | ✅ | Los siete del documento, reconstruidos desde el historial (`apps.activos.tiempos`) |
| 11 | Reglas de reemplazo | ✅ | Dos niveles (evaluar / recomendado) y ventana móvil configurable |
| 12 | Categorización (criticidad, uso) | ✅ | Criticidad de cuatro niveles y uso por función, además del tipo |
| 13 | Usuarios y roles | ✅ | Roles configurables, 41 permisos, y los **cinco** roles del documento listos para crear (`crear_roles_iniciales`), incluido «Usuario final» con su pantalla *Mis equipos* |
| 14 | Buscador y filtros | ✅ | Tipo, área, custodio, estado, garantía, sede, criticidad, uso y antigüedad |
| 15 | Dashboard | ✅ | `apps/activos/dashboard.py`, `/admin/dashboard` |
| 16 | Reportes y exportación | ✅ | Los trece reportes, cada uno en Excel, CSV y PDF (`apps.reportes`) |
| 17 | Auditoría | ✅ | `AuditLog`, append-only, y su pantalla en *Usuarios y roles → Auditoría*: filtros por persona, acción, resultado y fechas, detalle con el antes y el después, y exportación de lo filtrado |
| 18 | Adjuntos y evidencias | ✅ | `apps.adjuntos`, con los nueve tipos del documento |
| 19 | Notificaciones y alertas | ✅ | Las siete alertas, más el envío del resumen por correo con frecuencia configurable |
| 22.3 | Gestión de depreciación | ✅ | Lineal, por tipo de dispositivo (`apps.politicas.depreciacion`). Valor en libros en la ficha y reporte del parque |
| 20 | Integraciones | Parcial | Las dos de hardware —lector de código de barras y etiquetadora— están; las de software (AD, Microsoft 365, Zoho, Jira, ERP, RRHH) no. §25 las prioriza como bajas |
| 21 | No funcionales | ✅ | Rendimiento medido con 10.000 activos y respaldos con restauración verificada y **programables desde la aplicación** (`docs/rendimiento.md`, `docs/respaldos.md`) |
| 22.3 | Integración con compras o proveedores | Parcial | La compra se pide y se sigue **dentro** del sistema (`apps.solicitudes`) y el catálogo de proveedores existe; el enlace con un sistema de compras externo, no |

## Lo que falta

Una cosa, y no es funcionalidad de negocio.

**Integraciones de software (§20, §22.3).** Active Directory / Azure AD,
Microsoft 365, Zoho, Jira Service Management, ERP y el sistema de RRHH. El
documento las prioriza como **bajas** en el §25 y las deja para la Fase 3.

La **aplicación móvil** que acompañaba a ese punto ya no falta: se resolvió
haciendo instalable la que hay (ver «Fase 10» más abajo), y no construyendo una
aparte —serían dos bases de código que alguien tendría que mantener iguales, y
lo que el inventario físico necesita del teléfono ya estaba hecho—.

De la Fase 3 sí están hechas la **predicción de reemplazo por cantidad de
fallas** —umbral de mantenimientos con ventana móvil—, los **costos acumulados
por activo** y la **gestión de depreciación**. De «integración con compras o
proveedores» están las dos mitades internas —el catálogo de proveedores y, desde
la Fase 12, las solicitudes de compra—: lo que no está es el enlace con un
sistema de compras externo, que es lo que el punto pedía.

Pendiente de medición, no de código: repetir la **concurrencia** contra el
stack de producción (Gunicorn); las cifras actuales se tomaron con el servidor
de desarrollo, que es monoproceso.

### Deuda de calidad cerrada (2026-09-14)

La matriz de trazabilidad ya no tiene ningún criterio marcado «No» sin
explicación. Los diez que lo estaban se automatizaron:

- **Los siete de arquitectura** (AC-008, 009, 011, 012, 013, 014, 015) parecían
  verdades obvias —«el backend usa Django»—, que es justo por lo que nadie los
  volvía a comprobar. Ahora son pruebas sobre la estructura del repositorio, y
  lo que sostienen no es el presente sino los límites: que el backend no empiece
  a servir la interfaz, que los estilos no se muden al JSX, que las vistas no
  escriban en la base saltándose la capa de servicios.
- **Los tres de higiene** (AC-025, 026, 043) se resolvieron leyendo el índice de
  git: ningún secreto real versionado, los tres `.env.example` con marcadores, y
  ninguna migración que siembre personas o equipos. Son de los que fallan por
  acumulación —el día que alguien copia su `.env` para reproducir un fallo—, así
  que conviene que los vigile una máquina.

También se cubrió **`recalcular_indicadores`**, el comando que corre por cron y
mantiene vivas las sugerencias de renovación. Importaba porque **falla en
silencio**: nadie ve una pantalla que diga «el recálculo de anoche no corrió»,
solo un listado que contesta lo mismo que ayer. Dieciséis pruebas, incluida la
de que recorre todas las empresas —fuera de una petición no hay empresa activa,
y un cron acotado a una dejaría a las demás congeladas sin decirlo—.

Siguen sin prueba `medir_rendimiento`, `prueba_de_carga` y
`sembrar_datos_rendimiento`: son herramientas de medición, no piezas del
sistema, y su salida se lee a ojo cada vez que se usan.

## Diferencias por decisión, no por omisión

- **Código QR (§5).** Descartado el 2026-09-09: el inventario se hace con
  pistola láser, no con cámara. Se reforzó el Code 128 en su lugar (ver
  `docs/codigos-de-barras.md`).
- **Ubicación física (§4.1).** El documento pide ubicación; el sistema la
  resuelve con **sede + ciudad**. Hubo un segundo nivel —la bodega u oficina
  dentro de la sede— y se retiró el 2026-09-09: obligaba a elegir dos veces en
  cada traslado y a inventar una bodega para cada sitio donde hubiera un
  equipo, con lo que el catálogo se llenaba de entradas como «Piso 1» que no
  dicen nada. La pregunta que se hace de un equipo es «¿dónde está?», y se
  responde con la ciudad.
- **Nomenclatura del código.** El documento propone `LAP-000458`; el sistema
  genera `GA-LAP-000001`, con un prefijo de empresa por delante. Se alinea
  cambiando `PREFIJO` en `apps/activos/barcode.py`, pero renumeraría solo los
  activos nuevos: los ya etiquetados conservan su código, porque las etiquetas
  están pegadas en equipos físicos.

## Vacíos en lo que parece cubierto

Estos importan más que lo directamente ausente, porque a primera vista dan la
impresión de estar resueltos.

**Estados del activo.** Resuelto: los nueve del §12 están implementados
(disponible, asignado, en reparación, en garantía, en bodega, en tránsito, dado
de baja, perdido y robado). Lo que importaba no era la lista sino la frontera:
los tres estados de salida —baja, perdido y robado— sacan al equipo del parque,
y con ella dejan de contar en el panel, las alertas, las sugerencias de
renovación y la bitácora de mantenimientos.

Al implementarlo apareció un hueco anterior: se podía asignar un custodio a un
equipo dado de baja. El estado no cambiaba, pero el responsable sí, y quedaba
alguien respondiendo por un equipo que ya no existe.

**Notificación proactiva.** Resuelta: el resumen se envía por correo a los
destinatarios elegidos (`manage.py enviar_alertas`, ver más abajo). Lo que
sigue siendo una condición externa es el **servidor SMTP**: con el backend de
consola que trae la configuración por defecto, el envío se da por exitoso y el
correo se imprime en el log — sirve para probar el contenido, no la entrega.

## Corrección de este análisis (2026-09-09)

Las versiones anteriores de este documento resumían mal dos puntos, y la
diferencia importa porque de ellas salía el alcance:

- **«Categoría»** (§4.1) no es una familia de equipos aparte del tipo: el
  documento la define como «clasificación por uso, criticidad o perfil del
  equipo», es decir, exactamente los dos campos del §12. No hace falta un
  tercer catálogo; con criticidad y uso queda cubierta.
- **La criticidad tiene cuatro niveles** (baja, media, alta, **crítica**) y
  **el «uso» es la función del equipo** —administrativo, operativo,
  desarrollo, diseño, gerencial, atención al cliente, bodega,
  infraestructura—, no su intensidad. Dos laptops idénticas pueden ser una de
  gerencia y otra de bodega, y eso cambia con qué urgencia se repone cada una.

También se confirmó que los estados del §12 son nueve e incluyen **disponible**
separado de **en bodega**: los dos están almacenados, pero solo el primero se
puede entregar hoy.

## Rendimiento

**Medido el 2026-09-09 con 10.000 activos** (ver `docs/rendimiento.md`). El
inventario nunca fue el problema: con filtros combinados responde en 18 ms y
dos consultas. Lo que estaba mal eran las tres pantallas que agregan el parque
entero —panel, alertas y sugerencias— que tardaban entre 55 y 61 segundos por
un defecto que solo se ve con volumen: el motor de renovación hacía una
consulta de política **por activo**. Corregido, quedan en 365 ms, 741 ms y
1.081 ms, y las dos primeras se cachean.

Queda pendiente repetir la medición de **concurrencia** contra el stack de
producción (Gunicorn): las cifras actuales se tomaron con el servidor de
desarrollo, que es monoproceso.

## Estado del MVP (§22.1)

**Los 15 puntos de la Fase 1 están implementados** desde el 2026-09-08, con el
dashboard y la exportación a Excel.

**Los 10 indicadores del dashboard (§15) se calculan**, incluidas las
garantías vencidas y por vencer, desde que se incorporó la fecha de fin de
garantía. El panel distingue «sin garantía registrada» de «vencida»: mezclarlas
haría que un inventario a medio capturar pareciera un parque sin cobertura.

### Fase 2 — adjuntos y actas (§18, §6)

- Los nueve tipos de documento del §18, con validación de tamaño, extensión y
  firma del contenido.
- Los archivos no se sirven como estáticos: la descarga exige permiso y queda
  auditada.
- Actas de entrega y devolución en PDF, generadas desde el movimiento y
  archivables en la ficha del equipo.

### Fase 2 — centro de alertas (§19, §22.2)

- Las siete alertas del documento, calculadas al vuelo: próximos a reemplazo,
  garantías por vencer, demasiadas reparaciones, sin asignar, reparaciones sin
  cerrar, custodios inactivos y fichas sin actualizar.
- Umbrales en días configurables y cada alerta se puede apagar.
- Cada tarjeta enlaza al listado ya filtrado; para ello se sumaron los filtros
  días sin actualizar y reparaciones pendientes.

### Fase 2 — reglas automáticas de reemplazo (§22.2)

- Dos niveles de sugerencia: «Evaluar reemplazo» y «Reemplazo recomendado»,
  con un umbral de antigüedad para cada uno.
- Ventana móvil configurable para el conteo de reparaciones («más de 3 en 12
  meses»). Vacía = todo el historial, que es el comportamiento anterior.
- El veredicto de un activo es el nivel más severo de sus motivos; el panel,
  el inventario y las sugerencias distinguen ambos niveles.

### Fase 2 — aviso por correo (§19, §22.2)

Cierra la Fase 2. El centro de alertas ya sabía qué necesita atención; ahora lo
dice sin que nadie entre a mirarlo.

- `manage.py enviar_alertas` corre por cron **todos los días** y la
  configuración decide si hoy toca: diaria, o semanal en el día elegido. Dos
  pasadas el mismo día no duplican el correo.
- Se puede omitir el correo los días sin nada pendiente, que es el
  comportamiento por defecto: el aviso que llega siempre igual deja de leerse
  y arrastra consigo al que sí traía algo.
- **El correo lleva recuentos y enlaces, no equipos ni nombres**: sale del
  perímetro del sistema hacia buzones donde no rigen sus permisos.
- **Solo reciben los usuarios que pueden ver las alertas**, y el filtro se
  aplica al enviar: revocar el permiso o deshabilitar la cuenta basta para que
  alguien deje de recibir.
- Cada pasada deja una fila con su resultado y su motivo, también cuando no se
  envió. Un envío que falla en silencio hace creer que alguien fue advertido.
- Botón de prueba en la pantalla de configuración: escribe solo a quien lo
  pide, y avisa si el servidor de correo rechaza el envío.

### Fase 6 — copias de seguridad (§21)

- `manage.py respaldar`: base de datos **y adjuntos**, que viven en el sistema
  de archivos y no se regeneran.
- El respaldo se **verifica** antes de darse por bueno. El defecto que lo hizo
  necesario: con la ruta como parámetro, SQL Server no escribía nada y no
  lanzaba error — el comando informaba de un respaldo que no existía.
- Cada respaldo lleva un manifiesto con los conteos, para comparar después de
  restaurar. Restauración **probada de extremo a extremo** el 2026-09-09.
- `verificar_despliegue` avisa si no consta ningún respaldo o si el último
  tiene más de una semana.
- El **cuándo** se decidía en el programador de tareas del servidor; desde la
  Fase 13 se configura desde la aplicación.

### Fase 5 — los siete tiempos del activo (§10)

- Los siete que pide el documento, cuatro de ellos reconstruidos desde el
  historial de movimientos en vez de guardarse como contadores: mantenerlos al
  día en cada operación los desincronizaría justo en los equipos que más se
  mueven.
- El tiempo con el custodio actual cuenta desde la última entrega a esa
  persona, no desde la primera.
- Un equipo que salió del inventario deja de acumular tiempo: si no, un equipo
  robado hace seis meses aparecería como el más ocioso del parque.
- Solo se calculan en la ficha, con el historial precargado; en el listado
  multiplicarían las consultas por el número de filas.

### Fase 4 — los trece reportes (§16)

- Los trece del documento, cada uno en **Excel, CSV y PDF**.
- Definidos como datos en un catálogo (`apps/reportes/catalogo.py`) y no como
  trece vistas: nueve son el mismo listado de activos con otro filtro, y
  escribirlos por separado daría treinta y nueve piezas que envejecen sueltas.
- La pantalla se dibuja desde el catálogo: un reporte nuevo aparece sin tocar
  el frontend.
- Descargar es un permiso distinto de consultar (`reportes.exportar`), y cada
  descarga queda auditada con el formato y los filtros usados.
- Cada archivo lleva nombre, fecha de emisión, total de filas y filtros; si se
  corta por el tope, lo dice.

### Fase 3 — la ficha completa del activo (§4.1, §12, §14)

- **Los nueve estados**, con los tres de salida (baja, perdido, robado)
  tratados como una frontera única del parque en vez de una comparación contra
  «dado de baja» repetida en nueve archivos.
- **Sede de catálogo**, migrando sin pérdida el texto libre que ya estaba
  cargado. Cerrar una sede con equipos dentro se rechaza. Dónde está un equipo
  se responde con la **ciudad** de su sede: el nombre interno no le dice nada a
  quien tiene que ir a buscarlo.
- **Criticidad de cuatro niveles y uso por función**, más la **fecha de
  ingreso** separada de la de compra.
- **Filtros del §14** completos: sede, criticidad, uso y antigüedad en meses,
  todos resueltos en SQL.
- La carga masiva y la exportación a Excel arrastran los campos nuevos; la
  plantilla trae las hojas «Sedes» y «Proveedores» con los valores válidos.

### Fase 7 — catálogos administrables y control de duplicados (2026-09-09)

Cierra el §3 y el §13 por el lado de los datos maestros: todo lo que alimenta
una asignación se administra desde la aplicación y se defiende de sí mismo.

- **Catálogo de proveedores**, para equipos **y para piezas de repuesto**. Lo
  segundo no existía: el proveedor del equipo no tiene por qué ser el de la
  pieza, así que una pieza que fallaba a los dos meses dejaba el costo
  registrado y ninguna forma de saber a quién reclamarle.
- **Catálogo de sedes** con su ciudad, sustituyendo el texto libre.
- **Duplicados rechazados sin distinguir mayúsculas** en tipos, áreas y
  proveedores, nombrando con cuál se choca. La restricción única de la base sí
  distingue: «Laptop» y «LAPTOP» pasaban las dos y quedaban dos entradas
  indistinguibles en el desplegable, con los activos repartidos entre ambas.
- **El código del empleado lleva delante su área** —`TI-0001`, `CONT-0002`—
  en vez de un correlativo global que no decía nada de la persona. Aparece en
  actas de entrega y en la plantilla de carga.
- **Reporte de validación de la carga masiva** separado en errores (bloquean) y
  advertencias (no bloquean), agrupado por fila. La serie repetida bloquea
  —identifica al equipo físico—; el nombre repetido avisa, porque dos equipos
  pueden llamarse igual pero también delata la fila pegada dos veces.
- Los errores de validación **llegan a la pantalla**: viajaban envueltos y la
  interfaz mostraba «Error en la solicitud.», escondiendo la única frase que
  decía qué corregir.

### Fase 14 — La auditoría se lee desde el panel (§17, 2026-09-25)

El registro existía completo desde el principio —cada operación
administrativa, con su antes y su después, quién, desde dónde y con qué
resultado— pero **solo se podía leer consultando la API**. En la práctica eso
es no tenerlo: quien necesita saber quién dio de baja un equipo no abre una
terminal, pregunta por el pasillo.

La pantalla filtra por persona, por acción, por resultado y por rango de
fechas. El filtro por persona se añadió al servidor para esto: aceptaba el
`id` del actor y no su nombre, y averiguarlo obliga a pasar por el listado de
cuentas, que exige un permiso —`usuarios.ver`— que un auditor no tiene por qué
tener.

Los tres permisos que ya existían se respetan en la pantalla y no solo en la
API: sin `auditoria.ver_detalle` no se ofrece abrir el antes/después —un botón
que abriera dos columnas vacías haría pensar que el evento no cambió nada— y
sin `auditoria.exportar` no aparece el botón. La entrada del menú cuelga de
«Usuarios y roles» con permiso propio, para que quien solo audita llegue a
ella sin poder ver las cuentas.

Lo que se exporta es lo que se está viendo, con los mismos filtros: un botón
que bajara el registro entero obligaría a repetir fuera el trabajo de acotarlo.

Ocho criterios nuevos (AC-AUD-001 a AC-AUD-008) en `auditoria.feature` y en la
matriz.

### Fase 13 — El respaldo se programa desde la aplicación (§21, 2026-09-17)

El §21 pide respaldos automáticos y el comando existe desde la Fase 6, pero el
**cuándo** vivía en el programador de tareas del servidor. Eso lo dejaba fuera
del alcance de quien decide cada cuánto hay que respaldar: cambiar «semanal» por
«diaria» necesitaba un administrador de servidores, así que en la práctica no se
cambiaba nunca.

Ahora la política se configura en *Configuración → Respaldos* —encendido o
apagado, diaria o semanal y qué día, a partir de qué hora, en qué carpeta y
cuántos conservar— y la tarea del sistema corre **cada hora, siempre igual**:
`respaldar --si-toca` es quien decide. Es el mismo reparto que el resumen de
alertas, donde la frecuencia ya vivía en la aplicación.

Que corra cada hora es lo que hace configurable la hora, y obliga a defenderse
de repetir: la marca del último respaldo deja uno por día aunque la tarea pase
veinticuatro veces, y un respaldo lanzado **a mano no cuenta** como el
programado, para que probar el comando un martes no salte el del miércoles. La
retención retira los más viejos al escribir uno nuevo, porque un disco lleno
hace fallar el respaldo justo cuando más falta hace. La pantalla dice cuándo fue
el último y cuándo será el próximo —o que está apagado, en vez de anunciar un
próximo que no va a ocurrir— y cada cambio de la política queda auditado.

Con la base en Docker, el `.bak` lo escribe SQL Server en **su** sistema de
archivos. Sin el montaje que ahora añade el `docker-compose.yml`, el respaldo
automático funcionaba y dejaba la mitad importante dentro del contenedor: el
mismo sitio que la base, que no protege del caso que de verdad importa, perder
la máquina. Y queda lo que tampoco es código: que esa carpeta se copie fuera de
esta máquina (anotado en `docs/security-review.md`).

Siete criterios (AC-BAK-009 a AC-BAK-015) en `respaldos.feature` y en la matriz.

### Fase 12 — Solicitudes de compra (§22.3, 2026-09-16)

El inventario responde qué hay; faltaba dónde responder **qué falta**. Una
laptop pedida por correo no está en ninguna parte hasta que llega: nadie podía
decir cuántas se habían pedido, quién las pidió ni en qué punto estaban, y
cuando alguien preguntaba, la respuesta salía de la memoria de quien compra.

Una solicitud **nace con encargado** —quien pide elige a quién le llega—, y eso
es lo que hace de «Solicitudes recibidas» una lista de tareas y no una bandeja
común donde todos suponen que la está mirando otro. Las dos pantallas son la
misma lista desde los dos lados: lo que pedí y lo que me toca gestionar.

Lo que se pide sale del catálogo —un tipo de dispositivo o un componente— y,
cuando el tipo declara características, **se pide con ellas**: «una laptop» y
«una laptop con 32 GB y disco NVMe» son dos compras distintas, y la diferencia
se perdía dentro de la justificación escrita a mano, donde no se puede filtrar
ni comparar con lo que acabó comprándose. Se guardan bajo el nombre declarado,
el mismo de la ficha del activo, así que lo pedido y lo entregado se leen con el
mismo vocabulario. También se puede escribir lo que el catálogo no tiene:
exigirlo obligaría a dar de alta un tipo para poder pedirlo, y lo que se pide
suele ser justamente lo que todavía no existe.

El recorrido —pendiente, en gestión, comprada, entregada, más rechazo y
cancelación— es una tabla de transiciones y no una lista de estados: lo que no
está en ella no pasa, así que una solicitud no vuelve de «entregada» a
«pendiente» ni se salta la compra. Cada paso se escribe en un histórico
append-only con quién lo dio y por qué, igual que la custodia de un equipo, y el
rechazo **exige motivo**: es lo único que le llega como explicación a quien
pidió. Nada se borra —lo que se abandona se cancela— y quien pidió puede retirar
lo suyo, pero no aprobarlo.

Pedir y decidir si se compra se separan en cuatro permisos (`solicitudes.ver`,
`.crear`, `.gestionar`, `.administrar`): cualquiera que trabaje con equipos
debería poder pedir uno, y gestionar habilita a mover **las asignadas a uno**
—administrar, las de todos—. Por eso el rol «Usuario final» recibe ver y crear:
dejar la solicitud solo en manos de soporte la devolvería al correo, que es de
donde este módulo la saca. El correo se conserva, pero como aviso —al encargado
cuando le asignan algo, a quien pidió en cada paso—, y si el destinatario no
tiene correo se dice en el acto en vez de dar por enviado lo que no salió.

Veinticuatro criterios (AC-SOL-001 a AC-SOL-024) en
`solicitudes-de-compra.feature`, más los nueve de seguridad (AC-SEC-014 a
AC-SEC-022) de la revisión que acompañó al módulo, en
`hallazgos-de-seguridad.feature`.

### Fase 11 — El tipo se describe al crearlo (§3, §4.2, 2026-09-15)

Las características por tipo ya existían; faltaba poder declararlas **en el
mismo formulario que crea el tipo**. Había que guardar el tipo, reabrirlo y
describirlo después, y entre una cosa y otra el tipo ya estaba en el desplegable
sin declarar nada: los primeros equipos que entraran por ahí se cargaban con
características libres, que es justo la dispersión que declararlas evita.

Ahora el `POST` de `/activos/tipos/` acepta la lista y crea las dos cosas en una
transacción, así que un tipo **nunca queda creado y descrito a medias**: si una
característica se rechaza, no se crea ninguna ni el tipo. Solo en el alta —
describir un tipo que ya existe se sigue haciendo de a una, porque reenviar la
lista entera obligaría a decidir qué pasa con las que no vengan y cualquiera de
las dos respuestas pisa lo que otra persona acaba de añadir—.

Se suma un séptimo tipo de dato, **texto ampliado**: varios renglones, hasta
2000 caracteres, para lo que no cabe en una línea. Se separa del texto normal
porque el control decide lo que la gente escribe —en una casilla de una línea
nadie redacta dos frases, las abrevia hasta que dejan de entenderse— y el tope
existe porque la ficha de un equipo no es el sitio para un manual: para eso
están los adjuntos, que se descargan aparte en vez de viajar en cada listado.

Seis criterios nuevos (AC-CAR-013 a AC-CAR-018) en `ficha-completa-activo.feature`
y en la matriz.

### Fase 10 — Aplicación instalable (§20, 2026-09-14)

La misma aplicación, instalable en el teléfono: manifiesto, iconos, service
worker y una página propia para cuando no hay red. Se abre desde la pantalla de
inicio sin barra de direcciones, arranca en `/admin` y ofrece dos atajos —la
consulta por escáner y «mis equipos»—, que son los dos usos que justifican
llevarla en el bolsillo.

**Lo que no hace, y es deliberado: no guarda ni una respuesta de la API.** Un
inventario que enseña lo de ayer es peor que uno que dice «no hay conexión»,
porque el segundo se nota y el primero no: alguien lee que el equipo está en
Quito, viaja, y estaba en Guayaquil desde el martes. Se guarda el armazón —el
HTML, el JavaScript, los estilos, los iconos— y nada más.

**Trabajar sin conexión sigue pendiente**, y es otra cosa: capturar lecturas en
una bodega sin señal y sincronizarlas después exige decidir antes qué pasa
cuando dos personas inventarían el mismo equipo, cuánto tiempo puede vivir una
lectura sin subir y qué se hace con una que llega tarde. Mientras eso no se
decida, la aplicación instalada necesita red para consultar, igual que la web.

Verificable con `npm run pwa:verificar`, que compila, abre un navegador de
verdad y comprueba las cinco cosas —incluida, sin red, que la API falla en vez
de responder—. Las pruebas de Vitest sostienen el manifiesto y el contenido del
service worker; el registro solo ocurre sobre la compilación, así que esa parte
no la cubre ni Vitest ni el resto de las pruebas de extremo a extremo.

### Fase 9 — Valor en libros y depreciación (§22.3)

Cierra lo único de la Fase 3 que era funcionalidad propia y no una integración.

- Es depreciación **de gestión**, no contabilidad: responde «qué vale hoy el
  parque» y «cuánto se pierde al dar de baja este equipo», que es lo que
  respalda una solicitud de compra. Lo que se declara ante el SRI lo lleva el
  ERP —el §20 se lo asigna— y el §25 deja la «depreciación contable avanzada»
  en prioridad baja. Por eso hay un solo método, línea recta, y no una lista
  de métodos entre los que elegir.
- **La vida contable no es la vida útil de la política de renovación.** Son dos
  números distintos a propósito: un equipo se deprecia en tres años —36 meses,
  lo que fija el reglamento ecuatoriano para equipo de cómputo— y se reemplaza
  a los cuatro o cinco. Un equipo totalmente depreciado que sigue funcionando
  es lo normal, y confundir ambas cifras haría que la contabilidad decidiera
  cuándo se compra. Las dos pantallas conviven en pestañas por eso mismo.
- Se deprecia desde la **puesta en servicio**, no desde la factura: un equipo
  comprado en diciembre y entregado en marzo empieza a perder valor en marzo.
- Un equipo sin costo capturado o sin política **no muestra un cero**: cero
  significa «ya no vale nada», que es muy distinto de «nadie capturó lo que
  costó». El reporte deja esas celdas vacías para que no entren en el total.
- De paso se corrigió un 500 que ya estaba en producción: crear una segunda
  política **global** —de renovación o de depreciación— chocaba con la
  restricción de la base en vez de responder un 400 con su motivo.

### Fase 8 — «Mis equipos» y el rol «Usuario final» (§13)

Cierra el §13: los cinco roles del documento existen.

- `activos.ver_asignados` es un permiso **distinto** de `activos.ver`, y en eso
  consiste el rol: muestra los equipos de quien pregunta, no el inventario.
- La pantalla no muestra costo, proveedor, veredicto de renovación ni quién
  tuvo antes el equipo: son datos del inventario, no del aparato que uno usa, y
  el veredicto es además una decisión de planificación.
- La cuenta con la que se entra y la ficha de empleado que custodia equipos son
  dos cosas distintas —la mayoría de quienes reciben un equipo nunca inician
  sesión—, así que hay que enlazarlas. Cuando no lo están, la pantalla lo dice:
  «no tienes equipos» y «tu cuenta no está enlazada» se arreglan de formas muy
  distintas, y la segunda necesita a un administrador.
- El «desde cuándo lo tengo» sale del historial, no de la ficha: un equipo que
  fue y volvió tiene varias entregas, y la que responde es la última a esa
  persona. Se muestra con la fecha y el tiempo transcurrido, porque lo que se
  quiere saber es si el equipo lleva dos meses o cuatro años.
- La ficha de empleado pertenece a **una** empresa y la cuenta puede trabajar
  en varias, así que hay un tercer caso: mirando desde la otra, la pantalla
  dice en cuál está la ficha. Una lista vacía se leería como «ya no tienes
  nada», cuando lo que hay que hacer es cambiar de empresa en el menú —y eso lo
  resuelve quien mira, sin pedirle nada a un administrador—.
- Entrar a `/admin` dejó de llevar siempre al panel principal, que exige
  `activos.ver`: ahora lleva a la primera pantalla que cada quien puede abrir.
  Sin eso, el usuario final entraba al sistema y chocaba con un 403 teniendo su
  pantalla a un clic (`frontend/src/routes/InicioDelPanel.jsx`).

### Cerrado el 2026-09-08 (garantías y reparación)

- Proveedor —entonces texto libre, hoy de catálogo— y fecha de fin de garantía
  en la ficha, con estado derivado
  (vigente / por vencer a 30 días / vencida / sin registrar) y filtro en el
  inventario resuelto en SQL.
- Fecha de salida de la reparación, con los días fuera de operación por
  intervención, por activo y acumulados en el panel.
- Causa, solución, estado final y «cubierto por garantía» en la bitácora.
- Todo ello disponible también en la plantilla de carga masiva y en la
  exportación a Excel.
