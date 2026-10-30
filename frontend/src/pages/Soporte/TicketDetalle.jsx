import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { Campo } from "../../components/common/Campo/Campo";
import { confirmar } from "../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { AuthContext } from "../../context/AuthContext";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useModalA11y } from "../../hooks/useModalA11y";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import { fijarTituloPropio } from "../../utils/tituloDocumento";
import {
  EstadoTicket,
  IMPACTOS,
  PrioridadTicket,
  RespuestaTicket,
  SlaTicket,
  URGENCIAS,
  useEtiquetas,
  VenceTicket,
} from "./comunes";
import { useVisorDeAdjuntos } from "./VisorAdjunto";
import "./Soporte.css";

const MAX_ADJUNTOS = 3;

const TEXTO_DEL_PASO = {
  en_curso: "Poner en curso",
  esperando_usuario: "Esperar al usuario (pausa el plazo)",
  atendido: "Marcar como atendido",
  cerrado: "Cerrar",
};

/* Cada acción con consecuencias abre su propia ventana: qué va a pasar, un
 * campo con su nombre (quién lo lee) y la confirmación (auditoría UX/UI,
 * 30/10/2026: una sola «Nota o motivo» servía para cuatro cosas y cerrar,
 * escalar o marcar como atendido iban de un clic). */
function dialogoDe(accion, ticket) {
  switch (accion) {
    case "esperando_usuario":
      return {
        titulo: "Esperar al usuario",
        explicacion:
          "El plazo de solución se pausa hasta que el usuario responda.",
        campo: "Qué necesita del usuario",
        ayuda: "Le llega por correo y lo ve en su ticket.",
        obligatorio: "Escriba qué necesita del usuario: es lo que le llega.",
        boton: "Enviar y esperar",
      };
    case "atendido":
      return {
        titulo: "Marcar como atendido",
        explicacion: `Se avisa a ${ticket.solicitante_nombre} para que confirme si quedó resuelto. Si no responde, se cierra solo y entonces se le pide la encuesta.`,
        campo: "Qué se hizo (opcional)",
        ayuda: "Queda en el historial del ticket; el usuario no lo ve.",
        boton: "Marcar como atendido",
      };
    case "cerrado":
      return {
        titulo: "Cerrar el ticket",
        explicacion:
          "Un ticket cerrado ya no se puede reabrir ni responder. Si el problema vuelve, el usuario crea uno nuevo.",
        campo: "Motivo del cierre (opcional)",
        ayuda: "Queda en el historial del ticket.",
        boton: "Cerrar ticket",
        peligro: true,
      };
    case "escalar":
      return {
        titulo: "Escalar al siguiente nivel",
        explicacion:
          "Deja de estar a su cargo y pasa a la cola del nivel siguiente. El plazo sigue corriendo.",
        campo: "Motivo para el nivel siguiente",
        ayuda: "Lo lee quien lo tome; el usuario no lo ve.",
        obligatorio: "Escriba el motivo para escalar el ticket.",
        boton: "Escalar",
        peligro: true,
      };
    default:
      return null;
  }
}

/** Cada cuánto se vuelve a pedir el ticket (con la pestaña a la vista). */
const REFRESCO_MS = 45_000;

/** Lo que toca ahora con el ticket, en una frase. */
function queToca(ticket, permisos) {
  switch (ticket.estado) {
    case "nuevo":
      return permisos.tomar
        ? "Nadie lo ha tomado: tómelo para empezar."
        : permisos.asignar
          ? "Nadie lo ha tomado: asígnelo a un técnico."
          : "Espera en la cola a que lo tome un técnico de su categoría.";
    case "esperando_aprobacion": {
      const faltan = (ticket.aprobaciones ?? [])
        .filter((a) => a.estado === "pendiente")
        .map((a) => a.rol);
      return faltan.length
        ? `Esperando la aprobación de: ${faltan.join(", ")}.`
        : "Esperando aprobación.";
    }
    case "esperando_usuario":
      return "Esperando la respuesta del usuario: el plazo de solución está en pausa.";
    case "atendido":
      return `Atendido${ticket.atendido_en ? ` el ${formatearFecha(ticket.atendido_en, true)}` : ""}; falta que el usuario confirme que quedó resuelto.`;
    case "cerrado":
      return ticket.cerrado_en
        ? `Cerrado el ${formatearFecha(ticket.cerrado_en, true)}`
        : "Cerrado.";
    default:
      return ticket.respondido_en
        ? `Lo atiende ${ticket.tecnico?.nombre ?? "el equipo"}.`
        : `Lo atiende ${ticket.tecnico?.nombre ?? "el equipo"}: falta la primera respuesta al usuario.`;
  }
}

/**
 * La ficha de un ticket para el equipo: datos de quien pidió, la conversación
 * (con notas internas que el usuario no ve), los pasos que se pueden dar,
 * escalar al nivel siguiente, ajustar la prioridad con justificación y, si se
 * trabaja fuera del horario, registrar las horas dedicadas.
 *
 * Auditoría UX/UI de la ficha (30/10/2026): arriba, una franja con el
 * estado, el plazo que importa y lo que toca hacer; los datos agrupados
 * (plazos, quién pide, clasificación); en una columna, acciones y datos
 * antes de la conversación; cada mensaje dice quién habló; la encuesta y
 * por qué no se puede responder un cerrado; el título es el del ticket; la
 * ficha se actualiza sola; y un ticket que no existe lo dice en español,
 * con salida.
 */
export function TicketDetalle() {
  const { id } = useParams();
  const etiquetas = useEtiquetas();
  const location = useLocation();
  const navegar = useNavigate();
  // «Volver» regresa a la lista de donde se llegó (la bandeja o «Todos»);
  // si se entró por un enlace directo, a la bandeja.
  const hayDeDonde = location.key !== "default";
  // Opcional: la ficha también se pinta sin sesión cargada (pruebas).
  const user = useContext(AuthContext)?.user;
  const [ticket, setTicket] = useState(null);
  const [respuestas, setRespuestas] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);
  const [error, setError] = useState(null);
  const [noExiste, setNoExiste] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [novedad, setNovedad] = useState(null);
  /* Dónde se muestra el resultado de la última acción, junto a lo que se
   * pulsó: «acciones», «respuesta», «prioridad» o arriba («pagina»). */
  const [origen, setOrigen] = useState("pagina");
  const [ocupado, setOcupado] = useState(false);
  const [pedirHoras, setPedirHoras] = useState(false);
  const adjuntos = useVisorDeAdjuntos();
  // En una columna, acciones y datos van primero en el DOM (no solo en
  // pantalla): el tabulador y el lector de pantalla la recorren en el mismo
  // orden en que se ve.
  const unaColumna = useMediaQuery("(max-width: 991.98px)");
  const ocupadoRef = useRef(false);
  ocupadoRef.current = ocupado;

  const cargar = useCallback(() => {
    setNoExiste(false);
    soporteService
      .ticket(id)
      .then(setTicket)
      .catch((err) => {
        const estado = err?.response?.status;
        if (estado === 404 || estado === 403) setNoExiste(true);
        else setError(mensajeDeError(err, "No se pudo cargar el ticket."));
      });
  }, [id]);

  useEffect(() => {
    cargar();
    soporteService
      .respuestas()
      .then(setRespuestas)
      .catch(() => setRespuestas([]));
  }, [cargar]);

  // Se actualiza sola mientras la pestaña está a la vista (antes cargaba una
  // vez: si el usuario contestaba, el técnico no lo veía). Lo que se está
  // escribiendo no se pierde: vive en sus propios componentes.
  useEffect(() => {
    const intervalo = setInterval(() => {
      if (document.visibilityState === "hidden" || ocupadoRef.current) return;
      soporteService
        .ticket(id)
        .then((nuevo) =>
          setTicket((actual) => {
            if (!actual) return nuevo;
            const antes = actual.mensajes?.length ?? 0;
            const ahora = nuevo.mensajes?.length ?? 0;
            if (ahora > antes)
              setNovedad(
                ahora - antes === 1
                  ? "Llegó un mensaje nuevo a la conversación."
                  : `Llegaron ${ahora - antes} mensajes nuevos a la conversación.`,
              );
            else if (nuevo.estado !== actual.estado)
              setNovedad(`El ticket pasó a «${nuevo.estado_display}».`);
            return nuevo;
          }),
        )
        .catch(() => null);
    }, REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [id]);

  // El título de la barra y de la pestaña: el ticket, no «Bandeja».
  const numero = ticket?.numero;
  const caso = ticket?.caso;
  useEffect(() => {
    if (numero) fijarTituloPropio(`${numero} · ${caso}`);
    else if (noExiste) fijarTituloPropio("Ticket no disponible");
    return () => fijarTituloPropio(null);
  }, [numero, caso, noExiste]);

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
    setNovedad(null);
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

  const descargar = adjuntos.abrir;

  if (noExiste) {
    return (
      <section className="mz-card">
        <div className="mz-card-body mz-empty">
          <Icon name="search" />
          <h2 className="h5">Ticket no disponible</h2>
          <p className="mb-2">
            Este ticket no existe o ya no tiene acceso a él (pudo pasar a otro
            nivel o a otro técnico).
          </p>
          <Link className="btn btn-primary btn-sm" to="/admin/soporte/bandeja">
            Volver a la bandeja
          </Link>
        </div>
      </section>
    );
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
    permisos.tomar ||
    permisos.acciones.length > 0 ||
    permisos.escalar ||
    permisos.asignar ||
    Boolean(permisos.motivo_no_tomar);
  // Si tras la acción la tarjeta desaparece (escalado: ya no es suyo), el
  // aviso sube a la página para que no se pierda.
  const enSuLugar =
    (origen === "acciones" && hayAcciones) ||
    origen === "respuesta" ||
    origen === "prioridad";
  const miNombre = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(" ");

  const acciones = hayAcciones && (
    <Acciones
      ticket={ticket}
      tecnicos={tecnicos}
      miNombre={miNombre}
      ocupado={ocupado}
      error={origen === "acciones" ? error : null}
      resultado={
        origen === "acciones" && <Resultado error={error} aviso={aviso} />
      }
      onTomar={() =>
        hacer(
          () => soporteService.tomar(ticket.id),
          "El ticket es suyo: ya puede trabajarlo.",
          "acciones",
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
  );

  const adicionales = Array.isArray(ticket.datos_adicionales)
    ? ticket.datos_adicionales
    : [];
  const datos = (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Datos</h3>
      </div>
      <div className="mz-card-body soporte-datos">
        <h4 className="soporte-datos__titulo">Plazos</h4>
        <dl className="mz-kv-grid">
          <Dato etiqueta="Primera respuesta" ancho>
            <RespuestaTicket sla={ticket.sla} />
          </Dato>
          <Dato etiqueta="Solución" ancho>
            <SlaTicket sla={ticket.sla} />
          </Dato>
        </dl>
        <h4 className="soporte-datos__titulo">Quién pide</h4>
        <dl className="mz-kv-grid">
          <Dato etiqueta="Nombre">{ticket.solicitante_nombre}</Dato>
          {ticket.solicitante_telefono && (
            <Dato etiqueta="Teléfono">
              <a
                className="mz-mono"
                href={`tel:${ticket.solicitante_telefono.replace(/\s/g, "")}`}
              >
                {ticket.solicitante_telefono}
              </a>
            </Dato>
          )}
          {ticket.solicitante_correo && (
            <Dato etiqueta="Correo" ancho>
              <a href={`mailto:${ticket.solicitante_correo}`}>
                {ticket.solicitante_correo}
              </a>
            </Dato>
          )}
          {ticket.agencia && <Dato etiqueta="Agencia">{ticket.agencia}</Dato>}
          {ticket.area && <Dato etiqueta="Área">{ticket.area}</Dato>}
          {/* Lista de {clave, etiqueta, valor}; cualquier otra cosa (un
              registro viejo o cargado a mano) no tumba la pantalla. */}
          {adicionales.map((d) => (
            <Dato key={d.clave} etiqueta={d.etiqueta}>
              {d.valor}
            </Dato>
          ))}
        </dl>
        <h4 className="soporte-datos__titulo">Clasificación</h4>
        <dl className="mz-kv-grid">
          <Dato etiqueta="Prioridad">
            <PrioridadTicket ticket={ticket} />
            {ticket.prioridad_base &&
              ticket.prioridad_base !== ticket.prioridad && (
                <div className="mz-small mz-faint">
                  Prioridad por defecto del caso:{" "}
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
          <Dato etiqueta="Nivel de soporte">{ticket.nivel}</Dato>
          <Dato etiqueta="Canal">
            {ticket.canal_display}
            {ticket.registrado_por && (
              <div className="mz-small mz-faint">
                Registrado por {ticket.registrado_por}
              </div>
            )}
          </Dato>
          {ticket.reaperturas > 0 && (
            <Dato etiqueta="Reaperturas">{ticket.reaperturas}</Dato>
          )}
          <Dato etiqueta="Creado">
            {formatearFecha(ticket.created_at, true)}
          </Dato>
        </dl>
      </div>
    </section>
  );

  const solicitud = (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Solicitud</h3>
      </div>
      <div className="mz-card-body">
        <p className="soporte-publico__descripcion">{ticket.descripcion}</p>
        <ListaDeAdjuntos
          lista={ticket.adjuntos}
          abriendo={adjuntos.abriendo}
          onDescargar={descargar}
        />
      </div>
    </section>
  );

  const conversacion = (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Conversación</h3>
      </div>
      <div className="mz-card-body">
        {novedad && (
          <div className="mz-alert mz-alert--info" role="status">
            <Icon name="bell" />
            {novedad}
          </div>
        )}
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
                      : "soporte-hilo__equipo"
                }
              >
                {/* Quién habló, en texto y no solo por el color. */}
                <div className="soporte-hilo__cabeza">
                  {m.interno ? (
                    <span className="mz-pill mz-pill--warn">
                      <Icon name="lock" /> Nota interna
                    </span>
                  ) : m.del_solicitante ? (
                    <span className="mz-pill soporte-pill--info">Usuario</span>
                  ) : (
                    <span className="mz-pill mz-pill--neutral">Equipo</span>
                  )}
                  <strong>{m.autor}</strong>
                  <time className="mz-small mz-faint" dateTime={m.fecha}>
                    {formatearFecha(m.fecha, true)}
                  </time>
                </div>
                <p className="mb-1">{m.texto}</p>
                <ListaDeAdjuntos
                  lista={m.adjuntos}
                  abriendo={adjuntos.abriendo}
                  onDescargar={descargar}
                />
              </li>
            ))}
          </ul>
        )}
        {ticket.estado === "cerrado" ? (
          <div className="mz-alert mz-alert--info mt-3 mb-0">
            <Icon name="lock" />
            {`Ticket cerrado${ticket.cerrado_en ? ` el ${formatearFecha(ticket.cerrado_en, true)}` : ""}: ya no se puede responder.`}
          </div>
        ) : (
          permisos.responder && (
            <Responder
              respuestas={respuestas}
              ticket={ticket}
              ocupado={ocupado}
              resultado={
                origen === "respuesta" && (
                  <Resultado error={error} aviso={aviso} />
                )
              }
              onEnviar={(datosMensaje, archivos) =>
                hacer(
                  () =>
                    soporteService.responder(ticket.id, datosMensaje, archivos),
                  datosMensaje.interno
                    ? "Nota interna guardada."
                    : "Respuesta enviada al usuario.",
                  "respuesta",
                )
              }
            />
          )
        )}
      </div>
    </section>
  );

  const aprobaciones = ticket.aprobaciones?.length > 0 && (
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
  );

  // La encuesta del usuario: lo que importa al revisar un cierre (antes no
  // se mostraba en la ficha del equipo).
  const encuesta = ticket.encuesta && (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Encuesta del usuario</h3>
      </div>
      <dl className="mz-card-body mz-kv-grid">
        <Dato etiqueta="Calificación">{ticket.encuesta.calificacion} de 5</Dato>
        <Dato etiqueta="¿Quedó resuelto?">
          {ticket.encuesta.resuelto ? "Sí" : "No"}
        </Dato>
        {ticket.encuesta.comentario && (
          <Dato etiqueta="Comentario" ancho>
            «{ticket.encuesta.comentario}»
          </Dato>
        )}
      </dl>
    </section>
  );

  const prioridad = permisos.prioridad && (
    <CambiarPrioridad
      ticket={ticket}
      prioridades={etiquetas.prioridades}
      ocupado={ocupado}
      resultado={
        origen === "prioridad" && <Resultado error={error} aviso={aviso} />
      }
      onCambiar={(datosPrioridad) =>
        hacer(
          () => soporteService.cambiarPrioridad(ticket.id, datosPrioridad),
          "Prioridad actualizada; el plazo se recalculó.",
          "prioridad",
        )
      }
    />
  );

  const historial = (
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
  );

  return (
    <div className="soporte-page">
      <div className="mz-view-head">
        <div>
          <h2>{ticket.numero}</h2>
          {/* Lo que se pidió, como subtítulo; el resto, debajo y en gris. */}
          <p className="soporte-ficha__caso mb-0">{ticket.caso}</p>
          <p className="mz-desc">
            {[ticket.tipo_display, ticket.categoria, ticket.codigo]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="mz-view-actions">
          {hayDeDonde ? (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => navegar(-1)}
            >
              <Icon name="arrow-left" /> Volver a la lista
            </button>
          ) : (
            <Link
              className="btn btn-outline-secondary btn-sm"
              to="/admin/soporte/bandeja"
            >
              Volver a la bandeja
            </Link>
          )}
        </div>
      </div>

      {/* Qué pasa y qué toca, de un vistazo (antes, los plazos al fondo de
          «Datos»). */}
      <section className="mz-card soporte-franja-estado" aria-label="Resumen">
        <div className="mz-card-body">
          <div className="soporte-franja-estado__fila">
            <EstadoTicket ticket={ticket} />
            <PrioridadTicket ticket={ticket} />
            <VenceTicket sla={ticket.sla} />
            <span>
              <span className="mz-faint">Atiende: </span>
              <strong>{ticket.tecnico?.nombre || "Sin asignar"}</strong>
            </span>
          </div>
          <p className="mb-0 mt-2">{queToca(ticket, permisos)}</p>
        </div>
      </section>

      {!enSuLugar && <Resultado error={error} aviso={aviso} />}
      {adjuntos.error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {adjuntos.error}
        </div>
      )}
      {adjuntos.visor}
      {pedirHoras && (
        <RegistrarHoras
          onCancelar={() => setPedirHoras(false)}
          onGuardar={async (datosHoras) => {
            setOrigen("pagina");
            setError(null);
            setAviso(null);
            try {
              await soporteService.registrarHoras(ticket.id, datosHoras);
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

      {unaColumna ? (
        <div className="mz-stack">
          {acciones}
          {datos}
          {solicitud}
          {conversacion}
          {aprobaciones}
          {encuesta}
          {prioridad}
          {historial}
        </div>
      ) : (
        <div className="soporte-detalle">
          <div className="mz-stack">
            {solicitud}
            {conversacion}
            {historial}
          </div>
          <div className="mz-stack">
            {acciones}
            {datos}
            {aprobaciones}
            {encuesta}
            {prioridad}
          </div>
        </div>
      )}
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

/** Un dato de la ficha: etiqueta y valor asociados para el lector de
 * pantalla (antes `div` y `span`). `ancho`: a toda la fila. */
function Dato({ etiqueta, children, ancho = false }) {
  return (
    <div className={`mz-kv${ancho ? " mz-kv--full" : ""}`}>
      <dt className="mz-kv-label">{etiqueta}</dt>
      <dd className="mb-0">{children}</dd>
    </div>
  );
}

function tamano(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Los adjuntos: su tamaño y «Abriendo…» mientras llega (antes, el clic no
 * daba señal y se repetía). */
function ListaDeAdjuntos({ lista, abriendo, onDescargar }) {
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
            {a.tamano ? (
              <span className="mz-small mz-faint"> · {tamano(a.tamano)}</span>
            ) : null}
          </li>
        );
      })}
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
function Responder({ respuestas, ticket, ocupado, resultado, onEnviar }) {
  const [texto, setTexto] = useState("");
  const [interno, setInterno] = useState(false);
  const [archivos, setArchivos] = useState([]);
  const [omitidos, setOmitidos] = useState(0);
  const [cerradas, setCerradas] = useState(false);
  const [verTodas, setVerTodas] = useState(false);
  // Cambiar la llave remonta el campo de archivo: tras enviar quedaba con
  // los nombres viejos y el siguiente mensaje parecía llevar adjuntos.
  const [llaveArchivos, setLlaveArchivos] = useState(0);
  const caja = useRef(null);

  const hayRespuestas = respuestas.length > 0;
  const consulta = verTodas
    ? ""
    : texto.startsWith("/")
      ? texto.slice(1).toLowerCase()
      : null;
  const sugerencias =
    consulta === null || cerradas
      ? []
      : respuestas.filter(
          (r) =>
            r.atajo.toLowerCase().startsWith(consulta) ||
            r.titulo.toLowerCase().includes(consulta),
        );
  const sinCoincidencias =
    hayRespuestas && !cerradas && consulta && sugerencias.length === 0;

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
    setVerTodas(false);
    caja.current?.focus();
  }

  /* Escape cierra las sugerencias, desde el campo o desde la lista. */
  function cerrarConEscape(evento) {
    if (evento.key !== "Escape" || sugerencias.length === 0) return;
    evento.preventDefault();
    setCerradas(true);
    setVerTodas(false);
    caja.current?.focus();
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (await onEnviar({ texto, interno }, archivos)) {
      setTexto("");
      setArchivos([]);
      setOmitidos(0);
      setLlaveArchivos((n) => n + 1);
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
          className={`btn ${interno ? "soporte-btn-interno" : "btn-outline-secondary"}`}
          aria-pressed={interno}
          onClick={() => setInterno(true)}
        >
          <Icon name="lock" /> Nota interna
        </button>
      </div>
      {hayRespuestas && (
        <button
          type="button"
          className="btn btn-link btn-sm mb-2 ms-2"
          aria-expanded={verTodas}
          aria-controls="td-sugerencias"
          onClick={() => {
            setVerTodas((v) => !v);
            setCerradas(false);
          }}
        >
          <Icon name="chat-square-text" /> Respuestas predefinidas
        </button>
      )}
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
        placeholder={
          hayRespuestas
            ? "Escriba, o «/» para usar una respuesta predefinida"
            : "Escriba su mensaje"
        }
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
      {sinCoincidencias && (
        <p className="mz-small mz-faint mt-1 mb-0">
          Ninguna respuesta predefinida coincide con «/{consulta}».
        </p>
      )}
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
          key={llaveArchivos}
          type="file"
          className="form-control form-control-sm soporte-publico__archivos"
          multiple
          aria-label="Adjuntar archivos (opcional, hasta 3)"
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
          className={`btn btn-sm ms-auto ${interno ? "soporte-btn-interno" : "btn-primary"}`}
          disabled={ocupado}
        >
          {ocupado
            ? "Enviando…"
            : interno
              ? "Guardar nota interna"
              : "Responder"}
        </button>
      </div>
      {/* El resultado del envío, junto al botón (antes, arriba). */}
      {resultado && <div className="mt-2">{resultado}</div>}
      {archivos.length > 0 && (
        <ul className="soporte-por-adjuntar" aria-label="Archivos por adjuntar">
          {archivos.map((archivo, i) => (
            <li key={`${archivo.name}-${i}`}>
              <Icon name="paperclip" /> {archivo.name}
              <button
                type="button"
                className="btn btn-link btn-sm p-0 ms-1"
                aria-label={`Quitar ${archivo.name}`}
                onClick={() => {
                  setArchivos((lista) => lista.filter((_, j) => j !== i));
                  setLlaveArchivos((n) => n + 1);
                }}
              >
                <Icon name="x-lg" />
              </button>
            </li>
          ))}
        </ul>
      )}
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

/* Lo que se puede hacer con el ticket. Tomarlo y ponerlo en curso van de un
 * clic; lo que tiene consecuencias (esperar al usuario, atendido, cerrar,
 * escalar, asignar) abre su ventana con lo que va a pasar y su propio campo
 * (auditoría UX/UI, 30/10/2026). */
function Acciones({
  ticket,
  tecnicos,
  miNombre,
  ocupado,
  error,
  resultado,
  onTomar,
  onPaso,
  onEscalar,
  onAsignar,
}) {
  const [dialogo, setDialogo] = useState(null);
  const [tecnico, setTecnico] = useState("");
  const permisos = ticket.permisos;
  const elegido = tecnicos.find((t) => String(t.id) === String(tecnico));

  async function pasoDirecto(destino) {
    // Reabrir lo atendido avisa a quien lo pidió: se confirma.
    if (destino === "en_curso" && ticket.estado === "atendido") {
      const si = await confirmar({
        titulo: "¿Reabrir el ticket?",
        mensaje:
          "Vuelve a estar en curso y el plazo de solución sigue con lo que quedaba.",
        accion: "Reabrir",
        peligro: false,
      });
      if (!si) return;
    }
    onPaso(destino, "");
  }

  return (
    <section className="mz-card soporte-acciones">
      <div className="mz-card-head">
        <h3>Acciones</h3>
      </div>
      <div className="mz-card-body">
        {!dialogo && resultado}
        {/* Por qué no se puede tomar (antes, el botón faltaba sin más). */}
        {!permisos.tomar && permisos.motivo_no_tomar && (
          <p className="mz-small mz-faint mb-2">
            <Icon name="info-circle" /> {permisos.motivo_no_tomar}
          </p>
        )}
        {permisos.tomar && (
          <div className="mb-3">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={ocupado}
              onClick={onTomar}
            >
              <Icon name="person-check" />{" "}
              {ocupado ? "Tomando…" : "Tomar este ticket"}
            </button>
            <div className="form-text">
              Pasa a estar a su cargo y empieza a correr el plazo de solución.
            </div>
          </div>
        )}
        {(permisos.acciones.length > 0 || permisos.escalar) && (
          <div className="mz-actions">
            {permisos.acciones.map((destino) => (
              <button
                key={destino}
                type="button"
                className={`btn btn-sm ${
                  destino === "atendido"
                    ? "btn-primary"
                    : destino === "cerrado"
                      ? "btn-outline-danger"
                      : "btn-outline-primary"
                }`}
                disabled={ocupado}
                onClick={() =>
                  dialogoDe(destino, ticket)
                    ? setDialogo(destino)
                    : pasoDirecto(destino)
                }
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
                onClick={() => setDialogo("escalar")}
              >
                Escalar al siguiente nivel
              </button>
            )}
          </div>
        )}
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
                    {t.nombre} · {t.nivel} ·{" "}
                    {t.abiertos === 0
                      ? "sin tickets abiertos"
                      : `${t.abiertos} ${t.abiertos === 1 ? "abierto" : "abiertos"}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                disabled={ocupado || !tecnico}
                onClick={() => setDialogo("asignar")}
              >
                Asignar
              </button>
            </div>
          </div>
        )}
      </div>
      {dialogo && (
        <DialogoDeAccion
          {...(dialogo === "asignar"
            ? {
                titulo: `Asignar a ${elegido?.nombre ?? "este técnico"}`,
                explicacion:
                  ticket.tecnico && ticket.tecnico.nombre !== elegido?.nombre
                    ? `Deja de estar a cargo de ${ticket.tecnico.nombre}. ${elegido?.nombre === miNombre ? "Pasa a estar a su cargo." : `Se le avisa a ${elegido?.nombre ?? "quien lo recibe"}.`}`
                    : `${elegido?.nombre === miNombre ? "Pasa a estar a su cargo." : `Se le avisa a ${elegido?.nombre ?? "quien lo recibe"}.`}${ticket.estado === "nuevo" ? " Empieza a correr el plazo de solución." : ""}`,
                campo:
                  elegido?.nombre === miNombre
                    ? "Nota (opcional)"
                    : "Nota para quien lo recibe (opcional)",
                ayuda: "Queda en el historial del ticket.",
                boton: "Asignar",
              }
            : dialogoDe(dialogo, ticket))}
          ocupado={ocupado}
          error={error}
          onCerrar={() => setDialogo(null)}
          onConfirmar={async (nota) => {
            const hecho =
              dialogo === "escalar"
                ? await onEscalar(nota)
                : dialogo === "asignar"
                  ? await onAsignar(tecnico, nota)
                  : await onPaso(dialogo, nota);
            if (hecho) {
              setDialogo(null);
              if (dialogo === "asignar") setTecnico("");
            }
          }}
        />
      )}
    </section>
  );
}

/** La ventana de una acción: qué va a pasar, su campo y la confirmación. Si
 * el servidor la rechaza, el error sale aquí, junto al botón. */
function DialogoDeAccion({
  titulo,
  explicacion,
  campo,
  ayuda,
  obligatorio,
  boton,
  peligro = false,
  ocupado,
  error,
  onCerrar,
  onConfirmar,
}) {
  const [nota, setNota] = useState("");
  const [errorNota, setErrorNota] = useState(null);
  const [intentado, setIntentado] = useState(false);
  const caja = useRef(null);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });

  async function enviar(evento) {
    evento.preventDefault();
    if (obligatorio && !nota.trim()) {
      setErrorNota(obligatorio);
      caja.current?.focus();
      return;
    }
    setErrorNota(null);
    setIntentado(true);
    await onConfirmar(nota.trim());
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="da-titulo"
        aria-describedby="da-explicacion"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="da-titulo">{titulo}</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <form className="mz-panel-body" onSubmit={enviar} noValidate>
          <p id="da-explicacion">{explicacion}</p>
          {intentado && error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          <Campo
            id="da-nota"
            etiqueta={campo}
            obligatorio={Boolean(obligatorio)}
            ayuda={ayuda}
            error={errorNota}
            className="mb-3"
          >
            <textarea
              ref={caja}
              className="form-control form-control-sm"
              rows={3}
              maxLength={2000}
              value={nota}
              data-autofocus
              onChange={(e) => {
                setNota(e.target.value);
                if (errorNota && e.target.value.trim()) setErrorNota(null);
              }}
            />
          </Campo>
          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`btn btn-sm ${peligro ? "btn-danger" : "btn-primary"}`}
              disabled={ocupado}
            >
              {ocupado ? "Guardando…" : boton}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Impacto × urgencia → prioridad (la misma matriz del servidor). */
const MATRIZ = {
  alto: { alta: "critica", media: "alta", baja: "media" },
  medio: { alta: "alta", media: "media", baja: "baja" },
  bajo: { alta: "media", media: "baja", baja: "baja" },
};

/** Ajustar la prioridad: elegirla, o calcularla por impacto y urgencia.
 * Siempre con justificación, que queda en el historial.
 *
 * Auditoría UX/UI (30/10/2026): dice en qué prioridad quedará antes de
 * guardar, no deja «cambiar» a la misma, valida bajo el campo (no con la
 * burbuja del navegador) y el resultado sale en la tarjeta. */
function CambiarPrioridad({
  ticket,
  prioridades,
  ocupado,
  resultado,
  onCambiar,
}) {
  const [modo, setModo] = useState("matriz");
  const [valores, setValores] = useState({
    prioridad: ticket.prioridad,
    impacto: ticket.impacto || "",
    urgencia: ticket.urgencia || "",
    justificacion: "",
  });
  const [errores, setErrores] = useState({});
  const fijar = (campo) => (e) => {
    setValores((actual) => ({ ...actual, [campo]: e.target.value }));
    if (errores[campo])
      setErrores((actuales) => ({ ...actuales, [campo]: undefined }));
  };
  const nombre = (valor) =>
    prioridades.find(([v]) => v === valor)?.[1] ?? valor;
  const nueva =
    modo === "matriz"
      ? (MATRIZ[valores.impacto]?.[valores.urgencia] ?? null)
      : valores.prioridad;
  const sinCambio =
    modo === "directa"
      ? valores.prioridad === ticket.prioridad
      : !nueva ||
        (valores.impacto === (ticket.impacto || "") &&
          valores.urgencia === (ticket.urgencia || ""));

  async function enviar(evento) {
    evento.preventDefault();
    if (!valores.justificacion.trim()) {
      setErrores({ justificacion: "Diga por qué cambia la prioridad." });
      return;
    }
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
  }

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Ajustar prioridad</h3>
      </div>
      <form className="mz-card-body" onSubmit={enviar} noValidate>
        <fieldset className="mb-2 soporte-cp-modo">
          <legend className="form-label fs-6 mb-1">Cómo se calcula</legend>
          <div className="d-flex flex-wrap gap-3">
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
            <Campo id="cp-impacto" etiqueta="Impacto" className="mb-2">
              <select
                className="form-select form-select-sm"
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
            </Campo>
            <Campo id="cp-urgencia" etiqueta="Urgencia" className="mb-2">
              <select
                className="form-select form-select-sm"
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
            </Campo>
          </>
        ) : (
          <Campo id="cp-prioridad" etiqueta="Prioridad" className="mb-2">
            <select
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
          </Campo>
        )}
        {/* En qué quedará, antes de guardar. */}
        <p className="soporte-cp-resultado mb-2" aria-live="polite">
          {!nueva
            ? "Elija impacto y urgencia para ver la prioridad."
            : nueva === ticket.prioridad
              ? `Quedará en: ${nombre(nueva)} (la misma de ahora).`
              : `Quedará en: ${nombre(nueva)} (antes ${nombre(ticket.prioridad)}).`}
        </p>
        <Campo
          id="cp-justificacion"
          etiqueta="Justificación"
          obligatorio
          ayuda="Queda en el historial. El plazo se recalcula conservando el tiempo ya consumido."
          error={errores.justificacion}
          className="mb-2"
        >
          <textarea
            className="form-control form-control-sm"
            rows={2}
            maxLength={1000}
            value={valores.justificacion}
            onChange={fijar("justificacion")}
          />
        </Campo>
        {resultado}
        <button
          type="submit"
          className="btn btn-sm btn-outline-primary"
          disabled={ocupado || sinCambio}
          aria-describedby={sinCambio ? "cp-sin-cambio" : undefined}
        >
          {ocupado ? "Guardando…" : "Cambiar prioridad"}
        </button>
        {sinCambio && (
          <span id="cp-sin-cambio" className="mz-small mz-faint ms-2">
            Cambie algo para poder guardarlo.
          </span>
        )}
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
