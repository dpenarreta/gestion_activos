/*
 * Piezas de Reuniones compartidas por el listado y el detalle: el estado, el
 * momento (por la hora) y el botón «Unirse». El color nunca va solo: cada
 * semáforo dice su texto y lleva su ícono.
 */
import { Icon } from "../../../components/common/Icon/Icon";
import { Semaforo } from "../Desempeno/Componentes";
import { ESTADO, MOMENTO, dominioDe } from "./reunionesComunes";

export function PildoraEstado({ status, texto }) {
  const estado = ESTADO[status];
  return (
    <Semaforo tono={estado?.tono ?? "neutral"}>
      {estado && <Icon name={estado.icono} />}
      {texto || estado?.texto || status}
    </Semaforo>
  );
}

/** Solo se destaca la que está en su horario: «Próxima» y «Ya pasó» ya los
 * dice la pestaña. */
export function PildoraMomento({ timing, siempre = false }) {
  const momento = MOMENTO[timing];
  if (!momento || (!siempre && timing !== "IN_PROGRESS")) return null;
  return (
    <Semaforo tono={timing === "IN_PROGRESS" ? "warn" : "neutral"}>
      <Icon name={momento.icono} />
      {momento.texto}
    </Semaforo>
  );
}

/**
 * Un enlace a otro sitio (la reunión, la transcripción), en otra pestaña.
 * `noopener noreferrer`: la página de Zoom, Teams, Meet u Otter no puede
 * tocar la intranet ni saber de dónde vino. Solo con un `https://` válido
 * (el servidor ya lo exige; aquí se vuelve a mirar por si llegara otra cosa
 * guardada). Junto al enlace, el servidor de destino con un candado: se sabe
 * adónde lleva antes de pulsarlo (y el nombre accesible también lo dice).
 */
export function EnlaceExterno({
  href,
  className,
  icono = "box-arrow-up-right",
  texto,
  textoOculto = "",
}) {
  const dominio = dominioDe(href);
  if (!dominio) return null;
  return (
    <span className="re-externo">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        <Icon name={icono} /> {texto}
        <span className="visually-hidden">
          {textoOculto} en {dominio} (se abre en una pestaña nueva)
        </span>
      </a>
      <span className="re-dominio mz-small" aria-hidden="true">
        <Icon name="lock-fill" /> {dominio}
      </span>
    </span>
  );
}

export function BotonUnirse({ reunion, className = "btn btn-primary" }) {
  return (
    <EnlaceExterno
      href={reunion.join_url}
      className={className}
      texto="Unirse"
      textoOculto={` a «${reunion.title}»`}
    />
  );
}

/** Ya pasó y sigue «Programada»: quien organiza no la cerró. Solo se le
 * muestra a él (es quien puede cambiar el estado). */
export function PildoraSinCerrar({ reunion }) {
  if (
    !reunion.is_host ||
    reunion.timing !== "PAST" ||
    reunion.status !== "PROGRAMADA"
  )
    return null;
  return (
    <Semaforo tono="warn">
      <Icon name="exclamation-triangle" /> Sin cerrar
    </Semaforo>
  );
}
