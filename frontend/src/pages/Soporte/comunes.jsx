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

export function PrioridadTicket({ ticket }) {
  return (
    <span
      className={`mz-pill ${TONO_PRIORIDAD[ticket.prioridad] ?? "mz-pill--neutral"}`}
    >
      {ticket.prioridad_display}
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

/** El reloj de solución: corre desde que se crea el ticket. */
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

/** El reloj de respuesta: hasta la primera respuesta del equipo. */
export function RespuestaTicket({ sla }) {
  const respuesta = sla?.respuesta;
  const [texto, tono] = RESPUESTA[respuesta?.estado] ?? [
    "—",
    "mz-pill--neutral",
  ];
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
