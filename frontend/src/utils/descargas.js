/**
 * Descarga un blob como archivo.
 *
 * La API se autentica con `Authorization: Bearer` y una navegación directa del
 * navegador no lleva ese encabezado; poner el token en la query para sortearlo
 * lo dejaría en el historial y en los logs del servidor. Por eso el archivo se
 * pide por axios y se materializa aquí.
 */
export function descargarBlob(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Sin esto el blob queda retenido en memoria mientras viva la pestaña.
  URL.revokeObjectURL(url);
}
