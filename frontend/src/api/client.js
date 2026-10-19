import axios from "axios";

import { env } from "../config/env";
import { avisarCambio } from "./cambiosDeConfiguracion";

const ACCESS_TOKEN_KEY = "gestion_activos_access_token";
const REFRESH_TOKEN_KEY = "gestion_activos_refresh_token";

// Endpoints que nunca deben disparar un intento de refresh ni una
// redirección automática (evita bucles de reintento).
const AUTH_ENDPOINTS = ["/auth/login/", "/auth/token/refresh/"];

function isAuthEndpoint(url) {
  return Boolean(url) && AUTH_ENDPOINTS.some((path) => url.includes(path));
}

export const apiClient = axios.create({
  baseURL: env.apiBaseUrl,
  headers: { "Content-Type": "application/json" },
});

const EMPRESA_KEY = "gestion_activos_empresa";

/** En qué empresa está trabajando esta pestaña. */
export function getEmpresaActiva() {
  try {
    return localStorage.getItem(EMPRESA_KEY);
  } catch {
    return null;
  }
}

export function setEmpresaActiva(id) {
  try {
    if (id) localStorage.setItem(EMPRESA_KEY, String(id));
    else localStorage.removeItem(EMPRESA_KEY);
  } catch {
    // Sin almacenamiento se trabaja en la empresa predeterminada: el backend
    // resuelve una cuando la cabecera no viene.
  }
}

/**
 * Los enlaces de los correos de la Matriz llevan `?empresa=ID`: quien trabaja
 * en dos empresas tiene que caer en la del aviso, no en la última que usó, o el
 * período respondería 404. Se lee **antes** de montar la aplicación —ninguna
 * pantalla alcanza a pedir datos con la empresa anterior— y se quita de la
 * dirección. Si la empresa no es suya, el backend responde con otra y el
 * selector lo corrige, como siempre.
 */
export function tomarEmpresaDeLaDireccion() {
  try {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("empresa");
    if (!id || !/^\d+$/.test(id)) return;
    setEmpresaActiva(id);
    url.searchParams.delete("empresa");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // Sin URL o sin historial se sigue con la empresa que hubiera.
  }
}

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // En qué empresa se pregunta. Va en cada llamada y no en la sesión del
  // servidor a propósito: así dos pestañas abiertas en empresas distintas no
  // se pisan, que es exactamente lo que hace quien compara dos inventarios.
  const empresa = getEmpresaActiva();
  if (empresa) {
    config.headers["X-Empresa"] = empresa;
  }
  return config;
});

let pendingRefresh = null;

function motivoDeCierre(error) {
  return error?.response?.data?.error?.code === "session_idle_timeout"
    ? "inactividad"
    : undefined;
}

function redirectToLogin(motivo) {
  setTokens(null, null);
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    // El motivo viaja en la query y no en el estado del router porque esto es
    // una navegación del navegador, no del router: se pierde cualquier cosa
    // que no vaya en la URL. Encontrarse la pantalla de login sin explicación
    // se lee como que el sistema falló.
    const destino = motivo ? `/login?motivo=${motivo}` : "/login";
    window.location.assign(destino);
  }
}

// Red de seguridad además del gate de rutas en AppRoutes: cubre una pestaña
// ya abierta cuyo `user` en memoria quedó desactualizado (ej. un admin
// activó "forzar cambio de contraseña" desde otra sesión).
function redirectToForcedPasswordChange() {
  if (
    typeof window !== "undefined" &&
    window.location.pathname !== "/change-password-required"
  ) {
    window.location.assign("/change-password-required");
  }
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error("No hay una sesión que renovar.");
  }
  const response = await axios.post(`${env.apiBaseUrl}/auth/token/refresh/`, {
    refresh: refreshToken,
  });
  setTokens(response.data.access, response.data.refresh);
  return response.data.access;
}

// Gestión de expiración de sesión: ante un 401 en un recurso protegido se
// intenta renovar una única vez con el refresh token; si eso también falla
// (refresh vencido o revocado), se limpia la sesión y se redirige al login.
apiClient.interceptors.response.use(
  (response) => {
    // Un cambio de Configuración que se ve en todo el sistema (tema,
    // permisos, empresas) se avisa para que se aplique sin recargar.
    avisarCambio(response.config);
    return response;
  },
  async (error) => {
    const { config, response } = error;

    if (
      response?.status === 403 &&
      response.data?.error?.code === "password_change_required"
    ) {
      redirectToForcedPasswordChange();
      return Promise.reject(error);
    }

    if (motivoDeCierre(error)) {
      // Renovar no serviría: el servidor ya cerró la sesión, y el propio
      // refresh responde lo mismo. Se va directo al login, diciendo por qué.
      redirectToLogin("inactividad");
      return Promise.reject(error);
    }

    if (
      !response ||
      response.status !== 401 ||
      !config ||
      isAuthEndpoint(config.url)
    ) {
      return Promise.reject(error);
    }

    if (config._retriedAfterRefresh) {
      redirectToLogin();
      return Promise.reject(error);
    }
    config._retriedAfterRefresh = true;

    try {
      pendingRefresh = pendingRefresh || refreshAccessToken();
      const newAccessToken = await pendingRefresh;
      pendingRefresh = null;
      config.headers.Authorization = `Bearer ${newAccessToken}`;
      return apiClient(config);
    } catch (refreshError) {
      pendingRefresh = null;
      // El caso corriente al volver tras el plazo: el token de acceso ya había
      // vencido por su cuenta, así que la petición da un 401 sin motivo y es
      // el refresco el que se encuentra la sesión cerrada. Sin mirar aquí, se
      // llegaría al login sin explicación.
      redirectToLogin(motivoDeCierre(refreshError));
      return Promise.reject(refreshError);
    }
  },
);

export function setTokens(access, refresh) {
  if (access) {
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
  } else {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  }
  if (refresh) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  } else {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}
