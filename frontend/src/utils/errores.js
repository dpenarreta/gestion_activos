/**
 * Traduce una respuesta de error de la API a un mensaje para el usuario.
 *
 * El backend responde con dos formas distintas y ambas llegan aquí: los
 * errores de negocio traen `{error: {code, message}}` (ver
 * `apps.core.exceptions.api_exception_handler`), mientras los de validación
 * de un serializer traen `{campo: ["mensaje", ...]}`. Sin esta función, cada
 * pantalla que solo lee `error.message` mostraría el mensaje genérico ante un
 * fallo de validación, escondiendo justo el dato que el usuario necesita para
 * corregir el formulario.
 */
export function mensajeDeError(err, mensajePorDefecto = "No se pudo completar la operación.") {
  const datos = err?.response?.data;
  if (!datos) {
    return mensajePorDefecto;
  }

  if (datos.error?.message) {
    return datos.error.message;
  }

  if (typeof datos === "string") {
    return datos;
  }

  // Errores de validación por campo: se listan como "campo: mensaje" para que
  // el usuario sepa cuál corregir, no solo que "algo" falló.
  const porCampo = Object.entries(datos)
    .filter(([, valor]) => Array.isArray(valor) || typeof valor === "string")
    .map(([campo, valor]) => {
      const texto = Array.isArray(valor) ? valor.join(" ") : valor;
      return campo === "non_field_errors" || campo === "detail" ? texto : `${campo}: ${texto}`;
    });

  return porCampo.length > 0 ? porCampo.join(" · ") : mensajePorDefecto;
}
