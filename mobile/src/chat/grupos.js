import { erroresPorCampo, limpiarMensaje, mensajeDeError } from "../api/errores";
import { sinRespuestaClara } from "../soporte/formato";

/**
 * Crear, editar y salir de un grupo del chat desde la app (US-024,
 * 16/11/2026). Antes se hacía en el navegador; el contrato es el de
 * `backend/apps/chat` (`crear_grupo`, `editar_grupo`, `salir`) y los textos,
 * los del servidor y la web (`Panel.jsx`, `NuevoGrupo`).
 *
 * Es código puro (sin React) para poder probarlo solo.
 */

/** El `max_length` de `GrupoSerializer.nombre`. */
export const LARGO_NOMBRE_GRUPO = 120;

/** El permiso de los grupos por área (`AreasView`, `crear_grupo`). */
export const PERMISO_GRUPOS_POR_AREA = "chat.grupos_por_area";

// Los mismos mensajes que `services.crear_grupo`: en la app se dicen antes
// de enviar y el servidor los repite si algo se cuela.
export const TEXTO_SIN_NOMBRE = "Póngale un nombre al grupo.";
export const TEXTO_SIN_PERSONAS = "Elija al menos a una persona.";
export const TEXTO_SIN_AREA = "Elija el área.";

/** Los campos de «Crear un grupo», en el orden de la pantalla, con su nombre
 * para «Revise…». */
export const CAMPOS_DEL_GRUPO = { nombre: "Nombre del grupo", participantes: "Personas", departamento: "Área" };
/** Los de la edición en «Participantes». `quitar` no es un campo de la
 * pantalla (QA-FUNC O-1): su error se dice arriba (`textoDeQuitar`). */
export const CAMPOS_DE_LA_EDICION = { nombre: "Nombre del grupo", agregar: "Agregar personas" };

/** Desde cuántos caracteres se avisa de cuántos quedan (UX H-10). */
export const AVISO_LARGO_DESDE = 100;

/** «Quedan 12 caracteres.» cerca del límite de 120; antes, nada. */
export function textoDeLargo(nombre) {
  const quedan = LARGO_NOMBRE_GRUPO - String(nombre ?? "").length;
  if (String(nombre ?? "").length < AVISO_LARGO_DESDE) return null;
  if (quedan <= 0) return "Llegó al máximo de 120 caracteres.";
  return quedan === 1 ? "Queda 1 carácter." : `Quedan ${quedan} caracteres.`;
}

/** El texto técnico de DRF para un id que no está entre los usuarios
 * activos («Clave primaria "12" inválida - objeto no existe.»). */
export function esClaveInvalida(texto) {
  return /clave primaria|invalid pk|objeto no existe|does not exist/i.test(String(texto ?? ""));
}

/** Un 400 en `quitar` (QA-FUNC O-1, 16/11/2026): `EditarGrupoSerializer`
 * solo acepta usuarios activos y las bajas de nómina se desactivan cada
 * noche; el texto técnico se dice con palabras. */
export function textoDeQuitar(texto, persona) {
  return esClaveInvalida(texto) ? `No se pudo quitar a ${persona?.nombre ?? "esa persona"}: su cuenta ya no está activa.` : texto;
}

/** Lo mismo al agregar: alguien de la lista se desactivó mientras tanto. */
export function textoDeAgregar(texto) {
  return esClaveInvalida(texto) ? "No se pudo agregar: la cuenta de alguna de las personas elegidas ya no está activa." : texto;
}

/**
 * Quiénes de `elegidas` están de verdad en la conversación devuelta
 * (QA-TECH P3): el servidor ignora a quien no es de la empresa. Sin
 * `participantes` en la respuesta se dan por agregadas todas.
 */
export function resultadoDeAgregar(elegidas, conversacion) {
  if (!Array.isArray(conversacion?.participantes)) return { agregadas: elegidas, faltan: [] };
  const presentes = new Set(conversacion.participantes.map((p) => String(p.id)));
  return {
    agregadas: elegidas.filter((p) => presentes.has(String(p.id))),
    faltan: elegidas.filter((p) => !presentes.has(String(p.id))),
  };
}

/** «Se agregó a Ana Pérez al grupo. No se pudo agregar a Luis Mora: no es de
 * esta empresa.» */
export function textoDeAgregadas({ agregadas, faltan }) {
  return [
    agregadas.length ? `Se agregó a ${listaDeNombres(agregadas)} al grupo.` : null,
    faltan.length ? // Sin suponer el motivo: puede no ser de esta empresa o tener la cuenta
    // inactiva (el servidor responde 200 y no la agrega; 16/11/2026).
    `No se pudo agregar a ${listaDeNombres(faltan)} al grupo.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Si quien sale es la única persona que administra y quedan otras: el
 * servidor pasa la administración a la más antigua (UX H-06). */
export function traspasaLaAdministracion(conversacion, miId) {
  const participantes = Array.isArray(conversacion?.participantes) ? conversacion.participantes : [];
  if (miId === null || miId === undefined || participantes.length < 2) return false;
  const administran = participantes.filter((p) => p.administra);
  return administran.length === 1 && String(administran[0].id) === String(miId);
}

export const TEXTO_TRASPASO =
  "Usted es quien administra el grupo: al salir, lo administrará quien lleve más tiempo en él.";

/** Las dos formas de armar un grupo, con los textos de la web. */
export const MODOS_DEL_GRUPO = [
  { valor: "personas", texto: "Elegir personas" },
  { valor: "area", texto: "Por área" },
];

export const TEXTO_SIN_PERMISO_GRUPO = "No tiene permiso para hacer esto en el chat de esta empresa.";
export const TEXTO_SIN_PERMISO_AREA = "Crear grupos por área es de la administración: no tiene el permiso en esta empresa.";
export const TEXTO_SOLO_QUIEN_ADMINISTRA = "Solo quien administra el grupo puede editarlo.";
export const TEXTO_YA_NO_ESTA = "Ya no forma parte de este grupo, o el grupo ya no existe.";
export const TEXTO_GRUPO_PUEDE_HABERSE_CREADO =
  "No hubo respuesta del servidor: puede que el grupo sí se haya creado. Revise sus chats antes de reintentar; lo que escribió se conserva.";
export const TEXTO_EDICION_PUEDE_HABERSE_GUARDADO =
  "No hubo respuesta del servidor: puede que el cambio sí se haya guardado. Revise los participantes antes de reintentar.";
export const TEXTO_PUEDE_HABER_SALIDO =
  "No hubo respuesta del servidor: puede que sí haya salido del grupo. Revise sus chats antes de reintentar.";
/** Al reintentar salir tras una respuesta perdida, un 403 o 404 dice que ya
 * se salió (QA-FUNC O-2). */
export const TEXTO_YA_SALIO = "Ya había salido del grupo.";

/** Quien administra un grupo (personalizado o por área) lo renombra. */
export function puedeRenombrar(conversacion) {
  return Boolean(conversacion?.administra) && (conversacion.tipo === "grupo" || conversacion.tipo === "area");
}

/** Solo en un grupo personalizado se agrega y se quita gente: en uno por
 * área los miembros los da el área (`editar_grupo`). */
export function puedeCambiarMiembros(conversacion) {
  return Boolean(conversacion?.administra) && conversacion.tipo === "grupo";
}

/** Se sale solo de un grupo personalizado (`services.salir`): el canal
 * general, los directos y los grupos del área son de todos los que
 * corresponden. */
export function puedeSalir(conversacion) {
  return conversacion?.tipo === "grupo";
}

/** Lo que falta antes de enviar «Crear un grupo»: `{campo: mensaje}`. */
export function validarGrupo({ nombre, modo, elegidas, area }) {
  const errores = {};
  if (!String(nombre ?? "").trim()) errores.nombre = TEXTO_SIN_NOMBRE;
  if (modo === "area") {
    if (!area) errores.departamento = TEXTO_SIN_AREA;
  } else if (!elegidas?.length) {
    errores.participantes = TEXTO_SIN_PERSONAS;
  }
  return errores;
}

/** El cuerpo de `POST /chat/conversaciones/`, como la web: con las personas
 * o con el área, nunca con las dos. */
export function cuerpoDelGrupo({ nombre, modo, elegidas, area }) {
  const limpio = String(nombre ?? "").trim();
  if (modo === "area") return { nombre: limpio, departamento: Number(area) };
  return { nombre: limpio, participantes: (elegidas ?? []).map((p) => p.id) };
}

/** Si «Crear un grupo» tiene algo que se perdería al salir. */
export function hayCambiosEnElGrupo({ nombre, elegidas, area }) {
  return Boolean(String(nombre ?? "").trim()) || Boolean(elegidas?.length) || Boolean(area);
}

/** «Revise el campo: Nombre del grupo.» con los de `nombres`, en su orden. */
export function textoReviseGrupo(campos, nombres) {
  const lista = Object.keys(nombres)
    .filter((c) => campos[c])
    .map((c) => nombres[c]);
  if (lista.length === 0) return "Revise los campos marcados.";
  const unidos = lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join(", ")} y ${lista.at(-1)}`;
  return `Revise ${lista.length === 1 ? "el campo" : "los campos"}: ${unidos}.`;
}

/** Un 403 de DRF dice «You do not have permission…» o nombra el código del
 * permiso: no es un mensaje para quien usa la app. */
function esTecnico(mensaje) {
  return /^(You do not have|No tiene el permiso requerido|Usted no tiene permiso)/i.test(mensaje ?? "");
}

/**
 * El error de crear, editar o salir: `{texto, campos, clave, dudoso,
 * status}`.
 *
 * - Sin respuesta clara (sin red, 502-504, una página HTML), `dudoso` con
 *   `puedeHaberse`: el envío pudo llegar (CA-5).
 * - Un 400 con campos que la pantalla muestra (`nombres`) va junto a cada
 *   uno, y arriba «Revise…»; el de un campo que no muestra se dice arriba.
 * - Un 403 se explica (`sinPermiso`); un 404, que ya no está (`noEsta`).
 * - `traducir` (`{campo: (texto) => texto}`): el mensaje técnico de un
 *   campo, dicho con palabras (`textoDeQuitar`, `textoDeAgregar`).
 */
export function errorDelGrupo(
  e,
  porDefecto,
  {
    nombres = {},
    sinPermiso = TEXTO_SIN_PERMISO_GRUPO,
    noEsta = TEXTO_YA_NO_ESTA,
    puedeHaberse = TEXTO_GRUPO_PUEDE_HABERSE_CREADO,
    traducir = {},
  } = {},
) {
  if (sinRespuestaClara(e)) return { texto: puedeHaberse, campos: {}, clave: Date.now(), dudoso: true, status: null };
  const status = e?.response?.status;
  const propio = limpiarMensaje(e?.response?.data?.error?.message);
  if (status === 403) {
    const texto = propio && propio !== "Error en la solicitud." && !esTecnico(propio) ? propio : sinPermiso;
    return { texto, campos: {}, clave: Date.now(), dudoso: false, status };
  }
  if (status === 404) return { texto: noEsta, campos: {}, clave: Date.now(), dudoso: false, status };
  const todos = Object.fromEntries(
    Object.entries(erroresPorCampo(e)).map(([c, t]) => [c, traducir[c] ? traducir[c](t) : t]),
  );
  const campos = Object.fromEntries(Object.entries(todos).filter(([c]) => nombres[c]));
  const ocultos = Object.keys(todos).filter((c) => !nombres[c]);
  const generico = !propio || propio === "Error en la solicitud.";
  let texto;
  if (ocultos.length) {
    texto = [...ocultos.map((c) => todos[c]), Object.keys(campos).length ? textoReviseGrupo(campos, nombres) : null]
      .filter(Boolean)
      .join(" ");
  } else if (Object.keys(campos).length) {
    texto = generico ? textoReviseGrupo(campos, nombres) : mensajeDeError(e, porDefecto);
  } else {
    texto = mensajeDeError(e, porDefecto);
  }
  return { texto, campos, clave: Date.now(), dudoso: false, status };
}

/** «Carla Ruiz y Luis Mora», «Carla Ruiz, Luis Mora y Ana Pérez». */
export function listaDeNombres(personas) {
  const nombres = (personas ?? []).map((p) => p.nombre).filter(Boolean);
  if (nombres.length <= 1) return nombres[0] ?? "";
  return `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
}
