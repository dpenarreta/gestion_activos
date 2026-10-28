import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { descargarBlob } from "../../utils/descargas";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import "../Soporte/Soporte.css";

/** Cada cuánto se refresca: la posición en la cola baja sola. */
const REFRESCO_MS = 30_000;
/** Cuántos archivos acepta el servidor por mensaje. */
const MAX_ADJUNTOS = 3;

/**
 * La ficha de un ticket propio en «Soporte TI» (`/admin/ayuda/tickets/:id`).
 * Exige sesión y solo la ve quien lo pidió (desde el 20/10/2026 no hay enlace
 * de seguimiento sin sesión).
 *
 * Quien pidió ve el estado, su posición en la cola (que baja a medida que se
 * atienden los anteriores) y las respuestas de soporte, y puede contestar,
 * adjuntar archivos, confirmar que quedó resuelto y responder la encuesta de
 * satisfacción. Nada interno del equipo llega aquí: el servidor lo filtra.
 */
export function MiTicket() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  // Revisión final UX/UI (28/10/2026): la carga inicial y el refresco cada
  // 30 s fallan distinto. Si falla la primera, no hay nada que mostrar y se
  // ofrece reintentar; si falla un refresco, el ticket ya está a la vista y
  // se conserva con un aviso discreto (antes salía «No encontramos este
  // ticket» encima del ticket). `error` queda para las acciones.
  const [errorCarga, setErrorCarga] = useState(null);
  const [refrescoFallido, setRefrescoFallido] = useState(false);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState([]);
  const [omitidos, setOmitidos] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const cargado = useRef(false);

  const cargar = useCallback(() => {
    soporteService
      .miTicket(id)
      .then((datos) => {
        cargado.current = true;
        setTicket(datos);
        setErrorCarga(null);
        setRefrescoFallido(false);
      })
      .catch((err) => {
        if (cargado.current) setRefrescoFallido(true);
        else setErrorCarga(mensajeDeError(err, "No encontramos este ticket."));
      });
  }, [id]);

  function reintentar() {
    setErrorCarga(null);
    cargar();
  }

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [cargar]);

  async function ejecutar(accion) {
    setEnviando(true);
    setError(null);
    try {
      setTicket(await accion());
      setTexto("");
      setArchivos([]);
      setOmitidos(0);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar."));
    } finally {
      setEnviando(false);
    }
  }

  async function descargar(adjunto) {
    try {
      const respuesta = await soporteService.descargar(adjunto.url);
      descargarBlob(respuesta.data, adjunto.nombre);
    } catch {
      setError("No se pudo descargar el archivo.");
    }
  }

  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>{ticket ? `Ticket ${ticket.numero}` : "Mi ticket"}</h2>
          {ticket && (
            <p className="mz-desc">
              {ticket.categoria} · {ticket.caso}
            </p>
          )}
        </div>
        <div className="mz-view-actions">
          <Link
            className="btn btn-outline-secondary btn-sm"
            to="/admin/ayuda?vista=mios"
          >
            Volver a Soporte TI
          </Link>
        </div>
      </div>

      {!ticket && (
        <EstadoDeCarga
          cargando={!errorCarga}
          error={errorCarga}
          onReintentar={reintentar}
        />
      )}

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {ticket && refrescoFallido && (
        <p className="mz-small mz-faint mb-0" role="status">
          No se pudo actualizar el ticket; se muestra la última información y se
          volverá a intentar en unos segundos.
        </p>
      )}

      {ticket && (
        <>
          <section className="mz-card">
            <div className="mz-card-body">
              <div className="soporte-publico__estado" aria-live="polite">
                <span className="mz-pill mz-pill--neutral">
                  {ticket.estado_display}
                </span>
                {ticket.posicion ? (
                  <span>
                    Posición en la cola:{" "}
                    <strong className="soporte-publico__numero">
                      {ticket.posicion}
                    </strong>
                  </span>
                ) : ticket.atiende ? (
                  <span>Lo atiende {ticket.atiende}</span>
                ) : null}
              </div>
              {ticket.estado === "esperando_aprobacion" && (
                <p className="mz-small mt-2 mb-0">
                  Su solicitud necesita la aprobación de{" "}
                  {ticket.aprobaciones
                    .filter((ap) => ap.estado === "pendiente")
                    .map((ap) => ap.rol)
                    .join(", ")}
                  . En cuanto la aprueben, entra a la cola de soporte.
                </p>
              )}
              {ticket.fuera_de_horario && ticket.posicion && (
                <p className="mz-small mz-faint mt-2 mb-0">
                  Llegó fuera del horario de atención: se atenderá a la brevedad
                  el siguiente día hábil.
                </p>
              )}
              <dl className="soporte-publico__datos">
                <div>
                  <dt>Categoría</dt>
                  <dd>{ticket.categoria}</dd>
                </div>
                <div>
                  <dt>Caso</dt>
                  <dd>{ticket.caso}</dd>
                </div>
                <div>
                  <dt>Criticidad</dt>
                  <dd>{ticket.criticidad_display || "—"}</dd>
                </div>
                <div>
                  <dt>Prioridad</dt>
                  <dd>{ticket.prioridad_display}</dd>
                </div>
                <div>
                  <dt>Creado</dt>
                  <dd>{formatearFecha(ticket.creado, true)}</dd>
                </div>
                {(ticket.datos_adicionales ?? []).map((d) => (
                  <div key={d.clave}>
                    <dt>{d.etiqueta}</dt>
                    <dd>{d.valor}</dd>
                  </div>
                ))}
              </dl>
              <p className="soporte-publico__descripcion">
                {ticket.descripcion}
              </p>
              <Adjuntos lista={ticket.adjuntos} onDescargar={descargar} />
            </div>
          </section>

          {ticket.puede_confirmar && (
            <div className="mz-alert mz-alert--info">
              <Icon name="check2-circle" />
              <span>
                Soporte marcó su ticket como atendido. ¿Quedó resuelto?{" "}
                <button
                  type="button"
                  className="btn btn-primary btn-sm ms-2"
                  disabled={enviando}
                  onClick={() =>
                    ejecutar(() => soporteService.confirmarMiTicket(id))
                  }
                >
                  Sí, quedó resuelto
                </button>
              </span>
            </div>
          )}

          {(ticket.puede_encuestar || ticket.encuesta) && (
            <Encuesta
              ticket={ticket}
              onResponder={(datos) =>
                ejecutar(() => soporteService.encuestaMiTicket(id, datos))
              }
              enviando={enviando}
            />
          )}

          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Conversación</h3>
            </div>
            <div className="mz-card-body">
              {ticket.mensajes.length === 0 ? (
                <p className="mz-faint">Todavía no hay respuestas.</p>
              ) : (
                <ul className="soporte-hilo">
                  {ticket.mensajes.map((m) => (
                    <li
                      key={m.id}
                      className={
                        m.del_solicitante ? "soporte-hilo__propio" : undefined
                      }
                    >
                      <div className="mz-small mz-faint">
                        {m.autor} · {formatearFecha(m.fecha, true)}
                      </div>
                      <p className="mb-1">{m.texto}</p>
                      <Adjuntos lista={m.adjuntos} onDescargar={descargar} />
                    </li>
                  ))}
                </ul>
              )}

              {ticket.puede_responder && (
                <form
                  className="mt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    ejecutar(() =>
                      soporteService.responderMiTicket(id, texto, archivos),
                    );
                  }}
                >
                  <label className="form-label" htmlFor="sg-texto">
                    {ticket.puede_confirmar
                      ? "¿El problema sigue? Cuéntenos (el ticket se reabre)"
                      : "Responder"}
                  </label>
                  <textarea
                    id="sg-texto"
                    className="form-control"
                    rows={3}
                    required
                    maxLength={5000}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                  />
                  <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
                    <input
                      type="file"
                      className="form-control form-control-sm soporte-publico__archivos"
                      multiple
                      aria-label="Adjuntar archivos"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
                      aria-describedby={
                        omitidos > 0 ? "sg-adjuntos-aviso" : undefined
                      }
                      onChange={(e) => {
                        const elegidos = Array.from(e.target.files ?? []);
                        setArchivos(elegidos.slice(0, MAX_ADJUNTOS));
                        setOmitidos(
                          Math.max(0, elegidos.length - MAX_ADJUNTOS),
                        );
                      }}
                    />
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={enviando}
                    >
                      {enviando ? "Enviando…" : "Enviar"}
                    </button>
                  </div>
                  {/* Antes se recortaba a tres en silencio (revisión final
                      UX/UI, 28/10/2026). */}
                  {omitidos > 0 && (
                    <div
                      id="sg-adjuntos-aviso"
                      className="mz-small mz-faint mt-1"
                      role="status"
                    >
                      Máx. {MAX_ADJUNTOS} archivos; se omitieron {omitidos}.
                    </div>
                  )}
                </form>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** Tres preguntas al cerrar: calificación, si se resolvió y un comentario. */
function Encuesta({ ticket, onResponder, enviando }) {
  const [calificacion, setCalificacion] = useState(0);
  const [resuelto, setResuelto] = useState("");
  const [comentario, setComentario] = useState("");
  const falta = !calificacion
    ? "Elija una calificación."
    : !resuelto
      ? "Indique si su requerimiento se resolvió."
      : null;

  if (ticket.encuesta) {
    return (
      <section className="mz-card" id="encuesta">
        <div className="mz-card-body">
          <p className="mb-0">
            <Icon name="heart" /> ¡Gracias por su respuesta! Calificó la
            atención con {ticket.encuesta.calificacion} de 5.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mz-card" id="encuesta">
      <div className="mz-card-head">
        <h3>¿Cómo lo atendimos?</h3>
      </div>
      <form
        className="mz-card-body"
        onSubmit={(e) => {
          e.preventDefault();
          onResponder({
            calificacion,
            resuelto: resuelto === "si",
            comentario,
          });
        }}
      >
        <fieldset className="mb-3">
          <legend className="form-label">
            ¿Qué tan satisfecho está con la atención recibida?
          </legend>
          {/* Radios nativos con aspecto de estrella (revisión final UX/UI,
              28/10/2026): una sola parada de Tab, las flechas cambian la
              calificación y cada estrella mide 44 px. */}
          <div
            className="soporte-estrellas"
            role="radiogroup"
            aria-label="Calificación del servicio"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <label
                key={n}
                className={`soporte-estrella${n <= calificacion ? " activa" : ""}`}
              >
                <input
                  type="radio"
                  name="calificacion"
                  value={n}
                  className="visually-hidden"
                  checked={calificacion === n}
                  onChange={() => setCalificacion(n)}
                />
                <Icon name={n <= calificacion ? "star-fill" : "star"} />
                <span className="visually-hidden">{n} de 5</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="mb-3">
          <legend className="form-label">
            ¿Su requerimiento se resolvió completamente?
          </legend>
          <div className="d-flex gap-3">
            {[
              ["si", "Sí"],
              ["no", "No"],
            ].map(([valor, etiqueta]) => (
              <div key={valor} className="form-check">
                <input
                  id={`enc-${valor}`}
                  type="radio"
                  name="resuelto"
                  className="form-check-input"
                  required
                  checked={resuelto === valor}
                  onChange={() => setResuelto(valor)}
                />
                <label className="form-check-label" htmlFor={`enc-${valor}`}>
                  {etiqueta}
                </label>
              </div>
            ))}
          </div>
        </fieldset>
        <label className="form-label" htmlFor="enc-comentario">
          Comentario (opcional)
        </label>
        <textarea
          id="enc-comentario"
          className="form-control"
          rows={2}
          maxLength={2000}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
        />
        <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={enviando || Boolean(falta)}
            aria-describedby={falta ? "enc-falta" : undefined}
          >
            Enviar encuesta
          </button>
          {/* El botón ya no se queda deshabilitado sin decir por qué. */}
          {falta && (
            <span id="enc-falta" className="mz-small mz-faint">
              {falta}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

function Adjuntos({ lista, onDescargar }) {
  if (!lista?.length) return null;
  return (
    <ul className="soporte-adjuntos">
      {lista.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            className="btn btn-link btn-sm p-0"
            onClick={() => onDescargar(a)}
          >
            <Icon name="paperclip" /> {a.nombre}
          </button>
        </li>
      ))}
    </ul>
  );
}
