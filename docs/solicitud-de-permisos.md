# Solicitud de permisos

Módulo Institucional → *Solicitud de permisos* (app `apps.licencias`). Cada tipo
de permiso (Vacaciones, Permiso médico…) es un **flujo** configurable: sus
restricciones, sus pasos de aprobación y a quién se avisa el resultado.

Este documento describe cada paso, cada restricción y cómo se impide
saltársela. **Toda regla se valida en el servidor.** La pantalla solo informa,
y cualquier intento hecho directamente contra la API recibe la misma
respuesta. Cada control indica la prueba que lo protege, en
`backend/apps/licencias/tests/`.

Actualizado el 05/11/2026.

## Archivos

| Qué | Dónde |
| --- | --- |
| Modelos (flujo, pasos, aprobadores, avisos, solicitud, historial) | `apps/licencias/models.py` |
| Recorrido del flujo: asignar, aprobar, rechazar, escalar, cancelar | `apps/licencias/services.py` |
| Restricciones, reparto entre períodos y fines de semana | `apps/licencias/restricciones.py` |
| API | `apps/licencias/views.py`, `urls.py` |
| Pantallas | `frontend/src/pages/Institucional/SolicitudPermisosPage.jsx`, `FlujosPermisoPage.jsx`, `CalendarioDeRango.jsx` |
| Pruebas | `test_licencias.py`, `test_restricciones.py`, `test_flanqueos.py` |

## Permisos

| Permiso | Qué habilita |
| --- | --- |
| *(cualquier cuenta de la empresa **con un rol asignado**)* | Solicitar, ver lo propio, aprobar o rechazar lo que tiene pendiente, escalarlo y cancelar lo suyo pendiente. |
| `licencias.ver_todas` | Ver todas las solicitudes de la empresa y escalar cualquiera **a otra persona**. No le permite aprobar una solicitud que no tenga pendiente ni, desde el 05/11/2026, anular una aprobada. |
| `licencias.anular_aprobadas` | Anular una solicitud **ya aprobada**, con comentario: quita sus ausencias de Gestión Humana y devuelve los días de vacaciones (05/11/2026). No amplía lo que se ve: solo alcanza las solicitudes que ya ve (por `ver_todas`, porque la pidió, la tiene pendiente o actuó en ella). `permissions/0049` se lo dio a los roles y cuentas que tenían `licencias.ver_todas` y al Superusuario; va con los cargos de Gestión Humana (`organizacion/permisos_por_cargo.py`), y el Administrador y el Superusuario lo tienen por `crear_roles_iniciales`. |
| `licencias.configurar` | Crear y editar flujos y sus restricciones. Recibe las solicitudes cuyo paso no encuentra aprobador. |

## Paso 1: configurar el tipo de permiso

En *Configurar flujos*, solo con `licencias.configurar` (prueba `test_las_restricciones_solo_las_configura_quien_administra`), se definen:

- **Datos:** nombre (único en la empresa), descripción, si está activo, si pide documento de respaldo (no se pide, opcional u obligatorio) y si pide motivo. **Un tipo médico (`tipo_ausencia = MEDICO`) pide siempre motivo y documento obligatorio** (ver «Permisos médicos» más abajo).
- **Restricciones:**
  - mínimo y máximo de días seguidos (0 = sin restricción);
  - si se descuenta de las vacaciones;
  - sábados y domingos por período, que solo aplican si se descuenta de las vacaciones;
  - otras indicaciones en texto libre, una por línea, que solo se informan.
- **Pasos de aprobación, en orden.** Cada paso tiene uno o varios aprobadores (jefe inmediato según el organigrama, una persona, las personas de un rol o quien ocupe un cargo); con varios, aprueba **cualquiera** de ellos.
- **Avisos del resultado:** a quién se avisa si se aprueba y a quién si se rechaza. Se avisa a **todos** los de la lista.

Un flujo con solicitudes no se borra: se desactiva (409). Un flujo inactivo no se solicita ni se evalúa (`test_un_tipo_inactivo_no_se_solicita_ni_se_evalua`).

**Configuración actual de Vacaciones:**
- mínimo 5 días seguidos;
- se descuenta de las vacaciones;
- 2 sábados y 2 domingos por período;
- no pide motivo;
- pasos: jefe inmediato y luego Talento Humano.

## Paso 2: solicitar

Quien solicita elige el tipo y las fechas, en el calendario o en los campos Desde y Hasta, que siempre muestran lo mismo. Debajo de las fechas ve todas las restricciones del tipo, cada una con su estado:

| Estado | Significado |
| --- | --- |
| ✔ verde | Cumple. |
| ✖ rojo | No cumple: **no deja enviar** (botón desactivado, y el servidor responde 400 si se intenta igual). |
| ⚠ ámbar | Atención: se puede enviar, pero tiene consecuencias (por ejemplo, fines de semana que se marcarán). |
| ℹ azul | Indicación que solo se informa. |

La evaluación la hace el servidor (`GET /api/v1/licencias/tipos/<id>/evaluar/?desde=&hasta=`) y es la misma función que se ejecuta al crear la solicitud.

### Restricciones que bloquean

| Regla | Qué comprueba | Prueba |
| --- | --- | --- |
| Rol asignado | La cuenta tiene al menos un rol, global o en su membresía de la empresa (incluido el rol de su nivel jerárquico, que se asigna solo por su cargo). Sin rol no se solicita **ningún** tipo de permiso: el botón «Nueva solicitud» se desactiva con la explicación, y el servidor responde 400. El superusuario no necesita rol. | `test_sin_rol_asignado_no_se_solicita_ningun_tipo` |
| Fechas en orden | «Hasta» no es anterior a «Desde». | `test_el_documento_obligatorio_y_las_fechas_se_validan` |
| Mínimo de días seguidos | Días corridos de Desde a Hasta ≥ mínimo. | `test_el_minimo_de_dias_se_informa_y_no_deja_enviar_menos` |
| Máximo de días seguidos | Días corridos ≤ máximo. | (misma lógica que el mínimo) |
| Sin cruces | Las fechas no se cruzan con **otra solicitud suya pendiente o aprobada, de cualquier tipo**. Cancelada o rechazada, las fechas quedan libres. | `test_no_se_piden_fechas_que_se_cruzan_con_otra_solicitud` |
| Días no gozados (vacaciones) | Ninguno de los días consta ya como vacaciones gozadas. | `test_no_se_piden_dias_que_ya_constan_como_gozados` |
| Días que alcanzan (vacaciones) | Los días caben en sus períodos con saldo, contando lo que ya reservan sus solicitudes pendientes y los días que la regla de fines de semana guarda en cada período. | `test_no_se_piden_mas_dias_de_los_que_alcanzan`, `test_sin_periodos_de_vacaciones_no_hay_dias_que_pedir` |
| Documento obligatorio | Si el tipo lo exige, se adjunta un PDF o una imagen de hasta 10 MB, con extensión y firma del contenido verificadas. | `test_el_documento_obligatorio_y_las_fechas_se_validan` |

### Cómo se descuentan las vacaciones

- Los días salen **del período más antiguo con saldo al más nuevo**, y quien solicita ve cuántos salen de cada uno. No puede elegir el período.
- Las solicitudes **pendientes reservan** sus días en el orden en que se pidieron. Una segunda solicitud no puede contar los mismos días.
- La creación **bloquea a la persona** (`select_for_update` sobre su usuario). Dos envíos simultáneos se procesan uno tras otro y el segundo ya ve lo que reservó el primero.

### Regla de fines de semana (vacaciones)

De los días de **cada período anual** (15 días) deben salir al menos **2 sábados y 2 domingos**.

- Quien solicita ve, por cada período que toca su solicitud, cuántos lleva, por ejemplo «1 de 2 sábados y 0 de 2 domingos».
- Un período **no se completa solo con días de semana**. Mientras le falten fines de semana, sus últimos días quedan reservados para ellos. Los días de semana que ya no caben pasan al período siguiente; si no hay período siguiente, la solicitud no alcanza.
- Cuando una solicitud deja a un período con **justo los días que faltan para sus fines de semana**, esos días se **marcan por defecto** en los sábados y domingos libres que siguen a la solicitud. No caen sobre días de otra solicitud suya.
- Antes de enviar, quien solicita ve las fechas exactas que se marcarán (estado ⚠). Al aprobarse, se registran como gozadas con la descripción «Marcado por defecto» y se le avisa en la campana.

Pruebas: `test_un_periodo_no_se_completa_sin_fines_de_semana`, `test_los_fines_de_semana_por_defecto_no_caen_sobre_otra_solicitud`.

### Lo que no puede fijar quien solicita

- De quién queda pendiente, el estado o el paso: el servidor ignora esos campos (`test_una_solicitud_no_se_edita_ni_se_borra`).
- El motivo, en un tipo que no lo pide: se descarta (`test_un_tipo_sin_motivo_no_lo_guarda`).
- Una solicitud creada **no se edita ni se borra**: PUT, PATCH y DELETE responden 405. Para cambiarla, se cancela y se pide de nuevo.

### Tipos por horas

En un tipo por horas no se evalúan el mínimo ni el máximo de días seguidos. En su lugar:

- `un_dia` (falla) si «Desde» y «Hasta» no coinciden;
- `dia`: `ok` («Permiso por horas del jueves 05/11/2026.») o `aviso` si ese día no es laborable («El sábado 07/11/2026 no es laborable (es fin de semana).» o «(es feriado)»). No bloquea, porque hay quien trabaja ese día.

Los textos de mínimo y máximo usan singular cuando corresponde: «Mínimo 1 día seguido por solicitud.»

## Paso 3: aprobación por pasos

1. Al crearse, la solicitud queda pendiente de los aprobadores del primer paso, y se les avisa en la campana.
2. Cualquiera de ellos **aprueba** y la solicitud pasa al siguiente paso, o **rechaza** con un comentario obligatorio y la solicitud termina.
3. Cada movimiento queda en el historial de la solicitud: quién, qué, cuándo y con qué comentario.

| Control | Prueba |
| --- | --- |
| Solo aprueba o rechaza quien la tiene pendiente en el paso en curso. | `test_vacaciones_aprobadas_por_jefa_y_talento_humano` |
| **Nadie aprueba lo suyo**: quien solicita nunca queda como aprobador, aunque sea jefe o administrador. | `test_nadie_aprueba_lo_suyo_y_quien_solicita_puede_cancelar` |
| **Nadie aprueba dos pasos** de la misma solicitud: quien aprobó un paso queda fuera de los siguientes. | `test_nadie_aprueba_dos_pasos_de_la_misma_solicitud` |
| Si un paso no encuentra aprobador (sin cargo en el organigrama, cargo vacante, rol vacío), pasa a quien administra los flujos, excepto quien solicita y quien ya aprobó. | `test_sin_jefe_en_el_organigrama_queda_en_manos_de_quien_administra` |
| Lo cerrado (aprobado, rechazado o cancelado) no se vuelve a aprobar ni a rechazar. | `test_no_se_aprueba_dos_veces_ni_lo_ya_cerrado` |
| Rechazar exige decir por qué. | `test_vacaciones_rechazadas_avisan_a_quien_solicito_y_a_su_jefe` |

## Paso 4: escalar

Quien tiene la solicitud pendiente, o quien tiene `licencias.ver_todas`, puede pasar el paso en curso a otra persona, rol o cargo. El paso sigue siendo el mismo; solo cambia quién lo resuelve.

No se escala:
- a **uno mismo**, para que quien ve todas no se la asigne y la apruebe saltándose a los aprobadores del flujo;
- a **quien la pidió**;
- a quien **ya aprobó** un paso.

Tampoco escala quien no la tiene pendiente ni ve todas. Pruebas: `test_se_escala_a_otra_persona_o_rol`, `test_no_se_escala_a_uno_mismo_para_saltarse_a_los_aprobadores`.

## Paso 5: cancelar

- **Pendiente:** solo quien la solicitó. Prueba: `test_nadie_aprueba_lo_suyo_y_quien_solicita_puede_cancelar`.
- **Aprobada (05/11/2026):** solo quien tiene `licencias.anular_aprobadas` (antes bastaba `licencias.ver_todas`), con un comentario obligatorio. Quien la pidió no la cancela (400, `test_no_se_aprueba_dos_veces_ni_lo_ya_cerrado`); otra persona recibe 403. En la misma transacción:
  - se borran sus ausencias de Gestión Humana (`LeaveRecord`);
  - si se descontó de las vacaciones, se borran los goces que nombran la solicitud («… (solicitud n.º N)») y esos días vuelven a quedar pendientes. Los fines de semana marcados por defecto no se quitan, porque no nombran la solicitud: si sobran, se corrigen en *Vacaciones*;
  - se avisa a quien la pidió (`licencias.cancelada`).

  Pruebas: `test_gestion_humana_cancela_una_aprobada_y_se_borran_sus_ausencias`, `test_cancelar_unas_vacaciones_aprobadas_devuelve_sus_dias`, `test_quien_no_ve_todas_no_cancela_una_aprobada_ajena`, `test_con_el_permiso_cancela_una_aprobada_aunque_no_vea_todas`, `test_solo_con_ver_todas_ya_no_cancela_una_aprobada` (403), `test_el_permiso_solo_no_revela_solicitudes_que_no_ve` (404).

`puedo.cancelar` del detalle es verdadero en los dos casos, y `puedo.cancelar_pide_comentario` dice si el comentario es obligatorio. Para la confirmación, el detalle trae lo que de verdad se descontó: `dias_a_devolver` (días de vacaciones que vuelven a quedar pendientes; 0 si no está aprobada o no descontó vacaciones) y `ausencias_a_borrar`. El nombre de la persona está en `solicitante.nombre`.

## Paso 6: aprobación final y registro

Cuando aprueba el último paso:

1. **Se vuelve a validar.** Si el tipo se descuenta de las vacaciones, se comprueba de nuevo que los días alcanzan y que no se cruzan con días gozados. Entre la solicitud y la aprobación, Talento Humano pudo cargar goces. Si algo ya no cuadra, la aprobación se rechaza con el motivo y **no queda nada a medias**: la solicitud sigue pendiente del mismo aprobador y no se registran días. Lo que corresponde entonces es rechazarla para que se pida de nuevo. Pruebas: `test_al_aprobar_se_vuelve_a_comprobar_que_los_dias_alcanzan`, `test_al_aprobar_no_se_registran_dias_que_ya_se_gozaron`.
2. **Se registran los días** como gozados en sus períodos, en tramos de días seguidos con la referencia «Vacaciones (solicitud n.º N)». Los fines de semana marcados por defecto se registran día por día. Se ven en *Mis vacaciones*.
3. **Se crean sus ausencias en Gestión Humana** (ver la sección siguiente).
4. **Se avisa** a los destinatarios configurados para «Si se aprueba».

Todo el paso corre en una transacción, con la persona bloqueada mientras se registra. La fila de la solicitud también se bloquea al aprobar, rechazar o cancelar, para que dos decisiones simultáneas no la cierren dos veces.

## Clasificación de los tipos y ausencias de Gestión Humana (05/11/2026)

Cada tipo de permiso (`FlujoPermiso`) se clasifica con tres campos, que se editan en *Configurar flujos*:

| Campo | Valores | Por defecto | Qué hace |
| --- | --- | --- | --- |
| `descuento` | `sueldo`, `vacaciones`, `ninguno` | `ninguno` | `sueldo`: ausencia con descuento de sueldo. `vacaciones`: sale de las vacaciones pendientes, con la lógica de los pasos 2 y 6. `ninguno`: permiso con goce de sueldo. |
| `unidad` | `dias`, `horas` | `dias` | Por horas, la solicitud es de un solo día y lleva `hora_desde` y `hora_hasta`. |
| `tipo_ausencia` | `MEDICO`, `PERSONAL`, `VACACIONES` | `PERSONAL` (`VACACIONES` si `descuento = vacaciones`) | El tipo de `LeaveRecord` que genera al aprobarse. |

Reglas de coherencia (400 por campo): con `descuento = vacaciones`, el tipo de ausencia es `VACACIONES` y la unidad, días. **`tipo_ausencia = VACACIONES` exige `descuento = vacaciones`** (`details.tipo_ausencia`). Un tipo por horas no pide más de un día seguido. La migración `licencias/0005` pasa a `PERSONAL` cualquier tipo que hubiera quedado en `VACACIONES` sin descuento de vacaciones: `0004` no lo produce, pero hasta el 05/11/2026 la API lo admitía al editar.

`/licencias/tipos/` (lo que ve quien solicita) trae `descuento`, `unidad`, `tipo_ausencia` y `es_medico`, para que el formulario avise que no se escriban diagnósticos en el motivo.

**Permisos médicos: motivo y documento obligatorios, y se conservan (decisión del usuario, 05/11/2026).**

- Un tipo con `tipo_ausencia = MEDICO` tiene `pide_motivo = true` y `adjunto = "obligatorio"`. Si al crearlo o editarlo llega otra cosa, la API responde 400 por campo, sin corregirlo en silencio: `details.pide_motivo` («Un permiso médico siempre pide el motivo.») y `details.adjunto` («Un permiso médico pide siempre el documento de respaldo: elija «Obligatorio».»). Vale también para un PATCH que solo cambia `tipo_ausencia` a `MEDICO` sobre un tipo con documento opcional. `FlujoPermiso.save()` los fija igual para los caminos que no pasan por la API.
- `licencias/0006` corrigió los tipos médicos existentes (`pide_motivo = true`, `adjunto = obligatorio`); las solicitudes ya hechas no se tocan.
- Al solicitar un tipo médico, sin documento responde 400 `details.adjunto` y sin motivo (o solo espacios) 400 `details.motivo` («Un permiso médico pide el motivo. No escriba diagnósticos.»), en `services.crear`. En los tipos no médicos, `pide_motivo` sigue mostrando el campo sin exigirlo.
- **El motivo y el documento de la solicitud se conservan**: no hay purga para ellos. La purga a cinco años es solo de las ausencias médicas de Gestión Humana (`purgar_ausencias_medicas`), y no cambia.

Pruebas: `test_medicos_y_anulacion.py` (`test_un_tipo_medico_sin_documento_obligatorio_no_se_guarda`, `test_un_tipo_medico_sin_motivo_no_se_guarda`, `test_uno_ya_medico_no_puede_dejar_de_pedir_motivo_ni_documento`, `test_la_migracion_corrige_los_tipos_medicos_existentes`, `test_la_solicitud_medica_sin_documento_o_sin_motivo_se_rechaza`, `test_la_solicitud_medica_conserva_su_motivo_y_su_documento`).

**La solicitud guarda su clasificación.** `unidad`, `descuento` y `tipo_ausencia` se copian del tipo al crear la solicitud y no cambian si el tipo se reclasifica. La API los sirve desde la solicitud. Las ausencias, el descuento de vacaciones al aprobar, lo reservado por las pendientes y la devolución al cancelar usan los valores de la solicitud. `licencias/0005` rellenó las existentes con el valor que tenía su tipo. Pruebas: `test_clasificacion_de_la_solicitud.py`.

`descuenta_vacaciones` queda como **espejo** de `descuento = vacaciones`: lo siguen leyendo las restricciones y la pantalla actual. Si un cliente manda solo `descuenta_vacaciones`, se traduce: verdadero pasa a `vacaciones`; falso quita `vacaciones` (queda `ninguno`) y deja `sueldo` como estaba. La migración `licencias/0004` pasó los tipos con `descuenta_vacaciones` a `vacaciones` y `VACACIONES`, y los que se llaman «… médico …» a `MEDICO`. Pruebas: `test_la_migracion_clasifica_los_tipos_existentes`, `test_la_pantalla_anterior_sigue_marcando_vacaciones_con_el_booleano`, `test_cada_descuento_se_guarda_y_lo_lleva_la_ausencia`.

**Permiso por horas.** `hora_desde` y `hora_hasta` (`HH:MM`) son obligatorias si la unidad es horas, con `desde == hasta` y el fin posterior al inicio. En un tipo por días no se aceptan. Se valida en el serializer y en `services.crear`. La respuesta de la solicitud trae `unidad`, `descuento`, `hora_desde`, `hora_hasta` y `minutos`. Pruebas: `test_las_horas_se_validan_en_la_api`, `test_las_horas_se_validan_tambien_en_el_servicio`, `test_un_tipo_por_dias_no_lleva_horas`.

**Al aprobarse** se crean sus `LeaveRecord` (`apps.ausencias.services.create_from_request`), con `solicitud`, el `descuento` y el `tipo_ausencia` del tipo:

- **Por días:** uno de día completo por cada día del rango, sin los feriados del calendario institucional. Los sábados y domingos solo cuentan si el tipo se descuenta de las vacaciones y tiene su regla de sábados (o de domingos) por período, porque entonces salen de las vacaciones como cualquier otro día. En los demás casos no se registran.
- **Por horas:** uno solo, en su día, con `duration_minutes`.
- **Idempotente:** si la solicitud ya tiene sus ausencias, no se crean más. En la base lo garantiza la restricción única `(solicitud, date)`.
- **Rechazada o pendiente:** no genera nada.

Pruebas: `test_aprobar_por_dias_salta_fin_de_semana_y_feriado`, `test_vacaciones_con_regla_de_fines_de_semana_los_registran`, `test_aprobar_por_horas_crea_una_sola_ausencia_con_sus_minutos`, `test_aprobar_dos_veces_o_reintentar_no_duplica`, `test_rechazar_no_genera_ausencias`.

**Desde Ausencias** no se borra un registro que viene de una solicitud, sea quien sea: responde `409` con `{"error": {"code": "linked_to_request", "message": "Este registro viene de la solicitud N.º 123; gestiónelo desde Solicitud de permisos.", "details": {"solicitud_id": 123}}}`. Quien no ve la ausencia recibe 404, como siempre. El listado trae `solicitudId` y `descuento`, y `canDelete` es falso para esos registros. Los registros manuales no cambian (`test_lo_que_viene_de_una_solicitud_no_se_borra_desde_ausencias`).

**LOPDP:**

- una ausencia `MEDICO` generada queda protegida igual que una manual (`apps/ausencias/access.py`);
- el motivo y el adjunto de la solicitud no se copian a la observación;
- la auditoría de Ausencias es la genérica (`ausencias.registro_creado` / `registro_eliminado`, con `origen: "solicitud"`), sin tipo ni motivo;
- Ausencias no envía avisos propios.

Prueba: `test_la_auditoria_de_ausencias_no_lleva_el_tipo_ni_el_motivo`.

Las ausencias médicas, generadas o manuales, se borran a los cinco años (`manage.py purgar_ausencias_medicas`, en la tarea de cada 5 minutos). El motivo y el documento de la solicitud de permiso **no** se purgan: se conservan con la solicitud (decisión del 05/11/2026).

## Quién ve una solicitud

Quien la pidió, quien la tiene pendiente, quien ya actuó en ella y quien tiene `licencias.ver_todas`. Cualquier otra persona recibe 404, tanto en la solicitud como en su documento (`test_solo_ven_una_solicitud_quienes_tienen_que_ver_con_ella`). Las solicitudes están aisladas por empresa, como todo `ModeloDeEmpresa`.

## Decisiones abiertas y límites conocidos

- **Fechas pasadas.** Hoy se permite pedir fechas anteriores a hoy: un permiso médico suele registrarse después. Si las vacaciones deben pedirse solo hacia adelante, o con cierta anticipación, se puede agregar como restricción que bloquee. Hoy solo se puede informar con «Otras indicaciones».
- **Si la única persona con `licencias.configurar` solicita sin tener jefe en el organigrama**, su paso no encuentra a nadie y queda sin aprobador hasta que alguien con `licencias.ver_todas` la escale. Conviene que al menos dos personas tengan `licencias.configurar`.
- **Concurrencia.** El bloqueo por persona se probó en su lógica, no con dos peticiones simultáneas reales.
- **Dos permisos por horas el mismo día.** La regla de cruces compara días, así que dos solicitudes por horas del mismo día se cruzan aunque sus horas no se solapen. Si hace falta, hay que comparar también las horas.
- **El nombre del tipo de permiso en avisos y auditoría de Institucional.** Los avisos de la campana y la auditoría `licencias.solicitud.creada` llevan el nombre del tipo, por ejemplo «Permiso médico». Ese comportamiento es anterior al 05/11/2026 y no se cambió. Si el nombre del tipo se considera dato de salud, hay que decidir qué ven los aprobadores.
- **Interpretación de «antes de finalizar su período».** Se tomó como «antes de agotar los días del período», porque los períodos son años de servicio que se gozan después de cumplidos. Si se quiere una fecha límite, hay que definirla.
