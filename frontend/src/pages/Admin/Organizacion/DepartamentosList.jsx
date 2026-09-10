import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { departamentosService } from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Departamentos" },
];
const FILTROS_INICIALES = { q: "", activo: "" };

export function DepartamentosList() {
  const puedeEditar = usePermission("organizacion.editar");
  const [busqueda, setBusqueda] = useState("");
  const cargar = useCallback((params) => departamentosService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el listado de departamentos.",
  );

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  return (
    <div className="organizacion-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Departamentos</h2>
        {puedeEditar && (
          <Link
            to="/admin/organizacion/departamentos/new"
            className="btn btn-primary btn-sm"
          >
            Nuevo departamento
          </Link>
        )}
      </div>

      <form className="d-flex gap-2 mb-3 flex-wrap" onSubmit={handleBuscar}>
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Buscar por nombre o código"
          aria-label="Buscar departamentos"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
        />
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por estado"
          value={listado.filtros.activo}
          onChange={(event) =>
            listado.actualizarFiltros({ activo: event.target.value })
          }
        >
          <option value="">Todos</option>
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
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
              <th>Código</th>
              <th>Nombre</th>
              <th>Responsable</th>
              <th className="text-end">Empleados</th>
              <th className="text-end">Activos</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((departamento) => (
              <tr key={departamento.id}>
                <td>
                  <code>{departamento.codigo}</code>
                </td>
                <td>{departamento.nombre}</td>
                <td>{departamento.responsable_nombre || "—"}</td>
                <td className="text-end">{departamento.total_empleados}</td>
                <td className="text-end">{departamento.total_activos}</td>
                <td>
                  <span
                    className={`badge ${departamento.activo ? "text-bg-success" : "text-bg-secondary"}`}
                  >
                    {departamento.activo ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td>
                  <Link
                    to={`/admin/organizacion/departamentos/${departamento.id}`}
                    className="btn btn-outline-primary btn-sm"
                  >
                    {puedeEditar ? "Editar" : "Ver"}
                  </Link>
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted">
                  Sin departamentos registrados
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
        etiqueta="departamentos"
      />
    </div>
  );
}
