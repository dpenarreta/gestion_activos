import { apiClient } from "../api/client";

/** Hasta cuánto se manda la copia al registro: lo que acepta el servidor
 * (IIS recibe 50 MB por petición). Lo más grande se registra sin copia. */
const TAMANO_COPIA = 45 * 1024 * 1024;

/**
 * Avisa al servidor que la persona guardó un archivo y le manda el archivo,
 * para el registro de descargas (26/10/2026, Auditoría → Descargas). Quién,
 * la IP, la fecha y la hora las pone el servidor. No bloquea ni avisa a la
 * persona si falla: la descarga ya ocurrió.
 */
export function registrarDescarga(blob, nombreArchivo) {
  const datos = new FormData();
  datos.append("nombre", nombreArchivo || "archivo");
  datos.append("tipo", blob?.type || "");
  datos.append("tamano", String(blob?.size ?? 0));
  datos.append("pantalla", window.location.pathname);
  if (blob && blob.size <= TAMANO_COPIA) {
    datos.append("archivo", blob, nombreArchivo || "archivo");
  }
  return apiClient.post("/descargas/", datos).catch(() => {
    // Sin registro no se interrumpe nada; el servidor ya anotó lo que entregó.
  });
}
