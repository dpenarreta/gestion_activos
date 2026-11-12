# Historia de Usuario: US-012 - Cancelar vacaciones aprobadas desde «Mis vacaciones»

- **ID:** US-012
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-12
- **Sprint / Módulo:** Institucional › Mis vacaciones y Solicitud de permisos (`backend/apps/licencias`, `frontend/src/pages/Institucional/MisVacacionesPage.jsx`)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-2 (incluye las migraciones de permisos), DEV-4

---

### 1. Definición de la Historia
- **Como:**
  - una persona con vacaciones aprobadas;
  - Gestión Humana, que administra las vacaciones de todos.
- **Quiero:** cancelar unas vacaciones ya aprobadas con un botón en «Mis vacaciones».
- **Para:** que, si los planes cambian, las vacaciones se anulen y los días vuelvan a quedar disponibles cuando corresponda, con constancia del motivo y aviso al jefe.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Botón en las vacaciones aprobadas**
  - **Dado que:** tengo vacaciones aprobadas.
  - **Cuando:** abro «Mis vacaciones».
  - **Entonces:**
    - Veo una sección «Vacaciones aprobadas» con cada solicitud aprobada que aún no se cancela: fechas, días y estado temporal («Por empezar», «En curso» o «Terminadas»).
    - Cada solicitud tiene el botón «Cancelar vacaciones» cuando puedo cancelarla (CA-2 a CA-4).
    - Gestión Humana, al ver las vacaciones de otra persona, ve el mismo botón si tiene el permiso.

- **CA-2 · Antes de empezar**
  - **Dado que:** las vacaciones aprobadas aún no comienzan (`desde` es posterior a hoy).
  - **Cuando:** las cancelo, siendo la persona o Gestión Humana.
  - **Entonces:**
    - Se pide un motivo, que es obligatorio.
    - La solicitud queda cancelada y se devuelven todos sus días.
    - Se borran sus ausencias.
    - Se avisa en la campana al jefe inmediato de la persona y a la persona, si canceló Gestión Humana.

- **CA-3 · Ya empezadas o terminadas: justificar y decidir los días**
  - **Dado que:** las vacaciones ya comenzaron (en curso) o ya terminaron.
  - **Cuando:** se cancelan.
  - **Entonces:**
    - Se exige una justificación, que es obligatoria y queda en el historial.
    - Se elige qué pasa con los días:
      - **Devolver los días que faltan**, solo si están en curso: se devuelven los días desde hoy y lo ya gozado sigue contando.
      - **Devolver todos los días.**
      - **No devolver días.**
    - Se avisa al jefe inmediato, a la persona y a quienes la aprobaron.

- **CA-4 · Quién puede cancelar**
  - **Entonces:**
    - **La persona** cancela las suyas si tiene el permiso nuevo `licencias.cancelar_aprobadas_propias`, «Cancelar sus vacaciones o permisos ya aprobados». Lo tiene todo cargo por `PERMISOS_BASE` y se puede quitar a un rol.
      - Antes de empezar, como en CA-2.
      - En curso, solo puede «Devolver los días que faltan».
      - Terminadas, no puede: solo las cancela Gestión Humana.
    - **Gestión Humana**, con el permiso existente `licencias.anular_aprobadas`, cancela las de cualquiera en cualquier momento y con cualquiera de las tres opciones.
    - Sin permiso, la API responde 403 y la pantalla no muestra el botón.

- **CA-5 · Consistencia**
  - **Entonces:**
    - Lo cancelado deja de contarse en los días gozados y el saldo se recalcula según la opción elegida.
    - La acción queda en el historial de la solicitud con quién, cuándo, el motivo y la opción.
    - Si la solicitud ya estaba cancelada o se cancela dos veces a la vez, no se duplica: responde 400 «La solicitud ya está cerrada».

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Backend | DEV-2 | Ampliar `licencias.services.cancelar` y `_cancelar_aprobada` con el momento (por empezar, en curso o terminada) y la opción de días (`todos`, `restantes` o `ninguno`); la devolución parcial de los días que faltan (`restricciones`), y los avisos al jefe inmediato (`jefes_de`), a la persona y a quienes aprobaron. Permiso `licencias.cancelar_aprobadas_propias` con su migración de catálogo, su migración de roles y su entrada en `PERMISOS_BASE`. Datos que necesita la pantalla: las aprobadas del período, con `puede_cancelar`, el momento y las opciones permitidas. Pruebas. |
| Web | DEV-4 | Sección «Vacaciones aprobadas» en `MisVacacionesPage.jsx` (también al ver a otra persona con `vacaciones.ver_todas`). Botón «Cancelar vacaciones» y una ventana con el motivo o la justificación y, cuando corresponde, la elección de qué pasa con los días. Recarga, mensajes y aviso a las insignias. Ajustar el detalle en `SolicitudPermisosPage.jsx` para que use las mismas reglas y opciones. Pruebas. |

**Fuera de alcance:** cambiar las fechas de unas vacaciones aprobadas (eso sería cancelar y volver a pedir); cancelar otros tipos de permiso desde «Mis vacaciones».

---

### 4. Contrato (confirmado por DEV-2 el 12/11/2026)
- `POST /api/v1/licencias/solicitudes/<id>/cancelar/` con cuerpo `{comentario, devolver}`, donde `devolver` es `todos`, `restantes` o `ninguno` (opcional, admite `null` o vacío).
  - Antes de empezar se ignora `devolver`: siempre se devuelven todos los días.
  - En una aprobada, sin `comentario` (o solo espacios), 400 en `comentario`. En una pendiente sigue siendo opcional.
  - En curso o terminada, sin `devolver` o con una opción no permitida para quien cancela o para el momento, 400 en `devolver` (el mensaje nombra las opciones permitidas). Un valor que no es ninguna de las tres, también 400 en `devolver`.
  - Sin permiso, 403 (queda en auditoría como `access_denied`, con el permiso que faltó). La solicitud que no se ve, 404.
  - Ya cancelada, rechazada o cancelada a la vez por otro: 400 `{"error": {"code": "solicitud_cerrada", "message": "La solicitud ya está cerrada.", "details": null}}`.
  - Un permiso que no descuenta vacaciones (médico, sueldo…): `opciones_devolver` siempre `[]`, `dias_por_opcion` `null` y `devolver` se ignora. Quién y cuándo, igual que en las vacaciones (la persona no cancela uno terminado). Ausencias: Gestión Humana borra todas; la persona, por empezar, todas, y en curso, desde hoy.
  - Respuesta 200: el detalle de la solicitud, como hoy.
- En «Mis vacaciones» (`GET /api/v1/organizacion/vacaciones/mias/`) y en el de otra persona (`GET /api/v1/organizacion/vacaciones/?usuario=<id>`), una lista `aprobadas: [{id, desde, hasta, dias, momento: "por_empezar"|"en_curso"|"terminada", puede_cancelar, opciones_devolver: [...], dias_por_opcion: {restantes, todos, ninguno}}]`, ordenada por `desde`. Solo las aprobadas sin cancelar que se descuentan de vacaciones y cuyo `hasta` es de hace 365 días o menos (decisión del Tech Lead, 12/11/2026; `services.DIAS_DE_APROBADAS_TERMINADAS`).
  - `opciones_devolver` vacía con `puede_cancelar: true` significa «por empezar»: no se elige, se devuelven todos los días.
  - `dias_por_opcion` son los días de vacaciones que vuelven con cada opción (para el texto de la confirmación).
- El detalle de la solicitud expone `momento` (o `null` si no está aprobada) y `dias_por_opcion` (o `null`); `puedo` trae `cancelar`, `cancelar_pide_comentario` (toda aprobada que puede cancelar) y `opciones_devolver`, con las mismas reglas.
- Opciones por quien cancela:

| Momento | La persona (`cancelar_aprobadas_propias`) | Gestión Humana (`anular_aprobadas`), en las de otra persona |
|---|---|---|
| `por_empezar` | Sí, `[]` (todo) | Sí, `[]` (todo) |
| `en_curso` | `["restantes"]` | `["restantes", "todos", "ninguno"]` |
| `terminada` | No | `["todos", "ninguno"]` |

- **Diferencias con lo propuesto:**
  - En sus propias solicitudes, Gestión Humana tiene las reglas de la persona: nadie decide sobre sus propios días, igual que nadie aprueba su propia solicitud.
  - `puede_cancelar` en «Mis vacaciones» exige también ver la solicitud (`licencias.ver_todas` o haber intervenido): si no, la API respondería 404.
  - Se añaden `dias_por_opcion` y `momento` en el detalle.
- **Ausencias:** las de hoy en adelante se borran siempre; las pasadas solo con `todos`. Con `restantes` y `ninguno` las pasadas se quedan (la persona faltó esos días).

---

### 5. Decisiones Técnicas y Supuestos
- **Decisiones del usuario (12/11/2026):**
  - Pueden cancelar la persona y Gestión Humana.
  - Antes de empezar se avisa al jefe y a la persona.
  - En curso o terminadas, hay que justificar y decidir si se devuelven los días.
  - El motivo es obligatorio y se avisa.
- **Supuestos del Tech Lead:**
  - La persona no puede recuperar días ya gozados (solo «los que faltan» en curso, y nada si terminaron). Devolver días gozados es una decisión de Gestión Humana con su permiso.
  - «Jefe» es el jefe inmediato del organigrama (`jefes_de`).
- **Regla del usuario:** todo lo nuevo nace con su permiso. Por eso existe `licencias.cancelar_aprobadas_propias`.
- **Decisiones de DEV-2 aceptadas por el Tech Lead:**
  - En sus propias solicitudes, Gestión Humana sigue las reglas de la persona: nadie decide sobre sus propios días.
  - `puede_cancelar` exige además poder ver la solicitud.
  - Se añaden `momento` y `dias_por_opcion`.
  - A una solicitud pendiente ya cerrada se responde 400 «ya está cerrada».
  - Con la solicitud en curso o terminada, Gestión Humana debe enviar `devolver`.
  - Las ausencias desde hoy se borran siempre; las pasadas, solo con «todos».
- **Coordinación:** otra sesión trabaja en la app móvil (US-009/US-010, con permisos y vacaciones en el móvil) y tiene cambios sin commit en `backend/apps/notificaciones`, `authentication`, `config` y `privacidad/mis_datos.py`. Esta historia no toca esos archivos. Al hacer el commit se incluyen solo los archivos de US-012.

---

### 6. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES (solo observaciones menores).
- **Fecha de cierre:** 2026-11-12
- **QA-FUNC:** ronda 2 BLOQUEADO por N1 (permisos sin descuento con la ventana de vacaciones), corregido en la ronda 2 de DEV-2 y DEV-4. El Tech Lead lo verificó porque se alcanzó el límite de rondas.
- **QA-TECH:** APROBADO CON OBSERVACIONES en la ronda 2: los dos P2 de la ronda 1 (consultas por solicitud y foco del error de los radios) quedaron cerrados.
- **QA-UX:** los cinco Altos de la ronda 1 quedaron resueltos. El Alto nuevo de la ronda 2 (el mismo N1) y el Medio «ya cerrada» se corrigieron en la ronda 2 y los verificó el Tech Lead.
- **Criterios de aceptación:** CA-1 a CA-5 cumplidos en vacaciones. Los permisos que no descuentan vacaciones se cancelan sin elegir días: Gestión Humana quita todas las ausencias y la persona, en curso, las de hoy en adelante (decisión del Tech Lead).
- **Archivos principales:**
  - Backend: `backend/apps/licencias/{services,restricciones,serializers,views}.py`, `ausencias/services.py`, `organizacion/{views,roles_de_cargo}.py`, `permissions/catalog.py`; migraciones permissions 0064 y roles 0050; `licencias/tests/test_cancelar_aprobadas.py`.
  - Frontend: `frontend/src/pages/Institucional/{CancelarVacaciones,MisVacacionesPage,SolicitudPermisosPage}.jsx`, `Institucional.css`, `components/common/ModalDialog/ModalDialog.jsx`, `hooks/useModalA11y.js` y `api/licenciasService.js`.
- **Verificación ejecutada (Tech Lead, 12/11/2026):** `makemigrations --check` sin cambios; `pytest` de licencias, ausencias, organizacion, roles y permissions con `-n 4`: 543 passed. DEV-4 corrió vitest completo (3200 passed), eslint y prettier sobre lo tocado y `vite build`, todo correcto.
- **Pendientes:**
  - (QA-TECH P3) El 403 de la persona sin el permiso propio sobre una terminada se audita con `cancelar_aprobadas_propias`, y también podría ser `anular_aprobadas`.
  - (QA-FUNC) Las ausencias pasadas que se conservan quedan ligadas a una solicitud cancelada y no se pueden corregir desde Ausencias (409).
  - La app móvil (US-010) debe enviar `devolver` al cancelar vacaciones aprobadas en curso o terminadas.
  - Falta la prueba manual en el navegador tras desplegar.
