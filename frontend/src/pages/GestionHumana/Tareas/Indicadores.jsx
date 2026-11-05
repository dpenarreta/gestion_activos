/*
 * Indicadores de Tareas que se repiten en el panel de actividades, la
 * validación y las listas: la desviación, el estado de la Fecha Fin, si el
 * Tiempo Objetivo está validado y el historial de decisiones. El estado lleva
 * siempre ícono y texto, no solo color.
 */
import { useState } from "react";

import { Icon } from "../../../components/common/Icon/Icon";
import { fechaHora } from "../comunes";
import {
  ACCION_FECHA_FIN,
  ESTADO,
  ESTADO_FECHA_FIN,
  ICONO_ESTADO,
  ICONO_FECHA_FIN,
  MOTIVO_TIEMPO_OBJETIVO,
  PRIORIDAD,
  TONO_ESTADO,
  TONO_FECHA_FIN,
  TONO_PRIORIDAD,
  fechaCorta,
  horas,
  horasValidas,
  nombreDe,
  rolLegible,
  textoAHoras,
} from "./tareasComunes";

export function PillEstado({ estado }) {
  return (
    <span className={`mz-pill ${TONO_ESTADO[estado] ?? "mz-pill--neutral"}`}>
      <Icon name={ICONO_ESTADO[estado] ?? "circle"} />
      {ESTADO[estado] ?? estado}
    </span>
  );
}

export function PillPrioridad({ prioridad }) {
  return (
    <span
      className={`mz-pill ${TONO_PRIORIDAD[prioridad] ?? "mz-pill--neutral"}`}
    >
      {PRIORIDAD[prioridad] ?? prioridad}
    </span>
  );
}

/** «Vencida» con ícono y texto (no solo el color de la fecha). */
export function MarcaVencida() {
  return (
    <span className="mz-pill mz-pill--bad">
      <Icon name="exclamation-triangle" /> Vencida
    </span>
  );
}

/** Desviación: «+1 h 30 min (+25 %)», con signo y texto, no solo color. */
export function Desviacion({ desviacion }) {
  if (!desviacion) return null;
  const signo = desviacion.hours > 0 ? "+" : desviacion.hours < 0 ? "−" : "";
  const texto = `${signo}${horas(Math.abs(desviacion.hours))}${
    desviacion.pct !== null && desviacion.pct !== undefined
      ? ` (${desviacion.pct > 0 ? "+" : ""}${desviacion.pct} %)`
      : ""
  }`;
  const tono =
    desviacion.hours > 0
      ? "gt-texto--bad"
      : desviacion.hours < 0
        ? "gt-texto--ok"
        : "";
  return (
    <span className={tono}>
      {texto}
      {desviacion.hours > 0 && " · sobre el objetivo"}
      {desviacion.hours < 0 && " · bajo el objetivo"}
    </span>
  );
}

export function EstadoFechaFin({ estado }) {
  return (
    <span className={`mz-pill ${TONO_FECHA_FIN[estado] ?? "mz-pill--neutral"}`}>
      <Icon name={ICONO_FECHA_FIN[estado] ?? "circle"} />
      {ESTADO_FECHA_FIN[estado] ?? estado}
    </span>
  );
}

export function PillValidado({ validado }) {
  return validado ? (
    <span className="mz-pill mz-pill--ok">
      <Icon name="check-circle" /> Validado
    </span>
  ) : (
    <span className="mz-pill mz-pill--warn">
      <Icon name="hourglass-split" /> Pendiente de validación
    </span>
  );
}

/** El historial de validaciones (Tiempo Objetivo o Fecha Fin). */
export function Historial({ tipo, entradas }) {
  const [abierto, setAbierto] = useState(false);
  if (!entradas?.length) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="gh-enlace"
        aria-expanded={abierto}
        onClick={() => setAbierto((a) => !a)}
      >
        {abierto ? "Ocultar" : "Ver"} historial ({entradas.length})
      </button>
      {abierto && (
        <ul className="mz-timeline mt-2">
          {entradas.map((a) => (
            <li key={a.id} className="mz-tl-item">
              <div className="mz-tl-what">
                {tipo === "objetivo" ? (
                  <>
                    {a.previous_value !== null && a.previous_value !== undefined
                      ? `${horas(a.previous_value)} → `
                      : ""}
                    <strong>{horas(a.new_value)}</strong>
                  </>
                ) : (
                  <>
                    {ACCION_FECHA_FIN[a.action] ?? a.action}
                    {a.previous_value &&
                    a.new_value &&
                    fechaCorta(a.previous_value) !== fechaCorta(a.new_value)
                      ? `: ${fechaCorta(a.previous_value)} → ${fechaCorta(a.new_value)}`
                      : a.new_value
                        ? `: ${fechaCorta(a.new_value)}`
                        : ""}
                  </>
                )}
              </div>
              {tipo === "objetivo" ? (
                <div className="mz-tl-why">
                  {MOTIVO_TIEMPO_OBJETIVO[a.reason] ?? a.reason}
                  {a.reason_detail ? `: ${a.reason_detail}` : ""}
                </div>
              ) : (
                a.observaciones && (
                  <div className="mz-tl-why">{a.observaciones}</div>
                )
              )}
              <div className="mz-tl-when">
                {nombreDe(a.user)}
                {a.user_role ? ` (${rolLegible(a.user_role)})` : ""} ·{" "}
                {fechaHora(a.created_at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Debajo de un campo HH.MM: cómo se lee lo escrito («= 6 h 30 min»). */
export function PreviaHoras({ texto }) {
  const valido = horasValidas(texto) && String(texto).trim() !== "";
  return (
    <p className="gt-previa" aria-live="polite">
      {valido ? `= ${horas(textoAHoras(texto))}` : ""}
    </p>
  );
}
