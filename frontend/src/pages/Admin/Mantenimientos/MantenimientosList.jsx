import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { exportacionService } from "../../../api/activosService";
import { mantenimientosService } from "../../../api/mantenimientosService";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import { descargarBlob } from "../../../utils/descargas";
import { formatearFecha, formatearMoneda } from "../../../utils/formato";
import "./Mantenimientos.css";

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
      <div className="mz-view-head">
        <div>
          <h2>Bitácora de mantenimientos</h2>
          <p className="mz-desc">
            Cada intervención preventiva o correctiva sobre un equipo, con sus
            piezas y su costo.
          </p>
        </div>
        <div className="mz-view-actions">
          <Link
            to="/admin/mantenimientos/componentes"
            className="btn btn-outline-primary btn-sm"
          >
            <Icon name="cpu" /> Catálogo de componentes
          </Link>
          {puedeExportar && (
            <button
              type="button"
              className="btn btn-exportar btn-sm"
              onClick={handleExportar}
              disabled={isExportando || listado.total === 0}
              title="Exporta las intervenciones que coinciden con los filtros actuales"
            >
              <Icon name="file-earmark-excel" />{" "}
              {isExportando ? "Exportando…" : `Exportar (${listado.total})`}
            </button>
          )}
          {puedeRegistrar && (
            <Link
              to="/admin/mantenimientos/new"
              className="btn btn-primary btn-sm"
            >
              <Icon name="plus-lg" /> Registrar mantenimiento
            </Link>
          )}
        </div>
      </div>

      <form
        className="mz-filter-bar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          listado.actualizarFiltros({ q: busqueda });
        }}
      >
        <label className="mz-fb-search" htmlFor="mant-buscar">
          <Icon name="search" />
          <span className="visually-hidden">Buscar</span>
          <input
            id="mant-buscar"
            type="search"
            placeholder="Código, responsable o diagnóstico"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
          />
        </label>
        <div className="mz-inline-field">
          <label htmlFor="mant-tipo">Tipo</label>
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
        <div className="mz-inline-field">
          <label htmlFor="mant-desde">Desde</label>
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
        <div className="mz-inline-field">
          <label htmlFor="mant-hasta">Hasta</label>
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

      {/* El mismo aviso que da el inventario: el backend repara el código que
          llega con la distribución de teclado cambiada —el guion como
          apóstrofe— y lo dice. Aquí importa más todavía, porque lo que se busca
          es el historial de un equipo concreto: sin aviso, una lectura mal
          traducida se lee como «este equipo nunca entró al taller». */}
      {listado.respuesta?.advertencia_lector && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          <div>
            <strong>Revise la configuración del lector.</strong>{" "}
            {listado.respuesta.advertencia_lector.mensaje}
          </div>
        </div>
      )}
      {listado.error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {listado.error}
        </div>
      )}
      {errorAccion && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {errorAccion}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table mz-table--ancha">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Activo</th>
              <th>Tipo</th>
              <th>Responsable</th>
              <th>Trabajo</th>
              <th>Componentes</th>
              <th className="num">Costo</th>
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
                  <Link
                    to={`/admin/activos/${mantenimiento.activo}`}
                    className="mz-mono"
                  >
                    {mantenimiento.activo_codigo}
                  </Link>
                  <div className="mz-small mz-faint">
                    {mantenimiento.activo_nombre}
                  </div>
                </td>
                <td>
                  <span
                    className={`mz-pill ${
                      mantenimiento.tipo === "correctivo"
                        ? "mz-pill--warn"
                        : "mz-pill--neutral"
                    }`}
                  >
                    {mantenimiento.tipo_display}
                  </span>
                </td>
                <td>
                  {mantenimiento.responsable}
                  <div className="mz-small mz-faint">
                    {mantenimiento.tipo_responsable_display}
                  </div>
                </td>
                <td className="celda-descripcion">
                  {mantenimiento.descripcion}
                </td>
                <td>
                  {mantenimiento.componentes.length === 0 ? (
                    <span className="mz-faint">—</span>
                  ) : (
                    <ul className="list-unstyled mb-0 mz-small">
                      {mantenimiento.componentes.map((componente) => (
                        <li key={componente.id}>
                          {componente.componente_nombre} ×{componente.cantidad}
                          {componente.era_critico && (
                            <span className="mz-pill mz-pill--bad ms-1">
                              crítica
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="num text-nowrap">
                  {formatearMoneda(mantenimiento.costo_total)}
                </td>
                <td className="acciones">
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
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={8}>
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
