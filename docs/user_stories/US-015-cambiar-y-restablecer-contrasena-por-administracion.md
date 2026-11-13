# Historia de Usuario: US-015 - Cambiar la contraseña de una cuenta o restablecerla a la temporal, por permiso

- **ID:** US-015
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-13
- **Sprint / Módulo:** Configuración › Usuarios (`backend/apps/users`, `apps/authentication`; `frontend/src/pages/Admin/Users/UserForm.jsx`)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-2 (incluye las migraciones de permisos), DEV-4

---

### 1. Definición de la Historia
- **Como:** administrador con el permiso correspondiente.
- **Quiero:** cambiar la contraseña de una cuenta por una que yo indique, o restablecerla a la contraseña temporal, desde la ficha del usuario en Configuración.
- **Para:** atender a quien no puede usar «Recuperar contraseña» (sin correo o con el enlace vencido) sin pedirlo a desarrollo.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Cambiar la contraseña**
  - **Dado que:** tengo `usuarios.cambiar_password`.
  - **Cuando:** en la ficha de otra persona pulso «Cambiar contraseña», escribo la nueva dos veces y guardo.
  - **Entonces:**
    - La contraseña pasa por los validadores del sistema: longitud, complejidad y que no sea la clave temporal. Si no los cumple, da 400 en `password` con el motivo.
    - Por omisión se marca «Pedir que la cambie al entrar» (`must_change_password`) y «Cerrar sus sesiones abiertas». Se pueden desmarcar.
    - Se invalidan sus enlaces de recuperación pendientes y se desbloquea la cuenta si estaba bloqueada por intentos fallidos.
    - Se le avisa por correo que la contraseña fue cambiada por administración, sin incluir la contraseña.
    - Queda en la auditoría (quién, a quién, cuándo y qué opciones), nunca la contraseña.

- **CA-2 · Restablecer a la contraseña temporal**
  - **Dado que:** tengo `usuarios.clave_temporal`.
  - **Cuando:** pulso «Restablecer a la contraseña temporal» y confirmo.
  - **Entonces:**
    - La contraseña pasa a ser la clave temporal configurada en el servidor (`CLAVE_INICIAL_USUARIOS`).
    - Siempre se marca `must_change_password`: al entrar se le pide cambiarla.
    - Siempre se cierran sus sesiones y se invalidan sus enlaces de recuperación.
    - Se desbloquea la cuenta.
    - Se le avisa por correo y queda en la auditoría.
    - Si el servidor no tiene clave temporal configurada, da 400 con un mensaje claro y no cambia nada.

- **CA-3 · Límites**
  - **Entonces:**
    - Nadie usa estas acciones sobre su propia cuenta (403): la propia contraseña se cambia en «Mi perfil».
    - Solo un superusuario actúa sobre otro superusuario (403 para los demás).
    - Una cuenta desactivada se puede cambiar, pero sigue desactivada.
    - Sin el permiso, la API responde 403 y la ficha no muestra el botón.

- **CA-4 · Permisos (todo nace con los suyos)**
  - **Entonces:**
    - Existen `usuarios.cambiar_password` («Cambiar la contraseña de otra cuenta por una indicada») y `usuarios.clave_temporal` («Restablecer la contraseña de otra cuenta a la clave temporal»).
    - La migración los da a «Administrador» y «Superusuario». Se pueden dar a otros roles desde Roles.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Backend | DEV-2 | Acciones `POST /api/v1/admin/users/<id>/password/` (cambiar) y `POST /api/v1/admin/users/<id>/clave-temporal/` en el viewset de usuarios, con servicio en `UserAdminService` o `PasswordResetService`, validadores, límites, invalidación de tokens, cierre de sesiones, desbloqueo, correo y auditoría. Permisos en el catálogo, migraciones permissions 0066 y roles 0052, y `crear_roles_iniciales`. Pruebas. |
| Web | DEV-4 | En la ficha del usuario (`UserForm.jsx` o donde esté «Restablecer contraseña»), una sección «Contraseña» con los dos botones según el permiso. Ventana de cambiar (nueva contraseña, repetir, mostrar u ocultar, requisitos visibles, casillas). Confirmación de restablecer a la temporal, que explica lo que pasará. Errores por campo y éxito. Pruebas. |

**Fuera de alcance:**
- Cambiar el flujo de «Recuperar contraseña».
- Mostrar la clave temporal en la pantalla.

---

### 4. Decisiones Técnicas y Supuestos
- **Decisión del usuario (13/11/2026):** la contraseña temporal es una sola, fija y conocida por administración, controlada por permisos. Su valor no se escribe en ningún archivo del repositorio.
- **La clave temporal no va en el repositorio, que es público:** se guarda en `CLAVE_INICIAL_USUARIOS` del `.env` de cada servidor. En producción se fijará al desplegar, cuando haya acceso al servidor. El código no la contiene ni la muestra.
- **Riesgo aceptado y mitigado:** una clave fija y conocida permite entrar a la cuenta restablecida antes que su dueño. Por eso:
  - siempre obliga a cambiarla al entrar;
  - cierra las sesiones;
  - avisa por correo a la persona;
  - queda auditado;
  - la persona no puede elegirla como propia (validador existente).
- **Permisos nuevos** separados de `usuarios.restablecer_password`, que solo envía el enlace, obliga a cambiar y cierra sesiones. Regla del usuario: todo lo nuevo nace con sus permisos.

---

### 5. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-13
- **QA-FUNC:** APROBADO CON OBSERVACIONES · **QA-TECH:** APROBADO (ronda 2) · **QA-UX:** aprobado tras corregir el contraste en tema oscuro (Alta), revisado en vivo en tema claro y oscuro
- **Criterios de aceptación:** CA-1 ✅ · CA-2 ✅ · CA-3 ✅ · CA-4 ✅
- **Archivos principales:**
  - Backend: `apps/users/{views,permissions,services}.py`, `apps/authentication/{services,serializers,emails}.py`, `apps/correos/catalogo.py`, `apps/permissions/catalog.py`, migraciones permissions 0066 y roles 0052.
  - Web: `pages/Admin/Users/ContrasenaDeLaCuenta.{jsx,css}`, `UserForm.jsx`, `ReglasContrasena.jsx`, `ConfirmDialog.jsx`, `ModalDialog.jsx`, `api/adminUsersService.js`.
- **Verificación ejecutada:**
  - `makemigrations --check`: sin cambios.
  - pytest de users, authentication, roles, permissions, correos y organizacion: 511 pasan.
  - Vitest completo: 3302 de 3305; los 3 que fallan son timeouts de ImportarActivosPage, que pasan solos.
  - Revisión en vivo de la ventana «Cambiar contraseña» en tema claro y oscuro, sin enviar el formulario.
  - El valor de la clave temporal no aparece en ningún archivo del repositorio.
- **Pendientes:**
  - Fijar `CLAVE_INICIAL_USUARIOS` en el `.env` de producción al desplegar.
  - Observaciones menores de QA-FUNC: mensajes de error poco frecuentes, sin cambios funcionales.
