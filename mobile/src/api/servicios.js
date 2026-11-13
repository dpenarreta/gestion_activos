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
