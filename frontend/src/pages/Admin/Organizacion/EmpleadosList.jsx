import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  departamentosService,
  empleadosService,
} from "../../../api/organizacionService";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

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
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Empleados</h2>
          <p className="mz-desc">
            Las personas que pueden tener equipos a cargo, cada una en su
            departamento.
          </p>
        </div>
        {puedeEditar && (
          <div className="mz-view-actions">
            <Link
              to="/admin/organizacion/empleados/new"
              className="btn btn-primary btn-sm"
            >
              <Icon name="plus-lg" /> Nuevo empleado
            </Link>
          </div>
        )}
      </div>

      <form className="mz-filter-bar" onSubmit={handleBuscar} role="search">
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar empleados</span>
          <input
            type="search"
            placeholder="Nombre, código o correo"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
          />
        </label>
        <select
          className="form-select form-select-sm"
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
              <th>Cargo</th>
              <th>Departamento</th>
              <th>Usuario</th>
              <th className="num">Activos a cargo</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((empleado) => (
              <tr key={empleado.id}>
                <td className="mz-code">{empleado.codigo_empleado}</td>
                <td className="mz-strong">{empleado.nombre_completo}</td>
                <td>{empleado.cargo || "—"}</td>
                <td>{empleado.departamento_nombre}</td>
                <td>
                  {empleado.usuario ? (
                    <span className="mz-code">{empleado.usuario_username}</span>
                  ) : (
                    <span
                      className="mz-pill mz-pill--warn"
                      title="Todo empleado debe tener usuario: edítelo y escriba su correo institucional."
                    >
                      Sin usuario
                    </span>
                  )}
                </td>
                <td className="num">
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
                    className={`mz-pill ${empleado.activo ? "mz-pill--ok" : "mz-pill--neutral"}`}
                  >
                    {empleado.activo ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="acciones">
                  <Link
                    to={`/admin/organizacion/empleados/${empleado.id}`}
                    className="btn btn-outline-primary btn-sm"
                  >
                    {puedeEditar ? "Editar" : "Ver"}
                  </Link>
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={8}>Sin empleados registrados</td>
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
