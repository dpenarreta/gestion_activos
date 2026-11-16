# Historia de Usuario: US-022 - App móvil: módulo Gestión de Activos

- **ID:** US-022
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-16
- **Sprint / Módulo:** App móvil «Intranet LCE» · Gestión de Activos
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1 (móvil). El backend no cambia: la app usa los mismos endpoints que la web.

---

### 1. Definición de la Historia
- **Como:** persona de TI, de activos o cualquier empleado con permisos del módulo.
- **Quiero:** desde el teléfono ver el panel de activos, consultar el inventario, escanear el código QR de un equipo, registrar y cerrar mantenimientos con sus repuestos y adjuntos, asignar o cambiar el estado de un activo, y gestionar las solicitudes de equipos (las mías y las que recibo).
- **Para:** trabajar en el sitio, junto al equipo, sin sentarme en un computador.

Decisiones del usuario (16/11/2026, por preguntas):
- **Componentes:** ambas cosas. Al registrar un mantenimiento se eligen repuestos del catálogo y, si no existe, quien tiene `mantenimientos.componentes` lo crea ahí mismo.
- **Mantenimientos:** se registran y también se cierran (salida, solución y estado final).
- **Adjuntos:** sí, con la cámara o un archivo.
- **Inventario:** consulta, asignar y cambiar estado.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

**Navegación**
- **CA-1 · Módulo visible por permisos:**
  - **Dado que** tengo `activos.ver` en la empresa activa
  - **Cuando** abro la app
  - **Entonces** veo la pestaña «Gestión de Activos» a la derecha de las existentes (convención de US-016), con su barra de funcionalidades: Panel · Inventario · Escanear · Mantenimientos · Mis solicitudes · Recibidas.
  - Cada funcionalidad aparece solo si tengo su permiso: Mantenimientos con `mantenimientos.ver`, Mis solicitudes con `solicitudes.ver` (y «Nueva solicitud» con `solicitudes.crear`), y Recibidas con `solicitudes.ver` más `solicitudes.gestionar` o `solicitudes.administrar`. El servidor exige `solicitudes.ver` para toda lectura, igual que la web (corregido tras QA-FUNC B1, 16/11/2026).
  - Sin ningún permiso del módulo, la pestaña no aparece.
- **CA-2 · Módulo apagado o sin permiso:**
  - **Cuando** el servidor responde 403 con `modulo_apagado` o falta de permiso
  - **Entonces** la pantalla lo dice con un mensaje claro (como Mesa de ayuda y Matriz), sin error técnico.

**Panel**
- **CA-3 · KPIs:**
  - **Dado que** abro «Panel»
  - **Cuando** carga `GET /activos/dashboard/`
  - **Entonces** veo cuatro tarjetas destacadas:
    - Registrados: `activos.total`.
    - Asignados: `activos.en_uso`.
    - En almacén: `activos.disponibles + activos.en_bodega`.
    - En reparación: `activos.en_mantenimiento`.
  - Cada tarjeta abre el inventario filtrado: `estado=en_uso`, `almacenados=true` o `estado=en_mantenimiento`; «Registrados» lo abre sin filtro.
- **CA-4 · Sección de mantenimientos del panel:**
  - Muestra los del mes, el histórico y el costo del mes y acumulado (`mantenimientos.*`).
  - Muestra los fuera de operación: días e intervenciones abiertas y cerradas.
  - Muestra el top 5 de equipos más reparados, que abre su ficha.
  - Si hay alertas (garantías vencidas o por vencer, reemplazo recomendado, perdidos o robados, sin asignar más de 90 días), se muestran con su número, sin depender solo del color.
- **CA-5 · Estados:** al cargar, en vacío, con error (con «Reintentar») y al deslizar para actualizar.

**Inventario**
- **CA-6 · Lista:**
  - Usa `GET /activos/` paginado (20 por página, «cargar más» al final).
  - Tiene búsqueda `q` con espera de 400 ms.
  - Tiene filtro por estado en chips: Todos, Asignados, En almacén, En reparación y Fuera de inventario.
  - Cada fila muestra el código de barras, el nombre, el tipo, el estado (texto e ícono, no solo color), el responsable, el área y la sede.
- **CA-7 · Ficha:**
  - Usa `GET /activos/{id}/historial/`.
  - Muestra los datos del activo, la garantía, los responsables y el estado.
  - Muestra la bitácora: los mantenimientos (abiertos primero) y los movimientos, ambos con fecha y quién.
  - Muestra los costos.
- **CA-8 · Asignar** (con `activos.asignar`):
  - Desde la ficha, «Asignar» abre un formulario para elegir responsables (buscador de personas), área y sede, y escribir el motivo.
  - Envía `POST /activos/{id}/asignar/`.
  - Al guardar, la ficha se recarga y se anuncia el resultado.
  - Los errores 400 del servidor se muestran junto a su campo.
- **CA-9 · Cambiar estado** (con `activos.dar_baja`):
  - «Cambiar estado» ofrece los estados del modelo y envía `POST /activos/{id}/cambiar-estado/`.
  - Para dado de baja, perdido o robado, el motivo es obligatorio y se pide confirmación, porque saca el activo del inventario.
- **CA-10 · Lo demás en la web:**
  - Crear y editar un activo, imprimir etiquetas y lo que la app no hace se abre con un `BotonRedondo` al navegador, con confirmación (regla del 16/11/2026).

**Escanear**
- **CA-11 · Escanear QR o código de barras:**
  - **Dado que** abro «Escanear»
  - **Cuando** apunto la cámara a la etiqueta (QR o Code 128)
  - **Entonces** la app lee el texto y llama a `GET /activos/por-codigo/{codigo}/`.
  - Si lo encuentra, muestra un resumen con dos acciones: «Ver ficha» y «Registrar mantenimiento». Esta última solo aparece con `mantenimientos.registrar` y si el activo está operativo.
  - Si viene `advertencia_lector`, la muestra.
  - Lee un código a la vez: no vuelve a consultar mientras muestra el resultado.
- **CA-12 · Sin cámara o código no encontrado:**
  - Si no da permiso de cámara, se explica y se ofrece abrir los ajustes.
  - Siempre está «Escribir el código a mano», con el mismo endpoint.
  - Un 404 `activo_no_encontrado` muestra el mensaje del servidor y permite escanear otra vez.

**Mantenimientos (bitácora)**
- **CA-13 · Lista:**
  - Usa `GET /mantenimientos/`, con filtros abiertos/cerrados (`pendientes`), tipo y búsqueda.
  - Cada fila muestra el activo, el tipo, las fechas, los días fuera de operación y el costo.
  - Tocar una fila abre su detalle.
- **CA-14 · Registrar** (con `mantenimientos.registrar`):
  - Se entra desde la ficha, el escáner o la lista (eligiendo el activo).
  - Pide tipo (preventivo o correctivo), fecha de intervención (no futura), tipo de responsable y responsable, y descripción.
  - Opcionales: causa, diagnóstico, solución, fecha de salida, estado final, garantía usada y costo de mano de obra.
  - Envía `POST /mantenimientos/`. El activo pasa a «En reparación» si queda abierto.
  - Validaciones del servidor junto a su campo.
  - Al salir con cambios sin guardar, se pregunta (`confirmarDescarte`).
- **CA-15 · Repuestos:**
  - En el formulario se agregan líneas `componentes[]`: componente del catálogo (`GET /mantenimientos/componentes/`, con buscador), cantidad, costo unitario, número de serie nuevo y observaciones.
  - Con `mantenimientos.componentes`, si no está en el catálogo, «Crear componente» (`POST /mantenimientos/componentes/`: nombre, código, descripción, es crítico) lo crea y lo deja elegido.
- **CA-16 · Cerrar** (con `mantenimientos.editar`):
  - Un mantenimiento abierto (`fecha_salida` nula) tiene «Registrar salida», que pide fecha de salida, solución y estado final y envía un `PATCH /mantenimientos/{id}/`.
  - El activo vuelve a su estado anterior.
- **CA-17 · Adjuntos** (con `adjuntos.subir`):
  - En el detalle de un mantenimiento, «Adjuntar» toma una foto, elige una imagen o elige un archivo (PDF, imagen, Word o Excel, hasta 10 MB) con su tipo (foto, informe técnico, factura, cotización, evidencia de daño…).
  - Se envía en multipart a `POST /adjuntos/` con `activo` y `mantenimiento`.
  - Los adjuntos se listan (con `adjuntos.ver`) y se abren con el visor interno o el sistema.
  - Los temporales se borran al salir (LOPDP, como el chat).

**Solicitudes**
- **CA-18 · Mis solicitudes:**
  - Usa `GET /solicitudes/?ambito=mias`, con un filtro abiertas/todas y búsqueda.
  - Cada fila muestra qué pidió, el estado (texto e ícono), la prioridad, el encargado y la fecha.
  - El detalle muestra el historial (`movimientos[]`).
  - Mientras esté pendiente o en gestión (lo que permite el servidor), puedo cancelarla con confirmación (aclarado tras QA-FUNC O4).
- **CA-19 · Nueva solicitud** (con `solicitudes.crear`):
  - Pide clase (dispositivo o componente), luego el tipo o componente del catálogo (`GET /solicitudes/catalogo/`) o un detalle libre (máx. 200).
  - Pide también especificaciones según las características del tipo, cantidad ≥1, prioridad, fecha necesaria opcional, encargado (`GET /solicitudes/encargados/`) y justificación.
  - Envía `POST /solicitudes/`. Muestra los errores por campo y pregunta antes de descartar.
- **CA-20 · Recibidas y gestionarlas:**
  - Usa `GET /solicitudes/?ambito=recibidas`.
  - El detalle ofrece solo las transiciones válidas del estado actual:
    - pendiente → en gestión, rechazada o cancelada;
    - en gestión → comprada, rechazada o cancelada;
    - comprada → entregada.
  - Cada transición envía `POST /solicitudes/{id}/cambiar-estado/`. Rechazar exige nota.
  - Un 403 por no ser el encargado se explica.
- **CA-21 · Avisos:**
  - Las notificaciones de los módulos `activos`, `solicitudes`, `mantenimientos` y `alertas` abren la pantalla correspondiente en la app (`MODULOS_EN_APP`), con su empresa.

**Transversal**
- **CA-22 · Empresa:** todo usa la empresa activa (`X-Empresa`). Al cambiar de empresa, el módulo se reevalúa y las listas se recargan.
- **CA-23 · Accesibilidad y marca:**
  - Contraste AA, áreas táctiles de 48 dp o más y etiquetas de lector de pantalla.
  - Los estados no se dicen solo con color.
  - Usa el color de la familia `activos` de `coloresDeModulo`, la marca LAARCOURIER y los componentes comunes de la app.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Móvil | DEV-1 (`dev-mobile`) | Módulo en `navegacion/modulos.js`; servicios en `src/api/`; pantallas en `src/pantallas/activos/`; rutas en `src/app/`; formato puro probado en `src/activos/`; `expo-camera` para el escáner (plugin en `app.config.js`, permiso de cámara con texto propio); pruebas Jest. |

**Fuera de alcance:**
- Crear o editar activos, imprimir etiquetas, políticas y reportes (van al navegador).
- Reasignar el encargado de una solicitud (el servidor no lo permite).
- Cambios en el backend: ninguno. El bug de `proveedor` por línea queda anotado como pendiente de DEV-2.

---

### 4. Contrato
Todo lo de abajo ya existe en el backend y lo usa la web. Va con `X-Empresa`. La paginación es la estándar de DRF: `{count, next, previous, results}`, con 20 por página.

| Operación | Ruta | Permiso | Notas |
|---|---|---|---|
| Panel | `GET /activos/dashboard/` | `activos.ver` | `activos.{total,en_uso,disponibles,en_bodega,en_mantenimiento,...}`, `mantenimientos.*`, `fuera_de_operacion`, `equipos_mas_reparados`, `garantias` |
| Inventario | `GET /activos/?q&estado&almacenados&operativos&page` | `activos.ver` | `ActivoListSerializer` |
| Ficha | `GET /activos/{id}/historial/` | `activos.ver` | `{activo, movimientos, mantenimientos, costos}` |
| Por código | `GET /activos/por-codigo/{codigo}/` | `activos.ver` | igual que la ficha, más `advertencia_lector`; 404 `activo_no_encontrado` |
| Asignar | `POST /activos/{id}/asignar/` | `activos.asignar` | `{responsables[], departamento, sede, motivo}` |
| Cambiar estado | `POST /activos/{id}/cambiar-estado/` | `activos.dar_baja` | `{estado, motivo}` |
| Mantenimientos | `GET /mantenimientos/?pendientes&tipo&q&activo` | `mantenimientos.ver` | |
| Registrar | `POST /mantenimientos/` | `mantenimientos.registrar` | ver CA-14 y CA-15 |
| Cerrar | `PATCH /mantenimientos/{id}/` | `mantenimientos.editar` | `{fecha_salida, solucion, estado_final}` |
| Catálogo de componentes | `GET/POST /mantenimientos/componentes/` | `mantenimientos.ver` / `.componentes` | |
| Adjuntos | `GET/POST /adjuntos/` (multipart) | `adjuntos.ver` / `.subir` | tipos y límite en `adjuntos/models.py` |
| Solicitudes | `GET /solicitudes/?ambito=mias\|recibidas` | `solicitudes.ver` | |
| Crear solicitud | `POST /solicitudes/` | `solicitudes.crear` | catálogo y encargados en `/solicitudes/catalogo/` y `/solicitudes/encargados/` |
| Cambiar estado de solicitud | `POST /solicitudes/{id}/cambiar-estado/` | encargado con `solicitudes.gestionar`, o `solicitudes.administrar`; quien la creó puede cancelarla | `{estado, nota}` |

---

### 5. Decisiones Técnicas y Supuestos
- **Burbuja de «Escanear» (16/11/2026, a pedido del usuario):** un botón flotante redondo (`componentes/BotonFlotante.js`), amarillo de la marca con borde negro, abajo a la derecha. Aparece solo dentro de Gestión de Activos, en todas sus vistas, y nunca en otros módulos. Se controla con el permiso del escáner de la web (`activos.ver`, el de su ruta y su menú). Abre `/activos/escanear?auto=1`: la cámara arranca sola y, si la persona todavía no decidió el permiso, se le pide de una vez. Las listas y el panel dejan libre el final (`ESPACIO_BOTON_FLOTANTE`) para que no tape la última fila.
- **Permisos compartidos con la web** (decisión del usuario, 16/11/2026): quien tiene un permiso en la web lo tiene en la app, con las mismas reglas. Por eso «Asignar» también exige `organizacion.ver` para elegir empleados, áreas y sedes, como la web, y el servidor no cambia.
- **«En almacén»** es `disponible + en_bodega`, igual que la web (`activos/dashboard.py`).
- **El QR** solo trae el texto de `codigo_barras` (p. ej. `GA-LAP-000042`), sin URL. El escáner lee QR y Code 128 con `expo-camera` (`CameraView` con `barcodeScannerSettings`).
- **`expo-camera` es nativo:** hay que recompilar la app de desarrollo (ya estaba pendiente por `com.laarcourier.applce`). Mientras tanto, el escáner muestra «Escribir el código a mano» si el módulo nativo no está.
- **Lo que sale de la app** usa `BotonRedondo` con confirmación (regla del 16/11/2026).
- **Lo descargado** (adjuntos e imágenes) se borra al salir de la pantalla (LOPDP).
- **Pendiente de DEV-2:** el `proveedor` por línea de repuesto no se guarda en el servidor (`ComponenteLineaSerializer`). La app no lo pide.

---

### 6. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-16
- **Desarrollo:** DEV-1 en dos tandas (A: navegación, panel, inventario, ficha, asignar y cambiar estado, escáner y avisos; B: mantenimientos con repuestos, cierre y adjuntos, y solicitudes mías y recibidas) más una ronda de correcciones.
- **QA:**
  - **QA-FUNC:** aprobado con observaciones. Se corrigieron B1 (permisos de solicitudes: el CA-1 estaba mal redactado), B2 (error del servidor perdido al asignar), B3 (avisos de otra empresa que abren listas), B4 (confirmar antes de reenviar tras «puede haberse guardado») y B5 (códigos con «.» o «/»).
  - **QA-TECH:** rechazado por un P2 (la cámara seguía encendida sin foco). Se corrigió y en la revalidación quedó aprobado con observaciones. De sus P3, el Tech Lead corrigió dos: la búsqueda `?q=` del escáner ahora es siempre exacta y ya no apila fichas.
  - **QA-UX:** sin P1. Se corrigieron sus 7 P2 (H-01 a H-07) y la mayoría de los P3.
- **Verificación:**
  - `jest`: 30 suites, 837 pruebas en verde (ejecutado por el Tech Lead).
  - `expo export --platform android` compila.
  - En el teléfono, en producción, con un activo de prueba (GA-PRB-000001, creado con autorización del usuario y borrado después junto con su tipo, su categoría, su mantenimiento, sus movimientos y sus dos avisos): inventario, ficha en el orden nuevo, registrar un mantenimiento abierto, registrar su salida (el activo volvió a «En bodega»), aviso en la campana y escáner con ingreso a mano.
- **Pendientes:**
  - Recompilar la app de desarrollo para la cámara (`expo-camera`). Hace falta `npx eas-cli login` del usuario. Hasta entonces, el escáner funciona solo a mano.
  - Probar en el dispositivo: lectura real de QR y Code 128, permiso de cámara negado → ajustes → volver, adjuntos (foto de más de 10 MB y PDF), asignar y cambiar estado, y el flujo completo de solicitudes.
  - DEV-2:
    - el panel en caché 120 s no se invalida tras asignar o cambiar estado;
    - la ruta `por-codigo` no acepta «.» ni «/»;
    - `proveedor` por línea de repuesto no se guarda;
    - un componente duplicado no da un 400 claro;
    - no hay idempotencia en los altas.
  - P3 restantes de QA-TECH:
    - la duda de reenvío se pierde si el formulario se cierra;
    - al pasar a la empresa de un aviso se ve un instante la lista de la anterior;
    - un comentario copiado en `FichaActivo.js`.
  - P3 restantes de QA-UX: H-14 (cabecera de la bitácora), H-15 (tarjetas anidadas), H-25 (miniatura al adjuntar), linterna y vibración.
  - Insignia de «Recibidas» con las pendientes (requiere un proveedor con sondeo).
