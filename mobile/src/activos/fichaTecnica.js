import { esModuloApagado, TEXTO_MODULO_APAGADO } from "./formato";
import { especificacionDe } from "./solicitudes";
import { mensajeDeError } from "../api/errores";

/**
 * El alta y la edición de un activo en la app (US-023, 16/11/2026), con los
 * campos, las opciones, los obligatorios y las validaciones de
 * `ActivoForm.jsx` de la web y de `ActivoWriteSerializer`. Es código puro:
 * lo usan la pantalla (`FormularioActivo.js`) y las pruebas.
 */

// --- Opciones (las de `Activo.Criticidad`, `Uso`, `Condicion` y `Propiedad`) ------

export const CRITICIDADES = [
  { valor: "baja", texto: "Baja" },
  { valor: "media", texto: "Media" },
  { valor: "alta", texto: "Alta" },
  { valor: "critica", texto: "Crítica" },
];

export const USOS = [
  { valor: "administrativo", texto: "Administrativo" },
  { valor: "operativo", texto: "Operativo" },
  { valor: "desarrollo", texto: "Desarrollo" },
  { valor: "diseno", texto: "Diseño" },
  { valor: "gerencial", texto: "Gerencial" },
  { valor: "atencion_cliente", texto: "Atención al cliente" },
  { valor: "bodega", texto: "Bodega" },
  { valor: "infraestructura", texto: "Infraestructura" },
];

/** «Sin especificar» va primero, como en la web: el levantamiento inicial se
 * hace con equipos cuya procedencia nadie recuerda. */
export const CONDICIONES = [
  { valor: "", texto: "Sin especificar" },
  { valor: "nuevo", texto: "Nuevo" },
  { valor: "usado", texto: "Usado" },
];

export const PROPIEDADES = [
  { valor: "propia", texto: "De la empresa" },
  { valor: "concesion", texto: "En concesión" },
];

/** Los largos de `Activo` (los mismos `maxLength` de la web). */
export const LARGOS = { nombre: 150, marca: 80, modelo: 120, numero_serie: 120 };

/** Lo leído de la etiqueta del fabricante (UX H-15), listo para el campo:
 * sin saltos de línea ni tabuladores, sin espacios a los lados ni dobles, y
 * hasta el largo del campo. `null` si no queda nada. */
export function serieLeida(texto, maximo = LARGOS.numero_serie) {
  const limpio = String(texto ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maximo)
    .trim();
  return limpio || null;
}

// --- Valores ------------------------------------------------------------------------

/** Lo que trae el alta, como `VACIO` de la web. Los IDs, como texto. */
export function valoresVacios() {
  return {
    tipo: "",
    nombre: "",
    marca: "",
    modelo: "",
    numero_serie: "",
    especificaciones: {},
    observaciones: "",
    responsables: [],
    compartido: false,
    solicitado_por: "",
    departamento: "",
    sede: "",
    criticidad: "media",
    uso: "administrativo",
    fecha_adquisicion: "",
    fecha_ingreso: "",
    costo_adquisicion: "",
    condicion: "",
    propiedad: "propia",
    concesionario: "",
    proveedor: "",
    fecha_fin_garantia: "",
  };
}

function texto(valor) {
  return valor === null || valor === undefined ? "" : String(valor);
}

/** La ficha (`ActivoDetailSerializer`) como valores del formulario de
 * edición. Quién responde, el área y quién lo pidió no se editan aquí. */
export function valoresDeActivo(activo) {
  const a = activo ?? {};
  return {
    ...valoresVacios(),
    tipo: texto(a.tipo),
    nombre: texto(a.nombre),
    marca: texto(a.marca),
    modelo: texto(a.modelo),
    numero_serie: texto(a.numero_serie),
    especificaciones: a.especificaciones && typeof a.especificaciones === "object" ? { ...a.especificaciones } : {},
    observaciones: texto(a.observaciones),
    compartido: Boolean(a.compartido),
    sede: texto(a.sede),
    criticidad: a.criticidad || "media",
    uso: a.uso || "administrativo",
    fecha_adquisicion: texto(a.fecha_adquisicion),
    fecha_ingreso: texto(a.fecha_ingreso),
    costo_adquisicion: texto(a.costo_adquisicion),
    condicion: texto(a.condicion),
    propiedad: a.propiedad || "propia",
    concesionario: texto(a.concesionario),
    proveedor: texto(a.proveedor),
    fecha_fin_garantia: texto(a.fecha_fin_garantia),
  };
}

export function hayCambiosEnElActivo(iniciales, valores) {
  return JSON.stringify(iniciales) !== JSON.stringify(valores);
}

/** Las especificaciones que el tipo no declara (CA-3): un equipo cargado
 * antes de que su tipo se describiera las arrastra. Se conservan y se
 * pueden quitar, como en la web. `[[nombre, valor]]`. */
export function especificacionesHeredadas(especificaciones, caracteristicas) {
  const declaradas = new Set((caracteristicas ?? []).map((c) => c.nombre));
  return Object.entries(especificaciones ?? {}).filter(([nombre]) => !declaradas.has(nombre));
}

/** Si al cambiar de tipo se pierde algo escrito: las especificaciones
 * difieren de las de partida (las guardadas, en una edición). */
export function seVanAPerderEspecificaciones(valores, base) {
  return JSON.stringify(valores.especificaciones ?? {}) !== JSON.stringify(base ?? {});
}

// --- Validación (lo que la web y el servidor rechazan) -------------------------------

const MONTO = /^\d{1,10}([.,]\d{1,2})?$/;

export function montoNormalizado(valor) {
  return String(valor ?? "").trim().replace(",", ".");
}

export const TEXTO_CONCESIONARIO = "Diga de qué partner es el equipo en concesión.";

/** El mensaje de `validate_compartido` del servidor. */
export function textoNoQuitarCompartido(cuantos) {
  return `Responden por él ${cuantos} personas. Deje una sola en «Asignar» antes de quitarle la marca de compartido.`;
}

/**
 * Revisa lo que la web y `ActivoWriteSerializer` exigen. Devuelve `{campo:
 * texto}`; los de las características van en `especificaciones: {nombre:
 * texto}`. `esEdicion`: el área no se pide (no se edita aquí);
 * `responsablesActuales`: cuántos responden hoy por el equipo.
 */
export function validarActivo(valores, { caracteristicas = [], esEdicion = false, responsablesActuales = 0 } = {}) {
  const errores = {};
  if (!valores.tipo) errores.tipo = "Elija el tipo de dispositivo.";
  if (!valores.nombre.trim()) errores.nombre = "Escriba el nombre del activo.";
  if (!valores.marca.trim()) errores.marca = "Escriba la marca.";
  if (!valores.modelo.trim()) errores.modelo = "Escriba el modelo.";
  if (!valores.numero_serie.trim()) errores.numero_serie = "Escriba el número de serie.";
  if (!esEdicion && !valores.departamento) errores.departamento = "Elija el área del equipo.";
  if (esEdicion && !valores.compartido && responsablesActuales > 1) {
    errores.compartido = textoNoQuitarCompartido(responsablesActuales);
  }
  if (!valores.fecha_adquisicion) errores.fecha_adquisicion = "Elija la fecha de adquisición.";
  if (valores.fecha_adquisicion && valores.fecha_ingreso && valores.fecha_ingreso < valores.fecha_adquisicion) {
    errores.fecha_ingreso = "El ingreso al inventario no puede ser anterior a la adquisición.";
  }
  if (valores.fecha_adquisicion && valores.fecha_fin_garantia && valores.fecha_fin_garantia < valores.fecha_adquisicion) {
    errores.fecha_fin_garantia = "El fin de la garantía no puede ser anterior a la adquisición.";
  }
  const costo = String(valores.costo_adquisicion ?? "").trim();
  if (costo && !MONTO.test(costo)) {
    errores.costo_adquisicion = "Escriba un monto sin signos, con hasta 2 decimales (por ejemplo, 1250,50).";
  }
  if (valores.propiedad === "concesion" && !valores.concesionario) errores.concesionario = TEXTO_CONCESIONARIO;
  const especificaciones = {};
  for (const c of caracteristicas) {
    const { valor, error } = especificacionDe(c, valores.especificaciones?.[c.nombre]);
    if (error) especificaciones[c.nombre] = error;
    else if (c.obligatoria && (valor === undefined || valor === "")) {
      especificaciones[c.nombre] = `«${c.nombre}» es obligatoria para este tipo de equipo.`;
    }
  }
  if (Object.keys(especificaciones).length) errores.especificaciones = especificaciones;
  return errores;
}

// --- Cuerpos ------------------------------------------------------------------------

function numeroONulo(valor) {
  return valor ? Number(valor) : null;
}

/** Las especificaciones como las espera el servidor: las declaradas por el
 * tipo, normalizadas (número, sí/no…), y las heredadas tal como están. Sin
 * características declaradas, los pares libres. */
export function especificacionesDelCuerpo(valores, caracteristicas = []) {
  const todas = valores.especificaciones ?? {};
  if (!caracteristicas.length) return { ...todas };
  const resultado = Object.fromEntries(especificacionesHeredadas(todas, caracteristicas));
  for (const c of caracteristicas) {
    const { valor } = especificacionDe(c, todas[c.nombre]);
    if (valor !== undefined) resultado[c.nombre] = valor;
  }
  return resultado;
}

/** Lo que se envía en el alta y en la edición, como `payload` de la web. */
function cuerpoComun(valores, caracteristicas) {
  return {
    tipo: Number(valores.tipo),
    nombre: valores.nombre.trim(),
    marca: valores.marca.trim(),
    modelo: valores.modelo.trim(),
    numero_serie: valores.numero_serie.trim(),
    especificaciones: especificacionesDelCuerpo(valores, caracteristicas),
    observaciones: valores.observaciones.trim(),
    sede: numeroONulo(valores.sede),
    criticidad: valores.criticidad,
    uso: valores.uso,
    fecha_adquisicion: valores.fecha_adquisicion,
    fecha_ingreso: valores.fecha_ingreso || null,
    costo_adquisicion: String(valores.costo_adquisicion ?? "").trim() ? montoNormalizado(valores.costo_adquisicion) : null,
    condicion: valores.condicion,
    propiedad: valores.propiedad,
    // null y no el resto del campo oculto: vuelto a ser de la empresa, dejar
    // puesto al partner lo seguiría contando como ajeno (como la web).
    concesionario: valores.propiedad === "concesion" ? numeroONulo(valores.concesionario) : null,
    proveedor: numeroONulo(valores.proveedor),
    fecha_fin_garantia: valores.fecha_fin_garantia || null,
    compartido: Boolean(valores.compartido),
  };
}

/** `POST activos/`: lo común más el custodio (uno solo, aunque sea
 * compartido: los demás se suman con «Asignar», cada uno con su acta), el
 * área y quién lo pidió. */
export function cuerpoDeAlta(valores, caracteristicas = []) {
  return {
    ...cuerpoComun(valores, caracteristicas),
    responsables: valores.responsables.map(Number),
    departamento: Number(valores.departamento),
    solicitado_por: numeroONulo(valores.solicitado_por),
  };
}

/**
 * `PATCH activos/{id}/`: solo lo que cambió respecto de la ficha, y nunca
 * responsables, área ni quién lo pidió (el serializer no los acepta al
 * editar; cambian con «Asignar», que deja el movimiento).
 *
 * Solo lo que cambió, y no el formulario entero como la web: una sede o un
 * proveedor que se cerraron después del alta ya no pasan la validación del
 * servidor, y reenviarlos impediría corregir cualquier otra cosa de la
 * ficha. Si cambia el tipo, las especificaciones van siempre: se validan
 * contra el tipo nuevo.
 */
export function cuerpoDeEdicion(iniciales, valores, caracteristicas = []) {
  const antes = cuerpoComun(iniciales, caracteristicas);
  const ahora = cuerpoComun(valores, caracteristicas);
  const cuerpo = {};
  for (const campo of Object.keys(ahora)) {
    if (JSON.stringify(antes[campo]) !== JSON.stringify(ahora[campo])) cuerpo[campo] = ahora[campo];
  }
  if (cuerpo.tipo !== undefined) cuerpo.especificaciones = ahora.especificaciones;
  return cuerpo;
}

// --- Mensajes -----------------------------------------------------------------------

/** Lo que se anuncia en la ficha nueva (CA-2): el código de barras. */
export function textoDelAlta(activo) {
  const codigo = activo?.codigo_barras;
  const base = codigo ? `Activo registrado con el código ${codigo}.` : "Activo registrado.";
  const aviso = activo?.aviso;
  if (aviso && Number(aviso.enviados) > 0 && !(Array.isArray(aviso.sin_correo) && aviso.sin_correo.length)) {
    return `${base} Se avisó por correo a quien lo pidió.`;
  }
  return base;
}

/** Si quien pidió el equipo no tiene correo: no le llegó el aviso. */
export function textoDelAvisoDeAlta(aviso) {
  const sin = Array.isArray(aviso?.sin_correo) ? aviso.sin_correo.filter(Boolean) : [];
  if (sin.length === 0) return null;
  const nombres = sin.length === 1 ? sin[0] : `${sin.slice(0, -1).join(", ")} y ${sin.at(-1)}`;
  return `${nombres} ${sin.length === 1 ? "no tiene" : "no tienen"} correo en su ficha y no ${
    sin.length === 1 ? "recibió" : "recibieron"
  } el aviso de que el equipo llegó${aviso?.a_quien_registro ? "; le llegó a usted" : ""}.`;
}

export const TEXTO_SIN_CAMBIOS_EN_LA_FICHA = "No cambió nada en la ficha.";

/** El nombre del permiso que dan los catálogos de Organización
 * (`organizacion.ver` en `permissions/catalog.py`). */
const PERMISO_DE_ORGANIZACION = "«Ver sedes, departamentos y empleados»";

/**
 * Por qué no cargó un catálogo (CA-6). Las áreas, sedes, proveedores,
 * concesionarios y empleados piden `organizacion.ver`; los tipos y sus
 * características, `activos.ver`. Un 403 se explica con el permiso que
 * falta, en vez del genérico de Gestión de Activos. `nombre`: «las áreas».
 */
export function falloDeCatalogo(error, nombre, { deOrganizacion = true } = {}) {
  if (esModuloApagado(error)) return TEXTO_MODULO_APAGADO;
  if (error?.response?.status === 403) {
    return deOrganizacion
      ? `No tiene el permiso ${PERMISO_DE_ORGANIZACION} de Organización, así que no se pueden mostrar ${nombre}. Pídalo a Sistemas.`
      : `No tiene permiso para ver ${nombre} de Gestión de Activos. Pídalo a Sistemas.`;
  }
  return mensajeDeError(error, `No se pudieron cargar ${nombre}.`);
}
