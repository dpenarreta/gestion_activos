import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { proveedoresService } from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Proveedores" },
];
const FILTROS_INICIALES = { q: "", activo: "" };

/**
 * A quién se le compra: equipos y piezas de repuesto.
 *
 * Es un catálogo y no un texto dentro de cada activo porque «Tecnomega»,
 * «TECNOMEGA» y «Tecno Mega» son la misma empresa para una persona y tres para
 * una consulta: preguntar cuánto se le lleva comprado devuelve un tercio de lo
 * que hay y nadie nota lo que falta.
 *
 * Las dos columnas de conteo son la razón de que exista: dicen de un vistazo
 * cuánto pesa cada proveedor en el parque y en los repuestos.
 */
export function ProveedoresList() {
  const puedeEditar = usePermission("organizacion.editar");
  const [busqueda, setBusqueda] = useState("");
  const cargar = useCallback((params) => proveedoresService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el listado de proveedores.",
  );

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  return (
    <div className="organizacion-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Proveedores</h2>
        {puedeEditar && (
          <Link
            to="/admin/organizacion/proveedores/new"
            className="btn btn-primary btn-sm"
          >
            Nuevo proveedor
          </Link>
        )}
      </div>

      <form className="d-flex gap-2 mb-3 flex-wrap" onSubmit={handleBuscar}>
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Buscar por nombre, RUC o contacto"
          aria-label="Buscar proveedores"
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
          <option value="false">Dados de baja</option>
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
              <th>Identificación</th>
              <th>Contacto</th>
              <th className="text-end">Equipos</th>
              <th className="text-end">Repuestos</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((proveedor) => (
              <tr key={proveedor.id}>
                <td>{proveedor.nombre}</td>
                <td className="text-muted">
                  {proveedor.identificacion || "—"}
                </td>
                <td>
                  {proveedor.contacto || <span className="text-muted">—</span>}
                  {proveedor.telefono && (
                    <div className="text-muted small">{proveedor.telefono}</div>
                  )}
                </td>
                <td className="text-end">{proveedor.total_activos}</td>
                <td className="text-end">{proveedor.total_repuestos}</td>
                <td>
                  <span
                    className={`badge ${proveedor.activo ? "text-bg-success" : "text-bg-secondary"}`}
                  >
                    {proveedor.activo ? "Activo" : "De baja"}
                  </span>
                </td>
                <td>
                  <Link
                    to={`/admin/organizacion/proveedores/${proveedor.id}`}
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
                  Sin proveedores registrados
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
        etiqueta="proveedores"
      />
    </div>
  );
}
