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
  vigente: { clase: "text-bg-success", etiqueta: "En garantía" },
  por_vencer: { clase: "text-bg-warning", etiqueta: "Por vencer" },
  vencida: { clase: "text-bg-secondary", etiqueta: "Vencida" },
  sin_registrar: { clase: "text-bg-light border", etiqueta: "Sin registrar" },
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
      <span className={`badge ${variante.clase}`}>{variante.etiqueta}</span>
    );
  }

  return (
    <span className="d-inline-flex align-items-center gap-2 flex-wrap">
      <span className={`badge ${variante.clase}`}>
        {etiqueta || variante.etiqueta}
      </span>
      {fecha && (
        <span className="text-muted small">
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
