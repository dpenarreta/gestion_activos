# Historia de Usuario: US-006 - Responsable y fecha programada obligatorios al crear una orden de trabajo

- **ID:** US-006
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-11
- **Sprint / Módulo:** Órdenes de trabajo (`backend/apps/ordenes`, `frontend/src/pages/Ordenes/OrdenForm.jsx`)
- **Estado:** COMPLETADA
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-2, DEV-4

---

### 1. Definición de la Historia
- **Como:** persona que crea una orden de trabajo.
- **Quiero:** indicar al crearla quién la realiza (un proveedor o una persona) y la fecha en que debe cumplirse.
- **Para:** que cada orden nazca con un responsable y un compromiso de fecha, sin esperar a que se asigne después.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Responsable obligatorio**
  - **Dado que:** estoy creando una orden de trabajo.
  - **Cuando:** intento guardarla sin indicar quién la realiza.
  - **Entonces:**
    - No se guarda.
    - Junto al campo aparece «Indique el proveedor o la persona que realizará la orden».
    - El servidor también lo exige (400 `responsable`).

- **CA-2 · Elegir de lo que existe**
  - **Dado que:** estoy en el campo «Quién la realiza».
  - **Cuando:** escribo parte de un nombre.
  - **Entonces:**
    - Veo, en dos grupos, los **proveedores** del catálogo y las **personas** con cuenta que pueden atender órdenes (técnicos).
    - Elijo uno.
    - Si elijo una persona de un proveedor, la orden guarda las dos cosas (`tecnico` y `proveedor`), igual que la asignación de hoy.

- **CA-3 · Crearlo desde ahí si no existe**
  - **Dado que:** el proveedor o la persona no aparece.
  - **Cuando:** pulso «Registrar proveedor nuevo».
  - **Entonces:**
    - Se abre una ventana corta con los datos mínimos del proveedor (nombre o razón social, y contacto).
    - Al guardarla, el proveedor queda en el catálogo y seleccionado en la orden.
    - Un técnico independiente sin cuenta se registra como proveedor a su nombre.

- **CA-4 · Fecha programada obligatoria**
  - **Cuando:** creo la orden.
  - **Entonces:**
    - «Fecha programada» es obligatoria y debe ser hoy o una fecha posterior.
    - Si falta o ya pasó, aparece un error junto al campo (400 `fecha_programada`).

- **CA-5 · El resto del flujo no cambia**
  - **Entonces:**
    - La orden se crea con el responsable y la fecha.
    - Se avisa al responsable como cuando se asigna hoy, si tiene cuenta.
    - Queda el movimiento en el historial.
    - Reasignar o reprogramar después sigue funcionando como hoy, con sus permisos.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Backend | DEV-2 | Serializer y servicio de creación: `tecnico` y/o `proveedor` (al menos uno) y `fecha_programada` (≥ hoy) obligatorios. Al crear con responsable, el estado y el aviso son los mismos que al asignar. Endpoint para buscar responsables (proveedores + personas que pueden atender) y creación de proveedor con los datos mínimos, si no hay uno ya usable por quien crea órdenes. Pruebas. |
| Web | DEV-4 | `OrdenForm.jsx`: campo «Quién la realiza» con búsqueda agrupada, «Registrar proveedor nuevo» en una ventana, y «Fecha programada» obligatoria con mínimo hoy. Errores junto al campo. Pruebas. |

**Fuera de alcance:** crear cuentas de usuario desde la orden; cambiar cómo se reasigna o reprograma una orden ya creada.

---

### 4. Decisiones Técnicas y Supuestos
- **Decisiones del usuario (11/11/2026):**
  - El responsable se elige de lo existente y, si no está, se crea desde ahí.
  - Es obligatorio para todos los que crean una orden.
  - La «fecha a cumplir» es la **fecha programada** que ya existe.
- **«Crearlo desde ahí» registra un proveedor**, no una cuenta de usuario. Dar acceso al sistema es tarea de administración, y quien hace la orden sin cuenta no registraría materiales ni horas. Una persona sin cuenta se registra como proveedor a su nombre.
- **Decisiones del Tech Lead tras el backend (11/11/2026):**
  - Se añade el aviso en la campana al técnico asignado, al crear y al reasignar. Antes la asignación no avisaba a nadie.
  - Quien pide la orden puede corregirla hasta que empieza el trabajo (estados solicitada, asignada o programada), porque ahora nace «programada».
  - El proveedor de una persona que se muestra en la búsqueda es una aproximación (el de su última orden con proveedor). La pantalla lo propone, pero se puede quitar o cambiar.
- No hay cambios de modelo: `tecnico`, `proveedor` y `fecha_programada` ya existen en `OrdenTrabajo`.

---

### 5. Registro de Cierre
- **Estado final:** COMPLETADA
- **Fecha de cierre:** 2026-11-11
- **QA-FUNC:** APROBADO · **QA-TECH:** APROBADO · **QA-UX:** APROBADO
- **Criterios de aceptación:** CA-1 a CA-5 cumplidos. Responsable (proveedor o persona) y fecha programada (hoy o posterior) obligatorios, con 400 `responsable` y `fecha_programada`. Búsqueda agrupada, «Registrar proveedor nuevo» en una ventana y aviso al técnico asignado.
- **Archivos principales:** `backend/apps/ordenes/{services,serializers,views}.py`, `apps/core/sensitive_data.py`, `tests/test_responsable_al_crear.py`; `frontend/src/pages/Ordenes/{OrdenForm,BuscadorDeResponsable,RegistrarProveedorDialog,OrdenDetalle}.jsx`, `components/common/ModalDialog/ModalDialog.jsx`.
- **Verificación ejecutada:** Verificación final del 11/11/2026, con nada más corriendo: `pytest` de las 18 apps tocadas con `-n 4`: 3958 passed, 8 skipped. `makemigrations --check`: sin cambios. `vitest run`: 3141 passed. `vite build`: correcto. eslint sobre los archivos tocados: limpio, salvo tres `autoFocus` que ya existían en dashboards.
- **Pendientes:** La identificación se enmascara también en el RUC de la empresa; se aceptó. La búsqueda ya no encuentra por cédula.
