import { useEffect, useState } from "react";

import { chatService } from "../../../api/chatService";
import { haceCuanto } from "../Notificaciones/CampanaNotificaciones";
import "./Presencia.css";

/** Cada cuánto se vuelve a preguntar quién está en línea. */
const REFRESCO_MS = 30_000;

/**
 * Si cada persona está en línea y su última conexión (22/10/2026). Pregunta
 * por los `ids` dados y repite cada medio minuto; devuelve `{id: estado}`.
 */
export function usePresencia(ids) {
  const clave = [...new Set((ids ?? []).filter(Boolean))].sort().join(",");
  const [estados, setEstados] = useState({});

  useEffect(() => {
    if (!clave) return undefined;
    let vigente = true;
    const pedir = () =>
      Promise.resolve()
        .then(() => chatService.presencia(clave.split(",")))
        .then((datos) => vigente && setEstados(datos ?? {}))
        .catch(() => {});
    pedir();
    const intervalo = setInterval(pedir, REFRESCO_MS);
    return () => {
      vigente = false;
      clearInterval(intervalo);
    };
  }, [clave]);

  return estados;
}

/** «En almuerzo hasta las 13:30», «En línea», «Última conexión: hace 5
 * min» o «Sin conexiones». Lo que la persona eligió va primero. */
export function textoPresencia(estado) {
  if (!estado) return "";
  const elegido = estado.estado;
  if (elegido && elegido.clave !== "vacaciones_proximas")
    return elegido.detalle;
  if (estado.en_linea) return "En línea";
  if (!estado.ultima_conexion) return "Sin conexiones";
  return `Última conexión: ${haceCuanto(estado.ultima_conexion)}`;
}

/** El punto (verde si está en línea; del color de su estado si eligió
 * uno) y, si se pide, el texto. */
export function Presencia({ estado, conTexto = false }) {
  if (!estado) return null;
  const texto = textoPresencia(estado);
  const elegido = estado.estado;
  const clave =
    elegido && elegido.clave !== "vacaciones_proximas" ? elegido.clave : null;
  const detalle = [
    texto,
    elegido?.clave === "vacaciones_proximas" && elegido.detalle,
    elegido?.mensaje,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className={[
        "presencia",
        estado.en_linea && "presencia--en-linea",
        clave && `presencia--${clave}`,
      ]
        .filter(Boolean)
        .join(" ")}
      title={detalle}
    >
      <span className="presencia__punto" aria-hidden="true" />
      {conTexto ? (
        <span className="presencia__texto">{texto}</span>
      ) : (
        <span className="visually-hidden">{texto}</span>
      )}
    </span>
  );
}

/** El aviso de la conversación: la otra persona está en almuerzo, de
 * vacaciones (o lo estará), en reunión o no disponible. */
export function AvisoDeEstado({ nombre, estado }) {
  if (!estado) return null;
  const proximas = estado.clave === "vacaciones_proximas";
  return (
    <div
      className={`chat-aviso-estado chat-aviso-estado--${estado.clave}`}
      role="status"
    >
      <strong>{nombre}</strong>{" "}
      {proximas
        ? estado.detalle.charAt(0).toLowerCase() + estado.detalle.slice(1)
        : `está ${estado.detalle.charAt(0).toLowerCase()}${estado.detalle.slice(1)}`}
      {!proximas && ": verá su mensaje al volver"}.
      {estado.mensaje && <em> «{estado.mensaje}»</em>}
    </div>
  );
}
