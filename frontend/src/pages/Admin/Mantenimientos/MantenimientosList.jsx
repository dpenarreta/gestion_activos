import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { exportacionService } from "../../../api/activosService";
import { mantenimientosService } from "../../../api/mantenimientosService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import { descargarBlob } from "../../../utils/descargas";
import { formatearFecha, formatearMoneda } from "../../../utils/formato";
import "./Mantenimientos.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Mantenimientos" },
];
const FILTROS_INICIALES = { q: "", tipo: "", desde: "", hasta: "" };

export function MantenimientosList() {
  const puedeRegistrar = usePermission("mantenimientos.registrar");
  const puedeEditar = usePermission("mantenimientos.editar");
  const puedeExportar = usePermission("mantenimientos.exportar");
  const [isExportando, setIsExportando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [aEliminar, setAEliminar] = useState(null);
  const [errorAccion, setErrorAccion] = useState(null);

  const cargar = useCallback(
    (params) => mantenimientosService.list(params),
    [],
  );
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar la bitácora de mantenimientos.",
  );

  async function handleExportar() {
    setIsExportando(true);
    setErrorAccion(null);
    try {
      const filtros = Object.fromEntries(
        Object.entries(listado.filtros).filter(([, valor]) => valor !== ""),
      );
      descargarBlob(
        await exportacionService.mantenimientos(filtros),
        "bitacora-mantenimientos.xlsx",
      );
    } catch (err) {
      setErrorAccion(mensajeDeError(err, "No se pudo exportar la bitácora."));
    } finally {
      setIsExportando(false);
    }
  }

  async function confirmarEliminacion() {
    try {
      await mantenimientosService.remove(aEliminar.id);
      setAEliminar(null);
      setErrorAccion(null);
      listado.refresh();
    } catch (err) {
      setErrorAccion(
        mensajeDeError(err, "No se pudo eliminar la intervención."),
      );
      setAEliminar(null);
    }
  }

  return (
    <div className="mantenimientos-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2>Bitácora de mantenimientos</h2>
        <div className="d-flex gap-2">
          <Link
            to="/admin/mantenimientos/componentes"
            className="btn btn-outline-primary btn-sm"
          >
            Catálogo de componentes
          </Link>
          {puedeExportar && (
            <button
              type="button"
              className="btn btn-exportar btn-sm"
              onClick={handleExportar}
              disabled={isExportando || listado.total === 0}
              title="Exporta las intervenciones que coinciden con los filtros actuales"
            >
              <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
              {isExportando ? "Exportando…" : `Exportar (${listado.total})`}
            </button>
          )}
          {puedeRegistrar && (
            <Link
              to="/admin/mantenimientos/new"
              className="btn btn-primary btn-sm"
            >
              Registrar mantenimiento
            </Link>
          )}
        </div>
      </div>

      <form
        className="d-flex gap-2 mb-3 flex-wrap align-items-end"
        onSubmit={(event) => {
          event.preventDefault();
          listado.actualizarFiltros({ q: busqueda });
        }}
      >
        <div>
          <label className="form-label small mb-1" htmlFor="mant-buscar">
            Buscar
          </label>
          <input
            id="mant-buscar"
            type="search"
            className="form-control form-control-sm"
            placeholder="Código, responsable o diagnóstico"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
          />
        </div>
        <div>
          <label className="form-label small mb-1" htmlFor="mant-tipo">
            Tipo
          </label>
          <select
            id="mant-tipo"
            className="form-select form-select-sm"
            value={listado.filtros.tipo}
            onChange={(event) =>
              listado.actualizarFiltros({ tipo: event.target.value })
            }
          >
            <option value="">Todos</option>
            <option value="preventivo">Preventivo</option>
            <option value="correctivo">Correctivo</option>
          </select>
        </div>
        <div>
          <label className="form-label small mb-1" htmlFor="mant-desde">
            Desde
          </label>
          <input
            id="mant-desde"
            type="date"
            className="form-control form-control-sm"
            value={listado.filtros.desde}
            onChange={(event) =>
              listado.actualizarFiltros({ desde: event.target.value })
            }
          />
        </div>
        <div>
          <label className="form-label small mb-1" htmlFor="mant-hasta">
            Hasta
          </label>
          <input
            id="mant-hasta"
            type="date"
            className="form-control form-control-sm"
            value={listado.filtros.hasta}
            onChange={(event) =>
              listado.actualizarFiltros({ hasta: event.target.value })
            }
          />
        </div>
        <button type="submit" className="btn btn-outline-secondary btn-sm">
          Buscar
        </button>
      </form>

      {listado.error && (
        <div className="alert alert-danger">{listado.error}</div>
      )}
      {errorAccion && <div className="alert alert-danger">{errorAccion}</div>}

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Activo</th>
              <th>Tipo</th>
              <th>Responsable</th>
              <th>Trabajo</th>
              <th>Componentes</th>
              <th className="text-end">Costo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((mantenimiento) => (
              <tr key={mantenimiento.id}>
                <td className="text-nowrap">
                  {formatearFecha(mantenimiento.fecha_intervencion)}
                </td>
                <td>
                  <Link to={`/admin/activos/${mantenimiento.activo}`}>
                    <code className="codigo-barras">
                      {mantenimiento.activo_codigo}
                    </code>
                  </Link>
                  <div className="small text-muted">
                    {mantenimiento.activo_nombre}
                  </div>
                </td>
                <td>
                  <span
                    className={`badge ${
                      mantenimiento.tipo === "correctivo"
                        ? "text-bg-warning"
                        : "text-bg-info"
                    }`}
                  >
                    {mantenimiento.tipo_display}
                  </span>
                </td>
                <td>
                  {mantenimiento.responsable}
                  <div className="small text-muted">
                    {mantenimiento.tipo_responsable_display}
                  </div>
                </td>
                <td className="celda-descripcion">
                  {mantenimiento.descripcion}
                </td>
                <td>
                  {mantenimiento.componentes.length === 0 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <ul className="list-unstyled mb-0 small">
                      {mantenimiento.componentes.map((componente) => (
                        <li key={componente.id}>
                          {componente.componente_nombre} ×{componente.cantidad}
                          {componente.era_critico && (
                            <span className="badge text-bg-danger ms-1">
                              crítica
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="text-end text-nowrap">
                  {formatearMoneda(mantenimiento.costo_total)}
                </td>
                <td>
                  <div className="d-flex gap-2">
                    {puedeEditar && (
                      <>
                        <Link
                          to={`/admin/mantenimientos/${mantenimiento.id}`}
                          className="btn btn-outline-primary btn-sm"
                        >
                          Editar
                        </Link>
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => setAEliminar(mantenimiento)}
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-muted">
                  Sin intervenciones que coincidan con los filtros
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
        etiqueta="intervenciones"
      />

      <ConfirmDialog
        isOpen={Boolean(aEliminar)}
        title="Eliminar intervención"
        message={
          aEliminar
            ? `Se eliminará la intervención del ${formatearFecha(
                aEliminar.fecha_intervencion,
              )} sobre ${aEliminar.activo_codigo}. El contador de mantenimientos del activo y su sugerencia de renovación se recalcularán. El evento queda en la bitácora de auditoría.`
            : ""
        }
        onConfirm={confirmarEliminacion}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  );
}
