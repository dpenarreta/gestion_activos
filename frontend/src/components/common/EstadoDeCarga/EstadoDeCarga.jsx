import { Icon } from "../Icon/Icon";

/*
 * Cargando, error y vacío, igual en todas las listas (auditoría UX/UI de todo
 * el sistema, fase 2, 28/10/2026). Antes cada pantalla lo resolvía a su modo
 * y muchas mostraban una tabla vacía mientras cargaban, un fallo como lista
 * vacía o «sin registros» cuando en realidad el filtro no encontraba nada.
 *
 * Muestra lo primero que corresponda: error › cargando › vacío; si no hay
 * nada que decir, no pinta nada. `FilaDeEstado` es lo mismo dentro de una
 * tabla.
 */
function contenido({
  cargando,
  error,
  onReintentar,
  vacio,
  textoVacio = "Todavía no hay registros.",
  hayFiltros,
  onLimpiarFiltros,
  accionVacio,
}) {
  if (error) {
    return (
      <div className="mz-alert mz-alert--bad mz-estado__error" role="alert">
        <Icon name="x-octagon" />
        <span className="flex-grow-1">{error}</span>
        {onReintentar && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onReintentar}
          >
            Reintentar
          </button>
        )}
      </div>
    );
  }
  if (cargando) {
    return (
      <p className="mz-estado mz-faint" role="status">
        <span
          className="spinner-border spinner-border-sm me-2"
          aria-hidden="true"
        />
        Cargando…
      </p>
    );
  }
  if (!vacio) return null;
  if (hayFiltros) {
    return (
      <div className="mz-estado mz-empty">
        <p className="mb-2">Ningún resultado con estos filtros.</p>
        {onLimpiarFiltros && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onLimpiarFiltros}
          >
            Limpiar filtros
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mz-estado mz-empty">
      <p className={accionVacio ? "mb-2" : "mb-0"}>{textoVacio}</p>
      {accionVacio}
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} [props.cargando]
 * @param {string|null} [props.error] mensaje ya legible (mensajeDeError)
 * @param {() => void} [props.onReintentar]
 * @param {boolean} [props.vacio] si la lista quedó sin filas
 * @param {string} [props.textoVacio]
 * @param {boolean} [props.hayFiltros] vacío por los filtros, no por falta de datos
 * @param {() => void} [props.onLimpiarFiltros]
 * @param {import("react").ReactNode} [props.accionVacio] p. ej. «Crear el primero»
 */
export function EstadoDeCarga(props) {
  return contenido(props);
}

/** Lo mismo, como fila de una tabla de `columnas` columnas. */
export function FilaDeEstado({ columnas, ...props }) {
  const resultado = contenido(props);
  if (!resultado) return null;
  return (
    <tr className="mz-estado-fila">
      <td colSpan={columnas}>{resultado}</td>
    </tr>
  );
}
