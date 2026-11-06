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
  termino,
  etiquetaLimpiar = "Limpiar filtros",
  campoBusquedaRef,
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
    // Con la búsqueda en vivo (06/11/2026) se nombra lo escrito: así se ve
    // de un vistazo si fue una errata y no que el registro no exista.
    const buscado = (termino ?? "").trim();
    return (
      <div className="mz-estado mz-empty">
        <p className="mb-2">
          {buscado
            ? `Sin resultados para «${buscado}».`
            : "Ningún resultado con estos filtros."}
        </p>
        {onLimpiarFiltros && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => {
              onLimpiarFiltros();
              // El botón desaparece al limpiar y el foco caía en <main>: se
              // lleva al buscador, que es donde se va a escribir de nuevo
              // (auditoría UX/UI de la búsqueda en vivo, 06/11/2026).
              campoBusquedaRef?.current?.focus();
            }}
          >
            {etiquetaLimpiar}
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
 * @param {string} [props.termino] lo buscado, para decir «Sin resultados para…»
 * @param {string} [props.etiquetaLimpiar] el texto del botón de limpiar
 * @param {{ current: HTMLElement | null }} [props.campoBusquedaRef] el campo
 *   que recibe el foco tras limpiar
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
