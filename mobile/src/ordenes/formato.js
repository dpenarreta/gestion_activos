import { limpiarMensaje, mensajeDeError } from "../api/errores";
import { dinero } from "../activos/formato";
import { sinRespuestaClara, TONOS } from "../soporte/formato";

/**
 * Cómo se dicen y se pintan las órdenes de trabajo en la app (US-025,
 * 17/11/2026), con los mismos textos que la web (`PanelOrdenes.jsx`,
 * `OrdenesList.jsx`, `OrdenDetalle.jsx`, `OrdenForm.jsx`, `comunes.jsx` y
 * `RegistrarProveedorDialog.jsx`). Es código puro: lo usan el catálogo de la
 * navegación, las pantallas y las pruebas. Cada estado, prioridad y
 * cumplimiento lleva su texto y su ícono, nunca solo el color.
 *
 * Lo que la persona puede hacer con una orden lo decide el servidor
 * (`permisos` del detalle): la app no calcula transiciones, para no ofrecer
 * pasos que se rechazarían.
 */

function lista(permisos) {
  return Array.isArray(permisos) ? permisos : [];
}

// --- Permisos (CA-1, CA-14, CA-17) -------------------------------------------------

/** El módulo, el Panel y «Mis órdenes»: `ordenes.ver`, el de su menú y sus
 * rutas en la web. Sin él, el módulo no tiene pestaña. */
export function veLasOrdenes(permisos) {
  return lista(permisos).includes("ordenes.ver");
}

/** «Nueva orden»: `ordenes.crear` (la ruta `ordenes/lista/nueva` de la web),
 * dentro del módulo, que pide `ordenes.ver`. */
export function puedeCrearOrdenes(permisos) {
  return veLasOrdenes(permisos) && lista(permisos).includes("ordenes.crear");
}

/** Lo del módulo que se hace en la web (CA-17), con el permiso de su ruta
 * (`AppRoutes.jsx`): la reportería con su exportación a Excel y PDF, y el
 * listado completo con sus filtros (cerradas, estado, región). Se abren con
 * un botón redondo y la confirmación de salida (regla del 16/11/2026). */
export const ORDENES_EN_LA_WEB = [
  { permisos: ["ordenes.reportes"], nombre: "Reportes y exportación", ruta: "/admin/reportes/ordenes", icono: "chart-box-outline" },
  { permisos: ["ordenes.ver"], nombre: "Listado completo", ruta: "/admin/ordenes/lista", icono: "format-list-bulleted" },
];

export function ordenesEnLaWeb(permisos) {
  const p = lista(permisos);
  return ORDENES_EN_LA_WEB.filter((a) => a.permisos.some((x) => p.includes(x)));
}

// --- Estado, prioridad y cumplimiento ---------------------------------------------

/** Los siete estados de `OrdenTrabajo.Estado`, con el tono de la web
 * (`comunes.jsx`: lo que espera a alguien resalta, lo que está en marcha se
 * lee como información, lo cerrado se calma) y un ícono propio. */
export const ESTADOS = {
  solicitada: { texto: "Solicitada", tono: "neutro", icono: "tray-arrow-down" },
  asignada: { texto: "Asignada", tono: "info", icono: "account-arrow-right-outline" },
  programada: { texto: "Programada", tono: "info", icono: "calendar-clock" },
  en_ejecucion: { texto: "En ejecución", tono: "info", icono: "progress-wrench" },
  pausada: { texto: "Pausada", tono: "aviso", icono: "pause-circle-outline" },
  pendiente_aprobacion: { texto: "Pendiente de aprobación", tono: "aviso", icono: "timer-sand" },
  cerrada: { texto: "Cerrada", tono: "bien", icono: "check-circle-outline" },
};

export const PRIORIDADES = {
  critica: { texto: "Crítica", tono: "mal", icono: "alert-octagon-outline" },
  alta: { texto: "Alta", tono: "mal", icono: "chevron-double-up" },
  media: { texto: "Media", tono: "neutro", icono: "equal" },
  baja: { texto: "Baja", tono: "neutro", icono: "chevron-down" },
};

export const CUMPLIMIENTOS = {
  cerrada: { texto: "Cerrada", tono: "bien", icono: "check-circle-outline" },
  vencida: { texto: "Vencida", tono: "mal", icono: "clock-alert-outline" },
  en_plazo: { texto: "En plazo", tono: "info", icono: "clock-check-outline" },
  sin_fecha: { texto: "Sin fecha", tono: "neutro", icono: "calendar-blank-outline" },
};

function conTono(base, texto) {
  return { ...TONOS[base.tono], icono: base.icono, texto };
}

/** `{texto, fondo, color, icono}` del estado; el texto de la API manda. */
export function estadoDeLaOrden(orden) {
  const base = ESTADOS[orden?.estado] ?? { texto: orden?.estado || "—", tono: "neutro", icono: "help-circle-outline" };
  return conTono(base, orden?.estado_display || base.texto);
}

/** «Prioridad: Alta», como en la Mesa de ayuda. */
export function prioridadDeLaOrden(orden) {
  const base = PRIORIDADES[orden?.prioridad] ?? { texto: orden?.prioridad || "—", tono: "neutro", icono: "flag-outline" };
  return conTono(base, `Prioridad: ${orden?.prioridad_display || base.texto}`);
}

export function cumplimientoDeLaOrden(orden) {
  const base = CUMPLIMIENTOS[orden?.cumplimiento] ?? { texto: "—", tono: "neutro", icono: "help-circle-outline" };
  return conTono(base, base.texto);
}

/** El dinero de una orden: «$0,00» también, porque es lo que vale (prueba
 * del Tech Lead en el teléfono, 17/11/2026: el «—» de la web en cero
 * parecía un dato que faltaba). «—» solo si no llegó el valor. */
export function moneda(valor) {
  return valor === null || valor === undefined ? "—" : dinero(valor);
}

/** Si el cumplimiento dice algo propio. En una orden cerrada repetiría la
 * píldora «Cerrada» del estado (prueba del Tech Lead, 17/11/2026): no se
 * muestra ni se dice. */
export function muestraCumplimiento(orden) {
  return orden?.cumplimiento !== "cerrada";
}

/**
 * El teléfono de contacto tal como llega (CA-9): enmascarado («•••••••123»)
 * para quien no tiene `ordenes.ver_contacto`, completo para quien sí. El
 * lector no deletrea los puntos: dice «oculto, termina en 123» (UX H-07). Con
 * el número completo se ofrece «Llamar» (`tel:`).
 */
export function contactoDe(orden) {
  const valor = String(orden?.contacto ?? "").trim();
  if (!valor) return { texto: "—", dicho: "Teléfono de contacto: sin registrar", llamar: null };
  if (valor.includes("•")) {
    const final = valor.replace(/\D/g, "");
    return { texto: valor, dicho: `Teléfono de contacto: oculto, termina en ${final}`, llamar: null };
  }
  const digitos = valor.replace(/[^\d+]/g, "");
  return { texto: valor, dicho: `Teléfono de contacto: ${valor}`, llamar: digitos.length >= 7 ? `tel:${digitos}` : null };
}

/** El nombre del grupo de píldoras de la cabecera de la ficha. */
export function resumenDePildoras(orden) {
  return [
    prioridadDeLaOrden(orden).texto,
    `Estado: ${estadoDeLaOrden(orden).texto}`,
    muestraCumplimiento(orden) ? `Cumplimiento: ${cumplimientoDeLaOrden(orden).texto}` : null,
  ]
    .filter(Boolean)
    .join(". ");
}

/** «Matriz Quito · Quito». */
export function sedeDe(orden) {
  const sede = orden?.sede ?? {};
  return [sede.nombre, sede.ciudad && sede.ciudad !== sede.nombre ? sede.ciudad : null].filter(Boolean).join(" · ");
}

/** «Sierra · Pichincha», o "" sin datos. */
export function regionDe(orden) {
  const sede = orden?.sede ?? {};
  return [sede.region_display, sede.provincia].filter(Boolean).join(" · ");
}

// --- Panel (CA-3 a CA-5) ------------------------------------------------------------

function cifra(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Los ocho indicadores del panel, en el orden y con los nombres de la web.
 * Abiertas y vencidas van destacadas (CA-3). */
export function kpisDelPanel(kpis) {
  const k = kpis ?? {};
  return [
    { clave: "registradas", titulo: "Órdenes registradas", cifra: cifra(k.registradas), icono: "clipboard-text-outline", tono: "neutro" },
    { clave: "abiertas", titulo: "Abiertas", cifra: cifra(k.abiertas), icono: "folder-open-outline", tono: "info", destacada: true },
    { clave: "vencidas", titulo: "Vencidas", cifra: cifra(k.vencidas), icono: "clock-alert-outline", tono: "mal", destacada: true },
    { clave: "cerradas", titulo: "Cerradas", cifra: cifra(k.cerradas), icono: "check-circle-outline", tono: "bien" },
    { clave: "costo_total", titulo: "Costo total (con IVA)", cifra: moneda(k.costo_total), icono: "cash-multiple", tono: "info" },
    { clave: "prioridad_alta", titulo: "Prioridad alta o crítica", cifra: cifra(k.prioridad_alta), icono: "lightning-bolt-outline", tono: "aviso" },
    {
      clave: "pendientes_aprobacion",
      titulo: "Pendientes de aprobación",
      cifra: cifra(k.pendientes_aprobacion),
      icono: "timer-sand",
      tono: "aviso",
    },
    { clave: "con_observaciones", titulo: "Con observaciones", cifra: cifra(k.con_observaciones), icono: "comment-alert-outline", tono: "aviso" },
  ];
}

export const TEXTO_NADA_PENDIENTE = "Nada pendiente en su alcance";
export const TEXTO_SIN_ACTIVIDAD = "Todavía no hay movimientos.";

// --- Mis órdenes (CA-7, CA-8) -------------------------------------------------------

export const ESPERA_BUSCAR_MS = 400;

/** Las dos pestañas de «Mis órdenes»: solo las abiertas. */
export const PESTANAS = [
  { clave: "mias", texto: "Creadas por mí" },
  { clave: "asignadas", texto: "Asignadas a mí" },
];

export function pestanaValida(clave) {
  return PESTANAS.some((p) => p.clave === clave) ? clave : "mias";
}

/** Los parámetros de `GET ordenes/` de una pestaña. */
export function parametrosDeMisOrdenes({ ambito, q, pagina = 1 }) {
  const params = { ambito: pestanaValida(ambito), abiertas: "true" };
  const texto = String(q ?? "").trim();
  if (texto) params.q = texto;
  if (pagina > 1) params.page = pagina;
  return params;
}

export function cuantasOrdenes(n) {
  const total = Number(n) || 0;
  return `${total} ${total === 1 ? "orden abierta" : "órdenes abiertas"}`;
}

/** «Creadas por mí, 3 órdenes abiertas»: el nombre de la pestaña con su
 * contador (sin contador aún, solo el nombre). */
export function nombreDePestana(pestana, cuenta) {
  if (cuenta === null || cuenta === undefined) return pestana.texto;
  return `${pestana.texto}, ${cuantasOrdenes(cuenta)}`;
}

/** Lo que dice una pestaña vacía (CA-7): quien no ejecuta órdenes sabe por
 * qué «Asignadas a mí» no tiene nada. */
export function textoDeListaVacia(ambito, { busqueda, permisos } = {}) {
  if (busqueda) return `Ninguna orden abierta coincide con «${busqueda}».`;
  if (ambito === "asignadas") {
    if (!lista(permisos).includes("ordenes.ejecutar")) {
      return "Aquí aparecen las órdenes que le asignan para ejecutar. Solo las reciben quienes ejecutan órdenes (técnicos internos o de un proveedor), y usted no tiene ese permiso.";
    }
    return "No tiene órdenes abiertas asignadas a usted.";
  }
  return "No tiene órdenes abiertas creadas por usted.";
}

/** «Programada: 20/11/2026» o «Sin fecha programada». */
export function textoDeProgramada(fecha, fechaCorta) {
  return fecha ? `Programada: ${fechaCorta(fecha)}` : "Sin fecha programada";
}

/** El nombre accesible de una fila (CA-8): todo lo que se ve, en orden. */
export function nombreDeFila(orden, fechaCorta) {
  return [
    orden?.numero,
    orden?.titulo,
    sedeDe(orden) ? `Sede: ${sedeDe(orden)}` : null,
    prioridadDeLaOrden(orden).texto,
    `Estado: ${estadoDeLaOrden(orden).texto}`,
    muestraCumplimiento(orden) ? `Cumplimiento: ${cumplimientoDeLaOrden(orden).texto}` : null,
    textoDeProgramada(orden?.fecha_programada, fechaCorta),
    `Responsable: ${orden?.responsable || "Sin asignar"}`,
  ]
    .filter(Boolean)
    .join(". ");
}

// --- Cambios de estado (CA-10) ------------------------------------------------------

/**
 * El verbo de cada paso, el de la web (`textoDelPaso` de `OrdenDetalle.jsx`):
 * «En ejecución» es «Iniciar ejecución» la primera vez, «Reanudar» tras una
 * pausa y «Devolver a ejecución» cuando quien acepta encuentra el trabajo
 * incompleto.
 */
export function textoDelPaso(destino, actual) {
  if (destino === "en_ejecucion") {
    if (actual === "pausada") return "Reanudar";
    if (actual === "pendiente_aprobacion") return "Devolver a ejecución";
    return "Iniciar ejecución";
  }
  return (
    {
      programada: "Programar",
      pausada: "Pausar",
      pendiente_aprobacion: "Enviar a aprobación",
      cerrada: "Aceptar y cerrar",
    }[destino] ?? ESTADOS[destino]?.texto ?? destino
  );
}

const ICONOS_DEL_PASO = {
  programada: "calendar-clock",
  en_ejecucion: "play-circle-outline",
  pausada: "pause-circle-outline",
  pendiente_aprobacion: "send-check-outline",
  cerrada: "check-decagram-outline",
};

export function iconoDelPaso(destino, actual) {
  if (destino === "en_ejecucion" && actual === "pendiente_aprobacion") return "undo-variant";
  return ICONOS_DEL_PASO[destino] ?? "arrow-right-circle-outline";
}

/** Las acciones que el servidor permite (`permisos.acciones`), sin
 * «asignada» (se llega con «Asignar»), cada una con su verbo. */
export function pasosDisponibles(orden) {
  const acciones = Array.isArray(orden?.permisos?.acciones) ? orden.permisos.acciones : [];
  return acciones
    .filter((destino) => destino !== "asignada")
    .map((destino) => ({
      destino,
      texto: textoDelPaso(destino, orden?.estado),
      icono: iconoDelPaso(destino, orden?.estado),
      // UX H-04 (17/11/2026): lo que hace avanzar la orden es el botón
      // primario; pausar y devolver, secundarios.
      avanza: destino !== "pausada" && !esDevolucion(destino, orden?.estado),
    }));
}

/** Si el paso es devolver el trabajo (de pendiente de aprobación a
 * ejecución). */
export function esDevolucion(destino, actual) {
  return destino === "en_ejecucion" && actual === "pendiente_aprobacion";
}

/** Si el paso exige una nota (las reglas de `OrdenService.cambiar_estado`):
 * pausar y devolver siempre; cerrar, con observaciones. */
export function notaObligatoria(destino, actual, conObservaciones = false) {
  return destino === "pausada" || esDevolucion(destino, actual) || (destino === "cerrada" && Boolean(conObservaciones));
}

/** Los mensajes del servidor, para validar antes de enviar. */
export const TEXTO_NOTA_OBLIGATORIA = "Diga el motivo: es lo que lee quien tiene que retomar la orden.";
export const TEXTO_OBSERVACIONES_OBLIGATORIAS = "Escriba las observaciones: es lo que queda pendiente de revisar.";
export const TEXTO_FECHA_PARA_PROGRAMAR = "Indique para qué fecha se programa.";
export const TEXTO_SIN_FECHA = "Indique la fecha en que debe cumplirse la orden.";
export const TEXTO_FECHA_PASADA = "La fecha programada no puede ser anterior a hoy.";

/** `{campo: mensaje}` de un cambio de estado; vacío si se puede enviar. */
export function validarCambioDeEstado({ destino, actual, nota, fecha, conObservaciones, fechaActual, hoy }) {
  const errores = {};
  const texto = String(nota ?? "").trim();
  if (notaObligatoria(destino, actual, conObservaciones) && !texto) {
    errores.nota = destino === "cerrada" ? TEXTO_OBSERVACIONES_OBLIGATORIAS : TEXTO_NOTA_OBLIGATORIA;
  }
  if (destino === "programada") {
    if (!fecha && !fechaActual) errores.fecha_programada = TEXTO_FECHA_PARA_PROGRAMAR;
    else if (fecha && fecha !== fechaActual && hoy && fecha < hoy) errores.fecha_programada = TEXTO_FECHA_PASADA;
  }
  return errores;
}

/** El cuerpo de `cambiar-estado/`. */
export function cuerpoDelCambioDeEstado({ destino, nota, fecha, conObservaciones }) {
  const cuerpo = { estado: destino, nota: String(nota ?? "").trim() };
  if (destino === "programada" && fecha) cuerpo.fecha_programada = fecha;
  if (destino === "cerrada") cuerpo.con_observaciones = Boolean(conObservaciones);
  return cuerpo;
}

/** Lo que se anuncia tras el paso. */
export function resultadoDelPaso(destino, actual, conObservaciones = false) {
  if (destino === "cerrada") return conObservaciones ? "Orden aceptada con observaciones y cerrada." : "Orden aceptada y cerrada.";
  if (esDevolucion(destino, actual)) return "Orden devuelta a ejecución.";
  return (
    {
      programada: "Orden programada.",
      en_ejecucion: actual === "pausada" ? "Orden reanudada." : "Ejecución iniciada.",
      pausada: "Orden pausada.",
      pendiente_aprobacion: "Orden enviada a aprobación.",
    }[destino] ?? "Estado actualizado."
  );
}

// --- Asignar (CA-11) ----------------------------------------------------------------

/** Solo se reasigna una orden solicitada, asignada, programada o pausada
 * (`OrdenService.asignar`): en ejecución o pendiente de aprobación el
 * servidor la rechaza, así que la app no ofrece un botón que fallaría. */
export const ESTADOS_QUE_SE_ASIGNAN = ["solicitada", "asignada", "programada", "pausada"];

export function puedeAsignarse(orden) {
  return Boolean(orden?.permisos?.asignar) && ESTADOS_QUE_SE_ASIGNAN.includes(orden?.estado);
}

export const TEXTO_SIN_RESPONSABLE_ASIGNAR = "Indique el técnico o el proveedor que realizará la orden.";
export const TEXTO_SIN_CAMBIOS_ASIGNAR = "No cambió nada: elija otro técnico, otro proveedor u otra fecha.";

export function valoresDeAsignacion(orden) {
  return {
    tecnico: orden?.tecnico?.id ? String(orden.tecnico.id) : "",
    proveedor: orden?.proveedor?.id ? String(orden.proveedor.id) : "",
    fecha_programada: orden?.fecha_programada ?? "",
    nota: "",
  };
}

/** Las reglas del formulario de la web: técnico o proveedor; vaciar una
 * fecha que existía no la quita; una fecha nueva, de hoy en adelante. */
export function validarAsignacion(iniciales, valores, hoy) {
  const errores = {};
  if (!valores.tecnico && !valores.proveedor) errores.tecnico = TEXTO_SIN_RESPONSABLE_ASIGNAR;
  const cambioFecha = valores.fecha_programada !== iniciales.fecha_programada;
  if (!valores.fecha_programada && iniciales.fecha_programada) errores.fecha_programada = TEXTO_SIN_FECHA;
  else if (valores.fecha_programada && cambioFecha && hoy && valores.fecha_programada < hoy) {
    errores.fecha_programada = TEXTO_FECHA_PASADA;
  }
  return errores;
}

/** Solo lo que cambió (contrato de `asignar`, US-006): lo que no se envía se
 * conserva y `null` lo quita. La fecha solo va con valor. */
export function cuerpoDeAsignacion(iniciales, valores) {
  const datos = {};
  for (const campo of ["tecnico", "proveedor"]) {
    if (String(valores[campo] ?? "") !== String(iniciales[campo] ?? "")) {
      datos[campo] = valores[campo] ? Number(valores[campo]) : null;
    }
  }
  if (valores.fecha_programada && valores.fecha_programada !== iniciales.fecha_programada) {
    datos.fecha_programada = valores.fecha_programada;
  }
  const nota = String(valores.nota ?? "").trim();
  if (nota) datos.nota = nota;
  return datos;
}

/** «Orden asignada.», «Orden reasignada.» u «Orden reprogramada.», como la
 * web. */
export function resultadoDeAsignacion(orden, cuerpo) {
  const claves = Object.keys(cuerpo).filter((c) => c !== "nota");
  if (claves.length === 1 && claves[0] === "fecha_programada") return "Orden reprogramada.";
  return orden?.tecnico || orden?.proveedor ? "Orden reasignada." : "Orden asignada.";
}

// --- Materiales y mano de obra (CA-12) ----------------------------------------------

/** Un número escrito con coma o punto decimal y hasta dos decimales, sin
 * separadores de miles: «12,5» → «12.5». `null` si no vale. */
export function decimalDe(texto) {
  const limpio = String(texto ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  return limpio;
}

/** `enteros`: los dígitos antes de la coma que admite la base
 * (`max_digits` − 2 decimales de `MaterialOrden` y `ManoDeObraOrden`); se
 * validan antes de enviar (QA-TECH, 17/11/2026). */
export const TIPOS_DE_COSTO = {
  materiales: {
    titulo: "Agregar material",
    resultado: "Material registrado.",
    campos: [
      { clave: "descripcion", nombre: "Material" },
      { clave: "cantidad", nombre: "Cantidad", minimo: 0.01, ejemplo: "2 o 1,5", enteros: 8 },
      { clave: "costo_unitario", nombre: "Costo unitario", minimo: 0, ejemplo: "12,50", enteros: 10 },
    ],
  },
  "mano-de-obra": {
    titulo: "Agregar mano de obra",
    resultado: "Mano de obra registrada.",
    campos: [
      { clave: "descripcion", nombre: "Trabajo realizado" },
      { clave: "horas", nombre: "Horas", minimo: 0.25, ejemplo: "2 o 1,5", enteros: 4 },
      { clave: "costo_hora", nombre: "Costo por hora", minimo: 0, ejemplo: "8,00", enteros: 8 },
    ],
  },
};

export const LARGO_DESCRIPCION_COSTO = 150;

function cifraEscrita(n) {
  return String(n).replace(".", ",");
}

/** `{campo: mensaje}` de una fila de costo. */
export function validarCosto(tipo, valores) {
  const config = TIPOS_DE_COSTO[tipo];
  const errores = {};
  for (const campo of config.campos) {
    const valor = valores[campo.clave];
    if (campo.clave === "descripcion") {
      if (!String(valor ?? "").trim()) errores.descripcion = `Escriba ${tipo === "materiales" ? "el material" : "el trabajo realizado"}.`;
      continue;
    }
    if (!String(valor ?? "").trim()) {
      errores[campo.clave] = `Escriba ${campo.nombre.toLowerCase()}.`;
      continue;
    }
    const numero = decimalDe(valor);
    if (numero === null) {
      errores[campo.clave] = `Escriba un número, por ejemplo ${campo.ejemplo} (coma o punto decimal, hasta dos decimales).`;
    } else if (Number(numero) < campo.minimo || (campo.minimo > 0 && Number(numero) === 0)) {
      errores[campo.clave] = `Debe ser al menos ${cifraEscrita(campo.minimo)}.`;
    } else if (numero.split(".")[0].replace(/^0+(?=\d)/, "").length > campo.enteros) {
      errores[campo.clave] = `Es demasiado grande: como mucho ${campo.enteros} dígitos antes de la coma.`;
    }
  }
  return errores;
}

/** El cuerpo de `materiales/` o `mano-de-obra/`, con punto decimal. */
export function cuerpoDelCosto(tipo, valores) {
  const config = TIPOS_DE_COSTO[tipo];
  const cuerpo = {};
  for (const campo of config.campos) {
    cuerpo[campo.clave] = campo.clave === "descripcion" ? String(valores.descripcion ?? "").trim() : decimalDe(valores[campo.clave]);
  }
  return cuerpo;
}

/** «2 × $12,50» de una fila de material o de mano de obra. */
export function detalleDelCosto(tipo, fila) {
  if (tipo === "materiales") return `${cifraEscrita(Number(fila.cantidad))} × ${dinero(fila.costo_unitario)}`;
  const horas = Number(fila.horas);
  return `${cifraEscrita(horas)} ${horas === 1 ? "hora" : "horas"} × ${dinero(fila.costo_hora)}`;
}

// --- Corregir (CA-13) ---------------------------------------------------------------

/** Los datos que se corrigen. El teléfono, solo si el servidor lo da
 * completo (`telefono_contacto_editable`). */
export function valoresDeCorreccion(orden) {
  const valores = {
    titulo: orden?.titulo ?? "",
    descripcion: orden?.descripcion ?? "",
    categoria: orden?.categoria ?? "",
    prioridad: orden?.prioridad ?? "",
    sede: orden?.sede?.id ? String(orden.sede.id) : "",
  };
  if (orden?.telefono_contacto_editable !== null && orden?.telefono_contacto_editable !== undefined) {
    valores.telefono_contacto = orden.telefono_contacto_editable;
  }
  return valores;
}

export const TEXTO_TELEFONO = "Escriba un teléfono de 7 a 15 dígitos.";

export function telefonoValido(texto) {
  const valor = String(texto ?? "").trim();
  if (!valor) return true;
  const digitos = valor.replace(/\D/g, "").length;
  return digitos >= 7 && digitos <= 15;
}

export function validarCorreccion(valores) {
  const errores = {};
  if (!String(valores.titulo ?? "").trim()) errores.titulo = "Diga qué hay que hacer.";
  if (!valores.categoria) errores.categoria = "Elija la categoría.";
  if (!valores.prioridad) errores.prioridad = "Elija la prioridad.";
  if (!valores.sede) errores.sede = "Elija la sede.";
  if ("telefono_contacto" in valores && !telefonoValido(valores.telefono_contacto)) errores.telefono_contacto = TEXTO_TELEFONO;
  return errores;
}

/** Solo lo que cambió, con los textos sin espacios de más. */
export function cuerpoDeCorreccion(iniciales, valores) {
  const cuerpo = {};
  for (const campo of Object.keys(iniciales)) {
    const nuevo = typeof valores[campo] === "string" && campo !== "descripcion" ? valores[campo].trim() : valores[campo];
    if (String(nuevo ?? "") !== String(iniciales[campo] ?? "")) cuerpo[campo] = campo === "sede" ? Number(nuevo) : nuevo;
  }
  return cuerpo;
}

// --- Nueva orden (CA-14, CA-15) -----------------------------------------------------

export const LARGO_TITULO = 150;

export const TEXTO_SIN_RESPONSABLE = "Indique el proveedor o la persona que realizará la orden.";
export const TEXTO_RESPONSABLE_SIN_ELEGIR = "Elija de la lista quién realiza la orden o registre un proveedor nuevo.";
export const TEXTO_PROVEEDOR_SIN_ELEGIR = "Elija de la lista el proveedor o deje el campo vacío.";

export function valoresDeNuevaOrden() {
  return { sede: "", categoria: "", prioridad: "media", titulo: "", descripcion: "", telefono_contacto: "", fecha_programada: "" };
}

/** Si hay algo que se perdería al salir. */
export function hayCambiosEnLaOrden(iniciales, valores, responsable) {
  return Boolean(responsable) || Object.keys(iniciales).some((c) => String(valores[c] ?? "") !== String(iniciales[c] ?? ""));
}

/**
 * Las reglas de la web antes de enviar (`OrdenForm.jsx`): sede, categoría,
 * qué hay que hacer, quién la realiza (elegido de la lista) y la fecha, de
 * hoy en adelante. `textoResponsable` y `textoProveedor`: lo escrito en los
 * buscadores sin elegir.
 */
export function validarNuevaOrden({ valores, responsable, conProveedor, proveedorDePersona, textoResponsable, textoProveedor, hoy }) {
  const errores = {};
  if (!valores.sede) errores.sede = "Elija la sede.";
  if (!valores.categoria) errores.categoria = "Elija la categoría.";
  if (!String(valores.titulo ?? "").trim()) errores.titulo = "Diga qué hay que hacer.";
  if (!telefonoValido(valores.telefono_contacto)) errores.telefono_contacto = TEXTO_TELEFONO;
  if (!responsable) errores.responsable = String(textoResponsable ?? "").trim() ? TEXTO_RESPONSABLE_SIN_ELEGIR : TEXTO_SIN_RESPONSABLE;
  if (conProveedor && !proveedorDePersona && String(textoProveedor ?? "").trim()) errores.proveedor = TEXTO_PROVEEDOR_SIN_ELEGIR;
  if (!valores.fecha_programada) errores.fecha_programada = TEXTO_SIN_FECHA;
  else if (hoy && valores.fecha_programada < hoy) errores.fecha_programada = TEXTO_FECHA_PASADA;
  return errores;
}

/** El cuerpo de `POST ordenes/`: con una persona, `tecnico` y su proveedor
 * (o ninguno); con un proveedor, solo `proveedor`. */
export function cuerpoDeNuevaOrden(valores, responsable, proveedorDePersona) {
  const esPersona = responsable?.tipo === "persona";
  return {
    sede: Number(valores.sede),
    categoria: valores.categoria,
    prioridad: valores.prioridad,
    titulo: String(valores.titulo ?? "").trim(),
    descripcion: String(valores.descripcion ?? "").trim(),
    telefono_contacto: String(valores.telefono_contacto ?? "").trim(),
    fecha_programada: valores.fecha_programada,
    tecnico: esPersona ? responsable.id : null,
    proveedor: esPersona ? (proveedorDePersona?.id ?? null) : (responsable?.id ?? null),
  };
}

/**
 * Los errores 400 del alta, cada uno junto a su campo (la web,
 * `OrdenForm.jsx`): el del técnico va en «Quién la realiza», y el del
 * proveedor también cuando no hay una persona elegida (entonces el
 * proveedor es quien la realiza y no tiene campo propio).
 */
export function erroresDelAlta(campos, conProveedor) {
  const resultado = { ...campos };
  if (resultado.tecnico && !resultado.responsable) resultado.responsable = resultado.tecnico;
  delete resultado.tecnico;
  if (resultado.proveedor && !conProveedor) {
    resultado.responsable = [resultado.responsable, resultado.proveedor].filter(Boolean).join(" ");
    delete resultado.proveedor;
  }
  return resultado;
}

/** Las opciones del buscador de «Quién la realiza», en dos grupos. */
export function opcionesDeResponsables(datos, { soloProveedores = false } = {}) {
  const proveedores = (Array.isArray(datos?.proveedores) ? datos.proveedores : []).map((p) => ({
    tipo: "proveedor",
    id: p.id,
    nombre: p.nombre,
    proveedor: null,
  }));
  const personas = soloProveedores
    ? []
    : (Array.isArray(datos?.personas) ? datos.personas : []).map((p) => ({
        tipo: "persona",
        id: p.id,
        nombre: p.nombre,
        proveedor: p.proveedor ?? null,
      }));
  return { proveedores, personas };
}

// --- Proveedor nuevo (CA-15) --------------------------------------------------------

export const TEXTO_SIN_CONTACTO = "Indique un teléfono o un correo para contactarlo.";
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function valoresDeProveedor(nombre = "") {
  return { nombre, contacto: "", telefono: "", correo: "", identificacion: "" };
}

/** Los mismos mensajes que el servidor (`ProveedorRapidoSerializer`). Que
 * falten teléfono y correo es del grupo «Contacto» (`medio`). */
export function validarProveedor(valores) {
  const errores = {};
  if (!String(valores.nombre ?? "").trim()) errores.nombre = "Escriba el nombre o la razón social.";
  const telefono = String(valores.telefono ?? "").trim();
  const correo = String(valores.correo ?? "").trim();
  if (!telefono && !correo) errores.medio = TEXTO_SIN_CONTACTO;
  if (telefono && !telefonoValido(telefono)) errores.telefono = TEXTO_TELEFONO;
  if (correo && !CORREO.test(correo)) errores.correo = "Escriba un correo válido, como nombre@empresa.com.";
  const identificacion = String(valores.identificacion ?? "").trim();
  if (/^\d+$/.test(identificacion) && identificacion.length !== 10 && identificacion.length !== 13) {
    errores.identificacion = "Escriba la cédula (10 dígitos) o el RUC (13 dígitos).";
  }
  return errores;
}

export function cuerpoDelProveedor(valores) {
  return {
    nombre: String(valores.nombre ?? "").trim(),
    contacto: String(valores.contacto ?? "").trim(),
    telefono: String(valores.telefono ?? "").trim(),
    correo: String(valores.correo ?? "").trim(),
    identificacion: String(valores.identificacion ?? "").trim(),
  };
}

/** El 400 del servidor: con teléfono y correo vacíos, «falta el contacto»
 * llega en `telefono` y es del grupo. */
export function erroresDelProveedor(campos, valores) {
  const resultado = { ...campos };
  if (resultado.telefono && !String(valores.telefono ?? "").trim() && !String(valores.correo ?? "").trim()) {
    resultado.medio = resultado.telefono;
    delete resultado.telefono;
  }
  return resultado;
}

// --- Errores (CA-2) -----------------------------------------------------------------

export const TEXTO_MODULO_APAGADO = "Órdenes de trabajo no está activa en su empresa.";
export const TEXTO_SIN_PERMISO = "No tiene permiso para esto en Órdenes de trabajo.";
export const TEXTO_PUEDE_HABERSE_GUARDADO =
  "No hubo respuesta del servidor: puede que sí se haya guardado. Revise la orden antes de reintentar; lo que escribió se conserva.";
export const TEXTO_NO_DISPONIBLE = "Esta orden no existe o ya no tiene acceso a ella.";
export const TEXTO_SIN_PERMISO_CREAR = "No tiene permiso para registrar órdenes de trabajo en esta empresa.";

export function esModuloApagado(error) {
  return error?.response?.status === 403 && error?.response?.data?.error?.code === "modulo_apagado";
}

/** El módulo apagado y la falta de permiso con un mensaje claro (CA-2), como
 * Gestión de Activos y la Mesa de ayuda; el mensaje propio del servidor
 * («Esta orden la ejecuta el técnico asignado, o quien coordina.») se
 * respeta. En un guardado sin respuesta clara, que pudo haberse hecho. */
export function mensajeDeOrdenes(error, porDefecto, { envio = false } = {}) {
  if (esModuloApagado(error)) return TEXTO_MODULO_APAGADO;
  if (envio && sinRespuestaClara(error)) return TEXTO_PUEDE_HABERSE_GUARDADO;
  if (error?.response?.status === 403) {
    const propio = limpiarMensaje(error.response.data?.error?.message);
    const tecnico = /^(You do not have|No tiene el permiso requerido)/i.test(propio ?? "");
    return propio && propio !== "Error en la solicitud." && !tecnico ? propio : TEXTO_SIN_PERMISO;
  }
  return mensajeDeError(error, porDefecto);
}

/** Las opciones de `errorDeGuardado` para este módulo. */
export const OPCIONES_DE_ERROR = { mensaje: mensajeDeOrdenes, textoDudoso: TEXTO_PUEDE_HABERSE_GUARDADO };
