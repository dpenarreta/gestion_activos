# Historia de Usuario: US-016 - App móvil: navegación por módulos arriba y funcionalidades abajo

- **ID:** US-016
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-13
- **Sprint / Módulo:** App móvil «Intranet LCE» · Navegación
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-1

---

### 1. Definición de la Historia
- **Como:** colaborador que usa la app «Intranet LCE».
- **Quiero:**
  - Cambiar de módulo con pestañas arriba que se deslizan en horizontal.
  - Tener las funcionalidades del módulo activo en una barra flotante abajo, también deslizable.
- **Para:**
  - Llegar a cualquier funcionalidad con dos toques.
  - Que la app crezca con módulos nuevos sin rehacer la navegación.

Referencia visual del usuario: la app de Uber.
- Arriba hay pestañas de módulos (Uber · Uber Eats · Envíos · Tienda…). Se deslizan y la activa va subrayada.
- Abajo hay una barra flotante redondeada.
- La campana y la cuenta van en la cabecera, como el «Carrito».

**Decisiones del usuario (13/11/2026, por preguntas):**
- **Módulos en este orden:** Inicio · Institucional · Chat · Mesa de ayuda. Los módulos futuros entran a la derecha.
- **Avisos y Cuenta:** salen de la barra de abajo y pasan a la cabecera, arriba a la derecha. Avisos es la campana con contador; Cuenta es el ícono de cuenta. Se ven en cualquier módulo.
- **En Inicio:** la barra de abajo muestra accesos rápidos a las funcionalidades más usadas de todos los módulos.
- **Permisos:** cada persona ve solo los módulos y funcionalidades que puede usar.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

**Estructura**

- **CA-1 · Pestañas de módulos**
  - **Dado que** la persona entró a la app,
  - **cuando** ve cualquier módulo,
  - **entonces**:
    - Bajo la cabecera negra hay una fila de pestañas con ícono y texto: Inicio · Institucional · Chat · Mesa de ayuda.
    - La pestaña activa va en amarillo #FCE200 con un subrayado grueso, sobre el fondo oscuro de la marca. Las inactivas usan el gris claro de la marca, con contraste AA.
    - Si no caben en el ancho, la fila se desliza en horizontal y la pestaña activa queda siempre a la vista: al elegirla, se desplaza para mostrarla.
    - Cada pestaña tiene `accessibilityRole="tab"` y `selected`, y un área táctil de 48 dp o más.
    - La fila tiene `role="tablist"`.

- **CA-2 · Barra de funcionalidades**
  - **Dado que** hay un módulo activo,
  - **entonces**:
    - Abajo hay una barra flotante y redondeada, con la sombra de la marca, separada de los bordes y respetando el área segura.
    - Muestra las funcionalidades de ese módulo como botones con ícono y texto.
    - La barra se desliza en horizontal si no caben.
    - La funcionalidad activa se resalta, sin depender solo del color.
    - Las funcionalidades llevan `accessibilityRole="tab"` (o `button` si abren una pantalla nueva) y un área táctil de 48 dp o más.
    - El contenido de la pantalla no queda tapado por la barra: el último elemento de una lista se ve completo encima de ella.

- **CA-3 · Funcionalidades por módulo.** Las insignias son las que ya existen.

  | Módulo | Funcionalidades (en orden) |
  |---|---|
  | Inicio | Accesos rápidos (CA-4) |
  | Institucional | Mis solicitudes · Por aprobar (insignia) · Mis vacaciones · Nueva solicitud (abre `/permisos/nueva`) |
  | Chat | Conversaciones · Nuevo mensaje (abre `/chat/nuevo`) · Mi estado (abre `/chat/mi-estado`) |
  | Mesa de ayuda | Mis tickets (insignia) · Bandeja (insignia) · Aprobaciones (insignia) · Nuevo ticket (abre `/soporte/nuevo`) · Registrar (abre `/soporte/registrar`) |

  - Las funcionalidades que son una «vista» cambian el contenido del módulo sin apilar pantallas.
  - Las que son una «acción» abren la pantalla correspondiente, con su cabecera y el botón Volver.
  - Los controles segmentados que hoy hay arriba de Permisos («Mías / Por aprobar / Vacaciones») y de la Mesa de ayuda («Mis tickets / Bandeja / Aprobaciones») **se quitan**: la barra de abajo los reemplaza.

- **CA-4 · Accesos rápidos en Inicio**
  - **Dado que** el módulo activo es Inicio,
  - **entonces** la barra muestra, según sus permisos:
    - Nueva solicitud y Mis vacaciones;
    - Por aprobar, solo si es aprobador;
    - Chat;
    - Nuevo ticket o Mis tickets;
    - Bandeja, solo si es del equipo de la mesa.
  - Cada acceso lleva al módulo y a la vista correspondientes; la pestaña de arriba cambia a ese módulo.

- **CA-5 · Avisos y Cuenta en la cabecera**
  - **Dado que** la persona está en cualquier módulo,
  - **entonces**:
    - A la derecha de la cabecera hay una campana con la insignia de no leídas (99+ como tope). Su nombre accesible es «Avisos: notificaciones, N sin leer».
    - Al lado está el ícono de Cuenta, con el nombre accesible «Cuenta: empresa y cerrar sesión».
    - Ambos abren su pantalla de siempre, con cabecera y el botón Volver.
    - La cabecera de Inicio mantiene el logotipo LAARCOURIER en negativo. En los demás módulos va el nombre del módulo o el logotipo, sin cortar el texto en 360 dp.

**Permisos y estados**

- **CA-6 · Solo lo que puede usar**
  - **Dado que** a la persona le falta el permiso de una funcionalidad (por ejemplo, Bandeja sin ser del equipo, o Por aprobar sin ser aprobador),
  - **entonces** esa funcionalidad no aparece.
  - Si un módulo se queda sin ninguna funcionalidad, la pestaña del módulo tampoco aparece.
  - Se usan las mismas reglas de hoy:
    - `esDelEquipo`, `rutaDeAltaPropia` y el resumen de soporte;
    - `useResumenPermisos` (`puedeSolicitar`, `porAprobar`);
    - el 403 de `bandeja/` que oculta la Bandeja.
  - El acceso efectivo lo sigue decidiendo el servidor.

- **CA-7 · Insignias en las pestañas de módulo**
  - Cada pestaña de módulo muestra la suma de sus pendientes:
    - Institucional: por aprobar;
    - Chat: mensajes sin leer;
    - Mesa de ayuda: los pendientes de su resumen.
  - El nombre accesible dice el número (por ejemplo, «Chat, 3 sin leer»).

- **CA-8 · Enlaces y push siguen funcionando**
  - Estas rutas abren el módulo correcto con su funcionalidad marcada en la barra:
    - `/permisos?seccion=mias|por_aprobar|vacaciones`;
    - `/soporte?vista=mis|bandeja|aprobaciones`;
    - `/chat`, `/notificaciones` y `/cuenta`.
  - Esto vale tanto al tocar un push (`modulosEnApp`, `useAbrirAlTocarPush`) como desde el Inicio o la notificación en detalle.
  - Las pruebas de enlaces y notificaciones siguen en verde.

- **CA-9 · Atrás en Android**
  - **Dado que** la persona está en un módulo distinto de Inicio,
  - **cuando** pulsa Atrás,
  - **entonces** vuelve a Inicio.
  - Si ya está en Inicio, Atrás sale de la app, igual que hoy.

- **CA-10 · Letra grande**
  - Con la letra del sistema al 200 %:
    - las pestañas y la barra siguen deslizándose sin cortar textos ni pasar a columna;
    - la barra no ocupa más de 1/4 del alto de la pantalla en 360×800.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| App móvil (`mobile/`) | DEV-1 | Navegador de módulos (rutas de Expo Router), componentes `PestanasDeModulos` y `BarraDeFuncionalidades`, cabecera con Avisos y Cuenta, catálogo de módulos y funcionalidades con su visibilidad por permisos, adaptación de Permisos, Mesa de ayuda y Chat, rutas e insignias, y pruebas (jest) |

**Fuera de alcance:**
- Backend y web.
- Módulos nuevos.
- Personalizar el orden de los accesos rápidos.
- Pantallas «Servicios» o «Actividad» como las de Uber.

---

### 4. Contrato
No hay cambios en la API. Se usan los mismos datos de hoy:
- `usuario.permissions`;
- los resúmenes de permisos, chat y soporte;
- el contador de notificaciones.

Las rutas actuales de la app se mantienen (CA-8).

---

### 5. Decisiones Técnicas y Supuestos
- **Catálogo declarativo:** un único catálogo (`src/navegacion/modulos.js` o similar) define módulos → funcionalidades. Cada funcionalidad tiene id, texto, ícono, tipo (vista o acción), ruta, una función de visibilidad con los permisos y su insignia. La barra, las pestañas, los accesos rápidos y los enlaces salen de ahí, así que un módulo futuro es una entrada más.
- **Barra inferior:** la de `Tabs` se reemplaza con `tabBar`, o con un layout propio. Lo decide DEV-1 según la versión de Expo Router (leer la documentación de la versión instalada).
- **Avisos y Cuenta:** dejan de ser pestañas. Pasan a pantallas del Stack, o a pestañas ocultas con `href: null`, siempre que Atrás funcione (CA-9).
- **Quitar los segmentos:** al quitar los controles de Permisos y de la Mesa de ayuda, el estado de la vista sale del parámetro de la ruta (`seccion` o `vista`), que ya existe.
- **Inicio:** conserva sus bloques, «Para hoy» y «En la app». «En la app» puede quedarse como está.
- **Marca LAARCOURIER:** #FCE200, #000/#1E1E1E y #E1E1E1, con Poppins.
- **Ronda 1, 13/11/2026: decisiones del usuario y del Tech Lead tras QA**
  - Orden de la barra (decisión del usuario): las acciones se quedan al final, después de las vistas. Se añade un indicador de que la barra se desliza. Los botones de dentro de las pantallas se mantienen: «Nueva solicitud», «Nuevo ticket», «Registrar» y el botón flotante del Chat.
  - «Por aprobar» se muestra si hay algo pendiente, si tiene `licencias.ver_por_aprobar` o si la ruta lo pide. La API no dice quién es aprobador.
  - En iOS el área táctil es de 44 pt, según el perfil de DEV-1 y Apple HIG. Los 48 dp de CA-1 y CA-2 rigen en Android.
  - Las pestañas inactivas usan #C8C8C8, con 10:1 sobre #1E1E1E. Con #E1E1E1 tendrían el mismo brillo que la activa amarilla y la diferencia se notaría menos.
  - P1 encontrado en el teléfono: `tabBar` no recibe `navigation` en expo-router 58. Las pruebas pasaban `navigation` a mano y por eso no lo detectaron.
- **Accesibilidad:** contraste AA y áreas táctiles de 48 dp o más.
- **Calendario de eventos en Inicio (16/11/2026, a pedido del usuario):** va después de «Noticias y eventos», como en el Inicio de la web. Ese mismo día el usuario pidió que ambos fueran pestañas del mismo bloque, para ahorrar espacio. «Noticias y eventos» es la pestaña por defecto, con subrayado amarillo, y «Calendario de eventos» es la otra. Al cambiar de pestaña se desmonta el carrusel, que así no sigue pasando noticias sin que nadie las vea. Si hoy, en hora de Ecuador, hay alguna fecha de cualquier tipo, la pestaña del calendario muestra un punto amarillo con borde negro y el lector de pantalla dice «hay fechas hoy». Para eso Inicio pide `calendario(hoy, hoy)`. Muestra el mes (de lunes a domingo, con «hoy» en hora de Ecuador) con las pestañas de la web, «Eventos y feriados» y «Celebraciones». Cada tipo lleva su ícono y no depende solo del color, y los feriados tienen además el fondo rojo claro. Al tocar un día se listan sus fechas y las 3 próximas. Lee `GET /organizacion/calendario/?desde&hasta`, que ya existía, así que no hay cambios en el backend. Se recarga con el pull-to-refresh y al cambiar de empresa. Archivos: `src/inicio/calendario.js`, `src/pantallas/CalendarioInicio.js`, `inicioService.calendario` y `__tests__/calendarioInicio.test.js`. Se verificó en el Samsung con los datos de producción. Falta la reauditoría de QA-UX.

- **Accesos de Inicio redondos (16/11/2026, a pedido del usuario):** los de «En la app» y «En el navegador» pasan de tarjetas a todo el ancho a botones redondos en cuadrícula. Son 4 columnas, o 3 con la letra por encima del 130 %. Cada sección lleva su línea de ayuda. Los del navegador tienen el círculo blanco y una marca de «sale de la app». La descripción la sigue leyendo el lector de pantalla.
- **Mi perfil en la app (16/11/2026, decisión del usuario):** el ícono de la cuenta abre «Mi perfil», que es de **solo lectura**. Muestra Mis datos, Mi cargo (con las listas plegadas) y Mi línea de supervisión, todo de `GET /organizacion/mis-datos/`. Para cambiar algo, «Editar en el navegador». Debajo siguen Empresa, Chat, Avisos y Cerrar sesión. El acceso «Mi perfil» de Inicio ahora abre la app. Los bloques de cumpleaños, aniversario, herramientas, llamados y Mis derechos quedan fuera por decisión del usuario. Archivos: `src/pantallas/MiPerfil.js` y `__tests__/miPerfil.test.js`.
- **Ficha de contacto en el chat (16/11/2026, a pedido del usuario):** nueva pantalla `chat/contacto/[id]` con la ficha de `GET /chat/personas/{id}/contacto/` (`para_compartir`, la misma de la web). Muestra el correo corporativo, un teléfono (el corporativo si lo tiene; si no, el personal, que solo llega si la persona autorizó compartirlo, LOPDP), la extensión de su línea fija, el área y el cargo. Lo que no tiene no se muestra. El teléfono y el correo abren la app de llamadas o de correo; los datos se pueden seleccionar para copiarlos. Se abre con el ícono de la cabecera en un directo y tocando a una persona en «Participantes». También se agregó «si tiene línea fija» a lo que falta en Mi perfil.
- **Salir al navegador (16/11/2026, a pedido del usuario):** todo lo que abre el navegador primero pregunta «¿Salir al navegador?», con «Quedarme en la app» y «Abrir el navegador» (`navegador/confirmarSalida.js`, desde `abrirEnNavegador`). Quedarse no es un error: `abrirEnNavegador` devuelve `null`. Además, toda opción que sale de la app es un botón redondo con la marca negra de «se abre en el navegador» (`componentes/BotonRedondo.js`, el de los accesos de Inicio). Aplica a Mesa de ayuda y Matriz («Más opciones en el navegador», en 3 columnas), `AbrirEnLaWeb` (Mi perfil, permisos, ticket, período), crear o gestionar un grupo del chat, el detalle de una notificación, la fuente legal de la Matriz, la acción pendiente y «Elegir mi cargo» en Inicio. Se anuncian como enlace. Quedan fuera las llamadas y los correos (no abren el navegador) y «¿Olvidó su contraseña?» del inicio de sesión, que sigue siendo un enlace de texto pero también pregunta.
- **Imágenes del chat a la vista (16/11/2026, a pedido del usuario):** una imagen recibida (o enviada) se ve dentro de su burbuja desde que llega, en un cuadro de 4:3, sin el «Ver». Cada imagen se descarga una sola vez con la sesión, a lo más 3 a la vez, y la usan la miniatura y el visor; tocarla la abre en grande sin volver a descargarla. Si la descarga falla, queda la fila con el nombre y «Ver», que la vuelve a intentar. Todo lo descargado se borra al salir de la conversación (LOPDP); cerrar el visor ya no la borra, porque la sigue usando la burbuja. Los demás archivos (PDF, Word, Excel) siguen con «Abrir».
- **Auditoría de botones (16/11/2026):** QA-UX móvil, solo lectura. No hay P1. Hay 8 P2 y 11 P3, con los patrones `BotonRedondo`, `FilaDeAcciones`, `Boton ajustado/texto` y `BotonFlotante`. Está pendiente que el usuario decida qué se aplica.

---

### 6. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-13
- **Cambio de alcance (decisión del usuario, 13/11/2026):** «Inicio» deja de ser un módulo y los accesos rápidos desaparecen.
  - **Institucional** (por defecto): Inicio (por defecto) · Solicitud de permisos · Por aprobar (si aprueba) · Consulta de vacaciones.
  - **Chat:** Conversaciones · Mis grupos · Nuevo mensaje · Mi estado.
  - **Mesa de ayuda:** Bandeja (por defecto si puede verla) · Mis tickets · Aprobaciones (si aprueba) · Nuevo ticket · Registrar.
  - La **Matriz de obligaciones** va en la US-019.
  - Por eso CA-4 queda sin efecto.
- **Auditoría:**
  - **QA-FUNC:** aprobado con observaciones.
  - **QA-TECH:** aprobado con observaciones, 8,5.
  - **QA-UX:** 2 P2 de impacto alto (H-01 y H-02) y 3 P2 más. Se corrigieron en la ronda 1 y se verificaron en el dispositivo. QA-UX no volvió a auditar.
- **Ronda 1:**
  - P1 detectado en el dispositivo: `tabBar` no recibe `navigation` en expo-router 58. Se corrigió con `descriptors` y una prueba de contrato contra el `BottomTabView` instalado.
  - `anchor` en lugar de `initialRouteName`.
  - `FilaDeslizable` (desvanecido y chevron).
  - Vistas y acciones separadas (`tablist` y `toolbar`).
  - H-05, H-07, H-08, H-10, H-12, H-13 y H-15.
  - P3 de QA-TECH, y O-2 y O-3 de QA-FUNC.
- **Ronda 2:**
  - P1 detectado en el dispositivo: había una cabecera por pantalla y la de una pestaña sin foco recibía los toques. En pantalla se veía la fila desplazada, pero el toque caía en la fila sin desplazar.
  - Se corrigió con una cabecera única fuera de las pantallas y `SoloConFoco`, que pone `pointerEvents="none"` sin foco.
- **Criterios de aceptación:**
  - CA-1 ✅ · CA-2 ✅ · CA-3 ✅ (con el cambio de alcance) · CA-4 (sin efecto) · CA-5 ✅ · CA-6 ✅ · CA-7 ✅ · CA-8 ✅ (pruebas) · CA-9 ✅ (dispositivo).
  - CA-10 ⚠️ (letra al 200 %: no se ha medido en un dispositivo).
- **Verificación ejecutada:**
  - `npx jest`: 21 suites, 573/573.
  - `expo export --platform android`: OK (DEV-1).
  - Samsung SM-A075M por Metro:
    - Institucional › Inicio por defecto;
    - la barra cambia de vista;
    - las pestañas reciben el toque donde se ven, también con la fila desplazada;
    - Mis grupos filtra a «TI»;
    - Atrás vuelve a Institucional › Inicio;
    - la Bandeja es la vista por defecto de la Mesa.
- **Pendientes:**
  - En el dispositivo falta comprobar:
    - letra al 200 %;
    - TalkBack;
    - iPhone (sombra, `keyboardWillShow`, 44 pt);
    - push con la app cerrada que lleve a un módulo;
    - teclado en Aprobaciones con la altura medida de la cabecera;
    - doble toque en Avisos o Cuenta.
  - QA-UX debe volver a auditar en vivo.
  - El bloque «En la app» del Inicio repite las pestañas de módulos; hay que decidir si se quita.
  - Botones repetidos que se quedan por decisión del usuario: «Nueva solicitud», «Nuevo ticket», el botón flotante del Chat.
  - Sin `EAS_PROJECT_ID` en este dev-client: no hay push.
  - Sin commit.
