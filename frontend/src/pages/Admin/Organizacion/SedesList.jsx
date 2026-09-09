import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { sedesService } from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Sedes" }];
const FILTROS_INICIALES = { q: "", activa: "" };

/**
 * Catálogo de edificios, locales o ciudades: dónde está cada equipo.
 *
 * Es un catálogo y no un texto dentro de cada activo porque «Sede Quito
 * Norte», «sede quito norte» y «Quito Norte» son el mismo edificio para una
 * persona y tres para una consulta: con texto libre, filtrar el inventario por
 * sede devuelve un tercio de los equipos que están ahí y nadie nota lo que
 * falta. Renombrar una sede —una mudanza, un cambio de razón social— es aquí
 * una edición, no una búsqueda y reemplazo por todo el parque.
 */
export function SedesList() {
  const puedeEditar = usePermission("organizacion.editar");
  const [busqueda, setBusqueda] = useState("");
  const cargar = useCallback((params) => sedesService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el listado de sedes.",
  );

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  return (
    <div className="organizacion-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Sedes</h2>
        {puedeEditar && (
          <Link
            to="/admin/organizacion/sedes/new"
            className="btn btn-primary btn-sm"
          >
            Nueva sede
          </Link>
        )}
      </div>

      <form className="d-flex gap-2 mb-3 flex-wrap" onSubmit={handleBuscar}>
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Buscar por nombre o ciudad"
          aria-label="Buscar sedes"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
        />
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por estado"
          value={listado.filtros.activa}
          onChange={(event) =>
            listado.actualizarFiltros({ activa: event.target.value })
          }
        >
          <option value="">Todas</option>
          <option value="true">Abiertas</option>
          <option value="false">Cerradas</option>
        </select>
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
              <th>Nombre</th>
              <th>Ciudad</th>
              <th>Dirección</th>
              <th className="text-end">Activos</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((sede) => (
              <tr key={sede.id}>
                <td>{sede.nombre}</td>
                <td>{sede.ciudad || "—"}</td>
                <td className="text-muted">{sede.direccion || "—"}</td>
                <td className="text-end">{sede.total_activos}</td>
                <td>
                  <span
                    className={`badge ${sede.activa ? "text-bg-success" : "text-bg-secondary"}`}
                  >
                    {sede.activa ? "Abierta" : "Cerrada"}
                  </span>
                </td>
                <td>
                  <Link
                    to={`/admin/organizacion/sedes/${sede.id}`}
                    className="btn btn-outline-secondary btn-sm"
                  >
                    {puedeEditar ? "Editar" : "Ver"}
                  </Link>
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted">
                  Sin sedes registradas
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
        etiqueta="sedes"
      />
    </div>
  );
}
