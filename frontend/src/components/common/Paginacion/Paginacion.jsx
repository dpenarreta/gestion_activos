/**
 * Controles de paginación de los listados del dominio.
 *
 * El backend pagina por número de página y solo informa si hay siguiente o
 * anterior (`next`/`previous`), no cuántas páginas hay en total: por eso los
 * controles son "anterior/siguiente" y no una lista numerada. Calcular el
 * total de páginas dividiendo `count` entre el tamaño de página obligaría a
 * que el cliente conozca ese tamaño, que es configuración del servidor.
 */
export function Paginacion({ total, pagina, hasNext, hasPrevious, onCambiarPagina, etiqueta }) {
  if (total === 0) {
    return null;
  }

  return (
    <div className="d-flex justify-content-between align-items-center mt-3">
      <span className="text-muted small">
        {total} {etiqueta}
        {pagina > 1 && ` · página ${pagina}`}
      </span>
      <div className="d-flex gap-2">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={!hasPrevious}
          onClick={() => onCambiarPagina(pagina - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={!hasNext}
          onClick={() => onCambiarPagina(pagina + 1)}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
