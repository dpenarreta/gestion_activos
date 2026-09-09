/** Convierte `{campo: ["mensaje"]}` en una lista legible. */
function porCampo(datos) {
  return Object.entries(datos)
    .filter(([, valor]) => Array.isArray(valor) || typeof valor === "string")
    .map(([campo, valor]) => {
      const texto = Array.isArray(valor) ? valor.join(" ") : valor;
      return campo === "non_field_errors" || campo === "detail"
        ? texto
        : `${campo}: ${texto}`;
    });
}

/**
 * Traduce una respuesta de error de la API a un mensaje para el usuario.
 *
 * El backend responde con dos formas y ambas llegan aquí: los errores de
 * negocio traen `{error: {code, message}}`, y los de validación de un
 * serializer vienen envueltos en esa misma forma con el detalle por campo
 * dentro —`{error: {message: "Error en la solicitud.", details: {campo: [...]}}}`
 * (ver `apps.core.exceptions.api_exception_handler`)—.
 *
 * El detalle se lee **antes** que el mensaje. Al revés, un nombre duplicado
 * mostraba «Error en la solicitud.» y escondía la única frase que decía qué
 * corregir y con quién chocaba: el usuario veía que algo falló, sin saber qué.
 */
export function mensajeDeError(
  err,
  mensajePorDefecto = "No se pudo completar la operación.",
) {
  const datos = err?.response?.data;
  if (!datos) {
    return mensajePorDefecto;
  }

  if (typeof datos === "string") {
    return datos;
  }

  const detalles = datos.error?.details;
  if (detalles && typeof detalles === "object") {
    const lista = porCampo(detalles);
    if (lista.length > 0) {
      return lista.join(" · ");
    }
  }

  if (datos.error?.message) {
    return datos.error.message;
  }

  // Errores de validación sin envolver: se listan como "campo: mensaje" para
  // que el usuario sepa cuál corregir, no solo que "algo" falló.
  const lista = porCampo(datos);
  return lista.length > 0 ? lista.join(" · ") : mensajePorDefecto;
}
