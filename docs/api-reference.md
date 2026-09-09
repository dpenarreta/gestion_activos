# Referencia de API

Base: `/api/v1/`. Documentación interactiva (drf-spectacular): `/api/v1/schema/swagger-ui/`.

Todas las respuestas de error siguen el contrato:

```json
{ "error": { "code": "string", "message": "string", "details": {} } }
```

## Autenticación

| Método | Ruta | Auth | Permiso |
| --- | --- | --- | --- |
| POST | `auth/register/` | Pública | — |
| POST | `auth/login/` | Pública | — |
| POST | `auth/token/refresh/` | Pública | — |
| POST | `auth/logout/` | Requerida | — |
| POST | `auth/logout-all/` | Requerida | — |
| GET | `auth/sessions/` | Requerida | — |
| GET | `auth/me/` | Requerida | — |
| POST | `auth/password-reset/request/` | Pública | — |
| POST | `auth/password-reset/confirm/` | Pública | — |
| POST | `auth/password/change/` | Requerida | — |

## Usuarios (`admin/users/`)

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `admin/users/` | `usuarios.ver` |
| POST | `admin/users/` | `usuarios.crear` |
| GET | `admin/users/{id}/` | `usuarios.ver` |
| PATCH | `admin/users/{id}/` | `usuarios.editar` |
| POST | `admin/users/{id}/enable/` | `usuarios.deshabilitar` |
| POST | `admin/users/{id}/disable/` | `usuarios.deshabilitar` |
| POST | `admin/users/{id}/block/` | `usuarios.deshabilitar` |
| POST | `admin/users/{id}/unblock/` | `usuarios.deshabilitar` |
| GET | `admin/users/{id}/sessions/` | `usuarios.editar` |
| POST | `admin/users/{id}/sessions/revoke/` | `usuarios.editar` |
| POST | `admin/users/{id}/password-reset/` | `usuarios.restablecer_password` |
| POST | `admin/users/{id}/roles/` | `usuarios.editar` |
| POST | `admin/users/{id}/permissions/` | `usuarios.editar` |

Sin `DELETE`: la eliminación física de usuarios está deshabilitada a
propósito (baja lógica vía `disable`/`block`, ver AC-DP-006).

## Roles (`admin/roles/`)

| Método | Ruta | Permiso (lectura / escritura) |
| --- | --- | --- |
| GET | `admin/roles/` | `roles.ver` |
| POST | `admin/roles/` | `roles.editar` |
| GET | `admin/roles/{id}/` | `roles.ver` |
| PATCH | `admin/roles/{id}/` | `roles.editar` |
| DELETE | `admin/roles/{id}/` | `roles.editar` |
| GET | `admin/roles/permissions-catalog/` | `roles.ver` |

## Permisos (`admin/permissions/`)

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `admin/permissions/` | `permisos.ver` |

Solo lectura: el catálogo es código versionado, no un recurso editable en
runtime (ver `docs/roles-and-permissions.md`).

## Inventario de activos (RF-01, RF-02, RF-03, RF-08)

Base: `/api/v1/activos/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/activos/` | `activos.ver` | Listado paginado. Filtros: `q`, `tipo`, `departamento`, `custodio`, `estado`, `sede` (id), `sede_nombre`, `criticidad`, `uso`, `antiguedad_min_meses`, `antiguedad_max_meses`, `operativos`, `almacenados`, `requiere_renovacion`, `garantia` (`vigente\|por_vencer\|vencida\|sin_registrar`) |
| POST | `/activos/` | `activos.crear` | Alta. El `codigo_barras` lo genera el sistema (RF-02) |
| GET | `/activos/{id}/` | `activos.ver` | Ficha completa, con el veredicto de renovación calculado en vivo |
| PATCH | `/activos/{id}/` | `activos.editar` | Edita la ficha técnica. No admite `custodio`/`departamento`/`estado` |
| GET | `/activos/por-codigo/{codigo}/` | `activos.ver` | **RF-03.** Resuelve por código de barras *o* número de serie; devuelve ficha, movimientos, mantenimientos y costos |
| GET | `/activos/{id}/historial/` | `activos.ver` | Igual que el anterior, por id |
| POST | `/activos/{id}/asignar/` | `activos.asignar` | Asigna, traslada o devuelve. `custodio: null` deja el equipo sin responsable; omitir `sede` no toca el sitio y `null` lo borra. El movimiento se registra como **traslado** si el sitio cambió y como **devolución** si solo se soltó al responsable |
| POST | `/activos/{id}/cambiar-estado/` | `activos.dar_baja` | Cambia el estado. Las tres salidas (baja, perdido, robado) exigen `motivo`; desde una baja no se vuelve |
| GET | `/activos/{id}/etiqueta/` | `activos.imprimir_etiqueta` | **RF-08.** `?formato=pdf` (por defecto, devuelve el documento) o `zpl\|tspl` (trabajo térmico). `?descargar=false` entrega el PDF inline para previsualizar |
| GET | `/activos/{id}/etiqueta/medicion/` | `activos.imprimir_etiqueta` | Geometría del símbolo impreso: módulo, zona muda y altura |
| POST | `/activos/etiquetas/` | `activos.imprimir_etiqueta` | Lote de etiquetas en un solo trabajo (`{"ids": [...]}`, máx. 200) |
| GET | `/activos/plantilla-importacion/` | `activos.crear` | Plantilla .xlsx de carga masiva, con los catálogos vigentes |
| POST | `/activos/importar/` | `activos.crear` | Multipart con `archivo` (.xlsx, máx. 5 MB) y `confirmar`. Sin confirmar solo valida y devuelve el reporte —`errores` (bloquean), `advertencias` (no bloquean) y `filas_con_error`, todos con fila y columna—; con `confirmar=true` importa (todo o nada) |
| GET | `/activos/columnas-plantilla/` | `activos.ver` | Columnas configuradas de la plantilla |
| POST/PATCH/DELETE | `/activos/columnas-plantilla/` | `activos.editar` | Configura qué se pide. Clave: un campo del activo o `espec:<Nombre>` para una característica propia. Las estructurales (tipo, nombre, serie, departamento, fecha) no se desactivan ni se eliminan |
| GET | `/activos/columnas-plantilla/campos-disponibles/` | `activos.ver` | Campos que una columna puede llenar, con cuáles ya están en uso |
| GET/POST/PATCH | `/activos/tipos/` | `activos.ver` / `activos.editar` | Catálogo de tipos de dispositivo |

`DELETE` no existe en este recurso: un activo se da de baja, nunca se borra.

La situación de garantía (`estado_garantia`, `dias_para_fin_de_garantia`) es de
solo lectura: se deriva de `fecha_fin_garantia`, que es el único dato que se
captura. El filtro `garantia` se traduce a rangos de fecha en SQL, no evalúa la
propiedad en Python. Lo mismo vale para `antiguedad_min_meses` /
`antiguedad_max_meses`: un equipo «de al menos 36 meses» se adquirió *antes* de
hace 36 meses, así que los operadores quedan invertidos respecto de lo que se
lee — es el error fácil de cometer al tocar ese filtro.

### Los siete tiempos del §10

La ficha (`GET /activos/{id}/`) incluye un bloque `tiempos` con los siete que
pide el documento, todos en días: desde la compra, desde el ingreso, desde la
primera asignación, con el custodio actual, acumulado en reparación, guardado
sin uso y activo real. Se acompaña de `medido_desde` (`ingreso` o `compra`),
porque dos «tiempos activos reales» medidos desde bases distintas no son
comparables entre equipos.

Cuatro de ellos no salen de la ficha sino del **historial**: el sistema nunca
guardó «cuánto lleva este equipo con su custodio», guardó cada movimiento con
su fecha y de ahí se reconstruye. Esa es una de las razones de que el historial
sea append-only.

Detalles que cambian el número:

- El tiempo con el custodio actual cuenta **desde la última entrega a esa
  persona**, no desde la primera: un equipo devuelto y reentregado al mismo
  empleado no debe sumar el tiempo en que no lo tuvo.
- Un equipo que salió del inventario (baja, perdido, robado) **deja de
  acumular** tiempo sin uso. Si siguiera contando, un equipo robado hace seis
  meses aparecería como el más ocioso del parque.
- La reparación en curso se informa aparte del acumulado
  (`en_reparacion_ahora_dias`): sumarlas escondería que el equipo sigue fuera
  de operación ahora mismo.
- `activo_real_dias` nunca es negativo: con fechas mal capturadas los
  descuentos pueden pasarse, y un número negativo en la ficha solo confunde.

Estos tiempos **solo aparecen en el detalle**, no en el listado: exigen
recorrer los movimientos de cada equipo, y hacerlo para veinte filas por página
multiplicaría las consultas (ver `docs/rendimiento.md`). La ficha precarga
historial y bitácora para calcularlos sin consultas extra.

### Los nueve estados y la frontera del parque

Los estados del §12 son `disponible`, `en_uso` (asignado), `en_bodega`,
`en_mantenimiento` (en reparación), `en_garantia` (en reclamación al
proveedor), `en_transito`, `dado_de_baja`, `perdido` y `robado`.

Los tres últimos son **estados de salida**: el equipo ya no forma parte del
parque. Consecuencias, todas verificadas en `AC-EST-*`:

- No se le asigna custodio ni se le registran mantenimientos.
- No cuenta en los indicadores del panel, ni genera alertas, ni aparece entre
  las sugerencias de renovación.
- Al salir pierde su custodio y se registran la fecha y el motivo. El
  historial conserva quién lo tenía.
- Perdido y robado admiten reingreso (el equipo apareció); la baja no: su
  expediente queda como respaldo de la desincorporación.

El criterio vive en un único sitio (`ESTADOS_FUERA_DE_INVENTARIO` y
`Activo.objects.operativos()`), no repetido en cada módulo: antes era una
comparación contra «dado de baja» duplicada en nueve archivos, y al aparecer
dos estados de salida más eso serían nueve sitios donde olvidar uno de los
tres. `operativos=true|false` expone esa frontera como filtro.

`disponible` y `en_bodega` se distinguen a propósito: los dos están
almacenados, pero solo el primero se puede entregar hoy. Una devolución deja
el equipo en bodega —hay que revisarlo antes de volver a prometerlo—, y
`almacenados=true` agrupa ambos para quien busca qué hay guardado.

## Organización

Base: `/api/v1/organizacion/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET/POST/PATCH | `/organizacion/departamentos/` | `organizacion.ver` / `organizacion.editar` | Áreas. Filtros: `q`, `activo` |
| GET/POST/PATCH | `/organizacion/sedes/` | `organizacion.ver` / `organizacion.editar` | Edificios, locales o ciudades. Filtros: `q`, `activa` |
| GET/POST/PATCH | `/organizacion/empleados/` | `organizacion.ver` / `organizacion.editar` | Custodios. Filtros: `q`, `departamento`, `activo` |

El **código del empleado** se genera con el código de su área delante y el
número que ocupa dentro de ella: `TI-0001`, `CONT-0002`. Antes era un
correlativo global —`EMP-0007`— que no decía nada de la persona; el código
aparece en actas de entrega y en la plantilla de carga, donde ubicar de un
vistazo a quien responde por un equipo es justamente lo que se necesita. Se
puede escribir uno propio: solo se genera si el campo llega vacío.

Los duplicados de **nombre y código** —de áreas y de tipos de dispositivo— se
rechazan sin distinguir mayúsculas y diciendo con cuál se choca: la restricción
única de la base sí distingue, así que «Laptop» y «LAPTOP» pasarían las dos y
quedarían dos entradas indistinguibles en el desplegable.

Desactivar un empleado que aún custodia activos devuelve `400`
(`empleado_con_activos`); cerrar una sede que todavía tiene equipos dentro
devuelve `400` (`sede_con_activos`) — quedarían en un sitio que el formulario
ya no ofrece.

La **sede** es un catálogo y no un texto dentro de cada activo: «Sede Quito
Norte», «sede quito norte» y «Quito Norte» son el mismo edificio para una
persona y tres para una consulta, y con texto libre el filtro por sede del §14
devolvía un tercio de los equipos que están ahí sin que nadie notara lo que
faltaba. El nombre se rechaza duplicado sin distinguir mayúsculas.

Dónde está un equipo se responde con la **ciudad** de su sede —«está en
Quito»—, que es lo que el activo expone en `ciudad`: el nombre interno de la
sede no le dice nada a quien tiene que ir a buscarlo. Una sede sin ciudad
rellenada responde con su nombre, porque un hueco se lee como «no se sabe dónde
está» cuando sí se sabe.

La sede se separa del departamento porque el área dice de quién es el
presupuesto del equipo y la sede dónde ir a buscarlo.

Hubo un segundo nivel —la bodega u oficina dentro de la sede— que se retiró:
obligaba a elegir dos veces en cada traslado y a inventar una bodega para cada
sitio donde hubiera un equipo. El modelo `Ubicacion` sobrevive sin API ni
pantalla porque los movimientos anteriores al cambio se registraron entre
bodegas.

El reporte de validación separa lo que **bloquea** de lo que solo hay que
mirar. La serie repetida es un error: identifica al equipo físico, y dos
activos con la misma hacen que escanearla devuelva el equivocado. El nombre
repetido es una advertencia: no identifica —dos equipos pueden llamarse
«Laptop Ventas» sin que nada esté mal— pero delata la fila pegada dos veces,
que es el accidente habitual al armar la plantilla. Mezclarlos obligaría a
elegir entre frenar cargas legítimas o callar algo que conviene revisar.

Las advertencias solo se emiten para filas que van a entrar: las de una fila
que además falla sobran, porque lo que hay que mirar es por qué no entra.

## Mantenimientos (RF-04, RF-05)

Base: `/api/v1/mantenimientos/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/mantenimientos/` | `mantenimientos.ver` | Filtros: `activo`, `codigo_barras`, `tipo`, `q`, `desde`, `hasta` |
| POST | `/mantenimientos/` | `mantenimientos.registrar` | Registra la intervención con su lista `componentes` |
| PATCH | `/mantenimientos/{id}/` | `mantenimientos.editar` | Corrige. Enviar `componentes` reemplaza el desglose completo |
| DELETE | `/mantenimientos/{id}/` | `mantenimientos.editar` | Elimina una captura errónea y recalcula los contadores |
| GET/POST/PATCH | `/mantenimientos/componentes/` | `mantenimientos.ver` / `mantenimientos.componentes` | Catálogo de repuestos. `es_critico` alimenta el umbral de RF-06 |

Registrar o corregir una intervención recalcula, en la misma transacción, el
contador de RF-05 y la sugerencia de RF-07 del activo.

`fecha_intervencion` es el ingreso a reparación y `fecha_salida` la devolución;
mientras `fecha_salida` sea `null` el equipo sigue fuera de operación y
`dias_fuera_de_operacion` también es `null` (un `0` se sumaría como si la
reparación no hubiera costado tiempo). La bitácora acepta además `causa`,
`solucion`, `estado_final` y `garantia_usada`.

## Políticas de renovación (RF-06, RF-07)

Base: `/api/v1/politicas/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET/POST/PATCH/DELETE | `/politicas/` | `politicas.ver` / `politicas.editar` | Umbrales por tipo de dispositivo, o global si `tipo_dispositivo` va vacío |
| GET | `/politicas/sugerencias/` | `politicas.ver` | **RF-07.** Activos que hoy exceden algún umbral, con el motivo de cada criterio. `?nivel=evaluar\|recomendado` filtra por severidad |
| POST | `/politicas/reevaluar/` | `politicas.editar` | Fuerza el recálculo de la caché de todos los activos |

Guardar una política reevalúa de inmediato los activos que rige. El criterio
de longevidad se cumple por el paso del tiempo, así que conviene programar
`manage.py recalcular_indicadores` a diario.

Los umbrales están escalonados en dos niveles (§11): `vida_util_meses` produce
un veredicto **«evaluar reemplazo»** y `vida_util_critica_meses` uno
**«reemplazo recomendado»**; el segundo debe ser mayor que el primero. El
veredicto del activo (`nivel_renovacion`, también filtrable en
`/activos/?nivel_renovacion=`) es el más severo de sus motivos, y cada motivo
lleva el suyo.

`ventana_mantenimientos_meses` acota el conteo de intervenciones a los últimos
N meses («más de 3 reparaciones en 12 meses»). Vacía significa contar todo el
historial, que es el comportamiento original de RF-06: sin ventana el contador
solo sube, y un equipo que falló mucho hace seis años queda marcado para
siempre. El conteo se resuelve con una consulta agregada por ventana
configurada, no una por activo.

## Adjuntos, evidencias y actas (§18, §6)

Base: `/api/v1/adjuntos/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/adjuntos/` | `adjuntos.ver` | Documentos de un activo. Filtros: `activo`, `mantenimiento`, `tipo` |
| POST | `/adjuntos/` | `adjuntos.subir` | Multipart con `activo`, `tipo` y `archivo` (máx. 10 MB) |
| GET | `/adjuntos/{id}/descargar/` | `adjuntos.ver` | Entrega el archivo. Queda auditado |
| DELETE | `/adjuntos/{id}/` | `adjuntos.eliminar` | Borra el registro y el fichero |
| GET | `/adjuntos/acta/?movimiento=N` | `adjuntos.ver` | Acta de entrega o devolución en PDF, sin archivarla |
| POST | `/adjuntos/acta/` | `adjuntos.subir` | Genera el acta y la archiva como adjunto del activo |

Los archivos **no se sirven como estáticos**: no hay `MEDIA_URL`. La descarga
pasa siempre por la vista, que exige permiso, fuerza `attachment` y añade
`X-Content-Type-Options: nosniff` — aquí se guardan facturas, actas firmadas y
fotos de los equipos.

Se validan tres cosas antes de guardar: tamaño, extensión (lista cerrada) y
firma del contenido, de modo que un ejecutable renombrado a `.pdf` no entra. El
archivo se almacena con un nombre generado; el original se conserva solo como
metadato para devolverlo en la descarga.

El acta se construye a partir de un `MovimientoActivo` concreto y no del estado
actual del activo: documenta un hecho con fecha, y rehacerla desde la ficha
produciría un documento con el custodio equivocado.

## Centro de alertas (§19)

Base: `/api/v1/alertas/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/alertas/` | `alertas.ver` | Las siete alertas del §19 con su total, severidad y una muestra de equipos |
| GET/PATCH | `/alertas/configuracion/` | `alertas.ver` / `alertas.configurar` | Umbrales en días, qué alertas están encendidas y el envío por correo |
| GET | `/alertas/destinatarios/` | `alertas.configurar` | Usuarios que pueden recibir el resumen, con el correo enmascarado |
| GET | `/alertas/envios/` | `alertas.ver` | Últimos 15 intentos de envío, incluidos los omitidos y los fallidos |
| POST | `/alertas/envios/prueba/` | `alertas.configurar` | Envía el resumen de hoy al correo de quien lo solicita |

Las alertas se calculan en cada consulta; no hay tabla de «alertas
generadas». Guardarlas obligaría a un proceso que también las retirara cuando
la situación se resuelve, y la alerta que nadie retira envejece hasta que el
usuario deja de mirar la pantalla entera.

Cada alerta trae `total` y una `muestra` de hasta cinco equipos, más un
`destino`: la ruta del listado ya filtrado donde se trabaja con todos. Las que
están en cero también se devuelven —«revisado, nada pendiente» es
información—; las apagadas no aparecen. Los filtros que hacen accionables esos
enlaces son `activos/?custodio_inactivo=true`,
`activos/?sin_actualizar_dias=N` y `mantenimientos/?pendientes=true`.

### Aviso por correo

El resumen se envía con `manage.py enviar_alertas`, pensado para correr **todos
los días** por cron: que el envío sea diario o semanal lo decide
`/alertas/configuracion/` y no la línea del crontab, porque quien configura las
alertas no tiene acceso al servidor. Repetir la pasada el mismo día no produce
un segundo correo. `--forzar` ignora el apagado, la frecuencia y el envío ya
hecho, para verificar la configuración SMTP.

Tres decisiones del envío que conviene conocer antes de integrarlo:

- **El correo lleva recuentos y enlaces, nunca equipos ni nombres de
  personas.** Un correo sale del perímetro del sistema hacia buzones que se
  reenvían y se archivan, donde no rigen los permisos que protegen la
  pantalla; el detalle queda detrás del login.
- **Solo pueden ser destinatarios los usuarios con `alertas.ver`**, activos y
  con correo registrado. El filtro se aplica al enviar, no al elegir: a quien
  se le revocó el permiso o se le deshabilitó la cuenta deja de recibir sin
  que nadie edite la lista. Las direcciones van en copia oculta.
- **`POST /alertas/envios/prueba/` escribe solo a quien lo pide**, aunque haya
  destinatarios configurados, y tiene su propio límite de frecuencia
  (`ALERTAS_PRUEBA_THROTTLE_RATE`, 10/hora por defecto): un endpoint que
  dispara correos es un remitente disponible para quien consiga una sesión.
  Responde `502` si el servidor de correo rechaza el envío — un `200` con el
  correo caído haría creer que el canal funciona.

Cada pasada deja una fila en `/alertas/envios/` con su resultado
(`enviado`/`omitido`/`fallido`) y el motivo. Un día sin ninguna fila es un cron
que no corrió, y eso hay que poder distinguirlo de un día tranquilo.

## Reportes (§16)

Base: `/api/v1/reportes/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/reportes/` | `reportes.ver` | Catálogo: los trece reportes, con sus parámetros y columnas |
| GET | `/reportes/{clave}/` | `reportes.ver` | Vista previa en JSON (primeras 50 filas) |
| GET | `/reportes/{clave}/?formato=xlsx\|csv\|pdf` | `reportes.exportar` | Descarga el archivo |

Los trece reportes se definen como **datos** en `apps/reportes/catalogo.py`:
cada uno declara qué mira, con qué columnas, qué parámetros acepta y qué se
totaliza. Un solo motor los ejecuta y tres renderizadores los escriben. Nueve
de los trece son el mismo listado de activos con otro filtro y otro orden;
escribirlos por separado daría treinta y nueve piezas que envejecen sueltas —el
día que se agrega un campo a la ficha, doce reportes lo muestran y uno no—.
**Agregar un reporte es agregar una entrada a ese archivo**, sin tocar vistas
ni frontend: la pantalla se dibuja desde el catálogo.

Detalles que conviene conocer:

- **El permiso depende del formato, no del método.** Los dos endpoints son
  `GET`, pero ver un reporte en pantalla y llevárselo en un archivo no son la
  misma acción: el archivo sale del sistema y circula por correo sin los
  permisos que lo protegen. Por eso `reportes.exportar` es un permiso aparte.
- **Cada archivo lleva su contexto**: nombre del reporte, fecha de emisión,
  total de filas y filtros aplicados. Un archivo que circula sin eso se
  interpreta como si fuera el parque completo.
- **Topes**: 10.000 filas por reporte (la dimensión que da el documento) y
  1.000 en PDF. Cuando se corta, el archivo lo dice — un reporte truncado en
  silencio se lee como si el parque fuera menor.
- **El PDF lleva un subconjunto de columnas** (`columnas_pdf`): es el formato
  para imprimir y revisar; el análisis se hace en el `.xlsx`.
- **El CSV va con BOM UTF-8 y separador coma.** La coma es el estándar y es lo
  que espera cualquier herramienta que consuma el archivo; el BOM está para
  que Excel no destroce los acentos si se abre ahí de todos modos.
- Los reportes de activos miran el **parque operativo**, salvo el inventario
  general —que es el censo completo— y el de bajas, que existe para lo que
  salió.

## Auditoría (`admin/audit-logs/`)

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `admin/audit-logs/` | `auditoria.ver` |
| GET | `admin/audit-logs/{id}/` | `auditoria.ver` (+ `auditoria.ver_detalle`/`ver_ubicacion` para esos campos) |
| GET | `admin/audit-logs/export/` | `auditoria.exportar` |

Solo lectura: no existe endpoint de escritura (el registro se crea
internamente vía `apps.core.audit.record_audit_event`).

## Identidad institucional / tema (`admin/theme/`, `theme/current/`)

| Método | Ruta | Auth | Permiso |
| --- | --- | --- | --- |
| GET | `theme/current/` | Pública | — |
| GET | `admin/theme/` | Requerida | `configuracion.ver` |
| PATCH | `admin/theme/` | Requerida | `configuracion.editar` |
| POST | `admin/theme/reset/` | Requerida | `configuracion.editar` |
| GET | `admin/theme/options/` | Requerida | `configuracion.ver` |

## Infraestructura

| Método | Ruta | Auth |
| --- | --- | --- |
| GET | `health/` | Pública |
| GET | `health/ready/` | Pública |
| GET | `version/` | Pública |
| GET | `schema/`, `schema/swagger-ui/`, `schema/redoc/` | Pública |

## Agregar un módulo nuevo (para un proyecto concreto)

1. Sumar el módulo y sus permisos a `apps/permissions/catalog.py`
   (`PERMISSION_CATALOG`).
2. Crear la app Django (modelos, servicios, serializers, vistas, urls).
3. Definir clases de permiso propias extendiendo
   `apps.permissions.permissions.HasModulePermission`.
4. Registrar las rutas en `config/api_v1_urls.py`.
5. Documentar los nuevos criterios de aceptación como escenarios Gherkin en
   `tests/qa/features/` y sumarlos a la matriz de trazabilidad — nunca
   dejarlos solo en el README o en comentarios de código.
