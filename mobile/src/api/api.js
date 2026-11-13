import { API_URL, USER_AGENT } from "../config/env";
import { almacen } from "./almacen";
import { crearCliente } from "./cliente";

/**
 * Quién se entera de que la sesión terminó o de que hay que cambiar la
 * contraseña. Lo fija `SesionProvider` al montarse; el cliente se crea antes
 * que cualquier pantalla, así que se enlaza por aquí y no por import directo
 * (evita el ciclo cliente ↔ sesión).
 */
const oyentes = {
  alTerminarSesion: () => {},
  alExigirCambioDeContrasena: () => {},
};

export function escucharSesion({ alTerminarSesion, alExigirCambioDeContrasena }) {
  oyentes.alTerminarSesion = alTerminarSesion;
  oyentes.alExigirCambioDeContrasena = alExigirCambioDeContrasena;
  return () => {
    oyentes.alTerminarSesion = () => {};
    oyentes.alExigirCambioDeContrasena = () => {};
  };
}

export const api = crearCliente({
  baseUrl: API_URL,
  almacen,
  userAgent: USER_AGENT,
  alTerminarSesion: (motivo) => oyentes.alTerminarSesion(motivo),
  alExigirCambioDeContrasena: () => oyentes.alExigirCambioDeContrasena(),
});
