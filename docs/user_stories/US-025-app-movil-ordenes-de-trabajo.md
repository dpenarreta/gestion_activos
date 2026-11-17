# Historia de Usuario: US-025 - App móvil: módulo Órdenes de trabajo

- **ID:** US-025
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-17
- **Sprint / Módulo:** App móvil «Intranet LCE» · Órdenes de trabajo (mantenimiento de sedes)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (móvil). El backend no cambia: la app usa los mismos endpoints que la web (`/api/v1/ordenes/`).

---

### 1. Definición de la Historia
- **Como:** persona que pide trabajos de mantenimiento en una sede, técnico interno o de un proveedor, coordinador o responsable de una sede.
- **Quiero:** desde el teléfono:
  - ver el panel de mantenimiento;
  - ver las órdenes activas que creé y las que tengo asignadas;
  - registrar órdenes nuevas;
  - mover cada orden por su flujo según mis permisos.
- **Para:** atender el trabajo en la sede misma, sin computador.

Decisiones del usuario (17/11/2026, por preguntas):
- **Lista:** se organiza en pestañas «Creadas por mí» y «Asignadas a mí». Solo muestra órdenes abiertas, y cada pestaña lleva su contador.
- **Ficha:** cubre todo el flujo, igual que la web y según el permiso de cada persona: asignar o reasignar, programar, iniciar, pausar, registrar y quitar materiales y horas, enviar a aprobación, y aceptar o devolver el trabajo.
- **Nueva orden:** igual que la web, con quién la realiza, la fecha programada y el registro rápido de un proveedor nuevo.
- **Permisos:** son los mismos de la web (memoria «Permisos app = web»). En la app no existe nada propio, ni más ni menos.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

**Navegación**
- **CA-1 · Módulo visible por permisos:**
  - **Dado que** tengo `ordenes.ver` en la empresa activa
  - **Cuando** abro la app
  - **Entonces** veo la pestaña de módulo «Órdenes de trabajo» a la derecha de las existentes (convención de US-016). Su barra de funcionalidades tiene: Panel · Mis órdenes · Nueva orden.
  - «Nueva orden» solo aparece con `ordenes.crear`. Sin `ordenes.ver`, el módulo no aparece.
- **CA-2 · Módulo apagado o sin permiso:** si el servidor responde 403 (`modulo_apagado` o falta de permiso), la pantalla lo dice con un mensaje claro, como en Activos y en la Mesa de ayuda.

**Panel de mantenimiento**
- **CA-3 · Indicadores:**
  - Se cargan con `GET /ordenes/resumen/`.
  - Se muestra el alcance (`alcance`) y las tarjetas de `kpis`: registradas, abiertas, vencidas, cerradas, prioridad alta, pendientes de aprobación, con observaciones y costo total (en USD, con formato local).
  - Las tarjetas de abiertas y de vencidas destacan.
  - Los colores nunca son la única señal: cada tarjeta lleva texto o ícono.
- **CA-4 · «Requieren atención»:**
  - Es la lista `atencion` (críticas, altas y vencidas).
  - Cada fila muestra el número, la sede, la prioridad, el estado y el cumplimiento, y abre la ficha.
  - Si está vacía, dice «Nada pendiente en su alcance».
- **CA-5 · «Actividad reciente»:** es la lista `actividad`. Cada fila muestra la descripción, quién la hizo y la fecha, y al tocarla abre la ficha de `orden.id`.
- **CA-6 · Estados:** hay estado de carga, error con «Reintentar» y deslizar para actualizar.

**Mis órdenes**
- **CA-7 · Pestañas:**
  - «Creadas por mí» carga `GET /ordenes/?ambito=mias&abiertas=true`.
  - «Asignadas a mí» carga `GET /ordenes/?ambito=asignadas&abiertas=true`.
  - Cada pestaña muestra su contador (`count`) y pagina con «cargar más».
  - Hay búsqueda `q` (número, título, sede o responsable) con una espera de 400 ms.
  - «Asignadas a mí» se muestra siempre: si la persona no ejecuta órdenes, sale vacía con un mensaje que lo explica.
- **CA-8 · Fila:** cada fila muestra:
  - el número `OT-AAAA-NNNNNN`, el título y la sede;
  - la prioridad y el estado, con texto y no solo con color;
  - el cumplimiento (vencida, en plazo o sin fecha) y la fecha programada;
  - el responsable.
  Al tocar la fila se abre la ficha.

**Ficha**
- **CA-9 · Detalle:**
  - Se carga con `GET /ordenes/{id}/`.
  - Muestra los datos de la orden: categoría, prioridad, estado, sede, solicitante, contacto, responsable, fecha programada, descripción y cierre con observaciones.
  - El teléfono se muestra tal como lo envía el servidor, enmascarado sin `ordenes.ver_contacto`.
  - Muestra materiales, mano de obra y costos (subtotal, IVA y total).
  - Muestra el historial (`movimientos`), con actor, fecha y nota.
- **CA-10 · Botones según el servidor:**
  - Los cambios de estado se pintan con `permisos.acciones`, un botón por estado destino, con el verbo de la web: Programar, Iniciar, Pausar, Reanudar, Enviar a aprobación, Aceptar y cerrar, y Devolver a ejecución.
  - No se ofrece ningún paso que el servidor no permita.
  - Cada cambio envía `POST /ordenes/{id}/cambiar-estado/` con una `nota` opcional:
    - «Programar» pide la `fecha_programada`;
    - «Cerrar» permite marcar `con_observaciones` con su nota;
    - «Devolver» exige una nota.
  - Al guardar, la ficha se recarga y se anuncia el resultado.
- **CA-11 · Asignar o reasignar** (cuando `permisos.gestionar`, o el `puede.gestionar` de catálogos, lo permite):
  - El formulario busca a la persona o al proveedor en `GET /ordenes/responsables/?q=` y pide la fecha y una nota.
  - Envía `POST /ordenes/{id}/asignar/`. Los errores 400 aparecen junto a su campo.
- **CA-12 · Materiales y horas** (cuando `permisos.registrar_costos`):
  - Para agregar se usa `POST /ordenes/{id}/materiales/` (descripción, cantidad y costo unitario) o `POST /ordenes/{id}/mano-de-obra/` (descripción, horas y costo por hora).
  - Para quitar se usa `DELETE /ordenes/{id}/costos/{materiales|mano-de-obra}/{fila_id}/`, con confirmación.
  - Los números aceptan coma o punto decimal.
- **CA-13 · Corregir** (cuando `permisos.editar`): permite editar título, descripción, categoría, prioridad, sede y teléfono con `PATCH /ordenes/{id}/`.

**Nueva orden**
- **CA-14 · Formulario** (con `ordenes.crear`):
  - Pide sede, categoría, prioridad, título y descripción, todos de `GET /ordenes/catalogos/`.
  - Pide un teléfono de contacto opcional, de 7 a 15 dígitos.
  - Pide quién la realiza (una persona, un proveedor o ambos) desde `GET /ordenes/responsables/?q=`, y la fecha programada (obligatoria, de hoy en adelante).
  - Envía `POST /ordenes/`. Al crear, abre la ficha de la orden nueva y anuncia su número.
  - Los errores 400 aparecen junto a su campo, incluido `responsable`.
- **CA-15 · Proveedor nuevo:**
  - Si el proveedor no existe, «Registrar proveedor» envía `POST /ordenes/proveedores/` con nombre, contacto, teléfono o correo (uno de los dos es obligatorio) e identificación.
  - El proveedor creado queda elegido en el formulario.
- **CA-16 · Robustez del formulario:**
  - Hay protección contra el doble envío (`useCandado`).
  - Al salir con cambios, se pide confirmación (`useSalirConCambios`).
  - Se reutilizan los patrones de US-022 y US-023.

**Lo demás en la web**
- **CA-17 · Reportes y exportación:** los reportes y la exportación, con `ordenes.reportes`, se abren en el navegador con un `BotonRedondo` y confirmación de salida (regla del 16/11/2026).

---

### 3. Alcance por capa
- **Backend:** sin cambios.
- **Móvil:**
  - el servicio `ordenesService` en `src/api/servicios.js`;
  - las rutas `src/app/(app)/ordenes/...`;
  - las pantallas `src/pantallas/ordenes/...`;
  - el formato y la lógica pura en `src/ordenes/...`;
  - el módulo y las vistas en `src/navegacion/modulos.js`;
  - las pruebas en `__tests__/`.
- **Web:** sin cambios.

### 4. Contrato
Endpoints de `backend/apps/ordenes/views.py`:
- `GET ""`: lista, con `ambito`, `abiertas`, `estado`, `prioridad`, `q` y paginación.
- `GET {id}/`: detalle.
- `POST ""`: crear.
- `PATCH {id}/`: corregir.
- `POST {id}/asignar/`.
- `POST {id}/cambiar-estado/`: `estado`, `nota`, `fecha_programada` y `con_observaciones`.
- `POST {id}/materiales/` y `POST {id}/mano-de-obra/`.
- `DELETE {id}/costos/{tipo}/{fila_id}/`.
- `GET resumen/`.
- `GET catalogos/`: sedes, categorías, prioridades, estados, `puede` y `alcance`, más técnicos y proveedores si la persona gestiona.
- `GET responsables/?q=`.
- `POST proveedores/`.

### 5. Decisiones Técnicas y Supuestos
- Las transiciones de estado vienen del servidor (`permisos.acciones`). La app no las calcula, para no ofrecer pasos que se rechazarían.
- «Asignadas a mí» depende de `tecnico = usuario`. Las órdenes que están solo a cargo de un proveedor no aparecen ahí, igual que en la web.
- La pestaña del módulo se llama «Órdenes de trabajo», igual que el catálogo de permisos.
- (Tech Lead, 17/11/2026, tras el informe de DEV-1) «Asignar» toma técnicos y proveedores de `GET /ordenes/catalogos/`, no de `responsables/`: este exige `ordenes.crear`, que un coordinador puede no tener, y la web también usa el catálogo. Corrige el CA-11.
- El permiso del detalle se llama `permisos.asignar`. «Asignar» solo se ofrece en solicitada, asignada, programada o pausada, la misma regla que `OrdenService.asignar`. En ejecución o pendiente de aprobación, la ficha avisa «Para reasignarla, páusela antes».
- Las acciones de la ficha solo se ofrecen si la orden es de la empresa activa, igual que en Activos.
- Además de «Reportes», hay un botón redondo «Listado completo» al navegador, para ver las cerradas y usar los filtros de la web.
- Los avisos y los push de órdenes (`/admin/ordenes/lista/ID`) abren la ficha en la app (`MODULOS_EN_APP`).

---

### 6. Registro de Cierre
- **Fecha:** 2026-11-17.
- **QA:** QA-FUNC 🟢 con observaciones (17 de 17 criterios), QA-TECH 🟢 con observaciones (sin P1 ni P2, 9 P3) y QA-UX móvil 🟢 con observaciones (3 P2 y 11 P3). Se corrigieron en una sola ronda los 3 P2 de UX, todos los P3 de QA-TECH y O-1, O-2, O-4 y O-5 de QA-FUNC.
- **Prueba en el teléfono (dev client contra producción):**
  - Se recorrió el flujo completo: crear una orden registrando un proveedor nuevo, iniciar, agregar y quitar un material, enviar a aprobación y aceptar con observaciones (sin observaciones no deja cerrar).
  - Se revisaron «Mis órdenes» con su contador y el panel con su actividad.
  - Lo que salió en el teléfono y se corrigió:
    - los costos en cero mostraban «—»;
    - la cifra destacada salía sin negrita;
    - el aviso decía «Nota» en lugar de «Observaciones» y no se iba al corregir;
    - se repetía «Cerrada» en la cabecera.
  - Los datos de prueba (la orden, su historial y el proveedor) se borraron. No se generó ningún aviso.
- **Verificación:** `npx jest` 35 suites y 997 pruebas en verde; `npx expo export --platform android` compila.
- **Pendientes:**
  - Probar con perfiles reales (técnico con `ejecutar`, responsable de sede con `aceptar`, coordinador sin `crear`) y un push real de `ordenes.asignada` y `ordenes.creada`.
  - QA-FUNC O-3: un subtotal enorme da 500 en el backend después de guardar (igual en la web). Es del backend, fuera de esta historia.
  - QA-TECH: mover las piezas compartidas con Activos a `src/compartido/`.
  - Sin clave de idempotencia en el alta: es el patrón aceptado en la US-022.
  - Un superusuario sin `ordenes.ejecutar` no aparece en el buscador de «Quién la realiza» (igual que la web).
