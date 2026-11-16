# Historia de Usuario: US-023 - App móvil: registrar y editar activos

- **ID:** US-023
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-16
- **Sprint / Módulo:** App móvil «Intranet LCE» · Gestión de Activos (continúa la US-022)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (móvil). El backend no cambia: la app usa los endpoints de la web.

---

### 1. Definición de la Historia
- **Como:** persona con permiso para crear o editar activos.
- **Quiero:** registrar un activo nuevo cuando se adquiere y corregir la ficha de uno existente (un ajuste o información mal cargada) desde el teléfono.
- **Para:** no depender de un computador para mantener el inventario al día.

Pedido del usuario (16/11/2026): «la parte de editar activos debe estar activa… y también se pueden registrar nuevos activos cuando se adquieran». Los permisos son los mismos que en la web (regla del usuario): `activos.crear` para registrar (ruta web `activos/new`) y `activos.editar` para editar (`activos/:id/editar`).

---

### 2. Criterios de Aceptación (Gherkin / BDD)
- **CA-1 · Visibilidad:**
  - Con `activos.crear`, «Registrar activo» aparece en la app: en el Inventario y en el Panel, en lugar del botón redondo que hoy lo abre en el navegador.
  - Con `activos.editar`, «Editar» aparece en la ficha del activo, también en lugar del botón al navegador.
  - Sin el permiso, no se ofrece la acción.
  - Una ficha abierta desde un aviso de otra empresa no ofrece «Editar», igual que pasa hoy con asignar.
- **CA-2 · Registrar:**
  - El formulario replica el alta de la web (`frontend/src/pages/Admin/Activos/ActivoForm.jsx`): mismos campos, opciones, obligatorios y validaciones.
  - Envía `POST /activos/` con lo que acepta `ActivoWriteSerializer`.
  - Al guardar, abre la ficha del activo nuevo con su código de barras y lo anuncia.
- **CA-3 · Especificaciones por tipo:**
  - Al elegir el tipo de dispositivo, el formulario pide sus características declaradas, igual que la web.
  - Si se cambia el tipo, se avisa antes de perder lo escrito.
- **CA-4 · Editar:**
  - El mismo formulario, cargado con la ficha, envía `PATCH /activos/{id}/`.
  - No edita estado, responsables ni área, porque esos cambian con «Asignar» y «Cambiar estado». Aplica las mismas reglas que la web, por ejemplo no quitar «compartido» si el equipo tiene varios responsables.
  - Al guardar, la ficha se recarga.
- **CA-5 · Errores y red:**
  - Los 400 se muestran junto a su campo; los de campos que no se ven, arriba.
  - Hay candado contra el doble envío.
  - Se pregunta antes de descartar cambios: con `confirmarDescarte`, al salir y con el gesto de volver.
  - Tras «puede haberse guardado», se confirma antes de reenviar (`useReenvioConfirmado`).
- **CA-6 · Catálogos:**
  - Los catálogos son los de la web: tipos de dispositivo; sedes, proveedores y concesionarios activos; empleados para responsables y «solicitado por»; áreas.
  - Se piden con la empresa activa y respetan el máximo de 100 por página.
  - Si un catálogo exige un permiso que la persona no tiene, se explica, igual que la web.
- **CA-8 · Escanear el número de serie** (agregado el 16/11/2026, a propuesta de QA-UX H-15 y con el visto bueno del usuario):
  - Junto a «Número de serie» hay un botón de código de barras que abre la cámara en una ventana.
  - La cámara lee el código de la etiqueta del fabricante y lo escribe en el campo.
  - Si el teléfono no tiene la cámara disponible, el botón no aparece.
- **CA-7 · Accesibilidad y marca:** como en la US-022.
  - AA, áreas táctiles de 48 dp y etiquetas.
  - «(obligatorio)» dicho por el lector de pantalla.
  - Fechas con `SelectorFecha`, sin fechas futuras donde la web no las permite.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables |
|---|---|---|
| Móvil | DEV-1 | Formulario de alta y edición con sus rutas (p. ej. `/activos/nuevo` y `/activos/[id]/editar`); servicios `crear` y `actualizar` y los catálogos que falten en `activosService` u `organizacionService`; enganche en el Inventario, el Panel y la Ficha; pruebas Jest |

**Fuera de alcance:**
- Carga masiva e impresión de etiquetas, que siguen en el navegador.
- Tipos y categorías de dispositivo.
- Adjuntar la factura en el alta, salvo que la web lo haga en el mismo formulario.
- Cambios en el backend.

---

### 4. Contrato
| Operación | Ruta | Permiso |
|---|---|---|
| Registrar | `POST /activos/` | `activos.crear` |
| Editar | `PATCH /activos/{id}/` | `activos.editar` |
| Catálogos | los mismos que usa `ActivoForm.jsx` | los de cada endpoint |

Los campos son los de `ActivoWriteSerializer` (`backend/apps/activos/serializers.py`).

---

### 5. Decisiones Técnicas y Supuestos
- **Lo que se puede en la web, se puede en la app** (decisión del usuario, 16/11/2026): por eso «Editar» también se ofrece en los activos dados de baja, perdidos o robados, como en la web.
- **Mismos permisos y reglas que la web,** que es la fuente de verdad del formulario.
- **Al pasar a la app, «Registrar activo» y «Editar» dejan de ser botones al navegador.** El resto sigue en la web con `BotonRedondo`.

---

### 6. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-16
- **QA:** QA-FUNC, QA-TECH y QA-UX aprobaron con observaciones, sin P1. En una ronda se corrigieron:
  - de UX: H-01 a H-10, H-16 y, con el visto bueno del usuario, H-15 (escanear la serie, CA-8);
  - de QA-TECH: los P3 #1 a #5;
  - de QA-FUNC: B-2 y B-3.
- **Verificación:** `jest` da 31 suites y 882 pruebas en verde, y `expo export --platform android` compila. En el teléfono solo se vio que el formulario de alta abre; las fichas no se guardaron.
- **Corrección tras las pruebas con datos (16/11/2026):**
  - **Hallazgo grave:** la app no podía subir archivos. Expo 58 reemplaza el `fetch` global por `expo/fetch`, que rechaza los archivos `{uri, name, type}` de un `FormData` con el error «Unsupported FormDataPart implementation», antes de que la petición salga del teléfono.
  - **Afectaba a:** el respaldo de los permisos, los archivos del chat, los adjuntos de la Mesa de ayuda y los adjuntos de activos.
  - **Arreglo:** el cliente HTTP usa el `fetch` de React Native (`whatwg-fetch`, `src/api/fetchNativo.js`), que ahora es una dependencia declarada.
  - **Verificado en el teléfono contra producción:** se subió una imagen a un mantenimiento, apareció en la lista y se abrió en el visor. Los datos de prueba se borraron después.
  - **Probablemente relacionado:** también explicaría el «No se pudo conectar» intermitente que dieron los catálogos.
  - **También se corrigió** el texto «Tomar otra foto», que aparecía después de elegir un archivo.
- **Pendientes:**
  - ~~DEV-2: serie repetida da 500~~ **Resuelto** por la otra sesión (commit 24e42bd, desplegado el 16/11/2026): ahora es 400 en `numero_serie` («Ya hay un activo con ese número de serie en la empresa (CÓDIGO).»), sin distinguir mayúsculas, y el reintento por código de barras reconoce la restricción de SQL Server. Falta probarlo desde el teléfono.
  - Probar en el dispositivo:
    - un alta con un tipo que tenga características obligatorias;
    - escanear la serie;
    - editar una ficha con una sede inactiva;
    - el lector de pantalla al elegir o quitar personas.
  - UX H-11 y H-12 (`SelectorFecha` compartido) y H-14 (unificar los buscadores de empleados).
  - Los catálogos de más de 100 elementos solo muestran la primera página, igual que en la web.
