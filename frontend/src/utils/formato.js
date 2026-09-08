/**
 * Formateo de fechas y montos para la interfaz.
 *
 * Se fija la configuración regional a es-EC (el sistema es de una empresa
 * ecuatoriana) en lugar de usar la del navegador: en un inventario que varias
 * personas revisan y comparan, la misma fecha debe leerse igual en todas las
 * pantallas, y `undefined` como locale haría que un navegador en inglés
 * mostrara 3/15/2024 junto a 15/3/2024 de otro.
 */
const LOCALE = "es-EC";
const MONEDA = "USD";

export function formatearFecha(valor, conHora = false) {
  if (!valor) return "—";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return String(valor);

  // Una fecha sin hora (YYYY-MM-DD) se interpreta como UTC y, en husos
  // negativos como el de Ecuador, retrocedería un día al formatearla en
  // local. Se fuerza UTC para que el día mostrado sea el capturado.
  const soloFecha = typeof valor === "string" && valor.length === 10;
  return fecha.toLocaleString(LOCALE, {
    timeZone: soloFecha ? "UTC" : undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(conHora ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatearMoneda(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  const numero = Number(valor);
  if (Number.isNaN(numero)) return String(valor);
  return numero.toLocaleString(LOCALE, { style: "currency", currency: MONEDA });
}
