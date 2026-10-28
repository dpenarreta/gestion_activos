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

/**
 * Los errores por campo de una respuesta de la API, como `{campo: "mensaje"}`,
 * para mostrarlos bajo cada campo con `Campo` (auditoría UX/UI, fase 2). Lee
 * las dos formas: `{error: {details: {...}}}` y el detalle sin envolver. Lo que
 * no es de un campo (`non_field_errors`, `detail`) queda fuera: va en el aviso
 * general con `mensajeDeError`.
 */
export function erroresPorCampo(err) {
  const datos = err?.response?.data;
  if (!datos || typeof datos !== "object") return {};
  let fuente = datos;
  if (datos.error) {
    fuente =
      datos.error.details && typeof datos.error.details === "object"
        ? datos.error.details
        : {};
  }
  const resultado = {};
  for (const [campo, valor] of Object.entries(fuente)) {
    if (campo === "non_field_errors" || campo === "detail") continue;
    if (Array.isArray(valor)) resultado[campo] = valor.join(" ");
    else if (typeof valor === "string") resultado[campo] = valor;
  }
  return resultado;
}

/**
 * Si la respuesta trae un error que no es de ningún campo (`non_field_errors`
 * o `detail`): entonces el aviso de arriba tiene que decirlo completo y no
 * basta con «Revise los campos marcados» (auditoría UX/UI, fase 2).
 */
export function hayErroresGenerales(err) {
  const datos = err?.response?.data;
  if (!datos || typeof datos !== "object") return false;
  const fuente = datos.error ? datos.error.details || {} : datos;
  return Boolean(fuente.non_field_errors || fuente.detail);
}
