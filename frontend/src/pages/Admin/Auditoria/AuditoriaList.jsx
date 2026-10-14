import { Fragment, useState } from "react";

import { auditoriaService } from "../../../api/auditoriaService";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useAuditoria } from "../../../hooks/useAuditoria";
import { usePermission } from "../../../hooks/usePermission";
import { descargarBlob } from "../../../utils/descargas";
import { mensajeDeError } from "../../../utils/errores";
import { formatearFecha } from "../../../utils/formato";
import "./AuditoriaList.css";

const RESULTADOS = [
  { valor: "", etiqueta: "Todos los resultados" },
  { valor: "success", etiqueta: "Éxito" },
  { valor: "failure", etiqueta: "Fallido" },
];

const FILTROS_VACIOS = {
  actor_username: "",
  action: "",
  module: "",
  result: "",
  created_from: "",
  created_to: "",
};

/*
 * El registro de lo que se hizo en el sistema.
 *
 * No hay filtro de módulo y sí de acción: la acción ya lo lleva delante
 * —«role.created», «activo.updated»—, así que escribir «activo» acota el
 * módulo entero. Un desplegable de módulos obligaría a mantener aquí una copia
 * de la lista que vive en el catálogo de permisos del servidor, y se
 * desincronizaría con el primer módulo nuevo.
 */
export function AuditoriaList() {
  const puedeVerDetalle = usePermission("auditoria.ver_detalle");
  const puedeExportar = usePermission("auditoria.exportar");
  const {
    eventos,
    total,
    haySiguiente,
    hayAnterior,
    pagina,
    setPagina,
    actualizarFiltros,
    limpiarFiltros,
    parametrosVigentes,
    isLoading,
    error,
  } = useAuditoria();

  const [borrador, setBorrador] = useState(FILTROS_VACIOS);
  const [abierto, setAbierto] = useState(null);
  const [isExportando, setIsExportando] = useState(false);
  const [errorExportacion, setErrorExportacion] = useState(null);

  const columnas = puedeVerDetalle ? 7 : 6;

  function aplicar(evento) {
    evento.preventDefault();
    actualizarFiltros(borrador);
  }

  function limpiar() {
    setBorrador(FILTROS_VACIOS);
    limpiarFiltros();
  }

  async function exportar() {
    setIsExportando(true);
    setErrorExportacion(null);
    try {
      descargarBlob(
        await auditoriaService.exportar(parametrosVigentes()),
        "auditoria.csv",
      );
    } catch (err) {
      setErrorExportacion(
        mensajeDeError(err, "No se pudo exportar el registro."),
      );
    } finally {
      setIsExportando(false);
    }
  }

  return (
    <div className="auditoria-page">
      <div className="mz-view-head">
        <div>
          <h2>Auditoría</h2>
          <p className="mz-desc">
            Qué se hizo, quién lo hizo y cuándo. El registro no se edita ni se
            borra: existe para reconstruir lo que pasó, así que lo que entra se
            queda.
          </p>
        </div>
        {puedeExportar && (
          <div className="mz-view-actions">
            <button
              type="button"
              className="btn btn-exportar btn-sm"
              onClick={exportar}
              disabled={isExportando || total === 0}
              title="Exporta los eventos que coinciden con los filtros actuales"
            >
              <Icon name="file-earmark-spreadsheet" />{" "}
              {isExportando ? "Exportando…" : `Exportar (${total})`}
            </button>
          </div>
        )}
      </div>

      {errorExportacion && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {errorExportacion}
        </div>
      )}

      <form
        className="mz-filter-bar auditoria-filtros"
        onSubmit={aplicar}
        role="search"
      >
        <div>
          <label htmlFor="auditoria-usuario" className="form-label">
            Usuario
          </label>
          <input
            id="auditoria-usuario"
            className="form-control form-control-sm"
            placeholder="Nombre de la cuenta"
            value={borrador.actor_username}
            onChange={(e) =>
              setBorrador({ ...borrador, actor_username: e.target.value })
            }
          />
        </div>
        <div>
          <label htmlFor="auditoria-accion" className="form-label">
            Acción
          </label>
          <input
            id="auditoria-accion"
            className="form-control form-control-sm"
            placeholder="activo, role.created…"
            value={borrador.action}
            onChange={(e) =>
              setBorrador({ ...borrador, action: e.target.value })
            }
          />
        </div>
        <div>
          <label htmlFor="auditoria-resultado" className="form-label">
            Resultado
          </label>
          <select
            id="auditoria-resultado"
            className="form-select form-select-sm"
            value={borrador.result}
            onChange={(e) =>
              setBorrador({ ...borrador, result: e.target.value })
            }
          >
            {RESULTADOS.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="auditoria-desde" className="form-label">
            Desde
          </label>
          <input
            id="auditoria-desde"
            type="date"
            className="form-control form-control-sm"
            value={borrador.created_from}
            onChange={(e) =>
              setBorrador({ ...borrador, created_from: e.target.value })
            }
          />
        </div>
        <div>
          <label htmlFor="auditoria-hasta" className="form-label">
            Hasta
          </label>
          <input
            id="auditoria-hasta"
            type="date"
            className="form-control form-control-sm"
            value={borrador.created_to}
            onChange={(e) =>
              setBorrador({ ...borrador, created_to: e.target.value })
            }
          />
        </div>
        <div className="auditoria-filtros__acciones">
          <button type="submit" className="btn btn-primary btn-sm">
            <Icon name="funnel" /> Filtrar
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={limpiar}
          >
            Limpiar
          </button>
        </div>
      </form>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Fecha y hora</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Módulo</th>
              <th>Sobre qué</th>
              <th>Resultado</th>
              {puedeVerDetalle && <th>Detalle</th>}
            </tr>
          </thead>
          <tbody>
            {eventos.map((evento) => (
              <Fragment key={evento.id}>
                <tr>
                  <td className="mz-mono">
                    {formatearFecha(evento.created_at_local, true)}
                  </td>
                  {/* Un evento puede no tener autor —lo dispara una tarea del
                      sistema, o el intento llegó sin sesión válida—, y ahí
                      «Sistema» dice más que una celda en blanco. */}
                  <td className="mz-strong">
                    {evento.actor_username || "Sistema"}
                  </td>
                  <td className="mz-mono">{evento.action}</td>
                  <td>{evento.module || "—"}</td>
                  <td>
                    {evento.target_type}
                    {evento.target_id ? ` #${evento.target_id}` : ""}
                  </td>
                  <td>
                    <span
                      className={`mz-pill ${
                        evento.result === "success"
                          ? "mz-pill--ok"
                          : "mz-pill--bad"
                      }`}
                    >
                      {evento.result === "success" ? "Éxito" : "Fallido"}
                    </span>
                  </td>
                  {puedeVerDetalle && (
                    <td className="acciones">
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        aria-expanded={abierto === evento.id}
                        onClick={() =>
                          setAbierto(abierto === evento.id ? null : evento.id)
                        }
                      >
                        {abierto === evento.id ? "Ocultar" : "Ver"}
                      </button>
                    </td>
                  )}
                </tr>
                {puedeVerDetalle && abierto === evento.id && (
                  <tr className="auditoria-detalle">
                    <td colSpan={columnas}>
                      <div className="auditoria-detalle__columnas">
                        <div className="mz-section">
                          <h4>Antes</h4>
                          <Valores valores={evento.previous_values} />
                        </div>
                        <div className="mz-section">
                          <h4>Después</h4>
                          <Valores valores={evento.new_values} />
                        </div>
                      </div>
                      <p className="mz-small mz-faint mb-0">
                        Desde {evento.ip_address || "origen desconocido"}
                        {evento.browser ? ` · ${evento.browser}` : ""}
                        {evento.operating_system
                          ? ` · ${evento.operating_system}`
                          : ""}
                        {evento.location ? ` · ${evento.location}` : ""}
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!isLoading && eventos.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={columnas}>Sin eventos para esos filtros</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mientras carga, el pie lo dice; `Paginacion` no se pinta con cero
          eventos, y la fila vacía de la tabla ya lo explica. */}
      {isLoading ? (
        <div className="mz-pager">
          <span className="mz-small mz-faint">Cargando…</span>
        </div>
      ) : (
        <Paginacion
          total={total}
          pagina={pagina}
          hasNext={haySiguiente}
          hasPrevious={hayAnterior}
          onCambiarPagina={setPagina}
          etiqueta="evento(s)"
        />
      )}
    </div>
  );
}

/* Los valores llegan como JSON libre —cada módulo guarda los suyos—, así que
   se pintan campo por campo en vez de volcar el objeto: un JSON crudo obliga a
   leer llaves y comillas para encontrar el dato que cambió. */
function Valores({ valores }) {
  const entradas = Object.entries(valores || {});
  if (entradas.length === 0) {
    return <p className="mz-faint mb-0">Sin datos</p>;
  }
  return (
    <div className="mz-kv-grid">
      {entradas.map(([campo, valor]) => (
        <div key={campo} className="mz-kv mz-kv--full">
          <span className="mz-kv-label mz-mono">{campo}</span>
          <span className="auditoria-detalle__valor">
            {valor === null || valor === "" ? "—" : String(valor)}
          </span>
        </div>
      ))}
    </div>
  );
}
