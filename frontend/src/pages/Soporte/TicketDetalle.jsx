import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { descargarBlob } from "../../utils/descargas";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import {
  EstadoTicket,
  IMPACTOS,
  CriticidadTicket,
  PrioridadTicket,
  RespuestaTicket,
  SlaTicket,
  URGENCIAS,
  useEtiquetas,
} from "./comunes";
import "./Soporte.css";

/* Pasos que piden «Nota o motivo» antes de enviarse: al esperar al usuario es
 * lo que le llega; al escalar, lo que lee el nivel siguiente. */
const PASOS_CON_NOTA = new Set(["esperando_usuario"]);
const MAX_ADJUNTOS = 3;

const TEXTO_DEL_PASO = {
  en_curso: "Poner en curso",
  esperando_usuario: "Esperar al usuario",
  atendido: "Marcar como atendido",
  cerrado: "Cerrar",
};

/**
 * La ficha de un ticket para el equipo: datos de quien pidió, la conversación
 * (con notas internas que el usuario no ve), los pasos que se pueden dar,
 * escalar al nivel siguiente, ajustar la prioridad con justificación y, si se
 * trabaja fuera del horario, registrar las horas dedicadas.
 */
export function TicketDetalle() {
  const { id } = useParams();
  const etiquetas = useEtiquetas();
  const [ticket, setTicket] = useState(null);
  const [respuestas, setRespuestas] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  /* Dónde se muestra el resultado de la última acción: el de los pasos,
   * escalar y asignar va dentro de «Qué se puede hacer», junto a los botones
   * (auditoría UX/UI, fase 2, 28/10/2026: salía arriba de la página, lejos de
   * la columna derecha donde se hizo clic). */
  const [origen, setOrigen] = useState("pagina");
  const [ocupado, setOcupado] = useState(false);
  const [pedirHoras, setPedirHoras] = useState(false);

  const cargar = useCallback(() => {
    soporteService
      .ticket(id)
      .then(setTicket)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el ticket.")),
      );
  }, [id]);

  useEffect(() => {
    cargar();
    soporteService
      .respuestas()
      .then(setRespuestas)
      .catch(() => setRespuestas([]));
  }, [cargar]);

  useEffect(() => {
    if (ticket?.permisos?.asignar && tecnicos.length === 0) {
      soporteService
        .tecnicos()
        .then(setTecnicos)
        .catch(() => setTecnicos([]));
    }
  }, [ticket, tecnicos.length]);

  async function hacer(accion, mensaje, donde = "pagina") {
    setOrigen(donde);
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const resultado = await accion();
      if (resultado?.visible === false) {
        setAviso(`${mensaje} El ticket ya no está a su cargo.`);
        setTicket((actual) => ({
          ...actual,
          estado: resultado.estado,
          permisos: { acciones: [] },
        }));
      } else {
        setTicket(resultado);
        setAviso(mensaje);
        if (resultado?.registrar_horas) setPedirHoras(true);
      }
      return true;
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo completar la acción."));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function descargar(adjunto) {
    setOrigen("pagina");
    try {
      const respuesta = await soporteService.descargar(adjunto.url);
      descargarBlob(respuesta.data, adjunto.nombre);
    } catch {
      setError("No se pudo descargar el archivo.");
    }
  }

  if (!ticket) {
    return (
      <EstadoDeCarga
        cargando
        error={error}
        onReintentar={() => {
          setError(null);
          cargar();
        }}
      />
    );
  }

  const permisos = ticket.permisos ?? { acciones: [] };
  const hayAcciones =
    permisos.acciones.length > 0 || permisos.escalar || permisos.asignar;
  // Si tras la acción la tarjeta desaparece (escalado: ya no es suyo), el
  // aviso sube a la página para que no se pierda.
  const resultadoEnAcciones = origen === "acciones" && hayAcciones;

  return (
    <div className="soporte-page">
      <div className="mz-view-head">
        <div>
          <h2>
            {ticket.numero} <EstadoTicket ticket={ticket} />
          </h2>
          <p className="mz-desc">
            <span className="mz-pill mz-pill--neutral me-2">
              {ticket.tipo_display}
            </span>
            {ticket.codigo && (
              <span className="mz-mono me-1">{ticket.codigo}</span>
            )}
            {ticket.categoria} · {ticket.caso}
          </p>
        </div>
        <div className="mz-view-actions">
          <Link
            className="btn btn-outline-secondary btn-sm"
            to="/admin/soporte/bandeja"
          >
            Volver a la bandeja
          </Link>
        </div>
      </div>

      {!resultadoEnAcciones && <Resultado error={error} aviso={aviso} />}
      {pedirHoras && (
        <RegistrarHoras
          onCancelar={() => setPedirHoras(false)}
          onGuardar={async (datos) => {
            setOrigen("pagina");
            setError(null);
            setAviso(null);
            try {
              await soporteService.registrarHoras(ticket.id, datos);
              setPedirHoras(false);
              setAviso(
                "Horas fuera de horario registradas. Las revisa su supervisión.",
              );
            } catch (err) {
              setError(
                mensajeDeError(err, "No se pudieron registrar las horas."),
              );
            }
          }}
        />
      )}

      <div className="soporte-detalle">
        <div className="mz-stack">
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Solicitud</h3>
            </div>
            <div className="mz-card-body">
              <p className="soporte-publico__descripcion">
                {ticket.descripcion}
              </p>
              <ListaDeAdjuntos
                lista={ticket.adjuntos}
                onDescargar={descargar}
              />
            </div>
          </section>

          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Conversación</h3>
            </div>
            <div className="mz-card-body">
              {ticket.mensajes.length === 0 ? (
                <p className="mz-faint">Todavía no hay mensajes.</p>
              ) : (
                <ul className="soporte-hilo">
                  {ticket.mensajes.map((m) => (
                    <li
                      key={m.id}
                      className={
                        m.interno
                          ? "soporte-hilo__interno"
                          : m.del_solicitante
                            ? "soporte-hilo__propio"
                            : undefined
                      }
                    >
                      <div className="mz-small mz-faint">
                        {m.autor} · {formatearFecha(m.fecha, true)}
                        {m.interno && " · nota interna"}
                      </div>
                      <p className="mb-1">{m.texto}</p>
                      <ListaDeAdjuntos
                        lista={m.adjuntos}
                        onDescargar={descargar}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {permisos.responder && ticket.estado !== "cerrado" && (
                <Responder
                  respuestas={respuestas}
                  ticket={ticket}
                  ocupado={ocupado}
                  onEnviar={(datos, archivos) =>
                    hacer(
                      () =>
                        soporteService.responder(ticket.id, datos, archivos),
                      datos.interno
                        ? "Nota interna guardada."
                        : "Respuesta enviada al usuario.",
                    )
                  }
                />
              )}
            </div>
          </section>
        </div>

        <div className="mz-stack">
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Datos</h3>
            </div>
            <div className="mz-card-body mz-kv-grid">
              <Dato etiqueta="Solicitante">{ticket.solicitante_nombre}</Dato>
              {ticket.solicitante_telefono && (
                <Dato etiqueta="Teléfono">
                  <span className="mz-mono">{ticket.solicitante_telefono}</span>
                </Dato>
              )}
              <Dato etiqueta="Correo">{ticket.solicitante_correo}</Dato>
              {ticket.agencia && (
                <Dato etiqueta="Agencia">{ticket.agencia}</Dato>
              )}
              {ticket.area && <Dato etiqueta="Área">{ticket.area}</Dato>}
              {/* Lista de {clave, etiqueta, valor}; cualquier otra cosa (un
                  registro viejo o cargado a mano) no tumba la pantalla. */}
              {(Array.isArray(ticket.datos_adicionales)
                ? ticket.datos_adicionales
                : []
              ).map((d) => (
                <Dato key={d.clave} etiqueta={d.etiqueta}>
                  {d.valor}
                </Dato>
              ))}
              <Dato etiqueta="Canal">
                {ticket.canal_display}
                {ticket.registrado_por && (
                  <div className="mz-small mz-faint">
                    Registrado por {ticket.registrado_por}
                  </div>
                )}
              </Dato>
              <Dato etiqueta="Criticidad">
                <CriticidadTicket ticket={ticket} />
              </Dato>
              <Dato etiqueta="Prioridad">
                <PrioridadTicket ticket={ticket} />
                {ticket.prioridad_base &&
                  ticket.prioridad_base !== ticket.prioridad && (
                    <div className="mz-small mz-faint">
                      Base del caso:{" "}
                      {etiquetas.prioridades.find(
                        ([v]) => v === ticket.prioridad_base,
                      )?.[1] ?? ticket.prioridad_base}
                    </div>
                  )}
              </Dato>
              {ticket.impacto && (
                <Dato etiqueta="Impacto">{ticket.impacto_display}</Dato>
              )}
              {ticket.urgencia && (
                <Dato etiqueta="Urgencia">{ticket.urgencia_display}</Dato>
              )}
              <Dato etiqueta="Nivel">{ticket.nivel}</Dato>
              <Dato etiqueta="Atiende">
                {ticket.tecnico?.nombre || "Sin asignar"}
              </Dato>
              <Dato etiqueta="Respuesta">
                <RespuestaTicket sla={ticket.sla} />
              </Dato>
              <Dato etiqueta="Solución">
                <SlaTicket sla={ticket.sla} />
              </Dato>
              {ticket.reaperturas > 0 && (
                <Dato etiqueta="Reaperturas">{ticket.reaperturas}</Dato>
              )}
              <Dato etiqueta="Creado">
                {formatearFecha(ticket.created_at, true)}
              </Dato>
            </div>
          </section>

          {hayAcciones && (
            <Acciones
              ticket={ticket}
              tecnicos={tecnicos}
              ocupado={ocupado}
              resultado={
                origen === "acciones" && (
                  <Resultado error={error} aviso={aviso} />
                )
              }
              onPaso={(estado, nota) =>
                hacer(
                  () => soporteService.cambiarEstado(ticket.id, estado, nota),
                  "Estado actualizado.",
                  "acciones",
                )
              }
              onEscalar={(motivo) =>
                hacer(
                  () => soporteService.escalar(ticket.id, motivo),
                  "Ticket escalado al siguiente nivel.",
                  "acciones",
                )
              }
              onAsignar={(tecnico, nota) =>
                hacer(
                  () => soporteService.asignar(ticket.id, tecnico, nota),
                  "Ticket asignado.",
                  "acciones",
                )
              }
            />
          )}

          {ticket.aprobaciones?.length > 0 && (
            <section className="mz-card">
              <div className="mz-card-head">
                <h3>Aprobaciones</h3>
              </div>
              <ul className="mz-card-body soporte-aprobaciones">
                {ticket.aprobaciones.map((a) => (
                  <li key={a.id}>
                    <strong>{a.rol}</strong>{" "}
                    <span
                      className={`mz-pill ${
                        a.estado === "aprobada"
                          ? "mz-pill--ok"
                          : a.estado === "rechazada"
                            ? "mz-pill--bad"
                            : "mz-pill--warn"
                      }`}
                    >
                      {a.estado_display}
                    </span>
                    <div className="mz-small mz-faint">
                      {a.decidido_por
                        ? `${a.decidido_por} · ${formatearFecha(a.decidido_en, true)}`
                        : a.aprobador
                          ? `Le toca a ${a.aprobador}`
                          : "Sin responsable con cuenta: decide quien coordina"}
                    </div>
                    {a.nota && <div className="mz-small">«{a.nota}»</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {permisos.prioridad && (
            <CambiarPrioridad
              ticket={ticket}
              prioridades={etiquetas.prioridades}
              ocupado={ocupado}
              onCambiar={(datos) =>
                hacer(
                  () => soporteService.cambiarPrioridad(ticket.id, datos),
                  "Prioridad actualizada; el plazo se recalculó.",
                )
              }
            />
          )}

          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Historial</h3>
            </div>
            <div className="mz-card-body">
              {ticket.movimientos?.length ? (
                <ul className="mz-timeline soporte-historial">
                  {ticket.movimientos.map((m) => (
                    <li key={m.id} className="mz-tl-item">
                      <strong className="mz-tl-what">{m.descripcion}</strong>
                      <div className="mz-tl-when">
                        {formatearFecha(m.created_at, true)} · {m.actor}
                      </div>
                      {m.nota && <div className="mz-tl-why">{m.nota}</div>}
                    </li>
                  ))}
                </ul>
              ) : (
                <EstadoDeCarga vacio textoVacio="Sin movimientos." />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** El aviso o el error de la última acción. Si el botón pulsado desapareció
 * (cambió el estado del ticket) y el foco quedó perdido, el foco viene aquí:
 * quien usa teclado oye y ve el resultado en vez de volver al inicio
 * (auditoría UX/UI, fase 2). */
function Resultado({ error, aviso }) {
  const ref = useRef(null);
  useEffect(() => {
    const activo = document.activeElement;
    const perdido =
      !activo || activo === document.body || activo.id === "contenido";
    if ((error || aviso) && perdido) ref.current?.focus();
  }, [error, aviso]);
  if (error) {
    return (
      <div
        className="mz-alert mz-alert--bad"
        role="alert"
        ref={ref}
        tabIndex={-1}
      >
        <Icon name="x-octagon" />
        {error}
      </div>
    );
  }
  if (aviso) {
    return (
      <div
        className="mz-alert mz-alert--ok"
        role="status"
        ref={ref}
        tabIndex={-1}
      >
        <Icon name="check2-circle" />
        {aviso}
      </div>
    );
  }
  return null;
}

function Dato({ etiqueta, children }) {
  return (
    <div className="mz-kv">
      <span className="mz-kv-label">{etiqueta}</span>
      {children}
    </div>
  );
}

function ListaDeAdjuntos({ lista, onDescargar }) {
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

/** La caja de respuesta. Escribir «/» al inicio sugiere las respuestas
 * predefinidas; elegir una la inserta con los datos del ticket.
 *
 * Auditoría UX/UI, fase 2 (28/10/2026): «Responder al usuario» o «Nota
 * interna» se elige antes de escribir, con un control segmentado encima del
 * campo; antes era una casilla apagada debajo y era fácil mandarle al
 * solicitante un texto que era interno. La nota interna pinta el campo de
 * aviso y el botón dice qué hará. */
function Responder({ respuestas, ticket, ocupado, onEnviar }) {
  const [texto, setTexto] = useState("");
  const [interno, setInterno] = useState(false);
  const [archivos, setArchivos] = useState([]);
  const [omitidos, setOmitidos] = useState(0);
  const [cerradas, setCerradas] = useState(false);
  const caja = useRef(null);

  const consulta = texto.startsWith("/") ? texto.slice(1).toLowerCase() : null;
  const sugerencias =
    consulta === null || cerradas
      ? []
      : respuestas.filter(
          (r) =>
            r.atajo.toLowerCase().startsWith(consulta) ||
            r.titulo.toLowerCase().includes(consulta),
        );

  function usar(respuesta) {
    const datos = {
      nombre: ticket.solicitante_nombre,
      numero: ticket.numero,
      caso: ticket.caso,
      tecnico: ticket.tecnico?.nombre ?? "",
    };
    setTexto(
      respuesta.texto.replace(
        /\{\{\s*(\w+)\s*\}\}/g,
        (_, clave) => datos[clave] ?? "",
      ),
    );
    caja.current?.focus();
  }

  /* Escape cierra las sugerencias, desde el campo o desde la lista. */
  function cerrarConEscape(evento) {
    if (evento.key !== "Escape" || sugerencias.length === 0) return;
    evento.preventDefault();
    setCerradas(true);
    caja.current?.focus();
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (await onEnviar({ texto, interno }, archivos)) {
      setTexto("");
      setArchivos([]);
      setOmitidos(0);
    }
  }

  return (
    <form className="mt-3" onSubmit={enviar}>
      <div
        className="btn-group btn-group-sm mb-2"
        role="group"
        aria-label="A quién va el mensaje"
      >
        <button
          type="button"
          className={`btn ${interno ? "btn-outline-secondary" : "btn-primary"}`}
          aria-pressed={!interno}
          onClick={() => setInterno(false)}
        >
          Responder al usuario
        </button>
        <button
          type="button"
          className={`btn ${interno ? "btn-warning" : "btn-outline-secondary"}`}
          aria-pressed={interno}
          onClick={() => setInterno(true)}
        >
          <Icon name="lock" /> Nota interna
        </button>
      </div>
      <label className="form-label d-block" htmlFor="td-texto">
        {interno
          ? "Nota interna (el usuario no la ve)"
          : "Respuesta al usuario"}
      </label>
      <textarea
        id="td-texto"
        ref={caja}
        className={`form-control${interno ? " soporte-respuesta--interna" : ""}`}
        rows={4}
        required
        maxLength={10000}
        placeholder="Escriba «/» para usar una respuesta predefinida"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setCerradas(false);
        }}
        onKeyDown={cerrarConEscape}
      />
      <div className="visually-hidden" aria-live="polite">
        {sugerencias.length > 0
          ? `${sugerencias.length} respuestas sugeridas`
          : ""}
      </div>
      {sugerencias.length > 0 && (
        // Una lista de botones, no un listbox: sus opciones eran botones
        // dentro de role="option", que el lector no deja usar (auditoría
        // UX/UI, fase 2).
        <ul
          id="td-sugerencias"
          className="soporte-sugerencias"
          aria-label="Respuestas predefinidas"
        >
          {sugerencias.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => usar(r)}
                onKeyDown={cerrarConEscape}
              >
                <span className="mz-mono">/{r.atajo}</span> · {r.titulo}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="d-flex flex-wrap gap-3 align-items-center mt-2">
        <input
          type="file"
          className="form-control form-control-sm soporte-publico__archivos"
          multiple
          aria-label="Adjuntar archivos"
          aria-describedby={omitidos > 0 ? "td-adjuntos-aviso" : undefined}
          accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
          onChange={(e) => {
            const elegidos = Array.from(e.target.files ?? []);
            setArchivos(elegidos.slice(0, MAX_ADJUNTOS));
            setOmitidos(Math.max(0, elegidos.length - MAX_ADJUNTOS));
          }}
        />
        <button
          type="submit"
          className={`btn btn-sm ms-auto ${interno ? "btn-warning" : "btn-primary"}`}
          disabled={ocupado}
        >
          {interno ? "Guardar nota interna" : "Responder"}
        </button>
      </div>
      {omitidos > 0 && (
        <div
          id="td-adjuntos-aviso"
          className="mz-small mz-faint mt-1"
          role="status"
        >
          Máx. {MAX_ADJUNTOS} archivos; se omitieron {omitidos}.
        </div>
      )}
    </form>
  );
}

/* Auditoría UX/UI, fase 2 (28/10/2026): la nota es obligatoria para esperar
 * al usuario y para escalar, y antes se mandaba vacía y el servidor la
 * rechazaba arriba de la página. Se valida aquí, bajo el campo, y el aviso o
 * el error de la acción salen dentro de esta tarjeta. */
function Acciones({
  ticket,
  tecnicos,
  ocupado,
  resultado,
  onPaso,
  onEscalar,
  onAsignar,
}) {
  const [nota, setNota] = useState("");
  const [errorNota, setErrorNota] = useState(null);
  const [tecnico, setTecnico] = useState("");
  const campoNota = useRef(null);
  const permisos = ticket.permisos;

  /** true si hay nota; si no, marca el campo con `mensaje` y lo enfoca. */
  function notaLista(mensaje) {
    if (nota.trim()) {
      setErrorNota(null);
      return true;
    }
    setErrorNota(mensaje);
    campoNota.current?.focus();
    return false;
  }

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Qué se puede hacer</h3>
      </div>
      <div className="mz-card-body">
        {resultado}
        <div className="mz-field">
          <label htmlFor="ta-nota">Nota o motivo</label>
          <textarea
            id="ta-nota"
            ref={campoNota}
            className={`form-control form-control-sm${errorNota ? " is-invalid" : ""}`}
            rows={2}
            value={nota}
            aria-invalid={errorNota ? true : undefined}
            aria-describedby={`ta-nota-ayuda${errorNota ? " ta-nota-error" : ""}`}
            onChange={(e) => {
              setNota(e.target.value);
              if (errorNota && e.target.value.trim()) setErrorNota(null);
            }}
          />
          <div id="ta-nota-ayuda" className="form-text">
            Obligatorio al esperar al usuario (es lo que le llega) y al escalar.
          </div>
          {errorNota && (
            <div id="ta-nota-error" className="mz-field-error">
              {errorNota}
            </div>
          )}
        </div>
        <div className="mz-actions">
          {permisos.acciones.map((destino) => (
            <button
              key={destino}
              type="button"
              className={`btn btn-sm ${destino === "atendido" ? "btn-primary" : "btn-outline-primary"}`}
              disabled={ocupado}
              onClick={async () => {
                if (PASOS_CON_NOTA.has(destino)) {
                  if (
                    !notaLista(
                      "Escriba qué necesita del usuario: es lo que le llega.",
                    )
                  )
                    return;
                } else {
                  setErrorNota(null);
                }
                if (await onPaso(destino, nota)) setNota("");
              }}
            >
              {destino === "en_curso" && ticket.estado === "atendido"
                ? "Reabrir"
                : TEXTO_DEL_PASO[destino]}
            </button>
          ))}
          {permisos.escalar && (
            <button
              type="button"
              className="btn btn-sm btn-outline-danger"
              disabled={ocupado}
              onClick={async () => {
                if (!notaLista("Escriba el motivo para escalar el ticket."))
                  return;
                if (await onEscalar(nota)) setNota("");
              }}
            >
              Escalar al siguiente nivel
            </button>
          )}
        </div>
        {permisos.asignar && (
          <div className="mt-3">
            <label className="form-label" htmlFor="ta-tecnico">
              Asignar a
            </label>
            <div className="d-flex gap-2">
              <select
                id="ta-tecnico"
                className="form-select form-select-sm"
                value={tecnico}
                onChange={(e) => setTecnico(e.target.value)}
              >
                <option value="">Elija un técnico</option>
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} · {t.nivel} · {t.abiertos} abierto(s)
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                disabled={ocupado || !tecnico}
                onClick={() => onAsignar(tecnico, nota)}
              >
                Asignar
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Ajustar la prioridad: elegirla, o calcularla por impacto y urgencia.
 * Siempre con justificación, que queda en el historial. */
function CambiarPrioridad({ ticket, prioridades, ocupado, onCambiar }) {
  const [modo, setModo] = useState("matriz");
  const [valores, setValores] = useState({
    prioridad: ticket.prioridad,
    impacto: ticket.impacto || "",
    urgencia: ticket.urgencia || "",
    justificacion: "",
  });
  const fijar = (campo) => (e) =>
    setValores((actual) => ({ ...actual, [campo]: e.target.value }));

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Ajustar prioridad</h3>
      </div>
      <form
        className="mz-card-body"
        onSubmit={async (e) => {
          e.preventDefault();
          const datos =
            modo === "matriz"
              ? {
                  impacto: valores.impacto,
                  urgencia: valores.urgencia,
                  justificacion: valores.justificacion,
                }
              : {
                  prioridad: valores.prioridad,
                  justificacion: valores.justificacion,
                };
          if (await onCambiar(datos))
            setValores((actual) => ({ ...actual, justificacion: "" }));
        }}
      >
        <fieldset className="mb-2">
          <legend className="form-label fs-6 mb-1">Cómo se calcula</legend>
          <div className="d-flex gap-3">
            <div className="form-check">
              <input
                id="cp-matriz"
                name="cp-modo"
                type="radio"
                className="form-check-input"
                checked={modo === "matriz"}
                onChange={() => setModo("matriz")}
              />
              <label className="form-check-label" htmlFor="cp-matriz">
                Por impacto y urgencia
              </label>
            </div>
            <div className="form-check">
              <input
                id="cp-directa"
                name="cp-modo"
                type="radio"
                className="form-check-input"
                checked={modo === "directa"}
                onChange={() => setModo("directa")}
              />
              <label className="form-check-label" htmlFor="cp-directa">
                Elegir la prioridad
              </label>
            </div>
          </div>
        </fieldset>
        {modo === "matriz" ? (
          <>
            <div className="mz-field">
              <label htmlFor="cp-impacto">Impacto</label>
              <select
                id="cp-impacto"
                className="form-select form-select-sm"
                required
                value={valores.impacto}
                onChange={fijar("impacto")}
              >
                <option value="">Elija</option>
                {IMPACTOS.map(([v, etiqueta]) => (
                  <option key={v} value={v}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="mz-field">
              <label htmlFor="cp-urgencia">Urgencia</label>
              <select
                id="cp-urgencia"
                className="form-select form-select-sm"
                required
                value={valores.urgencia}
                onChange={fijar("urgencia")}
              >
                <option value="">Elija</option>
                {URGENCIAS.map(([v, etiqueta]) => (
                  <option key={v} value={v}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <div className="mz-field">
            <label htmlFor="cp-prioridad">Prioridad</label>
            <select
              id="cp-prioridad"
              className="form-select form-select-sm"
              value={valores.prioridad}
              onChange={fijar("prioridad")}
            >
              {prioridades.map(([v, etiqueta]) => (
                <option key={v} value={v}>
                  {etiqueta}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mz-field">
          <label htmlFor="cp-justificacion">Justificación</label>
          <textarea
            id="cp-justificacion"
            className="form-control form-control-sm"
            rows={2}
            required
            maxLength={1000}
            value={valores.justificacion}
            onChange={fijar("justificacion")}
          />
          <div className="form-text">
            Queda en el historial. El plazo se recalcula conservando el tiempo
            ya consumido.
          </div>
        </div>
        <button
          type="submit"
          className="btn btn-sm btn-outline-primary"
          disabled={ocupado}
        >
          Cambiar prioridad
        </button>
      </form>
    </section>
  );
}

/** Se ofrece cuando quien atiende está fuera de su horario. */
function RegistrarHoras({ onGuardar, onCancelar }) {
  // Deshabilita «Registrar» mientras guarda: un doble clic registraba dos
  // veces las mismas horas (auditoría UX/UI, fase 2, 28/10/2026).
  const [guardando, setGuardando] = useState(false);
  const hoy = new Date();
  const [valores, setValores] = useState({
    fecha: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`,
    horas: "",
    descripcion: "",
  });
  const fijar = (campo) => (e) =>
    setValores((actual) => ({ ...actual, [campo]: e.target.value }));

  return (
    <section className="mz-card mb-3">
      <div className="mz-card-head">
        <h3>Está fuera de su horario de atención</h3>
      </div>
      <form
        className="mz-card-body row g-2 align-items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setGuardando(true);
          Promise.resolve(onGuardar(valores)).finally(() =>
            setGuardando(false),
          );
        }}
      >
        <p className="col-12 mz-small mz-faint mb-1">
          Registre el tiempo que dedica a este ticket fuera de horario: lo
          revisa su supervisión.
        </p>
        <div className="col-6 col-md-3">
          <label className="form-label" htmlFor="rh-fecha">
            Fecha
          </label>
          <input
            id="rh-fecha"
            type="date"
            className="form-control form-control-sm"
            required
            value={valores.fecha}
            onChange={fijar("fecha")}
          />
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label" htmlFor="rh-horas">
            Horas
          </label>
          <input
            id="rh-horas"
            type="number"
            min="0.25"
            max="24"
            step="0.25"
            className="form-control form-control-sm"
            required
            value={valores.horas}
            onChange={fijar("horas")}
          />
        </div>
        <div className="col-12 col-md-5">
          <label className="form-label" htmlFor="rh-descripcion">
            Qué hizo
          </label>
          <input
            id="rh-descripcion"
            className="form-control form-control-sm"
            required
            maxLength={255}
            value={valores.descripcion}
            onChange={fijar("descripcion")}
          />
        </div>
        <div className="col-12 col-md-2 d-flex gap-2">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={guardando}
          >
            {guardando ? "Registrando…" : "Registrar"}
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onCancelar}
          >
            Ahora no
          </button>
        </div>
      </form>
    </section>
  );
}
