/*
 * Conversiones entre el ISO del servidor y los campos `datetime-local`.
 */
const dos = (n) => String(n).padStart(2, "0");

/** ISO del servidor → valor de `<input type="datetime-local">` en la hora
 * del navegador (la de quien programa). */
export function aCampoLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** Valor de `datetime-local` → ISO con zona (el navegador lo lee como hora
 * local; el servidor guarda el instante). */
export function deCampoLocal(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
