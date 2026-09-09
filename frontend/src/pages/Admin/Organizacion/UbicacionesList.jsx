import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { ubicacionesService } from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Ubicaciones" },
];
const FILTROS_INICIALES = { q: "", activa: "" };

/**
 * Catálogo de lugares físicos (§4.1 del documento funcional).
 *
 * La ubicación se separa del departamento a propósito: el área dice de quién
 * es el presupuesto del equipo, la ubicación dice dónde ir a buscarlo. Un
 * equipo de Contabilidad puede estar en la bodega de TI esperando
 * reasignación.
 */
export function UbicacionesList() {
  const puedeEditar = usePermission("organizacion.editar");
  const [busqueda, setBusqueda] = useState("");
  const cargar = useCallback((params) => ubicacionesService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el listado de ubicaciones.",
  );

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  return (
    <div className="organizacion-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Ubicaciones</h2>
        {puedeEditar && (
          <Link
            to="/admin/organizacion/ubicaciones/new"
            className="btn btn-primary btn-sm"
          >
            Nueva ubicación
          </Link>
        )}
      </div>

      <form className="d-flex gap-2 mb-3 flex-wrap" onSubmit={handleBuscar}>
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Buscar por sede o nombre"
          aria-label="Buscar ubicaciones"
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
          <option value="true">Activas</option>
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
              <th>Sede</th>
              <th>Nombre</th>
              <th>Detalle</th>
              <th className="text-end">Activos</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((ubicacion) => (
              <tr key={ubicacion.id}>
                <td>{ubicacion.sede}</td>
                <td>{ubicacion.nombre}</td>
                <td className="text-muted">{ubicacion.detalle || "—"}</td>
                <td className="text-end">{ubicacion.total_activos}</td>
                <td>
                  <span
                    className={`badge ${ubicacion.activa ? "text-bg-success" : "text-bg-secondary"}`}
                  >
                    {ubicacion.activa ? "Activa" : "Cerrada"}
                  </span>
                </td>
                <td>
                  <Link
                    to={`/admin/organizacion/ubicaciones/${ubicacion.id}`}
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
                  Sin ubicaciones registradas
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
        etiqueta="ubicaciones"
      />
    </div>
  );
}
