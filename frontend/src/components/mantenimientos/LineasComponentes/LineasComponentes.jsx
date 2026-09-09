import { formatearMoneda } from "../../../utils/formato";

const LINEA_VACIA = {
  componente: "",
  proveedor: "",
  cantidad: 1,
  costo_unitario: "",
  numero_serie_nuevo: "",
};

/**
 * Desglose de repuestos consumidos en una intervención (RF-04).
 *
 * Las piezas marcadas como críticas en el catálogo se señalan aquí mismo,
 * porque su reemplazo cuenta contra el umbral de renovación de RF-06: quien
 * captura debe ver que está registrando algo que puede disparar una
 * sugerencia de cambio, no enterarse después.
 *
 * Al editar, el backend reemplaza el desglose completo por lo que se envíe.
 * Se advierte en la interfaz para que nadie asuma que está agregando líneas a
 * las ya existentes.
 */
export function LineasComponentes({
  lineas,
  componentes,
  proveedores = [],
  onChange,
  esEdicion = false,
}) {
  function actualizarLinea(indice, campo, valor) {
    onChange(
      lineas.map((linea, i) =>
        i === indice ? { ...linea, [campo]: valor } : linea,
      ),
    );
  }

  function agregar() {
    onChange([...lineas, { ...LINEA_VACIA }]);
  }

  function quitar(indice) {
    onChange(lineas.filter((_, i) => i !== indice));
  }

  const total = lineas.reduce((suma, linea) => {
    const costo = Number(linea.costo_unitario) || 0;
    const cantidad = Number(linea.cantidad) || 0;
    return suma + costo * cantidad;
  }, 0);

  const criticas = lineas.reduce((suma, linea) => {
    const componente = componentes.find(
      (c) => String(c.id) === String(linea.componente),
    );
    return componente?.es_critico ? suma + (Number(linea.cantidad) || 0) : suma;
  }, 0);

  return (
    <div className="componentes-lineas">
      {esEdicion && lineas.length > 0 && (
        <p className="small text-muted">
          Al guardar, esta lista reemplaza por completo el desglose anterior de
          la intervención.
        </p>
      )}

      {lineas.length === 0 && (
        <p className="text-muted mb-3">
          Sin repuestos. Una intervención puede no consumir ninguno (por
          ejemplo, una limpieza preventiva).
        </p>
      )}

      {lineas.map((linea, indice) => {
        const componente = componentes.find(
          (c) => String(c.id) === String(linea.componente),
        );
        return (
          <div className="row g-2 align-items-end mb-2" key={indice}>
            <div className="col-md-3">
              {indice === 0 && (
                <label
                  className="form-label small mb-1"
                  htmlFor={`comp-${indice}`}
                >
                  Componente
                </label>
              )}
              <select
                id={`comp-${indice}`}
                className="form-select form-select-sm"
                value={linea.componente}
                onChange={(event) =>
                  actualizarLinea(indice, "componente", event.target.value)
                }
              >
                <option value="">Seleccione un componente</option>
                {componentes.map((opcion) => (
                  <option key={opcion.id} value={opcion.id}>
                    {opcion.nombre}
                    {opcion.es_critico ? " (crítica)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              {indice === 0 && (
                <label
                  className="form-label small mb-1"
                  htmlFor={`prov-${indice}`}
                >
                  Proveedor
                </label>
              )}
              {/* A quién se le compró la pieza. El proveedor del equipo no
                  tiene por qué ser el del repuesto, y una pieza que falla a los
                  dos meses deja el costo registrado y ninguna forma de saber a
                  quién reclamarle. */}
              <select
                id={`prov-${indice}`}
                className="form-select form-select-sm"
                value={linea.proveedor || ""}
                onChange={(event) =>
                  actualizarLinea(indice, "proveedor", event.target.value)
                }
              >
                <option value="">Sin registrar</option>
                {proveedores.map((opcion) => (
                  <option key={opcion.id} value={opcion.id}>
                    {opcion.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-1">
              {indice === 0 && (
                <label
                  className="form-label small mb-1"
                  htmlFor={`cant-${indice}`}
                >
                  Cantidad
                </label>
              )}
              <input
                id={`cant-${indice}`}
                type="number"
                min="1"
                className="form-control form-control-sm"
                value={linea.cantidad}
                onChange={(event) =>
                  actualizarLinea(indice, "cantidad", event.target.value)
                }
              />
            </div>
            <div className="col-md-2">
              {indice === 0 && (
                <label
                  className="form-label small mb-1"
                  htmlFor={`costo-${indice}`}
                >
                  Costo unitario
                </label>
              )}
              <input
                id={`costo-${indice}`}
                type="number"
                step="0.01"
                min="0"
                className="form-control form-control-sm"
                value={linea.costo_unitario}
                onChange={(event) =>
                  actualizarLinea(indice, "costo_unitario", event.target.value)
                }
              />
            </div>
            <div className="col-md-2">
              {indice === 0 && (
                <label
                  className="form-label small mb-1"
                  htmlFor={`serie-${indice}`}
                >
                  Serie de la pieza
                </label>
              )}
              <input
                id={`serie-${indice}`}
                className="form-control form-control-sm font-monospace"
                placeholder="Opcional"
                value={linea.numero_serie_nuevo}
                onChange={(event) =>
                  actualizarLinea(
                    indice,
                    "numero_serie_nuevo",
                    event.target.value,
                  )
                }
              />
            </div>
            <div className="col-md-1 d-flex align-items-end gap-1">
              <button
                type="button"
                className="btn btn-outline-danger btn-sm w-100"
                onClick={() => quitar(indice)}
                aria-label={`Quitar línea ${indice + 1}`}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
            </div>
            {componente?.es_critico && (
              <div className="col-12">
                <small className="text-warning">
                  <i
                    className="bi bi-exclamation-triangle me-1"
                    aria-hidden="true"
                  />
                  Pieza crítica: su reemplazo cuenta contra el umbral de
                  renovación del equipo.
                </small>
              </div>
            )}
          </div>
        );
      })}

      <div className="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          onClick={agregar}
        >
          <i className="bi bi-plus-lg me-1" aria-hidden="true" />
          Agregar componente
        </button>
        <div className="small text-muted">
          {criticas > 0 && (
            <span className="me-3">Piezas críticas: {criticas}</span>
          )}
          Repuestos: <strong>{formatearMoneda(total)}</strong>
        </div>
      </div>
    </div>
  );
}
