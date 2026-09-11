import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { concesionariosService } from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Concesionarios" },
];
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
    <div className="organizacion-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Concesionarios</h2>
        {puedeEditar && (
          <Link
            to="/admin/organizacion/concesionarios/new"
            className="btn btn-primary btn-sm"
          >
            Nuevo concesionario
          </Link>
        )}
      </div>

      <p className="text-muted">
        Partners que ponen equipos para operar con nosotros. La compra corre por
        su cuenta y el mantenimiento por la nuestra, así que el equipo se
        atiende igual que el propio pero no cuenta como patrimonio de la
        empresa.
      </p>

      <form className="d-flex gap-2 mb-3 flex-wrap" onSubmit={handleBuscar}>
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Buscar por nombre, RUC o contacto"
          aria-label="Buscar concesionarios"
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
              <th className="text-end">Equipos suyos</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((concesionario) => (
              <tr key={concesionario.id}>
                <td>{concesionario.nombre}</td>
                <td className="text-muted">
                  {concesionario.identificacion || "—"}
                </td>
                <td>
                  {concesionario.contacto || (
                    <span className="text-muted">—</span>
                  )}
                  {concesionario.telefono && (
                    <div className="text-muted small">
                      {concesionario.telefono}
                    </div>
                  )}
                </td>
                <td className="text-end">
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
                    className={`badge ${concesionario.activo ? "text-bg-success" : "text-bg-secondary"}`}
                  >
                    {concesionario.activo ? "Activo" : "De baja"}
                  </span>
                </td>
                <td>
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
              <tr>
                <td colSpan={6} className="text-center text-muted">
                  Sin concesionarios registrados
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
        etiqueta="concesionarios"
      />
    </div>
  );
}
