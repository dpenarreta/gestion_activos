/*
 * Adónde va el foco cuando una acción quita o cambia el botón que se pulsó
 * (archivar una nota, completar un recordatorio…). Sin esto caía en <body> y
 * quien usa teclado o lector de pantalla perdía su lugar (auditoría UX/UI,
 * 06/11/2026). El destino es siempre algo estable: el título de la tarjeta
 * siguiente (o la anterior, si era la última) o, si la lista quedó vacía, su
 * contador (`role="status"` con `tabIndex={-1}`).
 */

/** El elemento que queda en el lugar de `id` al quitarlo de `lista`: el
 * siguiente o, si era el último, el anterior. `null` si no queda ninguno. */
export function vecinoDe(lista, id) {
  const i = (lista ?? []).findIndex((x) => x.id === id);
  const resto = (lista ?? []).filter((x) => x.id !== id);
  if (!resto.length) return null;
  return resto[Math.min(Math.max(i, 0), resto.length - 1)];
}

/** Enfoca el elemento `id` cuando ya está pintado (tras el cambio de
 * estado de React); si ya no existe (salió con un filtro), `respaldo`. */
export function enfocarDespues(id, respaldo = null) {
  if (!id) return;
  requestAnimationFrame(() =>
    (
      document.getElementById(id) ??
      (respaldo ? document.getElementById(respaldo) : null)
    )?.focus(),
  );
}
