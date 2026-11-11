# Historia de Usuario: US-003 - Buscador y casillas Ver / Editar en los permisos de un dashboard

- **ID:** US-003
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-11
- **Sprint / Módulo:** Dashboards (`frontend/src/dashboards/pages/dashboards/DashboardsListPage.jsx`, ventana «Editar dashboard»)
- **Estado:** COMPLETADA
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-4

---

### 1. Definición de la Historia
- **Como:** administrador de un dashboard.
- **Quiero:** buscar por nombre el rol al que voy a dar acceso y marcar en una sola fila si puede **ver**, **editar** o ambas cosas.
- **Para:** no recorrer dos listas largas de roles repetidos y ver de un vistazo qué puede hacer cada uno.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Buscador**
  - **Dado que:** abro «Editar dashboard» → «Permisos de visualización y edición».
  - **Cuando:** escribo en el buscador «Buscar rol».
  - **Entonces:**
    - La lista muestra solo los roles cuyo nombre contiene el texto. No distingue mayúsculas, minúsculas ni tildes.
    - Si ninguno coincide, se ve «Ningún rol coincide con «…»».
    - Lo que ya está marcado no se pierde al filtrar.

- **CA-2 · Una fila por rol con dos casillas**
  - **Dado que:** veo la lista de roles.
  - **Entonces:**
    - Cada rol aparece una sola vez, con las casillas «Ver» y «Editar».
    - Al cargar, un rol lector aparece con «Ver» marcado.
    - Un rol editor aparece con «Ver» y «Editar» marcados.
    - Un rol sin acceso aparece sin ninguna marca.

- **CA-3 · Reglas al marcar**
  - **Cuando:** marco o desmarco las casillas.
  - **Entonces:**
    - Solo «Ver» marcado → el rol puede ver (lector).
    - «Editar» marcado → «Ver» se marca solo, porque editar exige ver. El rol puede ver y editar (editor).
    - Desmarco «Editar» → el rol queda solo con «Ver» (lector).
    - Desmarco «Ver» de un editor → se desmarcan las dos y el rol queda sin acceso.

- **CA-4 · Guardar sin cambio de contrato**
  - **Cuando:** guardo.
  - **Entonces:**
    - Se envían `roles_editores` (roles con «Editar») y `roles_lectores` (roles con solo «Ver») a la misma API de hoy.
    - Un rol nunca va en las dos listas.

- **CA-5 · Resumen y accesibilidad**
  - **Entonces:**
    - Sobre la lista se ve cuántos roles pueden ver y cuántos pueden editar.
    - Cada casilla tiene nombre accesible («Ver: Analista», «Editar: Analista»).
    - El buscador tiene etiqueta.
    - Las casillas miden 44 px en pantallas táctiles.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Web | DEV-4 | Sección de permisos de `DashboardsListPage.jsx`: buscador, tabla o lista de una fila por rol con casillas «Ver» y «Editar», reglas de CA-3, resumen. Pruebas en `src/dashboards/tests/DashboardsListPage.test.jsx`. |

**Fuera de alcance:** el backend y el contrato de acceso (no cambian), y la sección «Dueño del tablero».

---

### 4. Contrato
Sin cambios: se usa el mismo servicio de acceso del dashboard de hoy (`roles_editores` / `roles_lectores`, ids de rol).

---

### 5. Decisiones Técnicas y Supuestos
- El pedido habla de «nombre del permiso». En esta pantalla lo que recibe acceso son **roles**, así que el buscador filtra por nombre de rol.
- «Editar» sin «Ver» no existe en el modelo. Por eso marcar «Editar» marca «Ver», y quitar «Ver» quita las dos.
- El módulo `dashboards` tiene su propio estilo de código (comillas simples, sin punto y coma). Se respeta.

---

### 6. Registro de Cierre
- **Estado final:** COMPLETADA
- **Fecha de cierre:** 2026-11-11
- **QA-FUNC:** 🟡 Aprobado con observaciones (B1–B3 resueltas) · **QA-TECH:** 🟡 Aprobado con observaciones (ronda 2; la 1 rechazó por un P2, corregido) · **QA-UX:** 🟢 sin Críticos ni Altos en la ronda 2 (la 1 tuvo 1 Crítico y 3 Altos, corregidos)
- **Criterios de aceptación:** CA-1 ✅, CA-2 ✅, CA-3 ✅, CA-4 ✅, CA-5 ✅
- **Además (por las auditorías):** si falla la carga del acceso, «Guardar cambios» queda bloqueado y aparece «Reintentar» (antes podía grabar el acceso de otro dashboard); Enter en el buscador no envía y Escape limpia la búsqueda; «Editar (incluye ver)» con ayuda; resumen «Sin roles asignados: lo ve cualquiera con el permiso general de dashboards.»; la ventana se monta con estado nuevo por dashboard.
- **Archivos principales:** `frontend/src/dashboards/pages/dashboards/DashboardsListPage.jsx`, `frontend/src/dashboards/styles/identidad-dashboards.css`, `frontend/src/dashboards/tests/DashboardsListPage.test.jsx`
- **Verificación ejecutada:** `npx vitest run` → 195 archivos, 3006 passed; eslint sin errores nuevos (quedan 3 `jsx-a11y/no-autofocus` previos en «Crear/Editar/Eliminar dashboard»).
- **Pendientes:** sin comprobar en vivo a 375 px ni en tema oscuro (los auditores no pudieron entrar sin credenciales); la ventana de edición ya no anima al cerrarse (efecto de montarla con `key` por dashboard); los 3 `autoFocus` previos del módulo.
