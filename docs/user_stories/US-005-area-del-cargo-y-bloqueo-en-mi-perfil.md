# Historia de Usuario: US-005 - El área sale del cargo y queda bloqueada en «Mi perfil»

- **ID:** US-005
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-11
- **Sprint / Módulo:** Organización › Mi perfil y ventana de datos faltantes (AvisoPerfil)
- **Estado:** COMPLETADA
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-3, DEV-2, DEV-4

---

### 1. Definición de la Historia
- **Como:** colaborador que completa sus datos, y como Gestión Humana, que administra a las personas.
- **Quiero:** que al elegir mi cargo se me asigne el área de ese cargo, que pueda corregirla la primera vez que completo mis datos, y que después solo la cambie una persona autorizada.
- **Para:** que el área de cada persona sea coherente con su cargo en el organigrama y no la cambie cualquiera desde su perfil.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · El cargo propone el área**
  - **Dado que:** estoy en la ventana de datos faltantes o en «Mi perfil» y todavía no tengo área.
  - **Cuando:** elijo un cargo cuya unidad del organigrama está enlazada a un área (`UnidadOrganizacional.departamento`, buscando también en las unidades superiores si la suya no la tiene).
  - **Entonces:**
    - El campo «Área» se llena solo con esa área.
    - Una nota lo dice: «Área del cargo elegido».
    - Si el cargo no tiene área enlazada, el campo no cambia.

- **CA-2 · Modificable solo la primera vez**
  - **Dado que:** todavía no tengo área guardada (la primera vez que completo mis datos).
  - **Cuando:** cambio el área propuesta por otra activa de la empresa y guardo.
  - **Entonces:** se guarda la que elegí.

- **CA-3 · Bloqueada después**
  - **Dado que:** ya tengo un área guardada.
  - **Cuando:** abro «Mi perfil».
  - **Entonces:**
    - El área se muestra deshabilitada, con la nota «La cambia Gestión Humana o una persona autorizada».
    - Si se envía otra área desde fuera de la pantalla, el servidor la rechaza con un 400 en `area` y conserva la guardada.

- **CA-4 · La cambia una persona autorizada**
  - **Dado que:** tengo el permiso nuevo «Cambiar el área de una persona».
  - **Cuando:** cambio el área de alguien desde la pantalla de administración donde hoy se reasigna el cargo de una persona.
  - **Entonces:**
    - Se guarda.
    - Queda en la auditoría, con el área anterior, la nueva y quién la cambió.
    - Se sincronizan los roles del cargo como hoy.

- **CA-5 · Permiso**
  - **Entonces:**
    - Existe `organizacion.cambiar_area`, «Cambiar el área de una persona».
    - La migración lo da al rol «Administrador» (TI) y a los roles de Gestión Humana que hoy pueden asignar o cambiar cargos.
    - Sin el permiso, el cambio da 403.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Datos | DEV-3 | Permiso `organizacion.cambiar_area` en el catálogo y migraciones en `permissions` y `roles`, que dependen de las de US-004. |
| Backend | DEV-2 | Área del cargo (con herencia de la unidad superior) expuesta en el catálogo de cargos que usa «Mi perfil». En `contacto.guardar` / serializer: el área solo se fija si no había una, y si no es la misma devuelve 400 `area`. Endpoint o acción de administración para cambiarla con el permiso nuevo, con auditoría, en la pantalla donde hoy se reasigna el cargo. Pruebas. |
| Web | DEV-4 | En `FormularioMisDatos` (Mi perfil y AvisoPerfil): elegir un cargo llena el área. El área queda deshabilitada si ya existe, con su nota. Control para cambiar el área en la pantalla de administración. Pruebas. **Empieza cuando DEV-4 termine las pantallas de US-004**, que también tocan Mi perfil. |

**Fuera de alcance:** cambiar la agencia; recalcular el área de quien ya la tiene guardada.

---

### 4. Decisiones Técnicas y Supuestos
- **Decisiones del usuario (11/11/2026):** «rol» se refiere al **cargo** del organigrama, porque los roles de permisos no tienen área. Cambiar el área exige un **permiso nuevo**.
- **El área sale de la unidad del cargo** (`Cargo.unidad.departamento`). Si la unidad no tiene área enlazada, se usa la de la unidad superior más cercana.
- **Reparto:** la migración del permiso la hace DEV-2 junto con el backend. Es una migración trivial que sigue el patrón de US-004 (decisión del Tech Lead).
- **Mismo patrón que el cargo:** hoy el cargo «se elige una sola vez» y después lo cambia la administración. El área sigue esa misma regla.

---

### 5. Registro de Cierre
- **Estado final:** COMPLETADA
- **Fecha de cierre:** 2026-11-11
- **QA-FUNC:** CON OBSERVACIONES (aprobado) · **QA-TECH:** RECHAZADO en ronda 2 por un P2 (cumpleaños y aniversario guardaban la fila entera y podían devolver el área anterior). DEV-2 lo corrigió con `update_fields` y el Tech Lead verificó el arreglo, porque se alcanzó el límite de rondas · **QA-UX:** sin hallazgos Altos en ronda 2
- **Criterios de aceptación:** CA-1 a CA-5 cumplidos. El cargo propone el área, con herencia de la unidad superior. El área se fija la primera vez y después el servidor devuelve 400 `area`. `organizacion.cambiar_area` permite cambiarla desde Asignación de cargos, con motivo, auditoría y sincronización de roles. Sin el permiso da 403.
- **Archivos principales:** `backend/apps/organizacion/{areas,contacto,views,urls,permisos_por_cargo}.py`, migraciones permissions 0060 y roles 0046, `tests/test_area_del_cargo.py`; `frontend/src/pages/MisDatos/MisDatosPage.jsx`, `pages/Institucional/AsignacionCargos.jsx`.
- **Verificación ejecutada:** Verificación final del 11/11/2026, con nada más corriendo: `pytest` de las 18 apps tocadas con `-n 4`: 3958 passed, 8 skipped. `makemigrations --check`: sin cambios. `vitest run`: 3141 passed. `vite build`: correcto. eslint sobre los archivos tocados: limpio, salvo tres `autoFocus` que ya existían en dashboards.
- **Pendientes:** En la tabla de Asignación de cargos el cargo se sigue guardando al elegirlo, sin botón de confirmar. Es menor y queda para otra historia.
