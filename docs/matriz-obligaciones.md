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
| 2. Obligaciones y matriz | Obligación, período, secuencia, historial; motor de estados; Resumen, Matriz, Detalle | Pendiente |
| 3. Evidencias y cierre | PDF, visor, enviar, validar, devolver, rechazar, cambio de fecha; Documentos | Pendiente |
| 4. Recordatorios | Configuración por empresa, correo, reintentos, escalamiento, en la tarea programada | Pendiente |
| 5. Reportes y configuración | Calendario, Reportes, exportaciones, auditoría, pestaña Recordatorios | Pendiente |

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
