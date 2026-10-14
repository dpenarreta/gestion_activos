import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { concesionariosService } from "../../../api/organizacionService";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

const FILTROS_INICIALES = { q: "", activo: "" };

/**
 * De quién son los equipos que no compró la empresa.
 *
 * **No es el catálogo de proveedores.** Al proveedor se le compró el equipo, y
 * entonces el equipo es nuestro. El concesionario es su dueño: lo pone para
 * operar con nosotros, la compra corre por su cuenta y el mantenimiento por la
 * nuestra. Son dos preguntas distintas —«a quién le compramos» y «de quién es
 * esto»— y por eso hay dos catálogos.
 *
 * La columna de equipos es la razón de que la pantalla exista: dice de un
 * vistazo qué hay que devolverle a cada partner si termina la concesión.
 */
export function ConcesionariosList() {
  const puedeEditar = usePermission("organizacion.editar");
  const [busqueda, setBusqueda] = useState("");
  const cargar = useCallback(
    (params) => concesionariosService.list(params),
    [],
  );
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el listado de concesionarios.",
  );

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Concesionarios</h2>
          <p className="mz-desc">
            Partners que ponen equipos para operar con nosotros. La compra corre
            por su cuenta y el mantenimiento por la nuestra, así que el equipo
            se atiende igual que el propio pero no cuenta como patrimonio de la
            empresa.
          </p>
        </div>
        {puedeEditar && (
          <div className="mz-view-actions">
            <Link
              to="/admin/organizacion/concesionarios/new"
              className="btn btn-primary btn-sm"
            >
              <Icon name="plus-lg" /> Nuevo concesionario
            </Link>
          </div>
        )}
      </div>

      <form className="mz-filter-bar" onSubmit={handleBuscar} role="search">
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar concesionarios</span>
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
              <th className="num">Equipos suyos</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((concesionario) => (
              <tr key={concesionario.id}>
                <td className="mz-strong">{concesionario.nombre}</td>
                <td className="mz-mono mz-faint">
                  {concesionario.identificacion || "—"}
                </td>
                <td>
                  {concesionario.contacto || (
                    <span className="mz-faint">—</span>
                  )}
                  {concesionario.telefono && (
                    <div className="mz-faint mz-small">
                      {concesionario.telefono}
                    </div>
                  )}
                </td>
                <td className="num">
                  {concesionario.total_activos > 0 ? (
                    <Link
                      to={`/activos?propiedad=concesion&concesionario=${concesionario.id}`}
                    >
                      {concesionario.total_activos}
                    </Link>
                  ) : (
                    0
                  )}
                </td>
                <td>
                  <span
                    className={`mz-pill ${concesionario.activo ? "mz-pill--ok" : "mz-pill--neutral"}`}
                  >
                    {concesionario.activo ? "Activo" : "De baja"}
                  </span>
                </td>
                <td className="acciones">
                  <Link
                    to={`/admin/organizacion/concesionarios/${concesionario.id}`}
                    className="btn btn-outline-primary btn-sm"
                  >
                    {puedeEditar ? "Editar" : "Ver"}
                  </Link>
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={6}>Sin concesionarios registrados</td>
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
        etiqueta="concesionarios"
      />
    </div>
  );
}
