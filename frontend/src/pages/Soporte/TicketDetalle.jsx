import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { descargarBlob } from "../../utils/descargas";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import { EstadoTicket, PrioridadTicket, SlaTicket } from "./comunes";
import "./Soporte.css";

const TEXTO_DEL_PASO = {
  en_curso: "Poner en curso",
  esperando_usuario: "Esperar al usuario",
  atendido: "Marcar como atendido",
  cerrado: "Cerrar",
};

/**
 * La ficha de un ticket para el equipo: datos de quien pidió, la conversación
 * (con notas internas que el usuario no ve), los pasos que se pueden dar,
 * escalar al nivel siguiente y, si se trabaja fuera del horario, registrar las
 * horas dedicadas.
 */
export function TicketDetalle() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [respuestas, setRespuestas] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
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

  async function hacer(accion, mensaje) {
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
    try {
      const respuesta = await soporteService.descargar(adjunto.url);
      descargarBlob(respuesta.data, adjunto.nombre);
    } catch {
      setError("No se pudo descargar el archivo.");
    }
  }

  if (!ticket) {
    return error ? (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        {error}
      </div>
    ) : (
      <div className="mz-empty">Cargando…</div>
    );
  }

  const permisos = ticket.permisos ?? { acciones: [] };

  return (
    <div className="soporte-page">
      <div className="mz-view-head">
        <div>
          <h2>
            {ticket.numero} <EstadoTicket ticket={ticket} />
          </h2>
          <p className="mz-desc">
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

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}
      {pedirHoras && (
        <RegistrarHoras
          onCancelar={() => setPedirHoras(false)}
          onGuardar={async (datos) => {
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
              {(ticket.datos_adicionales ?? []).map((d) => (
                <Dato key={d.clave} etiqueta={d.etiqueta}>
                  {d.valor}
                </Dato>
              ))}
              <Dato etiqueta="Prioridad">
                <PrioridadTicket ticket={ticket} />
              </Dato>
              <Dato etiqueta="Nivel">{ticket.nivel}</Dato>
              <Dato etiqueta="Atiende">
                {ticket.tecnico?.nombre || "Sin asignar"}
              </Dato>
              <Dato etiqueta="SLA">
                <SlaTicket sla={ticket.sla} />
              </Dato>
              <Dato etiqueta="Creado">
                {formatearFecha(ticket.created_at, true)}
              </Dato>
            </div>
          </section>

          {(permisos.acciones.length > 0 ||
            permisos.escalar ||
            permisos.asignar) && (
            <Acciones
              ticket={ticket}
              tecnicos={tecnicos}
              ocupado={ocupado}
              onPaso={(estado, nota) =>
                hacer(
                  () => soporteService.cambiarEstado(ticket.id, estado, nota),
                  "Estado actualizado.",
                )
              }
              onEscalar={(motivo) =>
                hacer(
                  () => soporteService.escalar(ticket.id, motivo),
                  "Ticket escalado al siguiente nivel.",
                )
              }
              onAsignar={(tecnico, nota) =>
                hacer(
                  () => soporteService.asignar(ticket.id, tecnico, nota),
                  "Ticket asignado.",
                )
              }
            />
          )}

          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Historial</h3>
            </div>
            <div className="mz-card-body">
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
            </div>
          </section>
        </div>
      </div>
    </div>
  );
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
 * predefinidas; elegir una la inserta con los datos del ticket. */
function Responder({ respuestas, ticket, ocupado, onEnviar }) {
  const [texto, setTexto] = useState("");
  const [interno, setInterno] = useState(false);
  const [archivos, setArchivos] = useState([]);

  const consulta = texto.startsWith("/") ? texto.slice(1).toLowerCase() : null;
  const sugerencias =
    consulta === null
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
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (await onEnviar({ texto, interno }, archivos)) {
      setTexto("");
      setArchivos([]);
    }
  }

  return (
    <form className="mt-3" onSubmit={enviar}>
      <label className="form-label" htmlFor="td-texto">
        {interno
          ? "Nota interna (el usuario no la ve)"
          : "Respuesta al usuario"}
      </label>
      <textarea
        id="td-texto"
        className="form-control"
        rows={4}
        required
        maxLength={10000}
        placeholder="Escriba «/» para usar una respuesta predefinida"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      {sugerencias.length > 0 && (
        <ul
          className="soporte-sugerencias"
          aria-label="Respuestas predefinidas"
        >
          {sugerencias.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => usar(r)}>
                <span className="mz-mono">/{r.atajo}</span> · {r.titulo}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="d-flex flex-wrap gap-3 align-items-center mt-2">
        <div className="form-check mb-0">
          <input
            id="td-interno"
            type="checkbox"
            className="form-check-input"
            checked={interno}
            onChange={(e) => setInterno(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="td-interno">
            Nota interna
          </label>
        </div>
        <input
          type="file"
          className="form-control form-control-sm soporte-publico__archivos"
          multiple
          aria-label="Adjuntar archivos"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
          onChange={(e) =>
            setArchivos(Array.from(e.target.files ?? []).slice(0, 3))
          }
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm ms-auto"
          disabled={ocupado}
        >
          {interno ? "Guardar nota" : "Enviar respuesta"}
        </button>
      </div>
    </form>
  );
}

function Acciones({ ticket, tecnicos, ocupado, onPaso, onEscalar, onAsignar }) {
  const [nota, setNota] = useState("");
  const [tecnico, setTecnico] = useState("");
  const permisos = ticket.permisos;

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Qué se puede hacer</h3>
      </div>
      <div className="mz-card-body">
        <div className="mz-field">
          <label htmlFor="ta-nota">Nota o motivo</label>
          <textarea
            id="ta-nota"
            className="form-control form-control-sm"
            rows={2}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
          <div className="form-text">
            Obligatorio al esperar al usuario (es lo que le llega) y al escalar.
          </div>
        </div>
        <div className="mz-actions">
          {permisos.acciones.map((destino) => (
            <button
              key={destino}
              type="button"
              className={`btn btn-sm ${destino === "atendido" ? "btn-primary" : "btn-outline-primary"}`}
              disabled={ocupado}
              onClick={async () => (await onPaso(destino, nota)) && setNota("")}
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
              onClick={async () => (await onEscalar(nota)) && setNota("")}
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

/** Se ofrece cuando quien atiende está fuera de su horario. */
function RegistrarHoras({ onGuardar, onCancelar }) {
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
          onGuardar(valores);
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
          <button type="submit" className="btn btn-primary btn-sm">
            Registrar
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
