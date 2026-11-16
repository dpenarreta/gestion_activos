# Historia de Usuario: US-021 - Perfiles de las personas desde nómina (sp_ObtenerEmpleadosActivos)

- **ID:** US-021
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-16
- **Sprint / Módulo:** Configuración › Usuarios (`backend/apps/nomina`, `apps/users`; `frontend/src/pages/Admin/Users/`)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-3 (modelo y migraciones), DEV-2, DEV-4

---

### 1. Definición de la Historia
- **Como:** TI y Gestión Humana.
- **Quiero:** que el perfil de cada persona tome de nómina su nombre, su código de empleado, su correo y su cédula.
- **Para:** no escribir a mano los datos de 744 empleados ni tenerlos desactualizados.

**Fuente:** procedimiento `dbo.sp_ObtenerEmpleadosActivos` de `base_courier` (servidor 10.0.2.51), por la conexión de solo lectura `EXTERNAL_DB_*`.
- **Hoy trae:** `CODIGO_EMP` (8 caracteres), `NOMBRE_COMPLETO` (en MAYÚSCULAS, «APELLIDOS NOMBRES») y `email_emp`, que viene vacío en todos.
- **Pronto traerá:** la cédula.

**Datos al 16/11/2026:**
- 744 empleados activos.
- 25 cuentas activas en la intranet. Ninguna tiene código de nómina y solo una coincide por nombre.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Emparejar**
  - **Dado que:** se sincroniza.
  - **Entonces:**
    - Cada empleado se empareja con su cuenta por cédula; si no hay coincidencia, por correo corporativo; si tampoco, por código de empleado; y si tampoco, por nombre.
    - Por nombre solo cuando es inequívoco: la cuenta (sin código ni cédula) coincide con un solo empleado, y el empleado con una sola cuenta. Si es ambiguo, no se crea otra cuenta: va al reporte.
    - Un dato vacío no empareja.

- **CA-2 · Manda nómina**
  - **Dado que:** el empleado tiene cuenta.
  - **Entonces:**
    - Se actualizan nombres, apellidos, código, cédula y correo.
    - El correo solo se guarda si es corporativo (`DOMINIOS_INSTITUCIONALES`). El personal (p. ej. @gmail.com) se descarta y no se guarda: es un dato personal con su propio tratamiento (decisión del usuario).
    - Cada cambio queda en la auditoría (`usuarios.nomina.actualizado`) con el valor anterior y el nuevo. La cédula se registra enmascarada.
    - Si el código, la cédula o el correo ya los tiene otra cuenta, no se pisa: queda como conflicto en el reporte.

- **CA-3 · Cuentas nuevas, inactivas**
  - **Dado que:** el empleado no tiene cuenta.
  - **Entonces:**
    - Se crea una cuenta inactiva, con el usuario generado por la regla de siempre, nombre, código y cédula.
    - No tiene rol, solo lo básico.
    - No tiene contraseña utilizable y queda marcada para cambiarla al entrar.
    - Si no trae correo, recibe una dirección reservada (`usuario@sin-correo.invalid`), que nunca recibe correos.
    - Nadie puede entrar hasta que TI o Gestión Humana la active y le deje la contraseña temporal.

- **CA-4 · Reporte**
  - **Entonces:**
    - Cada sincronización queda registrada: cuándo, quién (o «automática»), cuántas cuentas se crearon, cuántas se actualizaron y cuántas no cambiaron.
    - Registra los conflictos y las cuentas activas de la intranet que no están en nómina. Estas solo se reportan; no se desactivan.
    - Se ve en Configuración › Usuarios › «Nómina».

- **CA-5 · Cuándo**
  - **Entonces:**
    - Se sincroniza sola cada noche (tarea «Intranet-Nomina», 02:00).
    - También con «Sincronizar ahora» (permiso `usuarios.sincronizar_nomina`).
    - Si la base de nómina no responde, queda registrada la falla y no se cambia nada.

- **CA-6 · Cédula (LOPDP)**
  - **Entonces:**
    - La propia persona ve su cédula en su perfil y en la descarga de «Mis datos».
    - En la ficha del usuario solo la ve quien tiene `usuarios.ver_cedula`. Nadie la edita a mano: viene de nómina.

- **CA-7 · Correos**
  - **Entonces:** el envío de correos descarta las direcciones `@sin-correo.invalid`, y un correo sin otros destinatarios no sale.

---

### 3. Decisiones Técnicas y Supuestos
- **Decisiones del usuario (16/11/2026):**
  - Emparejar por correo y, si no, por código; se suma la cédula cuando llegue.
  - Manda nómina.
  - Al principio se pidió solo reportar a quien falte. Después, al ver que nómina no trae correos, se decidió crear las cuentas desde nómina: inactivas y sin rol.
  - Cada noche y con botón.
  - Cédula restringida.
- **Nombre:** «APELLIDOS NOMBRES». Las dos primeras palabras son los apellidos y el resto, los nombres. Las partículas (DE, DEL, LA, LOS, DE LA) se unen al apellido que sigue. Se escribe en formato de título.
- **Correo reservado:** el TLD `.invalid` está reservado (RFC 2606) y no existe. Así no cambia que el correo sea obligatorio y único.
- **El procedimiento:** se configura en `NOMINA_EMPLEADOS_PROCEDIMIENTO`. Vacío, la función queda apagada.

---

### 4. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-16
- **Cambios de rumbo durante la historia (decisiones del usuario):**
  - El procedimiento se modificó el 16/11 a las 10:43. Pasó de 744 a 712 empleados y ahora trae correo, pero personal.
  - Se decidió descartar los correos personales y emparejar también por nombre, para no duplicar las cuentas que ya existen sin código.
- **Verificación ejecutada:**
  - pytest de nómina: 21 pasan.
  - Suites amplias (users, nomina, authentication, organizacion, privacidad, permissions, roles, core, novedades, alertas): 1440 pasan.
  - Vitest completo: 3315 de 3316. El que falla es una prueba de Tareas que depende de la fecha (una tarea que vence el 15/11 hoy sale «vencida»); no tiene relación con esta historia.
  - En vivo, en local, contra la base real:
    - Primera corrida: 712 empleados, 710 cuentas creadas (inactivas, sin rol, sin contraseña utilizable), 2 emparejadas por nombre (Daniel Peñarreta y Tamara Maldonado, que conservaron su correo corporativo) y 0 conflictos.
    - Segunda corrida: todo sin cambios, en 9 s.
  - Revisado en pantalla: el panel «Nómina» y la ficha (cédula de solo lectura y aviso de cuenta sin correo).
- **Pendientes:**
  - La cédula todavía no viene en el procedimiento; se tomará sola en cuanto llegue.
  - Activar las cuentas en bloque (hoy se activa una por una desde la ficha).
  - El procedimiento debería traer el correo corporativo en lugar del personal.
