# Historia de Usuario: US-019 - App móvil · Fase 5: Matriz de obligaciones (Bandeja y Calendario)

- **ID:** US-019
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-13
- **Sprint / Módulo:** App móvil «Intranet LCE» · Matriz de obligaciones
- **Estado:** Pendiente (empieza cuando cierre US-016, porque usa su catálogo de módulos)
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1

---

### 1. Definición de la Historia
- **Como:** responsable de obligaciones en la Matriz de obligaciones.
- **Quiero:**
  - ver desde el teléfono el estado de mis obligaciones (incumplidas, en progreso, próximas a vencer y finalizadas) y su calendario;
  - abrir cada obligación y hacer los ajustes rápidos: editar el seguimiento, cambiar la fecha y reenviar el recordatorio.
- **Para:** estar al día de los vencimientos sin estar frente a la computadora.

**Decisiones del usuario (13/11/2026):**
- Es un módulo nuevo en las pestañas de arriba: **Matriz de obligaciones**, después de Mesa de ayuda.
- Sus funcionalidades abajo son **Bandeja** (por defecto) y **Calendario**.
- En el detalle, la app **solo** permite **Editar seguimiento**, **Cambiar fecha** y **Reenviar recordatorio**.
- Lo demás se hace en la web, y la app ofrece abrirlo en el navegador:
  - **Enviar a validación** y **Cargar evidencia**;
  - Validar y Devolver, Crear o editar obligaciones, Reportes, Documentos, Auditoría, Configuración e Importar.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Módulo visible solo con acceso**
  - **Dado que** la persona tiene acceso a la Matriz en la empresa activa (los mismos permisos `matriz.*` y la misma pertenencia que exige la web),
  - **entonces** aparece la pestaña «Matriz de obligaciones». Sin acceso, no aparece.
  - Si cambia de empresa, se vuelve a evaluar.

- **CA-2 · Bandeja (resumen)**
  - **Dado que** entra al módulo,
  - **entonces** ve la Bandeja con las mismas cifras de la web (`GET matriz/resumen/`), en tarjetas tocables: **Incumplidas**, **En progreso**, **Próximas a vencer** y **Finalizadas**.
  - Cada tarjeta lleva su color, ícono y texto, sin depender solo del color.

- **CA-3 · Filtrar por estado**
  - **Dado que** toca una tarjeta,
  - **entonces** ve la lista de obligaciones (períodos) de ese estado. Usa los mismos filtros que la web: `status=incumplido`, `en_progreso`, `en_progreso&sort=due` (próximas) y `finalizado`.
  - Cada fila muestra el nombre, la entidad o el área, el responsable, la fecha de vencimiento y el estado.
  - La lista tiene paginación o carga más, y se refresca al deslizar hacia abajo.
  - Muestra los estados de carga, error con «Reintentar» y vacío.

- **CA-4 · Detalle**
  - **Dado que** toca una obligación,
  - **entonces** ve su detalle, igual que el panel del período en la web:
    - los datos;
    - el seguimiento: responsables, prioridad, avance y observaciones;
    - la fecha de vencimiento;
    - el estado;
    - el historial;
    - los documentos o evidencias, solo para ver y abrir con el visor de la app, que borra los temporales al salir.

- **CA-5 · Acciones permitidas en la app**
  - Los botones **Editar seguimiento**, **Cambiar fecha** y **Reenviar recordatorio** aparecen **solo** si el servidor los ofrece en `acciones` (`edit`, `change_due_date`, `remind`).
  - Usan los mismos endpoints, validaciones y mensajes que la web.
  - Al terminar, el detalle y la Bandeja se actualizan y se anuncia el resultado.
  - Si falla por la red, se avisa de que puede que se haya guardado, como en el resto de la app.

- **CA-6 · Lo que no hace la app**
  - Si el servidor ofrece otras acciones (`submit`, `upload`, `validate`, `return`), la app **no** las ejecuta.
  - Muestra el aviso «Enviar a validación, cargar evidencia y validar se hacen en la web» con «Abrir en el navegador», que lleva a la obligación en la web con la empresa activa.

- **CA-7 · Calendario**
  - **Dado que** elige «Calendario»,
  - **entonces** ve el mes actual (`GET matriz/calendario/`, como en la web), con una marca en los días que tienen obligaciones o asuntos.
  - Se puede pasar al mes anterior y al siguiente.
  - Al tocar un día, ve la lista de ese día. Desde ahí entra al mismo detalle de CA-4, con las mismas acciones de CA-5.

- **CA-8 · Avisos y push**
  - Las notificaciones de la Matriz abren el detalle de la obligación en la app, y ya no la web.
  - Se actualiza `modulosEnApp`.

- **CA-9 · Accesibilidad y marca**
  - Calendario accesible: cada día dice su fecha y cuántas obligaciones tiene.
  - Contraste AA, áreas táctiles según el perfil y letra al 200 %.
  - Marca LAARCOURIER.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| App móvil (`mobile/`) | DEV-1 | Módulo «Matriz de obligaciones» en el catálogo de US-016, servicio de la API, pantallas de Bandeja, lista por estado, detalle, los 3 formularios de acción y calendario, ruta en avisos y push, y pruebas |

**Fuera de alcance:**
- Cambios en el backend.
- Enviar a validación, cargar evidencia, validar o devolver.
- Crear o editar obligaciones.
- Reportes, exportar, auditoría, configuración e importación.

Si la API no da algo que la app necesita, se reporta al Tech Lead (DEV-2) y no se inventa.

---

### 4. Contrato
Es la API existente `/api/v1/matriz/…`, en `backend/apps/matriz/urls.py`. Se usa la misma que consume la web, en `frontend/src/api/matrizService.js`:
- `resumen/`
- `obligaciones/`
- `periodos/` (filtros `status` y `sort`)
- `periodos/<id>/`, con `acciones`
- `periodos/<id>/historial/`
- `periodos/<id>/documentos/`
- `documentos/<id>/archivo/`
- `periodos/<id>/vencimiento/`
- edición del seguimiento: la misma llamada que hace `SeguimientoModal.jsx`
- `periodos/<id>/recordatorios/enviar/`
- `calendario/`
- `personas/` y `catalogos/`, para los campos del seguimiento

DEV-1 debe verificar cada llamada contra `views.py`, `serializers.py` y las pantallas web: `ResumenMatriz.jsx`, `MatrizObligacionesPage.jsx`, `PeriodoPanel.jsx`, `SeguimientoModal.jsx`, `CambiarFechaModal.jsx`, `RecordatoriosDelPeriodo.jsx` y `CalendarioMatriz.jsx`.

---

### 5. Decisiones Técnicas y Supuestos
- Los permisos y las acciones los decide el servidor (`acciones` del período). La app solo oculta lo que no va.
- La Matriz trabaja sobre la empresa activa (cabecera X-Empresa), como el resto de la app.
- La lista de «Próximas a vencer» usa el mismo criterio de la web: en progreso, ordenadas por vencimiento.

---

### 6. Registro de Cierre
*(Lo completa el Tech Lead al finalizar).*
