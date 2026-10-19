import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { Paginacion } from "../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../hooks/useListadoPaginado";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import {
  EstadoTicket,
  PrioridadTicket,
  SlaTicket,
  useEtiquetas,
} from "./comunes";
import "./Soporte.css";

/** Cada cuánto se refresca la bandeja: los tickets llegan solos. */
const REFRESCO_MS = 30_000;

/**
 * Bandeja de la mesa de ayuda.
 *
 * Arriba, el estado de quien atiende (en horario, cuántos tiene y cuántos
 * esperan en la cola para él) y «Tomar siguiente». Abajo, sus tickets, la cola
 * o —para quien coordina— todos los de la empresa.
 */
export function Bandeja({ todos = false }) {
  const navegar = useNavigate();
  const etiquetas = useEtiquetas();
  const [cabecera, setCabecera] = useState(null);
  const [ambito, setAmbito] = useState(todos ? "todos" : "mios");
  const [busqueda, setBusqueda] = useState("");
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(
    (params) => soporteService.tickets({ ...params, ambito }),
    [ambito],
  );
  const listado = useListadoPaginado(
    cargar,
    { q: "", estado: "" },
    "No se pudieron cargar los tickets.",
  );
  const { refresh } = listado;

  const cargarCabecera = useCallback(() => {
    soporteService
      .bandeja()
      .then(setCabecera)
      .catch(() => setCabecera(null));
  }, []);

  useEffect(() => {
    cargarCabecera();
    const intervalo = setInterval(() => {
      cargarCabecera();
      refresh?.();
    }, REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [cargarCabecera, refresh]);

  async function tomarSiguiente() {
    setError(null);
    setAviso(null);
    try {
      const ticket = await soporteService.tomarSiguiente();
      navegar(`/admin/soporte/tickets/${ticket.id}`);
    } catch (err) {
      setAviso(
        mensajeDeError(
          err,
          "No hay tickets en la cola que usted pueda atender.",
        ),
      );
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
  ];

  return (
    <div className="soporte-page">
      <div className="mz-view-head">
        <div>
          <h2>{todos ? "Todos los tickets" : "Bandeja de soporte"}</h2>
          <p className="mz-desc">
            {cabecera
              ? `${cabecera.cola_total} ticket(s) esperan en la cola de la empresa.`
              : "Mesa de ayuda de TI."}
          </p>
        </div>
        {(tecnico || cabecera?.puede.asignar) && (
          <div className="mz-view-actions">
            {/* Lo que llega por teléfono, WhatsApp o en persona también se
                registra: «sin ticket no hay atención». */}
            <Link
              className="btn btn-outline-primary btn-sm"
              to="/admin/soporte/registrar"
            >
              <Icon name="telephone-plus" /> Registrar ticket
            </Link>
            {tecnico && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={tomarSiguiente}
              >
                <Icon name="inbox-fill" /> Tomar siguiente
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
      {(error || listado.error) && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error || listado.error}
        </div>
      )}

      {ambitos.length > 1 && !todos && (
        <nav className="mz-tabs mz-config-tabs" aria-label="Qué tickets ver">
          {ambitos.map(([clave, etiqueta]) => (
            <button
              key={clave}
              type="button"
              className={ambito === clave ? "is-active" : undefined}
              aria-current={ambito === clave ? "page" : undefined}
              onClick={() => setAmbito(clave)}
            >
              {etiqueta}
            </button>
          ))}
        </nav>
      )}

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
        <button type="submit" className="btn btn-outline-secondary btn-sm">
          Buscar
        </button>
      </form>

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Solicitante</th>
              <th>Caso</th>
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
                  <Link to={`/admin/soporte/tickets/${t.id}`}>{t.numero}</Link>
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
                  <PrioridadTicket ticket={t} />
                </td>
                <td>
                  <EstadoTicket ticket={t} />
                  {t.escalado_por_sla && (
                    <div className="mz-small text-danger">Escalado por SLA</div>
                  )}
                </td>
                <td>
                  {ambito === "cola" ? t.posicion : t.tecnico?.nombre || "—"}
                </td>
                <td>
                  <SlaTicket sla={t.sla} />
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={7}>
                  {ambito === "mios"
                    ? "No tiene tickets en atención"
                    : "No hay tickets"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Paginacion
        total={listado.total}
        pagina={listado.pagina}
        hasNext={listado.hasNext}
        hasPrevious={listado.hasPrevious}
        onCambiarPagina={listado.setPagina}
        etiqueta="tickets"
      />
    </div>
  );
}
