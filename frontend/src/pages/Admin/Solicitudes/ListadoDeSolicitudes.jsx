import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { solicitudesService } from "../../../api/solicitudesService";
import { Icon } from "../../../components/common/Icon/Icon";
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

/**
 * Los colores dicen en qué punto está, no si es buena o mala noticia: la
 * pendiente resalta porque espera a alguien, la que está en camino se lee
 * como información y la cancelada se apaga porque ya no hay nada que hacer
 * con ella.
 */
const TONO_DEL_ESTADO = {
  pendiente: "mz-pill--warn",
  en_gestion: "mz-pill--info",
  comprada: "mz-pill--info",
  entregada: "mz-pill--ok",
  rechazada: "mz-pill--bad",
  cancelada: "mz-pill--neutral",
};

export function EstadoDeSolicitud({ solicitud }) {
  const tono = TONO_DEL_ESTADO[solicitud.estado] ?? "mz-pill--neutral";
  return (
    <span className={`mz-pill estado estado--${solicitud.estado} ${tono}`}>
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

  return (
    <div className="solicitudes-page">
      <div className="mz-view-head">
        <div>
          <h2>{titulo}</h2>
          <p className="mz-desc">{descripcion}</p>
        </div>
        {acciones && <div className="mz-view-actions">{acciones}</div>}
      </div>

      <form
        className="mz-filter-bar"
        role="search"
        onSubmit={(evento) => {
          evento.preventDefault();
          listado.actualizarFiltros({ q: busqueda });
        }}
      >
        <label className="mz-fb-search" htmlFor="sol-buscar">
          <Icon name="search" />
          <span className="visually-hidden">Buscar</span>
          <input
            id="sol-buscar"
            type="search"
            placeholder="Qué se pidió, o quién"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
          />
        </label>
        <div className="mz-inline-field">
          <label htmlFor="sol-estado">Estado</label>
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
        <div className="mz-inline-field">
          <label htmlFor="sol-abiertas">Mostrar</label>
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
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {listado.error}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Qué se pide</th>
              <th className="num">Cantidad</th>
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
                <td className="mz-mono">#{solicitud.id}</td>
                <td>
                  <span className="mz-strong">{solicitud.lo_que_se_pide}</span>
                  <div className="mz-small mz-faint">
                    Pedida el {formatearFecha(solicitud.created_at)}
                  </div>
                </td>
                <td className="num">{solicitud.cantidad}</td>
                <td>
                  {esRecibidas
                    ? solicitud.solicitante_nombre
                    : solicitud.encargado_nombre}
                </td>
                <td className={`mz-prio--${solicitud.prioridad}`}>
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
                <td className="acciones">
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
              <tr className="mz-empty-row">
                <td colSpan={8}>
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
