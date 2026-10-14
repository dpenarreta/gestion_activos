import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { proveedoresService } from "../../../api/organizacionService";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

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
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Proveedores</h2>
          <p className="mz-desc">
            A quién se le compran los equipos y los repuestos, y cuánto pesa
            cada uno en el parque.
          </p>
        </div>
        {puedeEditar && (
          <div className="mz-view-actions">
            <Link
              to="/admin/organizacion/proveedores/new"
              className="btn btn-primary btn-sm"
            >
              <Icon name="plus-lg" /> Nuevo proveedor
            </Link>
          </div>
        )}
      </div>

      <form className="mz-filter-bar" onSubmit={handleBuscar} role="search">
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar proveedores</span>
          <input
            type="search"
            placeholder="Buscar por nombre, RUC o contacto"
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
          <option value="false">Dados de baja</option>
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
              <th>Nombre</th>
              <th>Identificación</th>
              <th>Contacto</th>
              <th className="num">Equipos</th>
              <th className="num">Repuestos</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((proveedor) => (
              <tr key={proveedor.id}>
                <td className="mz-strong">{proveedor.nombre}</td>
                <td className="mz-mono mz-faint">
                  {proveedor.identificacion || "—"}
                </td>
                <td>
                  {proveedor.contacto || <span className="mz-faint">—</span>}
                  {proveedor.telefono && (
                    <div className="mz-faint mz-small">
                      {proveedor.telefono}
                    </div>
                  )}
                </td>
                <td className="num">{proveedor.total_activos}</td>
                <td className="num">{proveedor.total_repuestos}</td>
                <td>
                  <span
                    className={`mz-pill ${proveedor.activo ? "mz-pill--ok" : "mz-pill--neutral"}`}
                  >
                    {proveedor.activo ? "Activo" : "De baja"}
                  </span>
                </td>
                <td className="acciones">
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
              <tr className="mz-empty-row">
                <td colSpan={7}>Sin proveedores registrados</td>
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
