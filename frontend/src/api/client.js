import axios from "axios";

import { env } from "../config/env";

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

function redirectToLogin() {
  setTokens(null, null);
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
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
  (response) => response,
  async (error) => {
    const { config, response } = error;

    if (
      response?.status === 403 &&
      response.data?.error?.code === "password_change_required"
    ) {
      redirectToForcedPasswordChange();
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
      redirectToLogin();
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
