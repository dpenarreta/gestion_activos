import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  departamentosService,
  empleadosService,
} from "../../../api/organizacionService";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { useVistaDeTarjetas } from "../../../hooks/useMediaQuery";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

const FILTROS_INICIALES = { q: "", departamento: "", activo: "" };

export function EmpleadosList() {
  const puedeEditar = usePermission("organizacion.editar");
  const [busqueda, setBusqueda] = useState("");
  const [departamentos, setDepartamentos] = useState([]);
  const enTarjetas = useVistaDeTarjetas();
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

  const hayFiltros = Object.values(listado.filtros).some(Boolean);

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  // También vacía la caja de búsqueda: si no, el texto seguiría ahí y el
  // próximo «Buscar» volvería a filtrar por él.
  function limpiarFiltros() {
    setBusqueda("");
    listado.actualizarFiltros(FILTROS_INICIALES);
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

      {/* En el teléfono, cada empleado en una tarjeta: ocho columnas a 375 px
          solo se leían desplazándose de lado (revisión final UX/UI,
          28/10/2026). */}
      <div className="mz-table-wrap mz-table-wrap--con-tarjetas">
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
            {/* Cargando, error con reintento y un vacío que distingue «no
                hay registros» de «el filtro no encuentra nada» (auditoría
                UX/UI, fase 2, 28/10/2026). */}
            <FilaDeEstado
              columnas={8}
              cargando={listado.isLoading && listado.resultados.length === 0}
              error={listado.error}
              onReintentar={listado.refresh}
              vacio={!listado.isLoading && listado.resultados.length === 0}
              textoVacio="Todavía no hay empleados registrados."
              hayFiltros={hayFiltros}
              onLimpiarFiltros={limpiarFiltros}
            />
            {!listado.error &&
              listado.resultados.map((empleado) => (
                <tr key={empleado.id}>
                  <td className="mz-code">{empleado.codigo_empleado}</td>
                  <td className="mz-strong">{empleado.nombre_completo}</td>
                  <td>{empleado.cargo || "—"}</td>
                  <td>{empleado.departamento_nombre}</td>
                  <td>
                    {empleado.usuario ? (
                      <span className="mz-code">
                        {empleado.usuario_username}
                      </span>
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
                      aria-label={`${puedeEditar ? "Editar" : "Ver"} ${empleado.nombre_completo}`}
                    >
                      {puedeEditar ? "Editar" : "Ver"}
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {enTarjetas && (
        <div className="mz-cards">
          <EstadoDeCarga
            cargando={listado.isLoading && listado.resultados.length === 0}
            error={listado.error}
            onReintentar={listado.refresh}
            vacio={!listado.isLoading && listado.resultados.length === 0}
            textoVacio="Todavía no hay empleados registrados."
            hayFiltros={hayFiltros}
            onLimpiarFiltros={limpiarFiltros}
          />
          {!listado.error && listado.resultados.length > 0 && (
            <ul className="mz-cards-lista" aria-label="Empleados">
              {listado.resultados.map((empleado) => (
                <li key={empleado.id} className="mz-card-row">
                  <div className="mz-row-between">
                    <strong className="mz-card-row__titulo">
                      {empleado.nombre_completo}
                    </strong>
                    <span
                      className={`mz-pill ${empleado.activo ? "mz-pill--ok" : "mz-pill--neutral"}`}
                    >
                      {empleado.activo ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  <div className="mz-card-row__titulo mz-small">
                    {[empleado.cargo, empleado.departamento_nombre]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div className="mz-card-meta">
                    <span>
                      Código:{" "}
                      <span className="mz-code">
                        {empleado.codigo_empleado}
                      </span>
                    </span>
                    {empleado.usuario ? (
                      <span>
                        Usuario:{" "}
                        <span className="mz-code">
                          {empleado.usuario_username}
                        </span>
                      </span>
                    ) : (
                      <span className="mz-pill mz-pill--warn">Sin usuario</span>
                    )}
                    <span>
                      Activos a cargo:{" "}
                      {empleado.total_activos > 0 ? (
                        <Link to={`/admin/activos?custodio=${empleado.id}`}>
                          {empleado.total_activos}
                        </Link>
                      ) : (
                        0
                      )}
                    </span>
                  </div>
                  <div className="mz-card-acciones">
                    <Link
                      to={`/admin/organizacion/empleados/${empleado.id}`}
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`${puedeEditar ? "Editar" : "Ver"} ${empleado.nombre_completo}`}
                    >
                      {puedeEditar ? "Editar" : "Ver"}
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
        etiqueta="empleados"
      />
    </div>
  );
}
