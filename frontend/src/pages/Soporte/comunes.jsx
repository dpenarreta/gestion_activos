/*
 * Lo que comparten las pantallas del equipo de la mesa de ayuda: cómo se
 * pintan el estado, la prioridad y el SLA de un ticket.
 */
import { formatearFecha } from "../../utils/formato";

const TONO_ESTADO = {
  nuevo: "mz-pill--warn",
  asignado: "soporte-pill--info",
  en_curso: "mz-pill--ok",
  esperando_usuario: "mz-pill--neutral",
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
    </span>
  );
}

export const ESTADOS = [
  ["nuevo", "En cola"],
  ["asignado", "Asignado"],
  ["en_curso", "En curso"],
  ["esperando_usuario", "Esperando al usuario"],
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
