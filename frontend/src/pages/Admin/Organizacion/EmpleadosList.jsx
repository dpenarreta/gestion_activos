import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  departamentosService,
  empleadosService,
} from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Empleados" }];
const FILTROS_INICIALES = { q: "", departamento: "", activo: "" };

export function EmpleadosList() {
  const puedeEditar = usePermission("organizacion.editar");
  const [busqueda, setBusqueda] = useState("");
  const [departamentos, setDepartamentos] = useState([]);
  const cargar = useCallback((params) => empleadosService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el listado de empleados.",
  );

  useEffect(() => {
    departamentosService
      .list({ page_size: 100 })
      .then((datos) => setDepartamentos(datos.results ?? datos))
      .catch(() => setDepartamentos([]));
  }, []);

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  return (
    <div className="organizacion-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Empleados</h2>
        {puedeEditar && (
          <Link
            to="/admin/organizacion/empleados/new"
            className="btn btn-primary btn-sm"
          >
            Nuevo empleado
          </Link>
        )}
      </div>

      <form className="d-flex gap-2 mb-3 flex-wrap" onSubmit={handleBuscar}>
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Nombre, código o correo"
          aria-label="Buscar empleados"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
        />
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por departamento"
          value={listado.filtros.departamento}
          onChange={(event) =>
            listado.actualizarFiltros({ departamento: event.target.value })
          }
        >
          <option value="">Todos los departamentos</option>
          {departamentos.map((departamento) => (
            <option key={departamento.id} value={departamento.id}>
              {departamento.nombre}
            </option>
          ))}
        </select>
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
              <th>Cargo</th>
              <th>Departamento</th>
              <th className="text-end">Activos a cargo</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((empleado) => (
              <tr key={empleado.id}>
                <td>
                  <code>{empleado.codigo_empleado}</code>
                </td>
                <td>{empleado.nombre_completo}</td>
                <td>{empleado.cargo || "—"}</td>
                <td>{empleado.departamento_nombre}</td>
                <td className="text-end">
                  {empleado.total_activos > 0 ? (
                    <Link to={`/admin/activos?custodio=${empleado.id}`}>
                      {empleado.total_activos}
                    </Link>
                  ) : (
                    0
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${empleado.activo ? "text-bg-success" : "text-bg-secondary"}`}
                  >
                    {empleado.activo ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td>
                  <Link
                    to={`/admin/organizacion/empleados/${empleado.id}`}
                    className="btn btn-accion btn-sm"
                  >
                    {puedeEditar ? "Editar" : "Ver"}
                  </Link>
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted">
                  Sin empleados registrados
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
        etiqueta="empleados"
      />
    </div>
  );
}
