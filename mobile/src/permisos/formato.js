import { colores } from "../tema/colores";
import { fechaCorta, fechaLarga } from "../utils/fechas";

export { aHora, aIso, deHora, deIso, fechaCorta, fechaLarga, fechaYHora } from "../utils/fechas";

/**
 * Textos y formatos de Solicitud de permisos (US-010, 12/11/2026), copiados
 * de la web (`licenciasComunes.jsx`) y no importados: la app no depende del
 * código de la web. Nada de esto calcula reglas: los días, el reparto entre
 * períodos y los fines de semana los decide el servidor.
 */

/** El estado de una solicitud, con texto e ícono además del color (CA-3 y
 * CA-14: el estado nunca se transmite solo con color). */
export const ESTADOS = {
  pendiente: {
    texto: "Pendiente",
    icono: "clock-outline",
    color: colores.avisoTexto,
    fondo: colores.avisoFondo,
  },
  aprobada: {
    texto: "Aprobada",
    icono: "check-circle-outline",
    color: colores.bienTexto,
    fondo: colores.bienFondo,
  },
  rechazada: {
    texto: "Rechazada",
    icono: "close-circle-outline",
    color: colores.malTexto,
    fondo: colores.malFondo,
  },
  cancelada: {
    texto: "Cancelada",
    icono: "cancel",
    color: colores.tintaSuave,
    fondo: colores.hundido,
  },
};

export function estadoDe(solicitud) {
  return (
    ESTADOS[solicitud?.estado] ?? {
      texto: solicitud?.estado_display || "Sin estado",
      icono: "help-circle-outline",
      color: colores.tintaSuave,
      fondo: colores.hundido,
    }
  );
}

/** El estado de cada regla de la evaluación (CA-4), como en la web: ✔ cumple,
 * ✖ no cumple, ⚠ atención e ℹ informa. */
export const ESTADOS_REGLA = {
  ok: { nombre: "Cumple", icono: "check-circle", color: colores.bienTexto, fondo: colores.bienFondo },
  falla: { nombre: "No cumple", icono: "close-circle", color: colores.malTexto, fondo: colores.malFondo },
  aviso: { nombre: "Atención", icono: "alert", color: colores.avisoTexto, fondo: colores.avisoFondo },
  info: {
    nombre: "Para tener en cuenta",
    icono: "information",
    color: colores.infoTexto,
    fondo: colores.infoFondo,
  },
};

export function estadoDeRegla(regla) {
  return ESTADOS_REGLA[regla?.estado] ?? ESTADOS_REGLA.info;
}

/** Qué descuenta un tipo de permiso, en palabras de quien lo pide. */
export const DESCUENTOS = {
  sueldo: "Se descuenta del sueldo",
  vacaciones: "Se descuenta de las vacaciones pendientes",
  ninguno: "Permiso con sueldo (no se descuenta)",
};

/** «12/11/2026» o «12/11/2026 al 16/11/2026». */
export function rangoDeFechas(desde, hasta) {
  return desde === hasta ? fechaCorta(desde) : `${fechaCorta(desde)} al ${fechaCorta(hasta)}`;
}

/** Los minutos entre dos horas «HH:MM», o `null` si falta alguna. */
export function minutosEntre(inicio, fin) {
  const leer = (texto) => {
    const partes = /^(\d{1,2}):(\d{2})/.exec(texto ?? "");
    return partes ? Number(partes[1]) * 60 + Number(partes[2]) : null;
  };
  const a = leer(inicio);
  const b = leer(fin);
  return a === null || b === null ? null : b - a;
}

/** «2 h 30 min», «45 min», «3 h». */
export function duracion(minutos) {
  if (minutos === null || minutos === undefined || minutos <= 0) return "";
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (!horas) return `${resto} min`;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** «08:00 a 10:30», o "" si falta alguna hora. */
export function horario(desde, hasta) {
  if (!desde || !hasta) return "";
  return `${desde.slice(0, 5)} a ${hasta.slice(0, 5)}`;
}

/** «día» o «días», para cuando el número va aparte (la cifra grande de
 * «Mis vacaciones»). */
export function palabraDias(n) {
  return n === 1 ? "día" : "días";
}

export function dias(n) {
  return `${n} ${palabraDias(n)}`;
}

/** Lo que dura una solicitud: «5 días», «1 día» o, por horas, «2 h 30 min». */
export function duracionDeSolicitud(s) {
  if (s?.unidad === "horas") {
    return duracion(s.minutos ?? minutosEntre(s.hora_desde, s.hora_hasta));
  }
  return dias(Number(s?.dias) || 0);
}

/** Los nombres de quienes tienen pendiente la solicitud, cada uno con su
 * ausencia si la tiene («Ana Pérez (ausente: De vacaciones hasta el 20/11 ·
 * Aprueba en su lugar: Carla Ruiz)»), como `AprobadoresPendientes` de la
 * web. El tipo de la ausencia no llega nunca (LOPDP). */
export function pendienteDe(solicitud) {
  return (solicitud?.pendiente_de ?? [])
    .filter((p) => p?.nombre)
    .map((p) => {
      const ausencia = p.ausencia?.texto
        ? ` (ausente: ${p.ausencia.texto}${
            p.ausencia.reemplazo?.nombre ? ` · Aprueba en su lugar: ${p.ausencia.reemplazo.nombre}` : ""
          })`
        : "";
      return `${p.nombre}${ausencia}`;
    })
    .join(", ");
}

/** Una acción del historial en una frase, como `textoDeAccion` de la web. */
export function textoDeAccion(a) {
  const actor = a?.actor || "";
  const paso = a?.paso ? ` en el paso «${a.paso}»` : "";
  switch (a?.accion) {
    case "creada":
      return actor ? `${actor} hizo la solicitud` : "Se hizo la solicitud";
    case "asignada":
      return `Pasó al paso «${a.paso}»${a.detalle ? ` · le toca a ${a.detalle}` : ""}`;
    case "aprobada":
      return `${actor || "Se"} aprobó${paso}`;
    case "rechazada":
      return `${actor || "Se"} rechazó${paso}`;
    case "escalada": {
      if (!actor) {
        // Sin actor la pasó el sistema: quien aprobaba está ausente.
        const ausente = /por ausencia de (.+?)\.?$/.exec(a.comentario ?? "")?.[1];
        return `Pasó a ${a.detalle || "su reemplazo"} porque ${ausente || "quien aprobaba"} está ausente${
          a.paso ? ` (paso «${a.paso}»)` : ""
        }`;
      }
      return `${actor} escaló${paso}${a.detalle ? ` a ${a.detalle}` : ""}`;
    }
    case "cancelada":
      return `${actor || "Se"} canceló la solicitud`;
    case "terminada":
      return `Resultado: ${a.detalle || a.accion_display || ""}`;
    default:
      return [actor, (a?.accion_display || "").toLowerCase()].filter(Boolean).join(" ") + (a?.detalle ? `: ${a.detalle}` : "");
  }
}

/** Si el comentario de una acción se muestra aparte (el de una escalada por
 * ausencia ya va en la frase). */
export function muestraComentario(a) {
  return Boolean(a?.comentario) && !(a.accion === "escalada" && !a.actor);
}

/** El nombre accesible de una solicitud en una lista: todo lo que se ve. */
export function nombreDeSolicitud(s, { conSolicitante = false } = {}) {
  const horas = s.unidad === "horas" ? horario(s.hora_desde, s.hora_hasta) : "";
  const partes = [
    s.flujo,
    conSolicitante && s.solicitante?.nombre ? `de ${s.solicitante.nombre}` : null,
    s.desde === s.hasta ? fechaLarga(s.desde) : `del ${fechaLarga(s.desde)} al ${fechaLarga(s.hasta)}`,
    horas ? `de ${horas}` : null,
    duracionDeSolicitud(s),
    `Estado: ${estadoDe(s).texto}`,
    s.estado === "pendiente" && pendienteDe(s) ? `Pendiente de ${pendienteDe(s)}` : null,
  ];
  return partes.filter(Boolean).join(". ");
}

/** Si un tipo de permiso es médico: `es_medico` o `tipo_ausencia`. */
export function esMedico(tipo) {
  return tipo?.es_medico === true || tipo?.tipo_ausencia === "MEDICO";
}

/** Lo que un tipo pide al solicitar, con las mismas reglas que la web:
 * un médico pide siempre motivo y documento. */
export function requisitosDe(tipo) {
  const medico = esMedico(tipo);
  const adjuntoObligatorio = medico || tipo?.adjunto === "obligatorio";
  return {
    medico,
    porHoras: tipo?.unidad === "horas",
    pideMotivo: Boolean(tipo) && (medico || tipo.pide_motivo !== false),
    adjuntoObligatorio: Boolean(tipo) && adjuntoObligatorio,
    pideAdjunto: Boolean(tipo) && (adjuntoObligatorio || (tipo.adjunto && tipo.adjunto !== "no")),
  };
}
