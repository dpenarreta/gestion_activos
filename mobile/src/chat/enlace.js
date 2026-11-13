/**
 * El id de la conversación de un enlace del chat, `/admin/chat?c=ID`
 * (`chat.services.enlace`), o `null`. Solo dígitos: puede venir de una
 * notificación (US-011, 12/11/2026).
 */
export function conversacionDelEnlace(enlace) {
  if (typeof enlace !== "string") return null;
  const [ruta, consulta = ""] = enlace.split("#")[0].split("?");
  if (ruta !== "/admin/chat") return null;
  const c = consulta
    .split("&")
    .map((par) => par.split("="))
    .find(([clave]) => clave === "c")?.[1];
  return c && /^\d{1,12}$/.test(c) ? c : null;
}
