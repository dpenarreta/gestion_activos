import { Icon } from "../Icon/Icon";
import "./EtiquetaAusencia.css";

/*
 * Ausencias visibles junto a quien aprueba (11/11/2026, US-001).
 *
 * El servidor manda, por cada aprobador pendiente, `ausencia: {clave, texto,
 * hasta, reemplazo: {id, nombre}|null}` o null. Solo hay dos claves:
 * «vacaciones» y «fuera_oficina». El tipo de permiso (médico, personal) no
 * llega nunca, y aquí tampoco se deduce: es la regla LOPDP de
 * `ausencias/access.py`.
 */

/** El ícono de cada ausencia: el mismo en el chat y en las solicitudes. */
export const ICONOS_DE_AUSENCIA = {
  vacaciones: "airplane",
  fuera_oficina: "box-arrow-right",
};

/** Un solo texto para el reemplazo en todo el sistema (revisión UX/UI de
 * US-001, 11/11/2026): en la etiqueta y en el chat. */
export const textoDeReemplazo = (nombre) => `Aprueba en su lugar: ${nombre}`;

/** «De vacaciones hasta el 20/11 · Aprueba en su lugar: Carla Ruiz». Ícono y
 * texto: no depende solo del color (WCAG 1.4.1). Quien usa lector oye
 * «(ausente: …)», para que no se lea pegado al nombre como si fuera parte de
 * él. */
export function EtiquetaAusencia({ ausencia }) {
  if (!ausencia?.texto) return null;
  const clave = ICONOS_DE_AUSENCIA[ausencia.clave]
    ? ausencia.clave
    : "fuera_oficina";
  return (
    <span className={`etiqueta-ausencia etiqueta-ausencia--${clave}`}>
      <Icon name={ICONOS_DE_AUSENCIA[clave]} />
      <span>
        <span className="visually-hidden">(ausente: </span>
        {ausencia.texto}
        {ausencia.reemplazo?.nombre && (
          <> · {textoDeReemplazo(ausencia.reemplazo.nombre)}</>
        )}
        <span className="visually-hidden">)</span>
      </span>
    </span>
  );
}

/** Los aprobadores pendientes por nombre, cada uno con su ausencia si la
 * tiene: «Ana Pérez, Luis Mora [De vacaciones hasta el 20/11 · Aprueba en su
 * lugar: Carla Ruiz]». */
export function AprobadoresPendientes({ personas }) {
  const lista = personas ?? [];
  return lista.map((p, i) => (
    <span key={p.id ?? i} className="aprobador-pendiente">
      {p.nombre}
      {p.ausencia && (
        <>
          {" "}
          <EtiquetaAusencia ausencia={p.ausencia} />
        </>
      )}
      {i < lista.length - 1 && ", "}
    </span>
  ));
}

/** Una escalada sin actor en el historial de permisos y proyectos: la hizo
 * el sistema porque quien aprobaba está ausente. */
export function esEscaladaPorAusencia(accion) {
  return accion?.accion === "escalada" && !accion.actor;
}

/** «Pasó a Y porque Z está ausente (paso «X»)», en una sola línea. El nombre
 * del ausente sale de la constancia del servidor («Escalada a Y por ausencia
 * de Z»); si no viene, se dice sin él. */
export function EscaladaPorAusencia({ accion }) {
  const ausente = /por ausencia de (.+?)\.?$/.exec(
    accion.comentario ?? "",
  )?.[1];
  return (
    <span className="historial-ausencia">
      <Icon name="arrow-left-right" /> Pasó a{" "}
      <strong>{accion.detalle || "su reemplazo"}</strong> porque{" "}
      {ausente ? <strong>{ausente}</strong> : "quien aprobaba"} está ausente
      {accion.paso ? ` (paso «${accion.paso}»)` : ""}
    </span>
  );
}
