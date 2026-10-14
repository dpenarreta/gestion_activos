import { formatearDias, formatearFecha } from "../../../utils/formato";

/**
 * Situación de la garantía de un equipo.
 *
 * «Sin registrar» se muestra distinto de «vencida» a propósito: no es lo mismo
 * una cobertura que expiró que una fecha que nadie capturó, y presentarlas
 * igual haría que un inventario a medio llenar pareciera un parque entero
 * fuera de garantía.
 */
const VARIANTES = {
  vigente: { clase: "mz-pill--ok", etiqueta: "En garantía" },
  por_vencer: { clase: "mz-pill--warn", etiqueta: "Por vencer" },
  vencida: { clase: "mz-pill--neutral", etiqueta: "Vencida" },
  // Sin tono propio y en cursiva: neutra como la vencida, pero que se note que
  // es un hueco del inventario y no un estado de la cobertura.
  sin_registrar: {
    clase: "mz-pill--neutral fst-italic",
    etiqueta: "Sin registrar",
  },
};

export function EstadoGarantia({
  estado,
  etiqueta,
  fecha,
  dias,
  compacto = false,
}) {
  const variante = VARIANTES[estado] || VARIANTES.sin_registrar;

  if (compacto) {
    return (
      <span className={`mz-pill ${variante.clase}`}>{variante.etiqueta}</span>
    );
  }

  return (
    <span className="d-inline-flex align-items-center gap-2 flex-wrap">
      <span className={`mz-pill ${variante.clase}`}>
        {etiqueta || variante.etiqueta}
      </span>
      {fecha && (
        <span className="mz-faint mz-small">
          hasta {formatearFecha(fecha)}
          {/* Los días restantes solo aportan cuando la fecha está cerca; a un
              año vista el número es ruido y la fecha ya lo dice todo. */}
          {typeof dias === "number" &&
            dias >= 0 &&
            dias <= 60 &&
            ` · ${formatearDias(dias)}`}
          {typeof dias === "number" &&
            dias < 0 &&
            ` · venció hace ${formatearDias(dias)}`}
        </span>
      )}
    </span>
  );
}
