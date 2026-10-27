/**
 * Moverse por un calendario con el teclado (patrón Date Picker de WAI-ARIA;
 * auditoría UX/UI, 27/10/2026): la grilla es una sola parada de Tab y dentro
 * se va con las flechas.
 *
 * - Izquierda / derecha: un día.
 * - Arriba / abajo: una semana.
 * - Inicio / Fin: el lunes o el domingo de esa semana.
 * - RePág / AvPág: el mismo día del mes anterior o siguiente (o el último
 *   del mes, si no lo tiene).
 *
 * Devuelve la fecha nueva, o `null` si la tecla no mueve nada.
 */
export function fechaPorTecla(fecha, tecla) {
  const a = fecha.getFullYear();
  const m = fecha.getMonth();
  const d = fecha.getDate();
  const diaDeLaSemana = (fecha.getDay() + 6) % 7; // lunes = 0
  switch (tecla) {
    case "ArrowLeft":
      return new Date(a, m, d - 1);
    case "ArrowRight":
      return new Date(a, m, d + 1);
    case "ArrowUp":
      return new Date(a, m, d - 7);
    case "ArrowDown":
      return new Date(a, m, d + 7);
    case "Home":
      return new Date(a, m, d - diaDeLaSemana);
    case "End":
      return new Date(a, m, d + (6 - diaDeLaSemana));
    case "PageUp":
    case "PageDown": {
      const destino = m + (tecla === "PageUp" ? -1 : 1);
      const ultimo = new Date(a, destino + 1, 0).getDate();
      return new Date(a, destino, Math.min(d, ultimo));
    }
    default:
      return null;
  }
}

/** «octubre de 2026» → «Octubre de 2026»: solo la primera letra (con
 * `text-transform: capitalize` salía «Octubre De 2026»). */
export function conMayuscula(texto) {
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}
