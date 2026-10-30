/*
 * Lo que comparten las pantallas del equipo de la mesa de ayuda: cómo se
 * pintan el estado, la prioridad y el SLA de un ticket.
 */
import { useEffect, useState } from "react";

import { soporteService } from "../../api/soporteService";
import { formatearFecha } from "../../utils/formato";

const TONO_ESTADO = {
  nuevo: "mz-pill--warn",
  asignado: "soporte-pill--info",
  en_curso: "mz-pill--ok",
  esperando_usuario: "mz-pill--neutral",
  esperando_aprobacion: "mz-pill--warn",
  atendido: "soporte-pill--info",
  cerrado: "mz-pill--neutral",
};

const TONO_PRIORIDAD = {
  critica: "soporte-pill--critica",
  alta: "mz-pill--bad",
  media: "mz-pill--neutral",
  baja: "mz-pill--neutral",
};

const SLA = {
  en_plazo: ["En plazo", "mz-pill--ok"],
  por_vencer: ["Por vencer", "mz-pill--warn"],
  vencido: ["Vencido", "soporte-pill--critica"],
  pausado: ["En pausa", "mz-pill--neutral"],
  sin_correr: ["Sin iniciar", "mz-pill--neutral"],
  cumplido: ["Cumplido", "mz-pill--ok"],
  incumplido: ["Incumplido", "mz-pill--bad"],
};

export function EstadoTicket({ ticket }) {
  return (
    <span
      className={`mz-pill ${TONO_ESTADO[ticket.estado] ?? "mz-pill--neutral"}`}
    >
      {ticket.estado_display}
    </span>
  );
}

const TONO_CRITICIDAD = {
  muy_baja: "mz-pill--neutral",
  baja: "mz-pill--neutral",
  media: "mz-pill--warn",
  alta: "mz-pill--bad",
  muy_alta: "mz-pill--bad",
  critica: "soporte-pill--critica",
};

/** El nivel de criticidad (el puntaje que ordena la cola nunca se muestra). */
export function CriticidadTicket({ ticket }) {
  if (!ticket.criticidad) return <span className="mz-faint">—</span>;
  return (
    <span
      className={`mz-pill ${TONO_CRITICIDAD[ticket.criticidad] ?? "mz-pill--neutral"}`}
    >
      {ticket.criticidad_display}
    </span>
  );
}

/** Sin el código («P1 · Crítica» → «Crítica»): para quien pide ayuda, que
 * no sabe qué es «P1» (auditoría UX/UI, 30/10/2026). */
export function prioridadLlana(texto) {
  return (texto ?? "").replace(/^P\d\s*·\s*/, "");
}

export function PrioridadTicket({ ticket, llano = false }) {
  if (!ticket.prioridad) return <span className="mz-faint">—</span>;
  return (
    <span
      className={`mz-pill ${TONO_PRIORIDAD[ticket.prioridad] ?? "mz-pill--neutral"}`}
    >
      {llano
        ? prioridadLlana(ticket.prioridad_display)
        : ticket.prioridad_display}
    </span>
  );
}

const RESPUESTA = {
  en_plazo: ["Por responder", "mz-pill--warn"],
  vencida: ["Sin respuesta (vencida)", "soporte-pill--critica"],
  cumplida: ["Respondida a tiempo", "mz-pill--ok"],
  incumplida: ["Respondida tarde", "mz-pill--bad"],
  sin_plazo: ["Sin plazo", "mz-pill--neutral"],
};

/** Minutos en palabras: «45 min», «4 h», «2 h 30 min». */
export function enHoras(minutos) {
  if (minutos === null || minutos === undefined) return "—";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** El reloj de solución: corre desde que un técnico toma el ticket. */
export function SlaTicket({ sla }) {
  const [texto, tono] = SLA[sla?.estado] ?? ["—", "mz-pill--neutral"];
  return (
    <span className="soporte-sla">
      <span className={`mz-pill ${tono}`}>{texto}</span>
      {sla?.vence &&
        ["en_plazo", "por_vencer", "vencido"].includes(sla.estado) && (
          <span className="mz-small mz-faint">
            {formatearFecha(sla.vence, true)}
          </span>
        )}
      {sla?.estado === "pausado" && sla.restante_en_pausa !== null && (
        <span className="mz-small mz-faint">
          quedan {enHoras(sla.restante_en_pausa)}
        </span>
      )}
    </span>
  );
}

/** Cuánto pasó o falta, en palabras: «9 d», «3 h», «25 min». */
export function lapso(minutos) {
  const m = Math.max(0, Math.round(Math.abs(minutos)));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return enHoras(Math.round(m / 60) * 60);
  return `${Math.round(m / (24 * 60))} d`;
}

function minutosHasta(fecha, ahora = Date.now()) {
  return (new Date(fecha).getTime() - ahora) / 60000;
}

/**
 * El plazo que importa ahora, en una sola pastilla: el de respuesta mientras
 * nadie respondió, y después el de solución (auditoría UX/UI, 30/10/2026: la
 * bandeja mostraba solo el de solución, «Sin iniciar», con la respuesta
 * vencida hacía días).
 */
export function VenceTicket({ sla }) {
  const respuesta = sla?.respuesta;
  let texto;
  let tono;
  let fecha = null;
  if (respuesta?.estado === "vencida") {
    texto = `Respuesta vencida hace ${lapso(minutosHasta(respuesta.vence))}`;
    tono = "soporte-pill--critica";
  } else if (respuesta?.estado === "en_plazo") {
    texto = `Responder en ${lapso(minutosHasta(respuesta.vence))}`;
    tono = "mz-pill--warn";
    fecha = respuesta.vence;
  } else if (sla?.estado === "vencido") {
    texto = `Solución vencida hace ${lapso(minutosHasta(sla.vence))}`;
    tono = "soporte-pill--critica";
  } else if (sla?.estado === "por_vencer" || sla?.estado === "en_plazo") {
    texto = `Solucionar en ${lapso(minutosHasta(sla.vence))}`;
    tono = sla.estado === "por_vencer" ? "mz-pill--warn" : "mz-pill--ok";
    fecha = sla.vence;
  } else if (sla?.estado === "pausado") {
    texto =
      sla.restante_en_pausa === null
        ? "En pausa"
        : `En pausa · quedan ${enHoras(sla.restante_en_pausa)}`;
    tono = "mz-pill--neutral";
  } else {
    [texto, tono] = SLA[sla?.estado] ?? ["—", "mz-pill--neutral"];
  }
  return (
    <span className="soporte-sla">
      <span className={`mz-pill ${tono}`}>{texto}</span>
      {fecha && (
        <span className="mz-small mz-faint">{formatearFecha(fecha, true)}</span>
      )}
    </span>
  );
}

/** El reloj de respuesta: hasta la primera respuesta del equipo. */
export function RespuestaTicket({ sla }) {
  const respuesta = sla?.respuesta;
  let [texto, tono] = RESPUESTA[respuesta?.estado] ?? ["—", "mz-pill--neutral"];
  // Desde cuándo, como en la bandeja («hace 9 d»).
  if (respuesta?.estado === "vencida" && respuesta.vence)
    texto = `Sin respuesta, vencida hace ${lapso(minutosHasta(respuesta.vence))}`;
  return (
    <span className="soporte-sla">
      <span className={`mz-pill ${tono}`}>{texto}</span>
      {respuesta?.estado === "en_plazo" && respuesta.vence && (
        <span className="mz-small mz-faint">
          {formatearFecha(respuesta.vence, true)}
        </span>
      )}
    </span>
  );
}

export const PRIORIDADES = [
  ["critica", "P1 · Crítica"],
  ["alta", "P2 · Alta"],
  ["media", "P3 · Media"],
  ["baja", "P4 · Baja"],
];

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

export const TIPOS = [
  ["incidente", "Incidente"],
  ["solicitud", "Solicitud"],
  ["consulta", "Consulta"],
];

export const ESTADOS = [
  ["nuevo", "En cola"],
  ["asignado", "Asignado"],
  ["en_curso", "En curso"],
  ["esperando_usuario", "Esperando al usuario"],
  ["esperando_aprobacion", "Esperando aprobación"],
  ["atendido", "Atendido"],
  ["cerrado", "Cerrado"],
];

export const DIAS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

/**
 * Los nombres de estados y prioridades como los llama la empresa (se
 * personalizan en Configuración → Mesa de ayuda → Horario y metas). Mientras
 * llegan, los de siempre.
 */
export function useEtiquetas() {
  const [etiquetas, setEtiquetas] = useState({
    estados: ESTADOS,
    prioridades: PRIORIDADES,
  });
  useEffect(() => {
    let vigente = true;
    Promise.resolve(soporteService.etiquetas?.())
      .then((datos) => vigente && datos?.estados && setEtiquetas(datos))
      .catch(() => null);
    return () => {
      vigente = false;
    };
  }, []);
  return etiquetas;
}

/** La posición en la cola, en palabras: «Es el siguiente», «Hay 3 antes». */
export function enLaCola(posicion) {
  if (!posicion) return null;
  if (posicion === 1) return "Es el siguiente en la cola.";
  const antes = posicion - 1;
  return `Hay ${antes} ${antes === 1 ? "ticket" : "tickets"} antes que el suyo.`;
}

/**
 * Qué sigue con un ticket propio, para quien lo pidió: si le toca hacer algo
 * o esperar (auditoría UX/UI, 30/10/2026: la lista no decía qué ticket
 * necesitaba algo de la persona). `accion` marca lo que le toca a ella.
 */
export function queSigue(ticket) {
  switch (ticket.estado) {
    case "esperando_usuario":
      return { texto: "Le respondieron: lea y conteste", accion: true };
    case "atendido":
      return { texto: "Confirme si quedó resuelto", accion: true };
    case "esperando_aprobacion":
      return { texto: "Esperando la aprobación", accion: false };
    case "nuevo":
      return ticket.atrasado
        ? {
            texto:
              `Tarda más de lo previsto. ${enLaCola(ticket.posicion) ?? ""}`.trim(),
            accion: false,
            atrasado: true,
          }
        : {
            texto: enLaCola(ticket.posicion) ?? "Esperando a soporte",
            accion: false,
          };
    case "cerrado":
      // Cerrado con la encuesta pendiente: se le pide (antes, «Cerrado» sin
      // más).
      return ticket.puede_encuestar
        ? { texto: "Cuéntenos cómo le fue", accion: true }
        : { texto: "Cerrado", accion: false };
    default:
      return ticket.atrasado
        ? {
            texto: "Tarda más de lo previsto; soporte ya fue avisado",
            accion: false,
            atrasado: true,
          }
        : { texto: "Soporte lo está trabajando", accion: false };
  }
}
