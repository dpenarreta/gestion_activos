import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import { EstadoTicket, enLaCola, prioridadLlana } from "../Soporte/comunes";
import { useVisorDeAdjuntos } from "../Soporte/VisorAdjunto";
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
  const [errorTexto, setErrorTexto] = useState(null);
  const [llaveArchivos, setLlaveArchivos] = useState(0);
  const cargado = useRef(false);
  const caja = useRef(null);
  const avisoError = useRef(null);
  const adjuntos = useVisorDeAdjuntos();

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

  /* `donde`: responder, confirmar o encuesta. El error y el «Enviando…»
   * salen junto al botón que se pulsó (verificación UX/UI, 30/10/2026: el de
   * la encuesta no se veía en un ticket cerrado). */
  const [origen, setOrigen] = useState("responder");
  async function ejecutar(accion, donde = "responder") {
    setOrigen(donde);
    setEnviando(true);
    setError(null);
    try {
      setTicket(await accion());
      setTexto("");
      setArchivos([]);
      setOmitidos(0);
      setLlaveArchivos((n) => n + 1);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar."));
      requestAnimationFrame(() => avisoError.current?.focus());
    } finally {
      setEnviando(false);
    }
  }

  const descargar = adjuntos.abrir;

  /** «No, sigue el problema»: lleva a la caja de respuesta. */
  function sigueElProblema() {
    caja.current?.focus();
    caja.current?.scrollIntoView?.({ block: "center" });
  }

  function responder(evento) {
    evento.preventDefault();
    // Basta el texto o un adjunto (una captura sola también sirve).
    if (!texto.trim() && archivos.length === 0) {
      setErrorTexto("Escriba su mensaje o adjunte un archivo.");
      caja.current?.focus();
      return;
    }
    setErrorTexto(null);
    ejecutar(() => soporteService.responderMiTicket(id, texto, archivos));
  }

  const ahora = Date.now();
  const plazos = ticket?.plazos ?? {};
  const respuestaVence = plazos.respuesta
    ? new Date(plazos.respuesta).getTime()
    : null;

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

      {adjuntos.error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {adjuntos.error}
        </div>
      )}
      {adjuntos.visor}

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
                {/* El mismo color que en la lista (antes, gris aquí). */}
                <EstadoTicket ticket={ticket} />
                {ticket.posicion ? (
                  <span>{enLaCola(ticket.posicion)}</span>
                ) : ticket.atiende ? (
                  <span>Lo atiende {ticket.atiende}</span>
                ) : null}
              </div>
              {/* Cuándo le van a responder y para cuándo debería estar
                  resuelto (antes solo la posición en la cola). */}
              {respuestaVence && (
                <p className="mt-2 mb-0">
                  {respuestaVence > ahora ? (
                    <>
                      <Icon name="clock" /> Le responderemos antes del{" "}
                      <strong>{formatearFecha(plazos.respuesta, true)}</strong>.
                    </>
                  ) : (
                    <>
                      <Icon name="exclamation-triangle" /> Está tardando más de
                      lo previsto; el equipo de soporte ya fue avisado.
                    </>
                  )}
                </p>
              )}
              {plazos.solucion && (
                <p className="mt-2 mb-0">
                  {new Date(plazos.solucion).getTime() > ahora ? (
                    <>
                      <Icon name="calendar-check" /> Debería quedar resuelto
                      antes del{" "}
                      <strong>{formatearFecha(plazos.solucion, true)}</strong>.
                    </>
                  ) : (
                    <>
                      <Icon name="exclamation-triangle" /> La solución está
                      tardando más de lo previsto; el equipo de soporte ya fue
                      avisado.
                    </>
                  )}
                </p>
              )}
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
              {/* Solo mientras aplica: antes seguía diciendo «el siguiente
                  día hábil» nueve días después. */}
              {ticket.fuera_de_horario &&
                ticket.posicion &&
                respuestaVence > ahora && (
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
                  <dd>{prioridadLlana(ticket.prioridad_display)}</dd>
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

          {/* Las dos respuestas, con su botón (antes solo el «Sí»: para
              decir que no había que descubrir la caja de abajo). */}
          {ticket.puede_confirmar && (
            <div className="mz-alert mz-alert--info soporte-confirmar">
              <Icon name="check2-circle" />
              <span>
                Soporte marcó su ticket como atendido. ¿Quedó resuelto?
              </span>
              <span className="soporte-confirmar__botones">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={enviando}
                  onClick={() =>
                    ejecutar(
                      () => soporteService.confirmarMiTicket(id),
                      "confirmar",
                    )
                  }
                >
                  {enviando && origen === "confirmar"
                    ? "Enviando…"
                    : "Sí, quedó resuelto"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={sigueElProblema}
                >
                  No, sigue el problema
                </button>
              </span>
            </div>
          )}
          {error && origen === "confirmar" && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}

          {(ticket.puede_encuestar || ticket.encuesta) && (
            <Encuesta
              ticket={ticket}
              onResponder={(datos) =>
                ejecutar(
                  () => soporteService.encuestaMiTicket(id, datos),
                  "encuesta",
                )
              }
              enviando={enviando && origen === "encuesta"}
              error={origen === "encuesta" ? error : null}
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

              {!ticket.puede_responder && ticket.estado === "cerrado" && (
                <div className="mz-alert mz-alert--info mt-3 mb-0">
                  <Icon name="info-circle" />
                  <span>
                    Este ticket está cerrado. Si el problema volvió,{" "}
                    <Link to="/admin/ayuda">cree un ticket nuevo</Link>.
                  </span>
                </div>
              )}
              {ticket.puede_responder && (
                <form className="mt-3" onSubmit={responder} noValidate>
                  <label className="form-label" htmlFor="sg-texto">
                    {ticket.puede_confirmar
                      ? "¿El problema sigue? Cuéntenos (el ticket se reabre)"
                      : "Responder"}
                  </label>
                  <textarea
                    id="sg-texto"
                    ref={caja}
                    className={`form-control${errorTexto ? " is-invalid" : ""}`}
                    rows={3}
                    maxLength={5000}
                    value={texto}
                    aria-invalid={errorTexto ? true : undefined}
                    aria-describedby={errorTexto ? "sg-texto-error" : undefined}
                    onChange={(e) => {
                      setTexto(e.target.value);
                      if (errorTexto) setErrorTexto(null);
                    }}
                  />
                  {errorTexto && (
                    <div id="sg-texto-error" className="mz-field-error">
                      {errorTexto}
                    </div>
                  )}
                  <label className="form-label mt-2 mb-1" htmlFor="sg-adjuntos">
                    Adjuntar captura o archivo{" "}
                    <span className="mz-faint fw-normal">
                      (opcional, hasta 3, 10 MB cada uno)
                    </span>
                  </label>
                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <input
                      key={llaveArchivos}
                      id="sg-adjuntos"
                      type="file"
                      className="form-control form-control-sm soporte-publico__archivos"
                      multiple
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
                  {/* El error del envío, junto al botón. */}
                  {error && origen === "responder" && (
                    <div
                      ref={avisoError}
                      className="mz-alert mz-alert--bad mt-2 mb-0"
                      role="alert"
                      tabIndex={-1}
                    >
                      <Icon name="x-octagon" />
                      {error}
                    </div>
                  )}
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
function Encuesta({ ticket, onResponder, enviando, error }) {
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
            {enviando ? "Enviando…" : "Enviar encuesta"}
          </button>
          {/* El botón ya no se queda deshabilitado sin decir por qué. */}
          {falta && (
            <span id="enc-falta" className="mz-small mz-faint">
              {falta}
            </span>
          )}
        </div>
        {error && (
          <div className="mz-alert mz-alert--bad mt-2 mb-0" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
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
