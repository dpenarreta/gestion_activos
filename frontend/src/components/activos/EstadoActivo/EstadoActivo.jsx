/**
 * Distintivo del estado operativo de un activo.
 *
 * El color no es decorativo: "dado de baja" y "en mantenimiento" cambian lo
 * que se puede hacer con el equipo (no admite mantenimientos nuevos, no
 * aparece en sugerencias de renovación), así que conviene distinguirlos de un
 * vistazo en un listado largo. El texto acompaña siempre al color, para no
 * depender solo de él.
 */
const VARIANTES = {
  en_uso: "text-bg-success",
  en_bodega: "text-bg-secondary",
  en_mantenimiento: "text-bg-info",
  dado_de_baja: "text-bg-dark",
};

export function EstadoActivo({ estado, etiqueta }) {
  return <span className={`badge ${VARIANTES[estado] || "text-bg-secondary"}`}>{etiqueta || estado}</span>;
}
