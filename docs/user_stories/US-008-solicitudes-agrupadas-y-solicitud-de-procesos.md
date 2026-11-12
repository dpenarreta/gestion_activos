# Historia de Usuario: US-008 - Menú «Solicitudes» y nueva «Solicitud de procesos»

- **ID:** US-008
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-12
- **Sprint / Módulo:** Institucional › Solicitudes (`backend/apps/proyectos`, `frontend/src/pages/Institucional/SolicitudProyectosPage.jsx`, `TiposProyectoPage.jsx`, `staticAdminMenu.js`)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-2 (incluye la migración), DEV-4

---

### 1. Definición de la Historia
- **Como:** persona de la empresa que pide permisos, proyectos o procesos, y como quien configura y atiende esas solicitudes.
- **Quiero:** encontrar las tres solicitudes juntas bajo «Solicitudes» en el menú, cada una con su pantalla, y poder pedir procesos con su propio flujo.
- **Para:** que pedir algo a la empresa tenga un único punto de entrada, y que los procesos se pidan y aprueben aparte de los proyectos.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Un solo ítem «Solicitudes» en el menú**
  - **Dado que:** estoy en el módulo Institucional.
  - **Cuando:** miro el menú lateral.
  - **Entonces:**
    - Hay un grupo «Solicitudes» que reemplaza las entradas sueltas «Solicitud de permisos» y «Solicitud de proyectos».
    - Dentro están «Solicitud de permisos», «Solicitud de proyectos» y «Solicitud de procesos», y cada una abre su propia pantalla.
    - Cada hijo conserva su contador de pendientes. El grupo muestra la suma.
    - Las rutas actuales (`/admin/institucional/permisos`, `/admin/institucional/proyectos`) siguen funcionando, igual que los enlaces de los avisos ya enviados.

- **CA-2 · Solicitud de procesos con el mismo motor que proyectos**
  - **Dado que:** existe al menos un tipo de proceso activo.
  - **Cuando:** abro «Solicitud de procesos» (`/admin/institucional/procesos`).
  - **Entonces:**
    - Puedo pedir un proceso eligiendo su tipo, llenando su formulario y adjuntando su plantilla, igual que en proyectos.
    - Puedo seguir mis solicitudes y atender las que me tocan.
    - La numeración es propia: `PRC-AAAA-NNNN`. Los proyectos siguen con `PRY-AAAA-NNNN`.

- **CA-3 · Separación total entre proyectos y procesos**
  - **Entonces:**
    - Los tipos de proceso no aparecen en «Solicitud de proyectos», y viceversa.
    - Las solicitudes, la bandeja «por atender» y el contador de cada pantalla cuentan solo lo suyo.
    - Una solicitud de un tipo de una categoría no se puede crear ni ver desde la otra: el servidor responde 404, como con un tipo inexistente.

- **CA-4 · Configurar los tipos de proceso**
  - **Dado que:** tengo el permiso nuevo `procesos.configurar`.
  - **Cuando:** abro «Tipos de proceso» (`/admin/institucional/procesos/tipos`, enlazado desde la pantalla de procesos).
  - **Entonces:**
    - Creo y edito tipos de proceso con su plantilla, sus campos y sus pasos con quién decide cada uno, igual que los de proyecto.
    - Sin el permiso, la API responde 403 y la pantalla no ofrece el enlace.
    - `proyectos.configurar` no sirve para configurar procesos, ni al revés.

- **CA-5 · Ver todas las de procesos**
  - **Entonces:**
    - Existe `procesos.ver_todas`, equivalente a `proyectos.ver_todas`: ver y escalar todas las solicitudes de proceso de la empresa.
    - La migración da `procesos.configurar` y `procesos.ver_todas` a los roles y cuentas que hoy tienen `proyectos.configurar` o `proyectos.ver_todas` respectivamente, y a «Administrador» y «Superusuario».

- **CA-6 · Avisos**
  - **Entonces:**
    - Los avisos de la campana de una solicitud de proceso enlazan a `/admin/institucional/procesos` y dicen «proceso», no «proyecto».
    - Los de proyecto siguen igual.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Datos + Backend | DEV-2 | Campo `categoria` en `TipoProyecto` (`proyecto`/`proceso`, por defecto `proyecto`, inmutable tras crear) y migración `proyectos/0003`, en la que todo lo existente queda como proyecto. Filtro por `categoria` en todos los endpoints, con numeración, textos y enlaces de aviso por categoría. Permisos `procesos.configurar` y `procesos.ver_todas` en el catálogo, migraciones en `permissions` y `roles` para concederlos, y resumen por categoría. Pruebas. |
| Web | DEV-4 | `proyectosService` con parámetro de categoría. `SolicitudProyectosPage` y `TiposProyectoPage` parametrizadas por categoría (textos y permisos), sin duplicar archivos. Rutas `institucional/procesos` y `institucional/procesos/tipos`. Grupo «Solicitudes» en el menú con los tres hijos y la insignia nueva `procesos_por_atender`. Pruebas. |

**Fuera de alcance:**
- Cambiar el flujo de permisos (licencias).
- Mover las solicitudes de compra del módulo Activos.
- Renombrar las tablas o modelos `*Proyecto`.

---

### 4. Contrato
Los endpoints existentes de `/api/v1/proyectos/` aceptan el parámetro de consulta `categoria` = `proyecto` (por defecto, si falta) o `proceso`. Cualquier otro valor da 400 `categoria`.

| Operación | Ruta | Acceso | Entrada | Salida | Errores |
|---|---|---|---|---|---|
| Tipos para solicitar | `GET tipos/?categoria=` | sesión | — | tipos activos de esa categoría | 400 categoría inválida |
| Plantilla de un tipo | `GET tipos/<id>/plantilla/?categoria=` | sesión | — | archivo | 404 si el tipo es de otra categoría |
| Configurar tipos | `GET/POST/PATCH/DELETE configuracion/tipos/?categoria=` | `proyectos.configurar` o `procesos.configurar`, según la categoría | igual que hoy; al crear, la categoría sale del parámetro | igual que hoy, más `categoria` | 403 sin el permiso de esa categoría; 404 si el tipo es de otra |
| Opciones | `GET opciones/?categoria=` | igual que hoy, con el permiso de la categoría | — | igual | — |
| Solicitudes | `GET/POST solicitudes/?categoria=`, acciones `solicitudes/<id>/…/?categoria=` | sesión; ver todas con `*.ver_todas` de la categoría | igual que hoy | igual, `numero` con PRY o PRC | 404 si la solicitud es de otra categoría |
| Resumen | `GET solicitudes/resumen/?categoria=` | sesión | — | `{por_atender, ...}` de esa categoría | — |

---

### 5. Decisiones Técnicas y Supuestos
- **Decisión del usuario (12/11/2026):**
  - «Solicitud de procesos» se crea como flujo nuevo y separado, con el mismo motor que proyectos.
  - Las tres solicitudes se agrupan bajo «Solicitudes» y cada una tiene su pantalla.
- **Un solo motor con `categoria`, no una app duplicada:**
  - Así comparten modelos, servicios, pantallas y pruebas, y una corrección futura llega a los dos.
  - La separación la garantiza el servidor, filtrando por la categoría del tipo.
- **Permisos propios para procesos.** Quien configura proyectos no configura procesos por defecto. La migración los concede a quien ya tiene los equivalentes de proyectos, para que nadie quede sin acceso. Se pueden quitar desde Roles.
- **DEV-4, `conPermiso` en `staticAdminMenu.js`.** El grupo «Solicitudes» no lleva permiso propio, porque proyectos y procesos son de todos. Ahora un grupo sin permiso propio cuenta solo por los hijos que piden uno. Sin este cambio, todo empleado habría figurado «con permiso» en el módulo Institucional para la pantalla 403 y para `InicioDelPanel`. Los demás grupos sin permiso no cambian. El Tech Lead lo aceptó.
- **DEV-2, diferencias de contrato:** (1) crear una solicitud con un tipo de la otra categoría da 400 en `tipo_proyecto`, igual que con un tipo inexistente; (2) el nombre de un tipo sigue siendo único por empresa entre las dos categorías (la restricción `tipo_proyecto_unico` no distingue la categoría); (3) `categoria` es de solo lectura: otra distinta en el cuerpo da 400; (4) los números PRC y PRY salen de la misma tabla, así que dentro de cada flujo puede haber saltos. Aceptadas por el Tech Lead.
- **Sin despliegue por ahora:** el usuario no tiene acceso a la red del servidor. El commit se suma a los despliegues pendientes, que llevan migraciones.

---

### 6. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES (solo observaciones menores; aún no desplegada).
- **Fecha de cierre:** 2026-11-12
- **QA-FUNC:** APROBADO CON OBSERVACIONES (6 de 6 criterios) · **QA-TECH:** APROBADO CON OBSERVACIONES (solo P3) · **QA-UX:** aprobado en ronda 2. En la ronda 1 había un hallazgo Alto, el estado vacío sin tipos; quedó corregido.
- **Criterios de aceptación:** CA-1 a CA-6 cumplidos. CA-3, sobre crear con un tipo de la otra categoría, responde 400 en `tipo_proyecto` en lugar de 404, como un tipo inexistente; diferencia aceptada.
- **Ajustes de la ronda 1:**
  - Estado vacío del primer día según el permiso de configurar, y «Nueva solicitud» oculta si no hay tipos.
  - Aviso a las insignias del menú tras cada acción.
  - Estado vacío de Tipos con su botón, y títulos de insignias que dicen de qué son.
  - Mensaje de 404 que orienta a la otra pantalla.
  - Mensaje de nombre repetido que dice si el tipo es de la otra categoría.
  - Descargas de procesos registradas como «Solicitud de procesos».
  - Export LOPDP con la sección «Solicitudes de procesos».
  - Ícono `clipboard-check` en los avisos.
  - Pruebas de escalar con `procesos.ver_todas` y de opciones por categoría.
- **Archivos principales:**
  - Backend: `backend/apps/proyectos/{categorias,models,serializers,services,views}.py`; migraciones proyectos 0003, permissions 0062 y roles 0048; `descargas/services.py`, `privacidad/mis_datos.py`, `notificaciones/modulos.py`, `core/modulos_auditoria.py`.
  - Frontend: `frontend/src/api/proyectosService.js`; `pages/Institucional/{SolicitudProyectosPage,TiposProyectoPage}.jsx` y `categoriasSolicitud.js`; `routes/AppRoutes.jsx`; `components/admin/AdminSidebar/{staticAdminMenu.js,AdminSidebar.jsx,AdminMenuItem.jsx}`.
- **Verificación ejecutada (Tech Lead, 12/11/2026):**
  - `makemigrations --check`: sin cambios.
  - `pytest` de proyectos, descargas, privacidad, notificaciones, permissions, roles, core, ausencias y licencias con `-n 4`: 712 passed.
  - vitest completo: 3168 passed. eslint y prettier, limpios sobre lo tocado. `vite build`: correcto. Estas tres verificaciones las corrió DEV-4.
- **Pendientes:**
  - (UX, Media-baja) El enlace «Abrir en Solicitud de …» del 404 puede rebotar entre las dos pantallas si la solicitud no existe o no hay acceso. Habría que marcar `&desde=` y, en el segundo 404, mostrar «No se encontró la solicitud o no tiene acceso a ella», además de quitar del texto el prefijo PRY/PRC.
  - (UX, Baja) «Nueva solicitud» aparece y desaparece mientras cargan los tipos el primer día. Habría que distinguir «cargando» de «falló».
  - (UX, Baja) Con `ver_todas` y sin tipos se ven dos mensajes vacíos a la vez. Lo de la cabecera del grupo que repite el total y el fallo silencioso del resumen ya venía así.
  - (QA-TECH P3, anterior) `get_solicitudes` hace un `count()` por tipo en la configuración.
  - Prueba manual en el navegador y despliegue con `-Migrar` (proyectos 0003, permissions 0062, roles 0048) cuando haya acceso a la red del servidor.
