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
 *
 * La identidad tiene cuatro tonos y no nueve: verde para lo que está listo
 * para entregarse, ámbar para lo que está de paso —en el taller, en garantía,
 * de camino— y rojo para las pérdidas. Asignado, en bodega y la baja van en
 * neutro: son la situación normal de un equipo, o una decisión ya cerrada, y
 * teñirlas haría competir el inventario entero con lo que sí pide atención.
 */
const VARIANTES = {
  disponible: "mz-pill--ok",
  en_uso: "mz-pill--neutral",
  en_bodega: "mz-pill--neutral",
  en_mantenimiento: "mz-pill--warn",
  en_garantia: "mz-pill--warn",
  en_transito: "mz-pill--warn",
  dado_de_baja: "mz-pill--neutral",
  perdido: "mz-pill--bad",
  robado: "mz-pill--bad",
};

export function EstadoActivo({ estado, etiqueta }) {
  return (
    <span className={`mz-pill ${VARIANTES[estado] || "mz-pill--neutral"}`}>
      {etiqueta || estado}
    </span>
  );
}
