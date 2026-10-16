/*
 * Lo que comparten las pantallas de órdenes de trabajo: cómo se pinta un
 * estado, una prioridad y el cumplimiento, y cómo se lee el dinero.
 *
 * Los tonos dicen en qué punto está cada orden, no si es buena o mala
 * noticia: la que espera a alguien resalta, la que está en marcha se lee
 * como información y la cerrada se calma.
 */
import { formatearMoneda } from "../../utils/formato";

const TONO_ESTADO = {
  solicitada: "mz-pill--neutral",
  asignada: "ordenes-pill--info",
  programada: "ordenes-pill--info",
  en_ejecucion: "ordenes-pill--marcha",
  pausada: "mz-pill--warn",
  pendiente_aprobacion: "mz-pill--warn",
  cerrada: "mz-pill--ok",
};

const TONO_PRIORIDAD = {
  critica: "ordenes-pill--critica",
  alta: "mz-pill--bad",
  media: "mz-pill--neutral",
  baja: "ordenes-pill--baja",
};

export const CUMPLIMIENTO = {
  cerrada: ["Cerrada", "mz-pill--ok"],
  vencida: ["Vencida", "ordenes-pill--critica"],
  en_plazo: ["En plazo", "ordenes-pill--info"],
  sin_fecha: ["Sin fecha", "mz-pill--neutral"],
};

export function EstadoOrden({ orden }) {
  return (
    <span
      className={`mz-pill ${TONO_ESTADO[orden.estado] ?? "mz-pill--neutral"}`}
    >
      {orden.estado_display}
    </span>
  );
}

export function PrioridadOrden({ orden }) {
  return (
    <span
      className={`mz-pill ${TONO_PRIORIDAD[orden.prioridad] ?? "mz-pill--neutral"}`}
    >
      {orden.prioridad_display}
    </span>
  );
}

export function CumplimientoOrden({ orden }) {
  const [texto, tono] = CUMPLIMIENTO[orden.cumplimiento] ?? [
    "—",
    "mz-pill--neutral",
  ];
  return <span className={`mz-pill ${tono}`}>{texto}</span>;
}

/** «—» para lo que no tiene costo todavía: un «$0,00» se lee como gratis. */
export function moneda(valor) {
  return Number(valor) ? formatearMoneda(valor) : "—";
}

export function Sede({ sede }) {
  const lugar = [sede.region_display, sede.provincia]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {sede.nombre}
      {lugar && <div className="mz-small mz-faint">{lugar}</div>}
    </>
  );
}
