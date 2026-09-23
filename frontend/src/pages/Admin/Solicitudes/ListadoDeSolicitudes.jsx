import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { solicitudesService } from "../../../api/solicitudesService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { formatearFecha } from "../../../utils/formato";
import "./Solicitudes.css";

export const ESTADOS = [
  ["pendiente", "Pendiente"],
  ["en_gestion", "En gestión"],
  ["comprada", "Comprada"],
  ["entregada", "Entregada"],
  ["rechazada", "Rechazada"],
  ["cancelada", "Cancelada"],
];

export function EstadoDeSolicitud({ solicitud }) {
  return (
    <span className={`badge estado estado--${solicitud.estado}`}>
      {solicitud.estado_display}
    </span>
  );
}

/**
 * Las dos bandejas, que son la misma lista mirada desde los dos lados.
 *
 * «Mis solicitudes» es lo que pedí y «Solicitudes recibidas» lo que me toca
 * gestionar. Cambia el ámbito, la columna que importa —a quién se lo pedí, o
 * quién me lo pidió— y poco más: separarlas en dos componentes haría que un
 * filtro nuevo entrara en una y no en la otra.
 */
export function ListadoDeSolicitudes({
  ambito,
  titulo,
  descripcion,
  acciones = null,
}) {
  const [busqueda, setBusqueda] = useState("");
  const cargar = useCallback(
    (params) => solicitudesService.list({ ...params, ambito }),
    [ambito],
  );
  const listado = useListadoPaginado(
    cargar,
    // Abiertas primero: una bandeja que arrastra lo entregado hace seis meses
    // deja de leerse, y lo cerrado se consulta cuando se busca algo concreto.
    { q: "", estado: "", abiertas: "true" },
    "No se pudieron cargar las solicitudes.",
  );

  const esRecibidas = ambito === "recibidas";
  const breadcrumbs = [
    { label: "Administración" },
    { label: "Solicitudes" },
    { label: titulo },
  ];

  return (
    <div className="solicitudes-page">
      <Breadcrumbs items={breadcrumbs} />
      <div className="d-flex justify-content-between align-items-start mb-3 gap-3 flex-wrap">
        <div>
          <h2 className="mb-1">{titulo}</h2>
          <p className="text-muted mb-0">{descripcion}</p>
        </div>
        {acciones}
      </div>

      <form
        className="d-flex gap-2 mb-3 flex-wrap align-items-end"
        onSubmit={(evento) => {
          evento.preventDefault();
          listado.actualizarFiltros({ q: busqueda });
        }}
      >
        <div>
          <label className="form-label small mb-1" htmlFor="sol-buscar">
            Buscar
          </label>
          <input
            id="sol-buscar"
            type="search"
            className="form-control form-control-sm"
            placeholder="Qué se pidió, o quién"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
          />
        </div>
        <div>
          <label className="form-label small mb-1" htmlFor="sol-estado">
            Estado
          </label>
          <select
            id="sol-estado"
            className="form-select form-select-sm"
            value={listado.filtros.estado}
            onChange={(evento) =>
              listado.actualizarFiltros({ estado: evento.target.value })
            }
          >
            <option value="">Todos</option>
            {ESTADOS.map(([clave, etiqueta]) => (
              <option key={clave} value={clave}>
                {etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label small mb-1" htmlFor="sol-abiertas">
            Mostrar
          </label>
          <select
            id="sol-abiertas"
            className="form-select form-select-sm"
            value={listado.filtros.abiertas}
            onChange={(evento) =>
              listado.actualizarFiltros({ abiertas: evento.target.value })
            }
          >
            <option value="true">Solo las abiertas</option>
            <option value="">Todas</option>
            <option value="false">Solo las cerradas</option>
          </select>
        </div>
        <button type="submit" className="btn btn-outline-secondary btn-sm">
          Buscar
        </button>
      </form>

      {listado.error && (
        <div className="alert alert-danger">{listado.error}</div>
      )}

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>#</th>
              <th>Qué se pide</th>
              <th className="text-end">Cantidad</th>
              <th>{esRecibidas ? "Quién la pidió" : "Quién la gestiona"}</th>
              <th>Prioridad</th>
              <th>Se necesita</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((solicitud) => (
              <tr key={solicitud.id}>
                <td>#{solicitud.id}</td>
                <td>
                  {solicitud.lo_que_se_pide}
                  <small className="d-block text-muted">
                    Pedida el {formatearFecha(solicitud.created_at)}
                  </small>
                </td>
                <td className="text-end">{solicitud.cantidad}</td>
                <td>
                  {esRecibidas
                    ? solicitud.solicitante_nombre
                    : solicitud.encargado_nombre}
                </td>
                <td className={`prioridad--${solicitud.prioridad}`}>
                  {solicitud.prioridad_display}
                </td>
                <td>
                  {solicitud.fecha_necesaria
                    ? formatearFecha(solicitud.fecha_necesaria)
                    : "—"}
                </td>
                <td>
                  <EstadoDeSolicitud solicitud={solicitud} />
                </td>
                <td>
                  <Link
                    className="btn btn-outline-primary btn-sm"
                    to={`/admin/solicitudes/${solicitud.id}`}
                  >
                    Ver
                  </Link>
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-muted">
                  {esRecibidas
                    ? "No tiene solicitudes por gestionar"
                    : "Todavía no ha realizado ninguna solicitud"}
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
        etiqueta="solicitudes"
      />
    </div>
  );
}
