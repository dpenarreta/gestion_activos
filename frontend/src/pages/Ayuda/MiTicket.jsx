import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import { fijarTituloPropio } from "../../utils/tituloDocumento";
import { EstadoTicket, enLaCola, prioridadLlana } from "../Soporte/comunes";
import { useVisorDeAdjuntos } from "../Soporte/VisorAdjunto";
import "../Soporte/Soporte.css";

/** Cada cuánto se refresca: la posición en la cola baja sola. */
const REFRESCO_MS = 30_000;
/** Cuántos archivos acepta el servidor por mensaje. */
const MAX_ADJUNTOS = 3;

/** Lo que se dice al terminar cada acción (antes no se decía nada). */
const HECHO = {
  responder: "Mensaje enviado. Soporte le responderá aquí.",
  confirmar:
    "¡Gracias! Cerramos su ticket. Si quiere, cuéntenos abajo cómo le fue.",
  encuesta: "¡Gracias por su opinión!",
};

/** El aviso de una acción, junto a donde se pulsó. Se lleva el foco: el
 * botón pulsado suele desaparecer. */
function Aviso({ texto }) {
  const ref = useRef(null);
  useEffect(() => {
    if (texto) ref.current?.focus();
  }, [texto]);
  if (!texto) return null;
  return (
    <div
      ref={ref}
      className="mz-alert mz-alert--ok"
      role="status"
      tabIndex={-1}
    >
      <Icon name="check2-circle" />
      {texto}
    </div>
  );
}

/**
 * La ficha de un ticket propio en «Soporte TI» (`/admin/ayuda/tickets/:id`).
 * Exige sesión y solo la ve quien lo pidió (desde el 20/10/2026 no hay enlace
 * de seguimiento sin sesión).
 *
 * Quien pidió ve el estado, su posición en la cola (que baja a medida que se
 * atienden los anteriores) y las respuestas de soporte, y puede contestar,
 * adjuntar archivos, confirmar que quedó resuelto y responder la encuesta de
 * satisfacción. Nada interno del equipo llega aquí: el servidor lo filtra.
 *
 * Auditoría UX/UI de «Mis tickets» (30/10/2026): arriba, qué le toca a la
 * persona; la encuesta solo con el ticket cerrado (competía con «¿Quedó
 * resuelto?»); la fecha en que se cierra solo; un aviso al terminar cada
 * acción; quién habló en cada mensaje; aviso de respuestas nuevas; el
 * título es el del ticket; y uno que no existe lo dice, con salida. El
 * único contacto con soporte es el ticket.
 */
export function MiTicket() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  // La carga inicial y el refresco fallan distinto: si falla la primera, no
  // hay nada que mostrar; si falla un refresco, el ticket se conserva con un
  // aviso discreto. `error` queda para las acciones.
  const [errorCarga, setErrorCarga] = useState(null);
  const [noExiste, setNoExiste] = useState(false);
  const [refrescoFallido, setRefrescoFallido] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [novedad, setNovedad] = useState(null);
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState([]);
  const [omitidos, setOmitidos] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [errorTexto, setErrorTexto] = useState(null);
  const [llaveArchivos, setLlaveArchivos] = useState(0);
  const cargado = useRef(false);
  const anterior = useRef(null);
  const enviandoRef = useRef(false);
  enviandoRef.current = enviando;
  const caja = useRef(null);
  const avisoError = useRef(null);
  const adjuntos = useVisorDeAdjuntos();

  const cargar = useCallback(
    (refresco = false) => {
      soporteService
        .miTicket(id)
        .then((datos) => {
          // Si soporte respondió con la ficha abierta, se dice.
          const actual = anterior.current;
          if (refresco && actual) {
            const deSoporte = (lista) =>
              lista.filter((m) => !m.del_solicitante).length;
            if (deSoporte(datos.mensajes) > deSoporte(actual.mensajes))
              setNovedad("Soporte le respondió: lea el mensaje nuevo abajo.");
            else if (datos.estado !== actual.estado)
              setNovedad(`Su ticket pasó a «${datos.estado_display}».`);
          }
          anterior.current = datos;
          setTicket(datos);
          cargado.current = true;
          setErrorCarga(null);
          setRefrescoFallido(false);
        })
        .catch((err) => {
          const estado = err?.response?.status;
          if (!cargado.current && (estado === 404 || estado === 403))
            setNoExiste(true);
          else if (cargado.current) setRefrescoFallido(true);
          else
            setErrorCarga(mensajeDeError(err, "No se pudo cargar su ticket."));
        });
    },
    [id],
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Se refresca con la pestaña a la vista y sin un envío en curso; un
  // ticket que no existe no se vuelve a pedir.
  useEffect(() => {
    if (noExiste) return undefined;
    const intervalo = setInterval(() => {
      if (document.visibilityState !== "hidden" && !enviandoRef.current)
        cargar(true);
    }, REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [cargar, noExiste]);

  // El título de la barra y de la pestaña: el ticket, no «Soporte TI».
  const numero = ticket?.numero;
  const caso = ticket?.caso;
  useEffect(() => {
    if (numero) fijarTituloPropio(`${numero} · ${caso}`);
    else if (noExiste) fijarTituloPropio("Ticket no disponible");
    return () => fijarTituloPropio(null);
  }, [numero, caso, noExiste]);

  /* `donde`: responder, confirmar o encuesta. El error, el «Enviando…» y el
   * aviso salen junto al botón que se pulsó. */
  const [origen, setOrigen] = useState("responder");
  async function ejecutar(accion, donde = "responder") {
    setOrigen(donde);
    setEnviando(true);
    setError(null);
    setAviso(null);
    setNovedad(null);
    try {
      const actualizado = await accion();
      anterior.current = actualizado;
      setTicket(actualizado);
      setTexto("");
      setArchivos([]);
      setOmitidos(0);
      setLlaveArchivos((n) => n + 1);
      setAviso(HECHO[donde]);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar."));
      requestAnimationFrame(() => avisoError.current?.focus());
    } finally {
      setEnviando(false);
    }
  }

  const descargar = adjuntos.abrir;

  /** «No, sigue el problema» y «Responder»: lleva a la caja de respuesta. */
  function irAResponder() {
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

  if (noExiste) {
    return (
      <section className="mz-card">
        <div className="mz-card-body mz-empty">
          <Icon name="search" />
          <h2 className="h5">Ticket no disponible</h2>
          <p className="mb-2">No encontramos este ticket entre los suyos.</p>
          <div className="mz-actions justify-content-center">
            <Link className="btn btn-primary" to="/admin/ayuda?vista=mios">
              Ver mis tickets
            </Link>
            <Link className="btn btn-outline-secondary" to="/admin/ayuda">
              Pedir ayuda
            </Link>
          </div>
        </div>
      </section>
    );
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
          {ticket && <p className="mz-desc">{ticket.caso}</p>}
        </div>
        <div className="mz-view-actions">
          <Link
            className="btn btn-outline-secondary"
            to="/admin/ayuda?vista=mios"
          >
            <Icon name="arrow-left" /> Volver a mis tickets
          </Link>
        </div>
      </div>

      {!ticket && (
        <EstadoDeCarga
          cargando={!errorCarga}
          error={errorCarga}
          onReintentar={() => {
            setErrorCarga(null);
            cargar();
          }}
        />
      )}

      {adjuntos.error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {adjuntos.error}
        </div>
      )}
      {adjuntos.visor}

      {/* Montado mientras haya ticket: se anuncia al cambiar su contenido. */}
      {ticket && (
        <div role="status">
          {refrescoFallido && (
            <p className="mz-small mz-faint mb-0">
              No se pudo actualizar el ticket; se muestra la última información
              y se volverá a intentar en unos segundos.
            </p>
          )}
          {novedad && (
            <div className="mz-alert mz-alert--info mb-0">
              <Icon name="bell" />
              {novedad}
            </div>
          )}
        </div>
      )}

      {ticket && (
        <>
          <section className="mz-card">
            <div className="mz-card-body">
              <div className="soporte-publico__estado">
                <EstadoTicket ticket={ticket} />
                {ticket.posicion ? (
                  <span>{enLaCola(ticket.posicion)}</span>
                ) : ticket.atiende ? (
                  <span>Lo atiende {ticket.atiende}</span>
                ) : null}
              </div>
              {/* Qué le toca, como en la lista (antes, solo la etiqueta). */}
              {ticket.estado === "esperando_usuario" && (
                <div className="mz-alert mz-alert--warn soporte-confirmar mt-2 mb-0">
                  <Icon name="arrow-right-circle" />
                  <span>
                    Soporte necesita algo de usted: lea su mensaje y respóndalo
                    abajo.
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary ms-auto"
                    onClick={irAResponder}
                  >
                    Responder
                  </button>
                </div>
              )}
              {ticket.estado === "cerrado" && ticket.puede_encuestar && (
                <div className="mz-alert mz-alert--info mt-2 mb-0">
                  <Icon name="star" />
                  <span>
                    Su ticket está cerrado.{" "}
                    <a href="#encuesta">Cuéntenos cómo le fue</a>: le toma un
                    minuto.
                  </span>
                </div>
              )}
              {/* Cuándo le van a responder y para cuándo debería estar
                  resuelto. Si se atrasa, se escribe en el ticket: es el
                  único contacto con soporte. */}
              {respuestaVence && (
                <p className="mt-2 mb-0">
                  {respuestaVence > ahora ? (
                    <>
                      <Icon name="clock" /> Le responderemos antes del{" "}
                      <strong>{formatearFecha(plazos.respuesta, true)}</strong>
                    </>
                  ) : (
                    <>
                      <Icon name="exclamation-triangle" /> Está tardando más de
                      lo previsto; el equipo de soporte ya fue avisado. Si le
                      urge, escríbalo abajo en este ticket.
                    </>
                  )}
                </p>
              )}
              {plazos.solucion &&
                !(respuestaVence && respuestaVence <= ahora) && (
                  <p className="mt-2 mb-0">
                    {new Date(plazos.solucion).getTime() > ahora ? (
                      <>
                        <Icon name="calendar-check" /> Debería quedar resuelto
                        antes del{" "}
                        <strong>{formatearFecha(plazos.solucion, true)}</strong>
                      </>
                    ) : (
                      <>
                        <Icon name="exclamation-triangle" /> La solución está
                        tardando más de lo previsto; el equipo de soporte ya fue
                        avisado. Si le urge, escríbalo abajo en este ticket.
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
              <h3 className="soporte-datos__titulo mt-3">Lo que nos contó</h3>
              <p className="soporte-publico__descripcion">
                {ticket.descripcion}
              </p>
              <Adjuntos
                lista={ticket.adjuntos}
                abriendo={adjuntos.abriendo}
                onDescargar={descargar}
              />
            </div>
          </section>

          {/* «¿Quedó resuelto?», con sus dos respuestas y cuándo se cierra
              solo si no contesta. */}
          {ticket.puede_confirmar && (
            <div className="mz-alert mz-alert--info soporte-confirmar">
              <Icon name="check2-circle" />
              <span>
                Soporte marcó su ticket como resuelto. ¿Quedó resuelto?
                {ticket.cierre_automatico && (
                  <>
                    {" "}
                    Si no nos responde, se cerrará solo el{" "}
                    <strong>{formatearFecha(ticket.cierre_automatico)}</strong>.
                  </>
                )}
              </span>
              <span className="soporte-confirmar__botones">
                <button
                  type="button"
                  className="btn btn-primary"
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
                  className="btn btn-outline-secondary"
                  onClick={irAResponder}
                >
                  No, sigue el problema
                </button>
              </span>
            </div>
          )}
          {origen === "confirmar" && error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {origen === "confirmar" && <Aviso texto={aviso} />}

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
              aviso={origen === "encuesta" ? aviso : null}
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
                        m.del_solicitante
                          ? "soporte-hilo__propio"
                          : "soporte-hilo__equipo"
                      }
                    >
                      {/* Quién habló, en texto y no solo por el color. */}
                      <div className="soporte-hilo__cabeza">
                        {m.del_solicitante ? (
                          <span className="mz-pill soporte-pill--info">
                            Usted
                          </span>
                        ) : (
                          <span className="mz-pill mz-pill--neutral">
                            Soporte TI
                          </span>
                        )}
                        {!m.del_solicitante && <strong>{m.autor}</strong>}
                        <time className="mz-small mz-faint" dateTime={m.fecha}>
                          {formatearFecha(m.fecha, true)}
                        </time>
                      </div>
                      <p className="mb-1">{m.texto}</p>
                      <Adjuntos
                        lista={m.adjuntos}
                        abriendo={adjuntos.abriendo}
                        onDescargar={descargar}
                      />
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
                      : ticket.mensajes.length === 0
                        ? "¿Quiere agregar algo?"
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
                      (opcional: foto, PDF, Word o Excel; hasta 3, de 10 MB cada
                      uno)
                    </span>
                  </label>
                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <input
                      key={llaveArchivos}
                      id="sg-adjuntos"
                      type="file"
                      className="form-control soporte-publico__archivos"
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
                      {enviando && origen === "responder"
                        ? "Enviando…"
                        : "Enviar"}
                    </button>
                  </div>
                  {archivos.length > 0 && (
                    <ul
                      className="soporte-por-adjuntar"
                      aria-label="Archivos por adjuntar"
                    >
                      {archivos.map((archivo, i) => (
                        <li key={`${archivo.name}-${i}`}>
                          <Icon name="paperclip" /> {archivo.name}
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 ms-1"
                            aria-label={`Quitar ${archivo.name}`}
                            onClick={() => {
                              setArchivos((lista) =>
                                lista.filter((_, j) => j !== i),
                              );
                              setLlaveArchivos((n) => n + 1);
                            }}
                          >
                            <Icon name="x-lg" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* El resultado del envío, junto al botón. */}
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
                  {origen === "responder" && (
                    <div className="mt-2">
                      <Aviso texto={aviso} />
                    </div>
                  )}
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

const SATISFACCION = [
  "Nada satisfecho",
  "Poco satisfecho",
  "Regular",
  "Satisfecho",
  "Muy satisfecho",
];

/** Tres preguntas al cerrar: calificación, si se resolvió y un comentario. */
function Encuesta({ ticket, onResponder, enviando, error, aviso }) {
  const [calificacion, setCalificacion] = useState(0);
  const [resuelto, setResuelto] = useState("");
  const [comentario, setComentario] = useState("");
  const [falta, setFalta] = useState(null);
  const grupoEstrellas = useRef(null);
  const grupoResuelto = useRef(null);

  if (ticket.encuesta) {
    return (
      <section className="mz-card" id="encuesta">
        <div className="mz-card-body">
          <Aviso texto={aviso} />
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
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          // Se valida al enviar, con el motivo junto al botón (antes el
          // botón quedaba deshabilitado y el motivo no se anunciaba).
          const motivo = !calificacion
            ? "Elija una calificación de 1 a 5 estrellas."
            : !resuelto
              ? "Indique si su requerimiento se resolvió."
              : null;
          setFalta(motivo);
          if (motivo) {
            // El foco a la pregunta que falta.
            (!calificacion ? grupoEstrellas : grupoResuelto).current
              ?.querySelector("input")
              ?.focus();
            return;
          }
          onResponder({
            calificacion,
            resuelto: resuelto === "si",
            comentario,
          });
        }}
      >
        <fieldset
          className="mb-3"
          ref={grupoEstrellas}
          aria-describedby={falta && !calificacion ? "enc-falta" : undefined}
        >
          <legend className="form-label">
            ¿Qué tan satisfecho está con la atención recibida?
          </legend>
          {/* Radios nativos con aspecto de estrella: una sola parada de Tab,
              las flechas cambian la calificación y cada estrella mide 44 px. */}
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
                  onChange={() => {
                    setCalificacion(n);
                    setFalta(null);
                  }}
                />
                <Icon name={n <= calificacion ? "star-fill" : "star"} />
                <span className="visually-hidden">
                  {n} de 5: {SATISFACCION[n - 1]}
                </span>
              </label>
            ))}
          </div>
          <div className="soporte-estrellas__extremos mz-small mz-faint">
            <span>Nada satisfecho</span>
            <span>Muy satisfecho</span>
          </div>
          {calificacion > 0 && (
            <p className="mz-small mb-0 mt-1">
              {SATISFACCION[calificacion - 1]}
            </p>
          )}
        </fieldset>
        <fieldset
          className="mb-3"
          ref={grupoResuelto}
          aria-describedby={
            falta && calificacion && !resuelto ? "enc-falta" : undefined
          }
        >
          <legend className="form-label">
            ¿Su requerimiento se resolvió completamente?
          </legend>
          <div className="btn-group" role="radiogroup" aria-label="Se resolvió">
            {[
              ["si", "Sí"],
              ["no", "No"],
            ].map(([valor, etiqueta]) => (
              <label
                key={valor}
                className={`btn ${resuelto === valor ? "btn-primary" : "btn-outline-secondary"} soporte-si-no`}
              >
                <input
                  type="radio"
                  name="resuelto"
                  className="visually-hidden"
                  checked={resuelto === valor}
                  onChange={() => {
                    setResuelto(valor);
                    setFalta(null);
                  }}
                />
                {etiqueta}
              </label>
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
          <button type="submit" className="btn btn-primary" disabled={enviando}>
            {enviando ? "Enviando…" : "Enviar encuesta"}
          </button>
        </div>
        {falta && (
          <div id="enc-falta" className="mz-field-error mt-1" role="alert">
            {falta}
          </div>
        )}
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

function Adjuntos({ lista, abriendo, onDescargar }) {
  if (!lista?.length) return null;
  return (
    <ul className="soporte-adjuntos">
      {lista.map((a) => {
        const cargando = abriendo === a.id;
        return (
          <li key={a.id}>
            <button
              type="button"
              className="btn btn-link btn-sm p-0"
              aria-busy={cargando || undefined}
              onClick={() => !cargando && onDescargar(a)}
            >
              <Icon name="paperclip" /> {cargando ? "Abriendo…" : a.nombre}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
