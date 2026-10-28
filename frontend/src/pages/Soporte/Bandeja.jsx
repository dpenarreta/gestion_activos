import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { Paginacion } from "../../components/common/Paginacion/Paginacion";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { useAuth } from "../../hooks/useAuth";
import { useListadoPaginado } from "../../hooks/useListadoPaginado";
import { useVistaDeTarjetas } from "../../hooks/useMediaQuery";
import { PERMISOS_SOPORTE } from "../../modulos/permisosSoporte";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import {
  EstadoTicket,
  CriticidadTicket,
  PrioridadTicket,
  SlaTicket,
  useEtiquetas,
} from "./comunes";
import "./Soporte.css";

/** Cada cuánto se refresca la bandeja: los tickets llegan solos. */
const REFRESCO_MS = 30_000;
const SIN_COLA = "No hay tickets en la cola que usted pueda atender.";

/**
 * Bandeja de la mesa de ayuda.
 *
 * Toda persona ve aquí «Mis solicitudes»: lo que ella creó, en cualquier
 * estado, con su posición en la cola (21/10/2026); cada quien solo lo suyo.
 * Quien es del equipo ve además, arriba, su estado (en horario, cuántos tiene
 * y cuántos esperan en la cola para él) y «Tomar siguiente», y abajo sus
 * tickets, la cola o —para quien coordina— todos los de la empresa.
 */
export function Bandeja({ todos = false }) {
  const navegar = useNavigate();
  const etiquetas = useEtiquetas();
  const { user } = useAuth();
  const delEquipo = PERMISOS_SOPORTE.some((p) =>
    user?.permissions?.includes(p),
  );
  const [cabecera, setCabecera] = useState(null);
  const [ambito, setAmbito] = useState(
    todos ? "todos" : delEquipo ? "mios" : "creados",
  );
  const [busqueda, setBusqueda] = useState("");
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [tomando, setTomando] = useState(false);
  const enTarjetas = useVistaDeTarjetas();

  const cargar = useCallback(
    (params) =>
      // «Mis solicitudes» tiene su propio listado (ver `MisSolicitudes`).
      ambito === "creados"
        ? Promise.resolve({ results: [], count: 0 })
        : soporteService.tickets({ ...params, ambito }),
    [ambito],
  );
  const listado = useListadoPaginado(
    cargar,
    { q: "", estado: "" },
    "No se pudieron cargar los tickets.",
  );
  const { refresh } = listado;

  const cargarCabecera = useCallback(() => {
    // Quien no es del equipo no tiene estado de técnico que mostrar: pedirlo
    // solo dejaría un acceso denegado en la auditoría cada medio minuto.
    if (!delEquipo) return;
    soporteService
      .bandeja()
      .then(setCabecera)
      .catch(() => setCabecera(null));
  }, [delEquipo]);

  useEffect(() => {
    cargarCabecera();
    const intervalo = setInterval(() => {
      cargarCabecera();
      refresh?.();
    }, REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [cargarCabecera, refresh]);

  /* Auditoría UX/UI, fase 2 (28/10/2026): cualquier fallo salía como «No hay
   * tickets en la cola»; un error de red o de permisos parecía una cola vacía.
   * La cola vacía (404 del servidor) es un aviso; lo demás, un error. */
  async function tomarSiguiente() {
    setError(null);
    setAviso(null);
    setTomando(true);
    try {
      const ticket = await soporteService.tomarSiguiente();
      if (!ticket?.id) {
        setAviso(SIN_COLA);
        return;
      }
      navegar(`/admin/soporte/tickets/${ticket.id}`);
    } catch (err) {
      if (err?.response?.status === 404) {
        setAviso(mensajeDeError(err, SIN_COLA));
      } else {
        setError(mensajeDeError(err, "No se pudo tomar el siguiente ticket."));
      }
    } finally {
      setTomando(false);
    }
  }

  const tecnico = cabecera?.tecnico;
  const ambitos = [
    ...(tecnico
      ? [
          ["mios", "Mis tickets"],
          ["cola", "Cola"],
        ]
      : []),
    ...(cabecera?.puede.ver_todos ? [["todos", "Todos"]] : []),
    ["creados", "Mis solicitudes"],
  ];

  return (
    <div className="soporte-page">
      <div className="mz-view-head">
        <div>
          <h2>{todos ? "Todos los tickets" : "Bandeja de soporte"}</h2>
          <p className="mz-desc">
            {cabecera
              ? `${cabecera.cola_total} ticket(s) esperan en la cola de la empresa.`
              : "Sus solicitudes a la Mesa de ayuda de TI y en qué van."}
          </p>
        </div>
        {(tecnico || cabecera?.puede.registrar) && (
          <div className="mz-view-actions">
            {/* Lo que llega por teléfono, WhatsApp o en persona también se
                registra: «sin ticket no hay atención». */}
            {cabecera?.puede.registrar && (
              <Link
                className="btn btn-outline-primary btn-sm"
                to="/admin/soporte/registrar"
              >
                <Icon name="telephone-plus" /> Registrar ticket
              </Link>
            )}
            {tecnico && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={tomarSiguiente}
                disabled={tomando}
              >
                <Icon name="inbox-fill" />{" "}
                {tomando ? "Tomando…" : "Tomar siguiente"}
              </button>
            )}
          </div>
        )}
      </div>

      {tecnico && (
        <section className="mz-card mb-3">
          <div className="mz-card-body soporte-estado-tecnico">
            <span
              className={`mz-pill ${tecnico.en_horario ? "mz-pill--ok" : "mz-pill--neutral"}`}
            >
              {tecnico.en_horario
                ? "En horario de atención"
                : "Fuera de su horario"}
            </span>
            <span>
              <strong>{tecnico.abiertos}</strong> de {tecnico.capacidad} en
              atención
            </span>
            <span>
              <strong>{tecnico.cola_para_mi}</strong> en la cola para usted
            </span>
            <span className="mz-small mz-faint">
              {tecnico.nivel} ·{" "}
              {tecnico.categorias.join(", ") || "sin categorías asignadas"}
            </span>
          </div>
        </section>
      )}
      {cabecera && !tecnico && !cabecera.puede.ver_todos && (
        <div className="mz-alert mz-alert--info">
          <Icon name="info-circle" />
          Usted no es parte del equipo de soporte de esta empresa. Quien
          configura la mesa de ayuda lo da de alta en Configuración → Mesa de
          ayuda → Técnicos.
        </div>
      )}

      {aviso && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          {aviso}
        </div>
      )}
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {/* Pestañas de verdad (auditoría UX/UI, fase 2, 28/10/2026): antes era
          un <nav> con aria-current en botones que no navegan. */}
      {ambitos.length > 1 && !todos && (
        <Pestanas
          className="mz-config-tabs"
          etiqueta="Qué tickets ver"
          idBase="sb-ambito"
          valor={ambito}
          onCambio={setAmbito}
          opciones={ambitos.map(([id, etiqueta]) => ({ id, etiqueta }))}
        />
      )}

      <PanelDePestana
        idBase="sb-ambito"
        valor={ambito}
        // Sin pestañas a la vista, el panel no se presenta como tal.
        sinPestanas={!(ambitos.length > 1 && !todos)}
      >
        {ambito === "creados" ? (
          <MisSolicitudes />
        ) : (
          <>
            <form
              className="mz-filter-bar"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                listado.actualizarFiltros({ q: busqueda });
              }}
            >
              <label className="mz-fb-search" htmlFor="sb-buscar">
                <Icon name="search" />
                <span className="visually-hidden">Buscar</span>
                <input
                  id="sb-buscar"
                  type="search"
                  placeholder="N.º de ticket, solicitante o descripción"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
              </label>
              {ambito !== "cola" && (
                <div className="mz-inline-field">
                  <label htmlFor="sb-estado">Estado</label>
                  <select
                    id="sb-estado"
                    className="form-select form-select-sm"
                    value={listado.filtros.estado}
                    onChange={(e) =>
                      listado.actualizarFiltros({ estado: e.target.value })
                    }
                  >
                    <option value="">Abiertos</option>
                    {etiquetas.estados.map(([valor, etiqueta]) => (
                      <option key={valor} value={valor}>
                        {etiqueta}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="submit"
                className="btn btn-outline-secondary btn-sm"
              >
                Buscar
              </button>
            </form>

            {/* En el teléfono, cada ticket en una tarjeta como en la Matriz:
                ocho columnas a 375 px solo se leían desplazándose de lado
                (auditoría UX/UI, fase 3, 28/10/2026). */}
            <div className="mz-table-wrap mz-table-wrap--con-tarjetas">
              <table className="mz-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Solicitante</th>
                    <th>Caso</th>
                    <th>Criticidad</th>
                    <th>Prioridad</th>
                    <th>Estado</th>
                    <th>{ambito === "cola" ? "Posición" : "Atiende"}</th>
                    <th>SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {listado.resultados.map((t) => (
                    <tr key={t.id}>
                      <td className="mz-mono">
                        <Link to={`/admin/soporte/tickets/${t.id}`}>
                          {t.numero}
                        </Link>
                        <div className="mz-small mz-faint">
                          {formatearFecha(t.created_at, true)}
                        </div>
                      </td>
                      <td>
                        {t.solicitante_nombre}
                        <div className="mz-small mz-faint">
                          {[t.agencia, t.area].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td>
                        {t.caso}
                        <div className="mz-small mz-faint">
                          {t.categoria} · {t.nivel}
                        </div>
                      </td>
                      <td>
                        <CriticidadTicket ticket={t} />
                      </td>
                      <td>
                        <PrioridadTicket ticket={t} />
                      </td>
                      <td>
                        <EstadoTicket ticket={t} />
                        {t.escalado_por_sla && (
                          <div className="mz-small text-danger">
                            Escalado por SLA
                          </div>
                        )}
                      </td>
                      <td>
                        {ambito === "cola"
                          ? t.posicion
                          : t.tecnico?.nombre || "—"}
                      </td>
                      <td>
                        <SlaTicket sla={t.sla} />
                      </td>
                    </tr>
                  ))}
                  {/* Auditoría UX/UI, fase 2 (28/10/2026): cargando, error y
                    vacío dentro de la tabla, en sus 8 columnas (antes
                    colSpan={7}). */}
                  <FilaDeEstado
                    columnas={8}
                    cargando={
                      listado.isLoading && listado.resultados.length === 0
                    }
                    error={listado.error}
                    onReintentar={listado.refresh}
                    vacio={listado.resultados.length === 0}
                    hayFiltros={Boolean(
                      listado.filtros.q || listado.filtros.estado,
                    )}
                    onLimpiarFiltros={() => {
                      setBusqueda("");
                      listado.actualizarFiltros({ q: "", estado: "" });
                    }}
                    textoVacio={
                      ambito === "mios"
                        ? "No tiene tickets en atención."
                        : "No hay tickets."
                    }
                  />
                </tbody>
              </table>
            </div>
            {enTarjetas && (
              <div className="mz-cards">
                <EstadoDeCarga
                  cargando={
                    listado.isLoading && listado.resultados.length === 0
                  }
                  error={listado.error}
                  onReintentar={listado.refresh}
                  vacio={listado.resultados.length === 0}
                  hayFiltros={Boolean(
                    listado.filtros.q || listado.filtros.estado,
                  )}
                  onLimpiarFiltros={() => {
                    setBusqueda("");
                    listado.actualizarFiltros({ q: "", estado: "" });
                  }}
                  textoVacio={
                    ambito === "mios"
                      ? "No tiene tickets en atención."
                      : "No hay tickets."
                  }
                />
                {listado.resultados.length > 0 && (
                  <ul className="mz-cards-lista" aria-label="Tickets">
                    {listado.resultados.map((t) => (
                      <li key={t.id} className="mz-card-row">
                        <div className="mz-row-between">
                          <span className="mz-mono mz-strong">{t.numero}</span>
                          <EstadoTicket ticket={t} />
                        </div>
                        <div className="mz-card-row__titulo">{t.caso}</div>
                        {t.escalado_por_sla && (
                          <div className="mz-small text-danger">
                            Escalado por SLA
                          </div>
                        )}
                        <div className="mz-card-meta">
                          <span>{t.solicitante_nombre}</span>
                          <CriticidadTicket ticket={t} />
                          <PrioridadTicket ticket={t} />
                          <span>
                            {ambito === "cola"
                              ? `Posición ${t.posicion}`
                              : `Atiende: ${t.tecnico?.nombre || "—"}`}
                          </span>
                          <SlaTicket sla={t.sla} />
                        </div>
                        <div className="mz-card-acciones">
                          <Link
                            className="btn btn-outline-primary btn-sm"
                            to={`/admin/soporte/tickets/${t.id}`}
                          >
                            Abrir ticket {t.numero}
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <Paginacion
              total={listado.total}
              pagina={listado.pagina}
              hasNext={listado.hasNext}
              hasPrevious={listado.hasPrevious}
              onCambiarPagina={listado.setPagina}
              etiqueta="tickets"
            />
          </>
        )}
      </PanelDePestana>
    </div>
  );
}

/**
 * «Mis solicitudes»: los tickets que la persona creó, en cualquier estado, con
 * su posición en la cola. Solo los suyos (el servidor no devuelve otros) y
 * abren su ficha de seguimiento, la de quien pide —sin notas internas—.
 */
function MisSolicitudes() {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState(null);
  const enTarjetas = useVistaDeTarjetas();

  const cargar = useCallback(() => {
    // El error se borra al cargar bien: se consulta cada 30 s y, si se
    // borrara antes, el aviso se anunciaría de nuevo en cada vuelta.
    soporteService
      .misTickets()
      .then((datos) => {
        setTickets(datos);
        setError(null);
      })
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar sus solicitudes.")),
      );
  }, []);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [cargar]);

  return (
    <>
      <div className="mz-table-wrap mz-table-wrap--con-tarjetas">
        <table className="mz-table" aria-label="Mis solicitudes">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Caso</th>
              <th>Criticidad</th>
              <th>Estado</th>
              <th>Posición en la cola</th>
              <th>Atendido</th>
            </tr>
          </thead>
          <tbody>
            {(tickets ?? []).map((t) => (
              <tr key={t.id}>
                <td className="mz-mono">
                  <Link to={`/admin/ayuda/tickets/${t.id}`}>{t.numero}</Link>
                  <div className="mz-small mz-faint">
                    {formatearFecha(t.creado, true)}
                  </div>
                </td>
                <td>
                  {t.caso}
                  <div className="mz-small mz-faint">{t.categoria}</div>
                </td>
                <td>
                  <CriticidadTicket ticket={t} />
                </td>
                <td>
                  <EstadoTicket ticket={t} />
                </td>
                <td>{t.posicion ?? "—"}</td>
                <td>
                  {t.atendido_en ? formatearFecha(t.atendido_en, true) : "—"}
                </td>
              </tr>
            ))}
            {/* Mientras carga ya no se ve una tabla vacía, y un fallo no se
                confunde con «no ha creado solicitudes» (auditoría UX/UI,
                fase 2, 28/10/2026). */}
            <FilaDeEstado
              columnas={6}
              cargando={tickets === null}
              error={error}
              onReintentar={cargar}
              vacio={tickets?.length === 0}
              textoVacio="Todavía no ha creado solicitudes."
              accionVacio={
                <Link to="/admin/ayuda">Pedir ayuda en Soporte TI</Link>
              }
            />
          </tbody>
        </table>
      </div>
      {/* En el teléfono, en tarjetas (auditoría UX/UI, fase 3, 28/10/2026). */}
      {enTarjetas && (
        <div className="mz-cards">
          <EstadoDeCarga
            cargando={tickets === null}
            error={error}
            onReintentar={cargar}
            vacio={tickets?.length === 0}
            textoVacio="Todavía no ha creado solicitudes."
            accionVacio={
              <Link to="/admin/ayuda">Pedir ayuda en Soporte TI</Link>
            }
          />
          {tickets?.length > 0 && (
            <ul className="mz-cards-lista" aria-label="Mis solicitudes">
              {tickets.map((t) => (
                <li key={t.id} className="mz-card-row">
                  <div className="mz-row-between">
                    <span className="mz-mono mz-strong">{t.numero}</span>
                    <EstadoTicket ticket={t} />
                  </div>
                  <div className="mz-card-row__titulo">{t.caso}</div>
                  <div className="mz-card-meta">
                    <span>{formatearFecha(t.creado, true)}</span>
                    <CriticidadTicket ticket={t} />
                    {t.posicion != null && (
                      <span>Posición en la cola: {t.posicion}</span>
                    )}
                    {t.atendido_en && (
                      <span>
                        Atendido: {formatearFecha(t.atendido_en, true)}
                      </span>
                    )}
                  </div>
                  <div className="mz-card-acciones">
                    <Link
                      className="btn btn-outline-primary btn-sm"
                      to={`/admin/ayuda/tickets/${t.id}`}
                    >
                      Ver solicitud {t.numero}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
