import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { empresasService } from "../../../api/empresasService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Empresas.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Empresas" }];
const FILTROS_INICIALES = {};

/**
 * Las empresas del grupo: cada una con su inventario, sus catálogos y sus
 * indicadores, sin ver los de las otras.
 *
 * Se listan todas y no solo aquellas en las que trabaja quien mira: esta es la
 * pantalla desde la que se crea la segunda empresa, y verse solo a sí misma
 * volvería imposible justamente eso. Quién llega hasta aquí lo decide
 * `empresas.ver`.
 */
export function EmpresasList() {
  const puedeEditar = usePermission("empresas.editar");
  const [busqueda, setBusqueda] = useState("");
  const cargar = useCallback((params) => empresasService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el listado de empresas.",
  );

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  return (
    <div className="empresas-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Empresas</h2>
        {puedeEditar && (
          <Link to="/admin/empresas/new" className="btn btn-primary btn-sm">
            Nueva empresa
          </Link>
        )}
      </div>

      <p className="text-muted">
        Todo lo que se registra pertenece a una empresa. Cambiar de empresa en
        el selector del menú cambia de dónde salen los datos: el inventario, los
        catálogos, el panel y los reportes pasan a ser los de la otra.
      </p>

      <form className="d-flex gap-2 mb-3 flex-wrap" onSubmit={handleBuscar}>
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Buscar por nombre"
          aria-label="Buscar empresas"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
        />
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
              <th>Código</th>
              <th>Identificación</th>
              <th className="text-end">Usuarios</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((empresa) => (
              <tr key={empresa.id}>
                <td>{empresa.nombre}</td>
                <td>
                  <code>{empresa.codigo}</code>
                </td>
                <td className="text-muted">{empresa.identificacion || "—"}</td>
                <td className="text-end">
                  {empresa.usuarios}
                  {/* Una empresa sin nadie asignado no la ve nadie, y desde
                      fuera parece que el sistema perdió los datos. */}
                  {empresa.usuarios === 0 && (
                    <span className="badge text-bg-warning ms-2">
                      Sin usuarios
                    </span>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${empresa.activa ? "text-bg-success" : "text-bg-secondary"}`}
                  >
                    {empresa.activa ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td>
                  <Link
                    to={`/admin/empresas/${empresa.id}`}
                    className="btn btn-outline-primary btn-sm"
                  >
                    {puedeEditar ? "Editar" : "Ver"}
                  </Link>
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted">
                  Sin empresas registradas
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
        etiqueta="empresas"
      />
    </div>
  );
}
