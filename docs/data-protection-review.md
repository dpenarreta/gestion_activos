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
