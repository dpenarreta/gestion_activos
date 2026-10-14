import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { departamentosService } from "../../../api/organizacionService";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

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
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Departamentos</h2>
          <p className="mz-desc">
            Las áreas de la empresa: a cuál pertenece cada empleado y quién
            responde por ella.
          </p>
        </div>
        {puedeEditar && (
          <div className="mz-view-actions">
            <Link
              to="/admin/organizacion/departamentos/new"
              className="btn btn-primary btn-sm"
            >
              <Icon name="plus-lg" /> Nuevo departamento
            </Link>
          </div>
        )}
      </div>

      <form className="mz-filter-bar" onSubmit={handleBuscar} role="search">
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar departamentos</span>
          <input
            type="search"
            placeholder="Buscar por nombre o código"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
          />
        </label>
        <select
          className="form-select form-select-sm"
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
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {listado.error}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Responsable</th>
              <th className="num">Empleados</th>
              <th className="num">Activos</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((departamento) => (
              <tr key={departamento.id}>
                <td className="mz-code">{departamento.codigo}</td>
                <td className="mz-strong">{departamento.nombre}</td>
                <td>{departamento.responsable_nombre || "—"}</td>
                <td className="num">{departamento.total_empleados}</td>
                <td className="num">{departamento.total_activos}</td>
                <td>
                  <span
                    className={`mz-pill ${departamento.activo ? "mz-pill--ok" : "mz-pill--neutral"}`}
                  >
                    {departamento.activo ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="acciones">
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
              <tr className="mz-empty-row">
                <td colSpan={7}>Sin departamentos registrados</td>
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
