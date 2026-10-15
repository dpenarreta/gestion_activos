# Módulo «Matriz de obligaciones»

Controla las obligaciones regulatorias, contractuales e internas de cada
empresa: quién responde por cada una, cuándo vence, qué evidencia la respalda,
quién valida su cierre y qué recordatorios se envían.

Se construye **sobre** gestion_activos, siguiendo la especificación
`matriz_admin/docs/modulo/MODULO-MATRIZ-OBLIGACIONES.md` (los números de sección
de este documento y del código remiten a ella). Reutiliza lo que el sistema ya
tiene y agrega solo lo propio de la matriz.

## Cómo se entra

- **Selector de módulos** en la barra superior, junto al de empresa: «Gestión de
  Activos» o «Matriz de obligaciones». Cada módulo trae su propio menú lateral;
  Configuración es común a los dos.
- Frontend bajo `/admin/matriz/...`; API bajo `/api/v1/matriz/...`
  (`apps.matriz`).
- La Matriz aparece en las empresas donde la persona tiene un rol de la Matriz
  en la membresía, y en las demás no.

## Mapa de integración (§3)

| Necesidad | Decisión |
| --- | --- |
| Usuarios, login | Los del sistema (JWT con sesiones, Argon2, bloqueo por intentos) |
| Roles editables | `auth.Group`; se siembran «Matriz · Administrador», «Matriz · Responsable», «Matriz · Supervisor/Aprobador» y «Matriz · Auditor» (con prefijo: ya existe un «Administrador») |
| Catálogo de permisos | `apps/permissions/catalog.py`: módulos `matriz` y `catalogos` |
| Empresas y membresía | `Empresa` y `MembresiaEmpresa` (con roles por empresa), ampliadas con zona horaria, color, gerente general y base de cumplimiento |
| Sucursales | Las sedes de Organización |
| Auditoría | `record_audit_event` |
| Correo, almacenamiento | Los del sistema (resumen de alertas, adjuntos privados) |
| Programador | La tarea oculta de Windows que ya corre cada 5 minutos (la del respaldo) |
| Diseño, exportación | Identidad `mz-*`, openpyxl y reportlab |

## Decisiones confirmadas (§24), 15 de octubre de 2026

1. Se reutilizan las empresas del sistema y se amplían.
2. Roles por empresa = roles del sistema asignados en la membresía. Los
   permisos `matriz.*` **solo** cuentan por la membresía: un rol global no los
   concede (`apps.permissions.authorization.SOLO_POR_EMPRESA`). El superusuario
   los tiene en todas.
3. Áreas y entidades de control: catálogos nuevos, compartidos por todas las
   empresas, sembrados con los de la sección 5. No son los departamentos del
   inventario.
4. Cambian la fecha de vencimiento: Administrador y Supervisor.
5. Cuenta como cumplimiento la validación, configurable por empresa.
6. Escalamiento al supervisor (o al aprobador), una vez, a los 2 días.
7. Copia del recordatorio al suplente: sí.
8. Vencimientos por día fijo del mes, o día y mes si es anual.
9. Documentos sin borrado físico y sin antivirus.
10. Se empieza sin datos; las obligaciones se cargan desde la pantalla.

## Fases (§21)

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1. Base y acceso | Selector de módulos; empresa ampliada; áreas y entidades de control; permisos y roles sembrados; acceso solo por membresía; empresas de la Matriz con su rol | **Hecha** (AC-MTZ-001 a 010) |
| 2. Obligaciones y matriz | Obligación, período, secuencia, historial; motor de estados; Resumen, Matriz, Detalle | **Hecha** (AC-MTZ-011 a 025) |
| 3. Evidencias y cierre | PDF, visor, enviar, validar, devolver, rechazar, cambio de fecha; Documentos | **Hecha** (AC-MTZ-026 a 036) |
| 4. Recordatorios | Configuración por empresa, correo, reintentos, escalamiento, en la tarea programada | **Hecha** (AC-MTZ-037 a 046) |
| 5. Reportes y configuración | Calendario, Reportes, exportaciones, auditoría, pestaña Recordatorios | **Hecha** (AC-MTZ-047 a 056) |

## Lo que trae la fase 1

- **API**
  - `GET matriz/empresas/mias/`: empresas con rol de la Matriz, con el rol y las
    capacidades en cada una.
  - `matriz/catalogos/areas/` y `matriz/catalogos/entidades-control/`: CRUD con
    `catalogos.ver` / `catalogos.editar`, auditado.
  - `GET empresas/{id}/personas/`: quienes trabajan en la empresa, para elegir al
    gerente general.
  - `GET empresas/mias/` devuelve ahora el rol y el color de cada empresa.
- **Pantallas**
  - Entrada de la Matriz (`/admin/matriz`): empresa, zona horaria, rol y qué
    permite.
  - Configuración → Catálogos → Áreas y Entidades de control.
  - Ficha de empresa con la sección «Matriz de obligaciones».

## Lo que trae la fase 2

- **Modelos**: `Obligacion` y `Periodo` (acotados a la empresa),
  `SecuenciaCodigo` (global: `OBL-0001`…) y `EventoPeriodo` (historial de solo
  inserción). Las áreas ganan su relación con la membresía, para la regla de
  crear por área.
- **Motor de estados** (`apps/matriz/estados.py`): calculado en cada consulta,
  en la zona horaria de la empresa, con filtros equivalentes en base de datos.
- **API** (sobre la empresa activa)
  - `GET resumen/`: indicadores, próximos vencimientos y cierres recientes.
  - `GET periodos/`: la matriz, con `q`, `area`, `entity`, `responsible`,
    `obligation`, `priority`, `stage`, `status`, `due_today`, `due_from` y
    `due_to`; `sort` por urgencia (defecto), `due`, `name`, `area`, `entity`,
    `responsible`, `code` o `priority` (con `-` para invertir); paginada.
  - `GET/PATCH periodos/{id}/`: detalle con `estado` y `acciones`, y el
    seguimiento. `GET periodos/{id}/historial/`.
  - `POST obligaciones/`: la obligación con su primer período.
    `GET/PATCH obligaciones/{id}/`.
  - `GET personas/` y `GET catalogos/`: lo que eligen los formularios.
- **Pantallas**: Resumen (tablero), Matriz de obligaciones (con el contador de
  urgentes en el menú), panel lateral del período (General e Historial,
  `?periodo=ID`), «Nueva obligación» y «Editar seguimiento». En el módulo, la
  búsqueda de la barra superior abre la matriz filtrada.
- **Para las fases siguientes**: las acciones del cierre (fase 3), los
  recordatorios (fase 4) y la generación automática de los períodos siguientes
  (fase 5). La pantalla para asignar áreas a una membresía llega con la fase 5;
  la regla ya se aplica en el servidor.

## Lo que trae la fase 3

- **Modelo**: `Documento` (acotado a la empresa por su período). El archivo se
  guarda en `evidencias/{empresa}/{año}/{código}/v{versión}-{sha12}.pdf`, con
  su huella SHA-256; el mismo nombre en el mismo período es una versión nueva.
  Estados `valido`, `rechazado` y `eliminado`: no hay borrado físico.
- **Reglas** (`apps/matriz/cierre.py`): solo PDF (extensión y firma `%PDF-`),
  hasta `DOCUMENT_MAX_UPLOAD_MB` (10 por defecto); la primera evidencia pasa el
  período a «En preparación»; enviar exige un documento válido; quien envió o
  cargó no valida (separación de funciones); la fecha de cumplimiento sigue la
  base de la empresa (validación o envío) y un cierre tardío queda «Finalizada
  fuera de plazo»; devolver, rechazar y cambiar la fecha exigen un motivo de al
  menos 10 caracteres. Todo deja su evento en el historial.
- **Acciones por rol** (`acceso.acciones()`, §8.10): `edit`, `upload`,
  `submit`, `validate`, `return`, `reject_document` y `change_due_date`; la
  pantalla dibuja solo las que manda el servidor.
- **API** (sobre la empresa activa)
  - `GET/POST periodos/{id}/documentos/`: lista y carga (multipart, `file`).
  - `GET documentos/{id}/archivo/` (`?download=1` para descargar): el PDF con
    la sesión; cada acceso queda auditado como `document.accessed`.
  - `POST documentos/{id}/rechazar/` y `DELETE documentos/{id}/` (lógico).
  - `POST periodos/{id}/enviar/`, `validar/`, `devolver/` y `vencimiento/`.
  - `GET documentos/`: la vista Documentos (`with_evidence` y `pending`).
- **Pantallas**: en el panel del período, la barra de acciones, la pestaña
  Documentos (válidos y rechazados), «Cargar evidencia» (arrastrar y soltar,
  varios archivos, progreso por archivo), el visor de PDF, «Devolver»,
  «Rechazar evidencia» y «Cambiar fecha de vencimiento». En el menú del
  módulo, la vista Documentos (`/admin/matriz/documentos`).

## Lo que trae la fase 4

- **Modelos**: `ConfiguracionRecordatorios` (una por empresa, creada con los
  valores por defecto al leerla: 15, 7, 3, 1 y 0 días; 08:00; copia al
  suplente; escalamiento a los 2 días, una sola vez) y `Notificacion` (una
  fila por aviso y destinatario, con su clave única).
- **El motor** (`apps/matriz/recordatorios.py`), en la hora local de cada
  empresa:
  - Recordatorios: al responsable y, si la empresa lo pide, al suplente, sin
    repetir correos y omitiendo a quien no tiene; a partir de la hora de envío.
  - Escalamiento: al supervisor o, si no hay, al aprobador, con N días de
    atraso; una vez o cada N días. Deja «Escalamiento enviado a…» en el
    historial, por «Sistema».
  - Reintentos: los fallidos, hasta `NOTIFICATION_MAX_ATTEMPTS` (3). Cada
    reintento es otra notificación; la original queda «reintentada».
  - Sin duplicados: la fila se crea **antes** de enviar con su clave única
    (`auto:…`, `esc:…`, `retry:…`, `manual:…`, §12.4), así que dos pasadas a
    la vez chocan en la base y solo una manda el correo. La fecha de
    vencimiento va en la clave: si cambia, los avisos se reprograman.
- **La tarea programada**: `manage.py ciclo_matriz` corre recordatorios,
  escalamientos y reintentos. Lo lanza la misma tarea oculta del respaldo
  (`scripts/tarea_respaldo.py`, cada 5 minutos con `pythonw.exe`), sin ventana
  y sin registrar otra tarea; un respaldo fallido no deja sin avisos a nadie.
  La generación automática de períodos se suma en la fase 5.
- **El correo** (`templates/emails/matriz_recordatorio.html`, HTML y texto):
  los asuntos de §12.5 y el enlace a
  `{FRONTEND_URL}/admin/matriz/obligaciones?periodo={id}&empresa={id}`. La
  aplicación toma `empresa` antes de montar, para que quien trabaja en dos
  empresas caiga en la del aviso.
- **API** (sobre la empresa activa)
  - `GET/PUT recordatorios/configuracion/`: la ve cualquiera con rol de la
    Matriz; la cambia `configurar` (auditado).
  - `GET notificaciones/?status=`: las de la empresa, con `ver_auditoria`.
  - `POST notificaciones/{id}/reintentar/`: con `recordar`.
  - `GET periodos/{id}/recordatorios/`: programación y notificaciones.
  - `POST periodos/{id}/recordatorios/enviar/`: reenvío manual, con
    `recordar` (historial y auditoría).
  - `GET periodos/{id}/recordatorios/vista-previa/?kind=`: el correo sin
    enviarlo.
- **Pantallas**: la pestaña Recordatorios del período (programación,
  notificaciones con «Reintentar», vista previa del correo y «Reenviar
  recordatorio», también en la barra de acciones) y Configuración →
  Recordatorios (anticipaciones, hora, copia al suplente, escalamiento e
  historial de la empresa).

## Lo que trae la fase 5

- **Generación automática** (`apps/matriz/generacion.py`, §11.3): en cada
  pasada del ciclo, antes de los avisos, cada obligación recurrente activa
  cuyo último período vence dentro de `PERIOD_GENERATION_LEAD_DAYS` (30)
  recibe el siguiente. Hereda responsable, suplente, supervisor, aprobador,
  prioridad y sucursal, y conserva la hora de vencimiento. No repite
  etiquetas y crea como mucho 24 por obligación y pasada. La única no genera.
- **API** (sobre la empresa activa)
  - `GET calendario/?year=&month=`: lo que vence en el mes, en la hora de la
    empresa.
  - `GET reportes/?due_from=&due_to=`: `kpis`, `by_area` y `by_entity`; con
    `export=xlsx|pdf`, el archivo.
  - `GET periodos/?…&export=xlsx|pdf`: la matriz con los mismos filtros y
    orden de la pantalla.
  - `GET auditoria/?actor=&action=&from=&to=`: el historial de los períodos
    de la empresa, con `ver_auditoria`.
  - Las exportaciones exigen `exportar`, se auditan como `report.exported` y
    llevan empresa, fecha de corte y quién exportó. Se dibujan con los
    renderizadores de `apps/reportes`.
- **Membresías**
  - La asignación de empresas de la ficha del usuario acepta `areas` por
    empresa. Sin la clave, se conservan: antes, guardar la ficha borraba las
    áreas, porque la asignación reemplaza las membresías.
  - Último gestor (§8.9): una asignación que deja sin `gestionar_miembros` a
    una empresa que tenía alguno se rechaza entera. Esto vigila la ficha del
    usuario. Quitar el permiso de un rol desde Roles no lo vigila todavía.
- **Pantallas**: Calendario y Reportes en el menú del módulo, «Excel» y «PDF»
  en la Matriz y en Reportes (solo con `exportar`), Configuración →
  Auditoría → Matriz, y las áreas de la Matriz (plegadas) en «Empresas y
  roles» de la ficha del usuario.
- **Nombres**: la acción del detalle es `remind`, como en §8.10. En el
  historial, el reenvío y el escalamiento quedan como `reminder.sent` y
  `reminder.escalated` (en la especificación, `period.reminder_sent` y
  `period.escalated`).
