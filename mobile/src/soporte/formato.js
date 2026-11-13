import { limpiarMensaje, mensajeDeError } from "../api/errores";
import { colores } from "../tema/colores";
import { fechaYHora } from "../utils/fechas";

/**
 * Cómo se dicen y se pintan las cosas de la Mesa de ayuda (US-014,
 * 13/11/2026): los mismos textos que la web (`frontend/src/pages/Soporte/
 * comunes.jsx`, `TicketDetalle.jsx` y `CamposFormulario.jsx`), en lenguaje
 * llano y nunca solo con color: cada estado, prioridad y plazo lleva su
 * texto y su ícono.
 */

// --- Permisos -------------------------------------------------------------------------

/** Lo que hace a alguien parte del equipo de la mesa (`PERMISOS_SOPORTE` de
 * la web). La vista del equipo se confirma con `GET tickets/bandeja/`. */
export const PERMISOS_DEL_EQUIPO = ["soporte.atender", "soporte.ver_todos", "soporte.asignar", "soporte.registrar"];

export function esDelEquipo(permisos = []) {
  return PERMISOS_DEL_EQUIPO.some((p) => permisos.includes(p));
}

/**
 * Por dónde crea la persona un ticket a su nombre: «Soporte TI»
 * (`soporte.crear`) o la Mesa (`soporte.mesa_crear`, 09/11/2026). `null` si
 * no puede.
 */
export function rutaDeAltaPropia(permisos = []) {
  if (permisos.includes("soporte.crear")) return { desdeLaMesa: false };
  if (permisos.includes("soporte.mesa_crear")) return { desdeLaMesa: true };
  return null;
}

/** Lo de escritorio que se abre en el navegador (CA-20), con el permiso que
 * lo muestra en el menú de la web (`staticAdminMenu.js`). */
export const ACCESOS_EN_EL_NAVEGADOR = [
  { permisos: ["soporte.reportes"], nombre: "Reportes de la mesa", ruta: "/admin/reportes/soporte", icono: "chart-bar" },
  { permisos: ["soporte.configurar"], nombre: "Configuración de la mesa", ruta: "/admin/configuracion/soporte", icono: "cog-outline" },
  { permisos: ["soporte.formulario"], nombre: "Formulario de «Soporte TI»", ruta: "/admin/soporte/formulario", icono: "form-select" },
  { permisos: ["soporte.mi_horario"], nombre: "Mi horario de atención", ruta: "/admin/soporte/mi-horario", icono: "calendar-week" },
  { permisos: ["soporte.aprobar_horas"], nombre: "Horas fuera de horario", ruta: "/admin/soporte/horas", icono: "weather-night" },
];

export function accesosEnElNavegador(permisos = []) {
  return ACCESOS_EN_EL_NAVEGADOR.filter((a) => a.permisos.some((p) => permisos.includes(p)));
}

// --- Errores --------------------------------------------------------------------------

export const TEXTO_MODULO_APAGADO = "La Mesa de ayuda no está activa en su empresa.";
export const TEXTO_SIN_PERMISO = "No tiene permiso para esto en la Mesa de ayuda.";
/** CA-22: sin respuesta del servidor no se sabe si llegó (no hay clave de
 * idempotencia): se dice antes de reintentar. */
export const TEXTO_PUEDE_HABERSE_ENVIADO =
  "No hubo respuesta del servidor: puede que sí se haya enviado. Revise antes de reintentar; lo que escribió se conserva.";

/** G-2: sin una respuesta clara del servidor (sin red, un 502, 503 o 504 del
 * proxy, o una página HTML en lugar del JSON de la API) no se sabe si el
 * envío llegó. */
export function sinRespuestaClara(error) {
  if (error?.esDeRed) return true;
  const status = error?.response?.status;
  if ([502, 503, 504].includes(status)) return true;
  const datos = error?.response?.data;
  return typeof datos === "string" && /^\s*</.test(datos);
}

export function esModuloApagado(error) {
  return error?.response?.status === 403 && error?.response?.data?.error?.code === "modulo_apagado";
}

/** CA-3: el módulo apagado y la falta de permiso, con un mensaje claro; lo
 * demás, como en el resto de la app. Sin respuesta, si es un envío, que
 * puede haberse enviado. */
export function mensajeDeSoporte(error, porDefecto, { envio = false } = {}) {
  if (esModuloApagado(error)) return TEXTO_MODULO_APAGADO;
  if (envio && sinRespuestaClara(error)) return TEXTO_PUEDE_HABERSE_ENVIADO;
  if (error?.response?.status === 403) {
    const propio = error.response.data?.error?.message;
    return propio && propio !== "Error en la solicitud." ? propio : TEXTO_SIN_PERMISO;
  }
  return mensajeDeError(error, porDefecto);
}

/** Los textos de un `details` sin el nombre del campo («estado: …»). */
function textosSinCampo(valor) {
  if (typeof valor === "string") return [valor];
  if (Array.isArray(valor)) return valor.flatMap(textosSinCampo);
  if (valor && typeof valor === "object") return Object.values(valor).flatMap(textosSinCampo);
  return [];
}

/**
 * G-7: el error de una acción que se muestra en su ventana. Si el servidor lo
 * pone en un campo que no está en la pantalla («estado», «nivel»), se dice el
 * mensaje sin el nombre del campo. Sin respuesta clara, que pudo haberse
 * hecho (CA-22).
 */
export function mensajeDeAccion(error, porDefecto) {
  if (esModuloApagado(error) || sinRespuestaClara(error) || error?.response?.status === 403) {
    return mensajeDeSoporte(error, porDefecto, { envio: true });
  }
  const datos = error?.response?.data?.error;
  const mensaje = limpiarMensaje(datos?.message);
  if (mensaje && mensaje !== "Error en la solicitud.") return mensaje;
  const textos = textosSinCampo(datos?.details).map(limpiarMensaje).filter(Boolean);
  return textos.length ? textos.join(" ") : mensajeDeSoporte(error, porDefecto, { envio: true });
}

// --- Tonos ----------------------------------------------------------------------------

/** Cada tono con su fondo, su texto (contrastes de `colores.js`) e ícono. */
export const TONOS = {
  bien: { fondo: colores.bienFondo, color: colores.bienTexto },
  aviso: { fondo: colores.avisoFondo, color: colores.avisoTexto },
  mal: { fondo: colores.malFondo, color: colores.malTexto },
  info: { fondo: colores.infoFondo, color: colores.infoTexto },
  neutro: { fondo: colores.hundido, color: colores.tintaSuave },
};

const ESTADO = {
  nuevo: ["aviso", "tray-arrow-down"],
  asignado: ["info", "account-arrow-right-outline"],
  en_curso: ["bien", "progress-wrench"],
  esperando_usuario: ["neutro", "account-clock-outline"],
  esperando_aprobacion: ["aviso", "clipboard-clock-outline"],
  atendido: ["info", "check-circle-outline"],
  cerrado: ["neutro", "lock-outline"],
};

export function tonoDeEstado(estado) {
  const [tono, icono] = ESTADO[estado] ?? ["neutro", "label-outline"];
  return { ...TONOS[tono], icono };
}

const PRIORIDAD = {
  critica: ["mal", "fire"],
  alta: ["mal", "arrow-up-circle-outline"],
  media: ["neutro", "flag-outline"],
  baja: ["neutro", "flag-outline"],
};

export function tonoDePrioridad(prioridad) {
  const [tono, icono] = PRIORIDAD[prioridad] ?? ["neutro", "flag-outline"];
  return { ...TONOS[tono], icono };
}

// --- Catálogos ------------------------------------------------------------------------

export const ESTADOS = [
  ["nuevo", "En cola"],
  ["asignado", "Asignado"],
  ["en_curso", "En curso"],
  ["esperando_usuario", "Esperando al usuario"],
  ["esperando_aprobacion", "Esperando aprobación"],
  ["atendido", "Atendido"],
  ["cerrado", "Cerrado"],
];

export const PRIORIDADES = [
  ["critica", "P1 · Crítica"],
  ["alta", "P2 · Alta"],
  ["media", "P3 · Media"],
  ["baja", "P4 · Baja"],
];

/** Para el equipo (`IMPACTOS` y `URGENCIAS` de `comunes.jsx`). */
export const IMPACTOS = [
  ["alto", "Alto: toda la empresa, una sucursal o un proceso crítico"],
  ["medio", "Medio: un área o un grupo"],
  ["bajo", "Bajo: un usuario"],
];

export const URGENCIAS = [
  ["alta", "Alta: la operación está detenida"],
  ["media", "Media: degradada, con alternativa"],
  ["baja", "Baja: puede programarse"],
];

/** Impacto × urgencia → prioridad (la misma matriz del servidor). */
export const MATRIZ = {
  alto: { alta: "critica", media: "alta", baja: "media" },
  medio: { alta: "alta", media: "media", baja: "baja" },
  bajo: { alta: "media", media: "baja", baja: "baja" },
};

export function prioridadPorMatriz(impacto, urgencia) {
  return MATRIZ[impacto]?.[urgencia] ?? null;
}

/** Los nombres de la empresa (`GET etiquetas/`) o, si no llegan, los de
 * siempre. */
export function nombreDe(lista, valor) {
  return (lista ?? []).find(([v]) => v === valor)?.[1] ?? valor ?? "";
}

// --- Textos de quien pide -------------------------------------------------------------


/** La posición en la cola, en palabras. */
export function enLaCola(posicion) {
  if (!posicion) return null;
  if (posicion === 1) return "Es el siguiente en la cola.";
  const antes = posicion - 1;
  return `Hay ${antes} ${antes === 1 ? "ticket" : "tickets"} antes que el suyo.`;
}

/** Qué sigue con un ticket propio (`queSigue` de la web). `accion`: le toca
 * a la persona. */
export function queSigue(ticket) {
  switch (ticket?.estado) {
    case "esperando_usuario":
      return { texto: "Le respondieron: lea y conteste", accion: true };
    case "atendido":
      return { texto: "Confirme si quedó resuelto", accion: true };
    case "esperando_aprobacion":
      return { texto: "Esperando la aprobación", accion: false };
    case "nuevo":
      return ticket.atrasado
        ? { texto: `Tarda más de lo previsto. ${enLaCola(ticket.posicion) ?? ""}`.trim(), accion: false, atrasado: true }
        : { texto: enLaCola(ticket.posicion) ?? "Esperando a soporte", accion: false };
    case "cerrado":
      return ticket.puede_encuestar
        ? { texto: "Cuéntenos cómo le fue", accion: true }
        : { texto: "Cerrado", accion: false };
    default:
      return ticket?.atrasado
        ? { texto: "Tarda más de lo previsto; soporte ya fue avisado", accion: false, atrasado: true }
        : { texto: "Soporte lo está trabajando", accion: false };
  }
}

/** Primero lo que pide algo de la persona, después lo abierto y al final lo
 * cerrado; dentro de cada grupo, el orden del servidor. */
export function ordenarMisTickets(lista = []) {
  const peso = (t) => (queSigue(t).accion ? 0 : t.estado === "cerrado" ? 2 : 1);
  return lista
    .map((t, i) => ({ t, i }))
    .sort((a, b) => peso(a.t) - peso(b.t) || a.i - b.i)
    .map(({ t }) => t);
}

export function pendientesDeMisTickets(lista = []) {
  return (lista ?? []).filter((t) => queSigue(t).accion).length;
}

/** Lo que cuenta «Para hoy» (G-5, decisión del Tech Lead, 13/11/2026): lo que
 * pide algo de la persona, salvo la encuesta de un ticket cerrado, que no es
 * urgente. En la lista sigue diciéndose («Cuéntenos cómo le fue»). */
export function pendientesParaHoy(lista = []) {
  return (lista ?? []).filter((t) => queSigue(t).accion && t.estado !== "cerrado").length;
}

// --- Plazos ---------------------------------------------------------------------------

/** Minutos en palabras: «45 min», «4 h», «2 h 30 min». */
export function enHoras(minutos) {
  if (minutos === null || minutos === undefined) return "—";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** Cuánto pasó o falta: «9 d», «3 h», «25 min». */
export function lapso(minutos) {
  const m = Math.max(0, Math.round(Math.abs(minutos)));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return enHoras(Math.round(m / 60) * 60);
  return `${Math.round(m / (24 * 60))} d`;
}

function minutosHasta(fecha, ahora) {
  return (new Date(fecha).getTime() - ahora) / 60000;
}

const SLA = {
  en_plazo: ["En plazo", "bien"],
  por_vencer: ["Por vencer", "aviso"],
  vencido: ["Vencido", "mal"],
  pausado: ["En pausa", "neutro"],
  sin_correr: ["Sin iniciar", "neutro"],
  cumplido: ["Cumplido", "bien"],
  incumplido: ["Incumplido", "mal"],
};

const ICONO_DE_TONO = {
  bien: "clock-check-outline",
  aviso: "clock-alert-outline",
  mal: "alert-octagon-outline",
  neutro: "pause-circle-outline",
  info: "clock-outline",
};

function plazo(texto, tono, fecha = null) {
  return { texto, ...TONOS[tono], icono: ICONO_DE_TONO[tono], fecha: fecha ? fechaYHora(fecha) : null };
}

/** El plazo que importa ahora (`VenceTicket` de la web): el de respuesta
 * mientras nadie respondió, y después el de solución. */
export function textoDeVence(sla, ahora = Date.now()) {
  const respuesta = sla?.respuesta;
  if (respuesta?.estado === "vencida") {
    return plazo(`Respuesta vencida hace ${lapso(minutosHasta(respuesta.vence, ahora))}`, "mal");
  }
  if (respuesta?.estado === "en_plazo") {
    // H-20: en ámbar solo si está por vencer (queda la cuarta parte del plazo
    // o menos de 15 min); si no, en plazo.
    const quedan = minutosHasta(respuesta.vence, ahora);
    const total = Number(respuesta.minutos) || 0;
    const porVencer = quedan <= Math.max(15, total * 0.25);
    return plazo(`Responder en ${lapso(quedan)}`, porVencer ? "aviso" : "bien", respuesta.vence);
  }
  if (sla?.estado === "vencido") return plazo(`Solución vencida hace ${lapso(minutosHasta(sla.vence, ahora))}`, "mal");
  if (sla?.estado === "por_vencer" || sla?.estado === "en_plazo") {
    return plazo(
      `Solucionar en ${lapso(minutosHasta(sla.vence, ahora))}`,
      sla.estado === "por_vencer" ? "aviso" : "bien",
      sla.vence,
    );
  }
  if (sla?.estado === "pausado") {
    return plazo(
      sla.restante_en_pausa === null || sla.restante_en_pausa === undefined
        ? "En pausa"
        : `En pausa · quedan ${enHoras(sla.restante_en_pausa)}`,
      "neutro",
    );
  }
  const [texto, tono] = SLA[sla?.estado] ?? ["Sin plazo", "neutro"];
  return plazo(texto, tono);
}

/** El reloj de solución, para «Datos» (`SlaTicket`). */
export function textoDeSolucion(sla) {
  const [texto, tono] = SLA[sla?.estado] ?? ["—", "neutro"];
  const conFecha = sla?.vence && ["en_plazo", "por_vencer", "vencido"].includes(sla.estado);
  const resultado = plazo(texto, tono, conFecha ? sla.vence : null);
  if (sla?.estado === "pausado" && sla.restante_en_pausa !== null && sla.restante_en_pausa !== undefined) {
    resultado.texto = `${texto} · quedan ${enHoras(sla.restante_en_pausa)}`;
  }
  return resultado;
}

const RESPUESTA = {
  en_plazo: ["Por responder", "aviso"],
  vencida: ["Sin respuesta (vencida)", "mal"],
  cumplida: ["Respondida a tiempo", "bien"],
  incumplida: ["Respondida tarde", "mal"],
  sin_plazo: ["Sin plazo", "neutro"],
};

/** El reloj de respuesta (`RespuestaTicket`). */
export function textoDeRespuesta(sla, ahora = Date.now()) {
  const respuesta = sla?.respuesta;
  let [texto, tono] = RESPUESTA[respuesta?.estado] ?? ["—", "neutro"];
  if (respuesta?.estado === "vencida" && respuesta.vence) {
    texto = `Sin respuesta, vencida hace ${lapso(minutosHasta(respuesta.vence, ahora))}`;
  }
  return plazo(texto, tono, respuesta?.estado === "en_plazo" ? respuesta.vence : null);
}

// --- La ficha del equipo --------------------------------------------------------------

/** Lo que toca ahora con el ticket, en una frase (`queToca` de la web). */
export function queToca(ticket, permisos = {}) {
  switch (ticket?.estado) {
    case "nuevo":
      return permisos.tomar
        ? "Nadie lo ha tomado: tómelo para empezar."
        : permisos.asignar
          ? "Nadie lo ha tomado: asígnelo a un técnico."
          : "Espera en la cola a que lo tome un técnico de su categoría.";
    case "esperando_aprobacion": {
      const faltan = (ticket.aprobaciones ?? []).filter((a) => a.estado === "pendiente").map((a) => a.rol);
      return faltan.length ? `Esperando la aprobación de: ${faltan.join(", ")}.` : "Esperando aprobación.";
    }
    case "esperando_usuario":
      return "Esperando la respuesta del usuario: el plazo de solución está en pausa.";
    case "atendido":
      return `Atendido${ticket.atendido_en ? ` el ${fechaYHora(ticket.atendido_en)}` : ""}; falta que el usuario confirme que quedó resuelto.`;
    case "cerrado":
      return ticket.cerrado_en ? `Cerrado el ${fechaYHora(ticket.cerrado_en)}.` : "Cerrado.";
    default:
      return ticket?.respondido_en
        ? `Lo atiende ${ticket.tecnico?.nombre ?? "el equipo"}.`
        : `Lo atiende ${ticket?.tecnico?.nombre ?? "el equipo"}: falta la primera respuesta al usuario.`;
  }
}

/** Cómo se llama cada paso (`TEXTO_DEL_PASO`). */
export const TEXTO_DEL_PASO = {
  en_curso: "Poner en curso",
  esperando_usuario: "Esperar al usuario (pausa el plazo)",
  atendido: "Marcar como atendido",
  cerrado: "Cerrar",
};

export function textoDelPaso(destino, ticket) {
  if (destino === "en_curso" && ticket?.estado === "atendido") return "Reabrir";
  return TEXTO_DEL_PASO[destino] ?? destino;
}

/** La ventana de cada paso con consecuencias (`dialogoDe`); `null` si va
 * directo. CA-12: «Esperar al usuario» pide la nota. */
export function dialogoDe(accion, ticket) {
  switch (accion) {
    case "esperando_usuario":
      return {
        titulo: "Esperar al usuario",
        explicacion: "El plazo de solución se pausa hasta que el usuario responda.",
        campo: "Qué necesita del usuario",
        ayuda: "Le llega por correo y lo ve en su ticket.",
        obligatorio: "Escriba qué necesita del usuario: es lo que le llega.",
        boton: "Enviar y esperar",
        maximo: 2000,
      };
    case "atendido":
      return {
        titulo: "Marcar como atendido",
        explicacion: `Se avisa a ${ticket?.solicitante_nombre || "quien lo pidió"} para que confirme si quedó resuelto. Si no responde, se cierra solo y entonces se le pide la encuesta.`,
        campo: "Qué se hizo (opcional)",
        ayuda: "Queda en el historial del ticket; el usuario no lo ve.",
        boton: "Marcar como atendido",
        maximo: 2000,
      };
    case "cerrado":
      return {
        titulo: "Cerrar el ticket",
        explicacion:
          "Un ticket cerrado ya no se puede reabrir ni responder. Si el problema vuelve, el usuario crea uno nuevo.",
        campo: "Motivo del cierre (opcional)",
        ayuda: "Queda en el historial del ticket.",
        boton: "Cerrar ticket",
        peligro: true,
        maximo: 2000,
      };
    case "en_curso":
      return ticket?.estado === "atendido"
        ? {
            titulo: "Reabrir el ticket",
            explicacion: "Vuelve a estar en curso y el plazo de solución sigue con lo que quedaba.",
            campo: "Nota (opcional)",
            ayuda: "Queda en el historial del ticket.",
            boton: "Reabrir",
            maximo: 2000,
          }
        : {
            titulo: "Poner en curso",
            explicacion: "El ticket pasa a «En curso»: usted lo está trabajando.",
            campo: "Nota (opcional)",
            ayuda: "Queda en el historial del ticket.",
            boton: "Poner en curso",
            maximo: 2000,
          };
    case "escalar":
      return {
        titulo: "Escalar al siguiente nivel",
        explicacion: "Deja de estar a su cargo y pasa a la cola del nivel siguiente. El plazo sigue corriendo.",
        campo: "Motivo para el nivel siguiente",
        ayuda: "Lo lee quien lo tome; el usuario no lo ve.",
        obligatorio: "Escriba el motivo para escalar el ticket.",
        boton: "Escalar",
        peligro: true,
        maximo: 2000,
      };
    default:
      return null;
  }
}

/** «Ana Pérez · N2 · 3 abiertos». */
export function textoDeTecnico(t) {
  const abiertos = t.abiertos === 0 ? "sin tickets abiertos" : `${t.abiertos} ${t.abiertos === 1 ? "abierto" : "abiertos"}`;
  return [t.nombre, t.nivel, abiertos].filter(Boolean).join(" · ");
}

// --- Respuestas predefinidas (CA-11) ---------------------------------------------------

/** Las que coinciden con lo escrito tras «/» (atajo o título), o todas si
 * se pidió verlas. `null`: no se está buscando una. */
export function respuestasSugeridas(respuestas = [], texto = "", { verTodas = false } = {}) {
  if (verTodas) return respuestas;
  if (!texto.startsWith("/")) return null;
  const consulta = texto.slice(1).toLowerCase();
  return respuestas.filter(
    (r) => (r.atajo ?? "").toLowerCase().startsWith(consulta) || (r.titulo ?? "").toLowerCase().includes(consulta),
  );
}

/** El texto de una respuesta con los datos del ticket (`{{nombre}}`,
 * `{{numero}}`, `{{caso}}`, `{{tecnico}}`). */
export function aplicarPlantilla(texto, ticket) {
  const datos = {
    nombre: ticket?.solicitante_nombre ?? "",
    numero: ticket?.numero ?? "",
    caso: ticket?.caso ?? "",
    tecnico: ticket?.tecnico?.nombre ?? "",
  };
  return (texto ?? "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, clave) => datos[clave] ?? "");
}

// --- El formulario (CamposFormulario de la web) ---------------------------------------

/** Las respuestas de la matriz si el servidor no las manda. */
export const IMPACTOS_LLANOS = [
  { id: "bajo", nombre: "Solo a mí" },
  { id: "medio", nombre: "A mi área o grupo de trabajo" },
  { id: "alto", nombre: "A toda la agencia, la sucursal o la empresa" },
];
export const URGENCIAS_LLANAS = [
  { id: "alta", nombre: "No, la operación está detenida" },
  { id: "media", nombre: "Sí, pero con dificultad" },
  { id: "baja", nombre: "Sí, puede esperar" },
];

/** Cuando el equipo registra a nombre de otra persona, «Solo a mí» no se
 * entendía. */
export const TERCERA_PERSONA = {
  etiquetas: { "¿Puede seguir trabajando?": "¿La persona puede seguir trabajando?" },
  impacto: {
    bajo: "Solo a la persona que lo reporta",
    medio: "A su área o grupo de trabajo",
    alto: "A toda la agencia, la sucursal o la empresa",
  },
  urgencia: {
    alta: "No, su operación está detenida",
    media: "Sí, pero con dificultad",
    baja: "Sí, puede esperar",
  },
};

/** El error de un campo vacío, en «usted» y diciendo qué hacer. */
export const FALTA = {
  categoria: "Elija la categoría de su problema.",
  caso: "Elija el caso que mejor lo describe.",
  descripcion: "Cuéntenos qué pasa.",
  impacto: "Elija a quién afecta.",
  urgencia: "Elija si puede seguir trabajando.",
  sede: "Elija su agencia.",
  area: "Elija su área.",
};

/** Si no llegan los campos: el formulario de siempre (sin los personales,
 * que salen de «Mi perfil»). */
export const CAMPOS_BASE = [
  ["categoria", "Categoría", "lista"],
  ["caso", "Caso de ayuda", "lista"],
  ["descripcion", "Describa el problema", "parrafo"],
  ["impacto", "¿A quién afecta?", "lista"],
  ["urgencia", "¿Puede seguir trabajando?", "lista"],
].map(([clave, etiqueta, tipo]) => ({
  clave,
  etiqueta,
  tipo,
  ayuda: "",
  opciones: [],
  obligatorio: true,
  base: true,
  categorias: [],
}));

/** Los del sistema que la app pinta (los personales salen del perfil). */
const BASE_EN_LA_APP = new Set(["categoria", "caso", "descripcion", "impacto", "urgencia"]);

/** Si un campo propio aplica a la categoría elegida (sin filtro: siempre). */
export function aplica(campo, categoria) {
  if (campo.base || !campo.categorias?.length) return true;
  return campo.categorias.map(String).includes(String(categoria));
}

/** Los campos a la vista, en su orden; con «describir primero», la
 * descripción va antes de la categoría (CA-4). */
export function camposVisibles(campos, categoria, describirPrimero = false) {
  const todos = (campos?.length ? campos : CAMPOS_BASE).filter(
    (c) => (!c.base || BASE_EN_LA_APP.has(c.clave)) && aplica(c, categoria),
  );
  // «Caso» sin «Categoría» no se puede elegir: la categoría siempre va.
  const conCategoria = todos.some((c) => c.clave === "caso") && !todos.some((c) => c.clave === "categoria")
    ? [CAMPOS_BASE[0], ...todos]
    : todos;
  if (!describirPrimero) return conCategoria;
  const descripcion = conCategoria.find((c) => c.clave === "descripcion");
  if (!descripcion || !conCategoria.some((c) => c.clave === "categoria")) return conCategoria;
  const resto = conCategoria.filter((c) => c !== descripcion);
  const donde = resto.findIndex((c) => c.clave === "categoria");
  return [...resto.slice(0, donde), descripcion, ...resto.slice(donde)];
}

/** Los obligatorios que faltan, clave → mensaje, de los campos a la vista. */
export function validarCampos(campos, valores, adicionales) {
  const errores = {};
  for (const campo of camposVisibles(campos, valores.categoria)) {
    if (!campo.obligatorio) continue;
    const valor = campo.base ? valores[campo.clave] : adicionales?.[campo.clave];
    const vacio = valor === undefined || valor === null || valor === false || String(valor).trim() === "";
    if (vacio) errores[campo.clave] = FALTA[campo.clave] ?? `Complete «${campo.etiqueta}».`;
  }
  return errores;
}

/** Lo respondido en los campos propios que aplican, como texto JSON (en un
 * envío con archivos el servidor lo lee así). */
export function adicionalesParaEnviar(campos, valores, adicionales) {
  const propios = Object.fromEntries(
    (campos ?? [])
      .filter((c) => !c.base && aplica(c, valores.categoria))
      .filter((c) => adicionales[c.clave] !== undefined)
      .map((c) => [c.clave, adicionales[c.clave]]),
  );
  return JSON.stringify(propios);
}

/** Los datos de «Mi perfil» que bloquean el alta (los mismos que comprueba
 * `datos_de_la_persona` del servidor): nombre y apellido, área y agencia. */
export function faltanEnElPerfil(misDatos) {
  if (!misDatos) return [];
  const faltan = [];
  if (!String(misDatos.nombre ?? "").trim()) faltan.push("nombre y apellido");
  if (!misDatos.area) faltan.push("área");
  if (!misDatos.agencia) faltan.push("agencia");
  return faltan;
}

/** «nombre y apellido, área y agencia». */
export function unirConY(lista = []) {
  const nombres = lista.filter(Boolean);
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

// --- La encuesta ----------------------------------------------------------------------

export const SATISFACCION = ["Nada satisfecho", "Poco satisfecho", "Regular", "Satisfecho", "Muy satisfecho"];
