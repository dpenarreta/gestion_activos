/**
 * El único cliente HTTP de la app. Se comporta como `frontend/src/api/client.js`
 * (US-009, 12/11/2026):
 *
 * - `Authorization: Bearer <access>` y `X-Empresa` en cada petición. La empresa
 *   va en cada llamada, no en la sesión del servidor, igual que en la web.
 * - `User-Agent: IntranetLCE/<versión> (android|ios)` en TODAS las peticiones,
 *   incluido el login: con él el backend identifica la sesión y el dispositivo
 *   (ajuste del Tech Lead, 12/11/2026).
 * - Ante un 401 renueva el access con el refresh UNA sola vez, aunque fallen
 *   diez peticiones a la vez: el refresh rota y presentar uno ya usado hace que
 *   el backend revoque la sesión, así que las demás esperan esa misma
 *   renovación (cola) y se reintentan con el token nuevo.
 * - Si la renovación responde 401 (refresh vencido a los 7 días, sesión
 *   revocada, cierre por 4 h sin uso) o el reintento vuelve a dar 401, la
 *   sesión terminó: se borran los tokens y se avisa a `alTerminarSesion`.
 *   No se depende del `code` exacto: una sesión revocada llega como
 *   `authentication_failed` (ajuste del Tech Lead, 12/11/2026). Solo
 *   `session_idle_timeout` y `session_revoked` cierran sin intentar renovar,
 *   porque el servidor ya dijo que renovar no serviría.
 * - Solo un 401 de la renovación termina la sesión. Un fallo de red, un 5xx o
 *   un 429 son temporales: sin respuesta clara no se sabe si terminó, y echar
 *   a la persona por pasar por un túnel o por un reinicio del servidor sería
 *   un error (revisión de QA, 12/11/2026).
 *
 * - Un cuerpo `FormData` (el documento de un permiso, US-010) va tal cual, sin
 *   `Content-Type`: lo pone `fetch` con su `boundary`. Esas peticiones pueden
 *   pedir un `timeoutMs` propio, porque subir 10 MB por datos móviles tarda.
 * - `conRenovacion` sirve para lo que no pasa por `fetch` (descargar el
 *   documento a la caché con `expo-file-system`): pide con las cabeceras de
 *   la sesión y, ante un 401, renueva una vez con la misma cola.
 *
 * Es una fábrica para poder probarlo con un `fetch` y un almacén falsos; la app
 * usa la instancia `api` de `./api.js`.
 */

const RUTAS_DE_AUTENTICACION = ["/auth/login/", "/auth/token/refresh/"];

/** Con estos códigos el servidor ya cerró la sesión: renovar no serviría. */
const CIERRE_SIN_RENOVAR = new Set(["session_idle_timeout", "session_revoked"]);

function esRutaDeAutenticacion(ruta) {
  return RUTAS_DE_AUTENTICACION.some((r) => ruta.startsWith(r));
}

function conParametros(ruta, params) {
  if (!params) return ruta;
  const partes = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  if (partes.length === 0) return ruta;
  return `${ruta}${ruta.includes("?") ? "&" : "?"}${partes.join("&")}`;
}

/** `FormData` existe en React Native y en Jest; se comprueba sin depender
 * de que esté definido en el entorno. */
function esFormulario(cuerpo) {
  return typeof FormData !== "undefined" && cuerpo instanceof FormData;
}

function codigoDe(datos) {
  return datos && typeof datos === "object" ? datos.error?.code : undefined;
}

/** Errores con la forma de axios, para que `mensajeDeError` los lea igual
 * que en la web. */
function errorDeRespuesta(status, datos) {
  const mensaje =
    (datos && typeof datos === "object" && datos.error?.message) ||
    `HTTP ${status}`;
  const error = new Error(mensaje);
  error.response = { status, data: datos };
  error.codigo = codigoDe(datos);
  return error;
}

function errorDeRed(causa, porTiempo = false) {
  const error = new Error(
    porTiempo ? "La petición tardó demasiado." : "Sin conexión con el servidor.",
  );
  error.esDeRed = true;
  error.porTiempo = porTiempo;
  error.causa = causa;
  return error;
}

async function leerCuerpo(respuesta) {
  if (respuesta.status === 204) return null;
  const texto = await respuesta.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

export function crearCliente({
  baseUrl,
  almacen,
  userAgent,
  fetchImpl = (...args) => fetch(...args),
  alTerminarSesion = () => {},
  alExigirCambioDeContrasena = () => {},
  timeoutMs = 20000,
}) {
  let renovacionEnCurso = null;
  let cierreEnCurso = null;

  async function crudo(
    metodo,
    ruta,
    { cuerpo, params, cabeceras, access, sinToken, timeoutMs: esperaPropia } = {},
  ) {
    const headers = {
      Accept: "application/json",
      "User-Agent": userAgent,
      ...cabeceras,
    };
    const formulario = esFormulario(cuerpo);
    if (cuerpo !== undefined && !formulario) headers["Content-Type"] = "application/json";
    const token = access !== undefined ? access : almacen.tokens().access;
    if (token && !sinToken) headers.Authorization = `Bearer ${token}`;
    const empresa = almacen.empresa();
    const yaTraeEmpresa = Object.keys(headers).some(
      (k) => k.toLowerCase() === "x-empresa",
    );
    if (empresa && !yaTraeEmpresa) headers["X-Empresa"] = String(empresa);

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), esperaPropia ?? timeoutMs);
    let respuesta;
    try {
      respuesta = await fetchImpl(`${baseUrl}${conParametros(ruta, params)}`, {
        method: metodo,
        headers,
        body: cuerpo === undefined ? undefined : formulario ? cuerpo : JSON.stringify(cuerpo),
        signal: controlador.signal,
      });
    } catch (causa) {
      throw errorDeRed(causa, controlador.signal.aborted);
    } finally {
      clearTimeout(temporizador);
    }
    const datos = await leerCuerpo(respuesta);
    if (!respuesta.ok) {
      const error = errorDeRespuesta(respuesta.status, datos);
      // Con qué token se pidió: si otra petición ya renovó mientras esta
      // viajaba, basta con reintentar con el nuevo.
      error.tokenUsado = token;
      throw error;
    }
    return { datos, tokenUsado: token };
  }

  /** Una sola renovación a la vez; quien llegue mientras tanto la espera. */
  function renovar(accessUsado) {
    const actual = almacen.tokens().access;
    // Otra petición ya renovó mientras esta viajaba: basta con reintentar.
    if (actual && actual !== accessUsado) return Promise.resolve(actual);
    if (!renovacionEnCurso) {
      renovacionEnCurso = (async () => {
        const { refresh } = almacen.tokens();
        if (!refresh) throw errorDeRespuesta(401, null);
        const { datos } = await crudo(
          "POST",
          "/auth/token/refresh/",
          { cuerpo: { refresh }, sinToken: true },
        );
        await almacen.guardarTokens(datos.access, datos.refresh || refresh);
        return datos.access;
      })().finally(() => {
        renovacionEnCurso = null;
      });
    }
    return renovacionEnCurso;
  }

  /** Cierra la sesión en el teléfono una sola vez, aunque fallen varias
   * peticiones a la vez. */
  function terminarSesion(codigo) {
    if (!cierreEnCurso) {
      const accessAnterior = almacen.tokens().access;
      cierreEnCurso = (async () => {
        await almacen.guardarTokens(null, null);
        await alTerminarSesion({ codigo, accessAnterior });
      })().finally(() => {
        cierreEnCurso = null;
      });
    }
    return cierreEnCurso;
  }

  async function solicitar(metodo, ruta, opciones = {}) {
    try {
      return (await crudo(metodo, ruta, opciones)).datos;
    } catch (error) {
      const status = error.response?.status;
      if (
        status === 403 &&
        error.codigo === "password_change_required"
      ) {
        alExigirCambioDeContrasena();
        throw error;
      }
      if (
        status !== 401 ||
        esRutaDeAutenticacion(ruta) ||
        opciones.sinRenovar ||
        opciones.sinToken
      ) {
        throw error;
      }
      const { access, refresh } = almacen.tokens();
      // Sin sesión guardada no hay nada que renovar ni que cerrar.
      if (!access && !refresh) throw error;

      if (CIERRE_SIN_RENOVAR.has(error.codigo) || opciones.reintentada) {
        await terminarSesion(error.codigo);
        throw error;
      }

      try {
        await renovar(error.tokenUsado ?? access);
      } catch (errorRenovando) {
        if (errorRenovando.response?.status !== 401) throw errorRenovando;
        await terminarSesion(errorRenovando.codigo || error.codigo);
        throw errorRenovando;
      }
      return solicitar(metodo, ruta, { ...opciones, reintentada: true });
    }
  }

  /** Las cabeceras de la sesión, con `X-Empresa` propia si se indica. */
  function cabecerasDeAutorizacion(empresa) {
    const { access } = almacen.tokens();
    const activa = empresa ?? almacen.empresa();
    return {
      "User-Agent": userAgent,
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...(activa ? { "X-Empresa": String(activa) } : {}),
    };
  }

  /**
   * Para lo que no pasa por `fetch` (una descarga nativa): `hacer(cabeceras)`
   * pide con la sesión y debe lanzar un error con `status` si el servidor
   * respondió mal. Ante un 401 se renueva una sola vez (con la misma cola
   * que las demás peticiones) y se reintenta; si la renovación da 401, la
   * sesión terminó.
   */
  async function conRenovacion(hacer, { empresa } = {}) {
    const tokenUsado = almacen.tokens().access;
    try {
      return await hacer(cabecerasDeAutorizacion(empresa));
    } catch (error) {
      if (error?.status !== 401) throw error;
      const { access, refresh } = almacen.tokens();
      if (!access && !refresh) throw error;
      try {
        await renovar(tokenUsado);
      } catch (errorRenovando) {
        if (errorRenovando.response?.status === 401) {
          await terminarSesion(errorRenovando.codigo);
        }
        throw errorRenovando;
      }
      try {
        return await hacer(cabecerasDeAutorizacion(empresa));
      } catch (otra) {
        if (otra?.status === 401) await terminarSesion(undefined);
        throw otra;
      }
    }
  }

  return {
    get: (ruta, opciones) => solicitar("GET", ruta, opciones),
    post: (ruta, cuerpo, opciones = {}) =>
      solicitar("POST", ruta, { ...opciones, cuerpo: cuerpo ?? {} }),
    put: (ruta, cuerpo, opciones = {}) =>
      solicitar("PUT", ruta, { ...opciones, cuerpo: cuerpo ?? {} }),
    /** URL absoluta de un recurso (las imágenes de las noticias). */
    url: (ruta) => `${baseUrl}${ruta}`,
    /** Cabeceras para un recurso que no pasa por `fetch` (un `<Image>`).
     * `empresa`: la de un push, si no es la activa. */
    cabecerasDeAutorizacion,
    conRenovacion,
  };
}
