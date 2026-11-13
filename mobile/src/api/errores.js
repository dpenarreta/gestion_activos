/**
 * Mensajes de error para el usuario. Es la misma lógica que
 * `frontend/src/utils/errores.js` (`mensajeDeError`), copiada y no importada:
 * la app no depende del código de la web. El cliente HTTP de la app arma sus
 * errores con la forma de axios (`error.response = {status, data}`) para que
 * esta función se lea igual en los dos lados.
 */

export const MENSAJE_SIN_CONEXION =
  "No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.";

/** «2 › usuario: Elija a quién.» y no «[object Object]». */
function aplanar(valor, ruta) {
  if (typeof valor === "string") return [ruta ? `${ruta}: ${valor}` : valor];
  if (Array.isArray(valor)) {
    if (valor.every((v) => typeof v === "string")) {
      return valor.length
        ? [ruta ? `${ruta}: ${valor.join(" ")}` : valor.join(" ")]
        : [];
    }
    return valor.flatMap((v, i) =>
      aplanar(v, ruta ? `${ruta} ${i + 1}` : String(i + 1)),
    );
  }
  if (valor && typeof valor === "object") {
    return Object.entries(valor).flatMap(([clave, v]) =>
      aplanar(v, ruta ? `${ruta} › ${clave}` : clave),
    );
  }
  return [];
}

function porCampo(datos) {
  return Object.entries(datos).flatMap(([campo, valor]) =>
    campo === "non_field_errors" || campo === "detail"
      ? aplanar(valor, "")
      : aplanar(valor, campo),
  );
}

/**
 * G-1 de la US-014 (13/11/2026): algunas vistas del backend pasan a
 * `serializers.ValidationError` la lista de mensajes de un error de Django y
 * el `message` llega como `"[ErrorDetail(string='Otra persona lo tomó
 * mientras tanto.', code='invalid')]"` o `"['…']"`. La app saca los textos y
 * los une; la corrección de fondo, en el servidor, queda para DEV-2.
 */
export function limpiarMensaje(mensaje) {
  if (typeof mensaje !== "string") return mensaje;
  const detalles = [...mensaje.matchAll(/ErrorDetail\(string=(['"])([\s\S]*?)\1,\s*code=/g)].map((m) => m[2]);
  if (detalles.length) return detalles.join(" ");
  const lista = /^\s*\[\s*(['"])[\s\S]*\1\s*\]\s*$/.test(mensaje)
    ? [...mensaje.matchAll(/(['"])([\s\S]*?)\1/g)].map((m) => m[2]).filter(Boolean)
    : [];
  return lista.length ? lista.join(" ") : mensaje;
}

/** Lo que pone `api_exception_handler` cuando el error no trae un mensaje
 * propio (los de validación de un serializer). */
const MENSAJE_GENERICO = "Error en la solicitud.";

/**
 * Traduce un error de la API a un mensaje legible.
 *
 * A diferencia de la web, aquí `error.message` va primero (revisión de QA,
 * 12/11/2026): los errores por campo se leen aparte (`erroresPorCampo`), y
 * leer antes `details` mostraba «identifier: …» en el login o «retry_after: 60»
 * en un 429. El detalle solo se usa cuando el mensaje es el genérico, que no
 * dice qué corregir. Sin respuesta del servidor se dice que no hubo conexión.
 */
export function mensajeDeError(
  err,
  mensajePorDefecto = "No se pudo completar la operación.",
) {
  const datos = err?.response?.data;
  if (!datos) {
    return err?.esDeRed ? MENSAJE_SIN_CONEXION : mensajePorDefecto;
  }
  if (typeof datos === "string") {
    // Una página HTML (proxy, IIS) no es un mensaje para nadie.
    return /^\s*</.test(datos) ? mensajePorDefecto : datos;
  }
  const mensaje = limpiarMensaje(datos.error?.message);
  if (mensaje && mensaje !== MENSAJE_GENERICO) return mensaje;
  const detalles = datos.error?.details;
  if (detalles && typeof detalles === "object") {
    const lista = porCampo(detalles);
    if (lista.length > 0) return lista.join(" · ");
  }
  if (mensaje) return mensaje;
  const lista = porCampo(datos);
  return lista.length > 0 ? lista.join(" · ") : mensajePorDefecto;
}

/**
 * Los errores de validación de cada campo (`error.details` de un 400), como
 * `{campo: "texto"}`, para mostrarlos junto a su campo (US-010, nueva
 * solicitud de permiso). Es la misma lógica que `erroresPorCampo` de la web.
 * `detail` y `non_field_errors` no son de ningún campo: van en el aviso de
 * arriba (`mensajeDeError`).
 */
export function erroresPorCampo(err) {
  const datos = err?.response?.data;
  if (!datos || typeof datos !== "object") return {};
  let fuente = datos;
  if (datos.error) {
    fuente =
      datos.error.details && typeof datos.error.details === "object" ? datos.error.details : {};
  }
  const resultado = {};
  for (const [campo, valor] of Object.entries(fuente)) {
    if (campo === "non_field_errors" || campo === "detail") continue;
    if (Array.isArray(valor) && valor.every((v) => typeof v === "string")) {
      resultado[campo] = valor.join(" ");
    } else if (typeof valor === "string") {
      resultado[campo] = valor;
    }
  }
  return resultado;
}

/** El mensaje de arriba de un formulario: el del servidor si dice algo
 * propio (una regla que no se cumple), o «Revise los campos marcados» si el
 * detalle ya va junto a cada campo. */
export function mensajeDeFormulario(err, porDefecto) {
  const porCampo = erroresPorCampo(err);
  const mensaje = limpiarMensaje(err?.response?.data?.error?.message);
  if (Object.keys(porCampo).length > 0 && (!mensaje || mensaje === MENSAJE_GENERICO)) {
    return "Revise los campos marcados.";
  }
  return mensajeDeError(err, porDefecto);
}
