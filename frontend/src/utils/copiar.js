/**
 * Copia un texto al portapapeles. El sitio se sirve por http dentro de la red
 * (http://10.0.2.33:5080), donde el navegador no ofrece `navigator.clipboard`
 * (pide un contexto seguro): ahí se copia con una caja de texto temporal y
 * `document.execCommand("copy")`. Devuelve si se pudo.
 */
export async function copiarTexto(texto) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Sigue con el método antiguo.
    }
  }
  const caja = document.createElement("textarea");
  caja.value = texto;
  caja.setAttribute("readonly", "");
  caja.style.position = "fixed";
  caja.style.opacity = "0";
  document.body.appendChild(caja);
  caja.select();
  let copiado = false;
  try {
    copiado = document.execCommand("copy");
  } catch {
    copiado = false;
  }
  document.body.removeChild(caja);
  return copiado;
}
