/**
 * Distintivo del estado operativo de un activo (los nueve del §12).
 *
 * El color no es decorativo: los tres estados de salida —baja, perdido y
 * robado— cambian lo que se puede hacer con el equipo (no admite
 * mantenimientos, no se asigna, no aparece en sugerencias de renovación), y
 * conviene distinguirlos de un vistazo en un listado largo. Perdido y robado
 * van en rojo y no en gris como la baja: una baja es una decisión de la
 * empresa, las otras dos son pérdidas que alguien tiene que investigar.
 *
 * El texto acompaña siempre al color, para no depender solo de él.
 */
const VARIANTES = {
  disponible: "text-bg-success",
  en_uso: "text-bg-primary",
  en_bodega: "text-bg-secondary",
  en_mantenimiento: "text-bg-info",
  en_garantia: "text-bg-info",
  en_transito: "text-bg-warning",
  dado_de_baja: "text-bg-dark",
  perdido: "text-bg-danger",
  robado: "text-bg-danger",
};

export function EstadoActivo({ estado, etiqueta }) {
  return (
    <span className={`badge ${VARIANTES[estado] || "text-bg-secondary"}`}>
      {etiqueta || estado}
    </span>
  );
}
