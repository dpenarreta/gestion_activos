# Referencia de API

Base: `/api/v1/`. Documentación interactiva (drf-spectacular): `/api/v1/schema/swagger-ui/`.

Todas las respuestas de error siguen el contrato:

```json
{ "error": { "code": "string", "message": "string", "details": {} } }
```

## Autenticación

| Método | Ruta | Auth | Permiso |
| --- | --- | --- | --- |
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

El listado incluye `last_login`: la última vez que esa cuenta **inició
sesión**, no la última vez que se la usó. Renovar el token no lo mueve, porque
reutiliza la sesión ya abierta. Es `null` en la cuenta que nunca entró, que no
es lo mismo que una recién creada sin usar todavía: para eso está
`created_at`.

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
| GET | `/activos/` | `activos.ver` | Listado paginado. Filtros: `q`, `categoria`, `tipo`, `departamento`, `estado`, `sede` (id), `sede_nombre`, `criticidad`, `uso`, `condicion`, `propiedad` (`propia\|concesion`), `concesionario` (id), `responsable` (id, alias `custodio`), `compartido`, `antiguedad_min_meses`, `antiguedad_max_meses`, `operativos`, `almacenados`, `requiere_renovacion`, `garantia` (`vigente\|por_vencer\|vencida\|sin_registrar`) |
| POST | `/activos/` | `activos.crear` | Alta. El `codigo_barras` lo genera el sistema (RF-02). `solicitado_por` (opcional) avisa por correo a quien pidió el equipo; sin él no se avisa a nadie, y la respuesta no trae bloque `aviso`. Acepta cualquier empleado, incluso uno marcado como inactivo: esa marca no la mantiene ninguna integración |
| GET | `/activos/{id}/` | `activos.ver` | Ficha completa, con el veredicto de renovación calculado en vivo |
| PATCH | `/activos/{id}/` | `activos.editar` | Edita la ficha técnica. No admite `custodio`/`departamento`/`estado` |
| GET | `/activos/por-codigo/{codigo}/` | `activos.ver` | **RF-03.** Resuelve por código de barras *o* número de serie; devuelve ficha, movimientos, mantenimientos y costos |
| GET | `/activos/{id}/historial/` | `activos.ver` | Igual que el anterior, por id |
| GET | `/activos/?q=&operativos=true` | `activos.ver` | La misma búsqueda que usa el inventario alimenta el campo de equipo del formulario de mantenimiento: se pregunta al servidor en vez de desplegar el parque |
| — | — | — | La ficha incluye `depreciacion`: valor en libros, acumulada y porcentaje. Cuando no hay costo o política, `disponible: false` y el `motivo` — un cero significaría «ya no vale nada» |
| GET | `/activos/mis-equipos/` | `activos.ver_asignados` | **§13.** Los equipos que quien pregunta tiene a su cargo. Sin costo, proveedor ni veredicto de renovación: son datos del inventario, no del equipo que uno usa |
| POST | `/activos/{id}/asignar/` | `activos.asignar` | Asigna, traslada o devuelve. `responsables` es la lista completa que queda: vacía deja el equipo sin nadie; omitir `sede` no toca el sitio y `null` lo borra. La entrega la manda también —entregar un equipo suele ser ponerlo donde trabaja quien lo recibe—, y con ella el `departamento` de esa persona. Deja **un movimiento por persona** que entra o sale, y se registra como **traslado** si el sitio cambió y como **devolución** si solo se soltó al responsable |
| POST | `/activos/{id}/cambiar-estado/` | `activos.dar_baja` | Cambia el estado. Las tres salidas (baja, perdido, robado) exigen `motivo`; desde una baja no se vuelve |
| GET | `/activos/{id}/etiqueta/` | `activos.imprimir_etiqueta` | **RF-08.** `?formato=pdf` (por defecto, devuelve el documento) o `zpl\|tspl` (trabajo térmico). `?simbologia=code128\|qr` elige el símbolo —por defecto el lineal, que es lo que lee una pistola láser—. `?descargar=false` entrega el PDF inline para previsualizar |
| GET | `/activos/{id}/etiqueta/medicion/` | `activos.imprimir_etiqueta` | Geometría del símbolo impreso: módulo, zona muda y altura. **Solo del Code 128**: esas medidas describen un símbolo lineal |
| POST | `/activos/etiquetas/` | `activos.imprimir_etiqueta` | Lote de etiquetas en un solo trabajo (`{"ids": [...]}`, máx. 200). Acepta `?formato` y `?simbologia` igual que el individual |
| GET | `/activos/plantilla-importacion/` | `activos.crear` | Plantilla .xlsx de carga masiva, con los catálogos vigentes |
| POST | `/activos/importar/` | `activos.crear` | Multipart con `archivo` (.xlsx, máx. 5 MB) y `confirmar`. Sin confirmar solo valida y devuelve el reporte —`errores` (bloquean), `advertencias` (no bloquean) y `filas_con_error`, todos con fila y columna—; con `confirmar=true` importa (todo o nada) |
| GET | `/activos/columnas-plantilla/` | `activos.ver` | Columnas configuradas de la plantilla |
| POST/PATCH/DELETE | `/activos/columnas-plantilla/` | `activos.editar` | Configura qué se pide. Clave: un campo del activo o `espec:<Nombre>` para una característica propia. Las estructurales (tipo, nombre, serie, departamento, fecha) no se desactivan ni se eliminan |
| GET | `/activos/columnas-plantilla/campos-disponibles/` | `activos.ver` | Campos que una columna puede llenar, con cuáles ya están en uso |
| GET/POST/PATCH | `/activos/categorias/` | `activos.ver` / `activos.editar` | Catálogo de **categorías**: la naturaleza del bien (hardware, software, mobiliario…). `?activa=true` para el desplegable. Sin `DELETE`: los tipos la referencian con `PROTECT`, así que se desactiva |
| GET/POST/PATCH | `/activos/tipos/` | `activos.ver` / `activos.editar` | Catálogo de tipos de dispositivo. Cada uno cuelga de una categoría (`categoria`, opcional) |

El listado trae `categoria_nombre`, resuelto desde el tipo: un activo no
guarda su categoría, la hereda. Clasificar es decisión del tipo —una laptop es
hardware siempre—, así que pedirla activo por activo repetiría en cada alta un
dato ya decidido, con el riesgo de que dos laptops acaben en categorías
distintas.

El listado trae `esta_operativo`, calculado por el servidor: dice si el equipo
sigue en el parque —no está dado de baja, perdido ni robado—. Lo usa el
inventario para no ofrecer «asignar» sobre uno que el servidor va a rechazar,
sin repetir en el frontend qué estados cuentan como salida.

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

## Carga masiva de catálogos

Base: `/api/v1/catalogos/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/catalogos/` | autenticado | Qué se puede cargar y con qué permiso. La pantalla se dibuja desde aquí: un catálogo nuevo aparece sin tocar el frontend |
| GET | `/catalogos/{clave}/plantilla/` | el del catálogo | .xlsx del catálogo, **con lo que ya existe dentro** |
| POST | `/catalogos/{clave}/importar/` | el del catálogo | Multipart con `archivo` y `confirmar`, como la carga de activos: sin confirmar solo valida |

Claves: `sedes`, `departamentos`, `proveedores`, `concesionarios`, `tipos`,
`empleados`.

**Un archivo por catálogo.** La plantilla de activos llegó a traer ocho hojas
en un solo libro, cinco de ellas solo de consulta, y ninguno de esos catálogos
se podía cargar: para dar de alta cincuenta empleados había que teclearlos uno
a uno mientras el archivo ya los listaba. Ahora la de activos trae solo lo
suyo —instrucciones, captura y ejemplo— y cada catálogo tiene el suyo.

**El archivo baja lleno**, y eso hace dos trabajos con uno: sirve de referencia
al llenar la plantilla de activos y de plantilla para escribir filas nuevas
debajo. Por eso una fila que ya existe se reconoce y se **omite con una
advertencia** en vez de bloquear: bajar el archivo, añadir tres filas y volver
a subirlo entero es lo que la gente hace en cuanto descubre que se puede
reutilizar. Repetida **dentro del mismo archivo** sí es un error: eso es un
descuido de quien lo armó.

**El permiso lo pone cada catálogo**, no la operación: cargar tipos de
dispositivo es `activos.editar`, cargar empleados es `organizacion.editar`. Un
permiso único de «carga masiva» daría acceso a los dos a quien solo necesita
uno.

## Empresas

Base: `/api/v1/empresas/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/empresas/mias/` | autenticado | Las empresas que la cuenta puede ver y en cuál está trabajando |
| GET | `/empresas/` | `empresas.ver` | Listado administrativo de todas las empresas |
| POST | `/empresas/` | `empresas.editar` | Crear una empresa |
| GET/PATCH | `/empresas/{id}/` | `empresas.ver` / `empresas.editar` | Ficha de la empresa (sin `DELETE`: se desactiva) |
| POST | `/admin/users/` | `usuarios.crear` (+ `empresas.asignar` si lleva `empresas`) | No recibe `username`: se compone de `first_name` y `last_name` (ver `docs/roles-and-permissions.md`). Acepta `empresas` con la misma forma, para que la cuenta nazca usable |
| POST | `/admin/users/{id}/empresas/` | `empresas.asignar` | Reemplaza en qué empresas trabaja la cuenta y con qué rol en cada una: `{"empresas": [{"empresa_id", "roles": [id], "es_predeterminada"}]}` |

**Toda la API responde dentro de una empresa.** El cliente manda la cabecera
`X-Empresa` con el id; sin ella se usa la predeterminada de la cuenta. Pedir
una a la que no se pertenece no devuelve un error sino **nada**: es una pestaña
vieja o algo peor, y devolver otra empresa haría creer que se está viendo lo
pedido. Ver `docs/multiempresa.md`.

### Características por tipo de dispositivo

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/activos/caracteristicas/` | `activos.ver` | Lo que describe cada tipo. Filtra por `tipo` y por `activa` |
| POST/PATCH/DELETE | `/activos/caracteristicas/` | `activos.editar` | Declarar, corregir o quitar una característica |
| POST | `/activos/tipos/` | `activos.editar` | Acepta `caracteristicas`: la lista con la que el tipo nace ya descrito |

Cada característica declara de qué **clase es su valor** —`texto`,
`texto_ampliado`, `numero`, `entero`, `booleano`, `lista` (con sus `opciones`) o
`fecha`—, su `unidad`, si es `obligatoria` y en qué `orden` aparece. No es
decoración del formulario: es lo que permite que «8» y «ocho» no convivan en el
mismo campo. El `texto_ampliado` admite hasta **2000 caracteres** y conserva los
saltos de línea; lo que no cabe ahí son adjuntos, no características.

Un tipo puede **nacer ya descrito**: el `POST` de `/activos/tipos/` acepta
`caracteristicas` y crea las dos cosas en una transacción, así que un tipo nunca
queda creado y descrito a medias. Solo en el alta: describir un tipo que ya
existe se hace de a una por su propio endpoint, porque reenviar la lista entera
obligaría a decidir qué pasa con las que no vengan y cualquiera de las dos
respuestas pisa lo que otra persona acaba de añadir.

Lo que un tipo declara es lo que se pide al registrar un equipo de ese tipo, y
el valor se guarda en `Activo.especificaciones` con el nombre declarado como
clave. **Mientras el tipo no declare ninguna, el activo sigue admitiendo pares
libres**; en cuanto declara una, lo que no esté declarado se rechaza — salvo lo
que el equipo ya tuviera guardado, que se conserva.

## Solicitudes de compra

Base: `/api/v1/solicitudes/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/solicitudes/` | `solicitudes.ver` | Filtra por `ambito` (`mias` / `recibidas`), `estado`, `abiertas` y `q` |
| POST | `/solicitudes/` | `solicitudes.crear` | Registra la petición. El solicitante **no viaja**: es quien está autenticado |
| PATCH | `/solicitudes/{id}/` | `solicitudes.crear` | Corrige lo pedido. Solo el solicitante y solo mientras esté «pendiente» |
| POST | `/solicitudes/{id}/cambiar-estado/` | `solicitudes.ver` | Un paso del recorrido: `{"estado", "nota"}`. Quién puede cada paso lo decide el servicio |
| GET | `/solicitudes/catalogo/` | `solicitudes.ver` | Tipos de dispositivo —**con las características que declara cada uno**— y componentes, para el desplegable de «qué necesita» |
| GET | `/solicitudes/encargados/` | `solicitudes.ver` | A quién se le puede asignar: solo quien puede gestionar compras en esta empresa |

**Sin `DELETE`**: una solicitud que ya no hace falta se cancela, y queda escrito
que se pidió y que se retiró. Borrarla haría desaparecer de los conteos lo que
un área llegó a necesitar.

El recorrido es **Pendiente → En gestión → Comprada → Entregada**, con
**Rechazada** y **Cancelada** como salidas. Lo que no está en esa tabla no pasa:
una entregada no vuelve a pendiente, y desde pendiente no se llega a comprada
sin haberla tomado. Cada paso deja un movimiento append-only con quién lo dio y
su nota; el rechazo **exige** nota, porque es lo único que le llega a quien pidió
como explicación.

Quién puede qué: **pedir** (`solicitudes.crear`) y **gestionar**
(`solicitudes.gestionar`) son oficios distintos, y gestionar habilita a mover
**las asignadas a uno**, no las ajenas. `solicitudes.administrar` ve y mueve las
de todos. Cancelar lo propio no exige ninguno de los dos: quien pidió algo que
ya no hace falta debe poder retirarlo.

`/solicitudes/catalogo/` existe porque quien solo pide no tiene —ni debería
tener— permiso para ver el parque: por los endpoints del inventario el
desplegable le llegaría vacío por un 403 que nadie ve. Trae las características
de cada tipo en la misma respuesta, porque se necesitan justo al cambiar el
desplegable y una consulta por cada cambio dejaría el formulario parpadeando.

El formulario de «Realizar solicitud» **solo pide del catálogo**: el campo de
texto libre (`detalle`) sigue en la API y en lo ya registrado, pero la pantalla
no lo ofrece, porque es lo que traía «laptop», «Laptop» y «portátil» para lo
mismo y no traía las características con las que se describe el pedido.

La solicitud lleva **`especificaciones`** con la misma forma que la ficha del
activo —pares nombre/valor bajo el nombre declarado—, así que lo pedido y lo
entregado se leen con el mismo vocabulario. Se comprueban contra las
características del tipo con **las mismas exigencias que la ficha**: que existan,
que el valor sea del dato declarado y que estén las marcadas obligatorias. Lo que
no deba exigirse al pedir se desmarca en la característica, y entonces no se
exige en ninguno de los dos sitios. Una solicitud escrita a mano, sin tipo del
catálogo, no lleva características: no hay contra qué comprobarlas.

## Organización

Base: `/api/v1/organizacion/`

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET/POST/PATCH | `/organizacion/departamentos/` | `organizacion.ver` / `organizacion.editar` | Áreas. Filtros: `q`, `activo` |
| GET/POST/PATCH | `/organizacion/sedes/` | `organizacion.ver` / `organizacion.editar` | Edificios, locales o ciudades. Filtros: `q`, `activa` |
| GET/POST/PATCH | `/organizacion/empleados/` | `organizacion.ver` / `organizacion.editar` | Custodios. Filtros: `q`, `departamento`, `activo` |
| GET/POST/PATCH | `/organizacion/proveedores/` | `organizacion.ver` / `organizacion.editar` | A quién se le compra. Filtros: `q`, `activo` |
| GET/POST/PATCH | `/organizacion/concesionarios/` | `organizacion.ver` / `organizacion.editar` | De quién son los equipos que no compramos. Filtros: `q`, `activo` |

El **proveedor** es un catálogo y no un texto dentro de cada activo, por lo
mismo que la sede: «Tecnomega», «TECNOMEGA» y «Tecno Mega» son la misma empresa
para una persona y tres para una consulta. Lo apuntan el activo —a quién se le
compró— y cada línea de repuesto de un mantenimiento: el proveedor del equipo
no tiene por qué ser el de la pieza, y sin ese dato una pieza que falla a los
dos meses deja el costo registrado y ninguna forma de saber a quién reclamarle.
Darlo de baja con equipos en uso devuelve `400` (`proveedor_con_activos`).

De un equipo puede responder **más de una persona**. `responsables` es la lista
completa de quienes responden, sin jerarquía: no hay un titular con
acompañantes. Varios solo caben en un activo marcado como `compartido`; con la
marca quitada, el segundo se rechaza con `400`, y no se le puede quitar la
marca a uno que ya tiene varios. `POST /activos/{id}/asignar/` recibe la lista
**completa** que queda después de la operación —vacía es una devolución a
bodega—, y deja **un movimiento por cada persona** que entra o sale, porque de
cada movimiento sale el acta que esa persona firma. El listado expone además
`responsables_resumen`, los nombres ya unidos para escribirlos en una celda.

El **concesionario** es un catálogo aparte, y la diferencia con el proveedor no
es de matiz: al proveedor se le compró el equipo, y entonces el equipo es de la
empresa; el concesionario es su dueño —lo pone para operar con nosotros, la
compra corre por su cuenta y el mantenimiento por la nuestra—. Son dos
preguntas distintas («a quién le compramos» y «de quién es esto») y un equipo
en concesión puede llevar las dos respuestas. El activo lo apunta en
`propiedad` (`propia` por defecto) y `concesionario`: marcarlo en concesión sin
dueño devuelve `400`, y volverlo propio limpia el dueño. Un equipo en concesión
**no deprecia**: contarlo abultaría el valor del parque con algo que es de
otro, aunque sus reparaciones sí son gasto propio y se siguen contando. Dar de
baja al partner con equipos suyos en uso devuelve `400`
(`concesionario_con_activos`).

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

Registrar una intervención abierta avisa por correo a **quien responde por el
equipo**; ponerle fecha de salida avisa de que volvió. No tienen frecuencia: o
salen al ocurrir el hecho o ya no sirven. El correo del empleado es opcional, y
quien no lo tiene no recibe nada: la respuesta de `POST` y `PATCH` trae un
bloque `aviso` con `enviados`, `sin_correo` (los nombres de quienes se quedaron
fuera) y `a_quien_registro` (si hubo que recurrir a quien hizo la acción por no
haber podido avisar a nadie). El envío ocurre al confirmarse la transacción y
un fallo no impide registrar la reparación.


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
| GET/POST/PATCH/DELETE | `/politicas/depreciacion/` | `politicas.ver` / `politicas.editar` | **§22.3.** Vida contable y valor residual por tipo, o global si `tipo_dispositivo` va vacío. Sin reevaluación: la depreciación se calcula al leer |

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
| GET/PATCH | `/alertas/configuracion/` | `alertas.ver` / `notificaciones.configurar` | Umbrales en días, qué alertas están encendidas y el envío por correo |
| GET | `/alertas/destinatarios/` | `notificaciones.configurar` | Usuarios que pueden recibir el resumen, con el correo enmascarado |
| GET | `/alertas/envios/` | `alertas.ver` | Últimos 15 intentos de envío, incluidos los omitidos y los fallidos |
| POST | `/alertas/envios/prueba/` | `notificaciones.configurar` | Envía el resumen de hoy al correo de quien lo solicita |

Las alertas se calculan en cada consulta; no hay tabla de «alertas
generadas». Guardarlas obligaría a un proceso que también las retirara cuando
la situación se resuelve, y la alerta que nadie retira envejece hasta que el
usuario deja de mirar la pantalla entera.

Cada alerta trae `total` y una `muestra` de hasta cinco equipos, más un
`destino`: la ruta del listado ya filtrado donde se trabaja con todos. Las que
están en cero también se devuelven —«revisado, nada pendiente» es
información—; las apagadas no aparecen. Los filtros que hacen accionables esos
enlaces son `activos/?sin_actualizar_dias=N` y
`mantenimientos/?pendientes=true`.

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
| GET | `/reportes/` | `reportes.ver` | Catálogo: los trece del §16 más el de valor en libros (§22.3), con sus parámetros y columnas |
| GET | `/reportes/{clave}/` | `reportes.ver` | Vista previa en JSON (primeras 50 filas) |
| GET | `/reportes/{clave}/?formato=xlsx\|csv\|pdf` | `reportes.exportar` | Descarga el archivo |

Los reportes se definen como **datos** en `apps/reportes/catalogo.py`:
cada uno declara qué mira, con qué columnas, qué parámetros acepta y qué se
totaliza. Un solo motor los ejecuta y tres renderizadores los escriben. Nueve
de los trece son el mismo listado de activos con otro filtro y otro orden;
escribirlos por separado daría treinta y nueve piezas que envejecen sueltas —el
día que se agrega un campo a la ficha, doce reportes lo muestran y uno no—.
**Agregar un reporte es agregar una entrada a ese archivo**, sin tocar vistas
ni frontend: la pantalla se dibuja desde el catálogo. Lo que no se puede
resolver fila a fila —la depreciación necesita la política de cada tipo— se
precalcula en el gancho `preparar`, que corre una vez por página en vez de dos
consultas por renglón.

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

Filtros del listado y de la exportación —los mismos, para que el archivo traiga
lo que se está viendo—: `actor` (id), `actor_username` (parcial, sin distinguir
mayúsculas), `action` (parcial), `module`, `target_type`, `target_id`,
`result` y el rango `created_from` / `created_to`.

`actor_username` existe porque quien revisa un incidente sabe a quién busca y
no su número de cuenta, y averiguarlo le exigiría el permiso de ver usuarios,
que un auditor no tiene por qué tener.

La pantalla que consume esto es *Usuarios y roles → Auditoría*.

## Respaldos (`configuracion/respaldos/`)

Una sola política para todo el despliegue: se lee y se corrige, sin listado.
Leer exige `configuracion.ver`; cambiarla o pedir un respaldo,
`configuracion.respaldos`.

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `GET` | `configuracion/respaldos/` | La política, más `proximo` (ISO con desfase, hora local), `ultimo_en_disco`, `tarea_cada_minutos` y `zona_horaria` |
| `PATCH` | `configuracion/respaldos/` | Corrige `activo`, `dias` (0 = lunes … 6), `horas` (`HH:MM`, de 1 a 8), `destino`, `conservar`. Auditado como `respaldo.politica_changed` |
| `POST` | `configuracion/respaldos/ahora/` | Deja la orden de respaldar ya (`202`). La cumple la tarea en su siguiente pasada; pedirlo otra vez antes no crea una segunda orden. Auditado como `respaldo.solicitado` |
| `GET` | `configuracion/respaldos/archivos/` | Los respaldos en disco, del más reciente al más antiguo: `marca`, `fecha`, `archivos`, `bytes`, `tiene_base`, `tiene_adjuntos`, `contenido`, `es_el_mas_reciente`; más `borra_la_base` (si se ve la carpeta de los `.bak`) |
| `DELETE` | `configuracion/respaldos/archivos/<marca>/` | Borra el respaldo entero (`204`). `409` si es el más reciente; `404` si la marca no existe o no tiene la forma `AAAAMMDD-HHMM`. Auditado como `respaldo.borrado` |

Solo lectura: `ultimo_programado` (último turno cubierto), `solicitado_en`,
`ultima_ejecucion` y `ultimo_error` (vacío si la última ejecución terminó bien).

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
