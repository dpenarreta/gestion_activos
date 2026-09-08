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

No se recolecta ningún otro dato personal (sin domicilio, sin documento de
identidad, sin datos financieros ni de salud).

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
  cualquier campo cuyo nombre sugiera contraseña/token/secreto antes de
  persistir un evento de auditoría, sin excepción y sin depender de que
  cada `service.py` se acuerde de hacerlo.
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
   proyecto que se construya sobre este template.
