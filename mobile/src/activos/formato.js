import { limpiarMensaje, mensajeDeError } from "../api/errores";
import { sinRespuestaClara, TONOS } from "../soporte/formato";

/**
 * Cómo se dicen y se pintan las cosas de Gestión de Activos en la app
 * (US-022, 16/11/2026), con los mismos textos que la web
 * (`DashboardPage.jsx`, `EstadoActivo.jsx`, `CambiarEstadoDialog.jsx`,
 * `AsignarCustodioDialog.jsx`). Es código puro: lo usan el catálogo de la
 * navegación, las pantallas y las pruebas. Cada estado lleva su texto y su
 * ícono, nunca solo el color (CA-23).
 */

// --- Permisos (CA-1) ----------------------------------------------------------------

function lista(permisos) {
  return Array.isArray(permisos) ? permisos : [];
}

/** Panel, Inventario y Escanear: `activos.ver`. */
export function veLosActivos(permisos) {
  return lista(permisos).includes("activos.ver");
}

/** La bitácora de mantenimientos: `mantenimientos.ver`. */
export function veLosMantenimientos(permisos) {
  return lista(permisos).includes("mantenimientos.ver");
}

/** «Mis solicitudes»: `solicitudes.ver`. El servidor exige ese permiso para
 * toda lectura, como la web (QA-FUNC B1; CA-1 corregido el 16/11/2026):
 * con solo `solicitudes.crear` la lista respondería 403. */
export function veMisSolicitudes(permisos) {
  return lista(permisos).includes("solicitudes.ver");
}

/** «Nueva solicitud» dentro de «Mis solicitudes»: `solicitudes.crear`. */
export function puedePedirEquipos(permisos) {
  return lista(permisos).includes("solicitudes.crear");
}

/** «Recibidas»: `solicitudes.ver` y además gestionar o administrar. */
export function veLasRecibidas(permisos) {
  const p = lista(permisos);
  return p.includes("solicitudes.ver") && (p.includes("solicitudes.gestionar") || p.includes("solicitudes.administrar"));
}

/** «Registrar activo» en el Panel y el Inventario (US-023, CA-1):
 * `activos.crear`, el permiso de `activos/new` en la web. */
export function puedeRegistrarActivos(permisos) {
  return lista(permisos).includes("activos.crear");
}

/** «Editar» en la ficha (US-023, CA-1): `activos.editar`, el de
 * `activos/:id/editar` en la web. */
export function puedeEditarActivos(permisos) {
  return lista(permisos).includes("activos.editar");
}

/** Con alguna de las funcionalidades de arriba el módulo tiene pestaña. */
export function tieneAccesoAActivos(permisos) {
  return veLosActivos(permisos) || veLosMantenimientos(permisos) || veMisSolicitudes(permisos) || veLasRecibidas(permisos);
}

// --- Estados del activo -------------------------------------------------------------

/** Los nueve estados de `Activo.Estado`, con el texto de la web, su tono, su
 * ícono y su grupo: `parque`, `almacen` (disponible y en bodega, «En
 * almacén» del panel) o `fuera` (fuera de inventario). */
export const ESTADOS = {
  disponible: { texto: "Disponible", tono: "bien", icono: "package-variant-closed-check", grupo: "almacen" },
  en_uso: { texto: "Asignado", tono: "info", icono: "account-check-outline", grupo: "parque" },
  en_bodega: { texto: "En bodega", tono: "neutro", icono: "warehouse", grupo: "almacen" },
  en_mantenimiento: { texto: "En reparación", tono: "aviso", icono: "wrench-outline", grupo: "parque" },
  en_garantia: { texto: "En reclamación de garantía", tono: "aviso", icono: "shield-refresh-outline", grupo: "parque" },
  en_transito: { texto: "En tránsito", tono: "info", icono: "truck-outline", grupo: "parque" },
  dado_de_baja: { texto: "Dado de baja", tono: "mal", icono: "archive-cancel-outline", grupo: "fuera" },
  perdido: { texto: "Perdido", tono: "mal", icono: "map-marker-question-outline", grupo: "fuera" },
  robado: { texto: "Robado", tono: "mal", icono: "alert-octagon-outline", grupo: "fuera" },
};

/** En el orden de la web: primero los del parque, luego las tres salidas. */
export const ESTADOS_EN_PARQUE = ["disponible", "en_uso", "en_bodega", "en_mantenimiento", "en_garantia", "en_transito"];
export const ESTADOS_DE_SALIDA = ["dado_de_baja", "perdido", "robado"];

/** `{texto, icono, color, fondo, grupo}` de un estado; `texto` de la API si
 * el estado no está en la tabla. */
export function estadoDelActivo(estado, textoDeLaApi) {
  const conocido = ESTADOS[estado];
  if (!conocido) return { texto: textoDeLaApi || estado || "Sin estado", icono: "label-outline", grupo: "parque", ...TONOS.neutro };
  return { ...conocido, ...TONOS[conocido.tono], texto: conocido.texto };
}

export function esSalida(estado) {
  return ESTADOS_DE_SALIDA.includes(estado);
}

/** «Para dado de baja, perdido o robado, el motivo es obligatorio» (CA-9),
 * con la advertencia de la web. */
export const ADVERTENCIAS = {
  dado_de_baja:
    "La baja no se revierte: el equipo no vuelve al inventario ni desde la app ni desde la web. Su expediente e historial se conservan.",
  perdido: "El equipo queda fuera del inventario y sin responsable. Si aparece, se puede reingresar a bodega.",
  robado:
    "El equipo queda fuera del inventario y sin responsable. Conviene anotar el número de denuncia en el motivo.",
};

/** Los estados a los que puede pasar un activo: todos menos el actual. Desde
 * «Dado de baja» no hay ninguno (la web tampoco lo ofrece). */
export function estadosParaCambiar(actual) {
  if (actual === "dado_de_baja") return [];
  return [...ESTADOS_EN_PARQUE, ...ESTADOS_DE_SALIDA]
    .filter((e) => e !== actual)
    .map((e) => ({ valor: e, texto: ESTADOS[e].texto, salida: esSalida(e) }));
}

export const TEXTO_MOTIVO_OBLIGATORIO = "Escriba el motivo: es obligatorio para sacar el equipo del inventario.";

export function validarCambioDeEstado({ estado, motivo }) {
  const errores = {};
  if (!estado) errores.estado = "Elija el nuevo estado.";
  if (esSalida(estado) && !String(motivo ?? "").trim()) errores.motivo = TEXTO_MOTIVO_OBLIGATORIO;
  return errores;
}

/** La pregunta antes de una salida (CA-9). */
export function confirmacionDeSalida(estado, activo) {
  const nombre = [activo?.codigo_barras, activo?.nombre].filter(Boolean).join(" · ");
  return {
    titulo: `¿Marcar como «${ESTADOS[estado]?.texto ?? estado}»?`,
    mensaje: `${nombre ? `${nombre}. ` : ""}${ADVERTENCIAS[estado] ?? "El equipo sale del inventario."}`,
  };
}

// --- Inventario (CA-6) --------------------------------------------------------------

/** Los chips del inventario, con los parámetros de `GET activos/`. Las
 * tarjetas del panel abren el mismo inventario con su filtro (CA-3). */
export const FILTROS_DEL_INVENTARIO = [
  { clave: "todos", texto: "Todos", params: {} },
  { clave: "asignados", texto: "Asignados", params: { estado: "en_uso" } },
  { clave: "almacen", texto: "En almacén", params: { almacenados: "true" } },
  { clave: "reparacion", texto: "En reparación", params: { estado: "en_mantenimiento" } },
  { clave: "fuera", texto: "Fuera de inventario", params: { operativos: "false" } },
];

export function filtroDelInventario(clave) {
  return FILTROS_DEL_INVENTARIO.find((f) => f.clave === clave) ?? FILTROS_DEL_INVENTARIO[0];
}

/** Espera de la búsqueda del inventario (CA-6). */
export const ESPERA_BUSCAR_MS = 400;
export const TAMANO_DE_PAGINA = 20;

/** Los parámetros de una página del inventario. */
export function parametrosDelInventario({ filtro, q, pagina = 1 }) {
  const params = { ...filtroDelInventario(filtro).params, page: pagina };
  const texto = String(q ?? "").trim();
  if (texto) params.q = texto;
  return params;
}

/** «12 activos», «1 activo». */
export function cuantosActivos(n) {
  const total = Number(n) || 0;
  return `${total} ${total === 1 ? "activo" : "activos"}`;
}

/** Dónde está: «Contabilidad · Matriz Quito». */
export function lugarDe(activo) {
  return [activo?.departamento_nombre, activo?.sede_nombre].filter(Boolean).join(" · ");
}

/** Lo que dice el lector de pantalla de una fila del inventario. */
export function nombreDeFila(activo) {
  const estado = estadoDelActivo(activo?.estado, activo?.estado_display).texto;
  return [
    activo?.codigo_barras,
    activo?.nombre,
    activo?.tipo_nombre,
    `Estado: ${estado}`,
    `Responsable: ${activo?.responsables_resumen || "sin asignar"}`,
    lugarDe(activo) ? `Lugar: ${lugarDe(activo)}` : null,
  ]
    .filter(Boolean)
    .join(". ");
}

// --- Panel (CA-3, CA-4) -------------------------------------------------------------

function cifra(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Las cuatro tarjetas destacadas del panel, con el filtro del inventario
 * que abren. «En almacén» es disponible + en bodega, como la web. */
export function kpisDelPanel(datos) {
  const a = datos?.activos ?? {};
  return [
    { clave: "registrados", titulo: "Registrados", cifra: cifra(a.total), icono: "monitor", tono: "neutro", filtro: "todos" },
    { clave: "asignados", titulo: "Asignados", cifra: cifra(a.en_uso), icono: "account-check-outline", tono: "info", filtro: "asignados" },
    {
      clave: "almacen",
      titulo: "En almacén",
      cifra: cifra(a.disponibles) + cifra(a.en_bodega),
      detalle: `${cifra(a.disponibles)} disponibles y ${cifra(a.en_bodega)} en bodega`,
      icono: "warehouse",
      tono: "bien",
      filtro: "almacen",
    },
    {
      clave: "reparacion",
      titulo: "En reparación",
      cifra: cifra(a.en_mantenimiento),
      icono: "wrench-outline",
      tono: "aviso",
      filtro: "reparacion",
    },
  ];
}

/** Las alertas del panel que tienen algo (CA-4), con su número, su ícono y
 * su nombre: no dependen del color. */
export function alertasDelPanel(datos) {
  const a = datos?.activos ?? {};
  const g = datos?.garantias ?? {};
  const perdidos = cifra(a.perdidos) + cifra(a.robados);
  return [
    { clave: "garantias_vencidas", cifra: cifra(g.vencidas), texto: "Garantía vencida", icono: "shield-off-outline", tono: "mal" },
    {
      clave: "garantias_por_vencer",
      cifra: cifra(g.por_vencer),
      texto: `Garantía por vencer${g.dias_de_aviso ? ` (en ${g.dias_de_aviso} días o menos)` : ""}`,
      icono: "shield-alert-outline",
      tono: "aviso",
    },
    { clave: "reemplazo", cifra: cifra(a.reemplazo_recomendado), texto: "Reemplazo recomendado", icono: "swap-horizontal", tono: "aviso" },
    // UX H-20: las que tienen un chip del inventario que las contiene abren
    // el inventario con él (`filtro`); las de garantía y reemplazo no tienen.
    { clave: "perdidos", cifra: perdidos, texto: "Perdidos o robados", icono: "map-marker-question-outline", tono: "mal", filtro: "fuera" },
    {
      clave: "sin_asignar",
      cifra: cifra(a.sin_asignar_mas_de_90_dias),
      texto: "Almacenados sin asignar hace más de 90 días",
      icono: "clock-alert-outline",
      tono: "aviso",
      filtro: "almacen",
    },
  ].filter((x) => x.cifra > 0);
}

/** «Garantía vencida: 3 equipos». */
export function textoDeAlerta(alerta) {
  return `${alerta.texto}: ${alerta.cifra} ${alerta.cifra === 1 ? "equipo" : "equipos"}`;
}

// --- Dinero, garantía y bitácora ----------------------------------------------------

/** «$1.234,50», como `formatearMoneda` de la web (es-EC, USD), sin `Intl`:
 * Hermes en Android no siempre trae los datos de idioma. Los montos llegan
 * como texto (`Decimal` de DRF). */
export function dinero(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return String(valor);
  const [entero, decimales] = Math.abs(numero).toFixed(2).split(".");
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${numero < 0 ? "-" : ""}$${conPuntos},${decimales}`;
}

const GARANTIA = {
  vigente: { texto: "En garantía", tono: "bien", icono: "shield-check-outline" },
  por_vencer: { texto: "Garantía por vencer", tono: "aviso", icono: "shield-alert-outline" },
  vencida: { texto: "Garantía vencida", tono: "mal", icono: "shield-off-outline" },
  sin_registrar: { texto: "Sin garantía registrada", tono: "neutro", icono: "shield-outline" },
};

/** `{texto, detalle, icono, color, fondo}` de la garantía de la ficha. */
export function garantiaDe(activo) {
  const g = GARANTIA[activo?.estado_garantia] ?? GARANTIA.sin_registrar;
  const dias = activo?.dias_para_fin_de_garantia;
  let detalle = null;
  if (typeof dias === "number") {
    if (dias < 0) detalle = `Venció hace ${-dias} ${-dias === 1 ? "día" : "días"}`;
    else if (dias === 0) detalle = "Vence hoy";
    else detalle = `Quedan ${dias} ${dias === 1 ? "día" : "días"}`;
  }
  return { ...g, ...TONOS[g.tono], texto: activo?.estado_garantia_display || g.texto, detalle };
}

/** Los mantenimientos de la ficha: los abiertos (sin fecha de salida)
 * primero y luego del más reciente al más antiguo (CA-7). */
export function mantenimientosOrdenados(lista) {
  return [...(Array.isArray(lista) ? lista : [])].sort((a, b) => {
    const abiertoA = !a.fecha_salida;
    const abiertoB = !b.fecha_salida;
    if (abiertoA !== abiertoB) return abiertoA ? -1 : 1;
    return String(b.fecha_intervencion ?? "").localeCompare(String(a.fecha_intervencion ?? ""));
  });
}

/** Los cambios de un movimiento, en frases cortas: «Responsable: Ana →
 * Luis». Lo que no cambió no se dice. */
export function cambiosDelMovimiento(m) {
  const pares = [
    ["Responsable", m?.custodio_anterior_nombre, m?.custodio_nuevo_nombre],
    ["Área", m?.departamento_anterior_nombre, m?.departamento_nuevo_nombre],
    ["Ciudad", m?.sede_anterior_nombre, m?.sede_nueva_nombre],
    ["Estado", ESTADOS[m?.estado_anterior]?.texto ?? m?.estado_anterior, ESTADOS[m?.estado_nuevo]?.texto ?? m?.estado_nuevo],
  ];
  return pares
    .filter(([, antes, despues]) => (antes || despues) && antes !== despues)
    .map(([nombre, antes, despues]) => `${nombre}: ${antes || "ninguno"} → ${despues || "ninguno"}`);
}

/** Si un activo admite asignar y registrar mantenimiento: sigue en el
 * parque. `esta_operativo` lo calcula el servidor. */
export function estaOperativo(activo) {
  if (typeof activo?.esta_operativo === "boolean") return activo.esta_operativo;
  return !esSalida(activo?.estado);
}

// --- Asignar (CA-8) -----------------------------------------------------------------

/** Lo que el formulario guarda al abrirse: los IDs como texto. */
export function valoresDeAsignacion(activo) {
  return {
    responsables: (activo?.responsables ?? []).map((p) => String(p.id)),
    departamento: activo?.departamento ? String(activo.departamento) : "",
    sede: activo?.sede ? String(activo.sede) : "",
    motivo: "",
  };
}

function mismos(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function hayCambioDeAsignacion(iniciales, valores) {
  return (
    !mismos(iniciales.responsables, valores.responsables) ||
    iniciales.departamento !== valores.departamento ||
    iniciales.sede !== valores.sede
  );
}

/** El cuerpo de `POST activos/{id}/asignar/`, como la web: la lista
 * completa de responsables después del cambio (vacía: devolución a bodega),
 * el área, la sede y el motivo. */
export function cuerpoDeAsignacion(valores) {
  return {
    responsables: valores.responsables.map(Number),
    departamento: valores.departamento ? Number(valores.departamento) : null,
    sede: valores.sede ? Number(valores.sede) : null,
    motivo: String(valores.motivo ?? "").trim(),
  };
}

/** Qué hará el movimiento, dicho antes de guardar. */
export function resumenDeAsignacion(iniciales, valores) {
  if (valores.responsables.length === 0 && iniciales.responsables.length > 0) {
    return "Devolución a bodega: el equipo queda sin responsable.";
  }
  if (!mismos(iniciales.responsables, valores.responsables)) return "Cambia quién responde por el equipo.";
  if (iniciales.sede !== valores.sede) return "Traslado: cambia la sede del equipo.";
  if (iniciales.departamento !== valores.departamento) return "Cambia el área del equipo.";
  return null;
}

// --- Escáner (CA-11, CA-12) ---------------------------------------------------------

/** El texto leído o escrito, listo para `por-codigo/`: sin espacios a los
 * lados ni saltos, hasta 120 caracteres (el largo del número de serie).
 * `null` si no queda nada, o si solo son puntos («.», «..»): en la ruta
 * serían otro recurso (QA-FUNC B5). */
export function codigoLeido(texto) {
  const limpio = String(texto ?? "")
    .replace(/[\r\n\t]+/g, "")
    .trim()
    .slice(0, 120);
  if (!limpio || /^\.+$/.test(limpio)) return null;
  return limpio;
}

/** Si el código no cabe en la ruta `por-codigo/{codigo}/` del servidor
 * (`[^/.]+`) porque lleva «.» o «/». Entonces se busca con `GET
 * activos/?q=` (QA-FUNC B5). */
export function codigoFueraDeRuta(codigo) {
  return /[./]/.test(String(codigo ?? ""));
}

/** De los resultados de `GET activos/?q=codigo`, el único cuya etiqueta o
 * serie es exactamente esa. `null` si no hay ninguno o hay varios. Siempre
 * exacto: `q` también busca en el nombre y el responsable, y un código que
 * no existe no debe abrir otro activo (QA-TECH, revalidación de la US-022). */
export function activoDelCodigo(lista, codigo) {
  const filas = Array.isArray(lista) ? lista : [];
  const buscado = String(codigo ?? "").toLowerCase();
  const exactos = filas.filter(
    (a) => String(a.codigo_barras ?? "").toLowerCase() === buscado || String(a.numero_serie ?? "").toLowerCase() === buscado,
  );
  return exactos.length === 1 ? exactos[0] : null;
}

export const TEXTO_CODIGO_NO_ENCONTRADO = "Ningún activo corresponde a ese código. Revíselo o búsquelo en el Inventario.";
export const TEXTO_CODIGO_AMBIGUO = "Varios activos coinciden con ese código: búsquelo en el Inventario.";

/** Lo que dice el lector de pantalla del resumen del escáner (UX H-05):
 * código, nombre, estado, responsable y lugar. */
export function resumenDelEscaneo(activo) {
  return [
    `Activo encontrado: ${[activo?.codigo_barras, activo?.nombre].filter(Boolean).join(", ")}`,
    `Estado: ${estadoDelActivo(activo?.estado, activo?.estado_display).texto}`,
    `Responsable: ${activo?.responsables_resumen || "sin asignar"}`,
    lugarDe(activo) ? `Lugar: ${lugarDe(activo)}` : null,
  ]
    .filter(Boolean)
    .join(". ");
}

// --- Solicitudes (CA-20; el resto, en `solicitudes.js`) ----------------------------

/** Las transiciones válidas de una solicitud (`Solicitud.TRANSICIONES`). */
export const TRANSICIONES_DE_SOLICITUD = {
  pendiente: ["en_gestion", "rechazada", "cancelada"],
  en_gestion: ["comprada", "rechazada", "cancelada"],
  comprada: ["entregada"],
  entregada: [],
  rechazada: [],
  cancelada: [],
};

export function transicionesDeSolicitud(estado) {
  return TRANSICIONES_DE_SOLICITUD[estado] ?? [];
}

// --- Lo que se hace en la web (CA-10) ----------------------------------------------

/** Del módulo, con el permiso que lo muestra en el menú de la web
 * (`staticAdminMenu.js` y `AppRoutes.jsx`). «Registrar activo» ya no está
 * aquí: se hace en la app desde la US-023 (16/11/2026). */
export const ACTIVOS_EN_LA_WEB = [
  { permisos: ["activos.crear"], nombre: "Carga masiva", ruta: "/admin/activos/importar", icono: "file-excel-outline" },
  { permisos: ["alertas.ver"], nombre: "Alertas", ruta: "/admin/alertas", icono: "bell-alert-outline" },
  { permisos: ["politicas.ver"], nombre: "Renovación", ruta: "/admin/renovacion/sugerencias", icono: "autorenew" },
  // US-028 (CA-6, 17/11/2026): con el permiso de su grupo en el menú web
  // («Renovación», «Activos» y «Mantenimientos»), que sus hijos heredan.
  { permisos: ["politicas.ver"], nombre: "Políticas", ruta: "/admin/politicas", icono: "tune-variant" },
  { permisos: ["activos.ver"], nombre: "Categorías", ruta: "/admin/activos/categorias", icono: "tag-multiple-outline" },
  { permisos: ["activos.ver"], nombre: "Tipos de dispositivo", ruta: "/admin/activos/tipos", icono: "shape-outline" },
  { permisos: ["mantenimientos.ver"], nombre: "Componentes", ruta: "/admin/mantenimientos/componentes", icono: "chip" },
];

export function activosEnLaWeb(permisos) {
  const p = lista(permisos);
  return ACTIVOS_EN_LA_WEB.filter((a) => a.permisos.some((x) => p.includes(x)));
}

/** De la ficha de un activo: imprimir la etiqueta y la ficha completa
 * (adjuntos, actas, depreciación…). «Editar» se hace en la app desde la
 * US-023 (16/11/2026). */
export function fichaEnLaWeb(activo, permisos) {
  const p = lista(permisos);
  const id = Number(activo?.id);
  if (!Number.isInteger(id) || id <= 0) return [];
  return [
    {
      permiso: "activos.imprimir_etiqueta",
      nombre: "Imprimir etiqueta",
      ruta: `/admin/activos/${id}?accion=etiqueta`,
      icono: "printer-outline",
    },
    { permiso: "activos.ver", nombre: "Ficha completa", ruta: `/admin/activos/${id}`, icono: "file-document-outline" },
  ].filter((a) => p.includes(a.permiso));
}

// --- Errores (CA-2) -----------------------------------------------------------------

export const TEXTO_MODULO_APAGADO = "Gestión de Activos no está activa en su empresa.";
export const TEXTO_SIN_PERMISO = "No tiene permiso para esto en Gestión de Activos.";
export const TEXTO_PUEDE_HABERSE_GUARDADO =
  "No hubo respuesta del servidor: puede que sí se haya guardado. Revise la ficha antes de reintentar; lo que escribió se conserva.";
export const TEXTO_NO_DISPONIBLE = "Este activo no existe o ya no tiene acceso a él.";

export function esModuloApagado(error) {
  return error?.response?.status === 403 && error?.response?.data?.error?.code === "modulo_apagado";
}

/** El módulo apagado y la falta de permiso con un mensaje claro (CA-2),
 * como la Mesa de ayuda; en un guardado sin respuesta clara, que pudo
 * haberse hecho. */
export function mensajeDeActivos(error, porDefecto, { envio = false } = {}) {
  if (esModuloApagado(error)) return TEXTO_MODULO_APAGADO;
  if (envio && sinRespuestaClara(error)) return TEXTO_PUEDE_HABERSE_GUARDADO;
  if (error?.response?.status === 403) {
    // «No tiene el permiso requerido: activos.asignar.» nombra el código del
    // permiso: es un error técnico para quien usa la app (CA-2).
    const propio = limpiarMensaje(error.response.data?.error?.message);
    const tecnico = /^(You do not have|No tiene el permiso requerido)/i.test(propio ?? "");
    return propio && propio !== "Error en la solicitud." && !tecnico ? propio : TEXTO_SIN_PERMISO;
  }
  return mensajeDeError(error, porDefecto);
}
