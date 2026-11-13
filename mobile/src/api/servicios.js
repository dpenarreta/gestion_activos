import { api } from "./api";

/**
 * Los endpoints de la app, con las mismas rutas que la web: la Fase 1
 * (US-009: `authService`, `empresasService`, `institucionalService`,
 * `misDatosService` y `notificacionesService`) y la Fase 2 (US-010:
 * `licenciasService` y `misVacaciones` de `institucionalService`).
 */

/** Opciones para pedir en una empresa concreta, sin cambiar la activa. */
function conEmpresa(empresa) {
  return empresa ? { cabeceras: { "X-Empresa": String(empresa) } } : undefined;
}

export const authService = {
  /** El backend espera `identifier` (usuario o correo), como la web. */
  login(identifier, password) {
    return api.post("/auth/login/", { identifier, password });
  },
  me() {
    return api.get("/auth/me/");
  },
  logout(refresh, opciones) {
    return api.post("/auth/logout/", { refresh }, opciones);
  },
};

export const empresasService = {
  /** `{empresas, activa, multiempresa}`: lo que alimenta el selector. */
  mias() {
    return api.get("/empresas/mias/");
  },
};

export const inicioService = {
  /** Las noticias vigentes hoy del carrusel. */
  async noticias() {
    const datos = await api.get("/organizacion/noticias/");
    if (Array.isArray(datos)) return datos;
    return Array.isArray(datos?.results) ? datos.results : [];
  },
  /** `{segundos}`: cada cuánto cambia el carrusel. */
  carrusel() {
    return api.get("/organizacion/carrusel/");
  },
  /** El cargo y los nombres de quien entra. */
  misDatos() {
    return api.get("/organizacion/mis-datos/");
  },
  rutaImagenNoticia(id) {
    return api.url(`/organizacion/noticias/${encodeURIComponent(id)}/imagen/`);
  },
};

export const notificacionesService = {
  /** El historial paginado. El filtro de no leídas es `estado=no_leidas`
   * (así lo lee `NotificacionViewSet.get_queryset`). */
  listar({ pagina = 1, soloNoLeidas = false } = {}) {
    return api.get("/notificaciones/", {
      params: { page: pagina, estado: soloNoLeidas ? "no_leidas" : undefined },
    });
  },
  /** `empresa`: la del push. Va como `X-Empresa` solo en esta petición: la
   * notificación puede ser de una empresa distinta de la activa (B3,
   * 12/11/2026). */
  detalle(id, { empresa } = {}) {
    return api.get(`/notificaciones/${encodeURIComponent(id)}/`, conEmpresa(empresa));
  },
  /** `{no_leidas, recientes}`: el mismo contador que la campana web. */
  resumen() {
    return api.get("/notificaciones/resumen/");
  },
  leer(id, { empresa } = {}) {
    return api.post(
      `/notificaciones/${encodeURIComponent(id)}/leer/`,
      undefined,
      conEmpresa(empresa),
    );
  },
  leerTodas() {
    return api.post("/notificaciones/leer-todas/");
  },
};

export const dispositivosService = {
  /** 201 si es nuevo, 200 si ya existía: `{id, plataforma, nombre, creado}`. */
  registrar({ token, plataforma, nombre }) {
    return api.post("/notificaciones/dispositivos/", { token, plataforma, nombre });
  },
  /** Siempre 204 (sin efecto si el token no es de quien lo pide). */
  baja(token, opciones) {
    return api.post("/notificaciones/dispositivos/baja/", { token }, opciones);
  },
};

/** Subir hasta 10 MB por datos móviles tarda más que los 20 s de siempre. */
const ESPERA_CON_DOCUMENTO_MS = 120_000;

function idSeguro(id) {
  return encodeURIComponent(String(id));
}

/**
 * Solicitud de permisos (US-010, 12/11/2026), igual que `licenciasService`
 * de la web. `empresa`: la de un push, que va como `X-Empresa` solo en esa
 * petición (B3 de la US-009).
 */
export const licenciasService = {
  /** Los tipos de permiso que se pueden solicitar (pide `licencias.solicitar`). */
  tipos() {
    return api.get("/licencias/tipos/");
  },
  /** `{reglas: [{clave, estado, texto, detalle}], bloquea}`. `estado`: `ok`,
   * `falla`, `aviso` o `info`. */
  evaluar(tipo, desde, hasta) {
    return api.get(`/licencias/tipos/${idSeguro(tipo)}/evaluar/`, { params: { desde, hasta } });
  },
  /** `{por_aprobar, puede_solicitar}`. */
  resumen() {
    return api.get("/licencias/solicitudes/resumen/");
  },
  /** `vista`: `mias` o `por_aprobar` (máximo 300, sin paginar). */
  solicitudes(vista = "mias") {
    return api.get("/licencias/solicitudes/", { params: { vista } });
  },
  solicitud(id, { empresa } = {}) {
    return api.get(`/licencias/solicitudes/${idSeguro(id)}/`, conEmpresa(empresa));
  },
  /**
   * Crea la solicitud en `multipart/form-data`, como la web. `campos`:
   * `{flujo, desde, hasta, hora_desde?, hora_hasta?, motivo}`; `adjunto`:
   * `{uri, name, type}` del archivo elegido en el teléfono, o `null`.
   */
  solicitar(campos, adjunto) {
    const datos = new FormData();
    Object.entries(campos).forEach(([clave, valor]) => {
      if (valor !== undefined && valor !== null) datos.append(clave, String(valor));
    });
    if (adjunto) {
      datos.append("adjunto", { uri: adjunto.uri, name: adjunto.name, type: adjunto.type });
    }
    return api.post("/licencias/solicitudes/", datos, {
      timeoutMs: adjunto ? ESPERA_CON_DOCUMENTO_MS : undefined,
    });
  },
  aprobar(id, comentario, { empresa } = {}) {
    return api.post(
      `/licencias/solicitudes/${idSeguro(id)}/aprobar/`,
      { comentario },
      conEmpresa(empresa),
    );
  },
  rechazar(id, comentario, { empresa } = {}) {
    return api.post(
      `/licencias/solicitudes/${idSeguro(id)}/rechazar/`,
      { comentario },
      conEmpresa(empresa),
    );
  },
  cancelar(id, comentario = "", { empresa } = {}) {
    return api.post(
      `/licencias/solicitudes/${idSeguro(id)}/cancelar/`,
      { comentario },
      conEmpresa(empresa),
    );
  },
  /** La URL del documento: se descarga con la sesión
   * (`src/permisos/documentos.js`), nunca se abre en el navegador. */
  urlAdjunto(id) {
    return api.url(`/licencias/solicitudes/${idSeguro(id)}/adjunto/`);
  },
};

export const vacacionesService = {
  /** Por período: lo que corresponde, lo gozado, lo reservado y lo
   * disponible (`organizacion/vacaciones.resumen`). */
  mias() {
    return api.get("/organizacion/vacaciones/mias/");
  },
};

/**
 * «¿Quién aprueba por usted mientras no está?» (US-001 de la web; en la app
 * desde la US-010, decisión del Tech Lead del 12/11/2026). Es de cada
 * persona y vale para la empresa activa: `{modo: "jefe"|"persona", persona:
 * {id, nombre}|null, jefe: {id, nombre}|null}`.
 */
export const reemplazoService = {
  obtener() {
    return api.get("/organizacion/mi-reemplazo/");
  },
  /** `{modo, persona_id?}`; 400 con el detalle en `persona_id` o `modo`. */
  guardar(datos) {
    return api.put("/organizacion/mi-reemplazo/", datos);
  },
};

/** El directorio de la empresa (el del chat), sin quien pregunta:
 * `[{id, nombre, correo, area, cargo}]`, hasta 30. */
export const directorioService = {
  buscar(texto = "") {
    const q = texto.trim();
    return api.get("/chat/directorio/", q ? { params: { q } } : undefined);
  },
};

/** Subir un adjunto del chat (hasta 10 MB) por datos móviles tarda. */
const ESPERA_CON_ADJUNTO_MS = 120_000;

/**
 * El chat (US-011, 12/11/2026), con las mismas rutas que `chatService` de la
 * web (`backend/apps/chat/urls.py`). `empresa`: la de un push, que va como
 * `X-Empresa` solo en esa petición (B3 de la US-009). Los campos reales están
 * en la sección 4 de la US-011.
 */
export const chatService = {
  /** `[{id, tipo, nombre, otro, departamento, miembros, administra,
   * no_leidos, ultimo: {texto, autor, propio, fecha}|null}]`: el canal
   * general primero y luego por actividad. */
  conversaciones() {
    return api.get("/chat/conversaciones/");
  },
  /** Lo mismo que una fila de la lista, con `participantes: [{id, nombre,
   * correo, area, cargo, administra}]`. */
  conversacion(id, { empresa } = {}) {
    return api.get(`/chat/conversaciones/${idSeguro(id)}/`, conEmpresa(empresa));
  },
  /** Abre (o crea) el directo con `usuario`; devuelve la fila de la lista. */
  directa(usuario) {
    return api.post("/chat/conversaciones/directa/", { usuario });
  },
  /** `{mensajes, hay_mas, ultimo_leido, lecturas}`, de a 50 y del más antiguo
   * al más nuevo; `antes` pide los anteriores a ese id. */
  mensajes(id, { antes, empresa } = {}) {
    return api.get(`/chat/conversaciones/${idSeguro(id)}/mensajes/`, {
      ...conEmpresa(empresa),
      params: antes ? { antes } : undefined,
    });
  },
  /**
   * Envía en `multipart/form-data`, como la web: `texto` y, si hay,
   * `archivo` (`{uri, name, type}`). 201 con el mensaje y `avisos`.
   */
  enviar(id, texto, archivo, { empresa } = {}) {
    const datos = new FormData();
    datos.append("texto", texto ?? "");
    if (archivo) datos.append("archivo", { uri: archivo.uri, name: archivo.name, type: archivo.type });
    return api.post(`/chat/conversaciones/${idSeguro(id)}/mensajes/`, datos, {
      ...conEmpresa(empresa),
      timeoutMs: archivo ? ESPERA_CON_ADJUNTO_MS : undefined,
    });
  },
  /** Marca leído hasta `hasta` (o todo): `{ultimo_leido}`. Apaga también el
   * aviso de la campana. */
  leer(id, hasta, { empresa } = {}) {
    return api.post(
      `/chat/conversaciones/${idSeguro(id)}/leer/`,
      hasta ? { hasta } : {},
      conEmpresa(empresa),
    );
  },
  /** `[{id, nombre, ultimo_leido, leido_en}]` de las demás personas. */
  lecturas(id, { empresa } = {}) {
    return api.get(`/chat/conversaciones/${idSeguro(id)}/lecturas/`, conEmpresa(empresa));
  },
  /** `{cursor, mensajes, no_leidos: {conversación: n}, total_no_leidos}`.
   * Sin `desde` solo da el punto de partida. */
  novedades(desde) {
    return api.get(
      "/chat/novedades/",
      desde !== null && desde !== undefined ? { params: { desde } } : undefined,
    );
  },
  /** `{id: {en_linea, ultima_conexion, estado}}` (hasta 200 personas). */
  presencia(ids) {
    return api.get("/chat/presencia/", { params: { ids: ids.join(",") } });
  },
  /** Mi estado, mi horario de almuerzo y las vacaciones que se proponen. */
  miEstado() {
    return api.get("/chat/mi-estado/");
  },
  guardarEstado(datos) {
    return api.put("/chat/mi-estado/", datos);
  },
  /** La URL del archivo de un mensaje (`archivo.url`, relativa a la API):
   * se descarga con la sesión, nunca se abre en el navegador. */
  urlArchivo(ruta) {
    return api.url(ruta);
  },
};

/** Subir hasta 3 adjuntos de 10 MB por datos móviles tarda. */
const ESPERA_CON_ADJUNTOS_MS = 180_000;

/**
 * Los campos y los adjuntos de un envío de la Mesa de ayuda, en
 * `multipart/form-data` como la web (`conArchivos` de `soporteService`):
 * cada archivo va con la clave `adjuntos` (`request.FILES.getlist`).
 */
function conAdjuntos(campos, archivos = []) {
  const datos = new FormData();
  Object.entries(campos).forEach(([clave, valor]) => {
    if (valor !== undefined && valor !== null) datos.append(clave, String(valor));
  });
  (archivos ?? []).forEach((a) => datos.append("adjuntos", { uri: a.uri, name: a.name, type: a.type }));
  return datos;
}

function conAdjuntosYEmpresa(archivos, empresa) {
  return {
    ...conEmpresa(empresa),
    timeoutMs: archivos?.length ? ESPERA_CON_ADJUNTOS_MS : undefined,
  };
}

/**
 * La Mesa de ayuda (US-014, 13/11/2026), con las mismas rutas que
 * `soporteService` de la web (`backend/apps/soporte/urls.py`). `empresa`: la
 * de un push, que va como `X-Empresa` solo en esa petición (B3 de la US-009).
 * Los campos reales están en la sección 4 de la US-014.
 */
export const soporteService = {
  // --- Quien pide ayuda ---
  /** El formulario del alta propia con «Mi perfil» (`mis_datos`) y
   * `puede_crear`. `desdeLaMesa`: la ruta de la Mesa (`soporte.mesa_crear`)
   * en vez de la de «Soporte TI» (`soporte.crear`). */
  formularioPropio({ desdeLaMesa = false } = {}) {
    return api.get(`/soporte/${desdeLaMesa ? "mesa/" : ""}solicitar/`);
  },
  /** 201 `{id, numero, posicion, estado, fuera_de_horario}`. */
  crearTicket(campos, archivos = [], { desdeLaMesa = false } = {}) {
    return api.post(
      `/soporte/${desdeLaMesa ? "mesa/" : ""}solicitar/`,
      conAdjuntos(campos, archivos),
      conAdjuntosYEmpresa(archivos),
    );
  },
  /** Los tickets que pidió la persona (hasta 100), sin permiso especial. */
  misTickets() {
    return api.get("/soporte/mis-tickets/");
  },
  /** `sondeo`: la consulta que la ficha repite sola (otro límite en el
   * servidor). */
  miTicket(id, { sondeo = false, empresa } = {}) {
    return api.get(`/soporte/mis-tickets/${idSeguro(id)}/`, {
      ...conEmpresa(empresa),
      params: sondeo ? { sondeo: 1 } : undefined,
    });
  },
  responderMiTicket(id, texto, archivos = [], { empresa } = {}) {
    return api.post(
      `/soporte/mis-tickets/${idSeguro(id)}/`,
      conAdjuntos({ texto: texto ?? "" }, archivos),
      conAdjuntosYEmpresa(archivos, empresa),
    );
  },
  confirmarMiTicket(id, { empresa } = {}) {
    return api.post(`/soporte/mis-tickets/${idSeguro(id)}/`, { confirmar: true }, conEmpresa(empresa));
  },
  /** `{calificacion 1-5, resuelto, comentario?}` → 201 con el seguimiento. */
  encuestaMiTicket(id, datos, { empresa } = {}) {
    return api.post(`/soporte/mis-tickets/${idSeguro(id)}/encuesta/`, datos, conEmpresa(empresa));
  },

  // --- Equipo ---
  /** La cabecera de la bandeja: `{tecnico, cola_total,
   * categorias_sin_tecnicos, puede}`. 403 si no es del equipo. */
  bandeja() {
    return api.get("/soporte/tickets/bandeja/");
  },
  /** Paginado: `ambito` (`mios`, `cola`, `todos`), `estado`, `prioridad`,
   * `vencidos`, `q`, `page`, `page_size`. */
  tickets(params = {}) {
    return api.get("/soporte/tickets/", { params });
  },
  ticket(id, { sondeo = false, empresa } = {}) {
    return api.get(`/soporte/tickets/${idSeguro(id)}/`, {
      ...conEmpresa(empresa),
      params: sondeo ? { sondeo: 1 } : undefined,
    });
  },
  tomar(id, { empresa } = {}) {
    return api.post(`/soporte/tickets/${idSeguro(id)}/tomar/`, {}, conEmpresa(empresa));
  },
  /** 404 si no hay nada en la cola para quien lo pide. */
  tomarSiguiente() {
    return api.post("/soporte/tickets/tomar-siguiente/", {});
  },
  cambiarEstado(id, estado, nota = "", { empresa } = {}) {
    return api.post(`/soporte/tickets/${idSeguro(id)}/cambiar-estado/`, { estado, nota }, conEmpresa(empresa));
  },
  /** `{prioridad?, impacto?, urgencia?, justificacion}`. */
  cambiarPrioridad(id, datos, { empresa } = {}) {
    return api.post(`/soporte/tickets/${idSeguro(id)}/prioridad/`, datos, conEmpresa(empresa));
  },
  /** `[{id, nombre, nivel, abiertos}]` (quien coordina). */
  tecnicos({ empresa } = {}) {
    return api.get("/soporte/tickets/tecnicos/", conEmpresa(empresa));
  },
  /** El detalle o `{visible: false}` si deja de verlo. */
  asignar(id, tecnico, nota = "", { empresa } = {}) {
    return api.post(`/soporte/tickets/${idSeguro(id)}/asignar/`, { tecnico, nota }, conEmpresa(empresa));
  },
  /** El detalle o `{visible: false}` si deja de verlo. */
  escalar(id, motivo, { empresa } = {}) {
    return api.post(`/soporte/tickets/${idSeguro(id)}/escalar/`, { motivo }, conEmpresa(empresa));
  },
  /** Respuesta al usuario o nota interna, en multipart como la web. */
  responder(id, { texto, interno }, archivos = [], { empresa } = {}) {
    return api.post(
      `/soporte/tickets/${idSeguro(id)}/responder/`,
      conAdjuntos({ texto: texto ?? "", interno: interno ? "true" : "false" }, archivos),
      conAdjuntosYEmpresa(archivos, empresa),
    );
  },
  /** `[{id, atajo, titulo, texto}]`. */
  respuestas({ empresa } = {}) {
    return api.get("/soporte/config/respuestas/", conEmpresa(empresa));
  },
  /** `{estados: [[valor, nombre]], prioridades: [[valor, nombre]]}`. */
  etiquetas() {
    return api.get("/soporte/etiquetas/");
  },
  /** Lo que pide el alta interna, con `canales` y `soy_tecnico`. */
  formularioInterno() {
    return api.get("/soporte/tickets/formulario/");
  },
  /** Las personas con cuenta de la empresa, con sus datos de contacto
   * (hasta 20). */
  personas(texto = "") {
    const q = texto.trim();
    return api.get("/soporte/tickets/personas/", q ? { params: { q } } : undefined);
  },
  /** 201 con el detalle (o `{visible: false}`). */
  registrar(campos, archivos = []) {
    return api.post("/soporte/tickets/registrar/", conAdjuntos(campos, archivos), conAdjuntosYEmpresa(archivos));
  },

  // --- Aprobaciones ---
  aprobaciones() {
    return api.get("/soporte/aprobaciones/");
  },
  /** `{numero, estado}`. La nota es obligatoria para no aprobar. */
  decidirAprobacion(id, aprobar, nota = "") {
    return api.post(`/soporte/aprobaciones/${idSeguro(id)}/decidir/`, { aprobar, nota });
  },

  /** La URL de un adjunto (`url` de la API, relativa a `/api/v1`): se
   * descarga con la sesión, nunca se abre en el navegador. */
  urlAdjunto(ruta) {
    return api.url(ruta);
  },
};

/**
 * La Matriz de obligaciones (US-019, 13/11/2026), con las mismas rutas que
 * `matrizService` de la web (`backend/apps/matriz/urls.py`). Todo trabaja
 * sobre la empresa activa (`X-Empresa`); `empresa`: la de un aviso, que va
 * como `X-Empresa` solo en esa petición (B3 de la US-009). La app solo lee y
 * hace los tres ajustes rápidos (editar el seguimiento, cambiar la fecha y
 * reenviar el recordatorio); lo demás se hace en la web.
 */
export const matrizService = {
  /** `{empresas: [{id, nombre, codigo, color, zona_horaria, roles,
   * capacidades}]}`: donde la cuenta tiene algún permiso `matriz.*`. */
  misEmpresas() {
    return api.get("/matriz/empresas/mias/");
  },
  /** `{counts: {overdue, in_progress, due_soon, done, done_on_time,
   * done_late, attention}, upcoming, recent_closures}`. 404 sin rol de la
   * Matriz en la empresa activa. */
  resumen() {
    return api.get("/matriz/resumen/");
  },
  /** Paginado (`{count, next, results}`, de a 20): `status`
   * (`incumplido`, `en_progreso`, `finalizado`), `sort` (`due`…), `page`,
   * `due_from` y `due_to` (AAAA-MM-DD, en la hora de la empresa). */
  periodos(params = {}) {
    return api.get("/matriz/periodos/", { params });
  },
  /** El detalle, con `acciones` calculadas por el servidor. 404 si no lo
   * puede ver. */
  periodo(id, { empresa } = {}) {
    return api.get(`/matriz/periodos/${idSeguro(id)}/`, conEmpresa(empresa));
  },
  /** «Editar seguimiento»: `{responsable, suplente, supervisor, aprobador,
   * prioridad, avance, observaciones, sede}`. Devuelve el detalle con
   * `visible` (falso si dejó de ser suyo). */
  editarSeguimiento(id, datos, { empresa } = {}) {
    return api.patch(`/matriz/periodos/${idSeguro(id)}/`, datos, conEmpresa(empresa));
  },
  /** `[{id, created_at, actor, accion, descripcion, motivo, valor_anterior,
   * valor_nuevo}]`, del más reciente al más antiguo. */
  historial(id, { empresa } = {}) {
    return api.get(`/matriz/periodos/${idSeguro(id)}/historial/`, conEmpresa(empresa));
  },
  /** Las evidencias: `[{id, nombre_original, version, tamano, estado,
   * created_at, subido_por, motivo_rechazo, rechazado_por}]`. */
  documentos(id, { empresa } = {}) {
    return api.get(`/matriz/periodos/${idSeguro(id)}/documentos/`, conEmpresa(empresa));
  },
  /** La URL del PDF: se descarga con la sesión (`src/matriz/documentos.js`),
   * nunca se abre en el navegador. */
  urlArchivo(documentoId) {
    return api.url(`/matriz/documentos/${idSeguro(documentoId)}/archivo/`);
  },
  /** `{due_date: "AAAA-MM-DD", due_time: "HH:MM"|null, reason}` → el
   * detalle. */
  cambiarVencimiento(id, datos, { empresa } = {}) {
    return api.post(`/matriz/periodos/${idSeguro(id)}/vencimiento/`, datos, conEmpresa(empresa));
  },
  /** «Reenviar recordatorio»: 201 con las notificaciones enviadas. */
  enviarRecordatorio(id, { empresa } = {}) {
    return api.post(`/matriz/periodos/${idSeguro(id)}/recordatorios/enviar/`, {}, conEmpresa(empresa));
  },
  /** `{year, month, periods}`: lo que vence en el mes, en la hora de la
   * empresa. */
  calendario(year, month) {
    return api.get("/matriz/calendario/", { params: { year, month } });
  },
  /** `[{id, nombre, email}]`: quienes trabajan en la empresa (pide crear,
   * editar o gestionar miembros). */
  personas({ empresa } = {}) {
    return api.get("/matriz/personas/", conEmpresa(empresa));
  },
  /** `{reglas, areas, entidades, sedes: [{id, nombre}], tipos,
   * periodicidades, prioridades: [{valor, nombre}], etapas}`. */
  catalogos({ empresa } = {}) {
    return api.get("/matriz/catalogos/", conEmpresa(empresa));
  },
};
