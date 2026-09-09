# Análisis de brecha: documento funcional vs. sistema construido

Compara `Sistema_Gestion_Activos_TI.docx` (Documento Funcional v1.0) con el
estado del sistema. Actualizado el 2026-09-09 (catálogo de proveedores).

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
| Integraciones (§20) | Solo las de hardware: lector y etiquetadora |

## Sección por sección

| § | Requerimiento | Estado | Dónde |
| --- | --- | --- | --- |
| 3 | Tipos de activos configurables | ✅ | `apps.activos.TipoDispositivo` |
| 4.1 | Datos generales del activo | ✅ | Los nueve estados, fecha de ingreso, sede de catálogo y proveedor de catálogo |
| 4.2 | Características técnicas | ✅ | Campo `especificaciones`, libre por tipo de equipo |
| 5 | Código de barras + etiqueta + escaneo | ✅ | `barcode.py`, `etiquetas_pdf.py`, `/activos/por-codigo/` |
| 5 | Código QR opcional | ⛔ Descartado | Decisión del 2026-09-09: el inventario se hace con pistola láser, no con cámara. Se refuerza el Code 128 (ver `docs/codigos-de-barras.md`) |
| 6 | Asignación y devolución | ✅ | Con acta de entrega y devolución en PDF |
| 7 | Histórico de asignaciones | ✅ | `MovimientoActivo`, append-only |
| 8 | Registro de reparaciones | ✅ | Causa, solución, estado final, garantía usada e ingreso/salida |
| 9 | Histórico de reparaciones | ✅ | Días fuera de operación por intervención y acumulados |
| 10 | Cálculo de tiempos | ✅ | Los siete del documento, reconstruidos desde el historial (`apps.activos.tiempos`) |
| 11 | Reglas de reemplazo | ✅ | Dos niveles (evaluar / recomendado) y ventana móvil configurable |
| 12 | Categorización (criticidad, uso) | ✅ | Criticidad de cuatro niveles y uso por función, además del tipo |
| 13 | Usuarios y roles | ✅ | Roles configurables, 38 permisos, y los **cinco** roles del documento listos para crear (`crear_roles_iniciales`), incluido «Usuario final» con su pantalla *Mis equipos* |
| 14 | Buscador y filtros | ✅ | Tipo, área, custodio, estado, garantía, sede, criticidad, uso y antigüedad |
| 15 | Dashboard | ✅ | `apps/activos/dashboard.py`, `/admin/dashboard` |
| 16 | Reportes y exportación | ✅ | Los trece reportes, cada uno en Excel, CSV y PDF (`apps.reportes`) |
| 17 | Auditoría | ✅ | `AuditLog`, append-only |
| 18 | Adjuntos y evidencias | ✅ | `apps.adjuntos`, con los nueve tipos del documento |
| 19 | Notificaciones y alertas | ✅ | Las siete alertas, más el envío del resumen por correo con frecuencia configurable |
| 20 | Integraciones | Parcial | Las dos de hardware —lector de código de barras y etiquetadora— están; las de software (AD, Microsoft 365, Zoho, Jira, ERP, RRHH) no. §25 las prioriza como bajas |
| 21 | No funcionales | ✅ | Rendimiento medido con 10.000 activos y respaldos con restauración verificada (`docs/rendimiento.md`, `docs/respaldos.md`) |

## Lo que falta

Dos cosas, y solo una es funcionalidad de negocio.

**Gestión de depreciación (§22.3).** No hay nada. Es lo único de la Fase 3 que
es funcionalidad propia y no una integración con otro sistema.

**Integraciones de software (§20, §22.3).** Active Directory / Azure AD,
Microsoft 365, Zoho, Jira Service Management, ERP y el sistema de RRHH. El
documento las prioriza como **bajas** en el §25 y las deja para la Fase 3.
También cae aquí la **aplicación móvil o PWA**.

De la Fase 3 sí están hechas la **predicción de reemplazo por cantidad de
fallas** —umbral de mantenimientos con ventana móvil—, los **costos acumulados
por activo** y el lado de **proveedores** de «integración con compras o
proveedores»: existe el catálogo, no el enlace con un sistema de compras.

Pendiente de medición, no de código: repetir la **concurrencia** contra el
stack de producción (Gunicorn); las cifras actuales se tomaron con el servidor
de desarrollo, que es monoproceso.

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
  de custodio inactivo, días sin actualizar y reparaciones pendientes.

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
  persona.

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
