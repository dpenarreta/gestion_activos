import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { soporteService } from "../../../api/soporteService";
import { Icon } from "../../../components/common/Icon/Icon";
import { descargarBlob } from "../../../utils/descargas";
import { formatearFecha } from "../../../utils/formato";
import { mensajeDeError } from "../../../utils/errores";
import "./Publico.css";

/** Cada cuánto se refresca: la posición en la cola baja sola. */
const REFRESCO_MS = 30_000;

/**
 * El seguimiento de un ticket por su enlace secreto (`/soporte/seguimiento/:token`).
 *
 * Quien pidió ve el estado, su posición en la cola (que baja a medida que se
 * atienden los anteriores) y las respuestas de soporte, y puede contestar,
 * adjuntar archivos, confirmar que quedó resuelto y responder la encuesta de
 * satisfacción. Nada interno del equipo llega aquí: el servidor lo filtra.
 */
export function SeguimientoTicket() {
  const { token } = useParams();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState([]);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(() => {
    soporteService
      .seguimiento(token)
      .then((datos) => {
        setTicket(datos);
        setError(null);
      })
      .catch((err) =>
        setError(mensajeDeError(err, "No encontramos este ticket.")),
      );
  }, [token]);

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
    <main className="soporte-publico">
      <div className="soporte-publico__caja">
        <header className="soporte-publico__cabecera">
          <span className="soporte-publico__icono" aria-hidden="true">
            <Icon name="headset" />
          </span>
          <div>
            <h1>
              {ticket ? `Ticket ${ticket.numero}` : "Seguimiento de ticket"}
            </h1>
            {ticket && (
              <p className="mz-faint mb-0">
                {ticket.empresa} · Mesa de ayuda de TI
              </p>
            )}
          </div>
        </header>

        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
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
                    Llegó fuera del horario de atención: se atenderá a la
                    brevedad el siguiente día hábil.
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
                      ejecutar(() => soporteService.confirmarSolucion(token))
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
                  ejecutar(() => soporteService.responderEncuesta(token, datos))
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
                        soporteService.responderComoSolicitante(
                          token,
                          texto,
                          archivos,
                        ),
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
                        onChange={(e) =>
                          setArchivos(
                            Array.from(e.target.files ?? []).slice(0, 3),
                          )
                        }
                      />
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={enviando}
                      >
                        {enviando ? "Enviando…" : "Enviar"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

/** Tres preguntas al cerrar: calificación, si se resolvió y un comentario. */
function Encuesta({ ticket, onResponder, enviando }) {
  const [calificacion, setCalificacion] = useState(0);
  const [resuelto, setResuelto] = useState("");
  const [comentario, setComentario] = useState("");

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
          <div className="soporte-estrellas" role="radiogroup">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={calificacion === n}
                aria-label={`${n} de 5`}
                className={n <= calificacion ? "activa" : undefined}
                onClick={() => setCalificacion(n)}
              >
                <Icon name={n <= calificacion ? "star-fill" : "star"} />
              </button>
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
        <button
          type="submit"
          className="btn btn-primary mt-2"
          disabled={enviando || !calificacion || !resuelto}
        >
          Enviar encuesta
        </button>
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
